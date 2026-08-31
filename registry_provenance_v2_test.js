const assert = require('assert');
const {
  buildRegistryProvenanceRecord,
  provenanceEnvelopeFromRow,
} = require('./registry_provenance_v2');

const raw = JSON.stringify({
  format: 'HCV_CERTIFICATE',
  version: 2,
  content: {
    type: 'photo',
    hash: 'a'.repeat(64),
  },
});

const registeredAt = '2026-08-31T12:00:00.000Z';
const provenance = buildRegistryProvenanceRecord({
  hcvId: 'HCV-0123456789ABCDEF',
  certificateRaw: raw,
  certificate: JSON.parse(raw),
  accountId: 'acc_test_subject',
  creatorId: 'creator-test',
  deviceKeyFingerprint: 'b'.repeat(64),
  identityVerified: true,
  bindingVersion: 1,
  registeredAt,
});

assert.strictEqual(provenance.status, 'SIGILLUM_REGISTRY_VERIFIED');
assert.strictEqual(provenance.version, 2);
assert.strictEqual(provenance.contentSha256, 'a'.repeat(64));
assert.strictEqual(provenance.deviceKeyFingerprint, 'b'.repeat(64));
assert.strictEqual(provenance.identityVerified, true);
assert.strictEqual(provenance.registeredAt, registeredAt);
assert.match(provenance.certificateSha256, /^[a-f0-9]{64}$/);
assert.match(provenance.accountSubjectHash, /^[a-f0-9]{64}$/);
assert.match(provenance.attestationSha256, /^[a-f0-9]{64}$/);

const row = {
  hcv_id: provenance.hcvId,
  created_at: registeredAt,
  certificate_sha256: provenance.certificateSha256,
  account_subject_hash: provenance.accountSubjectHash,
  device_key_fingerprint: provenance.deviceKeyFingerprint,
  creator_id: provenance.creatorId,
  binding_version: provenance.bindingVersion,
  content_sha256: provenance.contentSha256,
  identity_verified: provenance.identityVerified,
  registry_attested_at: registeredAt,
  provenance_version: 2,
  registry_attestation_sha256: provenance.attestationSha256,
};

const envelope = provenanceEnvelopeFromRow(row);
assert.strictEqual(envelope.status, 'SIGILLUM_REGISTRY_VERIFIED');
assert.strictEqual(envelope.integrityValid, true);
assert.strictEqual(envelope.attestationSha256, provenance.attestationSha256);

const tampered = provenanceEnvelopeFromRow({
  ...row,
  content_sha256: 'c'.repeat(64),
});
assert.strictEqual(tampered.status, 'REGISTRY_ATTESTATION_INVALID');
assert.strictEqual(tampered.integrityValid, false);

const legacy = provenanceEnvelopeFromRow({
  hcv_id: 'HCV-0123456789ABCDEF',
  created_at: registeredAt,
  provenance_version: 0,
});
assert.strictEqual(legacy.status, 'LEGACY_REGISTRY_RECORD');
assert.strictEqual(legacy.integrityValid, null);

assert.throws(
  () => buildRegistryProvenanceRecord({
    hcvId: 'HCV-0123456789ABCDEF',
    certificateRaw: raw,
    certificate: { content: { hash: 'not-a-sha256' } },
    accountId: 'acc_test_subject',
    creatorId: 'creator-test',
    deviceKeyFingerprint: 'b'.repeat(64),
    identityVerified: true,
    registeredAt,
  }),
  /PROVENANCE_CONTENT_SHA256_INVALID/,
);

console.log('registry_provenance_v2_test: PASS');
