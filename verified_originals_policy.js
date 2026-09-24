'use strict';

const crypto = require('crypto');
const HCV_ID = /^HCV-[A-F0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function youtubeUrl(videoId) {
  if (typeof videoId !== 'string' || !YOUTUBE_ID.test(videoId)) {
    throw Object.assign(new Error('YOUTUBE_VIDEO_ID_INVALID'), {statusCode: 400});
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}
function parseConsent(payload) {
  if (!payload || payload.allowPublication !== true ||
      typeof payload.allowMonetization !== 'boolean' ||
      payload.rightsConfirmed !== true || payload.publicVisibilityAcknowledged !== true) {
    throw Object.assign(new Error('EXPLICIT_CONSENT_REQUIRED'), {statusCode: 400});
  }
  return {allowMonetization: payload.allowMonetization};
}
function assertSha(value, name) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw Object.assign(new Error(`${name}_INVALID`), {statusCode: 400});
  }
  return value;
}
function accountSubjectHash(accountId) {
  return crypto.createHash('sha256').update(String(accountId), 'utf8').digest('hex');
}
function activeProvenance(provenanceRaw, registryStatus) {
  try {
    const p = JSON.parse(provenanceRaw);
    return p?.type === 'SIGILLUM_REGISTRY_PROVENANCE' &&
      p.version === 2 && p.status === 'SIGILLUM_REGISTRY_VERIFIED' &&
      p.integrityValid === true && registryStatus === 'ACTIVE' ? p : null;
  } catch (_) {return null;}
}
function assertHcvId(hcvId) {
  if (!HCV_ID.test(String(hcvId))) {
    throw Object.assign(new Error('HCV_ID_INVALID'), {statusCode: 400});
  }
  return hcvId;
}
module.exports = { youtubeUrl, parseConsent, assertSha, accountSubjectHash,
  activeProvenance, assertHcvId };