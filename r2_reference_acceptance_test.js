'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  MAGIC,
  awsEncode,
  canonicalObjectPath,
  decryptFile,
  encryptFile,
  normalizeEndpoint,
  parseArgs,
  presignedGetUrl,
  sha256File,
  signedHeaders,
} = require('./tool/r2_reference_acceptance');

async function main() {
  assert.strictEqual(awsEncode("a b!*'()"), 'a%20b%21%2A%27%28%29');
  assert.strictEqual(
    canonicalObjectPath('bucket', 'a/b c.bin'),
    '/bucket/a/b%20c.bin',
  );
  assert.strictEqual(
    normalizeEndpoint('https://abc.eu.r2.cloudflarestorage.com///').host,
    'abc.eu.r2.cloudflarestorage.com',
  );
  assert.deepStrictEqual(parseArgs(['--mb', '64', '--json', 'r.json']), {
    mb: 64,
    jsonPath: 'r.json',
  });

  const headers = signedHeaders({
    method: 'GET',
    endpoint: new URL('https://example.eu.r2.cloudflarestorage.com'),
    bucket: 'bucket',
    key: 'object.bin',
    accessKey: 'AKIDEXAMPLE',
    secretKey: 'not-a-real-secret',
    payloadHash:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    now: new Date('2026-10-01T12:00:00Z'),
  });
  assert.ok(headers.authorization.startsWith('AWS4-HMAC-SHA256 Credential='));
  assert.strictEqual(headers['x-amz-date'], '20261001T120000Z');

  const presigned = presignedGetUrl({
    endpoint: new URL('https://example.eu.r2.cloudflarestorage.com'),
    bucket: 'bucket',
    key: 'object.bin',
    accessKey: 'AKIDEXAMPLE',
    secretKey: 'not-a-real-secret',
    expiresSeconds: 60,
    now: new Date('2026-10-01T12:00:00Z'),
  });
  assert.ok(presigned.includes('X-Amz-Expires=60'));
  assert.ok(!presigned.includes('not-a-real-secret'));

  const temp = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'sigillum-r2-unit-'),
  );
  try {
    const source = path.join(temp, 'source.bin');
    const encrypted = path.join(temp, 'source.sgref');
    const decrypted = path.join(temp, 'source.out');
    await fs.promises.writeFile(source, crypto.randomBytes(1024 * 1024 + 31));
    const key = crypto.randomBytes(32);
    await encryptFile(source, encrypted, key);

    const prefix = Buffer.alloc(MAGIC.length);
    const handle = await fs.promises.open(encrypted, 'r');
    try {
      await handle.read(prefix, 0, prefix.length, 0);
    } finally {
      await handle.close();
    }
    assert.ok(prefix.equals(MAGIC));
    assert.notStrictEqual(await sha256File(source), await sha256File(encrypted));

    await decryptFile(encrypted, decrypted, key);
    assert.strictEqual(await sha256File(source), await sha256File(decrypted));
  } finally {
    await fs.promises.rm(temp, { recursive: true, force: true });
  }

  console.log('r2_reference_acceptance_test: OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
