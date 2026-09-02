'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { sha256Text } = require('./registry_certificate_security');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-registry-guard-'));
const dbPath = path.join(tmpDir, 'registry.db');
process.env.DB_PATH = dbPath;

const token = 'phase-d-registry-test-session';
const creatorId = 'creator-phase-d-test';
const creatorName = 'Phase D Test Creator';
const hcvId = 'HCV-ABCDEF0123456789';

const { publicKey: publicKeyObject, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = publicKeyObject.export({ format: 'jwk' });
const publicKey = {
  modulus: Buffer.from(jwk.n, 'base64url').toString('base64'),
  exponent: Buffer.from(jwk.e, 'base64url').toString('base64'),
};
const deviceKeyFingerprint = sha256Text(JSON.stringify(publicKey));
const identityFingerprint = sha256Text(
  `${creatorId}|${creatorName}|${deviceKeyFingerprint}`,
);

function createAuthSchema() {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_accounts (
      id TEXT PRIMARY KEY,
      creator_id TEXT,
      creator_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      device_key_fingerprint TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
  `);
  db.prepare(
    'INSERT INTO auth_accounts (id, creator_id, creator_name) VALUES (?, ?, ?)',
  ).run('account-phase-d-test', creatorId, creatorName);
  db.prepare(`
    INSERT INTO auth_sessions (
      token_hash, account_id, device_key_fingerprint,
      last_seen_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, NULL)
  `).run(
    sha256Text(token),
    'account-phase-d-test',
    deviceKeyFingerprint,
    '2026-09-02T09:00:00.000Z',
    '2027-09-02T09:00:00.000Z',
  );
  db.close();
}

function buildCertificate(contentHash) {
  const chain = [];
  let previous = 'GENESIS';
  for (const type of ['START', 'CONTENT_BOUND', 'STOP']) {
    const event = {
      type,
      timestamp: '2026-09-02T10:00:00.000Z',
      prev: previous,
    };
    event.hash = sha256Text(JSON.stringify(event));
    previous = event.hash;
    chain.push(event);
  }
  const rootHash = sha256Text(JSON.stringify(chain));
  const meta = {
    app: 'hcv_app',
    format: 'HCV',
    version: '2.0.0',
    device: 'ios',
    identity: {
      creatorId,
      creatorName,
      devicePublicKeyFingerprint: deviceKeyFingerprint,
      identityFingerprint,
    },
    hcvId,
    verificationUrl: `hcv://verify/${hcvId}`,
    publishMode: 'MEDIA_PLUS_ONLINE_REGISTRY',
    softwareAttestation: {
      type: 'SIGILLUM_SOFTWARE_ATTESTATION',
      version: 1,
      status: 'BOUND',
      bindingMethod: 'COMPILE_TIME_BUILD_METADATA_IN_SIGNED_HCV_CERTIFICATE',
      sourceCommit: '1fe680665ac1cec7a4e749149413cd63a45fe0c7',
      sourceCommitAlgorithm: 'GIT_SHA1',
      edition: 'user',
      appVersion: '1.0.0',
      buildNumber: '67',
    },
  };
  const signedPayload = {
    format: 'HCV_CERTIFICATE',
    version: 2,
    sessionId: 'session-phase-d-test',
    createdAt: '2026-09-02T10:00:00.000Z',
    meta,
    content: {
      type: 'photo',
      hash: contentHash,
      size: 1234,
      name: 'capture.jpg',
    },
    claims: {},
    rootHash,
    chain,
  };
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(JSON.stringify(signedPayload), 'utf8'),
    privateKey,
  ).toString('base64');
  return JSON.stringify({
    ...signedPayload,
    signatureAlgorithm: 'RSA-SHA256-HCV-V2',
    signature,
    publicKey,
  });
}

async function requestJson(baseUrl, method, urlPath, { auth = true, body } = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const decoded = await response.json();
  return { status: response.status, body: decoded };
}

async function run() {
  createAuthSchema();
  require('./registry_http_guard');

  const server = http.createServer((req, res) => {
    res.writeHead(418, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ legacyHandler: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const certificateRaw = buildCertificate('a'.repeat(64));

    const unauthenticated = await requestJson(
      baseUrl,
      'POST',
      '/api/certificate',
      { auth: false, body: { hcvId, certificateRaw } },
    );
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.body.error, 'SESSIONE_MANCANTE');

    const created = await requestJson(baseUrl, 'POST', '/api/certificate', {
      body: { hcvId, certificateRaw },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.ok, true);
    assert.equal(created.body.immutable, true);
    assert.equal(created.body.provenance.status, 'SIGILLUM_REGISTRY_VERIFIED');
    assert.equal(created.body.provenance.registryStatus, 'ACTIVE');
    assert.equal(created.body.provenance.appVersion, '1.0.0');
    assert.equal(created.body.provenance.buildNumber, '67');

    const fetched = await requestJson(
      baseUrl,
      'GET',
      `/api/certificate/${hcvId}`,
      { auth: false },
    );
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.certificateRaw, certificateRaw);
    assert.equal(fetched.body.provenance.status, 'SIGILLUM_REGISTRY_VERIFIED');
    assert.equal(fetched.body.registryStatus.status, 'ACTIVE');

    const repeated = await requestJson(baseUrl, 'POST', '/api/certificate', {
      body: { hcvId, certificateRaw },
    });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.immutable, true);

    const conflictingRaw = buildCertificate('b'.repeat(64));
    const conflict = await requestJson(baseUrl, 'POST', '/api/certificate', {
      body: { hcvId, certificateRaw: conflictingRaw },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, 'HCV_ID_CONFLICT');

    const fetchedAfterConflict = await requestJson(
      baseUrl,
      'GET',
      `/api/certificate/${hcvId}`,
      { auth: false },
    );
    assert.equal(fetchedAfterConflict.body.certificateRaw, certificateRaw);

    const passthrough = await requestJson(baseUrl, 'GET', '/other', { auth: false });
    assert.equal(passthrough.status, 418);
    assert.equal(passthrough.body.legacyHandler, true);

    console.log('registry_http_guard_test: PASS');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
