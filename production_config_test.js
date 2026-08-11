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
  KYC_REQUIRES_SUBSCRIPTION: 'true',
  STRIPE_SECRET_KEY: 'sk_live_SIGILLUM_TEST_ONLY',
  RESEND_API_KEY: 're_TEST_ONLY',
  EMAIL_FROM: 'SIGILLUM <noreply@sigillum.example>',
  SUPPORT_EMAIL: 'support@sigillum.example',
  PRIVACY_EMAIL: 'privacy@sigillum.example',
  APP_BASE_URL: 'https://sigillum.example',
  SIGILLUM_KYC_RETURN_URL: 'https://sigillum.example/kyc-return',
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

const unsafeStripe = { ...readyEnv, STRIPE_SECRET_KEY: 'sk_test_not_live' };
const unsafe = validateProductionConfig(unsafeStripe);
expect(unsafe.ready === false, 'test Stripe key must not be accepted for LIVE');

console.log(JSON.stringify({
  ok: true,
  prelaunchAllowed: true,
  incompleteLiveRejected: true,
  completeLiveAccepted: true,
  testStripeRejectedForLive: true,
}, null, 2));
