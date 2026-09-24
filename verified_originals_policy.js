'use strict';

const ID = /^HCV-[A-F0-9]{16}$/;
const HASH = /^[a-f0-9]{64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const crypto = require('node:crypto');
const ACCOUNT_HASH = /^[a-f0-9]{64}$/;

function parseObject(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) { return null; }
}

function eligibleCertificate(cert, provenance, latestStatus) {
  if (!cert || !provenance) return false;
  const p = parseObject(provenance.provenance_raw);
  const status = String(latestStatus?.status || provenance.registry_status || 'ACTIVE').toUpperCase();
  return p?.type === 'SIGILLUM_REGISTRY_PROVENANCE' &&
    p.version === 2 &&
    p.status === 'SIGILLUM_REGISTRY_VERIFIED' &&
    p.integrityValid === true &&
    status === 'ACTIVE';
}

function checkCreatorConsentRequest(payload, certificate, provenance, latestStatus, session) {
  if (!payload || !ID.test(payload.hcvId || '')) return 'INVALID_HCV_ID';
  if (!eligibleCertificate(certificate, provenance, latestStatus)) return 'CERTIFICATE_NOT_ELIGIBLE';
  const cert = parseObject(certificate.certificate_raw);
  const p = parseObject(provenance.provenance_raw);
  const accountHash = session?.accountId
    ? crypto.createHash('sha256').update(String(session.accountId)).digest('hex') : '';
  if (!ACCOUNT_HASH.test(accountHash) || accountHash !== p?.accountSubjectHash ||
      !session?.creatorId || session.creatorId !== cert?.meta?.identity?.creatorId) {
    return 'CREATOR_OWNERSHIP_NOT_VERIFIED';
  }
  if (payload.originalSha256 !== cert?.content?.hash ||
      !HASH.test(payload.originalSha256 || '')) return 'ORIGINAL_HASH_MISMATCH';
  if (payload.intent !== 'PUBLISH_VERIFIED_ORIGINAL' ||
      payload.publishReference !== true) return 'EXPLICIT_PUBLICATION_CONSENT_REQUIRED';
  if (payload.monetize !== true && payload.monetize !== false) {
    return 'MONETIZATION_CONSENT_MISSING';
  }
  if (payload.rightsConfirmed !== true) return 'RIGHTS_NOT_CONFIRMED';
  return null;
}

function checkPublication(payload, certificate, provenance, latestStatus, storedConsent) {
  if (!payload || !ID.test(payload.hcvId || '')) return 'INVALID_HCV_ID';
  if (!eligibleCertificate(certificate, provenance, latestStatus)) return 'CERTIFICATE_NOT_ELIGIBLE';
  const cert = parseObject(certificate.certificate_raw);
  const originalHash = cert?.content?.hash;
  if (!HASH.test(originalHash || '') || payload.originalSha256 !== originalHash) return 'ORIGINAL_HASH_MISMATCH';
  if (!HASH.test(payload.renditionSha256 || '')) return 'INVALID_RENDITION_HASH';
  // A SHA256 is only an asserted digest until the trusted publishing worker
  // actually hashes the bytes of the rendition it generated and uploaded.
  if (!payload.pipelineVerified || payload.pipelineVerified !== true ||
      !HASH.test(payload.uploadedAssetSha256 || '') ||
      payload.uploadedAssetSha256 !== payload.renditionSha256) return 'UNVERIFIED_PIPELINE';
  if (!VIDEO_ID.test(payload.youtubeVideoId || '')) return 'INVALID_YOUTUBE_ID';
  const c = payload.consent;
  if (!c || c.publishReference !== true || c.version !== 1 ||
      c.hcvId !== payload.hcvId || c.originalSha256 !== originalHash ||
      typeof c.creatorSubject !== 'string' || c.creatorSubject.length < 3 ||
      c.creatorSubject.length > 128 ||
      c.creatorSubject !== cert?.meta?.identity?.creatorId || !Number.isFinite(Date.parse(c.grantedAt || '')) ||
      typeof c.recordId !== 'string' || c.recordId.length < 12 || c.recordId.length > 128) {
    return 'CONSENT_NOT_BOUND';
  }
  if (c.monetize !== true && c.monetize !== false) return 'MONETIZATION_CONSENT_MISSING';
  // A publisher's JSON declaration is NEVER creator consent. It must match
  // an active, server-issued consent registered under the creator's session.
  const saved = parseObject(storedConsent?.consent_raw);
  if (!storedConsent || storedConsent.state !== 'ACTIVE' ||
      !saved || !ACCOUNT_HASH.test(storedConsent.account_subject_hash || '') ||
      saved.recordId !== c.recordId || saved.hcvId !== c.hcvId ||
      saved.originalSha256 !== c.originalSha256 ||
      saved.creatorSubject !== c.creatorSubject ||
      saved.grantedAt !== c.grantedAt ||
      saved.publishReference !== true || saved.monetize !== c.monetize ||
      saved.rightsConfirmed !== true ||
      storedConsent.hcv_id !== c.hcvId ||
      storedConsent.record_id !== c.recordId) return 'CREATOR_CONSENT_NOT_AUTHENTICATED';
  const p = parseObject(provenance.provenance_raw);
  if (p?.accountSubjectHash !== storedConsent.account_subject_hash ||
      p?.creatorId !== saved.creatorSubject) return 'CREATOR_CONSENT_NOT_AUTHENTICATED';
  if (payload.rightsConfirmed !== true) return 'RIGHTS_NOT_CONFIRMED';
  if (typeof payload.pipelineAuditId !== 'string' || payload.pipelineAuditId.length < 12 ||
      payload.pipelineAuditId.length > 128) return 'AUDIT_MISSING';
  return null;
}

function publicReference(row, certificate, provenance, latestStatus, storedConsent) {
  if (!row || row.state !== 'PUBLISHED' ||
      !eligibleCertificate(certificate, provenance, latestStatus)) return null;
  const cert = parseObject(certificate.certificate_raw);
  if (cert?.content?.hash !== row.original_sha256 || !HASH.test(row.rendition_sha256 || '') ||
      !VIDEO_ID.test(row.youtube_video_id || '')) return null;
  const consent = parseObject(row.consent_raw);
  if (!consent || consent.publishReference !== true ||
      consent.hcvId !== row.hcv_id || consent.originalSha256 !== row.original_sha256) return null;
  const saved = parseObject(storedConsent?.consent_raw);
  if (!storedConsent || storedConsent.state !== 'ACTIVE' ||
      storedConsent.hcv_id !== row.hcv_id ||
      storedConsent.record_id !== consent.recordId ||
      !saved || saved.recordId !== consent.recordId ||
      saved.hcvId !== row.hcv_id ||
      saved.originalSha256 !== row.original_sha256 ||
      saved.publishReference !== true || saved.rightsConfirmed !== true ||
      saved.monetize !== consent.monetize ||
      parseObject(provenance.provenance_raw)?.accountSubjectHash !==
        storedConsent.account_subject_hash) return null;
  return {
    hcvId: row.hcv_id,
    availability: 'REFERENCE_AVAILABLE',
    youtubeUrl: 'https://www.youtube.com/watch?v=' + row.youtube_video_id,
    originalSha256: row.original_sha256,
    renditionSha256: row.rendition_sha256,
    publishedAt: row.published_at,
    certificateVerdict: 'CERTIFICATE_RECORD_VERIFIED',
    socialFileVerdict: 'NOT_VERIFIED',
    note: 'Reference link does not authenticate the file viewed on another social platform.'
  };
}

module.exports = { checkCreatorConsentRequest, checkPublication, eligibleCertificate, publicReference };
