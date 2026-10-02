'use strict';

const crypto = require('crypto');

const HCV_ID = /^HCV-[A-F0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SCHEMA = 'SIGILLUM_PRIMARY_REFERENCE_V1';
const OPERATION = 'exact_original_reference_v1';
const SIGNATURE_ALGORITHM = 'RSA-SHA256-PKCS1V15';

function sha256String(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function publicKeyFrom(value) {
  const key = crypto.createPublicKey(value);
  if (key.asymmetricKeyType !== 'rsa' ||
      (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    throw new Error('PRIMARY_REFERENCE_SIGNING_KEY_INVALID');
  }
  return key;
}

function privateKeyFrom(value) {
  const key = crypto.createPrivateKey(value);
  if (key.asymmetricKeyType !== 'rsa' ||
      (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) {
    throw new Error('PRIMARY_REFERENCE_SIGNING_KEY_INVALID');
  }
  return key;
}

function validateStatement(statement) {
  if (!statement ||
      typeof statement !== 'object' ||
      Array.isArray(statement) ||
      statement.schema !== SCHEMA ||
      !HCV_ID.test(String(statement.hcvId || ''))) {
    return false;
  }
  if (!statement.parent ||
      statement.parent.kind !== 'original' ||
      !SHA256.test(String(statement.parent.sha256 || '')) ||
      !SHA256.test(String(statement.parent.signedCertificateDigest || ''))) {
    return false;
  }
  if (!statement.output ||
      statement.output.kind !== 'exact_original_reference' ||
      !['photo','video'].includes(String(statement.output.mediaType || '')) ||
      !Number.isSafeInteger(statement.output.byteLength) ||
      statement.output.byteLength <= 0 ||
      !SHA256.test(String(statement.output.sha256 || '')) ||
      statement.output.sha256 !== statement.parent.sha256 ||
      !statement.output.referenceVisualFingerprint ||
      typeof statement.output.referenceVisualFingerprint !== 'object') {
    return false;
  }
  if (!statement.transform ||
      statement.transform.operation !== OPERATION ||
      statement.transform.editorialImpact !== 'none' ||
      statement.transform.policyVersion !== SCHEMA) {
    return false;
  }
  if (!statement.issuer ||
      !/^[A-Za-z0-9._-]{3,80}$/.test(String(statement.issuer.keyId || '')) ||
      statement.issuer.signatureAlgorithm !== SIGNATURE_ALGORITHM) {
    return false;
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(statement.nonce || '')) ||
      !Number.isFinite(Date.parse(String(statement.createdAt || '')))) {
    return false;
  }
  return true;
}

function canonicalStatement(statement) {
  if (!validateStatement(statement)) {
    throw new Error('PRIMARY_REFERENCE_MANIFEST_STATEMENT_INVALID');
  }
  return JSON.stringify(statement);
}

function createPrimaryReferenceManifest({
  hcvId,
  originalContentSha256,
  byteLength,
  mediaType,
  referenceVisualFingerprint,
  certificateRaw,
  keyId,
  privateKeyPem,
  createdAt = new Date().toISOString(),
  nonce = crypto.randomUUID(),
}) {
  const originalHash = String(originalContentSha256 || '').toLowerCase();
  if (!SHA256.test(originalHash) ||
      !HCV_ID.test(String(hcvId || '')) ||
      !Number.isSafeInteger(byteLength) ||
      byteLength <= 0 ||
      !['photo','video'].includes(String(mediaType || '')) ||
      !referenceVisualFingerprint ||
      typeof referenceVisualFingerprint !== 'object' ||
      typeof certificateRaw !== 'string' ||
      !certificateRaw ||
      !/^[A-Za-z0-9._-]{3,80}$/.test(String(keyId || ''))) {
    throw new Error('PRIMARY_REFERENCE_MANIFEST_INPUT_INVALID');
  }

  const statement = {
    schema: SCHEMA,
    hcvId,
    parent: {
      kind: 'original',
      sha256: originalHash,
      signedCertificateDigest: sha256String(certificateRaw),
    },
    output: {
      kind: 'exact_original_reference',
      mediaType,
      byteLength,
      sha256: originalHash,
      referenceVisualFingerprint,
    },
    transform: {
      operation: OPERATION,
      editorialImpact: 'none',
      policyVersion: SCHEMA,
    },
    issuer: {
      keyId,
      signatureAlgorithm: SIGNATURE_ALGORITHM,
    },
    createdAt,
    nonce,
  };

  const privateKey = privateKeyFrom(privateKeyPem);
  const rawStatement = canonicalStatement(statement);
  const signature = crypto.sign(
    'sha256',
    Buffer.from(rawStatement, 'utf8'),
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
  ).toString('base64');

  const manifest = { ...statement, signature };
  return {
    manifest,
    raw: JSON.stringify(manifest),
    sha256: sha256String(JSON.stringify(manifest)),
  };
}

function verifyPrimaryReferenceManifest({
  manifest,
  certificateRaw,
  trustedKeys,
}) {
  try {
    if (!manifest ||
        typeof manifest !== 'object' ||
        Array.isArray(manifest) ||
        typeof manifest.signature !== 'string' ||
        !manifest.signature ||
        typeof certificateRaw !== 'string' ||
        !certificateRaw ||
        !trustedKeys ||
        typeof trustedKeys !== 'object') {
      return false;
    }

    const { signature, ...statement } = manifest;
    if (!validateStatement(statement)) return false;
    if (statement.parent.signedCertificateDigest !== sha256String(certificateRaw)) {
      return false;
    }

    const pem = trustedKeys[statement.issuer.keyId];
    if (typeof pem !== 'string' || !pem) return false;
    const publicKey = publicKeyFrom(pem);
    return crypto.verify(
      'sha256',
      Buffer.from(canonicalStatement(statement), 'utf8'),
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(signature, 'base64'),
    );
  } catch (_) {
    return false;
  }
}

module.exports = {
  OPERATION,
  SCHEMA,
  SIGNATURE_ALGORITHM,
  canonicalStatement,
  createPrimaryReferenceManifest,
  sha256String,
  validateStatement,
  verifyPrimaryReferenceManifest,
};
