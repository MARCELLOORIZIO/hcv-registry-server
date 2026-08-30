const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('production_server.js', 'utf8');

for (const token of [
  "/api/billing/apple/reconcile",
  "APPLE_SUBSCRIPTION_RECONCILED",
  "APPLE_SUBSCRIPTION_RECONCILE_FAILED",
  "appStoreBilling.refreshSubscription(",
  "source: 'apple_server_live_reconcile'",
]) {
  assert(source.includes(token), `Missing live reconcile runtime token: ${token}`);
}

const routeIndex = source.indexOf("url.pathname === '/api/billing/apple/reconcile'");
const authIndex = source.indexOf('const session = await authenticate(req);', routeIndex);
const refreshIndex = source.indexOf('appStoreBilling.refreshSubscription(', routeIndex);
const saveIndex = source.indexOf('await saveAppleSubscription(session.account_id, refreshed);', routeIndex);
const sendIndex = source.indexOf("source: 'apple_server_live_reconcile'", routeIndex);

assert(routeIndex >= 0, 'live reconcile route must exist');
assert(authIndex > routeIndex, 'live reconcile must authenticate first');
assert(refreshIndex > authIndex, 'Apple server refresh must run after authentication');
assert(saveIndex > refreshIndex, 'fresh Apple result must be persisted after verification');
assert(sendIndex > saveIndex, 'response must only be sent after fresh state is persisted');

console.log('Apple live reconcile runtime test passed');
