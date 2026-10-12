'use strict';

// An explicit, fail-closed boundary between SIGILLUM and a future authenticated
// ChatGPT/MCP transport. This module NEVER accepts an HCV-ID as authorization,
// and never exposes the owner's bearer token, R2 credentials, or browser cookie.
const HCV = /^HCV-[A-F0-9]{16}$/;
function bridgeError(code) {
  return Object.assign(new Error(code), { code });
}
function createSigillumConnectorBridge({ getAuthorizedGrant, readApprovedReference,
  recordEvent, now = () => Date.now() }) {
  if (![getAuthorizedGrant, readApprovedReference, recordEvent].every(f => typeof f === 'function')) {
    throw new TypeError('AUTHORIZED_GRANT_ADAPTER_REQUIRED');
  }
  async function readOriginal({ connectorPrincipal, grantId, hcvId }) {
    if (typeof connectorPrincipal !== 'string' || !connectorPrincipal ||
        typeof grantId !== 'string' || !/^[a-f0-9]{32}$/.test(grantId) ||
        !HCV.test(hcvId)) throw bridgeError('AUDIT_INPUT_INVALID');
    // getAuthorizedGrant MUST authenticate the MCP principal against its own
    // channel credentials and attest owner consent; no browser-cookie fallback.
    const grant = await getAuthorizedGrant({ connectorPrincipal, grantId });
    if (!grant || grant.state !== 'APPROVED' ||
        grant.connectorPrincipal !== connectorPrincipal ||
        !Array.isArray(grant.hcvIds) || !grant.hcvIds.includes(hcvId) ||
        !Number.isFinite(grant.expiresAtMs) || grant.expiresAtMs <= now() ||
        grant.revoked === true) throw bridgeError('AUDIT_NOT_AUTHORIZED');
    if (grant.reads?.includes(hcvId)) throw bridgeError('AUDIT_READ_ALREADY_ISSUED');
    // Implementations must atomically consume the single-use grant before
    // decrypting. Fail closed if the audit event cannot be written.
    await recordEvent({ grantId, hcvId, connectorPrincipal, type: 'READ_REQUESTED' });
    try {
      const result = await readApprovedReference({ grantId, hcvId, connectorPrincipal });
      if (!result || !(result.bytes instanceof Uint8Array) ||
          !['image/jpeg','image/png','video/mp4'].includes(result.contentType))
        throw bridgeError('AUDIT_REFERENCE_INVALID');
      await recordEvent({ grantId, hcvId, connectorPrincipal, type: 'READ_COMPLETED' });
      return { bytes: result.bytes, contentType: result.contentType };
    } catch (error) {
      await recordEvent({ grantId, hcvId, connectorPrincipal, type: 'READ_FAILED' });
      throw error;
    }
  }
  return { readOriginal };
}
module.exports = { createSigillumConnectorBridge };
