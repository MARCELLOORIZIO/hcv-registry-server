'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const ffmpegPath = require('ffmpeg-static');

const MAGIC = Buffer.from('SGTREF01', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + NONCE_BYTES;

function requiredEnv(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error('Missing required environment variable: ' + key);
  return value;
}

function botToken(env = process.env) {
  const direct = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  if (direct) return direct;

  const filePath = String(
    env.TELEGRAM_BOT_TOKEN_FILE || '.sigillum-telegram-bot-token.txt',
  ).trim();
  if (filePath && fs.existsSync(filePath)) {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    if (value) return value;
  }

  throw new Error(
    'Missing TELEGRAM_BOT_TOKEN and no local bot-token file was found.',
  );
}

function apiRoot(env = process.env) {
  return String(
    env.TELEGRAM_BOT_API_BASE || 'https://api.telegram.org',
  ).trim().replace(/\/+$/, '');
}

function isOfficialApi(root) {
  try {
    const url = new URL(root);
    return url.hostname === 'api.telegram.org';
  } catch (_) {
    return false;
  }
}

function apiUrl(root, token, method) {
  return root + '/bot' + token + '/' + method;
}

function fileUrl(root, token, filePath) {
  return root + '/file/bot' + token + '/' + String(filePath)
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

async function telegramJson({
  root,
  token,
  method,
  body,
  timeoutMs = 60_000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl(root, token, method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      const description = String(payload.description || response.status);
      const error = new Error('Telegram ' + method + ' failed: ' + description);
      error.status = response.status;
      error.telegramErrorCode = payload.error_code;
      error.retryAfter = payload.parameters?.retry_after;
      throw error;
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

async function sendDocumentFile({
  root,
  token,
  chatId,
  filePath: localPath,
  caption,
}) {
  const bytes = await fs.promises.readFile(localPath);
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('protect_content', 'true');
  form.append('disable_notification', 'true');
  form.append('caption', caption);
  form.append(
    'document',
    new Blob([bytes], { type: 'application/octet-stream' }),
    path.basename(localPath),
  );

  const response = await fetch(apiUrl(root, token, 'sendDocument'), {
    method: 'POST',
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) {
    const description = String(payload.description || response.status);
    const error = new Error('Telegram sendDocument failed: ' + description);
    error.status = response.status;
    error.telegramErrorCode = payload.error_code;
    error.retryAfter = payload.parameters?.retry_after;
    throw error;
  }
  return payload.result;
}

async function sendDocumentByFileId({
  root,
  token,
  chatId,
  fileId,
  caption,
}) {
  return telegramJson({
    root,
    token,
    method: 'sendDocument',
    body: {
      chat_id: chatId,
      document: fileId,
      protect_content: true,
      disable_notification: true,
      caption,
    },
  });
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function encryptReference(sourcePath, targetPath, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('Reference encryption requires a 32-byte AES key.');
  }
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  const output = fs.createWriteStream(targetPath, { flags: 'w' });
  output.write(MAGIC);
  output.write(nonce);

  await pipeline(fs.createReadStream(sourcePath), cipher, output, {
    end: false,
  });
  output.write(cipher.getAuthTag());
  await new Promise((resolve, reject) => {
    output.once('error', reject);
    output.end(resolve);
  });
}

async function decryptReference(sourcePath, targetPath, key) {
  const stat = await fs.promises.stat(sourcePath);
  if (stat.size <= HEADER_BYTES + TAG_BYTES) {
    throw new Error('Encrypted reference is too small.');
  }
  const handle = await fs.promises.open(sourcePath, 'r');
  let header;
  let tag;
  try {
    header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
  } finally {
    await handle.close();
  }

  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Encrypted reference magic mismatch.');
  }
  const nonce = header.subarray(MAGIC.length, HEADER_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);

  await pipeline(
    fs.createReadStream(sourcePath, {
      start: HEADER_BYTES,
      end: stat.size - TAG_BYTES - 1,
    }),
    decipher,
    fs.createWriteStream(targetPath, { flags: 'w' }),
  );
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(
        new Error(
          'Process failed (' + code + '): ' + stderr.slice(-2000),
        ),
      );
    });
  });
}

async function createVideo(outputPath) {
  await runProcess(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=24:duration=5',
    '-f', 'lavfi',
    '-i', 'sine=frequency=880:sample_rate=48000:duration=5',
    '-shortest',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath,
  ]);
}

async function createImage(outputPath) {
  await runProcess(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=800x600:rate=1:duration=1',
    '-frames:v', '1',
    outputPath,
  ]);
}

async function createDeterministicFile(outputPath, bytes) {
  const handle = await fs.promises.open(outputPath, 'w');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < chunk.length; i++) {
      chunk[i] = (i * 31 + 17) & 0xff;
    }
    let remaining = bytes;
    while (remaining > 0) {
      const length = Math.min(chunk.length, remaining);
      await handle.write(chunk, 0, length);
      remaining -= length;
    }
  } finally {
    await handle.close();
  }
}

async function downloadTelegramFile({
  root,
  token,
  fileId,
  destination,
}) {
  const file = await telegramJson({
    root,
    token,
    method: 'getFile',
    body: { file_id: fileId },
  });
  const remotePath = String(file.file_path || '');
  if (!remotePath) throw new Error('Telegram getFile returned no file_path.');

  const response = await fetch(fileUrl(root, token, remotePath));
  if (!response.ok || !response.body) {
    throw new Error('Telegram file download failed: HTTP ' + response.status);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(destination, { flags: 'w' }),
  );
  return file;
}

function parseArgs(argv) {
  const out = {
    keepEvidence: false,
    stressCount: 0,
    stressDelayMs: 1100,
    largeMb: 0,
    jsonPath: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--keep-evidence') out.keepEvidence = true;
    else if (arg === '--stress' && argv[i + 1]) out.stressCount = Number(argv[++i]);
    else if (arg === '--stress-delay-ms' && argv[i + 1]) out.stressDelayMs = Number(argv[++i]);
    else if (arg === '--large-mb' && argv[i + 1]) out.largeMb = Number(argv[++i]);
    else if (arg === '--json' && argv[i + 1]) out.jsonPath = argv[++i];
    else throw new Error('Unknown or incomplete argument: ' + arg);
  }
  if (!Number.isInteger(out.stressCount) || out.stressCount < 0 || out.stressCount > 2000) {
    throw new Error('--stress must be an integer from 0 to 2000.');
  }
  if (!Number.isFinite(out.stressDelayMs) || out.stressDelayMs < 1000) {
    throw new Error('--stress-delay-ms must be at least 1000.');
  }
  if (!Number.isInteger(out.largeMb) || out.largeMb < 0 || out.largeMb > 256) {
    throw new Error('--large-mb must be an integer from 0 to 256.');
  }
  return out;
}

async function deleteMessageSafe({ root, token, chatId, messageId }) {
  if (!messageId) return false;
  try {
    await telegramJson({
      root,
      token,
      method: 'deleteMessage',
      body: {
        chat_id: chatId,
        message_id: messageId,
      },
    });
    return true;
  } catch (_) {
    return false;
  }
}

async function verifyChannel({ root, token, chatId, allowPublic }) {
  const bot = await telegramJson({ root, token, method: 'getMe', body: {} });
  const chat = await telegramJson({
    root,
    token,
    method: 'getChat',
    body: { chat_id: chatId },
  });
  if (chat.type !== 'channel') {
    throw new Error('TELEGRAM_REFERENCE_CHAT_ID must identify a channel.');
  }
  if (chat.username && !allowPublic) {
    throw new Error(
      'Acceptance requires a PRIVATE channel (no public username).',
    );
  }

  const admins = await telegramJson({
    root,
    token,
    method: 'getChatAdministrators',
    body: { chat_id: chatId },
  });
  const self = admins.find(item => item?.user?.id === bot.id);
  if (!self || (self.status !== 'administrator' && self.status !== 'creator')) {
    throw new Error('SIGILLUM bot is not a channel administrator.');
  }
  if (self.status === 'administrator' && self.can_post_messages !== true) {
    throw new Error('SIGILLUM bot lacks can_post_messages.');
  }
  if (self.status === 'administrator' && self.can_delete_messages !== true) {
    throw new Error('SIGILLUM bot lacks can_delete_messages.');
  }

  return {
    botId: bot.id,
    botUsername: String(bot.username || ''),
    chatType: chat.type,
    privateChannel: !chat.username,
    canPost: self.status === 'creator' || self.can_post_messages === true,
    canDelete: self.status === 'creator' || self.can_delete_messages === true,
  };
}

async function verifyRoundTrip({
  root,
  token,
  chatId,
  sourcePath,
  label,
  key,
  tempDir,
  keepEvidence,
}) {
  const sourceHash = await sha256File(sourcePath);
  const encryptedPath = path.join(tempDir, label + '.sgref');
  await encryptReference(sourcePath, encryptedPath, key);
  const encryptedHash = await sha256File(encryptedPath);
  const encryptedBytes = (await fs.promises.stat(encryptedPath)).size;

  const first = await sendDocumentFile({
    root,
    token,
    chatId,
    filePath: encryptedPath,
    caption: 'SIGILLUM TELEGRAM ACCEPTANCE V1 — ' + label,
  });

  const messageIds = [first.message_id];
  try {
    if (first.has_protected_content !== true) {
      throw new Error('protect_content was not confirmed by Telegram.');
    }
    const document = first.document;
    if (!document?.file_id || !document?.file_unique_id) {
      throw new Error('Telegram returned no persistent document identifiers.');
    }

    const downloaded = path.join(tempDir, label + '.downloaded.sgref');
    const fileInfo = await downloadTelegramFile({
      root,
      token,
      fileId: document.file_id,
      destination: downloaded,
    });
    const downloadedHash = await sha256File(downloaded);
    if (downloadedHash !== encryptedHash) {
      throw new Error(label + ': encrypted SHA-256 round-trip mismatch.');
    }
    if (Number(fileInfo.file_size || encryptedBytes) !== encryptedBytes) {
      throw new Error(label + ': Telegram file_size mismatch.');
    }

    const decrypted = path.join(tempDir, label + '.decrypted');
    await decryptReference(downloaded, decrypted, key);
    const decryptedHash = await sha256File(decrypted);
    if (decryptedHash !== sourceHash) {
      throw new Error(label + ': plaintext SHA-256 after decrypt mismatch.');
    }

    const reused = await sendDocumentByFileId({
      root,
      token,
      chatId,
      fileId: document.file_id,
      caption: 'SIGILLUM TELEGRAM FILE_ID REUSE V1 — ' + label,
    });
    messageIds.push(reused.message_id);
    if (reused.has_protected_content !== true) {
      throw new Error(label + ': reused message lost content protection.');
    }
    if (reused.document?.file_unique_id !== document.file_unique_id) {
      throw new Error(label + ': file_id reuse changed file_unique_id.');
    }

    return {
      label,
      sourceBytes: (await fs.promises.stat(sourcePath)).size,
      encryptedBytes,
      encryptedRoundTripSha256: true,
      decryptRoundTripSha256: true,
      protectedContent: true,
      fileIdImmediateReuse: true,
      messageIds: keepEvidence ? messageIds : [],
      _fileId: document.file_id,
    };
  } finally {
    if (!keepEvidence) {
      for (const messageId of messageIds.reverse()) {
        await deleteMessageSafe({ root, token, chatId, messageId });
      }
    }
  }
}

async function stressFileId({
  root,
  token,
  chatId,
  fileId,
  count,
  delayMs,
}) {
  if (!count) return { requested: 0, sent: 0, rateLimited: 0 };
  const ids = [];
  let rateLimited = 0;
  try {
    for (let i = 0; i < count; i++) {
      try {
        const message = await sendDocumentByFileId({
          root,
          token,
          chatId,
          fileId,
          caption: 'SIGILLUM TELEGRAM RATE TEST ' + (i + 1) + '/' + count,
        });
        ids.push(message.message_id);
      } catch (error) {
        if (error.status === 429 || error.telegramErrorCode === 429) {
          rateLimited++;
          const waitSeconds = Math.max(1, Number(error.retryAfter || 1));
          await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
          i--;
          continue;
        }
        throw error;
      }
      if (i + 1 < count) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  } finally {
    for (const messageId of ids.reverse()) {
      await deleteMessageSafe({ root, token, chatId, messageId });
    }
  }
  return {
    requested: count,
    sent: ids.length,
    rateLimited,
    delayMs,
  };
}

function publicReport(report) {
  return JSON.parse(JSON.stringify(report, (key, value) => {
    if (key === '_fileId') return undefined;
    return value;
  }));
}

async function main(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const token = botToken(env);
  const chatId = requiredEnv(env, 'TELEGRAM_REFERENCE_CHAT_ID');
  const root = apiRoot(env);
  const allowPublic =
    String(env.TELEGRAM_ALLOW_PUBLIC_TEST_CHANNEL || '').toLowerCase() === 'true';

  if (args.largeMb > 50 && isOfficialApi(root)) {
    throw new Error(
      '--large-mb > 50 requires TELEGRAM_BOT_API_BASE to point to a Local Bot API server.',
    );
  }

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'sigillum-telegram-acceptance-'),
  );
  const key = crypto.randomBytes(32);
  const report = {
    version: 'SIGILLUM_TELEGRAM_REFERENCE_ACCEPTANCE_V1',
    startedAt: new Date().toISOString(),
    apiMode: isOfficialApi(root) ? 'OFFICIAL_BOT_API' : 'CUSTOM_OR_LOCAL_BOT_API',
    channel: null,
    tests: [],
    stress: null,
    passed: false,
  };

  try {
    report.channel = await verifyChannel({
      root,
      token,
      chatId,
      allowPublic,
    });

    const video = path.join(tempDir, 'sigillum_acceptance_video.mp4');
    const image = path.join(tempDir, 'sigillum_acceptance_image.png');
    await createVideo(video);
    await createImage(image);

    const videoResult = await verifyRoundTrip({
      root,
      token,
      chatId,
      sourcePath: video,
      label: 'video',
      key,
      tempDir,
      keepEvidence: args.keepEvidence,
    });
    report.tests.push(videoResult);

    const imageResult = await verifyRoundTrip({
      root,
      token,
      chatId,
      sourcePath: image,
      label: 'image',
      key,
      tempDir,
      keepEvidence: args.keepEvidence,
    });
    report.tests.push(imageResult);

    if (args.largeMb > 0) {
      const large = path.join(
        tempDir,
        'sigillum_acceptance_' + args.largeMb + 'mb.bin',
      );
      await createDeterministicFile(
        large,
        args.largeMb * 1024 * 1024,
      );
      const largeResult = await verifyRoundTrip({
        root,
        token,
        chatId,
        sourcePath: large,
        label: 'large-' + args.largeMb + 'mb',
        key,
        tempDir,
        keepEvidence: args.keepEvidence,
      });
      report.tests.push(largeResult);
    }

    report.stress = await stressFileId({
      root,
      token,
      chatId,
      fileId: videoResult._fileId,
      count: args.stressCount,
      delayMs: args.stressDelayMs,
    });

    report.passed = report.tests.every(test =>
      test.encryptedRoundTripSha256 === true &&
      test.decryptRoundTripSha256 === true &&
      test.protectedContent === true &&
      test.fileIdImmediateReuse === true
    ) && report.stress.sent === report.stress.requested;

    report.finishedAt = new Date().toISOString();
    const safe = publicReport(report);
    const rendered = JSON.stringify(safe, null, 2);
    console.log(rendered);
    if (args.jsonPath) {
      await fs.promises.writeFile(args.jsonPath, rendered + '\n', 'utf8');
    }
    if (!report.passed) process.exitCode = 1;
    return safe;
  } finally {
    key.fill(0);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('TELEGRAM_ACCEPTANCE_FAILED:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  MAGIC,
  apiRoot,
  apiUrl,
  botToken,
  decryptReference,
  encryptReference,
  fileUrl,
  isOfficialApi,
  parseArgs,
  publicReport,
  sha256File,
};
