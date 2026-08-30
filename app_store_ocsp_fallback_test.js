const fs = require('fs');

const source = fs.readFileSync('app_store_billing.js', 'utf8');

const required = [
  'const RETRYABLE_VERIFICATION_FAILURE_STATUS = 2;',
  'function isRetryableVerificationFailure(error)',
  'Number(error?.status) === RETRYABLE_VERIFICATION_FAILURE_STATUS',
  'async function verifier(environment, enableOnlineChecks = true)',
  'enableOnlineChecks,\n    environment,',
  'async function verifyTransactionWithOcspFallback',
  'if (!isRetryableVerificationFailure(error)) throw error;',
  "console.warn('APPLE_OCSP_RETRYABLE_FALLBACK'",
  'const offline = await verifier(environment, false);',
  'return offline.verifyAndDecodeTransaction(signedTransactionInfo);',
  'const decoded = await verifyTransactionWithOcspFallback(environment, response.signedTransactionInfo);',
  'const onlineVerifier = await verifier(environment, true);',
  'item.signedTransactionInfo,\n            onlineVerifier,',
];

for (const marker of required) {
  if (!source.includes(marker)) {
    throw new Error(`Missing Apple OCSP fallback marker: ${marker}`);
  }
}

const helperStart = source.indexOf('async function verifyTransactionWithOcspFallback');
const retryableGuard = source.indexOf('if (!isRetryableVerificationFailure(error)) throw error;', helperStart);
const offlineVerifier = source.indexOf('const offline = await verifier(environment, false);', retryableGuard);
const offlineDecode = source.indexOf('return offline.verifyAndDecodeTransaction(signedTransactionInfo);', offlineVerifier);
if (!(helperStart >= 0 && retryableGuard > helperStart && offlineVerifier > retryableGuard && offlineDecode > offlineVerifier)) {
  throw new Error('Offline verifier is not strictly gated by retryable Apple verification status');
}

const notificationStart = source.indexOf('async function verifyNotification');
const exportsStart = source.indexOf('module.exports', notificationStart);
const notificationBlock = source.slice(notificationStart, exportsStart);
if (!notificationBlock.includes('const verify = await verifier(environment, true);')) {
  throw new Error('Apple notification verification must remain strict-online');
}
if (notificationBlock.includes('verifyTransactionWithOcspFallback')) {
  throw new Error('OCSP fallback must not be used for App Store Server Notifications');
}

console.log('Apple OCSP retryable fallback contract: OK');
