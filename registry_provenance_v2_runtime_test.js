const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('production_server.js', 'utf8');

const required = [
  "require('./registry_provenance_v2')",
  'ADD COLUMN IF NOT EXISTS content_sha256',
  'ADD COLUMN IF NOT EXISTS identity_verified',
  'ADD COLUMN IF NOT EXISTS registry_attested_at',
  'ADD COLUMN IF NOT EXISTS provenance_version',
  'ADD COLUMN IF NOT EXISTS registry_attestation_sha256',
  'buildRegistryProvenanceRecord({',
  'provenance.certificateSha256',
  'provenance.accountSubjectHash',
  'provenance.deviceKeyFingerprint',
  'provenance.contentSha256',
  'provenance.attestationSha256',
  'provenanceEnvelopeFromRow(row)',
  "status === 'SIGILLUM_REGISTRY_VERIFIED'",
  'provenance.identityVerified === true',
  "if (!account.legalIdentityVerified) throw publicError('IDENTITA_NON_VERIFICATA'",
  'SIGILLUM REGISTRY VERIFIED',
  'HCV INTEGRITY VERIFIED',
];

for (const token of required) {
  assert.ok(source.includes(token), `missing production provenance token: ${token}`);
}

const uploadRoute = source.indexOf("url.pathname === '/api/certificate'");
const provenanceBuild = source.indexOf('buildRegistryProvenanceRecord({');
const insert = source.indexOf('registry_attestation_sha256', provenanceBuild);
assert.ok(uploadRoute >= 0 && provenanceBuild > uploadRoute && insert > provenanceBuild);

const fetchRoute = source.indexOf('const certMatch = url.pathname.match');
const fetchProvenance = source.indexOf('provenanceEnvelopeFromRow(row)', fetchRoute);
assert.ok(fetchRoute >= 0 && fetchProvenance > fetchRoute);

console.log('registry_provenance_v2_runtime_test: PASS');
