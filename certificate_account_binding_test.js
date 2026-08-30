const assert = require('assert');
const crypto = require('crypto');
const {
  fingerprintPublicKey,
  inspectCertificateAccountBinding,
} = require('./certificate_account_binding');

const deviceKey = {
  modulus: Buffer.from('sigillum-device-key').toString('base64'),
  exponent: Buffer.from([1, 0, 1]).toString('base64'),
};
const otherKey = {
  modulus: Buffer.from('different-device-key').toString('base64'),
  exponent: Buffer.from([1, 0, 1]).toString('base64'),
};
const fingerprint = fingerprintPublicKey(deviceKey);
const otherFingerprint = fingerprintPublicKey(otherKey);

function identityFingerprint(creatorId, creatorName, keyFingerprint) {
  return crypto
    .createHash('sha256')
    .update(`${creatorId}|${creatorName}|${keyFingerprint}`, 'utf8')
    .digest('hex');
}

function certificate(overrides = {}) {
  const creatorId = overrides.identity?.creatorId || 'creator-123';
  const creatorName = overrides.identity?.creatorName || 'Verified Creator';
  const declaredKeyFingerprint =
    overrides.identity?.devicePublicKeyFingerprint || fingerprint;
  const baseIdentity = {
    creatorId,
    creatorName,
    devicePublicKeyFingerprint: declaredKeyFingerprint,
    publicKey: deviceKey,
    identityFingerprint: identityFingerprint(
      creatorId,
      creatorName,
      declaredKeyFingerprint,
    ),
  };
  return {
    publicKey: deviceKey,
    meta: {
      identity: {
        ...baseIdentity,
        ...(overrides.identity || {}),
      },
      ...(overrides.meta || {}),
    },
    ...overrides.root,
  };
}

function registeredDevice(overrides = {}) {
  return {
    device_key_fingerprint: fingerprint,
    public_key_json: deviceKey,
    ...overrides,
  };
}

{
  const result = inspectCertificateAccountBinding({
    certificate: certificate(),
    sessionDeviceFingerprint: fingerprint,
    registeredDevice: registeredDevice(),
    accountCreatorId: 'creator-123',
  });
  assert.equal(result.ok, true);
  assert.equal(result.certificateFingerprint, fingerprint);
  assert.equal(result.certificateCreatorId, 'creator-123');
}

{
  const result = inspectCertificateAccountBinding({
    certificate: certificate({ root: { publicKey: otherKey } }),
    sessionDeviceFingerprint: fingerprint,
    registeredDevice: registeredDevice(),
    accountCreatorId: 'creator-123',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CERTIFICATE_KEY_SESSION_MISMATCH');
}

{
  const result = inspectCertificateAccountBinding({
    certificate: certificate({
      identity: { devicePublicKeyFingerprint: otherFingerprint },
    }),
    sessionDeviceFingerprint: fingerprint,
    registeredDevice: registeredDevice(),
    accountCreatorId: 'creator-123',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CERTIFICATE_IDENTITY_KEY_MISMATCH');
}

{
  const cert = certificate();
  cert.meta.identity.identityFingerprint = '0'.repeat(64);
  const result = inspectCertificateAccountBinding({
    certificate: cert,
    sessionDeviceFingerprint: fingerprint,
    registeredDevice: registeredDevice(),
    accountCreatorId: 'creator-123',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CERTIFICATE_IDENTITY_FINGERPRINT_MISMATCH');
}

{
  const result = inspectCertificateAccountBinding({
    certificate: certificate(),
    sessionDeviceFingerprint: fingerprint,
    registeredDevice: registeredDevice({ public_key_json: otherKey }),
    accountCreatorId: 'creator-123',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'REGISTERED_DEVICE_KEY_MISMATCH');
}

{
  const result = inspectCertificateAccountBinding({
    certificate: certificate(),
    sessionDeviceFingerprint: fingerprint,
    registeredDevice: null,
    accountCreatorId: 'creator-123',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'REGISTERED_DEVICE_MISSING');
}

{
  const result = inspectCertificateAccountBinding({
    certificate: certificate({ identity: { creatorId: 'creator-other' } }),
    sessionDeviceFingerprint: fingerprint,
    registeredDevice: registeredDevice(),
    accountCreatorId: 'creator-123',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CERTIFICATE_CREATOR_ID_MISMATCH');
}

{
  const result = inspectCertificateAccountBinding({
    certificate: certificate(),
    sessionDeviceFingerprint: fingerprint,
    registeredDevice: registeredDevice(),
    accountCreatorId: '',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ACCOUNT_CREATOR_ID_MISSING');
}

console.log('Certificate account/device binding tests passed');
