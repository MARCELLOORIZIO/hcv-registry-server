const crypto = require('crypto');

function normalizePublicKey(publicKey) {
  if (!publicKey || typeof publicKey !== 'object') return null;
  const modulus = String(publicKey.modulus || '');
  const exponent = String(publicKey.exponent || '');
  if (!modulus || !exponent) return null;
  return { modulus, exponent };
}

function fingerprintPublicKey(publicKey) {
  const normalized = normalizePublicKey(publicKey);
  if (!normalized) return '';
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized), 'utf8')
    .digest('hex');
}

function normalizeFingerprint(value) {
  return String(value || '').trim().toLowerCase();
}

function inspectCertificateAccountBinding({
  certificate,
  sessionDeviceFingerprint,
  registeredDevice,
  accountCreatorId,
}) {
  const certificatePublicKey = normalizePublicKey(certificate?.publicKey);
  if (!certificatePublicKey) {
    return { ok: false, reason: 'CERTIFICATE_PUBLIC_KEY_MISSING' };
  }

  const certificateFingerprint = fingerprintPublicKey(certificatePublicKey);
  const sessionFingerprint = normalizeFingerprint(sessionDeviceFingerprint);
  if (!sessionFingerprint || certificateFingerprint !== sessionFingerprint) {
    return {
      ok: false,
      reason: 'CERTIFICATE_KEY_SESSION_MISMATCH',
      certificateFingerprint,
    };
  }

  const identity = certificate?.meta?.identity;
  if (!identity || typeof identity !== 'object') {
    return {
      ok: false,
      reason: 'CERTIFICATE_IDENTITY_MISSING',
      certificateFingerprint,
    };
  }

  const declaredIdentityFingerprint = normalizeFingerprint(
    identity.devicePublicKeyFingerprint,
  );
  if (
    !declaredIdentityFingerprint ||
    declaredIdentityFingerprint !== certificateFingerprint
  ) {
    return {
      ok: false,
      reason: 'CERTIFICATE_IDENTITY_KEY_MISMATCH',
      certificateFingerprint,
    };
  }

  if (identity.publicKey && typeof identity.publicKey === 'object') {
    const identityPublicKeyFingerprint = fingerprintPublicKey(identity.publicKey);
    if (identityPublicKeyFingerprint !== certificateFingerprint) {
      return {
        ok: false,
        reason: 'CERTIFICATE_IDENTITY_PUBLIC_KEY_MISMATCH',
        certificateFingerprint,
      };
    }
  }

  if (!registeredDevice || typeof registeredDevice !== 'object') {
    return {
      ok: false,
      reason: 'REGISTERED_DEVICE_MISSING',
      certificateFingerprint,
    };
  }

  const registeredFingerprint = normalizeFingerprint(
    registeredDevice.device_key_fingerprint,
  );
  if (!registeredFingerprint || registeredFingerprint !== sessionFingerprint) {
    return {
      ok: false,
      reason: 'REGISTERED_DEVICE_SESSION_MISMATCH',
      certificateFingerprint,
    };
  }

  const registeredPublicKeyFingerprint = fingerprintPublicKey(
    registeredDevice.public_key_json,
  );
  if (
    !registeredPublicKeyFingerprint ||
    registeredPublicKeyFingerprint !== certificateFingerprint
  ) {
    return {
      ok: false,
      reason: 'REGISTERED_DEVICE_KEY_MISMATCH',
      certificateFingerprint,
    };
  }

  const certificateCreatorId = String(identity.creatorId || '').trim();
  if (!certificateCreatorId) {
    return {
      ok: false,
      reason: 'CERTIFICATE_CREATOR_ID_MISSING',
      certificateFingerprint,
    };
  }

  const serverCreatorId = String(accountCreatorId || '').trim();
  if (serverCreatorId && serverCreatorId !== certificateCreatorId) {
    return {
      ok: false,
      reason: 'CERTIFICATE_CREATOR_ID_MISMATCH',
      certificateFingerprint,
      certificateCreatorId,
    };
  }

  return {
    ok: true,
    certificateFingerprint,
    certificateCreatorId,
    needsCreatorIdBind: !serverCreatorId,
  };
}

module.exports = {
  fingerprintPublicKey,
  inspectCertificateAccountBinding,
  normalizePublicKey,
};
