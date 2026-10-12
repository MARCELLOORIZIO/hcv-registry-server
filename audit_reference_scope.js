'use strict';

// Non-privileged policy for a supervised, explicitly scoped reference audit.
// This module never authorizes R2 access: real media reads must still pass
// the existing authenticated POST read-authorization and single-use GET path.
const crypto = require('crypto');

const HCV = /^HCV-[A-F0-9]{16}$/;
const ALLOWED_TYPES = new Set(['PHOTO_DISPLAY_CONFLICT','VIDEO_INITIAL_WINDOW','REFERENCE_MISSING']);
const MAX_CASES = 25;

function policyError(code) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = 403;
  return error;
}

function normalizeAuditScope({ hcvIds, purpose, expiresAt, approvedBy } = {}, now = Date.now()) {
  if (!Array.isArray(hcvIds) || hcvIds.length < 1 || hcvIds.length > MAX_CASES) {
    throw policyError('AUDIT_SCOPE_INVALID_COUNT');
  }
  if (hcvIds.some(v => typeof v !== 'string' || !HCV.test(v))) {
    throw policyError('AUDIT_SCOPE_INVALID_HCV_ID');
  }
  const unique = [...new Set(hcvIds)];
  if (unique.length !== hcvIds.length) throw policyError('AUDIT_SCOPE_DUPLICATE_HCV_ID');
  if (!ALLOWED_TYPES.has(purpose)) throw policyError('AUDIT_SCOPE_INVALID_PURPOSE');
  // The approver is a trusted authenticated principal supplied by backend,
  // not arbitrary text from an API client.
  if (!approvedBy || typeof approvedBy !== 'string') {
    throw policyError('AUDIT_SCOPE_APPROVER_REQUIRED');
  }
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || expiry - now > 15 * 60 * 1000) {
    throw policyError('AUDIT_SCOPE_EXPIRY_INVALID');
  }
  return Object.freeze({
    hcvIds: Object.freeze([...unique].sort()),
    purpose,
    approvedBy,
    expiresAt: new Date(expiry).toISOString(),
    readOnly: true,
  });
}

function assertAuditReferenceEligible(scope, { hcvId, ownerAccountId, requestingAccountId, state, provider }, now = Date.now()) {
  if (!scope || scope.readOnly !== true ||
      Date.parse(scope.expiresAt) <= now ||
      !scope.hcvIds.includes(hcvId)) {
    throw policyError('AUDIT_REFERENCE_OUT_OF_SCOPE');
  }
  if (!ownerAccountId || !requestingAccountId ||
      ownerAccountId !== requestingAccountId) {
    throw policyError('AUDIT_REFERENCE_OWNER_MISMATCH');
  }
  if (state !== 'COMMITTED' || provider !== 'r2') {
    throw policyError('AUDIT_REFERENCE_NOT_AVAILABLE');
  }
  // No plaintext, tokens, R2 keys or secrets returned.
  return Object.freeze({ hcvId, eligible: true, existingAuthRequired: true });
}

function auditEventDigest({ hcvId, purpose, principalId, timestamp }) {
  return crypto.createHash('sha256')
    .update([hcvId,purpose,principalId,timestamp].join('\n')).digest('hex');
}

module.exports = {
  MAX_CASES, normalizeAuditScope, assertAuditReferenceEligible,
  auditEventDigest, policyError,
};
