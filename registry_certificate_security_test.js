'use strict';

const assert = require('assert');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {
  authenticateRegistrySession,
  buildRegistryProvenance,
  sha256Text,
  verifyCertificateRaw,
  verifyRegistrationIdentity,
} = require('./registry_certificate_security');

function buildSignedCertificate() {
  const { publicKey: publicKeyObject, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKeyObject.export({ format: 'jwk' });
  const publicKey = {
    modulus: Buffer.from(jwk.n, 'base64url').toString('base64'),
    exponent: Buffer.from(jwk.e, 'base64url').toString('base64'),
  };
  const deviceKeyFingerprint = sha256Text(JSON.stringify(publicKey));
  const creatorId = 'creator-test-001';
  const creatorName = 'Registry Test Creator';
  const identityFingerprint = sha256Text(
    `${creatorId}|${creatorName}|${deviceKeyFingerprint}`,
  );
  const hcvId = 'HCV-0123456789ABCDEF';

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
    },
  };
  const content = {
    type: 'photo',
    hash: 'a'.repeat(64),
    size: 1234,
    name: 'capture.jpg',
  };
  const signedPayload = {
    format: 'HCV_CERTIFICATE',
    version: 2,
    sessionId: 'session-test',
    createdAt: '2026-09-02T10:00:00.000Z',
    meta,
    content,
    claims: {},
    rootHash,
    chain,
  };
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(JSON.stringify(signedPayload), 'utf8'),
    privateKey,
  ).toString('base64');
  const certificate = {
    ...signedPayload,
    signatureAlgorithm: 'RSA-SHA256-HCV-V2',
    signature,
    publicKey,
  };
  return {
    certificate,
    certificateRaw: JSON.stringify(certificate),
    hcvId,
    creatorId,
    creatorName,
    deviceKeyFingerprint,
  };
}

function buildAuthDb(token, fixture) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE auth_accounts (
      id TEXT PRIMARY KEY,
      creator_id TEXT,
      creator_name TEXT NOT NULL
    );
    CREATE TABLE auth_sessions (
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
  ).run('account-001', fixture.creatorId, fixture.creatorName);
  db.prepare(`
    INSERT INTO auth_sessions (
      token_hash, account_id, device_key_fingerprint,
      last_seen_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, NULL)
  `).run(
    sha256Text(token),
    'account-001',
    fixture.deviceKeyFingerprint,
    '2026-09-02T09:00:00.000Z',
    '2026-10-02T10:00:00.000Z',
  );
  return db;
}

(function run() {
  const fixture = buildSignedCertificate();
  const verified = verifyCertificateRaw(fixture.certificateRaw, fixture.hcvId);
  assert.equal(verified.hcvId, fixture.hcvId);
  assert.equal(verified.creatorId, fixture.creatorId);
  assert.equal(verified.deviceKeyFingerprint, fixture.deviceKeyFingerprint);
  assert.equal(verified.softwareAttestation.status, 'BOUND');
  assert.equal(
    verified.softwareAttestation.sourceCommit,
    '1fe680665ac1cec7a4e749149413cd63a45fe0c7',
  );

  const tampered = JSON.parse(fixture.certificateRaw);
  tampered.content.hash = 'b'.repeat(64);
  assert.throws(
    () => verifyCertificateRaw(JSON.stringify(tampered), fixture.hcvId),
    /CERTIFICATE_SIGNATURE_INVALID/,
  );

  const token = 'registry-session-token';
  const db = buildAuthDb(token, fixture);
  const session = authenticateRegistrySession(
    db,
    `Bearer ${token}`,
    new Date('2026-09-02T10:30:00.000Z'),
  );
  assert.equal(session.creatorId, fixture.creatorId);
  assert.equal(session.deviceKeyFingerprint, fixture.deviceKeyFingerprint);
  assert.equal(verifyRegistrationIdentity(verified, session), true);

  const provenance = buildRegistryProvenance({
    verifiedCertificate: verified,
    session,
    registeredAt: '2026-09-02T10:31:00.000Z',
  });
  assert.equal(provenance.status, 'SIGILLUM_REGISTRY_VERIFIED');
  assert.equal(provenance.integrityValid, true);
  assert.equal(provenance.identityVerified, true);
  assert.equal(provenance.sourceCommit, verified.softwareAttestation.sourceCommit);
  assert.match(provenance.attestationSha256, /^[a-f0-9]{64}$/);

  assert.throws(
    () =>
      verifyRegistrationIdentity(verified, {
        ...session,
        deviceKeyFingerprint: 'f'.repeat(64),
      }),
    /REGISTRY_CERTIFICATE_IDENTITY_MISMATCH/,
  );

  assert.throws(
    () => authenticateRegistrySession(db, 'Bearer wrong-token'),
    /SESSIONE_NON_VALIDA/,
  );

  db.close();
  console.log('registry_certificate_security_test: PASS');
})();
