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
  'HCVPACK_BINDING_SIGNATURE_INVALID',
  'X-Sigillum-Hcvpack-Signature'.toLowerCase(),
  'retryPendingTakedowns',
  "processing_status='takedown_pending'",
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

assert(feature.includes("referenceVisualFingerprint = await buildReferenceVisualFingerprintV3"));
assert(feature.includes("referenceVisualFingerprint,"));
assert(feature.includes("referenceVisualFingerprint: reference.referenceVisualFingerprint"));
assert(feature.includes("statement.output?.referenceVisualFingerprint"));
assert(feature.includes("validReferenceVisualFingerprintV3"));
assert(feature.includes("REFERENCE_VISUAL_FINGERPRINT_ALGORITHM"));

for (const token of [
  "SUBTITLE_DERIVATION_SCHEMA",
  "SUBTITLE_DERIVATION_OPERATION",
  "ORIGINAL_REFERENCE_ROLE",
  "DERIVED_REFERENCE_ROLE",
  "publish-subtitle",
  "SIGILLUM_SUBTITLE_DERIVATION_BINDING_V1",
  "x-sigillum-subtitle-derivation-signature",
  "source_derivation_sha256",
  "subtitle_sha256",
  "reference_role=$2",
  "referenceRole: DERIVED_REFERENCE_ROLE",
  "ORIGINAL_REFERENCE_REQUIRED",
]) {
  assert(
    feature.includes(token),
    'subtitle closed-chain invariant missing: ' + token,
  );
}
assert(feature.includes("AND p.reference_role=$2"));
assert(feature.includes("[hcvId, ORIGINAL_REFERENCE_ROLE]"));

console.log('verified_originals_production_contract_test: PASS');