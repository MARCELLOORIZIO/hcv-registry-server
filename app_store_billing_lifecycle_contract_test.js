const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('production_server.js', 'utf8');

const verifyStart = server.indexOf("url.pathname === '/api/billing/apple/verify'");
assert.ok(verifyStart >= 0, 'Apple verify route missing');
const notificationStart = server.indexOf(
  "url.pathname === '/api/billing/apple/notifications/v2'",
  verifyStart,
);
assert.ok(notificationStart > verifyStart, 'Apple notification route boundary missing');
const verifyRoute = server.slice(verifyStart, notificationStart);

assert.ok(
  verifyRoute.includes('const verified = await appStoreBilling.verifyPurchase({'),
  'Apple authenticity verification missing',
);
assert.ok(
  verifyRoute.includes('await saveAppleSubscription(session.account_id, verified);'),
  'verified Apple transaction must be persisted regardless of entitlement status',
);
assert.ok(
  verifyRoute.includes('verified: true'),
  'verified Apple transaction must return verified=true',
);
assert.ok(
  verifyRoute.includes('status: verified.status'),
  'real Apple subscription status must be returned',
);
assert.ok(
  !verifyRoute.includes("throw publicError('ABBONAMENTO_NON_ATTIVO'"),
  'expired/revoked verified transactions must not be converted into verification errors',
);

assert.ok(
  server.includes("['active', 'grace'].includes(subscription?.status)"),
  'Creator entitlement must remain limited to active/grace subscriptions',
);
assert.ok(
  server.includes("!['active', 'grace'].includes(account.subscriptionStatus)"),
  'protected actions must remain limited to active/grace subscriptions',
);

console.log('Apple verified inactive transaction lifecycle: PASS');
