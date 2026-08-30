const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('production_server.js', 'utf8');

for (const token of [
  "require('./certificate_account_binding')",
  'ADD COLUMN IF NOT EXISTS device_key_fingerprint',
  'ADD COLUMN IF NOT EXISTS creator_id',
  'ADD COLUMN IF NOT EXISTS binding_version',
  'inspectCertificateAccountBinding({',
  "'CERTIFICATE_BINDING_REJECTED'",
  'SELECT device_key_fingerprint,public_key_json FROM account_devices',
  'CREATOR_ID_CONCURRENT_BINDING_MISMATCH',
  'binding.certificateFingerprint',
  'binding.certificateCreatorId',
  'binding_version',
]) {
  assert(
    source.includes(token),
    `Expected patched production runtime to contain: ${token}`,
  );
}

const verifyIndex = source.indexOf('const certificate = verifyCertificateRaw(raw, hcvId);');
const bindingIndex = source.indexOf('const binding = inspectCertificateAccountBinding({');
const insertIndex = source.indexOf('INSERT INTO certificates(');
assert(verifyIndex >= 0, 'certificate signature verification must remain present');
assert(bindingIndex > verifyIndex, 'account/device binding must run after signature verification');
assert(insertIndex > bindingIndex, 'certificate must only be stored after binding succeeds');

console.log('Certificate binding runtime patch test passed');
