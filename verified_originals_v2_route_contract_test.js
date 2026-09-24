'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('./verified_originals_v2_guard'),'utf8');
const publicVerify = fs.readFileSync(require.resolve('./registry_public_verify_guard'),'utf8');

for (const required of [
  '/api/verified-originals/consents',
  '/api/verified-originals/publications',
  'trusted_derivations',
  'TRUSTED_DERIVATION_REQUIRED',
  'PLATFORM_UPLOAD_RECEIPT_REQUIRED',
  'CREATOR_OWNERSHIP_NOT_VERIFIED',
  'ACTIVE_CREATOR_CONSENT_REQUIRED',
  'MONETIZATION_NOT_AUTHORIZED',
  "publication_status='REVOKED'",
  "publication_status='PUBLISHED'",
  'socialFileVerdict',
  'NOT_VERIFIED',
]) {
  assert(source.includes(required), 'missing route/security contract: '+required);
}
assert(!source.includes("payload.publicUrl"), 'client-supplied public URL must never be trusted');
assert(!source.includes("payload.referenceSha256"), 'client must not assert reference SHA');
assert(!source.includes("pipelineVerified"), 'request boolean must not stand in for trusted derivation');
assert(source.includes("platformReference("), 'platform URL must be derived server-side');
assert(source.includes("consentRecordId"), 'publication must bind explicit server consent');
assert(source.includes('SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON'),
  'trusted derivative verification must require server-pinned public keys');
assert(source.includes('verifyManifestAttestation'),
  'trusted derivative signature must be cryptographically reverified');
assert(source.includes('getVerifiedPlatformReceipt'),
  'publication must require a server-verified platform upload receipt');
assert(source.includes("SIGILLUM_VERIFIED_ORIGINALS_ADMIN_TOKEN"),
  'publisher path must require server-side operator credential');

assert(publicVerify.includes('GUARDA IL CONTENUTO CERTIFICATO'));
assert(publicVerify.includes('publicActiveReference'));
assert(publicVerify.includes('non prova che un file visto su un altro social sia identico'));

console.log('verified_originals_v2_route_contract_test: PASS');
