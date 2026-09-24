'use strict';

const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const SHA256 = /^[a-f0-9]{64}$/;
const HCV_ID = /^HCV-[A-F0-9]{16}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'registry.db'));
db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS verified_originals_platform_receipts (
  receipt_id TEXT PRIMARY KEY,
  hcv_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_post_id TEXT NOT NULL,
  uploaded_sha256 TEXT NOT NULL,
  upload_session_hash TEXT NOT NULL,
  processing_status TEXT NOT NULL,
  visibility TEXT NOT NULL,
  publisher_subject_hash TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  metadata_raw TEXT NOT NULL DEFAULT '{}',
  UNIQUE(platform, platform_post_id)
);
CREATE INDEX IF NOT EXISTS verified_originals_platform_receipts_hcv_idx
  ON verified_originals_platform_receipts(hcv_id, verified_at);
`);

const insertReceipt = db.prepare(`
INSERT INTO verified_originals_platform_receipts
(receipt_id,hcv_id,platform,platform_post_id,uploaded_sha256,
 upload_session_hash,processing_status,visibility,publisher_subject_hash,
 verified_at,metadata_raw)
VALUES (?,?,?,?,?,?,?,?,?,?,?)
`);

const getReceipt = db.prepare(`
SELECT * FROM verified_originals_platform_receipts
WHERE platform=? AND platform_post_id=?
`);

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const key of ['uploadProtocol', 'youtubeEtag', 'processingFailureReason',
    'privacyStatus', 'note']) {
    if (typeof value[key] === 'string' && value[key].length <= 512) {
      result[key] = value[key];
    }
  }
  return result;
}

function recordVerifiedPlatformReceipt({
  hcvId,
  platform,
  platformPostId,
  uploadedSha256,
  uploadSessionHash,
  processingStatus,
  visibility,
  publisherSubjectHash,
  metadata = {},
  verifiedAt = new Date().toISOString(),
}) {
  if (!HCV_ID.test(hcvId || '') ||
      platform !== 'youtube' ||
      !YOUTUBE_ID.test(platformPostId || '') ||
      !SHA256.test(uploadedSha256 || '') ||
      !SHA256.test(uploadSessionHash || '') ||
      !SHA256.test(publisherSubjectHash || '') ||
      processingStatus !== 'succeeded' ||
      visibility !== 'public' ||
      !Number.isFinite(Date.parse(verifiedAt))) {
    throw new Error('PLATFORM_RECEIPT_NOT_VERIFIED');
  }

  const receiptId = crypto.randomUUID();
  insertReceipt.run(
    receiptId, hcvId, platform, platformPostId, uploadedSha256,
    uploadSessionHash, processingStatus, visibility, publisherSubjectHash,
    verifiedAt, JSON.stringify(normalizeMetadata(metadata)),
  );
  return {
    receiptId,
    hcvId,
    platform,
    platformPostId,
    uploadedSha256,
    processingStatus,
    visibility,
    verifiedAt,
  };
}

function getVerifiedPlatformReceipt({
  hcvId,
  platform,
  platformPostId,
  expectedSha256,
}) {
  if (!HCV_ID.test(hcvId || '') ||
      platform !== 'youtube' ||
      !YOUTUBE_ID.test(platformPostId || '') ||
      !SHA256.test(expectedSha256 || '')) {
    return null;
  }
  const row = getReceipt.get(platform, platformPostId);
  if (!row ||
      row.hcv_id !== hcvId ||
      row.uploaded_sha256 !== expectedSha256 ||
      row.processing_status !== 'succeeded' ||
      row.visibility !== 'public' ||
      !SHA256.test(row.upload_session_hash || '') ||
      !SHA256.test(row.publisher_subject_hash || '')) {
    return null;
  }
  return row;
}

module.exports = {
  recordVerifiedPlatformReceipt,
  getVerifiedPlatformReceipt,
};
