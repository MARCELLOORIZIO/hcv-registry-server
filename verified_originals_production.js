'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);

const HCV_ID = /^HCV-[A-F0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const DERIVATION_SCHEMA = 'SIGILLUM_TRUSTED_DERIVATION_V1';
const DERIVATION_OPERATION = 'video_transcode_h264_aac_v1';
const PHOTO_DERIVATION_OPERATION = 'photo_to_reference_video_v1';
const CAPTURE_PROVENANCE_TYPE = 'SIGILLUM_CAPTURE_PROVENANCE_BINDING';
const CAPTURE_PROVENANCE_PIPELINE = 'HCV_CAPTURE_BINDING_V1';
const DERIVATION_SIGNATURE_ALGORITHM = 'RSA-SHA256-PKCS1V15';
const CONSENT_VERSION = 'SIGILLUM_VERIFIED_ORIGINALS_CONSENT_2026-09-25_V2';
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

function hashBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashString(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function canonicalYoutubeReference(videoId) {
  if (!YOUTUBE_ID.test(videoId || '')) return null;
  return {
    platform: 'youtube',
    platformPostId: videoId,
    publicUrl: 'https://www.youtube.com/watch?v=' + videoId,
  };
}

function strictBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function certificateRsaPublicKey(certificate) {
  const publicKey = certificate?.publicKey;
  const modulus = String(publicKey?.modulus || '');
  const exponent = String(publicKey?.exponent || '');
  if (!modulus || !exponent) return null;
  try {
    const key = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: Buffer.from(modulus, 'base64').toString('base64url'),
        e: Buffer.from(exponent, 'base64').toString('base64url'),
      },
      format: 'jwk',
    });
    if (key.asymmetricKeyType !== 'rsa' ||
        key.asymmetricKeyDetails?.modulusLength < 2048) return null;
    return key;
  } catch (_) {
    return null;
  }
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function configuredFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return require('ffmpeg-static');
  } catch (_) {
    return '/usr/bin/ffmpeg';
  }
}

function parsePinnedDerivationKeys() {
  const raw = String(process.env.SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON || '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const result = {};
    for (const [keyId, pemValue] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9._-]{3,80}$/.test(keyId) ||
          typeof pemValue !== 'string' || !pemValue) return null;
      const pem = pemValue.replace(/\\n/g, '\n');
      const key = crypto.createPublicKey(pem);
      if (key.asymmetricKeyType !== 'rsa' ||
          key.asymmetricKeyDetails?.modulusLength < 2048) return null;
      result[keyId] = pem;
    }
    return Object.keys(result).length ? result : null;
  } catch (_) {
    return null;
  }
}

function verifyDerivationManifest({
  manifest,
  certificateRaw,
  trustedKeys,
  verifyCertificateRaw,
}) {
  try {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
        !trustedKeys || manifest.schema !== DERIVATION_SCHEMA ||
        !HCV_ID.test(manifest.hcvId)) return false;

    const { signature, ...statement } = manifest;
    if (Object.keys(statement).length !== 8 ||
        typeof signature !== 'string' || !signature) return false;

    const certificate = verifyCertificateRaw(certificateRaw, manifest.hcvId);
    const contentHash = String(certificate?.content?.hash || '').toLowerCase();
    const contentType = String(certificate?.content?.type || '');
    const expectedOperation = contentType === 'video'
      ? DERIVATION_OPERATION
      : contentType === 'photo'
        ? PHOTO_DERIVATION_OPERATION
        : null;
    if (!expectedOperation ||
        !SHA256.test(contentHash) ||
        statement.parent?.kind !== 'original' ||
        statement.parent?.sha256 !== contentHash ||
        statement.parent?.signedCertificateDigest !== hashString(certificateRaw) ||
        statement.output?.mediaType !== 'video' ||
        !Number.isSafeInteger(statement.output?.byteLength) ||
        statement.output.byteLength <= 0 ||
        !SHA256.test(statement.output?.sha256 || '') ||
        statement.output.sha256 === contentHash ||
        statement.transform?.operation !== expectedOperation ||
        statement.transform?.editorialImpact !== 'non_editorial' ||
        statement.transform?.policyVersion !== 'SIGILLUM_NON_EDITORIAL_V1' ||
        statement.issuer?.signatureAlgorithm !== DERIVATION_SIGNATURE_ALGORITHM ||
        !/^[A-Za-z0-9._-]{3,80}$/.test(statement.issuer?.keyId || '') ||
        !/^[0-9a-f-]{36}$/i.test(statement.nonce || '') ||
        !Number.isFinite(Date.parse(statement.createdAt))) {
      return false;
    }

    const pem = trustedKeys[statement.issuer.keyId];
    if (!pem) return false;
    const publicKey = crypto.createPublicKey(pem);
    if (publicKey.asymmetricKeyType !== 'rsa' ||
        publicKey.asymmetricKeyDetails?.modulusLength < 2048) return false;

    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(JSON.stringify(statement), 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch (_) {
    return false;
  }
}

function createVerifiedOriginalsProduction({
  pool,
  authenticate,
  accountEnvelope,
  requireCreatorAccess,
  verifyCertificateRaw,
  provenanceEnvelopeFromRow,
  sendJson,
  sendHtml,
  publicError,
  readJson,
  securityEvent,
  fetchImpl = global.fetch,
  sleep = sleepMs,
  ffmpegPath = configuredFfmpegPath(),
} = {}) {
  for (const [name, value] of Object.entries({
    pool,
    authenticate,
    accountEnvelope,
    requireCreatorAccess,
    verifyCertificateRaw,
    provenanceEnvelopeFromRow,
    sendJson,
    sendHtml,
    publicError,
    readJson,
  })) {
    if (!value) throw new Error('VERIFIED_ORIGINALS_DEPENDENCY_MISSING_' + name);
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('VERIFIED_ORIGINALS_FETCH_UNAVAILABLE');
  }

  const fail = (code, status = 400, message) => {
    throw publicError(code, status, message);
  };

  let takedownTimer = null;

  function verifyHcvpackBindingSignature(req, original, hcvId, hcvpackSha256) {
    if (String(req.headers['x-sigillum-hcvpack-binding-version'] || '') !== '1') {
      return false;
    }
    const signature = String(req.headers['x-sigillum-hcvpack-signature'] || '');
    if (!signature) return false;
    const publicKey = certificateRsaPublicKey(original.certificate);
    if (!publicKey) return false;
    const statement =
      'SIGILLUM_HCVPACK_BINDING_V1|' + hcvId + '|' +
      original.contentHash + '|' + hcvpackSha256;
    try {
      return crypto.verify(
        'RSA-SHA256',
        Buffer.from(statement, 'utf8'),
        publicKey,
        Buffer.from(signature, 'base64'),
      );
    } catch (_) {
      return false;
    }
  }

  function youtubeServiceConfigured() {
    return Boolean(
      process.env.YOUTUBE_CLIENT_ID &&
      process.env.YOUTUBE_CLIENT_SECRET &&
      process.env.YOUTUBE_REFRESH_TOKEN &&
      YOUTUBE_CHANNEL_ID.test(String(process.env.YOUTUBE_CHANNEL_ID || '')),
    );
  }

  async function initSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS verified_originals_consents (
        record_id TEXT PRIMARY KEY,
        hcv_id TEXT NOT NULL REFERENCES certificates(hcv_id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        creator_id TEXT NOT NULL,
        session_device_fingerprint TEXT NOT NULL,
        consent_version TEXT NOT NULL,
        publication_consent BOOLEAN NOT NULL,
        monetization_consent BOOLEAN NOT NULL,
        rights_confirmed BOOLEAN NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('ACTIVE','WITHDRAWN')),
        consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        withdrawn_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS verified_originals_consents_hcv_idx
        ON verified_originals_consents(hcv_id, consented_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS verified_originals_one_active_consent_idx
        ON verified_originals_consents(hcv_id)
        WHERE state='ACTIVE';

      CREATE TABLE IF NOT EXISTS trusted_derivations (
        output_sha256 TEXT PRIMARY KEY,
        hcv_id TEXT NOT NULL REFERENCES certificates(hcv_id) ON DELETE CASCADE,
        manifest_raw TEXT NOT NULL,
        registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS trusted_derivations_hcv_idx
        ON trusted_derivations(hcv_id, registered_at DESC);

      CREATE TABLE IF NOT EXISTS verified_originals_platform_receipts (
        receipt_id TEXT PRIMARY KEY,
        hcv_id TEXT NOT NULL REFERENCES certificates(hcv_id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        platform_post_id TEXT NOT NULL,
        uploaded_sha256 TEXT NOT NULL,
        upload_session_hash TEXT NOT NULL,
        processing_status TEXT NOT NULL,
        visibility TEXT NOT NULL,
        publisher_subject_hash TEXT NOT NULL,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE(platform, platform_post_id)
      );

      CREATE TABLE IF NOT EXISTS verified_originals_publications (
        publication_id TEXT PRIMARY KEY,
        hcv_id TEXT NOT NULL REFERENCES certificates(hcv_id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        platform_post_id TEXT NOT NULL,
        public_url TEXT NOT NULL,
        reference_sha256 TEXT NOT NULL,
        original_content_sha256 TEXT NOT NULL,
        derived_from TEXT NOT NULL,
        derivation_type TEXT NOT NULL,
        derivation_manifest_sha256 TEXT NOT NULL,
        platform_receipt_id TEXT NOT NULL REFERENCES verified_originals_platform_receipts(receipt_id),
        created_at TIMESTAMPTZ NOT NULL,
        publication_status TEXT NOT NULL CHECK(publication_status IN ('PUBLISHED','REVOKED','UNAVAILABLE')),
        consent_record_id TEXT NOT NULL REFERENCES verified_originals_consents(record_id),
        consent_version TEXT NOT NULL,
        monetization_consent BOOLEAN NOT NULL,
        published_by TEXT NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        unavailable_at TIMESTAMPTZ,
        audit_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE(platform, platform_post_id)
      );
      ALTER TABLE verified_originals_publications
        ADD COLUMN IF NOT EXISTS hcvpack_sha256 TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS verified_originals_publications_hcv_idx
        ON verified_originals_publications(hcv_id, published_at DESC);

      CREATE TABLE IF NOT EXISTS verified_originals_audit (
        id BIGSERIAL PRIMARY KEY,
        hcv_id TEXT NOT NULL,
        publication_id TEXT,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_subject_hash TEXT NOT NULL,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS verified_originals_audit_hcv_idx
        ON verified_originals_audit(hcv_id, id DESC);
    `);
    startTakedownWorker();
  }

  async function certificateRow(hcvId) {
    if (!HCV_ID.test(hcvId || '')) return null;
    return (await pool.query(`
      SELECT
        hcv_id,account_id,created_at,certificate_raw,certificate_sha256,
        account_subject_hash,device_key_fingerprint,creator_id,binding_version,
        content_sha256,identity_verified,registry_attested_at,provenance_version,
        registry_attestation_sha256
      FROM certificates
      WHERE hcv_id=$1
    `, [hcvId])).rows[0] || null;
  }

  function cameraCaptureBinding(certificate, row, hcvId) {
    const content = certificate?.content;
    const claims = certificate?.claims;
    const binding = claims?.provenance;
    const event = binding?.event;
    const metadata = event?.metadata;
    const contentType = String(content?.type || '');
    const contentHash = String(content?.hash || '').toLowerCase();
    const contentSize = Number(content?.size);
    const sessionId = String(certificate?.sessionId || '');

    const valid =
      (contentType === 'video' || contentType === 'photo') &&
      claims?.captureSource === 'HCV_CAMERA' &&
      claims?.liveCapture === true &&
      binding?.type === CAPTURE_PROVENANCE_TYPE &&
      binding?.version === 1 &&
      binding?.status === 'VERIFIED' &&
      binding?.hcvId === hcvId &&
      binding?.inputHash === contentHash &&
      binding?.deviceFingerprint === String(row?.device_key_fingerprint || '').toLowerCase() &&
      binding?.sessionId === sessionId &&
      binding?.pipelineVersion === CAPTURE_PROVENANCE_PIPELINE &&
      binding?.eventHash === event?.eventHash &&
      event?.type === 'SIGILLUM_PROVENANCE_EVENT' &&
      event?.version === 1 &&
      event?.sequence === 0 &&
      event?.eventType === 'CAPTURE_FINALIZED' &&
      event?.inputHash === contentHash &&
      event?.deviceFingerprint === String(row?.device_key_fingerprint || '').toLowerCase() &&
      event?.sessionId === sessionId &&
      event?.pipelineVersion === CAPTURE_PROVENANCE_PIPELINE &&
      event?.parentEvent === 'GENESIS' &&
      metadata?.hcvId === hcvId &&
      metadata?.captureSource === 'HCV_CAMERA' &&
      metadata?.mediaType === contentType &&
      Number(metadata?.contentSize) === contentSize;

    return {
      valid,
      contentType,
      contentHash,
      contentSize,
    };
  }

  async function verifiedOriginal(hcvId) {
    const row = await certificateRow(hcvId);
    if (!row) return null;
    let certificate;
    try {
      certificate = verifyCertificateRaw(row.certificate_raw, hcvId);
    } catch (_) {
      return null;
    }
    const provenance = provenanceEnvelopeFromRow(row);
    const capture = cameraCaptureBinding(certificate, row, hcvId);
    const contentHash = capture.contentHash;
    const contentSize = capture.contentSize;
    if (!capture.valid ||
        provenance?.status !== 'SIGILLUM_REGISTRY_VERIFIED' ||
        provenance.integrityValid !== true ||
        provenance.identityVerified !== true ||
        provenance.contentSha256 !== contentHash ||
        row.content_sha256 !== contentHash ||
        !SHA256.test(contentHash) ||
        !Number.isSafeInteger(contentSize) ||
        contentSize <= 0) {
      return null;
    }
    return { row, certificate, provenance, contentHash, contentSize, contentType: capture.contentType };
  }

  async function ownedOriginal(hcvId, session) {
    const original = await verifiedOriginal(hcvId);
    if (!original) fail('CERTIFICATE_NOT_ACTIVE_VERIFIED', 403);
    if (!session?.account_id || original.row.account_id !== session.account_id) {
      fail('CREATOR_OWNERSHIP_NOT_VERIFIED', 403);
    }
    const creatorId = String(session.creator_id || '');
    if (!creatorId || creatorId !== String(original.row.creator_id || '')) {
      fail('CREATOR_OWNERSHIP_NOT_VERIFIED', 403);
    }
    return original;
  }

  async function creatorAccess(req) {
    const access = await requireCreatorAccess(req);
    if (access?.account?.subscriptionStatus !== 'active') {
      fail('SUBSCRIPTION_REQUIRED', 402);
    }
    return access;
  }

  async function audit({
    hcvId,
    publicationId = null,
    eventType,
    actorType,
    actorSubjectHash,
    metadata = {},
    client = pool,
  }) {
    await client.query(`
      INSERT INTO verified_originals_audit(
        hcv_id,publication_id,event_type,actor_type,actor_subject_hash,metadata_json
      ) VALUES($1,$2,$3,$4,$5,$6)
    `, [
      hcvId,
      publicationId,
      eventType,
      actorType,
      actorSubjectHash,
      metadata && typeof metadata === 'object' ? metadata : {},
    ]);
  }

  async function activeConsent(hcvId) {
    return (await pool.query(`
      SELECT * FROM verified_originals_consents
      WHERE hcv_id=$1 AND state='ACTIVE'
      ORDER BY consented_at DESC
      LIMIT 1
    `, [hcvId])).rows[0] || null;
  }

  async function activeReference(hcvId) {
    const original = await verifiedOriginal(hcvId);
    if (!original) return null;
    const row = (await pool.query(`
      SELECT
        p.*,
        c.state AS consent_state,
        r.hcv_id AS receipt_hcv_id,
        r.platform AS receipt_platform,
        r.platform_post_id AS receipt_platform_post_id,
        r.uploaded_sha256 AS receipt_uploaded_sha256,
        r.processing_status AS receipt_processing_status,
        r.visibility AS receipt_visibility
      FROM verified_originals_publications p
      JOIN verified_originals_consents c ON c.record_id=p.consent_record_id
      JOIN verified_originals_platform_receipts r ON r.receipt_id=p.platform_receipt_id
      WHERE p.hcv_id=$1 AND p.publication_status='PUBLISHED'
      ORDER BY p.published_at DESC
      LIMIT 1
    `, [hcvId])).rows[0];
    if (!row ||
        row.consent_state !== 'ACTIVE' ||
        row.original_content_sha256 !== original.contentHash ||
        row.derived_from !== original.contentHash ||
        row.receipt_hcv_id !== hcvId ||
        row.receipt_platform !== row.platform ||
        row.receipt_platform_post_id !== row.platform_post_id ||
        row.receipt_uploaded_sha256 !== row.reference_sha256 ||
        row.receipt_processing_status !== 'succeeded' ||
        row.receipt_visibility !== 'unlisted' ||
        !SHA256.test(row.reference_sha256 || '')) {
      return null;
    }
    const reference = canonicalYoutubeReference(row.platform_post_id);
    if (!reference || row.platform !== 'youtube' || reference.publicUrl !== row.public_url) {
      return null;
    }
    return {
      publicationId: row.publication_id,
      hcvId,
      platform: 'youtube',
      platformPostId: row.platform_post_id,
      publicUrl: row.public_url,
      referenceSha256: row.reference_sha256,
      originalContentSha256: row.original_content_sha256,
      hcvpackSha256: row.hcvpack_sha256,
      derivedFrom: row.derived_from,
      derivationType: row.derivation_type,
      publicationStatus: row.publication_status,
      certificateVerdict: 'CERTIFICATE_RECORD_VERIFIED',
      socialFileVerdict: 'NOT_VERIFIED',
      publishedAt: row.published_at,
    };
  }

  async function publicAvailability(hcvId) {
    const reference = await activeReference(hcvId);
    if (!reference) {
      return { hcvId, availability: 'REFERENCE_NOT_AVAILABLE', socialFileVerdict: 'NOT_VERIFIED' };
    }
    return {
      hcvId,
      availability: 'REFERENCE_AVAILABLE',
      publicationStatus: 'PUBLISHED',
      platform: 'youtube',
      hcvpackSha256: reference.hcvpackSha256,
      certificateVerdict: 'CERTIFICATE_RECORD_VERIFIED',
      socialFileVerdict: 'NOT_VERIFIED',
      viewAccess: 'SUBSCRIPTION_REQUIRED',
    };
  }

  async function publicHistory(hcvId) {
    const rows = (await pool.query(`
      SELECT publication_id,hcv_id,platform,publication_status,
             created_at,published_at,revoked_at,unavailable_at
      FROM verified_originals_publications
      WHERE hcv_id=$1
      ORDER BY published_at DESC
      LIMIT 100
    `, [hcvId])).rows;
    return rows.map(row => ({
      publicationId: row.publication_id,
      hcvId: row.hcv_id,
      platform: row.platform,
      publicationStatus: row.publication_status,
      createdAt: row.created_at,
      publishedAt: row.published_at,
      revokedAt: row.revoked_at,
      unavailableAt: row.unavailable_at,
      viewAccess: row.publication_status === 'PUBLISHED' ? 'SUBSCRIPTION_REQUIRED' : 'UNAVAILABLE',
      socialFileVerdict: 'NOT_VERIFIED',
    }));
  }

  async function createConsent(req) {
    const access = await creatorAccess(req);
    const payload = await readJson(req, 64_000);
    const hcvId = String(payload.hcvId || '').toUpperCase();
    if (!HCV_ID.test(hcvId)) fail('INVALID_HCV_ID', 400);
    const original = await ownedOriginal(hcvId, access.session);
    if (payload.intent !== 'PUBLISH_VERIFIED_ORIGINAL' || payload.publishReference !== true) {
      fail('EXPLICIT_PUBLICATION_CONSENT_REQUIRED', 400);
    }
    if (payload.rightsConfirmed !== true) fail('RIGHTS_NOT_CONFIRMED', 400);
    if (typeof payload.monetizationConsent !== 'boolean') fail('MONETIZATION_CONSENT_REQUIRED', 400);
    if (await activeConsent(hcvId)) fail('ACTIVE_CONSENT_ALREADY_EXISTS', 409);

    const recordId = crypto.randomUUID();
    try {
      await pool.query(`
        INSERT INTO verified_originals_consents(
          record_id,hcv_id,account_id,creator_id,session_device_fingerprint,
          consent_version,publication_consent,monetization_consent,rights_confirmed,state
        ) VALUES($1,$2,$3,$4,$5,$6,TRUE,$7,TRUE,'ACTIVE')
      `, [
        recordId,
        hcvId,
        access.session.account_id,
        original.row.creator_id,
        access.session.device_key_fingerprint,
        CONSENT_VERSION,
        payload.monetizationConsent,
      ]);
    } catch (error) {
      if (error.code === '23505') fail('ACTIVE_CONSENT_ALREADY_EXISTS', 409);
      throw error;
    }
    await audit({
      hcvId,
      eventType: 'CREATOR_CONSENT_GRANTED',
      actorType: 'CREATOR',
      actorSubjectHash: hashString(access.session.account_id),
      metadata: {
        publicationConsent: true,
        monetizationConsent: payload.monetizationConsent,
      },
    });
    return {
      ok: true,
      hcvId,
      recordId,
      consentVersion: CONSENT_VERSION,
      publicationConsent: true,
      monetizationConsent: payload.monetizationConsent,
      originalContentSha256: original.contentHash,
      publicationStatus: 'NOT_PUBLISHED',
    };
  }

  async function consentStatus(req, hcvId) {
    const session = await authenticate(req);
    await ownedOriginal(hcvId, session);
    const row = (await pool.query(`
      SELECT * FROM verified_originals_consents
      WHERE hcv_id=$1 AND account_id=$2
      ORDER BY consented_at DESC
      LIMIT 1
    `, [hcvId, session.account_id])).rows[0];
    if (!row) return { hcvId, consentState: 'NONE' };
    return {
      hcvId,
      consentState: row.state,
      recordId: row.record_id,
      consentVersion: row.consent_version,
      publicationConsent: row.publication_consent,
      monetizationConsent: row.monetization_consent,
      consentedAt: row.consented_at,
      withdrawnAt: row.withdrawn_at,
    };
  }

  function youtubeConfig() {
    const config = {
      clientId: String(process.env.YOUTUBE_CLIENT_ID || ''),
      clientSecret: String(process.env.YOUTUBE_CLIENT_SECRET || ''),
      refreshToken: String(process.env.YOUTUBE_REFRESH_TOKEN || ''),
      channelId: String(process.env.YOUTUBE_CHANNEL_ID || ''),
      publisherId: String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
    };
    if (!config.clientId || !config.clientSecret || !config.refreshToken || !YOUTUBE_CHANNEL_ID.test(config.channelId)) {
      fail('YOUTUBE_SERVICE_NOT_CONFIGURED', 503);
    }
    return config;
  }

  async function oauthAccessToken(config) {
    let response;
    try {
      response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: config.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });
    } catch (_) {
      fail('YOUTUBE_OAUTH_UNAVAILABLE', 502);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload.access_token !== 'string' || !payload.access_token) {
      fail('YOUTUBE_OAUTH_FAILED', 502);
    }
    return payload.access_token;
  }

  async function verifyYoutubeChannel(accessToken, expectedChannelId) {
    const response = await fetchImpl(
      'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
      { headers: { authorization: 'Bearer ' + accessToken } },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.items) || payload.items.length !== 1 || payload.items[0]?.id !== expectedChannelId) {
      fail('YOUTUBE_CHANNEL_ID_MISMATCH', 502);
    }
  }

  async function startYoutubeUpload({ accessToken, hcvId, size, originalSha256, hcvpackSha256 }) {
    const endpoint = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + accessToken,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(size),
        'x-upload-content-type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: 'SIGILLUM ' + hcvId,
          description: [
            'SIGILLUM VERIFIED ORIGINAL',
            'HCV-ID: ' + hcvId,
            'Original SHA-256: ' + originalSha256,
            'HCVPACK SHA-256: ' + hcvpackSha256,
            'Registry: https://sigillum-hcv.com/originals/' + hcvId,
          ].join('\n'),
        },
        status: {
          privacyStatus: 'unlisted',
          embeddable: true,
          selfDeclaredMadeForKids: false,
        },
      }),
    });
    if (!response.ok) fail('YOUTUBE_UPLOAD_SESSION_FAILED', 502);
    const raw = String(response.headers.get('location') || '');
    let url;
    try { url = new URL(raw); } catch (_) { fail('YOUTUBE_UPLOAD_LOCATION_INVALID', 502); }
    if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || !url.pathname.startsWith('/upload/youtube/v3/videos')) {
      fail('YOUTUBE_UPLOAD_LOCATION_INVALID', 502);
    }
    return url.toString();
  }

  async function uploadYoutubeFile({ accessToken, uploadUrl, filePath, size }) {
    const chunkSize = 8 * 1024 * 1024;
    const handle = await fs.promises.open(filePath, 'r');
    try {
      let offset = 0;
      while (offset < size) {
        const length = Math.min(chunkSize, size - offset);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        if (bytesRead !== length) fail('YOUTUBE_UPLOAD_FILE_READ_FAILED', 500);
        const end = offset + length - 1;
        const response = await fetchImpl(uploadUrl, {
          method: 'PUT',
          headers: {
            authorization: 'Bearer ' + accessToken,
            'content-type': 'video/mp4',
            'content-length': String(length),
            'content-range': 'bytes ' + offset + '-' + end + '/' + size,
          },
          body: buffer,
        });
        if (response.status === 308) {
          const match = /^bytes=0-(\d+)$/.exec(String(response.headers.get('range') || ''));
          if (!match) fail('YOUTUBE_UPLOAD_RANGE_INVALID', 502);
          const next = Number(match[1]) + 1;
          if (!Number.isSafeInteger(next) || next <= offset || next > size) fail('YOUTUBE_UPLOAD_RANGE_INVALID', 502);
          offset = next;
          continue;
        }
        if (!response.ok) fail('YOUTUBE_UPLOAD_FAILED', 502);
        const payload = await response.json().catch(() => ({}));
        if (!YOUTUBE_ID.test(payload.id || '') || end + 1 !== size) fail('YOUTUBE_UPLOAD_RESPONSE_INVALID', 502);
        return payload.id;
      }
    } finally {
      await handle.close();
    }
    fail('YOUTUBE_UPLOAD_INCOMPLETE', 502);
  }

  async function youtubeStatus(accessToken, videoId) {
    const response = await fetchImpl(
      'https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=' + encodeURIComponent(videoId),
      { headers: { authorization: 'Bearer ' + accessToken } },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.items) || payload.items.length !== 1 || payload.items[0]?.id !== videoId) {
      fail('YOUTUBE_STATUS_FAILED', 502);
    }
    const item = payload.items[0];
    return {
      processingStatus: String(item.processingDetails?.processingStatus || ''),
      privacyStatus: String(item.status?.privacyStatus || ''),
      uploadStatus: String(item.status?.uploadStatus || ''),
      failureReason: String(item.status?.failureReason || ''),
      rejectionReason: String(item.status?.rejectionReason || ''),
      etag: String(item.etag || ''),
    };
  }

  async function deleteYoutubeVideo(accessToken, videoId) {
    if (!YOUTUBE_ID.test(videoId || '')) return false;
    const response = await fetchImpl(
      'https://www.googleapis.com/youtube/v3/videos?id=' + encodeURIComponent(videoId),
      { method: 'DELETE', headers: { authorization: 'Bearer ' + accessToken } },
    );
    return response.status === 204 || response.status === 404 || response.ok;
  }

  async function waitYoutubeReady(accessToken, videoId) {
    const timeoutMs = Math.max(1000, Number(process.env.YOUTUBE_PROCESSING_TIMEOUT_MS || 300000));
    const pollMs = Math.max(250, Number(process.env.YOUTUBE_PROCESSING_POLL_MS || 3000));
    const deadline = Date.now() + timeoutMs;
    let last = null;
    do {
      last = await youtubeStatus(accessToken, videoId);
      if (last.processingStatus === 'succeeded' && last.privacyStatus === 'unlisted') return last;
      if (last.processingStatus === 'failed' || last.uploadStatus === 'failed' || last.rejectionReason) return last;
      if (Date.now() >= deadline) return last;
      await sleep(pollMs);
    } while (true);
  }

  async function registerReceipt({ hcvId, videoId, referenceSha256, uploadUrl, status, config }) {
    const receiptId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO verified_originals_platform_receipts(
        receipt_id,hcv_id,platform,platform_post_id,uploaded_sha256,
        upload_session_hash,processing_status,visibility,publisher_subject_hash,metadata_json
      ) VALUES($1,$2,'youtube',$3,$4,$5,$6,$7,$8,$9)
    `, [
      receiptId,
      hcvId,
      videoId,
      referenceSha256,
      hashString(uploadUrl),
      status.processingStatus,
      status.privacyStatus,
      hashString(config.publisherId),
      { uploadProtocol: 'youtube_resumable_v1', youtubeEtag: status.etag, privacyStatus: status.privacyStatus },
    ]);
    return receiptId;
  }

  async function youtubePublish({ hcvId, filePath, referenceSha256, size, originalSha256, hcvpackSha256 }) {
    const config = youtubeConfig();
    const accessToken = await oauthAccessToken(config);
    await verifyYoutubeChannel(accessToken, config.channelId);
    const uploadUrl = await startYoutubeUpload({ accessToken, hcvId, size, originalSha256, hcvpackSha256 });
    const videoId = await uploadYoutubeFile({ accessToken, uploadUrl, filePath, size });
    let status;
    try {
      status = await waitYoutubeReady(accessToken, videoId);
    } catch (error) {
      try { await deleteYoutubeVideo(accessToken, videoId); } catch (_) {}
      throw error;
    }
    if (status.processingStatus !== 'succeeded' || status.privacyStatus !== 'unlisted') {
      try { await deleteYoutubeVideo(accessToken, videoId); } catch (_) {}
      fail(status.privacyStatus !== 'unlisted' ? 'YOUTUBE_REFERENCE_NOT_UNLISTED' : 'YOUTUBE_PROCESSING_NOT_SUCCEEDED', 502);
    }
    const receiptId = await registerReceipt({ hcvId, videoId, referenceSha256, uploadUrl, status, config });
    return { videoId, publicUrl: canonicalYoutubeReference(videoId).publicUrl, receiptId, status, accessToken };
  }

  async function streamToFile(req, destination, expectedSize) {
    const maxBytes = Math.max(1, Number(process.env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES || 536870912));
    const handle = await fs.promises.open(destination, 'wx', 0o600);
    const digest = crypto.createHash('sha256');
    let received = 0;
    let position = 0;
    try {
      for await (const raw of req) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        received += chunk.length;
        if (received > maxBytes || received > expectedSize) fail('ORIGINAL_UPLOAD_TOO_LARGE', 413);
        digest.update(chunk);
        let written = 0;
        while (written < chunk.length) {
          const result = await handle.write(chunk, written, chunk.length - written, position + written);
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
    return { size: received, sha256: digest.digest('hex') };
  }

  async function createTrustedDerivative({ hcvId, original, originalPath, outputPath }) {
    const keyId = String(process.env.SIGILLUM_DERIVATION_KEY_ID || '');
    const privatePem = String(process.env.SIGILLUM_DERIVATION_PRIVATE_KEY_PEM || '').replace(/\\n/g, '\n');
    const trustedKeys = parsePinnedDerivationKeys();
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(keyId) || !privatePem || !trustedKeys?.[keyId]) {
      fail('DERIVATION_SERVICE_NOT_CONFIGURED', 503);
    }
    const privateKey = crypto.createPrivateKey(privatePem);
    if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails?.modulusLength < 2048) fail('DERIVATION_SIGNING_KEY_INVALID', 503);
    const publicFromPrivate = crypto.createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString();
    const pinned = crypto.createPublicKey(trustedKeys[keyId]).export({ format: 'pem', type: 'spki' }).toString();
    if (publicFromPrivate !== pinned) fail('DERIVATION_KEY_PIN_MISMATCH', 503);
    const contentType = original.contentType || original.certificate?.content?.type;
    const derivationOperation = contentType === 'video'
      ? DERIVATION_OPERATION
      : contentType === 'photo'
        ? PHOTO_DERIVATION_OPERATION
        : null;
    if (!derivationOperation) fail('DERIVATION_MEDIA_TYPE_UNSUPPORTED', 415);

    const ffmpegArgs = contentType === 'video'
      ? [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
          '-i', originalPath,
          '-map', '0:v:0', '-map', '0:a?',
          '-map_metadata', '-1', '-map_chapters', '-1',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
          '-movflags', '+faststart', outputPath,
        ]
      : [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
          '-loop', '1', '-i', originalPath,
          '-t', '5', '-r', '30',
          '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p',
          '-map_metadata', '-1', '-map_chapters', '-1',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
          '-an', '-movflags', '+faststart', outputPath,
        ];

    await execFileAsync(ffmpegPath, ffmpegArgs, { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });

    const output = await fs.promises.readFile(outputPath);
    if (!output.length) fail('DERIVATION_OUTPUT_INVALID', 500);
    const outputHash = hashBytes(output);
    if (outputHash === original.contentHash) fail('DERIVATION_OUTPUT_INVALID', 500);

    const statement = {
      schema: DERIVATION_SCHEMA,
      hcvId,
      parent: {
        kind: 'original',
        sha256: original.contentHash,
        signedCertificateDigest: hashString(original.row.certificate_raw),
      },
      output: { sha256: outputHash, byteLength: output.length, mediaType: 'video' },
      transform: {
        operation: derivationOperation,
        editorialImpact: 'non_editorial',
        policyVersion: 'SIGILLUM_NON_EDITORIAL_V1',
      },
      issuer: { keyId, signatureAlgorithm: DERIVATION_SIGNATURE_ALGORITHM },
      createdAt: new Date().toISOString(),
      nonce: crypto.randomUUID(),
    };
    const manifest = {
      ...statement,
      signature: crypto.sign('RSA-SHA256', Buffer.from(JSON.stringify(statement), 'utf8'), privateKey).toString('base64'),
    };
    if (!verifyDerivationManifest({ manifest, certificateRaw: original.row.certificate_raw, trustedKeys, verifyCertificateRaw })) {
      fail('DERIVATION_ATTESTATION_INVALID', 500);
    }

    const raw = JSON.stringify(manifest);
    await pool.query(`
      INSERT INTO trusted_derivations(output_sha256,hcv_id,manifest_raw)
      VALUES($1,$2,$3)
      ON CONFLICT(output_sha256) DO NOTHING
    `, [outputHash, hcvId, raw]);
    const stored = (await pool.query('SELECT hcv_id,manifest_raw FROM trusted_derivations WHERE output_sha256=$1', [outputHash])).rows[0];
    if (!stored || stored.hcv_id !== hcvId || stored.manifest_raw !== raw) fail('DERIVATION_IMMUTABLE_RECORD_CONFLICT', 409);
    return { manifest, outputHash, outputSize: output.length };
  }

  async function registerPublication({ hcvId, consentRecordId, original, derivation, youtube, monetizationEnabled, hcvpackSha256 }) {
    const client = await pool.connect();
    const publicationId = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      const consent = (await client.query(`
        SELECT * FROM verified_originals_consents
        WHERE record_id=$1 AND hcv_id=$2 AND state='ACTIVE'
        FOR UPDATE
      `, [consentRecordId, hcvId])).rows[0];
      if (!consent || !consent.publication_consent || !consent.rights_confirmed) fail('ACTIVE_CREATOR_CONSENT_REQUIRED', 403);
      if (monetizationEnabled && !consent.monetization_consent) fail('MONETIZATION_NOT_AUTHORIZED', 403);
      const receipt = (await client.query('SELECT * FROM verified_originals_platform_receipts WHERE receipt_id=$1', [youtube.receiptId])).rows[0];
      if (!receipt || receipt.hcv_id !== hcvId || receipt.platform !== 'youtube' || receipt.platform_post_id !== youtube.videoId || receipt.uploaded_sha256 !== derivation.outputHash || receipt.processing_status !== 'succeeded' || receipt.visibility !== 'unlisted') {
        fail('PLATFORM_UPLOAD_RECEIPT_REQUIRED', 422);
      }
      const manifestRaw = JSON.stringify(derivation.manifest);
      await client.query(`
        INSERT INTO verified_originals_publications(
          publication_id,hcv_id,platform,platform_post_id,public_url,
          reference_sha256,original_content_sha256,derived_from,derivation_type,
          derivation_manifest_sha256,platform_receipt_id,created_at,publication_status,
          consent_record_id,consent_version,monetization_consent,published_by,hcvpack_sha256
        ) VALUES($1,$2,'youtube',$3,$4,$5,$6,$6,$7,$8,$9,$10,'PUBLISHED',$11,$12,$13,$14,$15)
      `, [
        publicationId,
        hcvId,
        youtube.videoId,
        youtube.publicUrl,
        derivation.outputHash,
        original.contentHash,
        derivation.manifest.transform.operation,
        hashString(manifestRaw),
        youtube.receiptId,
        derivation.manifest.createdAt,
        consentRecordId,
        consent.consent_version,
        monetizationEnabled,
        String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
        hcvpackSha256,
      ]);
      await audit({
        hcvId,
        publicationId,
        eventType: 'PUBLICATION_REGISTERED',
        actorType: 'SIGILLUM_PUBLISHER',
        actorSubjectHash: hashString(String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1')),
        metadata: {
          platformStatus: youtube.status.processingStatus,
          platformVisibility: youtube.status.privacyStatus,
          workerVersion: 'verified_originals_production_v2',
          hcvpackSha256,
        },
        client,
      });
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
    return publicationId;
  }

  async function publishOriginal(req, hcvId, url) {
    const access = await creatorAccess(req);
    const original = await ownedOriginal(hcvId, access.session);
    const requestMediaType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    const allowedMediaTypes = original.contentType === 'video'
      ? new Set(['video/mp4'])
      : new Set(['image/jpeg', 'image/png']);
    if (!allowedMediaTypes.has(requestMediaType)) fail('ORIGINAL_MEDIA_TYPE_UNSUPPORTED', 415);
    const contentLength = Number(req.headers['content-length']);
    const maxBytes = Math.max(1, Number(process.env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES || 536870912));
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > maxBytes) fail('ORIGINAL_CONTENT_LENGTH_INVALID', 411);
    if (contentLength !== original.contentSize) fail('ORIGINAL_UPLOAD_SIZE_MISMATCH', 400);

    const consentRecordId = String(url.searchParams.get('consentRecordId') || '');
    const monetizationEnabled = strictBoolean(url.searchParams.get('monetizationEnabled'));
    const hcvpackSha256 = String(url.searchParams.get('hcvpackSha256') || '').toLowerCase();
    if (!consentRecordId || monetizationEnabled === null || !SHA256.test(hcvpackSha256)) fail('PUBLISH_REQUEST_INVALID', 400);
    if (!verifyHcvpackBindingSignature(req, original, hcvId, hcvpackSha256)) {
      fail('HCVPACK_BINDING_SIGNATURE_INVALID', 422);
    }
    const consent = (await pool.query(`
      SELECT * FROM verified_originals_consents
      WHERE record_id=$1 AND hcv_id=$2 AND account_id=$3 AND state='ACTIVE'
    `, [consentRecordId, hcvId, access.session.account_id])).rows[0];
    if (!consent || !consent.publication_consent || !consent.rights_confirmed) fail('ACTIVE_CREATOR_CONSENT_REQUIRED', 403);
    if (monetizationEnabled && !consent.monetization_consent) fail('MONETIZATION_NOT_AUTHORIZED', 403);

    const tmpRoot = String(process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP || path.join(os.tmpdir(), 'sigillum-verified-originals'));
    await fs.promises.mkdir(tmpRoot, { recursive: true, mode: 0o700 });
    const jobDir = await fs.promises.mkdtemp(path.join(tmpRoot, 'job-'));
    const originalExtension = original.contentType === 'video'
      ? '.mp4'
      : requestMediaType === 'image/png'
        ? '.png'
        : '.jpg';
    const originalPath = path.join(jobDir, 'original' + originalExtension);
    const outputPath = path.join(jobDir, 'reference.mp4');

    try {
      const uploaded = await streamToFile(req, originalPath, original.contentSize);
      if (uploaded.sha256 !== original.contentHash) fail('DERIVATION_ORIGINAL_SHA_MISMATCH', 422);
      const derivation = await createTrustedDerivative({ hcvId, original, originalPath, outputPath });
      const youtube = await youtubePublish({
        hcvId,
        filePath: outputPath,
        referenceSha256: derivation.outputHash,
        size: derivation.outputSize,
        originalSha256: original.contentHash,
        hcvpackSha256,
      });
      let publicationId;
      try {
        publicationId = await registerPublication({ hcvId, consentRecordId, original, derivation, youtube, monetizationEnabled, hcvpackSha256 });
      } catch (error) {
        try { await deleteYoutubeVideo(youtube.accessToken, youtube.videoId); } catch (_) {}
        try {
          await pool.query(`
            UPDATE verified_originals_platform_receipts
            SET processing_status='registration_failed',visibility='unavailable',verified_at=NOW()
            WHERE receipt_id=$1
          `, [youtube.receiptId]);
        } catch (_) {}
        throw error;
      }
      return {
        ok: true,
        publicationId,
        hcvId,
        platform: 'youtube',
        publicUrl: youtube.publicUrl,
        publicationStatus: 'PUBLISHED',
        originalContentSha256: original.contentHash,
        referenceSha256: derivation.outputHash,
        derivedFrom: original.contentHash,
        derivationType: derivation.manifest.transform.operation,
        hcvpackSha256,
        socialFileVerdict: 'NOT_VERIFIED',
      };
    } finally {
      for (const item of [outputPath + '.hcvderivation.json', outputPath, originalPath]) {
        try { await fs.promises.rm(item, { force: true }); } catch (_) {}
      }
      try { await fs.promises.rmdir(jobDir); } catch (_) {}
    }
  }

  async function attemptTakedowns(publications) {
    if (!publications.length) return 'COMPLETED';
    try {
      const config = youtubeConfig();
      const accessToken = await oauthAccessToken(config);
      await verifyYoutubeChannel(accessToken, config.channelId);
      let allDeleted = true;
      for (const publication of publications) {
        if (publication.processing_status === 'withdrawn') continue;
        const deleted = await deleteYoutubeVideo(
          accessToken,
          publication.platform_post_id,
        );
        allDeleted = allDeleted && deleted;
        if (deleted) {
          await pool.query(`
            UPDATE verified_originals_platform_receipts
            SET processing_status='withdrawn',visibility='unavailable',verified_at=NOW()
            WHERE receipt_id=$1
          `, [publication.platform_receipt_id]);
        }
      }
      return allDeleted ? 'COMPLETED' : 'PARTIAL';
    } catch (_) {
      return 'PENDING';
    }
  }

  async function retryPendingTakedowns() {
    if (!youtubeServiceConfigured()) return { attempted: 0, completed: 0 };
    const rows = (await pool.query(`
      SELECT p.hcv_id,p.publication_id,p.platform_post_id,p.platform_receipt_id,
             r.processing_status
      FROM verified_originals_publications p
      JOIN verified_originals_platform_receipts r
        ON r.receipt_id=p.platform_receipt_id
      WHERE p.publication_status='REVOKED'
        AND r.processing_status<>'withdrawn'
      ORDER BY p.revoked_at ASC NULLS LAST
      LIMIT 100
    `)).rows;
    let completed = 0;
    for (const row of rows) {
      const status = await attemptTakedowns([row]);
      if (status === 'COMPLETED') {
        completed += 1;
        try {
          await audit({
            hcvId: row.hcv_id,
            publicationId: row.publication_id,
            eventType: 'PLATFORM_TAKEDOWN_COMPLETED',
            actorType: 'SIGILLUM_PUBLISHER',
            actorSubjectHash: hashString(
              String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
            ),
            metadata: { retryWorker: true },
          });
        } catch (_) {}
      }
    }
    return { attempted: rows.length, completed };
  }

  function startTakedownWorker() {
    if (takedownTimer || !youtubeServiceConfigured()) return;
    const intervalMs = Math.max(
      60_000,
      Number(process.env.SIGILLUM_TAKEDOWN_RETRY_MS || 300_000),
    );
    takedownTimer = setInterval(() => {
      retryPendingTakedowns().catch(error => {
        console.error('SIGILLUM_TAKEDOWN_RETRY_FAILED', error?.message || error);
      });
    }, intervalMs);
    if (typeof takedownTimer.unref === 'function') takedownTimer.unref();
  }

  async function withdrawConsent(req, hcvId) {
    const session = await authenticate(req);
    await ownedOriginal(hcvId, session);
    const client = await pool.connect();
    let publications = [];
    let consent;
    let newlyWithdrawn = false;
    try {
      await client.query('BEGIN');
      consent = (await client.query(`
        SELECT * FROM verified_originals_consents
        WHERE hcv_id=$1 AND account_id=$2 AND state='ACTIVE'
        ORDER BY consented_at DESC LIMIT 1 FOR UPDATE
      `, [hcvId, session.account_id])).rows[0];

      if (consent) {
        newlyWithdrawn = true;
        publications = (await client.query(`
          SELECT p.publication_id,p.platform_post_id,p.platform_receipt_id,
                 r.processing_status
          FROM verified_originals_publications p
          JOIN verified_originals_platform_receipts r
            ON r.receipt_id=p.platform_receipt_id
          WHERE p.hcv_id=$1 AND p.consent_record_id=$2
            AND p.publication_status='PUBLISHED'
        `, [hcvId, consent.record_id])).rows;
        await client.query(
          "UPDATE verified_originals_consents SET state='WITHDRAWN',withdrawn_at=NOW() WHERE record_id=$1",
          [consent.record_id],
        );
        await client.query(
          "UPDATE verified_originals_publications SET publication_status='REVOKED',revoked_at=NOW() WHERE hcv_id=$1 AND consent_record_id=$2 AND publication_status='PUBLISHED'",
          [hcvId, consent.record_id],
        );
        for (const publication of publications) {
          await client.query(`
            UPDATE verified_originals_platform_receipts
            SET processing_status='takedown_pending',verified_at=NOW()
            WHERE receipt_id=$1 AND processing_status<>'withdrawn'
          `, [publication.platform_receipt_id]);
          publication.processing_status = 'takedown_pending';
        }
        await audit({
          hcvId,
          eventType: 'CREATOR_CONSENT_WITHDRAWN',
          actorType: 'CREATOR',
          actorSubjectHash: hashString(session.account_id),
          metadata: { platformStatus: 'TAKEDOWN_REQUESTED' },
          client,
        });
      } else {
        consent = (await client.query(`
          SELECT * FROM verified_originals_consents
          WHERE hcv_id=$1 AND account_id=$2 AND state='WITHDRAWN'
          ORDER BY withdrawn_at DESC NULLS LAST, consented_at DESC
          LIMIT 1
        `, [hcvId, session.account_id])).rows[0];
        if (!consent) fail('WITHDRAWN_CONSENT_NOT_FOUND', 404);
        publications = (await client.query(`
          SELECT p.publication_id,p.platform_post_id,p.platform_receipt_id,
                 r.processing_status
          FROM verified_originals_publications p
          JOIN verified_originals_platform_receipts r
            ON r.receipt_id=p.platform_receipt_id
          WHERE p.hcv_id=$1 AND p.consent_record_id=$2
            AND p.publication_status='REVOKED'
        `, [hcvId, consent.record_id])).rows;
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }

    const takedown = await attemptTakedowns(publications);
    if (takedown === 'COMPLETED' && publications.length) {
      try {
        await audit({
          hcvId,
          eventType: 'PLATFORM_TAKEDOWN_COMPLETED',
          actorType: newlyWithdrawn ? 'CREATOR' : 'SIGILLUM_PUBLISHER',
          actorSubjectHash: hashString(
            newlyWithdrawn
              ? session.account_id
              : String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
          ),
          metadata: { retry: !newlyWithdrawn },
        });
      } catch (_) {}
    }
    return {
      ok: true,
      hcvId,
      consentState: 'WITHDRAWN',
      referenceAvailable: false,
      platformTakedown: takedown,
    };
  }

  async function handle(req, res, url) {
    const publicLookup = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
    const view = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/view$/.exec(url.pathname);
    const list = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/publications$/.exec(url.pathname);
    const consentStatusMatch = /^\/api\/verified-originals\/consents\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
    const withdraw = /^\/api\/verified-originals\/consents\/(HCV-[A-F0-9]{16})\/withdraw$/.exec(url.pathname);
    const publish = /^\/api\/verified-originals\/publish\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
    const page = /^\/originals\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);

    if (req.method === 'GET' && publicLookup) {
      sendJson(res, 200, await publicAvailability(publicLookup[1]));
      return true;
    }
    if (req.method === 'GET' && view) {
      const session = await authenticate(req);
      const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
      if (account.subscriptionStatus !== 'active') fail('SUBSCRIPTION_REQUIRED', 402);
      const reference = await activeReference(view[1]);
      if (!reference) fail('REFERENCE_NOT_AVAILABLE', 404);
      sendJson(res, 200, { hcvId: view[1], availability: 'REFERENCE_AVAILABLE', access: 'ENTITLED', ...reference });
      return true;
    }
    if (req.method === 'GET' && list) {
      sendJson(res, 200, { hcvId: list[1], publications: await publicHistory(list[1]) });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/verified-originals/consents') {
      sendJson(res, 201, await createConsent(req));
      return true;
    }
    if (req.method === 'GET' && consentStatusMatch) {
      sendJson(res, 200, await consentStatus(req, consentStatusMatch[1]));
      return true;
    }
    if (req.method === 'POST' && withdraw) {
      sendJson(res, 200, await withdrawConsent(req, withdraw[1]));
      return true;
    }
    if (req.method === 'POST' && publish) {
      sendJson(res, 201, await publishOriginal(req, publish[1], url));
      return true;
    }
    if (req.method === 'GET' && page) {
      const availability = await publicAvailability(page[1]);
      const available = availability.availability === 'REFERENCE_AVAILABLE';
      const lang = ['it','en','es','ru'].includes(String(url.searchParams.get('lang') || '').toLowerCase())
        ? String(url.searchParams.get('lang')).toLowerCase()
        : 'en';
      const copy = {
        it: {
          title: 'SIGILLUM Originali certificati',
          available: 'ORIGINALE CERTIFICATO DISPONIBILE',
          missing: 'RIFERIMENTO NON DISPONIBILE',
          access: 'La verifica è gratuita. La visualizzazione richiede un abbonamento SIGILLUM attivo e avviene dall’app.',
          absent: 'Nessun originale certificato attivo è disponibile.',
          warning: 'La presenza di un HCV-ID non prova che un file social esterno sia identico all’originale.',
        },
        en: {
          title: 'SIGILLUM Certified Originals',
          available: 'CERTIFIED ORIGINAL AVAILABLE',
          missing: 'REFERENCE NOT AVAILABLE',
          access: 'Verification is free. Viewing requires an active SIGILLUM subscription and takes place in the app.',
          absent: 'No active certified original is available.',
          warning: 'The presence of an HCV-ID does not prove that an external social file is identical to the original.',
        },
        es: {
          title: 'Originales certificados SIGILLUM',
          available: 'ORIGINAL CERTIFICADO DISPONIBLE',
          missing: 'REFERENCIA NO DISPONIBLE',
          access: 'La verificación es gratuita. La visualización requiere una suscripción SIGILLUM activa y se realiza en la app.',
          absent: 'No hay ningún original certificado activo disponible.',
          warning: 'La presencia de un HCV-ID no demuestra que un archivo externo de una red social sea idéntico al original.',
        },
        ru: {
          title: 'Сертифицированные оригиналы SIGILLUM',
          available: 'СЕРТИФИЦИРОВАННЫЙ ОРИГИНАЛ ДОСТУПЕН',
          missing: 'ЭТАЛОН НЕДОСТУПЕН',
          access: 'Проверка бесплатна. Для просмотра требуется активная подписка SIGILLUM; просмотр выполняется в приложении.',
          absent: 'Активный сертифицированный оригинал отсутствует.',
          warning: 'Наличие HCV-ID не доказывает, что внешний файл из социальной сети идентичен оригиналу.',
        },
      }[lang];
      const html = '<!doctype html><html lang="' + lang + '"><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + copy.title + '</title>' +
        '<main style="max-width:720px;margin:40px auto;font:17px/1.5 sans-serif">' +
        '<h1>' + (available ? copy.available : copy.missing) + '</h1>' +
        '<p>HCV-ID: ' + page[1] + '</p>' +
        (available ? '<p>' + copy.access + '</p>' : '<p>' + copy.absent + '</p>') +
        '<p>' + copy.warning + '</p>' +
        '</main></html>';
      sendHtml(res, available ? 200 : 404, html);
      return true;
    }
    return false;
  }

  return {
    initSchema,
    handle,
    publicAvailability,
    activeReference,
    verifyDerivationManifest: args => verifyDerivationManifest({ ...args, verifyCertificateRaw }),
  };
}

module.exports = {
  CONSENT_VERSION,
  DERIVATION_OPERATION,
  PHOTO_DERIVATION_OPERATION,
  DERIVATION_SCHEMA,
  YOUTUBE_SCOPE,
  canonicalYoutubeReference,
  createVerifiedOriginalsProduction,
  verifyDerivationManifest,
};