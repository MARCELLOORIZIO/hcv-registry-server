from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

binding_import = "const { inspectCertificateAccountBinding } = require('./certificate_account_binding');\n"
provenance_import = (
    binding_import
    + "const { buildRegistryProvenanceRecord, provenanceEnvelopeFromRow } = require('./registry_provenance_v2');\n"
)
if "require('./registry_provenance_v2')" not in source:
    if binding_import not in source:
        raise RuntimeError('registry provenance v2 requires certificate account binding first')
    source = source.replace(binding_import, provenance_import, 1)

schema_anchor = "    ALTER TABLE certificates ADD COLUMN IF NOT EXISTS binding_version INTEGER NOT NULL DEFAULT 0;\n"
schema_extension = schema_anchor + """    ALTER TABLE certificates ADD COLUMN IF NOT EXISTS content_sha256 TEXT NOT NULL DEFAULT '';
    ALTER TABLE certificates ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE certificates ADD COLUMN IF NOT EXISTS registry_attested_at TIMESTAMPTZ;
    ALTER TABLE certificates ADD COLUMN IF NOT EXISTS provenance_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE certificates ADD COLUMN IF NOT EXISTS registry_attestation_sha256 TEXT NOT NULL DEFAULT '';
"""
if 'ADD COLUMN IF NOT EXISTS provenance_version' not in source:
    if schema_anchor not in source:
        raise RuntimeError('registry provenance schema anchor missing')
    source = source.replace(schema_anchor, schema_extension, 1)

old_upload = """    const accountSubjectHash = hash(access.session.account_id);
    try {
      await pool.query(
        `INSERT INTO certificates(
           hcv_id,account_id,certificate_raw,certificate_sha256,
           account_subject_hash,device_key_fingerprint,creator_id,binding_version
         ) VALUES($1,$2,$3,$4,$5,$6,$7,1)`,
        [
          hcvId,
          access.session.account_id,
          raw,
          hash(raw),
          accountSubjectHash,
          binding.certificateFingerprint,
          binding.certificateCreatorId,
        ],
      );
"""
new_upload = """    const accountSubjectHash = hash(access.session.account_id);
    const provenance = buildRegistryProvenanceRecord({
      hcvId,
      certificateRaw: raw,
      certificate,
      accountId: access.session.account_id,
      creatorId: binding.certificateCreatorId,
      deviceKeyFingerprint: binding.certificateFingerprint,
      identityVerified: access.account.legalIdentityVerified,
      bindingVersion: 1,
    });
    if (provenance.accountSubjectHash !== accountSubjectHash) {
      throw publicError('CERTIFICATO_NON_VALIDO', 400, 'Binding account del Registry non coerente.');
    }
    try {
      await pool.query(
        `INSERT INTO certificates(
           hcv_id,account_id,certificate_raw,certificate_sha256,
           account_subject_hash,device_key_fingerprint,creator_id,binding_version,
           content_sha256,identity_verified,registry_attested_at,provenance_version,
           registry_attestation_sha256
         ) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,2,$11)`,
        [
          hcvId,
          access.session.account_id,
          raw,
          provenance.certificateSha256,
          provenance.accountSubjectHash,
          provenance.deviceKeyFingerprint,
          provenance.creatorId,
          provenance.contentSha256,
          provenance.identityVerified,
          provenance.registeredAt,
          provenance.attestationSha256,
        ],
      );
"""
if old_upload in source:
    source = source.replace(old_upload, new_upload, 1)
elif 'buildRegistryProvenanceRecord({' not in source:
    raise RuntimeError('registry provenance upload anchor missing')

old_upload_response = """    return sendJson(res, 201, { ok: true, hcvId, storage: 'postgres', url: `/api/certificate/${hcvId}` });
"""
new_upload_response = """    return sendJson(res, 201, {
      ok: true,
      hcvId,
      storage: 'postgres',
      url: `/api/certificate/${hcvId}`,
      provenance,
    });
"""
if old_upload_response in source:
    source = source.replace(old_upload_response, new_upload_response, 1)
elif 'url: `/api/certificate/${hcvId}`,' not in source or 'provenance,' not in source:
    raise RuntimeError('registry provenance upload response anchor missing')

old_fetch = """    const row = (await pool.query('SELECT hcv_id,created_at,certificate_raw FROM certificates WHERE hcv_id=$1', [hcvId])).rows[0];
    if (!row) return sendJson(res, 404, { ok: false, error: 'Certificato non trovato' });
    return sendJson(res, 200, { ok: true, hcvId: row.hcv_id, createdAt: row.created_at, certificateRaw: row.certificate_raw });
"""
new_fetch = """    const row = (await pool.query(`SELECT
      hcv_id,created_at,certificate_raw,certificate_sha256,
      account_subject_hash,device_key_fingerprint,creator_id,binding_version,
      content_sha256,identity_verified,registry_attested_at,provenance_version,
      registry_attestation_sha256
      FROM certificates WHERE hcv_id=$1`, [hcvId])).rows[0];
    if (!row) return sendJson(res, 404, { ok: false, error: 'Certificato non trovato' });
    const provenance = provenanceEnvelopeFromRow(row);
    return sendJson(res, 200, {
      ok: true,
      hcvId: row.hcv_id,
      createdAt: row.created_at,
      certificateRaw: row.certificate_raw,
      provenance,
    });
"""
if old_fetch in source:
    source = source.replace(old_fetch, new_fetch, 1)
elif 'const provenance = provenanceEnvelopeFromRow(row);' not in source:
    raise RuntimeError('registry provenance fetch anchor missing')

old_verify = """    const row = (await pool.query('SELECT created_at,certificate_raw FROM certificates WHERE hcv_id=$1', [hcvId])).rows[0];
    if (!row) return sendHtml(res, 404, legalShell('Certificato non trovato', '<p>Questo HCV-ID non è presente nel Registry.</p>'));
    let cert; try { cert = verifyCertificateRaw(row.certificate_raw, hcvId); } catch (_) { return sendHtml(res, 422, legalShell('Certificato non valido', '<p>Il record esiste ma la firma o la catena HCV non risultano valide.</p>')); }
    const type = cert?.content?.type || 'unknown';
    return sendHtml(res, 200, legalShell('HUMAN VERIFIED', `<div class=\"card\"><h2>Certificato HCV valido</h2><p><strong>HCV-ID:</strong> ${hcvId}</p><p><strong>Tipo:</strong> ${type}</p><p><strong>Firma:</strong> RSA-SHA256-HCV-V2</p><p>Il Registry ha verificato firma e catena crittografica del certificato.</p></div>`));
"""
new_verify = """    const row = (await pool.query(`SELECT
      hcv_id,created_at,certificate_raw,certificate_sha256,
      account_subject_hash,device_key_fingerprint,creator_id,binding_version,
      content_sha256,identity_verified,registry_attested_at,provenance_version,
      registry_attestation_sha256
      FROM certificates WHERE hcv_id=$1`, [hcvId])).rows[0];
    if (!row) return sendHtml(res, 404, legalShell('Certificato non trovato', '<p>Questo HCV-ID non è presente nel Registry.</p>'));
    let cert; try { cert = verifyCertificateRaw(row.certificate_raw, hcvId); } catch (_) { return sendHtml(res, 422, legalShell('Certificato non valido', '<p>Il record esiste ma la firma o la catena HCV non risultano valide.</p>')); }
    const type = cert?.content?.type || 'unknown';
    const provenance = provenanceEnvelopeFromRow(row);
    const registryV2 = provenance.status === 'SIGILLUM_REGISTRY_VERIFIED' && provenance.integrityValid === true;
    const title = registryV2 ? 'SIGILLUM REGISTRY VERIFIED' : 'HCV INTEGRITY VERIFIED';
    const registryLine = registryV2
      ? `<p><strong>Registry:</strong> provenienza v2 verificata</p><p><strong>Identità verificata:</strong> ${provenance.identityVerified ? 'sì' : 'no'}</p><p><strong>Dispositivo:</strong> …${String(provenance.deviceKeyFingerprint || '').slice(-12).toUpperCase()}</p><p><strong>Registrato:</strong> ${provenance.registeredAt}</p>`
      : '<p><strong>Registry:</strong> record legacy; firma e integrità HCV valide, ma senza attestazione di provenienza v2.</p>';
    return sendHtml(res, 200, legalShell(title, `<div class=\"card\"><h2>Certificato HCV valido</h2><p><strong>HCV-ID:</strong> ${hcvId}</p><p><strong>Tipo:</strong> ${type}</p><p><strong>Firma:</strong> RSA-SHA256-HCV-V2</p>${registryLine}</div>`));
"""
if old_verify in source:
    source = source.replace(old_verify, new_verify, 1)
elif "const registryV2 = provenance.status === 'SIGILLUM_REGISTRY_VERIFIED'" not in source:
    raise RuntimeError('registry provenance public verify anchor missing')

required = [
    "require('./registry_provenance_v2')",
    'ADD COLUMN IF NOT EXISTS provenance_version',
    'ADD COLUMN IF NOT EXISTS registry_attestation_sha256',
    'buildRegistryProvenanceRecord({',
    'provenance.accountSubjectHash',
    'provenance.contentSha256',
    'provenance.attestationSha256',
    'provenanceEnvelopeFromRow(row)',
    'SIGILLUM REGISTRY VERIFIED',
    'HCV INTEGRITY VERIFIED',
]
for token in required:
    if token not in source:
        raise RuntimeError(f'registry provenance v2 token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Registry provenance v2 applied')
