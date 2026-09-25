'use strict';

const crypto = require('crypto');

function isTrue(value) {
  return String(value || '').toLowerCase() === 'true';
}

function isHttps(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validEmail(value) {
  const email = String(value || '').trim();
  return email.length >= 5 && email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
}

function extractFromEmail(value) {
  const raw = String(value || '').trim();
  const angle = raw.match(/<([^<>]+)>\s*$/);
  return (angle ? angle[1] : raw).trim().toLowerCase();
}

function isProductionSender(value) {
  const email = extractFromEmail(value);
  if (!validEmail(email)) return false;
  const domain = email.split('@')[1] || '';
  if (domain === 'resend.dev' || domain === 'example.invalid') return false;
  if (domain === 'localhost' || domain.endsWith('.localhost')) return false;
  if (domain.endsWith('.example') || domain.endsWith('.invalid') || domain.endsWith('.test')) return false;
  return true;
}

function validateDerivationKeys(env, invalid) {
  const keyId = String(env.SIGILLUM_DERIVATION_KEY_ID || '').trim();
  const privatePem = String(env.SIGILLUM_DERIVATION_PRIVATE_KEY_PEM || '')
    .replace(/\\n/g, '\n')
    .trim();
  const pinnedRaw = String(env.SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON || '').trim();
  if (!keyId || !privatePem || !pinnedRaw) return;

  try {
    const privateKey = crypto.createPrivateKey(privatePem);
    const modulusLength = Number(
      privateKey.asymmetricKeyDetails?.modulusLength || 0,
    );
    if (privateKey.asymmetricKeyType !== 'rsa' || modulusLength < 2048) {
      throw new Error('DERIVATION_PRIVATE_KEY_NOT_RSA_2048');
    }

    const pinnedMap = JSON.parse(pinnedRaw);
    if (!pinnedMap || typeof pinnedMap !== 'object' || Array.isArray(pinnedMap)) {
      throw new Error('DERIVATION_PUBLIC_KEYS_INVALID');
    }
    const pinnedPem = pinnedMap[keyId];
    if (typeof pinnedPem !== 'string' || !pinnedPem.trim()) {
      throw new Error('DERIVATION_PIN_MISSING');
    }

    const derivedPublic = crypto
      .createPublicKey(privateKey)
      .export({ format: 'pem', type: 'spki' })
      .toString()
      .trim();
    const pinnedPublic = crypto
      .createPublicKey(pinnedPem)
      .export({ format: 'pem', type: 'spki' })
      .toString()
      .trim();
    if (derivedPublic !== pinnedPublic) {
      throw new Error('DERIVATION_KEY_PIN_MISMATCH');
    }
  } catch (_) {
    invalid.push('SIGILLUM_DERIVATION_KEYS=matching-rsa-2048');
  }
}

function validateProductionConfig(env = process.env) {
  const live = isTrue(env.PRODUCTION_LIVE);
  if (!live) return { live: false, ready: false, missing: [], invalid: [] };

  const missing = [];
  const invalid = [];
  const required = [
    'DATABASE_URL',
    'STRIPE_SECRET_KEY',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'SUPPORT_EMAIL',
    'PRIVACY_EMAIL',
    'APP_BASE_URL',
    'SIGILLUM_KYC_RETURN_URL',
    'APPLE_APP_ID',
    'APPLE_IAP_ISSUER_ID',
    'APPLE_IAP_KEY_ID',
    'TERMS_VERSION',
    'PRIVACY_VERSION',
    'YOUTUBE_CLIENT_ID',
    'YOUTUBE_CLIENT_SECRET',
    'YOUTUBE_REFRESH_TOKEN',
    'YOUTUBE_CHANNEL_ID',
    'SIGILLUM_DERIVATION_KEY_ID',
    'SIGILLUM_DERIVATION_PRIVATE_KEY_PEM',
    'SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON',
  ];

  for (const key of required) {
    if (!present(env[key])) missing.push(key);
  }

  if (!present(env.APPLE_IAP_PRIVATE_KEY_BASE64) && !present(env.APPLE_IAP_PRIVATE_KEY)) {
    missing.push('APPLE_IAP_PRIVATE_KEY_BASE64|APPLE_IAP_PRIVATE_KEY');
  }

  if (env.NODE_ENV !== 'production') invalid.push('NODE_ENV=production');
  if (!isTrue(env.SUBSCRIPTIONS_ENFORCED)) invalid.push('SUBSCRIPTIONS_ENFORCED=true');
  if (!isTrue(env.CERTIFICATE_WRITES_ENABLED)) invalid.push('CERTIFICATE_WRITES_ENABLED=true');
  if (String(env.KYC_REQUIRES_SUBSCRIPTION || '').toLowerCase() === 'false') {
    invalid.push('KYC_REQUIRES_SUBSCRIPTION=true');
  }
  if (String(env.APPLE_IAP_ENVIRONMENT || '').toUpperCase() !== 'PRODUCTION') {
    invalid.push('APPLE_IAP_ENVIRONMENT=PRODUCTION');
  }
  if (String(env.APPLE_BUNDLE_ID || '') !== 'com.sigillum.hcv') {
    invalid.push('APPLE_BUNDLE_ID=com.sigillum.hcv');
  }
  if (!/^\d+$/.test(String(env.APPLE_APP_ID || '')) || Number(env.APPLE_APP_ID) <= 0) {
    invalid.push('APPLE_APP_ID=numeric');
  }
  if (present(env.APP_BASE_URL) && !isHttps(env.APP_BASE_URL)) {
    invalid.push('APP_BASE_URL=https');
  }
  if (present(env.SIGILLUM_KYC_RETURN_URL) && !isHttps(env.SIGILLUM_KYC_RETURN_URL)) {
    invalid.push('SIGILLUM_KYC_RETURN_URL=https');
  }
  if (present(env.STRIPE_SECRET_KEY) && !/^([sr]k)_live_/.test(env.STRIPE_SECRET_KEY)) {
    invalid.push('STRIPE_SECRET_KEY=live');
  }
  if (present(env.RESEND_API_KEY) && !/^re_[A-Za-z0-9_-]+$/.test(String(env.RESEND_API_KEY))) {
    invalid.push('RESEND_API_KEY=format');
  }
  if (present(env.EMAIL_FROM) && !isProductionSender(env.EMAIL_FROM)) {
    invalid.push('EMAIL_FROM=verified-production-domain');
  }
  if (present(env.SUPPORT_EMAIL) && !validEmail(env.SUPPORT_EMAIL)) {
    invalid.push('SUPPORT_EMAIL=email');
  }
  if (present(env.PRIVACY_EMAIL) && !validEmail(env.PRIVACY_EMAIL)) {
    invalid.push('PRIVACY_EMAIL=email');
  }
  if (present(env.YOUTUBE_CHANNEL_ID) &&
      !/^UC[A-Za-z0-9_-]{22}$/.test(String(env.YOUTUBE_CHANNEL_ID))) {
    invalid.push('YOUTUBE_CHANNEL_ID=channel-id');
  }
  if (!isTrue(env.YOUTUBE_COMPLIANCE_APPROVED)) {
    invalid.push('YOUTUBE_COMPLIANCE_APPROVED=true');
  }
  if (!isTrue(env.YOUTUBE_UNLISTED_UPLOAD_CONFIRMED)) {
    invalid.push('YOUTUBE_UNLISTED_UPLOAD_CONFIRMED=true');
  }
  if (present(env.SIGILLUM_DERIVATION_KEY_ID) &&
      !/^[A-Za-z0-9._-]{3,80}$/.test(String(env.SIGILLUM_DERIVATION_KEY_ID))) {
    invalid.push('SIGILLUM_DERIVATION_KEY_ID=format');
  }
  validateDerivationKeys(env, invalid);

  return {
    live: true,
    ready: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
  };
}

function assertProductionConfig(env = process.env) {
  const result = validateProductionConfig(env);
  if (result.live && !result.ready) {
    const details = [...result.missing.map(key => `missing:${key}`), ...result.invalid.map(value => `invalid:${value}`)];
    const error = new Error(`SIGILLUM_PRODUCTION_NOT_READY ${details.join(', ')}`);
    error.code = 'SIGILLUM_PRODUCTION_NOT_READY';
    error.details = result;
    throw error;
  }
  return result;
}

module.exports = {
  assertProductionConfig,
  validateProductionConfig,
};
