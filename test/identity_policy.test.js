'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDeviceFingerprint,
  accountIdForDeviceFingerprint,
  assertAccountMatchesDevice,
} = require('../identity_policy');

const fingerprint = 'a'.repeat(64);

test('normalizes a valid SHA-256 device fingerprint', () => {
  assert.equal(normalizeDeviceFingerprint(fingerprint.toUpperCase()), fingerprint);
});

test('derives a stable account id from the complete fingerprint', () => {
  assert.equal(
    accountIdForDeviceFingerprint(fingerprint),
    `ACC-${fingerprint.toUpperCase()}`,
  );
});

test('rejects account ids not bound to the signing device', () => {
  assert.throws(
    () => assertAccountMatchesDevice('ACC-OTHER', fingerprint),
    /ACCOUNT_DEVICE_BINDING_MISMATCH/,
  );
});

test('accepts only the deterministic account id for the signing device', () => {
  const expected = accountIdForDeviceFingerprint(fingerprint);
  assert.equal(assertAccountMatchesDevice(expected, fingerprint), expected);
});
