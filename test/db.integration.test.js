'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  pool,
  initSchema,
  publicKeysEqual,
  upsertAccountAndDevice,
  upsertKycSession,
  getLatestKycByDevice,
  getLatestKycByAccount,
  storeCertificateImmutable,
  getCertificate,
} = require('../db');
const { accountIdForDeviceFingerprint } = require('../identity_policy');

const fingerprint = crypto.createHash('sha256').update('ci-device').digest('hex');
const accountId = accountIdForDeviceFingerprint(fingerprint);
const publicKey = { modulus: 'AQID', exponent: 'AQAB' };
const sessionId = `vs_ci_${Date.now()}`;
const hcvId = `HCV-CI${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
const certificateRaw = `{
  "format": "HCV_CERTIFICATE",
  "meta": {"hcvId": "${hcvId}"},
  "content": {"hash": "${'b'.repeat(64)}"}
}`;

async function resetRows() {
  await pool.query('DELETE FROM audit_events');
  await pool.query('DELETE FROM certificates');
  await pool.query('DELETE FROM kyc_sessions');
  await pool.query('DELETE FROM devices');
  await pool.query('DELETE FROM accounts');
}

test.before(async () => {
  await initSchema();
  await resetRows();
});

test.after(async () => {
  await resetRows();
  await pool.end();
});

test('compares RSA keys independently of JSON property order', () => {
  assert.equal(
    publicKeysEqual(
      { exponent: publicKey.exponent, modulus: publicKey.modulus },
      { modulus: publicKey.modulus, exponent: publicKey.exponent },
    ),
    true,
  );
  assert.equal(
    publicKeysEqual(publicKey, { ...publicKey, modulus: 'DIFFERENT' }),
    false,
  );
});

test('persists an account, its signing device and KYC state', async () => {
  const binding = await upsertAccountAndDevice({
    accountId,
    creatorName: 'CI Creator',
    deviceKeyFingerprint: fingerprint,
    publicKey,
  });
  assert.equal(binding.accountId, accountId);

  await upsertKycSession({
    sessionId,
    accountId,
    status: 'verified',
    verifiedOutputs: {
      legalName: 'CI Verified Creator',
      country: 'IT',
    },
  });

  const byDevice = await getLatestKycByDevice(fingerprint);
  const byAccount = await getLatestKycByAccount(accountId);
  assert.equal(byDevice.session_id, sessionId);
  assert.equal(byDevice.status, 'verified');
  assert.equal(byDevice.verified_outputs.legalName, 'CI Verified Creator');
  assert.equal(byAccount.session_id, sessionId);
});

test('certificate storage is byte-preserving, idempotent and immutable', async () => {
  const first = await storeCertificateImmutable({
    hcvId,
    certificateSha256: 'a'.repeat(64),
    certificateRaw,
    signerFingerprint: fingerprint,
    contentHash: 'b'.repeat(64),
  });
  assert.deepEqual(first, { created: true, idempotent: false });

  const retry = await storeCertificateImmutable({
    hcvId,
    certificateSha256: 'a'.repeat(64),
    certificateRaw,
    signerFingerprint: fingerprint,
    contentHash: 'b'.repeat(64),
  });
  assert.deepEqual(retry, { created: false, idempotent: true });

  await assert.rejects(
    () => storeCertificateImmutable({
      hcvId,
      certificateSha256: 'c'.repeat(64),
      certificateRaw: certificateRaw.replace('HCV_CERTIFICATE', 'DIFFERENT'),
      signerFingerprint: fingerprint,
      contentHash: 'd'.repeat(64),
    }),
    /HCV_ID_ALREADY_EXISTS_WITH_DIFFERENT_CERTIFICATE/,
  );

  const stored = await getCertificate(hcvId);
  assert.equal(stored.certificate_sha256, 'a'.repeat(64));
  assert.equal(stored.certificate_raw, certificateRaw);
});
