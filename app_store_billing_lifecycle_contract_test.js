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
  verifyRoute.includes('const transaction = await appStoreBilling.verifyPurchase({'),
  'Apple transaction authenticity verification missing',
);
assert.ok(
  verifyRoute.includes('current = await appStoreBilling.refreshSubscription('),
  'current Apple auto-renewable subscription status must be queried after transaction verification',
);
assert.ok(
  verifyRoute.indexOf('appStoreBilling.refreshSubscription(') >
    verifyRoute.indexOf('appStoreBilling.verifyPurchase({'),
  'current entitlement lookup must occur after transaction authenticity verification',
);
assert.ok(
  verifyRoute.includes('await saveAppleSubscription(session.account_id, current);'),
  'current Apple subscription state must be persisted',
);
assert.ok(
  verifyRoute.includes("current = { ...transaction, status: 'inactive' }"),
  'entitlement refresh failure must fail closed',
);
assert.ok(
  verifyRoute.includes('UPDATE subscriptions SET last_verified_at=NULL'),
  'unconfirmed entitlement must force an immediate later refresh',
);
assert.ok(
  verifyRoute.includes('verified: true'),
  'authentic Apple transaction must return verified=true even if current entitlement is inactive',
);
assert.ok(
  verifyRoute.includes('status: current.status'),
  'current Apple subscription status must be returned',
);
assert.ok(
  verifyRoute.includes('entitlementConfirmed'),
  'response must distinguish transaction verification from confirmed current entitlement',
);
assert.ok(
  !verifyRoute.includes("throw publicError('ABBONAMENTO_NON_ATTIVO'"),
  'expired/revoked verified transactions must not be converted into transaction-verification errors',
);

assert.ok(
  server.includes("const sandbox = String(row.environment || '').toLowerCase() === 'sandbox';"),
  'Sandbox subscription rows must be recognized explicitly',
);
assert.ok(
  server.includes('const maxAgeMs = sandbox ? 0 : 15 * 60 * 1000;'),
  'Sandbox must bypass the production 15-minute entitlement cache',
);
assert.ok(
  server.includes("['active', 'grace'].includes(subscription?.status)"),
  'Creator entitlement must remain limited to active/grace subscriptions',
);
assert.ok(
  server.includes("!['active', 'grace'].includes(account.subscriptionStatus)"),
  'protected actions must remain limited to active/grace subscriptions',
);

console.log('Apple current entitlement lifecycle: PASS');
