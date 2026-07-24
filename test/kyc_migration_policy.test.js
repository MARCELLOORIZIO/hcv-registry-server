'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeLegalName,
  evaluateLegacyKycMigration,
} = require('../kyc_migration_policy');

test('normalizes harmless Unicode and whitespace differences in legal names', () => {
  assert.equal(
    normalizeLegalName('  MARCELLO   ORIZIO  '),
    normalizeLegalName('Marcello Orizio'),
  );
});

test('matching account does not require legacy migration', () => {
  assert.deepEqual(
    evaluateLegacyKycMigration({
      sessionAccountId: 'ACC-CURRENT',
      targetAccountId: 'ACC-CURRENT',
      status: 'processing',
      verifiedLegalName: '',
      claimedLegalName: '',
    }),
    { legacyMigration: false },
  );
});

test('verified legacy account with matching legal name may migrate', () => {
  const result = evaluateLegacyKycMigration({
    sessionAccountId: 'legacy-random-creator-id',
    targetAccountId: 'ACC-DETERMINISTIC',
    status: 'verified',
    verifiedLegalName: 'Marcello Orizio',
    claimedLegalName: '  MARCELLO   ORIZIO ',
  });
  assert.equal(result.legacyMigration, true);
  assert.equal(result.sourceAccountId, 'legacy-random-creator-id');
  assert.equal(result.targetAccountId, 'ACC-DETERMINISTIC');
});

test('unverified legacy session cannot migrate', () => {
  assert.throws(
    () => evaluateLegacyKycMigration({
      sessionAccountId: 'legacy-random-creator-id',
      targetAccountId: 'ACC-DETERMINISTIC',
      status: 'processing',
      verifiedLegalName: 'Marcello Orizio',
      claimedLegalName: 'Marcello Orizio',
    }),
    /KYC_LEGACY_SESSION_NOT_VERIFIED/,
  );
});

test('legacy migration rejects missing or different legal name', () => {
  assert.throws(
    () => evaluateLegacyKycMigration({
      sessionAccountId: 'legacy-random-creator-id',
      targetAccountId: 'ACC-DETERMINISTIC',
      status: 'verified',
      verifiedLegalName: 'Marcello Orizio',
      claimedLegalName: '',
    }),
    /KYC_LEGACY_LEGAL_NAME_REQUIRED/,
  );
  assert.throws(
    () => evaluateLegacyKycMigration({
      sessionAccountId: 'legacy-random-creator-id',
      targetAccountId: 'ACC-DETERMINISTIC',
      status: 'verified',
      verifiedLegalName: 'Marcello Orizio',
      claimedLegalName: 'Different Person',
    }),
    /KYC_LEGACY_IDENTITY_MISMATCH/,
  );
});
