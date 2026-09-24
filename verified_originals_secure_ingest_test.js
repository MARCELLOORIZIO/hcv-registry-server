'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-secure-ingest-'));
process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP = tmp;
process.env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES = '64';

const { streamToFile } = require('./verified_originals_secure_ingest');

async function run() {
  const exact = path.join(tmp, 'exact.mp4');
  const bytes = Buffer.from('exact-original-bytes');
  const result = await streamToFile(
    Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]),
    exact,
    bytes.length,
  );
  assert.equal(result.size, bytes.length);
  assert.equal(fs.readFileSync(exact).compare(bytes), 0);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);

  const short = path.join(tmp, 'short.mp4');
  await assert.rejects(
    streamToFile(Readable.from([Buffer.from('short')]), short, 10),
    /ORIGINAL_UPLOAD_SIZE_MISMATCH/,
  );

  const oversized = path.join(tmp, 'oversized.mp4');
  await assert.rejects(
    streamToFile(Readable.from([Buffer.alloc(65)]), oversized, 65),
    /ORIGINAL_UPLOAD_TOO_LARGE/,
  );

  const source = fs.readFileSync(
    require.resolve('./verified_originals_secure_ingest'),
    'utf8',
  );
  for (const required of [
    'authenticateRegistrySession',
    'registryOriginal',
    'createTrustedVideoRendition',
    'publishTrustedVideoReference',
    'registerPublicationRecord',
    'DERIVATION_ORIGINAL_SHA_MISMATCH',
    'finally',
    'fs.promises.rm',
    'video/mp4',
    'content-length',
  ]) {
    assert(source.includes(required), 'missing secure-ingest invariant: ' + required);
  }
  assert(!source.includes('req.headers[\'x-content-sha256\']'));
  assert(!source.includes('clientSecret'));

  console.log(
    'verified_originals_secure_ingest_test: PASS — streaming, bounds, exact size, cleanup contract',
  );
}

run().finally(() => {
  fs.rmSync(tmp, {recursive: true, force: true});
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
