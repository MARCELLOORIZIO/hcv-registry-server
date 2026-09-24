'use strict';

const crypto = require('crypto');

const HCV_ID = /^HCV-[A-F0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const CONSENT_VERSION = 'SIGILLUM_VERIFIED_ORIGINALS_CONSENT_2026-09-24_V1';
const TRUSTED_SCHEMA = 'SIGILLUM_TRUSTED_DERIVATION_V1';

function parseObject(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed : null;
  } catch (_) {
    return null;
  }
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function registryEligibility(certificateRow, provenanceRow, latestStatus) {
  if (!certificateRow || !provenanceRow) return null;
  const certificate = parseObject(certificateRow.certificate_raw);
  const provenance = parseObject(provenanceRow.provenance_raw);
  const status = String(
    latestStatus?.status || provenanceRow.registry_status || '',
  ).toUpperCase();
  const originalHash = certificate?.content?.hash;
  if (!certificate || !provenance ||
      provenance.type !== 'SIGILLUM_REGISTRY_PROVENANCE' ||
      provenance.version !== 2 ||
      provenance.status !== 'SIGILLUM_REGISTRY_VERIFIED' ||
      provenance.integrityValid !== true ||
      status !== 'ACTIVE' ||
      !HCV_ID.test(certificate?.meta?.hcvId || '') ||
      certificate.meta.hcvId !== certificateRow.hcv_id ||
      !SHA256.test(originalHash || '') ||
      provenance.contentSha256 !== originalHash) {
    return null;
  }
  return {certificate, provenance, originalHash, status};
}

function creatorOwns(eligibility, session) {
  if (!eligibility || !session?.accountId || !session?.creatorId) return false;
  return eligibility.certificate?.meta?.identity?.creatorId === session.creatorId &&
    eligibility.provenance.accountSubjectHash === hashText(session.accountId);
}

function platformReference(platform, platformPostId) {
  if (platform !== 'youtube' || !YOUTUBE_ID.test(platformPostId || '')) return null;
  return {
    platform: 'youtube',
    platformPostId,
    publicUrl: 'https://www.youtube.com/watch?v=' + platformPostId,
  };
}

function trustedDerivation(raw, expectedHcvId, expectedOutputHash, expectedParentHash) {
  const manifest = parseObject(raw);
  if (!manifest || manifest.schema !== TRUSTED_SCHEMA ||
      manifest.hcvId !== expectedHcvId ||
      manifest.parent?.kind !== 'original' ||
      manifest.parent?.sha256 !== expectedParentHash ||
      manifest.output?.sha256 !== expectedOutputHash ||
      !SHA256.test(manifest.output?.sha256 || '') ||
      manifest.output?.mediaType !== 'video' ||
      manifest.transform?.editorialImpact !== 'non_editorial' ||
      typeof manifest.transform?.operation !== 'string' ||
      manifest.transform.operation.length < 3 ||
      typeof manifest.signature !== 'string' ||
      manifest.signature.length < 32) {
    return null;
  }
  return manifest;
}

function sanitizeAuditMetadata(value) {
  const parsed = parseObject(value);
  if (!parsed) return {};
  const allowed = {};
  for (const key of ['workerVersion', 'platformRequestId', 'platformStatus',
    'platformVisibility', 'note']) {
    const item = parsed[key];
    if (typeof item === 'string' && item.length <= 256) allowed[key] = item;
  }
  return allowed;
}

function publicPublication(row, eligibility, consentRow) {
  if (!row || row.publication_status !== 'PUBLISHED' || !eligibility ||
      row.original_content_sha256 !== eligibility.originalHash ||
      row.derived_from !== eligibility.originalHash ||
      !SHA256.test(row.reference_sha256 || '') ||
      !consentRow || consentRow.state !== 'ACTIVE' ||
      consentRow.record_id !== row.consent_record_id ||
      consentRow.hcv_id !== row.hcv_id) {
    return null;
  }
  const reference = platformReference(row.platform, row.platform_post_id);
  if (!reference || reference.publicUrl !== row.public_url) return null;
  return {
    publicationId: row.publication_id,
    hcvId: row.hcv_id,
    platform: reference.platform,
    platformPostId: reference.platformPostId,
    publicUrl: reference.publicUrl,
    referenceSha256: row.reference_sha256,
    originalContentSha256: row.original_content_sha256,
    derivedFrom: row.derived_from,
    derivationType: row.derivation_type,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    publicationStatus: row.publication_status,
    consentVersion: row.consent_version,
    monetizationConsent: row.monetization_consent === 1,
    socialFileVerdict: 'NOT_VERIFIED',
    certificateVerdict: 'CERTIFICATE_RECORD_VERIFIED',
  };
}

module.exports = {
  HCV_ID, SHA256, CONSENT_VERSION, parseObject, hashText,
  registryEligibility, creatorOwns, platformReference, trustedDerivation,
  sanitizeAuditMetadata, publicPublication,
};
