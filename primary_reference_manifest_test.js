'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const {
  OPERATION,
  SCHEMA,
  createPrimaryReferenceManifest,
  verifyPrimaryReferenceManifest,
} = require('./primary_reference_manifest');

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const fingerprint = {
  type: 'SIGILLUM_REFERENCE_VISUAL_FINGERPRINT',
  version: 3,
  algorithm: 'SIGILLUM_LOCAL_RGB_GRID_V3',
  mediaType: 'video',
  width: 128,
  height: 72,
  frameCount: 1,
  frames: [{ globalHash: '0123456789abcdef', localFeatures: 'AA==' }],
};

const certificateRaw = JSON.stringify({
  hcvId: 'HCV-AABBCCDDEEFF0011',
  content: { hash: sha('original') },
});

const created = createPrimaryReferenceManifest({
  hcvId: 'HCV-AABBCCDDEEFF0011',
  originalContentSha256: sha('original'),
  byteLength: 123456,
  mediaType: 'video',
  referenceVisualFingerprint: fingerprint,
  certificateRaw,
  keyId: 'derivation-2026-10',
  privateKeyPem: privateKey,
  createdAt: '2026-10-02T08:00:00.000Z',
  nonce: '12345678-1234-4abc-8def-1234567890ab',
});

assert.equal(created.manifest.schema, SCHEMA);
assert.equal(created.manifest.transform.operation, OPERATION);
assert.equal(created.manifest.output.sha256, sha('original'));
assert.equal(created.manifest.parent.sha256, sha('original'));
assert.equal(created.manifest.transform.editorialImpact, 'none');
assert.match(created.sha256, /^[a-f0-9]{64}$/);

assert.equal(
  verifyPrimaryReferenceManifest({
    manifest: created.manifest,
    certificateRaw,
    trustedKeys: { 'derivation-2026-10': publicKey },
  }),
  true,
);

assert.equal(
  verifyPrimaryReferenceManifest({
    manifest: {
      ...created.manifest,
      output: {
        ...created.manifest.output,
        sha256: sha('tampered'),
      },
    },
    certificateRaw,
    trustedKeys: { 'derivation-2026-10': publicKey },
  }),
  false,
);

assert.equal(
  verifyPrimaryReferenceManifest({
    manifest: created.manifest,
    certificateRaw: certificateRaw + ' ',
    trustedKeys: { 'derivation-2026-10': publicKey },
  }),
  false,
);

console.log(
  'primary_reference_manifest_test: PASS — signed exact-original reference manifest, certificate binding and tamper rejection',
);
