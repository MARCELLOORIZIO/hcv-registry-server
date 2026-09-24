'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { authenticateRegistrySession } = require('./registry_certificate_security');
const { registryOriginal, createTrustedVideoRendition } =
  require('./trusted_derivation_v1');
const { publishTrustedVideoReference, deleteUploadedVideo, requiredServerConfig } =
  require('./youtube_publisher_v1');
const { registerPublicationRecord } = require('./verified_originals_v2_guard');
const { invalidatePlatformReceipt } = require('./verified_originals_platform_receipts');

const HCV_ID = /^HCV-[A-F0-9]{16}$/;
const MAX_BYTES = Number(process.env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES || 536870912);
const TMP_ROOT = process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP ||
  path.join(os.tmpdir(), 'sigillum-verified-originals');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'registry.db'));
db.pragma('busy_timeout = 5000');

function fail(code, statusCode = 400) {
  const error = new Error(code);
  error.statusCode = statusCode;
  throw error;
}

function send(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function safeBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function creatorOwnsOriginal(hcvId, session) {
  const original = registryOriginal(db, hcvId);
  const identity = original.verified.certificate?.meta?.identity;
  const creatorId = String(identity?.creatorId || '');
  if (!session?.creatorId || creatorId !== session.creatorId) {
    fail('CREATOR_OWNERSHIP_NOT_VERIFIED', 403);
  }
  return original;
}

function activeConsentForOwner(hcvId, consentRecordId, session) {
  const row = db.prepare(`
    SELECT *
    FROM verified_originals_consents
    WHERE record_id=? AND hcv_id=?
  `).get(consentRecordId, hcvId);
  if (!row || row.state !== 'ACTIVE' ||
      row.account_subject_hash !== crypto.createHash('sha256')
        .update(String(session.accountId)).digest('hex') ||
      row.creator_id !== session.creatorId ||
      row.publication_consent !== 1 ||
      row.rights_confirmed !== 1) {
    fail('ACTIVE_CREATOR_CONSENT_REQUIRED', 403);
  }
  return row;
}

async function streamToFile(req, destination, expectedSize) {
  const handle = await fs.promises.open(destination, 'wx', 0o600);
  const hash = crypto.createHash('sha256');
  let received = 0;
  let position = 0;

  try {
    for await (const rawChunk of req) {
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk);
      received += chunk.length;
      if (received > MAX_BYTES || received > expectedSize) {
        fail('ORIGINAL_UPLOAD_TOO_LARGE', 413);
      }
      hash.update(chunk);
      let written = 0;
      while (written < chunk.length) {
        const result = await handle.write(
          chunk,
          written,
          chunk.length - written,
          position + written,
        );
        if (!result.bytesWritten) fail('ORIGINAL_UPLOAD_WRITE_FAILED', 500);
        written += result.bytesWritten;
      }
      position += chunk.length;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (received !== expectedSize) fail('ORIGINAL_UPLOAD_SIZE_MISMATCH', 400);
  return {size: received, sha256: hash.digest('hex')};
}

async function cleanup(paths) {
  for (const item of paths) {
    if (!item) continue;
    try { await fs.promises.rm(item, {force: true}); } catch (_) {}
  }
}

async function orchestrate(req, hcvId, url) {
  if (!HCV_ID.test(hcvId)) fail('INVALID_HCV_ID', 400);
  if (String(req.headers['content-type'] || '').split(';')[0] !== 'video/mp4') {
    fail('ORIGINAL_MEDIA_TYPE_UNSUPPORTED', 415);
  }

  const contentLength = Number(req.headers['content-length']);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 ||
      contentLength > MAX_BYTES) {
    fail('ORIGINAL_CONTENT_LENGTH_INVALID', 411);
  }

  const consentRecordId = String(url.searchParams.get('consentRecordId') || '');
  const monetizeRaw = String(url.searchParams.get('monetizationEnabled') || '');
  const monetizationEnabled = safeBoolean(monetizeRaw);
  if (!consentRecordId || monetizationEnabled === null) {
    fail('PUBLISH_REQUEST_INVALID', 400);
  }

  const session = authenticateRegistrySession(
    db, req.headers.authorization, new Date(),
  );
  const original = creatorOwnsOriginal(hcvId, session);
  const consent = activeConsentForOwner(hcvId, consentRecordId, session);
  if (monetizationEnabled && consent.monetization_consent !== 1) {
    fail('MONETIZATION_NOT_AUTHORIZED', 403);
  }

  const expectedHash = original.verified.contentSha256;
  const expectedSize = original.verified.certificate.content.size;
  if (contentLength !== expectedSize) fail('ORIGINAL_UPLOAD_SIZE_MISMATCH', 400);

  const keyId = String(process.env.SIGILLUM_DERIVATION_KEY_ID || '');
  const privateKeyPem = String(process.env.SIGILLUM_DERIVATION_PRIVATE_KEY_PEM || '');
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(keyId) || !privateKeyPem) {
    fail('DERIVATION_SERVICE_NOT_CONFIGURED', 503);
  }

  const youtubeConfig = requiredServerConfig();
  await fs.promises.mkdir(TMP_ROOT, {recursive: true, mode: 0o700});
  const jobDir = await fs.promises.mkdtemp(path.join(TMP_ROOT, 'job-'));
  const originalPath = path.join(jobDir, 'original.mp4');
  const derivedPath = path.join(jobDir, 'reference.mp4');
  const manifestPath = derivedPath + '.hcvderivation.json';

  try {
    const uploaded = await streamToFile(req, originalPath, expectedSize);
    if (uploaded.sha256 !== expectedHash) {
      fail('DERIVATION_ORIGINAL_SHA_MISMATCH', 422);
    }

    const manifest = createTrustedVideoRendition({
      db,
      hcvId,
      originalPath,
      outputPath: derivedPath,
      privateKeyPem,
      keyId,
    });

    const published = await publishTrustedVideoReference({
      db,
      filePath: derivedPath,
      hcvId,
      config: youtubeConfig,
    });

    if (!published.publicationReady) {
      fail(published.reason || 'YOUTUBE_PUBLICATION_NOT_READY', 502);
    }

    try {
      return registerPublicationRecord({
        hcvId,
        consentRecordId,
        trustedDerivativeSha256: manifest.output.sha256,
        platform: 'youtube',
        platformPostId: published.platformPostId,
        monetizationEnabled,
        auditMetadata: {
          workerVersion: 'secure_ingest_orchestrator_v1',
          platformStatus: published.status.processingStatus,
          platformVisibility: published.status.privacyStatus,
        },
      });
    } catch (registrationError) {
      try {
        await deleteUploadedVideo({
          config: youtubeConfig,
          videoId: published.platformPostId,
        });
      } catch (_) {}
      try {
        invalidatePlatformReceipt({
          platform: 'youtube',
          platformPostId: published.platformPostId,
          reason: 'registration_failed',
        });
      } catch (_) {}
      throw registrationError;
    }
  } finally {
    await cleanup([manifestPath, derivedPath, originalPath]);
    try { await fs.promises.rmdir(jobDir); } catch (_) {}
  }
}

async function handle(req, res) {
  if (req.method !== 'POST') return false;
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const match = /^\/api\/verified-originals\/publish\/(HCV-[A-F0-9]{16})$/
    .exec(url.pathname);
  if (!match) return false;

  try {
    const result = await orchestrate(req, match[1], url);
    send(res, 201, result);
  } catch (error) {
    send(res, error.statusCode || 500, {
      ok: false,
      error: error.statusCode ? error.message : 'SECURE_INGEST_UNAVAILABLE',
    });
  }
  return true;
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function secureIngestCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer((req, res) => {
    Promise.resolve(handle(req, res)).then(handled => {
      if (!handled) return listener(req, res);
    }).catch(() => {
      send(res, 500, {ok:false, error:'SECURE_INGEST_UNAVAILABLE'});
    });
  });
};

module.exports = {
  handle,
  orchestrate,
  streamToFile,
};
