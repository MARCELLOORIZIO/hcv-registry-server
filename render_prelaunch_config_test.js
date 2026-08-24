'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('render.production.yaml', 'utf8');

for (const token of [
  'branch: stable/commercial-prelaunch-backend-reconciled-20260824',
  'autoDeployTrigger: off',
  '- key: PRODUCTION_LIVE\n        value: "false"',
  '- key: CERTIFICATE_WRITES_ENABLED\n        value: "false"',
  '- key: SUBSCRIPTIONS_ENFORCED\n        value: "false"',
  '- key: KYC_REQUIRES_SUBSCRIPTION\n        value: "true"',
  '- key: TERMS_VERSION\n        value: "2026-08-18"',
  '- key: PRIVACY_VERSION\n        value: "2026-08-18"',
  '- key: APPLE_IAP_ENVIRONMENT\n        value: "AUTO"',
]) {
  assert(source.includes(token), `prelaunch Render contract missing: ${token}`);
}

assert(!source.includes('- key: CERTIFICATE_WRITES_ENABLED\n        value: "true"'), 'prelaunch Blueprint must not enable certificate writes');
assert(!source.includes('- key: PRODUCTION_LIVE\n        value: "true"'), 'prelaunch Blueprint must not mark production live');

console.log('Render prelaunch configuration contract OK');
