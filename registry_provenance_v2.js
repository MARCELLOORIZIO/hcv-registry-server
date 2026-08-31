const crypto = require('crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeFingerprint(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeIso(value) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  return parsed.toISOString();
}

function canonicalProvenancePayload(value) {
  return {
    type: 'SIGILLUM_REGISTRY_PROVENANCE',
    version: 2,
    hcvId: String(value.hcvId || '').trim().toUpperCase(),
    certificateSha256: String(value.certificateSha256 || '').trim().toLowerCase(),
    contentSha256: String(value.contentSha256 || '').trim().toLowerCase(),
    accountSubjectHash: String(value.accountSubjectHash || '').trim().toLowerCase(),
    creatorId: String(value.creatorId || '').trim(),
    deviceKeyFingerprint: normalizeFingerprint(value.deviceKeyFingerprint),
    identityVerified: value.identityVerified === true,
    registeredAt: normalizeIso(value.registeredAt),
    bindingVersion: Number(value.bindingVersion || 0),
  };
}

function provenanceDigest(value) {
  return sha256(JSON.stringify(canonicalProvenancePayload(value)));
}

function buildRegistryProvenanceRecord({
  hcvId,
  certificateRaw,
  certificate,
  accountId,
  creatorId,
  deviceKeyFingerprint,
  identityVerified,
  bindingVersion = 1,
  registeredAt = new Date().toISOString(),
}) {
  const contentSha256 = String(certificate?.content?.hash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentSha256)) {
    const error = new Error('PROVENANCE_CONTENT_SHA256_INVALID');
    error.code = 'PROVENANCE_CONTENT_SHA256_INVALID';
    throw error;
  }

  const record = canonicalProvenancePayload({
    hcvId,
    certificateSha256: sha256(certificateRaw),
    contentSha256,
    accountSubjectHash: sha256(accountId),
    creatorId,
    deviceKeyFingerprint,
    identityVerified,
    registeredAt,
    bindingVersion,
  });

  if (!/^HCV-[A-F0-9]{16}$/.test(record.hcvId)) {
    const error = new Error('PROVENANCE_HCV_ID_INVALID');
    error.code = 'PROVENANCE_HCV_ID_INVALID';
    throw error;
  }
  if (!/^[a-f0-9]{64}$/.test(record.certificateSha256)) {
    throw new Error('PROVENANCE_CERTIFICATE_SHA256_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(record.accountSubjectHash)) {
    throw new Error('PROVENANCE_ACCOUNT_HASH_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(record.deviceKeyFingerprint)) {
    throw new Error('PROVENANCE_DEVICE_FINGERPRINT_INVALID');
  }
  if (!record.creatorId || !record.registeredAt || record.bindingVersion < 1) {
    throw new Error('PROVENANCE_BINDING_INVALID');
  }

  return {
    status: 'SIGILLUM_REGISTRY_VERIFIED',
    ...record,
    attestationSha256: provenanceDigest(record),
    integrityValid: true,
  };
}

function provenanceEnvelopeFromRow(row) {
  const version = Number(row?.provenance_version || 0);
  if (version < 2) {
    return {
      status: 'LEGACY_REGISTRY_RECORD',
      version,
      hcvId: String(row?.hcv_id || '').trim().toUpperCase(),
      registeredAt: normalizeIso(row?.created_at),
      integrityValid: null,
    };
  }

  const record = canonicalProvenancePayload({
    hcvId: row.hcv_id,
    certificateSha256: row.certificate_sha256,
    contentSha256: row.content_sha256,
    accountSubjectHash: row.account_subject_hash,
    creatorId: row.creator_id,
    deviceKeyFingerprint: row.device_key_fingerprint,
    identityVerified: row.identity_verified,
    registeredAt: row.registry_attested_at,
    bindingVersion: row.binding_version,
  });

  const expected = provenanceDigest(record);
  const stored = String(row.registry_attestation_sha256 || '').trim().toLowerCase();
  const integrityValid = /^[a-f0-9]{64}$/.test(stored) && stored === expected;

  if (!integrityValid) {
    return {
      status: 'REGISTRY_ATTESTATION_INVALID',
      version: 2,
      hcvId: record.hcvId,
      registeredAt: record.registeredAt,
      integrityValid: false,
    };
  }

  return {
    status: 'SIGILLUM_REGISTRY_VERIFIED',
    ...record,
    attestationSha256: stored,
    integrityValid: true,
  };
}

module.exports = {
  buildRegistryProvenanceRecord,
  canonicalProvenancePayload,
  provenanceDigest,
  provenanceEnvelopeFromRow,
};
