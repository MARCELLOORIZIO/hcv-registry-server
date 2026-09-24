'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const Database = require('better-sqlite3');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-secure-ingest-'));
process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP = tmp;
process.env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES = '64';
process.env.DB_PATH = path.join(tmp, 'registry.db');

const fixtureDb = new Database(process.env.DB_PATH);
fixtureDb.exec(`
  CREATE TABLE certificates (
    hcv_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    certificate_raw TEXT NOT NULL
  );
  CREATE TABLE registry_provenance (
    hcv_id TEXT PRIMARY KEY,
    registered_at TEXT NOT NULL,
    certificate_sha256 TEXT NOT NULL,
    provenance_raw TEXT NOT NULL,
    source_commit TEXT,
    app_version TEXT,
    build_number TEXT,
    registry_status TEXT NOT NULL DEFAULT 'ACTIVE'
  );
  CREATE TABLE certificate_status_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hcv_id TEXT NOT NULL,
    status TEXT NOT NULL,
    reason_code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'REGISTRY'
  );
  CREATE TABLE auth_accounts (
    id TEXT PRIMARY KEY,
    email_normalized TEXT NOT NULL UNIQUE,
    email_display TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    creator_name TEXT NOT NULL,
    creator_id TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    device_key_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );
`);
fixtureDb.close();

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
    'deleteUploadedVideo',
    'invalidatePlatformReceipt',
    'registration_failed',
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
