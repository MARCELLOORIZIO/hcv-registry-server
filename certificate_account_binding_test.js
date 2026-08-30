const assert = require('assert');
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

function certificate(overrides = {}) {
  return {
    publicKey: deviceKey,
    meta: {
      identity: {
        creatorId: 'creator-123',
        devicePublicKeyFingerprint: fingerprint,
        publicKey: deviceKey,
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
  assert.equal(result.needsCreatorIdBind, false);
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
  assert.equal(result.ok, true);
  assert.equal(result.needsCreatorIdBind, true);
  assert.equal(result.certificateCreatorId, 'creator-123');
}

console.log('Certificate account/device binding tests passed');
