const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('production_server.js', 'utf8');

assert.ok(
  server.includes('function effectiveSubscriptionStatus(subscription)'),
  'effective subscription status helper missing',
);
assert.ok(
  server.includes('expiresMs <= Date.now()'),
  'expired active subscriptions must be denied',
);
assert.ok(
  server.includes('subscriptionStatus: effectiveSubscriptionStatusValue,'),
  'account envelope must expose effective subscription status',
);
assert.ok(
  server.includes("['active', 'grace'].includes(effectiveSubscriptionStatusValue)"),
  'Creator access must use effective subscription status',
);

console.log('Subscription expiry enforcement guard: PASS');
