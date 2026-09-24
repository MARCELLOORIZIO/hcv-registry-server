'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-youtube-publisher-'));
const dbPath = path.join(tmp, 'registry.db');
process.env.DB_PATH = dbPath;

const {
  buildAuthorizationUrl,
  publishTrustedVideoReference,
  trustedDerivativeFile,
} = require('./youtube_publisher_v1');

const HCV_ID = 'HCV-0123456789ABCDEF';
const filePath = path.join(tmp, 'trusted.mp4');
const bytes = Buffer.from('trusted derivative video bytes');
fs.writeFileSync(filePath, bytes);
const outputSha = crypto.createHash('sha256').update(bytes).digest('hex');
const parentSha = 'a'.repeat(64);
const channelId = 'UC0123456789ABCDEFGHIJKL';

const db = new Database(dbPath);
db.exec(`
CREATE TABLE IF NOT EXISTS trusted_derivations (
  output_sha256 TEXT PRIMARY KEY,
  hcv_id TEXT NOT NULL,
  manifest_raw TEXT NOT NULL,
  registered_at TEXT NOT NULL
);
`);
const manifest = {
  schema: 'SIGILLUM_TRUSTED_DERIVATION_V1',
  hcvId: HCV_ID,
  parent: {kind: 'original', sha256: parentSha},
  output: {sha256: outputSha, byteLength: bytes.length, mediaType: 'video'},
  transform: {
    operation: 'video_transcode_h264_aac_v1',
    editorialImpact: 'non_editorial',
  },
  createdAt: '2026-09-24T10:00:00.000Z',
  signature: 'x'.repeat(128),
};
db.prepare(`
INSERT INTO trusted_derivations
(output_sha256,hcv_id,manifest_raw,registered_at) VALUES (?,?,?,?)
`).run(
  outputSha, HCV_ID, JSON.stringify(manifest), '2026-09-24T10:01:00.000Z',
);

function response(status, json = {}, headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {get: name => normalized[String(name).toLowerCase()] ?? null},
    async json() { return json; },
  };
}

function mockYouTube({videoId, privacyStatus = 'unlisted',
  processingStatus = 'succeeded'}) {
  const calls = [];
  const uploadUrl =
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=test';
  const fetchImpl = async (url, options = {}) => {
    calls.push({url: String(url), options});
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('client_secret'), 'server-secret');
      return response(200, {access_token: 'access-token', expires_in: 3600});
    }
    if (String(url).includes('/youtube/v3/channels?part=id&mine=true')) {
      return response(200, {items:[{id:channelId}]});
    }
    if (String(url).includes('uploadType=resumable') &&
        options.method === 'POST') {
      const metadata = JSON.parse(options.body);
      assert.equal(metadata.status.privacyStatus, 'unlisted');
      assert.equal(metadata.snippet.title, 'SIGILLUM ' + HCV_ID);
      assert.equal(
        options.headers['x-upload-content-length'],
        String(bytes.length),
      );
      return response(200, {}, {location: uploadUrl});
    }
    if (String(url) === uploadUrl && options.method === 'PUT') {
      assert.equal(Buffer.compare(options.body, bytes), 0);
      assert.equal(
        options.headers['content-range'],
        'bytes 0-' + (bytes.length - 1) + '/' + bytes.length,
      );
      return response(201, {id: videoId});
    }
    if (String(url).includes('/youtube/v3/videos?part=status,processingDetails')) {
      return response(200, {
        items: [{
          id: videoId,
          etag: 'etag-test',
          status: {privacyStatus, uploadStatus: 'processed'},
          processingDetails: {processingStatus},
        }],
      });
    }
    if (String(url).includes('/youtube/v3/videos?id=') &&
        options.method === 'DELETE') {
      return response(204, {});
    }
    throw new Error('unexpected fetch: ' + url);
  };
  return {fetchImpl, calls};
}

async function run() {
  const authUrl = new URL(buildAuthorizationUrl({
    clientId: 'client-id',
    redirectUri: 'https://registry.example.test/oauth/youtube/callback',
    state: '0123456789abcdef0123456789abcdef',
  }));
  assert.equal(authUrl.hostname, 'accounts.google.com');
  assert.equal(authUrl.searchParams.get('access_type'), 'offline');
  assert.equal(
    authUrl.searchParams.get('scope'),
    'https://www.googleapis.com/auth/youtube.force-ssl',
  );
  assert.equal(authUrl.searchParams.get('state'), '0123456789abcdef0123456789abcdef');
  assert.equal(authUrl.searchParams.has('client_secret'), false);

  const trusted = await trustedDerivativeFile({db, hcvId: HCV_ID, filePath});
  assert.equal(trusted.sha256, outputSha);
  assert.equal(trusted.size, bytes.length);

  const config = {
    clientId: 'client-id',
    clientSecret: 'server-secret',
    redirectUri: 'https://registry.example.test/oauth/youtube/callback',
    refreshToken: 'refresh-token',
    channelId,
    publisherId: 'SIGILLUM_TEST_PUBLISHER',
  };

  const mismatchMock = mockYouTube({videoId: 'NoUpload01_1'});
  const mismatchFetch = async (url, options = {}) => {
    if (String(url).includes('/youtube/v3/channels?part=id&mine=true')) {
      return response(200, {items:[{id:'UCZZZZZZZZZZZZZZZZZZZZZZ'}]});
    }
    return mismatchMock.fetchImpl(url, options);
  };
  await assert.rejects(
    publishTrustedVideoReference({
      db,
      filePath,
      hcvId: HCV_ID,
      config,
      fetchImpl: mismatchFetch,
    }),
    /YOUTUBE_CHANNEL_ID_MISMATCH/,
  );
  assert.equal(
    mismatchMock.calls.some(call =>
      call.url.includes('uploadType=resumable') &&
      call.options.method === 'POST',
    ),
    false,
  );

  const publicMock = mockYouTube({videoId: 'AbCdEfGhI_1'});
  const published = await publishTrustedVideoReference({
    db, filePath, hcvId: HCV_ID, config, fetchImpl: publicMock.fetchImpl,
  });
  assert.equal(published.publicationReady, true);
  assert.equal(published.referenceSha256, outputSha);
  assert.equal(published.platformPostId, 'AbCdEfGhI_1');
  assert.ok(published.receiptId);

  const receipt = db.prepare(`
    SELECT * FROM verified_originals_platform_receipts
    WHERE platform='youtube' AND platform_post_id=?
  `).get('AbCdEfGhI_1');
  assert.equal(receipt.uploaded_sha256, outputSha);
  assert.equal(receipt.visibility, 'unlisted');
  assert.equal(receipt.processing_status, 'succeeded');

  const privateMock = mockYouTube({
    videoId: 'PrIvAtE01_2',
    privacyStatus: 'private',
  });
  const privateResult = await publishTrustedVideoReference({
    db, filePath, hcvId: HCV_ID, config, fetchImpl: privateMock.fetchImpl,
  });
  assert.equal(privateResult.publicationReady, false);
  assert.equal(privateResult.reason, 'YOUTUBE_REFERENCE_NOT_UNLISTED');
  assert.equal(privateResult.cleanupSucceeded, true);
  const privateReceipt = db.prepare(`
    SELECT * FROM verified_originals_platform_receipts
    WHERE platform='youtube' AND platform_post_id=?
  `).get('PrIvAtE01_2');
  assert.equal(privateReceipt, undefined);

  const alteredPath = path.join(tmp, 'altered.mp4');
  fs.writeFileSync(alteredPath, Buffer.from('attacker replacement'));
  let networkCalls = 0;
  await assert.rejects(
    publishTrustedVideoReference({
      db,
      filePath: alteredPath,
      hcvId: HCV_ID,
      config,
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error('network must not be reached');
      },
    }),
    /TRUSTED_UPLOAD_DERIVATION_NOT_REGISTERED/,
  );
  assert.equal(networkCalls, 0);

  console.log(
    'youtube_publisher_v1_test: PASS — OAuth server-side, trusted bytes, resumable upload, status gate, receipt',
  );
}

run().finally(() => {
  db.close();
  fs.rmSync(tmp, {recursive: true, force: true});
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
