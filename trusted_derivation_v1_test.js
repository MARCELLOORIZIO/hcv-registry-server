'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { sha256Text } = require('./registry_certificate_security');
const {
  registryOriginal, createTrustedVideoRendition, verifyTrustedDerivative,
} = require('./trusted_derivation_v1');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-derivation-'));
const HCV_ID = 'HCV-0123456789ABCDEF';

function fixture(original) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const certKey = {
    modulus: Buffer.from(jwk.n, 'base64url').toString('base64'),
    exponent: Buffer.from(jwk.e, 'base64url').toString('base64'),
  };
  const creatorId = 'creator-test', creatorName = 'Test creator';
  const fp = sha256Text(JSON.stringify(certKey));
  const chain = [];
  let prev = 'GENESIS';
  for (const type of ['START', 'CONTENT_BOUND', 'STOP']) {
    const event = { type, timestamp: '2026-09-23T12:00:00.000Z', prev };
    event.hash = sha256Text(JSON.stringify(event));
    chain.push(event);
    prev = event.hash;
  }
  const rootHash = sha256Text(JSON.stringify(chain));
  const payload = {
    format: 'HCV_CERTIFICATE', version: 2, sessionId: 'test-session',
    createdAt: '2026-09-23T12:00:00.000Z',
    meta: { hcvId: HCV_ID, identity: {
      creatorId, creatorName, devicePublicKeyFingerprint: fp,
      identityFingerprint: sha256Text(`${creatorId}|${creatorName}|${fp}`),
    } },
    content: {
      type: 'video', hash: crypto.createHash('sha256').update(original).digest('hex'),
      name: 'original.mp4', size: original.length,
    },
    claims: {}, rootHash, chain,
  };
  const cert = {
    ...payload, signatureAlgorithm: 'RSA-SHA256-HCV-V2',
    signature: crypto.sign('RSA-SHA256', Buffer.from(JSON.stringify(payload)), privateKey).toString('base64'),
    publicKey: certKey,
  };
  return JSON.stringify(cert);
}

function makeDb(raw) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE certificates (hcv_id TEXT PRIMARY KEY, certificate_raw TEXT NOT NULL);
    CREATE TABLE registry_provenance (
      hcv_id TEXT PRIMARY KEY, provenance_raw TEXT NOT NULL, registry_status TEXT NOT NULL
    );
    CREATE TABLE certificate_status_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, hcv_id TEXT NOT NULL, status TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO certificates VALUES (?, ?)').run(HCV_ID, raw);
  const cert = JSON.parse(raw);
  db.prepare('INSERT INTO registry_provenance VALUES (?, ?, ?)').run(
    HCV_ID, JSON.stringify({
      type: 'SIGILLUM_REGISTRY_PROVENANCE', version: 2,
      hcvId: HCV_ID, certificateSha256: sha256Text(raw),
      contentSha256: cert.content.hash, status: 'SIGILLUM_REGISTRY_VERIFIED',
      integrityValid: true,
    }), 'ACTIVE'
  );
  db.prepare('INSERT INTO certificate_status_events (hcv_id, status) VALUES (?, ?)').run(HCV_ID, 'ACTIVE');
  return db;
}

function run() {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=160x120:rate=12:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    path.join(tmp, 'original.mp4'),
  ], { timeout: 30000 });
  const originalPath = path.join(tmp, 'original.mp4');
  const original = fs.readFileSync(originalPath);
  const raw = fixture(original);
  const db = makeDb(raw);
  const { privateKey: signer, publicKey: signingPublic } =
    crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = signer.export({ format: 'pem', type: 'pkcs8' });
  const trustedKeys = {
    sigillum_service_2026: signingPublic.export({ format: 'pem', type: 'spki' }),
  };
  const outputPath = path.join(tmp, 'output.mp4');
  const params = { db, hcvId: HCV_ID, originalPath, outputPath,
    privateKeyPem, keyId: 'sigillum_service_2026', ffmpegExecutable: '/usr/bin/ffmpeg' };
  try {
    assert.equal(registryOriginal(db, HCV_ID).verified.contentSha256,
      crypto.createHash('sha256').update(original).digest('hex'));
    const manifest = createTrustedVideoRendition(params);
    assert(fs.existsSync(outputPath + '.hcvderivation.json'));
    const output = fs.readFileSync(outputPath);
    const input = { manifest, outputBytes: output, certificateRaw: raw, trustedKeys };
    assert.equal(verifyTrustedDerivative(input), true);

    // The same signed certificate and audible soundtrack do not save a UFO
    // inserted in the video: the exact derivative bytes must match its hash.
    const alteredPath = path.join(tmp, 'ufo.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', outputPath,
      '-vf', 'drawbox=x=40:y=28:w=42:h=14:color=white:t=fill:enable=between(t\\,1\\,1.5)',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'copy',
      alteredPath,
    ], { timeout: 30000 });
    assert.equal(verifyTrustedDerivative({ ...input, outputBytes: fs.readFileSync(alteredPath) }), false);

    for (const changed of [
      { ...manifest, output: { ...manifest.output, sha256: '0'.repeat(64) } },
      { ...manifest, transform: { ...manifest.transform, editorialImpact: 'edited' } },
      { ...manifest, parent: { ...manifest.parent, sha256: 'b'.repeat(64) } },
      { ...manifest, hcvId: 'HCV-FFFFFFFFFFFFFFFF' },
      { ...manifest, issuer: { ...manifest.issuer, keyId: 'attacker_key' } },
      { ...manifest, signature: 'forged' },
      { ...manifest, editoriallyEdited: false },
    ]) {
      assert.equal(verifyTrustedDerivative({ ...input, manifest: changed }), false);
    }
    assert.equal(verifyTrustedDerivative({ ...input, trustedKeys: {} }), false);
    assert.equal(verifyTrustedDerivative({ ...input, certificateRaw: raw + ' ' }), false);
    assert.equal(verifyTrustedDerivative({ ...input, outputBytes: original }), false);

    // An edited file, even with a valid HCV-ID and self-declared "transcode",
    // is NOT the signed original and cannot be handed to the trusted worker.
    fs.writeFileSync(originalPath, fs.readFileSync(alteredPath));
    assert.throws(() => createTrustedVideoRendition(params), /DERIVATION_ORIGINAL_SHA_MISMATCH/);
    fs.writeFileSync(originalPath, original);

    // Revocation / dispute / unregistered original: issue nothing.
    db.prepare('INSERT INTO certificate_status_events (hcv_id, status) VALUES (?, ?)')
      .run(HCV_ID, 'REVOKED');
    assert.throws(() => createTrustedVideoRendition(params), /REGISTRY_PROVENANCE_NOT_ACTIVE_VERIFIED/);
    db.prepare('DELETE FROM certificate_status_events WHERE status = ?').run('REVOKED');
    db.prepare('DELETE FROM registry_provenance WHERE hcv_id = ?').run(HCV_ID);
    assert.throws(() => createTrustedVideoRendition(params), /REGISTRY_VERIFIED_ORIGINAL_MISSING/);
    console.log('trusted_derivation_v1_test: PASS — original, transcode, UFO, tampering, untrusted key, revocation');
  } finally {
    db.close();
  }
}

try { run(); }
finally { fs.rmSync(tmp, { recursive: true, force: true }); }
