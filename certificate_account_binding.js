const crypto = require('crypto');

function normalizePublicKey(publicKey) {
  if (!publicKey || typeof publicKey !== 'object') return null;
  const modulus = String(publicKey.modulus || '');
  const exponent = String(publicKey.exponent || '');
  if (!modulus || !exponent) return null;
  return { modulus, exponent };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function fingerprintPublicKey(publicKey) {
  const normalized = normalizePublicKey(publicKey);
  if (!normalized) return '';
  return sha256(JSON.stringify(normalized));
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

  const certificateCreatorId = String(identity.creatorId || '').trim();
  const certificateCreatorName = String(identity.creatorName || '').trim();
  const signedIdentityFingerprint = normalizeFingerprint(
    identity.identityFingerprint,
  );
  if (!certificateCreatorId) {
    return {
      ok: false,
      reason: 'CERTIFICATE_CREATOR_ID_MISSING',
      certificateFingerprint,
    };
  }
  if (!certificateCreatorName || !signedIdentityFingerprint) {
    return {
      ok: false,
      reason: 'CERTIFICATE_IDENTITY_FINGERPRINT_MISSING',
      certificateFingerprint,
      certificateCreatorId,
    };
  }

  const expectedIdentityFingerprint = sha256(
    `${certificateCreatorId}|${certificateCreatorName}|${certificateFingerprint}`,
  );
  if (signedIdentityFingerprint !== expectedIdentityFingerprint) {
    return {
      ok: false,
      reason: 'CERTIFICATE_IDENTITY_FINGERPRINT_MISMATCH',
      certificateFingerprint,
      certificateCreatorId,
    };
  }

  if (!registeredDevice || typeof registeredDevice !== 'object') {
    return {
      ok: false,
      reason: 'REGISTERED_DEVICE_MISSING',
      certificateFingerprint,
      certificateCreatorId,
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
      certificateCreatorId,
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
      certificateCreatorId,
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
    certificateCreatorName,
    needsCreatorIdBind: !serverCreatorId,
  };
}

module.exports = {
  fingerprintPublicKey,
  inspectCertificateAccountBinding,
  normalizePublicKey,
};
