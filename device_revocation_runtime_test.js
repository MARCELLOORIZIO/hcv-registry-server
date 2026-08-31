const fs = require('fs');

const source = fs.readFileSync('production_server.js', 'utf8');

const required = [
  "function deviceRevocationCopy(language)",
  "req.method === 'POST' && url.pathname === '/api/auth/devices/revoke'",
  "enforceRate(req, `device-revoke:${session.account_id}`",
  "passwordMatches(password, account)",
  "DISPOSITIVO_CORRENTE_NON_REVOCABILE",
  "FOR UPDATE",
  "UPDATE account_devices",
  "SET revoked_at=NOW()",
  "UPDATE sessions",
  "SET revoked_at=COALESCE(revoked_at,NOW())",
  "DELETE FROM device_enrollment_challenges",
  "securityEvent(session.account_id, 'DEVICE_REVOKED'",
  "device_key_fingerprint=$2 AND revoked_at IS NULL",
  "it: {",
  "en: {",
  "es: {",
  "ru: {",
];

for (const marker of required) {
  if (!source.includes(marker)) {
    throw new Error(`DEVICE_REVOCATION_CONTRACT_MISSING: ${marker}`);
  }
}

const routeIndex = source.indexOf("req.method === 'POST' && url.pathname === '/api/auth/devices/revoke'");
const currentGuardIndex = source.indexOf('DISPOSITIVO_CORRENTE_NON_REVOCABILE', routeIndex);
const deviceRevokeIndex = source.indexOf('UPDATE account_devices', routeIndex);
const sessionRevokeIndex = source.indexOf('UPDATE sessions', routeIndex);
const eventIndex = source.indexOf("securityEvent(session.account_id, 'DEVICE_REVOKED'", routeIndex);

if (!(routeIndex >= 0 && currentGuardIndex > routeIndex && deviceRevokeIndex > currentGuardIndex && sessionRevokeIndex > deviceRevokeIndex && eventIndex > sessionRevokeIndex)) {
  throw new Error('DEVICE_REVOCATION_ORDER_INVALID');
}

console.log('Device revocation runtime contract OK');
