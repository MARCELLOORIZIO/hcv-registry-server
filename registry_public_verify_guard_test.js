'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-public-verify-'));
const dbPath = path.join(tmpDir, 'registry.db');
process.env.DB_PATH = dbPath;

const legacyId = 'HCV-1111111111111111';
const verifiedId = 'HCV-2222222222222222';
const revokedId = 'HCV-3333333333333333';

function certificateRaw(hcvId, creatorName) {
  return JSON.stringify({
    format: 'HCV_CERTIFICATE',
    version: 2,
    createdAt: '2026-09-02T10:00:00.000Z',
    meta: {
      hcvId,
      identity: { creatorName },
      softwareAttestation: {
        status: 'BOUND',
        sourceCommit: 'e683b43cc27158c23cd07274040f1dbee373a38f',
        appVersion: '1.0.0',
        buildNumber: '68',
      },
    },
    content: {
      type: 'photo',
      hash: 'a'.repeat(64),
    },
    signatureAlgorithm: 'RSA-SHA256-HCV-V2',
  });
}

function seedDb() {
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
  `);
  const insertCertificate = db.prepare(
    'INSERT INTO certificates (hcv_id, created_at, certificate_raw) VALUES (?, ?, ?)',
  );
  for (const [id, creator] of [
    [legacyId, 'Legacy Creator'],
    [verifiedId, 'Verified Creator'],
    [revokedId, 'Revoked Creator'],
  ]) {
    insertCertificate.run(id, '2026-09-02T10:00:00.000Z', certificateRaw(id, creator));
  }

  const insertProvenance = db.prepare(`
    INSERT INTO registry_provenance (
      hcv_id, registered_at, certificate_sha256, provenance_raw,
      source_commit, app_version, build_number, registry_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [id, status] of [
    [verifiedId, 'ACTIVE'],
    [revokedId, 'REVOKED'],
  ]) {
    const provenance = {
      type: 'SIGILLUM_REGISTRY_PROVENANCE',
      version: 2,
      hcvId: id,
      certificateSha256: 'b'.repeat(64),
      contentSha256: 'a'.repeat(64),
      registeredAt: '2026-09-02T10:01:00.000Z',
      status: 'SIGILLUM_REGISTRY_VERIFIED',
      integrityValid: true,
      softwareAttestationStatus: 'BOUND',
      sourceCommit: 'e683b43cc27158c23cd07274040f1dbee373a38f',
    };
    insertProvenance.run(
      id,
      provenance.registeredAt,
      provenance.certificateSha256,
      JSON.stringify(provenance),
      provenance.sourceCommit,
      '1.0.0',
      '68',
      status,
    );
    db.prepare(`
      INSERT INTO certificate_status_events (
        hcv_id, status, reason_code, created_at, actor
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      id,
      status,
      status === 'REVOKED' ? 'TEST_REVOCATION' : 'INITIAL_REGISTRATION',
      '2026-09-02T10:02:00.000Z',
      'REGISTRY',
    );
  }
  db.close();
}

async function getText(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { status: response.status, text: await response.text() };
}

async function run() {
  seedDb();
  require('./registry_public_verify_guard');

  const server = http.createServer((req, res) => {
    res.writeHead(418, { 'Content-Type': 'text/plain' });
    res.end('legacy-handler');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const legacy = await getText(baseUrl, `/verify/${legacyId}`);
    assert.equal(legacy.status, 200);
    assert.match(legacy.text, /Registry record found/);
    assert.match(legacy.text, /LEGACY/);
    assert.doesNotMatch(legacy.text, /HUMAN VERIFIED/);
    assert.match(legacy.text, /presence alone is not proof/i);

    const verified = await getText(baseUrl, `/verify/${verifiedId}`);
    assert.equal(verified.status, 200);
    assert.match(verified.text, /Certificate verified/);
    assert.match(verified.text, /VERIFIED/);
    assert.match(verified.text, /e683b43cc27158c23cd07274040f1dbee373a38f/);
    assert.match(verified.text, /Build number/);
    assert.doesNotMatch(verified.text, /HUMAN VERIFIED/);
    assert.match(verified.text, /does not by itself verify a separate copy of the media file/i);

    const revoked = await getText(baseUrl, `/verify/${revokedId}`);
    assert.equal(revoked.status, 200);
    assert.match(revoked.text, /Certificate revoked/);
    assert.match(revoked.text, /REVOKED/);

    const missing = await getText(baseUrl, '/verify/HCV-4444444444444444');
    assert.equal(missing.status, 404);
    assert.match(missing.text, /Certificate not found/);

    const passthrough = await getText(baseUrl, '/other');
    assert.equal(passthrough.status, 418);
    assert.equal(passthrough.text, 'legacy-handler');

    console.log('registry_public_verify_guard_test: PASS');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
