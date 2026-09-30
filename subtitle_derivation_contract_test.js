'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  SUBTITLE_DERIVATION_SCHEMA,
  SUBTITLE_DERIVATION_OPERATION,
  verifySubtitleDerivationManifest,
  referenceVisualFingerprintV3FromRaw,
} = require('./verified_originals_production');

const hcvId = 'HCV-0123456789ABCDEF';
const originalSha256 = 'a'.repeat(64);
const captionedSha256 = 'b'.repeat(64);
const subtitleSha256 = 'c'.repeat(64);
const outputSha256 = 'd'.repeat(64);
const certificateRaw = JSON.stringify({
  meta: { hcvId },
  content: { type: 'video', hash: originalSha256 },
});

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const keyId = 'subtitle-test-key';
const publicPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

const rgb = Buffer.alloc(128 * 72 * 3, 128);
const fingerprint = referenceVisualFingerprintV3FromRaw(rgb, 'video');

const statement = {
  schema: SUBTITLE_DERIVATION_SCHEMA,
  hcvId,
  parent: {
    kind: 'original',
    sha256: originalSha256,
    signedCertificateDigest: crypto
      .createHash('sha256')
      .update(certificateRaw, 'utf8')
      .digest('hex'),
  },
  source: {
    kind: 'captioned_video',
    sha256: captionedSha256,
    subtitleSha256,
  },
  output: {
    sha256: outputSha256,
    byteLength: 12345,
    mediaType: 'video',
    referenceVisualFingerprint: fingerprint,
  },
  transform: {
    operation: SUBTITLE_DERIVATION_OPERATION,
    editorialImpact: 'caption_overlay',
    policyVersion: SUBTITLE_DERIVATION_SCHEMA,
  },
  issuer: {
    keyId,
    signatureAlgorithm: 'RSA-SHA256-PKCS1V15',
  },
  createdAt: '2026-09-30T08:00:00.000Z',
  nonce: '11111111-2222-4333-8444-555555555555',
};

const manifest = {
  ...statement,
  signature: crypto
    .sign(
      'RSA-SHA256',
      Buffer.from(JSON.stringify(statement), 'utf8'),
      privateKey,
    )
    .toString('base64'),
};

const verifyCertificateRaw = () => ({
  content: { type: 'video', hash: originalSha256 },
});

assert.equal(
  verifySubtitleDerivationManifest({
    manifest,
    certificateRaw,
    trustedKeys: { [keyId]: publicPem },
    verifyCertificateRaw,
  }),
  true,
);

assert.equal(
  verifySubtitleDerivationManifest({
    manifest: {
      ...manifest,
      source: { ...manifest.source, subtitleSha256: 'e'.repeat(64) },
    },
    certificateRaw,
    trustedKeys: { [keyId]: publicPem },
    verifyCertificateRaw,
  }),
  false,
);

assert.equal(
  verifySubtitleDerivationManifest({
    manifest: {
      ...manifest,
      transform: { ...manifest.transform, editorialImpact: 'non_editorial' },
    },
    certificateRaw,
    trustedKeys: { [keyId]: publicPem },
    verifyCertificateRaw,
  }),
  false,
);

console.log('subtitle_derivation_contract_test: PASS');
