const { assertProductionConfig, validateProductionConfig } = require('./production_config');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const prelaunch = validateProductionConfig({ PRODUCTION_LIVE: 'false' });
expect(prelaunch.live === false, 'prelaunch must not be live');

let rejected = false;
try {
  assertProductionConfig({ PRODUCTION_LIVE: 'true', NODE_ENV: 'production' });
} catch (error) {
  rejected = error.code === 'SIGILLUM_PRODUCTION_NOT_READY';
}
expect(rejected, 'incomplete LIVE configuration must be rejected');

const readyEnv = {
  PRODUCTION_LIVE: 'true',
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://internal.example/sigillum',
  SUBSCRIPTIONS_ENFORCED: 'true',
  CERTIFICATE_WRITES_ENABLED: 'true',
  KYC_REQUIRES_SUBSCRIPTION: 'true',
  STRIPE_SECRET_KEY: 'sk_live_SIGILLUM_TEST_ONLY',
  RESEND_API_KEY: 're_SIGILLUM_TEST_ONLY',
  EMAIL_FROM: 'SIGILLUM <noreply@sigillum-hcv.com>',
  SUPPORT_EMAIL: 'support@sigillum-hcv.com',
  PRIVACY_EMAIL: 'privacy@sigillum-hcv.com',
  APP_BASE_URL: 'https://sigillum-hcv.com',
  SIGILLUM_KYC_RETURN_URL: 'https://sigillum-hcv.com/kyc-return',
  APPLE_BUNDLE_ID: 'com.sigillum.hcv',
  APPLE_APP_ID: '1234567890',
  APPLE_IAP_ENVIRONMENT: 'PRODUCTION',
  APPLE_IAP_ISSUER_ID: 'issuer-test',
  APPLE_IAP_KEY_ID: 'key-test',
  APPLE_IAP_PRIVATE_KEY_BASE64: 'dGVzdA==',
  TERMS_VERSION: '2026-08-11',
  PRIVACY_VERSION: '2026-08-11',
};
const ready = assertProductionConfig(readyEnv);
expect(ready.live === true && ready.ready === true, 'complete LIVE configuration must be accepted');

const writesOff = { ...readyEnv, CERTIFICATE_WRITES_ENABLED: 'false' };
expect(validateProductionConfig(writesOff).ready === false, 'LIVE must reject disabled certificate writes');

const unsafeStripe = { ...readyEnv, STRIPE_SECRET_KEY: 'sk_test_not_live' };
expect(validateProductionConfig(unsafeStripe).ready === false, 'test Stripe key must not be accepted for LIVE');

const resendDevSender = { ...readyEnv, EMAIL_FROM: 'SIGILLUM <onboarding@resend.dev>' };
expect(validateProductionConfig(resendDevSender).ready === false, 'resend.dev sender must not be accepted for LIVE');

const invalidSender = { ...readyEnv, EMAIL_FROM: 'SIGILLUM <noreply@example.invalid>' };
expect(validateProductionConfig(invalidSender).ready === false, 'reserved sender domain must not be accepted for LIVE');

const invalidSupport = { ...readyEnv, SUPPORT_EMAIL: 'not-an-email' };
expect(validateProductionConfig(invalidSupport).ready === false, 'invalid support email must not be accepted for LIVE');

console.log(JSON.stringify({
  ok: true,
  prelaunchAllowed: true,
  incompleteLiveRejected: true,
  completeLiveAccepted: true,
  writesMustBeEnabledForLive: true,
  testStripeRejectedForLive: true,
  resendDevRejectedForLive: true,
  reservedSenderRejectedForLive: true,
  invalidSupportRejectedForLive: true,
}, null, 2));
