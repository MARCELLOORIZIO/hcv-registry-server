'use strict';

// Offline trusted worker, NOT an HTTP endpoint. Never let an untrusted request
// supply an arbitrary output byte buffer and ask SIGILLUM to sign it.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { verifyCertificateRaw, sha256Text } = require('./registry_certificate_security');

const SCHEMA = 'SIGILLUM_TRUSTED_DERIVATION_V1';
const OPERATION = 'video_transcode_h264_aac_v1';
const HASH = /^[a-f0-9]{64}$/;
const HCV_ID = /^HCV-[A-F0-9]{16}$/;
const SIGNATURE_ALGORITHM = 'RSA-SHA256-PKCS1V15';

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// An original must be in the Registry, with verified registration provenance.
// A self-signed .hcv or a supplied JSON field is NOT sufficient authority.
function registryOriginal(db, hcvId) {
  if (!db || !HCV_ID.test(hcvId)) fail('REGISTRY_REQUIRED');
  let record, provenance, latest;
  try {
    record = db.prepare('SELECT certificate_raw FROM certificates WHERE hcv_id = ?').get(hcvId);
    provenance = db.prepare(
      'SELECT provenance_raw, registry_status FROM registry_provenance WHERE hcv_id = ?'
    ).get(hcvId);
    latest = db.prepare(
      'SELECT status FROM certificate_status_events WHERE hcv_id = ? ORDER BY id DESC LIMIT 1'
    ).get(hcvId);
  } catch (_) {
    fail('REGISTRY_PROVENANCE_UNAVAILABLE');
  }
  if (!record || !provenance) fail('REGISTRY_VERIFIED_ORIGINAL_MISSING');
  let claim;
  try { claim = JSON.parse(provenance.provenance_raw); }
  catch (_) { fail('REGISTRY_PROVENANCE_INVALID'); }
  const status = String(latest?.status || provenance.registry_status || '').toUpperCase();
  if (status !== 'ACTIVE' ||
      claim.type !== 'SIGILLUM_REGISTRY_PROVENANCE' ||
      claim.version !== 2 ||
      claim.hcvId !== hcvId ||
      claim.status !== 'SIGILLUM_REGISTRY_VERIFIED' ||
      claim.integrityValid !== true ||
      claim.certificateSha256 !== sha256Text(record.certificate_raw)) {
    fail('REGISTRY_PROVENANCE_NOT_ACTIVE_VERIFIED');
  }
  const verified = verifyCertificateRaw(record.certificate_raw, hcvId);
  if (verified.contentSha256 !== claim.contentSha256) {
    fail('REGISTRY_CONTENT_BINDING_MISMATCH');
  }
  return { certificateRaw: record.certificate_raw, verified };
}

function makeStatement({ hcvId, original, output, keyId }) {
  return {
    schema: SCHEMA,
    hcvId,
    parent: {
      kind: 'original',
      sha256: original.contentSha256,
      signedCertificateDigest: original.certificateSha256,
    },
    output: {
      sha256: hash(output),
      byteLength: output.length,
      mediaType: 'video',
    },
    transform: {
      operation: OPERATION,
      editorialImpact: 'non_editorial',
      policyVersion: 'SIGILLUM_NON_EDITORIAL_V1',
    },
    issuer: { keyId, signatureAlgorithm: SIGNATURE_ALGORITHM },
    createdAt: new Date().toISOString(),
    nonce: crypto.randomUUID(),
  };
}

// Converts only an EXACT Registry-verified original. Fixed FFmpeg arguments,
// no filtergraph, subtitles, overlays, arbitrary command line or caller bytes.
// Service private key is loaded only in the trusted worker environment.
function createTrustedVideoRendition({
  db, hcvId, originalPath, outputPath, privateKeyPem, keyId,
  ffmpegExecutable = '/usr/bin/ffmpeg',
}) {
  if (!HCV_ID.test(hcvId) || !/^[A-Za-z0-9._-]{3,80}$/.test(keyId || '')) {
    fail('DERIVATION_INPUT_INVALID');
  }
  if (!privateKeyPem || !originalPath || !outputPath ||
      path.resolve(originalPath) === path.resolve(outputPath)) {
    fail('DERIVATION_INPUT_INVALID');
  }
  if (!/\.mp4$/i.test(outputPath)) fail('DERIVATION_OUTPUT_TYPE_INVALID');
  const { verified } = registryOriginal(db, hcvId);
  if (verified.certificate.content.type !== 'video') fail('DERIVATION_VIDEO_ONLY');
  const original = fs.readFileSync(originalPath);
  if (!original.length || hash(original) !== verified.contentSha256) {
    fail('DERIVATION_ORIGINAL_SHA_MISMATCH');
  }
  if (verified.certificate.content.size !== original.length) {
    fail('DERIVATION_ORIGINAL_SIZE_MISMATCH');
  }
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'rsa' ||
      privateKey.asymmetricKeyDetails?.modulusLength < 2048) {
    fail('DERIVATION_SIGNING_KEY_INVALID');
  }
  // No accepted input is a pre-existing edited derivative. A worker controls
  // the bytes generated after comparing the real original to Registry hash.
  execFileSync(ffmpegExecutable, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', originalPath,
    '-map', '0:v:0', '-map', '0:a?',
    '-map_metadata', '-1', '-map_chapters', '-1',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart', outputPath,
  ], { timeout: 120000, stdio: 'pipe' });
  const output = fs.readFileSync(outputPath);
  if (!output.length || hash(output) === verified.contentSha256) {
    fail('DERIVATION_OUTPUT_INVALID');
  }
  const statement = makeStatement({ hcvId, original: verified, output, keyId });
  const signature = crypto.sign(
    'RSA-SHA256', Buffer.from(JSON.stringify(statement), 'utf8'), privateKey
  ).toString('base64');
  const manifest = { ...statement, signature };
  fs.writeFileSync(outputPath + '.hcvderivation.json', JSON.stringify(manifest, null, 2));
  return manifest;
}

// This method is pure verification. No submitted manifest is accepted as
// authority unless its issuer is PINNED in trustedKeys and its output hash
// matches the SELECTED file byte-for-byte. There is intentionally no
// perceptual match fallback and no "original" verdict for a derivative.
function verifyTrustedDerivative({
  manifest, outputBytes, certificateRaw, trustedKeys,
}) {
  try {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
        !Buffer.isBuffer(outputBytes) || !trustedKeys ||
        manifest.schema !== SCHEMA || !HCV_ID.test(manifest.hcvId)) return false;
    const { signature, ...statement } = manifest;
    if (Object.keys(statement).length !== 8 ||
        typeof signature !== 'string' || !signature) return false;
    const verified = verifyCertificateRaw(certificateRaw, manifest.hcvId);
    if (verified.certificate.content.type !== 'video' ||
        statement.parent?.kind !== 'original' ||
        statement.parent?.sha256 !== verified.contentSha256 ||
        statement.parent?.signedCertificateDigest !== sha256Text(certificateRaw) ||
        statement.output?.mediaType !== 'video' ||
        statement.output?.byteLength !== outputBytes.length ||
        statement.output?.sha256 !== hash(outputBytes) ||
        !HASH.test(statement.output.sha256) ||
        statement.output.sha256 === verified.contentSha256 ||
        statement.transform?.operation !== OPERATION ||
        statement.transform?.editorialImpact !== 'non_editorial' ||
        statement.transform?.policyVersion !== 'SIGILLUM_NON_EDITORIAL_V1' ||
        statement.issuer?.signatureAlgorithm !== SIGNATURE_ALGORITHM ||
        typeof statement.issuer.keyId !== 'string' ||
        !/^[A-Za-z0-9._-]{3,80}$/.test(statement.issuer.keyId) ||
        typeof statement.nonce !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(statement.nonce) ||
        !Number.isFinite(Date.parse(statement.createdAt))) return false;
    const pem = Object.prototype.hasOwnProperty.call(
      trustedKeys, statement.issuer.keyId
    ) ? trustedKeys[statement.issuer.keyId] : null;
    if (!pem) return false;
    const key = crypto.createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa' ||
        key.asymmetricKeyDetails?.modulusLength < 2048) return false;
    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(JSON.stringify(statement), 'utf8'),
      key, Buffer.from(signature, 'base64')
    );
  } catch (_) { return false; }
}

module.exports = {
  SCHEMA, OPERATION, registryOriginal, createTrustedVideoRendition,
  verifyTrustedDerivative,
};
