process.env.NODE_ENV = 'test';
process.env.APPLE_BILLING_TEST_MODE = 'true';

const billing = require('./app_store_billing');

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const weekly = 'com.sigillum.hcv.creator.weekly';

  expect(
    billing.allowedProducts.has(weekly),
    'weekly Creator product must be accepted by server verification',
  );

  const verified = await billing.verifyPurchase({
    transactionId: 'TEST-WEEKLY-TRANSACTION',
    expectedProductId: weekly,
  });

  expect(verified.status === 'active', 'weekly test purchase must verify as active');
  expect(verified.productId === weekly, 'verified weekly product id must be preserved');
  expect(verified.environment === 'Sandbox', 'test purchase must use Sandbox environment');

  console.log(JSON.stringify({
    ok: true,
    weeklyProductAllowed: true,
    weeklyPurchaseVerifies: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
