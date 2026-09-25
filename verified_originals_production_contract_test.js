'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('production_server.js','utf8');
const feature = fs.readFileSync('verified_originals_production.js','utf8');

for (const token of [
  "require('./verified_originals_production')",
  'const verifiedOriginals = createVerifiedOriginalsProduction({',
  'verifiedOriginals.handle(req, res, url)',
  'await verifiedOriginals.initSchema();',
  'verifiedOriginals: true',
]) {
  assert(server.includes(token), 'production server missing: '+token);
}

for (const token of [
  "privacyStatus: 'unlisted'",
  'YOUTUBE_CHANNEL_ID',
  'channels?part=id&mine=true',
  "viewAccess: 'SUBSCRIPTION_REQUIRED'",
  "subscriptionStatus !== 'active'",
  'DERIVATION_ORIGINAL_SHA_MISMATCH',
  "claims?.captureSource === 'HCV_CAMERA'",
  "claims?.liveCapture === true",
  "CAPTURE_PROVENANCE_TYPE",
  "CAPTURE_PROVENANCE_PIPELINE",
  "PHOTO_DERIVATION_OPERATION",
  "hcvpackSha256",
  'SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON',
  'verified_originals_platform_receipts',
  'verified_originals_publications',
]) {
  assert(feature.includes(token), 'feature missing invariant: '+token);
}

assert(!feature.includes("privacyStatus: 'public'"));
assert(!feature.includes("displayRiskDecision === 'NO_DISPLAY_EVIDENCE'"));
assert(feature.includes("new Set(['image/jpeg', 'image/png'])"));
assert(feature.includes("Original SHA-256: "));
assert(feature.includes("HCVPACK SHA-256: "));
for (const language of ["it","en","es","ru"]) {
  assert(feature.includes(language + ": {"), 'missing originals web copy: '+language);
}
assert(!feature.includes("payload.publicUrl"));
assert(!feature.includes("payload.platformPostId"));

const lookupStart = feature.indexOf('async function publicAvailability');
const lookupEnd = feature.indexOf('async function publicHistory', lookupStart);
const lookup = feature.slice(lookupStart, lookupEnd);
assert(!lookup.includes('publicUrl'));
assert(!lookup.includes('platformPostId'));

console.log('verified_originals_production_contract_test: PASS');