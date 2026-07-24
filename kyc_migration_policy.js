'use strict';

function normalizeLegalName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

function evaluateLegacyKycMigration({
  sessionAccountId,
  targetAccountId,
  status,
  verifiedLegalName,
  claimedLegalName,
}) {
  const sourceAccount = String(sessionAccountId || '').trim();
  const destinationAccount = String(targetAccountId || '').trim();

  if (!sourceAccount || sourceAccount === destinationAccount) {
    return { legacyMigration: false };
  }

  if (String(status || '') !== 'verified') {
    const error = new Error('KYC_LEGACY_SESSION_NOT_VERIFIED');
    error.statusCode = 409;
    throw error;
  }

  const verified = normalizeLegalName(verifiedLegalName);
  const claimed = normalizeLegalName(claimedLegalName);
  if (!verified || !claimed) {
    const error = new Error('KYC_LEGACY_LEGAL_NAME_REQUIRED');
    error.statusCode = 409;
    throw error;
  }
  if (verified !== claimed) {
    const error = new Error('KYC_LEGACY_IDENTITY_MISMATCH');
    error.statusCode = 409;
    throw error;
  }

  return {
    legacyMigration: true,
    sourceAccountId: sourceAccount,
    targetAccountId: destinationAccount,
    normalizedLegalName: verified,
  };
}

module.exports = {
  normalizeLegalName,
  evaluateLegacyKycMigration,
};
