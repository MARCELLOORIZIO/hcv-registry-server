'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const oauth = require('./tool/youtube_oauth_provision');
const demo = require('./tool/youtube_scope_demo');

function response(status, payload = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = Object.keys(headers).find(
          item => item.toLowerCase() === String(name).toLowerCase(),
        );
        return key ? headers[key] : null;
      },
    },
    async json() { return payload; },
  };
}

async function main() {
  const state = 'state-test';
  const url = oauth.buildAuthorizationUrl({
    clientId: 'client.example.apps.googleusercontent.com',
    state,
    port: 53682,
  });
  assert.strictEqual(url.origin, 'https://accounts.google.com');
  assert.strictEqual(url.pathname, '/o/oauth2/v2/auth');
  assert.strictEqual(
    url.searchParams.get('redirect_uri'),
    'http://127.0.0.1:53682/oauth2/callback',
  );
  assert.strictEqual(url.searchParams.get('response_type'), 'code');
  assert.strictEqual(url.searchParams.get('scope'), oauth.DEFAULT_SCOPE);
  assert.strictEqual(url.searchParams.get('access_type'), 'offline');
  assert.strictEqual(url.searchParams.get('prompt'), 'consent');
  assert.strictEqual(url.searchParams.get('include_granted_scopes'), 'false');
  assert.strictEqual(url.searchParams.get('state'), state);
  assert.strictEqual(
    oauth.DEFAULT_SCOPE,
    'https://www.googleapis.com/auth/youtube.force-ssl',
  );

  let tokenBody = '';
  const exchanged = await oauth.exchangeCode({
    fetchImpl: async (target, options) => {
      assert.strictEqual(target, 'https://oauth2.googleapis.com/token');
      tokenBody = options.body;
      return response(200, {
        access_token: 'access-test',
        refresh_token: 'refresh-test',
        scope: oauth.DEFAULT_SCOPE,
      });
    },
    clientId: 'client-id',
    clientSecret: 'client-secret',
    code: 'code-test',
    port: 53682,
  });
  assert.strictEqual(exchanged.refresh_token, 'refresh-test');
  const tokenParams = new URLSearchParams(tokenBody);
  assert.strictEqual(tokenParams.get('grant_type'), 'authorization_code');
  assert.strictEqual(
    tokenParams.get('redirect_uri'),
    'http://127.0.0.1:53682/oauth2/callback',
  );

  const channel = await oauth.verifyChannel({
    fetchImpl: async (target, options) => {
      assert.ok(String(target).includes('/youtube/v3/channels?part=id&mine=true'));
      assert.strictEqual(options.headers.authorization, 'Bearer access-test');
      return response(200, { items: [{ id: 'UC1234567890123456789012' }] });
    },
    accessToken: 'access-test',
    expectedChannelId: 'UC1234567890123456789012',
  });
  assert.strictEqual(channel, 'UC1234567890123456789012');

  let refreshBody = '';
  const access = await demo.accessToken({
    fetchImpl: async (target, options) => {
      assert.strictEqual(target, 'https://oauth2.googleapis.com/token');
      refreshBody = options.body;
      return response(200, { access_token: 'access-from-refresh' });
    },
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
  });
  assert.strictEqual(access, 'access-from-refresh');
  assert.strictEqual(
    new URLSearchParams(refreshBody).get('grant_type'),
    'refresh_token',
  );

  const uploadSession = await demo.startUpload({
    fetchImpl: async (target, options) => {
      assert.ok(String(target).includes('uploadType=resumable'));
      assert.strictEqual(options.headers.authorization, 'Bearer access-test');
      const body = JSON.parse(options.body);
      assert.strictEqual(body.status.privacyStatus, 'unlisted');
      assert.strictEqual(body.status.selfDeclaredMadeForKids, false);
      return response(
        200,
        {},
        {
          location:
            'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=test',
        },
      );
    },
    token: 'access-test',
    size: 2048,
  });
  assert.ok(uploadSession.startsWith('https://www.googleapis.com/upload/youtube/v3/videos'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-oauth-tool-test-'));
  const file = path.join(tmp, 'demo.mp4');
  fs.writeFileSync(file, Buffer.alloc(2048, 7));
  try {
    let uploadedRange = '';
    const videoId = await demo.uploadFile({
      fetchImpl: async (target, options) => {
        assert.ok(String(target).startsWith('https://www.googleapis.com/upload/youtube/v3/videos'));
        uploadedRange = options.headers['content-range'];
        assert.strictEqual(options.body.length, 2048);
        return response(200, { id: 'Abcdef12345' });
      },
      token: 'access-test',
      uploadUrl:
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=test',
      filePath: file,
      size: 2048,
    });
    assert.strictEqual(videoId, 'Abcdef12345');
    assert.strictEqual(uploadedRange, 'bytes 0-2047/2048');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const status = await demo.videoStatus({
    fetchImpl: async () => response(200, {
      items: [{
        status: { privacyStatus: 'unlisted', uploadStatus: 'processed' },
        processingDetails: { processingStatus: 'succeeded' },
      }],
    }),
    token: 'access-test',
    videoId: 'Abcdef12345',
  });
  assert.deepStrictEqual(status, {
    processingStatus: 'succeeded',
    privacyStatus: 'unlisted',
    uploadStatus: 'processed',
  });

  const commentsOff = await demo.commentsDisabled({
    fetchImpl: async () => response(403, {
      error: { errors: [{ reason: 'commentsDisabled' }] },
    }),
    token: 'access-test',
    videoId: 'Abcdef12345',
  });
  assert.strictEqual(commentsOff, true);

  let deleteMethod = '';
  await demo.deleteVideo({
    fetchImpl: async (target, options) => {
      assert.ok(String(target).includes('/youtube/v3/videos?id='));
      deleteMethod = options.method;
      return response(204);
    },
    token: 'access-test',
    videoId: 'Abcdef12345',
  });
  assert.strictEqual(deleteMethod, 'DELETE');

  console.log('YouTube OAuth provisioning and force-ssl demo tools: PASS');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
