from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

import_anchor = "const crypto = require('crypto');\n"
import_line = (
    "const crypto = require('crypto');\n"
    "const { inspectCertificateAccountBinding } = require('./certificate_account_binding');\n"
)
if "require('./certificate_account_binding')" not in source:
    if import_anchor not in source:
        raise RuntimeError('certificate binding import anchor missing')
    source = source.replace(import_anchor, import_line, 1)

schema_anchor = """    CREATE INDEX IF NOT EXISTS certificates_account_idx ON certificates(account_id, created_at DESC);
"""
schema_extension = schema_anchor + """    ALTER TABLE certificates ADD COLUMN IF NOT EXISTS device_key_fingerprint TEXT NOT NULL DEFAULT '';
    ALTER TABLE certificates ADD COLUMN IF NOT EXISTS creator_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE certificates ADD COLUMN IF NOT EXISTS binding_version INTEGER NOT NULL DEFAULT 0;
"""
if 'ADD COLUMN IF NOT EXISTS binding_version' not in source:
    if schema_anchor not in source:
        raise RuntimeError('certificate schema anchor missing')
    source = source.replace(schema_anchor, schema_extension, 1)

old_upload = """    verifyCertificateRaw(raw, hcvId);
    try {
      await pool.query('INSERT INTO certificates(hcv_id,account_id,certificate_raw,certificate_sha256) VALUES($1,$2,$3,$4)', [hcvId, access.session.account_id, raw, hash(raw)]);
"""
new_upload = """    const certificate = verifyCertificateRaw(raw, hcvId);
    const registeredDevice = (
      await pool.query(
        'SELECT device_key_fingerprint,public_key_json FROM account_devices WHERE account_id=$1 AND device_key_fingerprint=$2',
        [access.session.account_id, access.session.device_key_fingerprint],
      )
    ).rows[0];
    const binding = inspectCertificateAccountBinding({
      certificate,
      sessionDeviceFingerprint: access.session.device_key_fingerprint,
      registeredDevice,
      accountCreatorId: access.account.creatorId,
    });
    if (!binding.ok) {
      await securityEvent(access.session.account_id, 'CERTIFICATE_BINDING_REJECTED', {
        hcvId,
        device: access.session.device_key_fingerprint,
        reason: binding.reason,
      });
      throw publicError(
        'CERTIFICATO_NON_VALIDO',
        400,
        'Il certificato non corrisponde al dispositivo o all’identità dell’account.',
      );
    }
    if (binding.needsCreatorIdBind) {
      await pool.query(
        `UPDATE accounts
         SET creator_id=$2,updated_at=NOW()
         WHERE id=$1 AND (creator_id IS NULL OR creator_id='')`,
        [access.session.account_id, binding.certificateCreatorId],
      );
      const creatorBinding = (
        await pool.query('SELECT creator_id FROM accounts WHERE id=$1', [access.session.account_id])
      ).rows[0];
      if (String(creatorBinding?.creator_id || '').trim() !== binding.certificateCreatorId) {
        await securityEvent(access.session.account_id, 'CERTIFICATE_BINDING_REJECTED', {
          hcvId,
          device: access.session.device_key_fingerprint,
          reason: 'CREATOR_ID_CONCURRENT_BINDING_MISMATCH',
        });
        throw publicError(
          'CERTIFICATO_NON_VALIDO',
          400,
          'Il certificato non corrisponde al dispositivo o all’identità dell’account.',
        );
      }
      access.account.creatorId = binding.certificateCreatorId;
      await securityEvent(access.session.account_id, 'CREATOR_ID_BOUND_FROM_CERTIFICATE', {
        creatorId: binding.certificateCreatorId,
        device: binding.certificateFingerprint,
      });
    }
    try {
      await pool.query(
        `INSERT INTO certificates(
           hcv_id,account_id,certificate_raw,certificate_sha256,
           device_key_fingerprint,creator_id,binding_version
         ) VALUES($1,$2,$3,$4,$5,$6,1)`,
        [
          hcvId,
          access.session.account_id,
          raw,
          hash(raw),
          binding.certificateFingerprint,
          binding.certificateCreatorId,
        ],
      );
"""
if old_upload in source:
    source = source.replace(old_upload, new_upload, 1)
elif "'CERTIFICATE_BINDING_REJECTED'" not in source:
    raise RuntimeError('certificate upload binding anchor missing')

required = [
    "require('./certificate_account_binding')",
    'ADD COLUMN IF NOT EXISTS device_key_fingerprint',
    'ADD COLUMN IF NOT EXISTS creator_id',
    'ADD COLUMN IF NOT EXISTS binding_version',
    'inspectCertificateAccountBinding({',
    "'CERTIFICATE_BINDING_REJECTED'",
    'CREATOR_ID_CONCURRENT_BINDING_MISMATCH',
    'binding.certificateFingerprint',
    'binding.certificateCreatorId',
    'binding_version',
]
for token in required:
    if token not in source:
        raise RuntimeError(f'certificate account binding token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Certificate device/account binding applied')
