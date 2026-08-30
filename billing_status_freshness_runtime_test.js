const fs = require('fs');
const assert = require('assert');

const patch = fs.readFileSync('tool/apply_billing_status_freshness.py', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.ok(patch.includes("const subscription = await refreshAppleSubscriptionForAccount(session.account_id);"));
assert.ok(patch.includes('lastVerifiedAt,'));
assert.ok(patch.includes('verificationFresh,'));
assert.ok(patch.includes("verificationSource: verificationFresh ? 'apple_server_fresh' : 'apple_server_stale'"));
assert.ok(patch.includes('Date.now() - lastVerifiedMs < 15 * 60 * 1000'));
assert.ok(pkg.scripts.prestart.includes('tool/apply_billing_status_freshness.py'));
assert.ok(pkg.scripts.precheck.includes('tool/apply_billing_status_freshness.py'));

console.log('Billing status freshness runtime contract OK');
