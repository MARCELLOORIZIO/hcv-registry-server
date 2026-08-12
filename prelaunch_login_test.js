const crypto = require('crypto');

const email = String(process.env.TEST_EMAIL || '').trim();
const baseUrl = String(process.env.TEST_BASE_URL || 'https://sigillum-registry-production.onrender.com').replace(/\/$/, '');
const password = String(process.env.TEST_PASSWORD || 'Sigillum-Prelaunch-2026!');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('TEST_EMAIL_REQUIRED');
  process.exit(2);
}

function base64UrlToBase64(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
}

function deviceProof() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const publicKeyNormalized = {
    modulus: base64UrlToBase64(jwk.n),
    exponent: base64UrlToBase64(jwk.e),
  };
  const deviceKeyFingerprint = crypto.createHash('sha256')
    .update(JSON.stringify(publicKeyNormalized), 'utf8')
    .digest('hex');
  const signedAt = new Date().toISOString();
  const statement = JSON.stringify({
    purpose: 'SIGILLUM_AUTH_DEVICE_BINDING_V1',
    deviceKeyFingerprint,
    signedAt,
  });
  const signature = crypto.sign('RSA-SHA256', Buffer.from(statement, 'utf8'), privateKey).toString('base64');
  return { deviceKeyFingerprint, publicKey: publicKeyNormalized, signedAt, signature };
}

async function request(method, route, { token, body } = {}) {
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
  try { decoded = JSON.parse(text || '{}'); } catch (_) {}
  return { status: response.status, body: decoded, text };
}

async function main() {
  const login = await request('POST', '/api/auth/login', {
    body: {
      email,
      password,
      ...deviceProof(),
    },
  });

  if (login.status !== 200 || !login.body?.token) {
    console.error(`SIGILLUM_LOGIN_TEST: LOGIN_FAILED HTTP ${login.status}`);
    console.error(login.text);
    process.exit(1);
  }

  const token = login.body.token;
  console.log('SIGILLUM_LOGIN_TEST: LOGIN_OK');

  const session = await request('GET', '/api/auth/session', { token });
  if (session.status !== 200 || !session.body?.account) {
    console.error(`SIGILLUM_LOGIN_TEST: SESSION_FAILED HTTP ${session.status}`);
    console.error(session.text);
    process.exit(1);
  }

  const account = session.body.account;
  console.log('SIGILLUM_LOGIN_TEST: SESSION_OK');
  console.log(JSON.stringify({
    emailVerified: account.emailVerified,
    termsAccepted: account.termsAccepted,
    privacyAcknowledged: account.privacyAcknowledged,
    adultConfirmed: account.adultConfirmed,
    kycStatus: account.kycStatus,
    legalIdentityVerified: account.legalIdentityVerified,
    subscriptionStatus: account.subscriptionStatus,
    creatorAccess: account.creatorAccess,
  }));

  const logout = await request('POST', '/api/auth/logout', { token });
  if (logout.status !== 200) {
    console.error(`SIGILLUM_LOGIN_TEST: LOGOUT_FAILED HTTP ${logout.status}`);
    console.error(logout.text);
    process.exit(1);
  }
  console.log('SIGILLUM_LOGIN_TEST: LOGOUT_OK');
}

main().catch(error => {
  console.error('SIGILLUM_LOGIN_TEST: ERROR');
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
