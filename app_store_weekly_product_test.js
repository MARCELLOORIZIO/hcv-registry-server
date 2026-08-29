process.env.NODE_ENV = 'test';
process.env.APPLE_BILLING_TEST_MODE = 'true';

const fs = require('fs');
const billing = require('./app_store_billing');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const weekly = 'com.sigillum.hcv.creator.weekly';
  const monthly = 'com.sigillum.hcv.creator.monthly';
  const annual = 'com.sigillum.hcv.creator.annual';

  expect(
    billing.allowedProducts.has(weekly),
    'weekly Creator product must be accepted by server verification',
  );
  expect(
    billing.allowedProducts.has(monthly) && billing.allowedProducts.has(annual),
    'existing monthly and annual Creator products must remain accepted',
  );

  const verified = await billing.verifyPurchase({
    transactionId: 'TEST-WEEKLY-TRANSACTION',
    expectedProductId: weekly,
  });

  expect(verified.status === 'active', 'weekly test purchase must verify as active');
  expect(verified.productId === weekly, 'verified weekly product id must be preserved');
  expect(verified.environment === 'Sandbox', 'test purchase must use Sandbox environment');

  const billingPatch = fs.readFileSync('./tool/apply_app_store_billing.py', 'utf8');
  expect(
    !billingPatch.includes("if (!['active', 'grace'].includes(verified.status)) throw publicError('ABBONAMENTO_NON_ATTIVO', 402);"),
    'verified expired/revoked Apple transactions must not be rejected before the client can finish stale StoreKit state',
  );
  expect(
    billingPatch.includes('await saveAppleSubscription(session.account_id, verified);'),
    'verified Apple transaction state must be persisted even when entitlement is inactive',
  );
  expect(
    billingPatch.includes('verified: true') && billingPatch.includes('status: verified.status'),
    'verification endpoint must distinguish Apple authenticity from entitlement state',
  );

  console.log(JSON.stringify({
    ok: true,
    weeklyProductAllowed: true,
    existingProductsPreserved: true,
    weeklyPurchaseVerifies: true,
    verifiedInactiveStateReturned: true,
    staleTransactionRecoverySupported: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
