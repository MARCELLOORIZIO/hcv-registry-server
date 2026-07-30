const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function base64UrlToBase64(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return padded + '='.repeat((4 - (padded.length % 4)) % 4);
}

function deviceProof(privateKey, publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  const normalizedPublicKey = {
    modulus: base64UrlToBase64(jwk.n),
    exponent: base64UrlToBase64(jwk.e),
  };
  const deviceKeyFingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(normalizedPublicKey), 'utf8')
    .digest('hex');
  const signedAt = new Date().toISOString();
  const statement = JSON.stringify({
    purpose: 'SIGILLUM_AUTH_DEVICE_BINDING_V1',
    deviceKeyFingerprint,
    signedAt,
  });
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(statement, 'utf8'), privateKey)
    .toString('base64');
  return {
    deviceKeyFingerprint,
    publicKey: normalizedPublicKey,
    signedAt,
    signature,
  };
}

async function request(baseUrl, method, route, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let decoded = {};
  try {
    decoded = JSON.parse(text || '{}');
  } catch (_) {}
  return { status: response.status, body: decoded };
}

async function waitForHealth(baseUrl, child, logs) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Server exited early (${child.exitCode})\n${logs.join('')}`);
    }
    try {
      const result = await request(baseUrl, 'GET', '/health');
      if (result.status === 200 && result.body.authApi === true) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become healthy\n${logs.join('')}`);
}

async function main() {
  const basePort = 19000 + (process.pid % 1000) * 3;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-auth-'));
  const dbPath = path.join(tempDir, 'registry.db');
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(basePort),
      AUTH_UPSTREAM_PORT: String(basePort + 1),
      AUTH_LEGACY_PORT: String(basePort + 2),
      DB_PATH: dbPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => logs.push(data.toString()));
  child.stderr.on('data', data => logs.push(data.toString()));

  const baseUrl = `http://127.0.0.1:${basePort}`;
  try {
    await waitForHealth(baseUrl, child, logs);

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const email = `smoke-${Date.now()}@sigillum.test`;
    const originalPassword = 'StrongPassword123!';
    const newPassword = 'NewStrongPassword456!';

    const registration = await request(baseUrl, 'POST', '/api/auth/register', {
      body: {
        email,
        password: originalPassword,
        creatorName: 'Smoke Test Creator',
        creatorId: crypto.randomUUID(),
        ...deviceProof(privateKey, publicKey),
      },
    });
    assert.strictEqual(registration.status, 201, JSON.stringify(registration.body));
    assert.ok(registration.body.token);
    assert.strictEqual(registration.body.account.email, email);
    const firstToken = registration.body.token;

    const session = await request(baseUrl, 'GET', '/api/auth/session', {
      token: firstToken,
    });
    assert.strictEqual(session.status, 200, JSON.stringify(session.body));
    assert.strictEqual(session.body.account.creatorName, 'Smoke Test Creator');

    const profile = await request(baseUrl, 'POST', '/api/auth/profile', {
      token: firstToken,
      body: { creatorName: 'Updated Smoke Creator' },
    });
    assert.strictEqual(profile.status, 200, JSON.stringify(profile.body));
    assert.strictEqual(profile.body.account.creatorName, 'Updated Smoke Creator');

    const password = await request(baseUrl, 'POST', '/api/auth/password', {
      token: firstToken,
      body: {
        currentPassword: originalPassword,
        newPassword,
      },
    });
    assert.strictEqual(password.status, 200, JSON.stringify(password.body));

    const logout = await request(baseUrl, 'POST', '/api/auth/logout', {
      token: firstToken,
    });
    assert.strictEqual(logout.status, 200, JSON.stringify(logout.body));

    const revokedSession = await request(baseUrl, 'GET', '/api/auth/session', {
      token: firstToken,
    });
    assert.strictEqual(revokedSession.status, 401);

    const login = await request(baseUrl, 'POST', '/api/auth/login', {
      body: {
        email,
        password: newPassword,
        ...deviceProof(privateKey, publicKey),
      },
    });
    assert.strictEqual(login.status, 200, JSON.stringify(login.body));
    assert.ok(login.body.token);
    const secondToken = login.body.token;

    const deletion = await request(baseUrl, 'POST', '/api/auth/delete', {
      token: secondToken,
      body: {
        password: newPassword,
        confirmation: 'DELETE',
      },
    });
    assert.strictEqual(deletion.status, 200, JSON.stringify(deletion.body));
    assert.strictEqual(deletion.body.deleted, true);

    const deletedSession = await request(baseUrl, 'GET', '/api/auth/session', {
      token: secondToken,
    });
    assert.strictEqual(deletedSession.status, 401);

    console.log('SIGILLUM account smoke test passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode != null) return resolve();
      child.once('exit', resolve);
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000).unref();
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
