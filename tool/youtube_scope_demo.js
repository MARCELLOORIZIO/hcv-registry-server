'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { verifyChannel } = require('./youtube_oauth_provision');

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

function requiredEnv(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error('Missing required environment variable: ' + key);
  return value;
}

function refreshToken(env = process.env) {
  const direct = String(env.YOUTUBE_REFRESH_TOKEN || '').trim();
  if (direct) return direct;

  const filePath = String(
    env.YOUTUBE_REFRESH_TOKEN_FILE ||
    '.sigillum-youtube-refresh-token.txt'
  ).trim();
  if (filePath && fs.existsSync(filePath)) {
    const value = fs.readFileSync(filePath, 'utf8').trim();
    if (value) return value;
  }

  throw new Error(
    'Missing YOUTUBE_REFRESH_TOKEN and no local refresh-token file was found.',
  );
}

async function accessToken({
  fetchImpl = fetch,
  clientId,
  clientSecret,
  refreshToken,
}) {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(
      'Unable to refresh Google access token: ' +
      String(payload.error || response.status),
    );
  }
  return String(payload.access_token);
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error('Process exited with code ' + code));
    });
  });
}

async function createDemoVideo(outputPath) {
  await runProcess(ffmpegPath, [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=640x360:d=5',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=5',
    '-shortest',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    outputPath,
  ]);
  const stat = fs.statSync(outputPath);
  if (!stat.isFile() || stat.size < 1024) {
    throw new Error('Demo video generation failed.');
  }
  return stat.size;
}

async function startUpload({
  fetchImpl = fetch,
  token,
  size,
}) {
  const response = await fetchImpl(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(size),
        'x-upload-content-type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: 'SIGILLUM OAuth Verification Demo — temporary',
          description: [
            'Temporary SIGILLUM OAuth scope verification asset.',
            'Purpose: demonstrate youtube.force-ssl upload/status/delete operations.',
            'This video is deleted at the end of the administrative demo.',
          ].join('\n'),
        },
        status: {
          privacyStatus: 'unlisted',
          embeddable: true,
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error('YouTube resumable upload session failed: ' + response.status);
  }
  const location = String(response.headers.get('location') || '');
  const url = new URL(location);
  if (url.protocol !== 'https:' ||
      url.hostname !== 'www.googleapis.com' ||
      !url.pathname.startsWith('/upload/youtube/v3/videos')) {
    throw new Error('Invalid YouTube resumable upload URL.');
  }
  return url.toString();
}

async function uploadFile({
  fetchImpl = fetch,
  token,
  uploadUrl,
  filePath,
  size,
}) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length !== size) throw new Error('Demo video size changed unexpectedly.');
  const response = await fetchImpl(uploadUrl, {
    method: 'PUT',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'video/mp4',
      'content-length': String(size),
      'content-range': 'bytes 0-' + (size - 1) + '/' + size,
    },
    body: bytes,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !/^[A-Za-z0-9_-]{6,32}$/.test(String(payload.id || ''))) {
    throw new Error('YouTube upload failed: ' + response.status);
  }
  return String(payload.id);
}

async function videoStatus({
  fetchImpl = fetch,
  token,
  videoId,
}) {
  const response = await fetchImpl(
    'https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=' +
      encodeURIComponent(videoId),
    { headers: { authorization: 'Bearer ' + token } },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload.items) || payload.items.length !== 1) {
    throw new Error('Unable to read uploaded video status.');
  }
  const item = payload.items[0];
  return {
    processingStatus: String(item.processingDetails?.processingStatus || ''),
    privacyStatus: String(item.status?.privacyStatus || ''),
    uploadStatus: String(item.status?.uploadStatus || ''),
  };
}

async function waitReady(args) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (true) {
    const status = await videoStatus(args);
    if (status.processingStatus === 'succeeded' &&
        status.privacyStatus === 'unlisted' &&
        status.uploadStatus !== 'failed') {
      return status;
    }
    if (status.processingStatus === 'failed' || status.uploadStatus === 'failed') {
      throw new Error('YouTube processing failed.');
    }
    if (Date.now() >= deadline) throw new Error('YouTube processing timed out.');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

async function commentsDisabled({
  fetchImpl = fetch,
  token,
  videoId,
}) {
  const response = await fetchImpl(
    'https://www.googleapis.com/youtube/v3/commentThreads?part=id&maxResults=1&videoId=' +
      encodeURIComponent(videoId),
    { headers: { authorization: 'Bearer ' + token } },
  );
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return false;
  const reasons = Array.isArray(payload?.error?.errors)
    ? payload.error.errors.map(item => String(item?.reason || ''))
    : [];
  return response.status === 403 && reasons.includes('commentsDisabled');
}

async function deleteVideo({
  fetchImpl = fetch,
  token,
  videoId,
}) {
  const response = await fetchImpl(
    'https://www.googleapis.com/youtube/v3/videos?id=' +
      encodeURIComponent(videoId),
    {
      method: 'DELETE',
      headers: { authorization: 'Bearer ' + token },
    },
  );
  if (!(response.status === 204 || response.status === 404 || response.ok)) {
    throw new Error('YouTube delete failed: ' + response.status);
  }
}

function waitForEnter(message) {
  if (!process.stdin.isTTY) return Promise.resolve();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function main(env = process.env) {
  const clientId = requiredEnv(env, 'YOUTUBE_CLIENT_ID');
  const clientSecret = requiredEnv(env, 'YOUTUBE_CLIENT_SECRET');
  const storedRefreshToken = refreshToken(env);
  const channelId = requiredEnv(env, 'YOUTUBE_CHANNEL_ID');

  console.log('');
  console.log('SIGILLUM YouTube scope demonstration');
  console.log('Scope: ' + SCOPE);
  console.log('Flow: token refresh -> channel check -> unlisted upload -> status -> comments -> delete');
  console.log('');

  const token = await accessToken({
    clientId,
    clientSecret,
    refreshToken: storedRefreshToken,
  });
  const actualChannel = await verifyChannel({
    accessToken: token,
    expectedChannelId: channelId,
  });
  console.log('Authorized channel verified: ' + actualChannel);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-youtube-demo-'));
  const filePath = path.join(tempDir, 'sigillum-oauth-demo.mp4');
  let videoId = '';

  try {
    const size = await createDemoVideo(filePath);
    console.log('Temporary demo video generated: ' + size + ' bytes');

    const uploadUrl = await startUpload({ token, size });
    videoId = await uploadFile({
      token,
      uploadUrl,
      filePath,
      size,
    });
    console.log('Temporary YouTube video uploaded.');
    console.log('Video ID: ' + videoId);
    console.log('Watch URL: https://www.youtube.com/watch?v=' + videoId);

    const status = await waitReady({ token, videoId });
    console.log('Processing status: ' + status.processingStatus);
    console.log('Privacy status: ' + status.privacyStatus);

    const disabled = await commentsDisabled({ token, videoId });
    console.log('Comments disabled: ' + disabled);
    if (!disabled) {
      console.log(
        'Comments diagnostic: enabled or not confirmed. This is advisory only; ' +
        'YouTube Data API does not expose a supported per-video comments-off write field.',
      );
    }

    await waitForEnter(
      'The temporary reference is ready. Show it in YouTube Studio if desired, then press ENTER to demonstrate deletion... ',
    );

    await deleteVideo({ token, videoId });
    console.log('Temporary YouTube video deleted successfully.');
    videoId = '';
    console.log('youtube.force-ssl demo completed successfully.');
  } finally {
    if (videoId) {
      try {
        await deleteVideo({ token, videoId });
        console.log('Cleanup: temporary YouTube video deleted.');
      } catch (error) {
        console.error('WARNING: cleanup delete failed:', error.message);
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('ERROR:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  SCOPE,
  refreshToken,
  accessToken,
  startUpload,
  uploadFile,
  videoStatus,
  commentsDisabled,
  deleteVideo,
};
