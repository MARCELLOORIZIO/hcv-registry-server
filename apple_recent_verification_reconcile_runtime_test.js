const fs = require('fs');
const assert = require('assert');

const patch = fs.readFileSync('tool/apply_apple_recent_verification_reconcile.py', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.ok(patch.includes("Date.now() - recentVerifiedMs < 15 * 60 * 1000"));
assert.ok(patch.includes("['active', 'grace'].includes(row.status)"));
assert.ok(patch.includes("source: 'recent_apple_verification'"));
assert.ok(patch.includes('verified: true'));
assert.ok(pkg.scripts.prestart.includes('tool/apply_apple_recent_verification_reconcile.py'));
assert.ok(pkg.scripts.precheck.includes('tool/apply_apple_recent_verification_reconcile.py'));

console.log('Recent Apple verification reconcile runtime contract OK');
