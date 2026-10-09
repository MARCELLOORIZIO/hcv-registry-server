const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('app_store_billing.js', 'utf8');
const start = source.indexOf('function logAppleVerificationFailure(');
const end = source.indexOf('async function verifyPurchase(', start);
assert(start >= 0 && end > start, 'Apple safe diagnostics helper must exist');
const helper = source.slice(start, end);
assert(helper.includes("'APPLE_BILLING_DIAGNOSTIC'"), 'Diagnostic marker missing');
assert(helper.includes('environmentName(environment)'), 'Apple environment must be identified');
assert(helper.includes('apiError'), 'Numeric Apple API error must be captured');
assert(helper.includes('httpStatus'), 'Numeric HTTP status must be captured');
assert(helper.includes('verificationStatus'), 'Signed-data status must be captured');
for (const forbidden of ['transactionId:', 'originalTransactionId:', 'receiptData:', 'signedTransactionInfo:', 'error.message', 'error.stack']) {
  assert(!helper.includes(forbidden), 'Sensitive diagnostic payload: ' + forbidden);
}
assert(source.includes("logAppleVerificationFailure('verify_purchase', environment, error)"), 'Purchase diagnostic missing');
assert(source.includes("logAppleVerificationFailure('refresh_subscription', environment, error)"), 'Refresh diagnostic missing');
assert(source.includes("new Error('APPLE_TRANSACTION_VERIFICATION_FAILED')"), 'Purchase guard must remain');
assert(source.includes("new Error('APPLE_SUBSCRIPTION_REFRESH_FAILED')"), 'Reconciliation guard must remain');
console.log('Apple safe server diagnostics contract: OK');
