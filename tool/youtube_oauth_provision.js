'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const DEFAULT_PORT = 53682;
const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

function requiredEnv(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error('Missing required environment variable: ' + key);
  return value;
}

function redirectUri(port = DEFAULT_PORT) {
  return 'http://127.0.0.1:' + port + '/oauth2/callback';
}

function buildAuthorizationUrl({
  clientId,
  state,
  port = DEFAULT_PORT,
  scope = DEFAULT_SCOPE,
}) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri(port));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('state', state);
  return url;
}

async function exchangeCode({
  fetchImpl = fetch,
  clientId,
  clientSecret,
  code,
  port = DEFAULT_PORT,
}) {
  const response = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri(port),
      grant_type: 'authorization_code',
    }).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      'OAuth token exchange failed (' + response.status + '): ' +
      String(payload.error || 'unknown_error'),
    );
  }
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error(
      'Google did not return both access_token and refresh_token. ' +
      'Revoke the previous SIGILLUM grant if necessary and rerun with prompt=consent.',
    );
  }
  return payload;
}

async function verifyChannel({
  fetchImpl = fetch,
  accessToken,
  expectedChannelId,
}) {
  const response = await fetchImpl(
    'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
    { headers: { authorization: 'Bearer ' + accessToken } },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok ||
      !Array.isArray(payload.items) ||
      payload.items.length !== 1) {
    throw new Error('Unable to verify the authorized YouTube channel.');
  }
  const actual = String(payload.items[0]?.id || '');
  if (actual !== expectedChannelId) {
    throw new Error(
      'Authorized channel mismatch. Expected ' + expectedChannelId +
      ', got ' + actual,
    );
  }
  return actual;
}

function openBrowser(url) {
  const value = String(url);
  let child;
  if (process.platform === 'win32') {
    child = spawn('cmd', ['/c', 'start', '', value], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else if (process.platform === 'darwin') {
    child = spawn('open', [value], { detached: true, stdio: 'ignore' });
  } else {
    child = spawn('xdg-open', [value], { detached: true, stdio: 'ignore' });
  }
  child.on('error', () => {});
  child.unref();
}

function successHtml(channelId) {
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>SIGILLUM OAuth complete</title></head>' +
    '<body style="font-family:Arial,sans-serif;padding:40px">' +
    '<h1>SIGILLUM OAuth authorization complete</h1>' +
    '<p>The authorized YouTube channel was verified successfully.</p>' +
    '<p><strong>Channel ID:</strong> ' + channelId.replace(/[<>&"]/g, '') + '</p>' +
    '<p>You may close this tab and return to the terminal.</p>' +
    '</body></html>';
}

async function main(env = process.env) {
  const clientId = requiredEnv(env, 'YOUTUBE_CLIENT_ID');
  const clientSecret = requiredEnv(env, 'YOUTUBE_CLIENT_SECRET');
  const channelId = requiredEnv(env, 'YOUTUBE_CHANNEL_ID');
  const port = Number(env.YOUTUBE_OAUTH_LOCAL_PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('YOUTUBE_OAUTH_LOCAL_PORT must be an integer between 1024 and 65535.');
  }

  const state = crypto.randomBytes(32).toString('base64url');
  const authUrl = buildAuthorizationUrl({ clientId, state, port });

  console.log('');
  console.log('SIGILLUM YouTube OAuth provisioning');
  console.log('-----------------------------------');
  console.log('Authorized redirect URI required in Google Cloud:');
  console.log(redirectUri(port));
  console.log('');
  console.log('Opening the Google consent screen in your browser.');
  console.log('For the verification recording, set the consent-screen language to English.');
  console.log('');
  console.log('If the browser does not open, paste this URL manually:');
  console.log(authUrl.toString());
  console.log('');

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('OAuth callback timeout after 10 minutes.'));
    }, 10 * 60 * 1000);

    const server = http.createServer(async (req, res) => {
      try {
        const incoming = new URL(req.url, 'http://127.0.0.1:' + port);
        if (incoming.pathname !== '/oauth2/callback') {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        if (incoming.searchParams.get('state') !== state) {
          throw new Error('OAuth state mismatch.');
        }
        const oauthError = incoming.searchParams.get('error');
        if (oauthError) throw new Error('Google OAuth returned: ' + oauthError);
        const code = incoming.searchParams.get('code');
        if (!code) throw new Error('OAuth callback did not contain a code.');

        const tokens = await exchangeCode({
          clientId,
          clientSecret,
          code,
          port,
        });
        const actualChannelId = await verifyChannel({
          accessToken: tokens.access_token,
          expectedChannelId: channelId,
        });

        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(successHtml(actualChannelId));
        clearTimeout(timer);
        server.close();
        resolve({
          refreshToken: tokens.refresh_token,
          scope: String(tokens.scope || DEFAULT_SCOPE),
          channelId: actualChannelId,
        });
      } catch (error) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('SIGILLUM OAuth provisioning failed. Return to the terminal.');
        clearTimeout(timer);
        server.close();
        reject(error);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      openBrowser(authUrl);
    });
    server.on('error', reject);
  });

  const output = String(
    env.YOUTUBE_REFRESH_TOKEN_OUTPUT ||
    '.sigillum-youtube-refresh-token.txt'
  );
  fs.writeFileSync(output, result.refreshToken + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });

  console.log('OAuth authorization verified.');
  console.log('Channel ID: ' + result.channelId);
  console.log('Granted scope: ' + result.scope);
  console.log('Refresh token saved locally to: ' + output);
  console.log('');
  console.log('Do NOT upload this file or commit it to Git.');
  console.log('Copy its value directly into Render as YOUTUBE_REFRESH_TOKEN, then delete the local file.');
}

if (require.main === module) {
  main().catch(error => {
    console.error('ERROR:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_SCOPE,
  redirectUri,
  buildAuthorizationUrl,
  exchangeCode,
  verifyChannel,
};
