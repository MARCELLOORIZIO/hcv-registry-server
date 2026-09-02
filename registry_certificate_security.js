'use strict';

const crypto = require('crypto');

const HCV_ID_PATTERN = /^HCV-[A-F0-9]{16}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA1_PATTERN = /^[a-f0-9]{40}$/;
const SOFTWARE_ATTESTATION_TYPE = 'SIGILLUM_SOFTWARE_ATTESTATION';
const SOFTWARE_ATTESTATION_VERSION = 1;
const SOFTWARE_BINDING_METHOD =
  'COMPILE_TIME_BUILD_METADATA_IN_SIGNED_HCV_CERTIFICATE';

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function parseCertificateRaw(certificateRaw) {
  if (typeof certificateRaw !== 'string' || certificateRaw.length === 0) {
    throw securityError('CERTIFICATE_MISSING', 400);
  }
  let certificate;
  try {
    certificate = JSON.parse(certificateRaw);
  } catch (_) {
    throw securityError('CERTIFICATE_JSON_INVALID', 400);
  }
  if (!certificate || typeof certificate !== 'object' || Array.isArray(certificate)) {
    throw securityError('CERTIFICATE_JSON_INVALID', 400);
  }
  return certificate;
}

function securityError(code, statusCode = 400) {
  const error = new Error(code);
  error.statusCode = statusCode;
  return error;
}

function normalizePublicKey(rawPublicKey) {
  if (!rawPublicKey || typeof rawPublicKey !== 'object' || Array.isArray(rawPublicKey)) {
    throw securityError('CERTIFICATE_PUBLIC_KEY_INVALID');
  }
  const modulus = String(rawPublicKey.modulus || '');
  const exponent = String(rawPublicKey.exponent || '');
  if (!modulus || !exponent || modulus === 'LOCAL_DEV_PUBLIC_KEY') {
    throw securityError('CERTIFICATE_PUBLIC_KEY_INVALID');
  }
  try {
    const modulusBytes = Buffer.from(modulus, 'base64');
    const exponentBytes = Buffer.from(exponent, 'base64');
    if (!modulusBytes.length || !exponentBytes.length) {
      throw new Error('EMPTY_KEY');
    }
    const keyObject = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: modulusBytes.toString('base64url'),
        e: exponentBytes.toString('base64url'),
      },
      format: 'jwk',
    });
    return { publicKey: { modulus, exponent }, keyObject };
  } catch (_) {
    throw securityError('CERTIFICATE_PUBLIC_KEY_INVALID');
  }
}

function verifyEventChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) {
    throw securityError('CERTIFICATE_CHAIN_INVALID');
  }
  let sawStart = false;
  let sawStop = false;
  let previousHash = 'GENESIS';

  for (const rawEvent of chain) {
    if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
      throw securityError('CERTIFICATE_CHAIN_INVALID');
    }
    const event = { ...rawEvent };
    const storedHash = String(event.hash || '');
    const storedPrev = String(event.prev || '');
    if (!SHA256_PATTERN.test(storedHash) || storedPrev !== previousHash) {
      throw securityError('CERTIFICATE_CHAIN_INVALID');
    }
    delete event.hash;
    const recalculated = sha256Text(JSON.stringify(event));
    if (recalculated !== storedHash) {
      throw securityError('CERTIFICATE_CHAIN_INVALID');
    }
    if (rawEvent.type === 'START') sawStart = true;
    if (rawEvent.type === 'STOP') sawStop = true;
    previousHash = storedHash;
  }

  if (!sawStart || !sawStop) {
    throw securityError('CERTIFICATE_CHAIN_INVALID');
  }
}

function validateSoftwareAttestation(rawAttestation) {
  if (rawAttestation == null) {
    return { status: 'LEGACY_UNATTESTED', sourceCommit: null, edition: null };
  }
  if (!rawAttestation || typeof rawAttestation !== 'object' || Array.isArray(rawAttestation)) {
    throw securityError('SOFTWARE_ATTESTATION_INVALID');
  }
  const attestation = rawAttestation;
  if (
    attestation.type !== SOFTWARE_ATTESTATION_TYPE ||
    attestation.version !== SOFTWARE_ATTESTATION_VERSION ||
    attestation.bindingMethod !== SOFTWARE_BINDING_METHOD
  ) {
    throw securityError('SOFTWARE_ATTESTATION_INVALID');
  }
  const edition = attestation.edition == null ? null : String(attestation.edition).trim();
  if (attestation.edition != null && !edition) {
    throw securityError('SOFTWARE_ATTESTATION_INVALID');
  }

  if (attestation.status === 'UNBOUND') {
    if (
      Object.prototype.hasOwnProperty.call(attestation, 'sourceCommit') ||
      Object.prototype.hasOwnProperty.call(attestation, 'sourceCommitAlgorithm')
    ) {
      throw securityError('SOFTWARE_ATTESTATION_INVALID');
    }
    return { status: 'UNBOUND', sourceCommit: null, edition };
  }
  if (attestation.status !== 'BOUND') {
    throw securityError('SOFTWARE_ATTESTATION_INVALID');
  }

  const sourceCommit = String(attestation.sourceCommit || '').trim().toLowerCase();
  const algorithm = String(attestation.sourceCommitAlgorithm || '');
  const expectedAlgorithm = SHA1_PATTERN.test(sourceCommit)
    ? 'GIT_SHA1'
    : SHA256_PATTERN.test(sourceCommit)
      ? 'GIT_SHA256'
      : null;
  if (!expectedAlgorithm || algorithm !== expectedAlgorithm) {
    throw securityError('SOFTWARE_ATTESTATION_INVALID');
  }
  return { status: 'BOUND', sourceCommit, edition };
}

function verifyCertificateRaw(certificateRaw, requestedHcvId) {
  const certificate = parseCertificateRaw(certificateRaw);
  const hcvId = String(requestedHcvId || '').trim().toUpperCase();
  if (!HCV_ID_PATTERN.test(hcvId)) {
    throw securityError('HCV_ID_INVALID');
  }
  if (
    certificate.format !== 'HCV_CERTIFICATE' ||
    certificate.version !== 2 ||
    certificate.signatureAlgorithm !== 'RSA-SHA256-HCV-V2'
  ) {
    throw securityError('CERTIFICATE_VERSION_UNSUPPORTED');
  }

  const meta = certificate.meta;
  const content = certificate.content;
  const identity = meta && typeof meta === 'object' ? meta.identity : null;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw securityError('CERTIFICATE_META_INVALID');
  }
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw securityError('CERTIFICATE_CONTENT_INVALID');
  }
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw securityError('CERTIFICATE_IDENTITY_INVALID');
  }
  if (String(meta.hcvId || '').trim().toUpperCase() !== hcvId) {
    throw securityError('CERTIFICATE_HCV_ID_MISMATCH');
  }

  const contentSha256 = String(content.hash || '').trim().toLowerCase();
  if (!SHA256_PATTERN.test(contentSha256)) {
    throw securityError('CERTIFICATE_CONTENT_HASH_INVALID');
  }

  verifyEventChain(certificate.chain);
  const recalculatedRootHash = sha256Text(JSON.stringify(certificate.chain));
  if (certificate.rootHash !== recalculatedRootHash) {
    throw securityError('CERTIFICATE_ROOT_HASH_INVALID');
  }

  const { publicKey, keyObject } = normalizePublicKey(certificate.publicKey);
  const deviceKeyFingerprint = String(
    identity.devicePublicKeyFingerprint || '',
  ).trim().toLowerCase();
  const actualKeyFingerprint = sha256Text(JSON.stringify(publicKey));
  if (
    !SHA256_PATTERN.test(deviceKeyFingerprint) ||
    deviceKeyFingerprint !== actualKeyFingerprint
  ) {
    throw securityError('CERTIFICATE_DEVICE_BINDING_INVALID');
  }

  const creatorId = String(identity.creatorId || '').trim();
  const creatorName = String(identity.creatorName || '').trim();
  const identityFingerprint = String(identity.identityFingerprint || '').trim().toLowerCase();
  if (!creatorId || !creatorName || !SHA256_PATTERN.test(identityFingerprint)) {
    throw securityError('CERTIFICATE_IDENTITY_INVALID');
  }
  const expectedIdentityFingerprint = sha256Text(
    `${creatorId}|${creatorName}|${deviceKeyFingerprint}`,
  );
  if (identityFingerprint !== expectedIdentityFingerprint) {
    throw securityError('CERTIFICATE_IDENTITY_BINDING_INVALID');
  }

  const softwareAttestation = validateSoftwareAttestation(meta.softwareAttestation);

  const signedPayload = {
    format: certificate.format,
    version: certificate.version,
    sessionId: certificate.sessionId,
    createdAt: certificate.createdAt,
    meta: certificate.meta,
    content: certificate.content,
    claims: certificate.claims || {},
    ...(Object.prototype.hasOwnProperty.call(certificate, 'liveSignals')
      ? { liveSignals: certificate.liveSignals }
      : {}),
    rootHash: certificate.rootHash,
    chain: certificate.chain,
  };
  const signature = String(certificate.signature || '');
  if (!signature) {
    throw securityError('CERTIFICATE_SIGNATURE_INVALID');
  }
  let signatureBytes;
  try {
    signatureBytes = Buffer.from(signature, 'base64');
  } catch (_) {
    throw securityError('CERTIFICATE_SIGNATURE_INVALID');
  }
  const signatureValid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(JSON.stringify(signedPayload), 'utf8'),
    keyObject,
    signatureBytes,
  );
  if (!signatureValid) {
    throw securityError('CERTIFICATE_SIGNATURE_INVALID');
  }

  return {
    certificate,
    hcvId,
    certificateSha256: sha256Text(certificateRaw),
    contentSha256,
    creatorId,
    creatorName,
    deviceKeyFingerprint,
    softwareAttestation,
  };
}

function bearerToken(authorizationHeader) {
  const match = /^Bearer\s+(.+)$/i.exec(String(authorizationHeader || ''));
  return match ? match[1].trim() : '';
}

function authenticateRegistrySession(db, authorizationHeader, now = new Date()) {
  const token = bearerToken(authorizationHeader);
  if (!token) throw securityError('SESSIONE_MANCANTE', 401);
  const tokenHash = sha256Text(token);
  const session = db.prepare(`
    SELECT
      s.token_hash, s.account_id, s.device_key_fingerprint,
      s.expires_at, s.revoked_at,
      a.creator_id, a.creator_name
    FROM auth_sessions s
    JOIN auth_accounts a ON a.id = s.account_id
    WHERE s.token_hash = ?
  `).get(tokenHash);
  if (!session || session.revoked_at) {
    throw securityError('SESSIONE_NON_VALIDA', 401);
  }
  if (Date.parse(session.expires_at) <= now.getTime()) {
    throw securityError('SESSIONE_SCADUTA', 401);
  }
  db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?')
    .run(now.toISOString(), tokenHash);
  return {
    accountId: session.account_id,
    deviceKeyFingerprint: String(session.device_key_fingerprint || '').trim().toLowerCase(),
    creatorId: String(session.creator_id || '').trim(),
    creatorName: String(session.creator_name || '').trim(),
  };
}

function verifyRegistrationIdentity(verifiedCertificate, session) {
  if (
    !session ||
    !SHA256_PATTERN.test(String(session.deviceKeyFingerprint || '').toLowerCase()) ||
    !session.creatorId
  ) {
    throw securityError('REGISTRY_ACCOUNT_IDENTITY_INCOMPLETE', 403);
  }
  if (
    verifiedCertificate.deviceKeyFingerprint !== session.deviceKeyFingerprint ||
    verifiedCertificate.creatorId !== session.creatorId
  ) {
    throw securityError('REGISTRY_CERTIFICATE_IDENTITY_MISMATCH', 403);
  }
  return true;
}

function buildRegistryProvenance({
  verifiedCertificate,
  session,
  registeredAt = new Date().toISOString(),
  bindingVersion = 1,
}) {
  const canonical = {
    type: 'SIGILLUM_REGISTRY_PROVENANCE',
    version: 2,
    hcvId: verifiedCertificate.hcvId,
    certificateSha256: verifiedCertificate.certificateSha256,
    contentSha256: verifiedCertificate.contentSha256,
    accountSubjectHash: sha256Text(session.accountId),
    creatorId: verifiedCertificate.creatorId,
    deviceKeyFingerprint: verifiedCertificate.deviceKeyFingerprint,
    identityVerified: true,
    registeredAt: new Date(registeredAt).toISOString(),
    bindingVersion,
  };
  return {
    ...canonical,
    status: 'SIGILLUM_REGISTRY_VERIFIED',
    integrityValid: true,
    attestationSha256: sha256Text(JSON.stringify(canonical)),
    softwareAttestationStatus: verifiedCertificate.softwareAttestation.status,
    ...(verifiedCertificate.softwareAttestation.sourceCommit
      ? { sourceCommit: verifiedCertificate.softwareAttestation.sourceCommit }
      : {}),
  };
}

module.exports = {
  authenticateRegistrySession,
  buildRegistryProvenance,
  parseCertificateRaw,
  sha256Text,
  validateSoftwareAttestation,
  verifyCertificateRaw,
  verifyRegistrationIdentity,
};
