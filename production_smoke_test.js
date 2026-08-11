const crypto = require('crypto');

const BASE = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8080';
const CODE = process.env.TEST_FIXED_CODE || '123456';
const email = `sigillum-ci-${Date.now()}@example.com`;
const password = 'SIGILLUM-Test-Password-2026';
const nextPassword = 'SIGILLUM-Test-Password-2026-NEW';

function b64urlToBuffer(value) {
  return Buffer.from(value, 'base64url');
}

function buildDevice() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { format: 'jwk' },
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  });
  const normalized = {
    modulus: b64urlToBuffer(publicKey.n).toString('base64'),
    exponent: b64urlToBuffer(publicKey.e).toString('base64'),
  };
  const fingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized), 'utf8')
    .digest('hex');
  return { privateKey, normalized, fingerprint };
}

function proof(device) {
  const signedAt = new Date().toISOString();
  const statement = JSON.stringify({
    purpose: 'SIGILLUM_AUTH_DEVICE_BINDING_V1',
    deviceKeyFingerprint: device.fingerprint,
    signedAt,
  });
  return {
    deviceKeyFingerprint: device.fingerprint,
    publicKey: device.normalized,
    signedAt,
    signature: crypto.sign(
      'RSA-SHA256',
      Buffer.from(statement, 'utf8'),
      device.privateKey,
    ).toString('base64'),
  };
}

async function request(method, path, body, token) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  return { status: response.status, data };
}

function expect(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function main() {
  const device = buildDevice();

  let result = await request('POST', '/api/auth/register', {
    email,
    password,
    creatorName: 'SIGILLUM CI Creator',
    creatorId: 'CI-CREATOR',
    acceptTerms: true,
    acknowledgePrivacy: true,
    adultConfirmed: true,
    ...proof(device),
  });
  expect(result.status, 201, 'register');

  result = await request('POST', '/api/auth/verify-email', { email, code: CODE });
  expect(result.status, 200, 'verify email');

  result = await request('POST', '/api/auth/login', {
    email,
    password,
    ...proof(device),
  });
  expect(result.status, 200, 'login');
  const token = result.data.token;
  if (!token) throw new Error('login did not return token');
  if (result.data.account?.emailVerified !== true) throw new Error('emailVerified not true');

  result = await request('GET', '/api/auth/session', null, token);
  expect(result.status, 200, 'restore session');
  if (result.data.account?.termsAccepted !== true) throw new Error('terms not persisted');
  if (result.data.account?.privacyAcknowledged !== true) throw new Error('privacy acknowledgement not persisted');
  if (result.data.account?.adultConfirmed !== true) throw new Error('adult confirmation not persisted');

  result = await request('POST', '/api/auth/password', {
    currentPassword: password,
    newPassword: nextPassword,
  }, token);
  expect(result.status, 200, 'change password');

  result = await request('POST', '/api/auth/login', {
    email,
    password: nextPassword,
    ...proof(device),
  });
  expect(result.status, 200, 'login with new password');
  const nextToken = result.data.token;

  result = await request('GET', '/api/billing/status', null, nextToken);
  expect(result.status, 200, 'billing status');
  if (result.data.enforced !== false) throw new Error('test billing enforcement should be false');

  result = await request('POST', '/api/certificate', {
    hcvId: 'HCV-AAAAAAAAAAAAAAAA',
    certificateRaw: '{}',
  }, nextToken);
  expect(result.status, 403, 'unverified identity must block creator certificate');

  result = await request('POST', '/api/auth/logout', {}, nextToken);
  expect(result.status, 200, 'logout');

  console.log(JSON.stringify({
    ok: true,
    accountFlow: true,
    emailVerification: true,
    passwordChange: true,
    session: true,
    creatorGateBlocksUnverifiedIdentity: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
