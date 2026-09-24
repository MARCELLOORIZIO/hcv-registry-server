'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { trustedDerivation } = require('./verified_originals_v2_policy');
const {
  recordVerifiedPlatformReceipt,
} = require('./verified_originals_platform_receipts');

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const UPLOAD_ENDPOINT =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const STATUS_ENDPOINT =
  'https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=';

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => {
      size += chunk.length;
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return {sha256: hash.digest('hex'), size};
}

function requiredServerConfig(env = process.env) {
  const config = {
    clientId: String(env.YOUTUBE_CLIENT_ID || ''),
    clientSecret: String(env.YOUTUBE_CLIENT_SECRET || ''),
    redirectUri: String(env.YOUTUBE_REDIRECT_URI || ''),
    refreshToken: String(env.YOUTUBE_REFRESH_TOKEN || ''),
    publisherId: String(env.SIGILLUM_PUBLISHER_ID || ''),
  };
  for (const [key, value] of Object.entries(config)) {
    if (!value) throw new Error('YOUTUBE_SERVER_CONFIG_MISSING_' + key.toUpperCase());
  }
  const redirect = new URL(config.redirectUri);
  if (redirect.protocol !== 'https:' && redirect.hostname !== 'localhost') {
    throw new Error('YOUTUBE_REDIRECT_URI_INSECURE');
  }
  return config;
}

function buildAuthorizationUrl({
  clientId,
  redirectUri,
  state,
  scope = OAUTH_SCOPE,
}) {
  if (!clientId || !redirectUri || !state || state.length < 16) {
    throw new Error('YOUTUBE_OAUTH_REQUEST_INVALID');
  }
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'https:' && redirect.hostname !== 'localhost') {
    throw new Error('YOUTUBE_REDIRECT_URI_INSECURE');
  }
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

async function tokenRequest(fetchImpl, parameters) {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(parameters).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== 'string' ||
      !payload.access_token) {
    throw new Error('YOUTUBE_OAUTH_TOKEN_FAILED');
  }
  return payload;
}

async function exchangeAuthorizationCode({
  fetchImpl = fetch,
  clientId,
  clientSecret,
  redirectUri,
  code,
}) {
  if (!clientId || !clientSecret || !redirectUri || !code) {
    throw new Error('YOUTUBE_OAUTH_EXCHANGE_INVALID');
  }
  return tokenRequest(fetchImpl, {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    grant_type: 'authorization_code',
  });
}

async function refreshAccessToken({
  fetchImpl = fetch,
  clientId,
  clientSecret,
  refreshToken,
}) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('YOUTUBE_REFRESH_CONFIG_INVALID');
  }
  return tokenRequest(fetchImpl, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
}

async function trustedDerivativeFile({db, hcvId, filePath}) {
  if (!/^HCV-[A-F0-9]{16}$/.test(hcvId || '') ||
      typeof filePath !== 'string' || !filePath) {
    throw new Error('TRUSTED_UPLOAD_INPUT_INVALID');
  }
  const row = db.prepare(
    'SELECT output_sha256,manifest_raw FROM trusted_derivations WHERE hcv_id=? AND output_sha256=?'
  );
  const digest = await sha256File(filePath);
  if (!SHA256.test(digest.sha256)) throw new Error('TRUSTED_UPLOAD_HASH_INVALID');
  const stored = row.get(hcvId, digest.sha256);
  if (!stored) throw new Error('TRUSTED_UPLOAD_DERIVATION_NOT_REGISTERED');

  let manifest;
  try { manifest = JSON.parse(stored.manifest_raw); }
  catch (_) { throw new Error('TRUSTED_UPLOAD_MANIFEST_INVALID'); }

  const validated = trustedDerivation(
    manifest, hcvId, digest.sha256, manifest?.parent?.sha256,
  );
  if (!validated ||
      manifest.output.byteLength !== digest.size ||
      manifest.output.mediaType !== 'video') {
    throw new Error('TRUSTED_UPLOAD_MANIFEST_INVALID');
  }
  return {sha256: digest.sha256, size: digest.size, manifest};
}

function validatedUploadLocation(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' ||
      url.hostname !== 'www.googleapis.com' ||
      !url.pathname.startsWith('/upload/youtube/v3/videos')) {
    throw new Error('YOUTUBE_UPLOAD_LOCATION_INVALID');
  }
  return url.toString();
}

async function startResumableUpload({
  fetchImpl = fetch,
  accessToken,
  hcvId,
  contentLength,
  contentType = 'video/mp4',
}) {
  if (!accessToken || !Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new Error('YOUTUBE_UPLOAD_START_INVALID');
  }
  const body = {
    snippet: {
      title: 'SIGILLUM ' + hcvId,
      description:
        'SIGILLUM Verified Original reference. HCV-ID: ' + hcvId,
    },
    status: {
      privacyStatus: 'public',
      embeddable: true,
    },
  };
  const response = await fetchImpl(UPLOAD_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + accessToken,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-length': String(contentLength),
      'x-upload-content-type': contentType,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('YOUTUBE_UPLOAD_SESSION_FAILED');
  return validatedUploadLocation(response.headers.get('location'));
}

function nextOffsetFromRange(rangeHeader, sentEnd, totalSize) {
  if (!rangeHeader) return 0;
  const match = /^bytes=0-(\d+)$/.exec(rangeHeader);
  if (!match) throw new Error('YOUTUBE_UPLOAD_RANGE_INVALID');
  const last = Number(match[1]);
  if (!Number.isSafeInteger(last) || last < 0 || last > sentEnd ||
      last >= totalSize) {
    throw new Error('YOUTUBE_UPLOAD_RANGE_INVALID');
  }
  return last + 1;
}

async function uploadResumableFile({
  fetchImpl = fetch,
  uploadUrl,
  accessToken,
  filePath,
  contentType = 'video/mp4',
  chunkSize = 8 * 1024 * 1024,
}) {
  validatedUploadLocation(uploadUrl);
  if (!accessToken || !Number.isSafeInteger(chunkSize) ||
      chunkSize < 256 * 1024 || chunkSize % (256 * 1024) !== 0) {
    throw new Error('YOUTUBE_UPLOAD_CHUNK_INVALID');
  }
  const stat = await fs.promises.stat(filePath);
  const total = stat.size;
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error('YOUTUBE_UPLOAD_FILE_INVALID');
  }

  const handle = await fs.promises.open(filePath, 'r');
  try {
    let offset = 0;
    while (offset < total) {
      const length = Math.min(chunkSize, total - offset);
      const buffer = Buffer.allocUnsafe(length);
      const {bytesRead} = await handle.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new Error('YOUTUBE_UPLOAD_FILE_READ_FAILED');
      const end = offset + length - 1;
      const response = await fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: {
          authorization: 'Bearer ' + accessToken,
          'content-type': contentType,
          'content-length': String(length),
          'content-range': 'bytes ' + offset + '-' + end + '/' + total,
        },
        body: buffer,
      });

      if (response.status === 308) {
        offset = nextOffsetFromRange(
          response.headers.get('range'), end, total,
        );
        continue;
      }
      if (!response.ok) throw new Error('YOUTUBE_UPLOAD_FAILED');
      const payload = await response.json().catch(() => ({}));
      if (!YOUTUBE_ID.test(payload.id || '') || end + 1 !== total) {
        throw new Error('YOUTUBE_UPLOAD_RESPONSE_INVALID');
      }
      return payload.id;
    }
  } finally {
    await handle.close();
  }
  throw new Error('YOUTUBE_UPLOAD_INCOMPLETE');
}

async function fetchVideoStatus({
  fetchImpl = fetch,
  accessToken,
  videoId,
}) {
  if (!accessToken || !YOUTUBE_ID.test(videoId || '')) {
    throw new Error('YOUTUBE_STATUS_INPUT_INVALID');
  }
  const response = await fetchImpl(
    STATUS_ENDPOINT + encodeURIComponent(videoId),
    {headers: {authorization: 'Bearer ' + accessToken}},
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload.items) || payload.items.length !== 1) {
    throw new Error('YOUTUBE_STATUS_FAILED');
  }
  const item = payload.items[0];
  if (item.id !== videoId) throw new Error('YOUTUBE_STATUS_ID_MISMATCH');
  return {
    processingStatus: String(item.processingDetails?.processingStatus || ''),
    privacyStatus: String(item.status?.privacyStatus || ''),
    uploadStatus: String(item.status?.uploadStatus || ''),
    failureReason: String(item.status?.failureReason || ''),
    rejectionReason: String(item.status?.rejectionReason || ''),
    etag: String(item.etag || ''),
  };
}

async function publishTrustedVideoReference({
  db,
  filePath,
  hcvId,
  config = requiredServerConfig(),
  fetchImpl = fetch,
  chunkSize,
}) {
  if (!(db instanceof Database)) throw new Error('REGISTRY_DB_REQUIRED');
  const trusted = await trustedDerivativeFile({db, hcvId, filePath});
  const token = await refreshAccessToken({
    fetchImpl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
  });
  const accessToken = token.access_token;
  const uploadUrl = await startResumableUpload({
    fetchImpl,
    accessToken,
    hcvId,
    contentLength: trusted.size,
  });
  const videoId = await uploadResumableFile({
    fetchImpl,
    uploadUrl,
    accessToken,
    filePath,
    chunkSize,
  });
  const status = await fetchVideoStatus({
    fetchImpl,
    accessToken,
    videoId,
  });

  if (status.processingStatus !== 'succeeded' ||
      status.privacyStatus !== 'public') {
    return {
      publicationReady: false,
      hcvId,
      platform: 'youtube',
      platformPostId: videoId,
      referenceSha256: trusted.sha256,
      status,
      reason: status.privacyStatus !== 'public'
        ? 'YOUTUBE_REFERENCE_NOT_PUBLIC'
        : 'YOUTUBE_PROCESSING_NOT_SUCCEEDED',
    };
  }

  const receipt = recordVerifiedPlatformReceipt({
    hcvId,
    platform: 'youtube',
    platformPostId: videoId,
    uploadedSha256: trusted.sha256,
    uploadSessionHash: sha256Text(uploadUrl),
    processingStatus: status.processingStatus,
    visibility: status.privacyStatus,
    publisherSubjectHash: sha256Text(config.publisherId),
    metadata: {
      uploadProtocol: 'youtube_resumable_v1',
      youtubeEtag: status.etag,
      privacyStatus: status.privacyStatus,
    },
  });

  return {
    publicationReady: true,
    hcvId,
    platform: 'youtube',
    platformPostId: videoId,
    referenceSha256: trusted.sha256,
    receiptId: receipt.receiptId,
    status,
  };
}


async function deleteUploadedVideo({
  fetchImpl = fetch,
  config = requiredServerConfig(),
  videoId,
}) {
  if (!YOUTUBE_ID.test(videoId || '')) {
    throw new Error('YOUTUBE_DELETE_INPUT_INVALID');
  }
  const token = await refreshAccessToken({
    fetchImpl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
  });
  const response = await fetchImpl(
    'https://www.googleapis.com/youtube/v3/videos?id=' +
      encodeURIComponent(videoId),
    {
      method: 'DELETE',
      headers: {authorization: 'Bearer ' + token.access_token},
    },
  );
  if (response.status !== 204 && !response.ok) {
    throw new Error('YOUTUBE_DELETE_FAILED');
  }
  return true;
}

function openRegistryDb(dbPath = process.env.DB_PATH ||
  path.join(__dirname, 'registry.db')) {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  return db;
}

module.exports = {
  OAUTH_SCOPE,
  requiredServerConfig,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  trustedDerivativeFile,
  startResumableUpload,
  uploadResumableFile,
  fetchVideoStatus,
  publishTrustedVideoReference,
  deleteUploadedVideo,
  openRegistryDb,
};
