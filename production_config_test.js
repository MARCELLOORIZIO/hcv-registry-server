const crypto = require('crypto');
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

const derivationKeyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const derivationPrivatePem = derivationKeyPair.privateKey
  .export({ format: 'pem', type: 'pkcs8' })
  .toString();
const derivationPublicPem = derivationKeyPair.publicKey
  .export({ format: 'pem', type: 'spki' })
  .toString();

const r2MasterKey = crypto.randomBytes(32).toString('base64');

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
  TERMS_VERSION: '2026-10-04',
  PRIVACY_VERSION: '2026-10-04',
  SIGILLUM_PRIMARY_REFERENCE_PROVIDER: 'r2',
  R2_ENDPOINT: 'https://account-id.eu.r2.cloudflarestorage.com',
  R2_BUCKET: 'sigillum-hcv-references-eu',
  R2_ACCESS_KEY_ID: 'r2-access-key',
  R2_SECRET_ACCESS_KEY: 'r2-secret-key',
  R2_REQUIRE_EU: 'true',
  R2_REFERENCE_ACTIVE_KEY_ID: 'r2-primary-2026-10',
  R2_REFERENCE_MASTER_KEYS_JSON: JSON.stringify({
    'r2-primary-2026-10': r2MasterKey,
  }),
  SIGILLUM_DERIVATION_KEY_ID: 'sigillum_derivation_prod_v1',
  SIGILLUM_DERIVATION_PRIVATE_KEY_PEM: derivationPrivatePem,
  SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON: JSON.stringify({
    sigillum_derivation_prod_v1: derivationPublicPem,
  }),
};
const ready = assertProductionConfig(readyEnv);
expect(ready.live === true && ready.ready === true, 'complete LIVE configuration must be accepted');

const r2ReadyEnv = readyEnv;
const r2Ready = ready;
expect(
  r2Ready.live === true && r2Ready.ready === true,
  'R2 LIVE configuration must be accepted',
);

const r2WrongJurisdiction = {
  ...r2ReadyEnv,
  R2_ENDPOINT: 'https://account-id.r2.cloudflarestorage.com',
};
expect(
  validateProductionConfig(r2WrongJurisdiction).ready === false,
  'R2 LIVE must require the EU jurisdiction endpoint',
);

const r2MissingSecret = { ...r2ReadyEnv, R2_SECRET_ACCESS_KEY: '' };
expect(
  validateProductionConfig(r2MissingSecret).ready === false,
  'R2 LIVE must require the R2 secret access key',
);

const r2BadKeyRing = {
  ...r2ReadyEnv,
  R2_REFERENCE_MASTER_KEYS_JSON: JSON.stringify({
    'r2-primary-2026-10': Buffer.alloc(16).toString('base64'),
  }),
};
expect(
  validateProductionConfig(r2BadKeyRing).ready === false,
  'R2 LIVE must require a 32-byte active encryption master key',
);

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

const youtubePrimary = {
  ...readyEnv,
  SIGILLUM_PRIMARY_REFERENCE_PROVIDER: 'youtube',
};
expect(
  validateProductionConfig(youtubePrimary).ready === false,
  'LIVE must reject YouTube as the primary reference provider',
);

const missingDerivationKey = { ...readyEnv, SIGILLUM_DERIVATION_PRIVATE_KEY_PEM: '' };
expect(validateProductionConfig(missingDerivationKey).ready === false, 'LIVE must reject missing derivation signing material');

const mismatchedPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const mismatchedPublicPem = mismatchedPair.publicKey
  .export({ format: 'pem', type: 'spki' })
  .toString();
const mismatchedDerivationPin = {
  ...readyEnv,
  SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON: JSON.stringify({
    sigillum_derivation_prod_v1: mismatchedPublicPem,
  }),
};
expect(
  validateProductionConfig(mismatchedDerivationPin).ready === false,
  'LIVE must reject mismatched derivation key pins',
);

const weakPair = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
const weakPrivatePem = weakPair.privateKey
  .export({ format: 'pem', type: 'pkcs8' })
  .toString();
const weakPublicPem = weakPair.publicKey
  .export({ format: 'pem', type: 'spki' })
  .toString();
const weakDerivationKey = {
  ...readyEnv,
  SIGILLUM_DERIVATION_PRIVATE_KEY_PEM: weakPrivatePem,
  SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON: JSON.stringify({
    sigillum_derivation_prod_v1: weakPublicPem,
  }),
};
expect(
  validateProductionConfig(weakDerivationKey).ready === false,
  'LIVE must reject derivation RSA keys below 2048 bits',
);

const malformedDerivationMap = {
  ...readyEnv,
  SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON: '{not-json',
};
expect(
  validateProductionConfig(malformedDerivationMap).ready === false,
  'LIVE must reject malformed derivation public-key configuration',
);

console.log(JSON.stringify({
  ok: true,
  prelaunchAllowed: true,
  incompleteLiveRejected: true,
  completeLiveAccepted: true,
  r2PrimaryLiveAcceptedWithoutYoutube: true,
  r2EuJurisdictionRequired: true,
  r2EncryptionMasterKeyRequired: true,
  writesMustBeEnabledForLive: true,
  testStripeRejectedForLive: true,
  resendDevRejectedForLive: true,
  reservedSenderRejectedForLive: true,
  invalidSupportRejectedForLive: true,
  youtubePrimaryRejectedForLive: true,
  derivationSigningRequiredForLive: true,
  derivationKeyPinMustMatch: true,
  derivationRsa2048Required: true,
}, null, 2));
