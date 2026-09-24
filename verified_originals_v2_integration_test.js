'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-verified-originals-v2-'));
const dbPath = path.join(tmp, 'registry.db');
process.env.DB_PATH = dbPath;
process.env.SIGILLUM_VERIFIED_ORIGINALS_ADMIN_TOKEN =
  'sigillum-test-admin-token-0123456789abcdef';
process.env.SIGILLUM_PUBLISHER_ID = 'SIGILLUM_TEST_PUBLISHER';

const HCV_ID = 'HCV-0123456789ABCDEF';
const ORIGINAL = 'a'.repeat(64);
const REFERENCE = 'b'.repeat(64);
const CREATOR_ID = 'creator-01';
const ACCOUNT_ID = 'account-01';
const DEVICE = 'c'.repeat(64);
const OWNER_TOKEN = 'owner-test-token';
const OTHER_TOKEN = 'other-test-token';
const ADMIN_TOKEN = process.env.SIGILLUM_VERIFIED_ORIGINALS_ADMIN_TOKEN;

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function seed() {
  const db = new Database(dbPath);
  db.exec(`
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
    CREATE TABLE trusted_derivations (
      output_sha256 TEXT PRIMARY KEY,
      hcv_id TEXT NOT NULL,
      manifest_raw TEXT NOT NULL,
      registered_at TEXT NOT NULL
    );
  `);

  const now = '2026-09-24T10:00:00.000Z';
  const certificate = {
    format: 'HCV_CERTIFICATE',
    version: 2,
    meta: {hcvId: HCV_ID, identity: {creatorId: CREATOR_ID}},
    content: {type: 'video', hash: ORIGINAL, size: 1234, name: 'original.mp4'},
  };
  const raw = JSON.stringify(certificate);
  db.prepare(
    'INSERT INTO certificates (hcv_id,created_at,certificate_raw) VALUES (?,?,?)',
  ).run(HCV_ID, now, raw);
  db.prepare(`
    INSERT INTO registry_provenance
    (hcv_id,registered_at,certificate_sha256,provenance_raw,registry_status)
    VALUES (?,?,?,?,?)
  `).run(
    HCV_ID,
    now,
    sha(raw),
    JSON.stringify({
      type: 'SIGILLUM_REGISTRY_PROVENANCE',
      version: 2,
      hcvId: HCV_ID,
      status: 'SIGILLUM_REGISTRY_VERIFIED',
      integrityValid: true,
      contentSha256: ORIGINAL,
      accountSubjectHash: sha(ACCOUNT_ID),
    }),
    'ACTIVE',
  );
  db.prepare(`
    INSERT INTO certificate_status_events
    (hcv_id,status,reason_code,created_at,actor) VALUES (?,?,?,?,?)
  `).run(HCV_ID, 'ACTIVE', 'INITIAL_REGISTRATION', now, 'REGISTRY');

  const insertAccount = db.prepare(`
    INSERT INTO auth_accounts
    (id,email_normalized,email_display,password_salt,password_hash,creator_name,
     creator_id,email_verified,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,1,?,?)
  `);
  insertAccount.run(
    ACCOUNT_ID, 'owner@example.test', 'owner@example.test', 'salt', 'hash',
    'Owner', CREATOR_ID, now, now,
  );
  insertAccount.run(
    'account-02', 'other@example.test', 'other@example.test', 'salt', 'hash',
    'Other', 'creator-02', now, now,
  );

  const insertSession = db.prepare(`
    INSERT INTO auth_sessions
    (token_hash,account_id,device_key_fingerprint,created_at,last_seen_at,
     expires_at,revoked_at)
    VALUES (?,?,?,?,?,?,NULL)
  `);
  insertSession.run(
    sha(OWNER_TOKEN), ACCOUNT_ID, DEVICE, now, now,
    '2027-09-24T10:00:00.000Z',
  );
  insertSession.run(
    sha(OTHER_TOKEN), 'account-02', 'd'.repeat(64), now, now,
    '2027-09-24T10:00:00.000Z',
  );

  const manifest = {
    schema: 'SIGILLUM_TRUSTED_DERIVATION_V1',
    hcvId: HCV_ID,
    parent: {kind: 'original', sha256: ORIGINAL},
    output: {sha256: REFERENCE, byteLength: 1111, mediaType: 'video'},
    transform: {
      operation: 'video_transcode_h264_aac_v1',
      editorialImpact: 'non_editorial',
      policyVersion: 'SIGILLUM_NON_EDITORIAL_V1',
    },
    issuer: {
      keyId: 'sigillum_test_key',
      signatureAlgorithm: 'RSA-SHA256-PKCS1V15',
    },
    createdAt: now,
    nonce: '11111111-1111-4111-8111-111111111111',
    signature: 'x'.repeat(128),
  };
  db.prepare(`
    INSERT INTO trusted_derivations
    (output_sha256,hcv_id,manifest_raw,registered_at) VALUES (?,?,?,?)
  `).run(REFERENCE, HCV_ID, JSON.stringify(manifest), now);
  db.close();
}

async function call(base, method, pathname, {token, body} = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return {status: response.status, json, text};
}

async function run() {
  seed();
  require('./verified_originals_v2_guard');

  const server = http.createServer((req, res) => {
    res.writeHead(418, {'content-type': 'text/plain'});
    res.end('fallback');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = 'http://127.0.0.1:' + address.port;

  try {
    const noAuth = await call(
      base, 'POST', '/api/verified-originals/consents',
      {body: {
        hcvId: HCV_ID,
        intent: 'PUBLISH_VERIFIED_ORIGINAL',
        publishReference: true,
        rightsConfirmed: true,
        monetizationConsent: false,
      }},
    );
    assert.equal(noAuth.status, 401);

    const wrongOwner = await call(
      base, 'POST', '/api/verified-originals/consents',
      {token: OTHER_TOKEN, body: {
        hcvId: HCV_ID,
        intent: 'PUBLISH_VERIFIED_ORIGINAL',
        publishReference: true,
        rightsConfirmed: true,
        monetizationConsent: false,
      }},
    );
    assert.equal(wrongOwner.status, 403);
    assert.equal(wrongOwner.json.error, 'CREATOR_OWNERSHIP_NOT_VERIFIED');

    const consent = await call(
      base, 'POST', '/api/verified-originals/consents',
      {token: OWNER_TOKEN, body: {
        hcvId: HCV_ID,
        intent: 'PUBLISH_VERIFIED_ORIGINAL',
        publishReference: true,
        rightsConfirmed: true,
        monetizationConsent: false,
      }},
    );
    assert.equal(consent.status, 201);
    assert.equal(consent.json.publicationStatus, 'NOT_PUBLISHED');
    const consentId = consent.json.recordId;

    const noPublisher = await call(
      base, 'POST', '/api/verified-originals/publications',
      {token: OWNER_TOKEN, body: {
        hcvId: HCV_ID,
        consentRecordId: consentId,
        trustedDerivativeSha256: REFERENCE,
        platform: 'youtube',
        platformPostId: 'AbCdEfGhI_1',
        monetizationEnabled: false,
      }},
    );
    assert.equal(noPublisher.status, 403);
    assert.equal(noPublisher.json.error, 'PUBLISHER_NOT_AUTHORIZED');

    const wrongDerivative = await call(
      base, 'POST', '/api/verified-originals/publications',
      {token: ADMIN_TOKEN, body: {
        hcvId: HCV_ID,
        consentRecordId: consentId,
        trustedDerivativeSha256: '0'.repeat(64),
        platform: 'youtube',
        platformPostId: 'AbCdEfGhI_1',
        monetizationEnabled: false,
      }},
    );
    assert.equal(wrongDerivative.status, 422);
    assert.equal(wrongDerivative.json.error, 'TRUSTED_DERIVATION_REQUIRED');

    const badPlatformId = await call(
      base, 'POST', '/api/verified-originals/publications',
      {token: ADMIN_TOKEN, body: {
        hcvId: HCV_ID,
        consentRecordId: consentId,
        trustedDerivativeSha256: REFERENCE,
        platform: 'youtube',
        platformPostId: '../evil-url',
        monetizationEnabled: false,
      }},
    );
    assert.equal(badPlatformId.status, 400);

    const publication = await call(
      base, 'POST', '/api/verified-originals/publications',
      {token: ADMIN_TOKEN, body: {
        hcvId: HCV_ID,
        consentRecordId: consentId,
        trustedDerivativeSha256: REFERENCE,
        platform: 'youtube',
        platformPostId: 'AbCdEfGhI_1',
        monetizationEnabled: false,
        publicUrl: 'https://evil.example/redirect',
        referenceSha256: '0'.repeat(64),
      }},
    );
    assert.equal(publication.status, 201);
    assert.equal(
      publication.json.publicUrl,
      'https://www.youtube.com/watch?v=AbCdEfGhI_1',
    );
    assert.equal(publication.json.referenceSha256, REFERENCE);
    assert.equal(publication.json.derivedFrom, ORIGINAL);
    assert.equal(publication.json.socialFileVerdict, 'NOT_VERIFIED');

    const active = await call(
      base, 'GET', '/api/verified-originals/' + HCV_ID,
    );
    assert.equal(active.status, 200);
    assert.equal(active.json.availability, 'REFERENCE_AVAILABLE');
    assert.equal(active.json.socialFileVerdict, 'NOT_VERIFIED');

    const withdrawn = await call(
      base, 'POST', '/api/verified-originals/consents/' + HCV_ID + '/withdraw',
      {token: OWNER_TOKEN},
    );
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.json.referenceAvailable, false);

    const after = await call(
      base, 'GET', '/api/verified-originals/' + HCV_ID,
    );
    assert.equal(after.status, 200);
    assert.equal(after.json.availability, 'REFERENCE_NOT_AVAILABLE');

    const fallback = await call(base, 'GET', '/not-verified-originals');
    assert.equal(fallback.status, 418);
    assert.equal(fallback.text, 'fallback');

    console.log(
      'verified_originals_v2_integration_test: PASS — ownership, consent, trusted derivation, canonical URL, withdrawal',
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmp, {recursive: true, force: true});
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
