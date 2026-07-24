'use strict';

function normalizeDeviceFingerprint(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    const error = new Error('DEVICE_FINGERPRINT_INVALID');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function accountIdForDeviceFingerprint(value) {
  return `ACC-${normalizeDeviceFingerprint(value).toUpperCase()}`;
}

function assertAccountMatchesDevice(accountId, deviceKeyFingerprint) {
  const expected = accountIdForDeviceFingerprint(deviceKeyFingerprint);
  if (String(accountId || '').trim() !== expected) {
    const error = new Error('ACCOUNT_DEVICE_BINDING_MISMATCH');
    error.statusCode = 409;
    throw error;
  }
  return expected;
}

module.exports = {
  normalizeDeviceFingerprint,
  accountIdForDeviceFingerprint,
  assertAccountMatchesDevice,
};
