'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
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
} = require('./tool/telegram_reference_acceptance');

async function main() {
  assert.strictEqual(
    apiRoot({}),
    'https://api.telegram.org',
  );
  assert.strictEqual(
    apiRoot({ TELEGRAM_BOT_API_BASE: 'https://example.invalid///' }),
    'https://example.invalid',
  );
  assert.strictEqual(isOfficialApi('https://api.telegram.org'), true);
  assert.strictEqual(isOfficialApi('https://telegram.example.invalid'), false);

  assert.strictEqual(
    apiUrl('https://api.telegram.org', 'TOKEN', 'getMe'),
    'https://api.telegram.org/botTOKEN/getMe',
  );
  assert.strictEqual(
    fileUrl('https://api.telegram.org', 'TOKEN', 'documents/file.bin'),
    'https://api.telegram.org/file/botTOKEN/documents/file.bin',
  );

  assert.strictEqual(
    botToken({ TELEGRAM_BOT_TOKEN: 'secret-value' }),
    'secret-value',
  );

  assert.deepStrictEqual(
    parseArgs([
      '--stress', '10',
      '--stress-delay-ms', '1200',
      '--large-mb', '64',
      '--json', 'report.json',
      '--keep-evidence',
    ]),
    {
      keepEvidence: true,
      stressCount: 10,
      stressDelayMs: 1200,
      largeMb: 64,
      jsonPath: 'report.json',
    },
  );

  const temp = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'sigillum-telegram-unit-'),
  );
  try {
    const source = path.join(temp, 'source.bin');
    const encrypted = path.join(temp, 'source.sgref');
    const decrypted = path.join(temp, 'source.out');
    const bytes = crypto.randomBytes(2 * 1024 * 1024 + 137);
    await fs.promises.writeFile(source, bytes);
    const key = crypto.randomBytes(32);

    await encryptReference(source, encrypted, key);
    const encryptedPrefix = Buffer.alloc(MAGIC.length);
    const handle = await fs.promises.open(encrypted, 'r');
    try {
      await handle.read(encryptedPrefix, 0, MAGIC.length, 0);
    } finally {
      await handle.close();
    }
    assert.ok(encryptedPrefix.equals(MAGIC));
    assert.notStrictEqual(await sha256File(encrypted), await sha256File(source));

    await decryptReference(encrypted, decrypted, key);
    assert.strictEqual(await sha256File(decrypted), await sha256File(source));

    const safe = publicReport({
      token: 'not-a-real-secret-field',
      nested: { _fileId: 'telegram-file-id', keep: true },
    });
    assert.deepStrictEqual(
      safe,
      {
        token: 'not-a-real-secret-field',
        nested: { keep: true },
      },
    );
  } finally {
    await fs.promises.rm(temp, { recursive: true, force: true });
  }

  const sourceText = fs.readFileSync(
    path.join(__dirname, 'tool', 'telegram_reference_acceptance.js'),
    'utf8',
  );
  assert.ok(sourceText.includes("method: 'getChatAdministrators'"));
  assert.ok(sourceText.includes("form.append('protect_content', 'true')"));
  assert.ok(sourceText.includes("method: 'getFile'"));
  assert.ok(sourceText.includes("method: 'deleteMessage'"));
  assert.ok(sourceText.includes("chat.type !== 'channel'"));
  assert.ok(sourceText.includes("Acceptance requires a PRIVATE channel"));
  assert.ok(sourceText.includes("AES key"));
  assert.ok(!sourceText.includes('sendVideo'));
  assert.ok(!sourceText.includes('sendPhoto'));

  console.log('telegram_reference_acceptance_test: OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
