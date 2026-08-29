const fs = require('fs');

const source = fs.readFileSync('production_server.js', 'utf8');

const required = [
  'CREATE TABLE IF NOT EXISTS apple_subscription_owners',
  'async function resolveAppleSubscriptionOwner',
  'async function assertAppleSubscriptionOwnership',
  'APPLE_SUBSCRIPTION_ALREADY_LINKED',
  "DELETE FROM subscriptions WHERE account_id=$1 AND original_transaction_id=$2",
  'await assertAppleSubscriptionOwnership(accountId, subscription);',
  'WHERE original_transaction_id=$1 AND account_id=$2',
];

for (const marker of required) {
  if (!source.includes(marker)) {
    throw new Error(`Missing Apple subscription account-binding marker: ${marker}`);
  }
}

if (source.includes('UPDATE subscriptions SET\n      product_id=$2') &&
    source.includes('WHERE original_transaction_id=$1\n')) {
  throw new Error('Apple notification update is not scoped to the owning SIGILLUM account');
}

console.log('Apple subscription account binding contract: OK');
