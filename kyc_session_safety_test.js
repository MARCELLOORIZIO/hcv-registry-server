'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('production_server.js', 'utf8');

assert(
  source.includes("['requires_input', 'processing', 'verified'].includes(currentStatus)"),
  'existing active Stripe Identity sessions must be reused',
);
assert(
  source.includes('verificationLivemode: current.livemode === true'),
  'KYC start response must expose Stripe livemode',
);
assert(
  source.includes("const legalName = livemode ? rawLegalName : '';"),
  'test-mode Stripe legal names must not become legal identity data',
);
assert(
  source.includes('verifiedOutputs: livemode ? { legalName, country } : null'),
  'verified legal outputs must only be returned for live-mode verification',
);

console.log('KYC session safety contract OK');
