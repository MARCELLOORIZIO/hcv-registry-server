'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  computePublicKeyFingerprint,
  verifyDeviceProof,
  verifyCertificate,
  sha256Hex,
} = require('../crypto_verifier');

function keyFixture() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  const publicMap = {
    modulus: Buffer.from(jwk.n, 'base64url').toString('base64'),
    exponent: Buffer.from(jwk.e, 'base64url').toString('base64'),
  };
  return { privateKey, publicMap };
}

test('device proof validates a real RSA signature', () => {
  const fixture = keyFixture();
  const deviceKeyFingerprint = computePublicKeyFingerprint(fixture.publicMap);
  const signedAt = new Date().toISOString();
  const statement = JSON.stringify({
    purpose: 'SIGILLUM_KYC_DEVICE_BINDING_V1',
    deviceKeyFingerprint,
    signedAt,
  });
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(statement),
    fixture.privateKey,
  ).toString('base64');
  const verified = verifyDeviceProof({
    deviceKeyFingerprint,
    publicKey: fixture.publicMap,
    signedAt,
    signature,
  });
  assert.equal(verified.deviceKeyFingerprint, deviceKeyFingerprint);
});

test('certificate validation checks chain, binding and RSA signature', () => {
  const fixture = keyFixture();
  const keyFingerprint = computePublicKeyFingerprint(fixture.publicMap);
  const creatorId = 'creator-12345678';
  const creatorName = 'Test Creator';
  const chain = [];
  for (const type of ['START', 'CONTENT_BOUND', 'STOP']) {
    const event = {
      type,
      timestamp: new Date().toISOString(),
      prev: chain.length === 0 ? 'GENESIS' : chain.at(-1).hash,
    };
    event.hash = sha256Hex(JSON.stringify(event));
    chain.push(event);
  }
  const rootHash = sha256Hex(JSON.stringify(chain));
  const signedPayload = {
    format: 'HCV_CERTIFICATE',
    version: 2,
    sessionId: 'session-12345678',
    createdAt: new Date().toISOString(),
    meta: {
      hcvId: 'HCV-123456789ABC',
      identity: {
        creatorId,
        creatorName,
        devicePublicKeyFingerprint: keyFingerprint,
        identityFingerprint: sha256Hex(`${creatorId}|${creatorName}|${keyFingerprint}`),
      },
    },
    content: { type: 'photo', hash: 'a'.repeat(64) },
    claims: {},
    rootHash,
    chain,
  };
  const signature = crypto.sign(
    'RSA-SHA256',
    Buffer.from(JSON.stringify(signedPayload)),
    fixture.privateKey,
  ).toString('base64');
  const certificate = {
    ...signedPayload,
    signatureAlgorithm: 'RSA-SHA256-HCV-V2',
    signature,
    publicKey: fixture.publicMap,
  };
  const verified = verifyCertificate(JSON.stringify(certificate), 'HCV-123456789ABC');
  assert.equal(verified.signerFingerprint, keyFingerprint);
  assert.equal(verified.contentHash, 'a'.repeat(64));
});
