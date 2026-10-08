'use strict';

const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('verified_originals_production.js', 'utf8');

const start = source.indexOf('  async function verifyPhotoCopy(req, hcvId) {');
const end = source.indexOf(
  '  async function createR2ReadAuthorization(req, hcvId) {',
  start,
);
assert(start >= 0 && end > start);
const verify = source.slice(start, end);

assert(verify.includes('activeR2Reference(hcvId)'));
assert(verify.includes('materializeReference({'));
assert(verify.includes('comparePhotoDetailFiles({'));
assert(verify.includes("comparisonMode: 'SERVER_SIDE_R2_PHOTO_DETAIL_BUILD148'"));
assert(!verify.includes('candidateSha256: candidate.sha256'));
assert(!verify.includes('metrics: {'));
assert(verify.includes("fail('REFERENCE_PROVIDER_UNAVAILABLE', 503)"));
assert(verify.includes('enforcePublicPhotoVerifyRate(req)'));
assert(source.includes("fail('PHOTO_VERIFICATION_RATE_LIMITED', 429)"));
assert(!verify.includes('authenticate(req)'));
assert(!verify.includes('accountEnvelope('));
assert(!verify.includes('subscriptionStatus'));
assert(!verify.includes('issueReadAuthorization'));

assert(
  source.includes(
    "const verifyPhotoCopyRoute = /^\\/api\\/verified-originals\\/(HCV-[A-F0-9]{16})\\/verify-photo-copy$/.exec(url.pathname);",
  ),
);
assert(source.includes("if (req.method === 'POST' && verifyPhotoCopyRoute)"));
assert(source.includes('await verifyPhotoCopy(req, verifyPhotoCopyRoute[1])'));
assert(!source.includes('await verifyPhotoCopy(req, verifyPhotoCopy[1])'));
assert(source.includes("res.setHeader('cache-control', 'no-store, max-age=0')"));

console.log('photo_copy_verification_contract_test: PASS');
