const crypto = require('crypto');

const email = String(process.env.TEST_EMAIL || '').trim();
const baseUrl = String(process.env.TEST_BASE_URL || 'https://sigillum-registry-production.onrender.com').replace(/\/$/, '');

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

async function request(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let decoded = {};
  try { decoded = JSON.parse(text || '{}'); } catch (_) {}
  return { status: response.status, body: decoded, text };
}

async function main() {
  const registration = await request('/api/auth/register', {
    email,
    password: 'Sigillum-Prelaunch-2026!',
    creatorName: 'SIGILLUM Prelaunch Test',
    creatorId: crypto.randomUUID(),
    acceptTerms: true,
    acknowledgePrivacy: true,
    adultConfirmed: true,
    ...deviceProof(),
  });

  if (registration.status === 201) {
    console.log('SIGILLUM_EMAIL_TEST: REGISTRATION_OK');
    console.log('SIGILLUM_EMAIL_TEST: VERIFICATION_EMAIL_REQUESTED');
    return;
  }

  if (registration.status === 409 || registration.body?.error === 'ACCOUNT_ESISTENTE') {
    const resend = await request('/api/auth/resend-email-code', { email });
    if (resend.status === 200) {
      console.log('SIGILLUM_EMAIL_TEST: ACCOUNT_ALREADY_EXISTS');
      console.log('SIGILLUM_EMAIL_TEST: VERIFICATION_EMAIL_REQUESTED');
      return;
    }
    console.error(`SIGILLUM_EMAIL_TEST: RESEND_FAILED HTTP ${resend.status}`);
    console.error(resend.text);
    process.exit(1);
  }

  console.error(`SIGILLUM_EMAIL_TEST: REGISTER_FAILED HTTP ${registration.status}`);
  console.error(registration.text);
  process.exit(1);
}

main().catch(error => {
  console.error('SIGILLUM_EMAIL_TEST: ERROR');
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
