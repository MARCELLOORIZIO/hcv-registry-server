'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const MAGIC = Buffer.from('SGR2REF1', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + NONCE_BYTES;

function requiredEnv(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error('Missing required environment variable: ' + key);
  return value;
}

function normalizeEndpoint(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('R2_ENDPOINT must use HTTPS.');
  return url;
}

function parseArgs(argv) {
  const out = { mb: 8, jsonPath: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mb' && argv[i + 1]) out.mb = Number(argv[++i]);
    else if (argv[i] === '--json' && argv[i + 1]) out.jsonPath = argv[++i];
    else throw new Error('Unknown or incomplete argument: ' + argv[i]);
  }
  if (!Number.isInteger(out.mb) || out.mb < 1 || out.mb > 1024) {
    throw new Error('--mb must be an integer from 1 to 1024.');
  }
  return out;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function createDeterministicFile(filePath, bytes) {
  const handle = await fs.promises.open(filePath, 'w');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 29 + 71) & 0xff;
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

async function encryptFile(sourcePath, targetPath, key) {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const output = fs.createWriteStream(targetPath, { flags: 'w' });
  output.write(MAGIC);
  output.write(nonce);
  await pipeline(fs.createReadStream(sourcePath), cipher, output, { end: false });
  output.write(cipher.getAuthTag());
  await new Promise((resolve, reject) => {
    output.once('error', reject);
    output.end(resolve);
  });
}

async function decryptFile(sourcePath, targetPath, key) {
  const stat = await fs.promises.stat(sourcePath);
  if (stat.size <= HEADER_BYTES + TAG_BYTES) {
    throw new Error('Encrypted R2 reference is too small.');
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
    throw new Error('Encrypted R2 reference magic mismatch.');
  }
  const nonce = header.subarray(MAGIC.length);
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

function safeAwsError(error) {
  const name = String(error?.name || error?.Code || 'AWS_ERROR');
  const status = Number(error?.$metadata?.httpStatusCode || 0);
  return status ? name + ' HTTP ' + status : name;
}

async function downloadBody(body, targetPath) {
  if (!body) throw new Error('R2 GET returned no body.');
  await pipeline(body, fs.createWriteStream(targetPath, { flags: 'w' }));
}

async function main(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const endpoint = normalizeEndpoint(requiredEnv(env, 'R2_ENDPOINT'));
  const bucket = requiredEnv(env, 'R2_BUCKET');
  const accessKeyId = requiredEnv(env, 'R2_ACCESS_KEY_ID');
  const secretAccessKey = requiredEnv(env, 'R2_SECRET_ACCESS_KEY');

  const requireEu = String(env.R2_REQUIRE_EU || 'true').toLowerCase() !== 'false';
  if (requireEu && !endpoint.hostname.includes('.eu.r2.cloudflarestorage.com')) {
    throw new Error(
      'EU acceptance requires an R2 jurisdiction endpoint ending in .eu.r2.cloudflarestorage.com.',
    );
  }

  const s3 = new S3Client({
    endpoint: endpoint.origin,
    region: 'auto',
    credentials: { accessKeyId, secretAccessKey },
  });

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'sigillum-r2-sdk-acceptance-'),
  );
  const source = path.join(tempDir, 'reference-source.bin');
  const encrypted = path.join(tempDir, 'reference.sgref');
  const downloaded = path.join(tempDir, 'reference.downloaded.sgref');
  const decrypted = path.join(tempDir, 'reference.decrypted.bin');
  const presignedDownload = path.join(tempDir, 'reference.presigned.sgref');
  const encryptionKey = crypto.randomBytes(32);
  const objectKey =
    'acceptance/' + new Date().toISOString().slice(0, 10) + '/' +
    crypto.randomUUID() + '.sgref';

  const report = {
    version: 'SIGILLUM_R2_REFERENCE_ACCEPTANCE_SDK_V1',
    signer: 'AWS_SDK_JS_V3',
    startedAt: new Date().toISOString(),
    euJurisdictionEndpoint: endpoint.hostname.includes('.eu.r2.cloudflarestorage.com'),
    payloadMb: args.mb,
    put: false,
    head: false,
    encryptedRoundTripSha256: false,
    decryptRoundTripSha256: false,
    presignedGetSha256: false,
    delete: false,
    deletedObjectUnavailable: false,
    passed: false,
  };

  try {
    await createDeterministicFile(source, args.mb * 1024 * 1024);
    const sourceHash = await sha256File(source);
    await encryptFile(source, encrypted, encryptionKey);
    const encryptedHash = await sha256File(encrypted);
    const encryptedStat = await fs.promises.stat(encrypted);

    try {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: fs.createReadStream(encrypted),
        ContentLength: encryptedStat.size,
        ContentType: 'application/octet-stream',
      }));
    } catch (error) {
      throw new Error('R2 SDK PUT failed: ' + safeAwsError(error));
    }
    report.put = true;

    let head;
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    } catch (error) {
      throw new Error('R2 SDK HEAD failed: ' + safeAwsError(error));
    }
    if (Number(head.ContentLength ?? -1) !== encryptedStat.size) {
      throw new Error('R2 SDK HEAD content-length mismatch.');
    }
    report.head = true;

    let get;
    try {
      get = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    } catch (error) {
      throw new Error('R2 SDK GET failed: ' + safeAwsError(error));
    }
    await downloadBody(get.Body, downloaded);
    report.encryptedRoundTripSha256 =
      (await sha256File(downloaded)) === encryptedHash;
    if (!report.encryptedRoundTripSha256) {
      throw new Error('R2 encrypted SHA-256 round-trip mismatch.');
    }

    await decryptFile(downloaded, decrypted, encryptionKey);
    report.decryptRoundTripSha256 =
      (await sha256File(decrypted)) === sourceHash;
    if (!report.decryptRoundTripSha256) {
      throw new Error('R2 plaintext SHA-256 after decrypt mismatch.');
    }

    const presigned = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: 60 },
    );
    const response = await fetch(presigned);
    if (!response.ok || !response.body) {
      throw new Error('R2 SDK presigned GET failed: HTTP ' + response.status);
    }
    const { Readable } = require('stream');
    await pipeline(
      Readable.fromWeb(response.body),
      fs.createWriteStream(presignedDownload, { flags: 'w' }),
    );
    report.presignedGetSha256 =
      (await sha256File(presignedDownload)) === encryptedHash;
    if (!report.presignedGetSha256) {
      throw new Error('R2 SDK presigned GET SHA-256 mismatch.');
    }

    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    } catch (error) {
      throw new Error('R2 SDK DELETE failed: ' + safeAwsError(error));
    }
    report.delete = true;

    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
      report.deletedObjectUnavailable = false;
    } catch (error) {
      const status = Number(error?.$metadata?.httpStatusCode || 0);
      report.deletedObjectUnavailable = status === 404;
      if (!report.deletedObjectUnavailable) {
        throw new Error('R2 SDK post-delete HEAD failed: ' + safeAwsError(error));
      }
    }

    report.finishedAt = new Date().toISOString();
    report.passed =
      report.euJurisdictionEndpoint &&
      report.put &&
      report.head &&
      report.encryptedRoundTripSha256 &&
      report.decryptRoundTripSha256 &&
      report.presignedGetSha256 &&
      report.delete &&
      report.deletedObjectUnavailable;

    const rendered = JSON.stringify(report, null, 2);
    console.log(rendered);
    if (args.jsonPath) {
      await fs.promises.writeFile(args.jsonPath, rendered + '\n', 'utf8');
    }
    if (!report.passed) process.exitCode = 1;
    return report;
  } finally {
    encryptionKey.fill(0);
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })).catch(() => {});
    s3.destroy();
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('R2_ACCEPTANCE_FAILED:', error.message);
    process.exitCode = 1;
  });
}
