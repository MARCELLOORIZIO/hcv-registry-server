'use strict';

const crypto = require('crypto');

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function toBase64Url(base64Value) {
  return Buffer.from(base64Value, 'base64').toString('base64url');
}

function createPublicKey(publicKey) {
  if (!publicKey || typeof publicKey !== 'object') throw new Error('PUBLIC_KEY_MISSING');
  const modulus = String(publicKey.modulus || '');
  const exponent = String(publicKey.exponent || '');
  if (!modulus || !exponent) throw new Error('PUBLIC_KEY_INVALID');
  return crypto.createPublicKey({
    key: { kty: 'RSA', n: toBase64Url(modulus), e: toBase64Url(exponent) },
    format: 'jwk',
  });
}

function computePublicKeyFingerprint(publicKey) {
  return sha256Hex(JSON.stringify(publicKey));
}

function verifyDeviceProof(payload) {
  const deviceKeyFingerprint = String(payload.deviceKeyFingerprint || '');
  const publicKey = payload.publicKey;
  const signedAt = String(payload.signedAt || '');
  const signature = String(payload.signature || '');
  if (!deviceKeyFingerprint || !signedAt || !signature) {
    const error = new Error('DEVICE_PROOF_INCOMPLETE');
    error.statusCode = 400;
    throw error;
  }
  const parsedTime = Date.parse(signedAt);
  if (!Number.isFinite(parsedTime)) {
    const error = new Error('DEVICE_PROOF_TIME_INVALID');
    error.statusCode = 400;
    throw error;
  }
  const maxAgeMs = Number(process.env.DEVICE_PROOF_MAX_AGE_MS || 600000);
  if (Math.abs(Date.now() - parsedTime) > maxAgeMs) {
    const error = new Error('DEVICE_PROOF_EXPIRED');
    error.statusCode = 401;
    throw error;
  }
  const actualFingerprint = computePublicKeyFingerprint(publicKey);
  if (actualFingerprint !== deviceKeyFingerprint) {
    const error = new Error('DEVICE_FINGERPRINT_MISMATCH');
    error.statusCode = 401;
    throw error;
  }
  const statement = JSON.stringify({
    purpose: 'SIGILLUM_KYC_DEVICE_BINDING_V1',
    deviceKeyFingerprint,
    signedAt,
  });
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(statement, 'utf8'),
    createPublicKey(publicKey),
    Buffer.from(signature, 'base64'),
  );
  if (!ok) {
    const error = new Error('DEVICE_SIGNATURE_INVALID');
    error.statusCode = 401;
    throw error;
  }
  return { deviceKeyFingerprint, publicKey, signedAt };
}

function verifyCertificate(certificateRaw, expectedHcvId) {
  if (typeof certificateRaw !== 'string' || !certificateRaw.trim()) {
    const error = new Error('CERTIFICATE_RAW_MISSING');
    error.statusCode = 400;
    throw error;
  }
  let certificate;
  try {
    certificate = JSON.parse(certificateRaw);
  } catch (_) {
    const error = new Error('CERTIFICATE_JSON_INVALID');
    error.statusCode = 400;
    throw error;
  }
  if (!certificate || typeof certificate !== 'object') {
    const error = new Error('CERTIFICATE_INVALID');
    error.statusCode = 400;
    throw error;
  }
  if (certificate.format !== 'HCV_CERTIFICATE' || certificate.version !== 2) {
    const error = new Error('CERTIFICATE_VERSION_UNSUPPORTED');
    error.statusCode = 400;
    throw error;
  }
  const hcvId = String(certificate?.meta?.hcvId || '').toUpperCase();
  if (!hcvId || hcvId !== expectedHcvId) {
    const error = new Error('CERTIFICATE_HCV_ID_MISMATCH');
    error.statusCode = 400;
    throw error;
  }
  const chain = certificate.chain;
  if (!Array.isArray(chain) || chain.length === 0) {
    const error = new Error('CERTIFICATE_CHAIN_INVALID');
    error.statusCode = 400;
    throw error;
  }
  let sawStart = false;
  let sawStop = false;
  for (let index = 0; index < chain.length; index += 1) {
    const event = chain[index];
    if (!event || typeof event !== 'object') throw Object.assign(new Error('CERTIFICATE_CHAIN_EVENT_INVALID'), { statusCode: 400 });
    if (event.type === 'START') sawStart = true;
    if (event.type === 'STOP') sawStop = true;
    const storedHash = String(event.hash || '');
    const cleanEvent = { ...event };
    delete cleanEvent.hash;
    if (storedHash !== sha256Hex(JSON.stringify(cleanEvent))) throw Object.assign(new Error('CERTIFICATE_CHAIN_HASH_INVALID'), { statusCode: 400 });
    const expectedPrev = index === 0 ? 'GENESIS' : String(chain[index - 1].hash || '');
    if (String(event.prev || '') !== expectedPrev) throw Object.assign(new Error('CERTIFICATE_CHAIN_LINK_INVALID'), { statusCode: 400 });
  }
  if (!sawStart || !sawStop) throw Object.assign(new Error('CERTIFICATE_CHAIN_INCOMPLETE'), { statusCode: 400 });
  const rootHash = sha256Hex(JSON.stringify(chain));
  if (certificate.rootHash !== rootHash) throw Object.assign(new Error('CERTIFICATE_ROOT_HASH_INVALID'), { statusCode: 400 });

  const publicKey = certificate.publicKey;
  const identity = certificate?.meta?.identity;
  if (!identity || typeof identity !== 'object') throw Object.assign(new Error('CERTIFICATE_IDENTITY_MISSING'), { statusCode: 400 });
  const signerFingerprint = computePublicKeyFingerprint(publicKey);
  if (identity.devicePublicKeyFingerprint !== signerFingerprint) throw Object.assign(new Error('CERTIFICATE_IDENTITY_KEY_MISMATCH'), { statusCode: 400 });
  const expectedIdentityFingerprint = sha256Hex(`${identity.creatorId}|${identity.creatorName}|${signerFingerprint}`);
  if (identity.identityFingerprint !== expectedIdentityFingerprint) throw Object.assign(new Error('CERTIFICATE_IDENTITY_FINGERPRINT_INVALID'), { statusCode: 400 });

  const signedPayload = {
    format: certificate.format,
    version: certificate.version,
    sessionId: certificate.sessionId,
    createdAt: certificate.createdAt,
    meta: certificate.meta,
    content: certificate.content,
    claims: certificate.claims || {},
    ...(Object.prototype.hasOwnProperty.call(certificate, 'liveSignals') ? { liveSignals: certificate.liveSignals } : {}),
    rootHash: certificate.rootHash,
    chain: certificate.chain,
  };
  const signature = String(certificate.signature || '');
  const signatureOk = crypto.verify(
    'RSA-SHA256',
    Buffer.from(JSON.stringify(signedPayload), 'utf8'),
    createPublicKey(publicKey),
    Buffer.from(signature, 'base64'),
  );
  if (!signatureOk) throw Object.assign(new Error('CERTIFICATE_SIGNATURE_INVALID'), { statusCode: 400 });

  const contentHash = String(certificate?.content?.hash || '');
  if (!/^[a-f0-9]{64}$/i.test(contentHash)) throw Object.assign(new Error('CERTIFICATE_CONTENT_HASH_INVALID'), { statusCode: 400 });
  return {
    certificate,
    certificateSha256: sha256Hex(certificateRaw),
    signerFingerprint,
    contentHash,
  };
}

module.exports = {
  sha256Hex,
  computePublicKeyFingerprint,
  verifyDeviceProof,
  verifyCertificate,
};
