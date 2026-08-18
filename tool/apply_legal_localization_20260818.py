from pathlib import Path
import re

PATH = Path('production_server.js')
source = PATH.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global source
    count = source.count(old)
    if count == 1:
        source = source.replace(old, new, 1)
        return
    if count == 0 and new in source:
        return
    raise RuntimeError(f'{label}: expected one anchor, found {count}')


def init_schema_bounds():
    start = source.find('async function initSchema() {')
    if start < 0:
        raise RuntimeError('initSchema start not found')
    markers = [
        source.find('\nasync function withTransaction', start),
        source.find('\nasync function securityEvent', start),
    ]
    boundaries = [pos for pos in markers if pos >= 0]
    if not boundaries:
        raise RuntimeError('initSchema successor boundary not found')
    boundary = min(boundaries)
    end = source.rfind('\n}', start, boundary)
    if end < 0:
        raise RuntimeError('initSchema closing boundary not found')
    return start, end, boundary


# Legal module only: no certificate verification, Registry storage, HCV signature,
# hash-chain or KYC implementation is modified by this patch.
if "require('./legal_documents')" not in source:
    replace_once(
        "const { Pool } = require('pg');\n",
        "const { Pool } = require('pg');\nconst { normalizeLanguage, legalShell, legalDocument, legalPage, emailCopy } = require('./legal_documents');\n",
        'legal module import',
    )

source = source.replace("process.env.TERMS_VERSION || '2026-08-11'", "process.env.TERMS_VERSION || '2026-08-18'")
source = source.replace("process.env.PRIVACY_VERSION || '2026-08-11'", "process.env.PRIVACY_VERSION || '2026-08-18'")

# Add acceptance evidence columns to new schemas.
create_columns_old = """      terms_version TEXT NOT NULL DEFAULT '',
      privacy_version TEXT NOT NULL DEFAULT '',
      terms_accepted_at TIMESTAMPTZ,
"""
create_columns_new = """      terms_version TEXT NOT NULL DEFAULT '',
      privacy_version TEXT NOT NULL DEFAULT '',
      preferred_language TEXT NOT NULL DEFAULT 'en',
      contract_language TEXT NOT NULL DEFAULT 'en',
      terms_document_sha256 TEXT NOT NULL DEFAULT '',
      privacy_document_sha256 TEXT NOT NULL DEFAULT '',
      acceptance_method TEXT NOT NULL DEFAULT 'clickwrap',
      terms_accepted_at TIMESTAMPTZ,
"""
if 'terms_document_sha256 TEXT' not in source:
    replace_once(create_columns_old, create_columns_new, 'acceptance schema columns')

# Existing PostgreSQL databases need additive migration without deleting data.
# Keep this migration inside initSchema(). A previous implementation searched for
# the last closing brace before securityEvent(), which became unsafe after the
# runtime-safety patch inserted withTransaction() between initSchema and
# securityEvent. That could place the migration inside withTransaction instead of
# startup schema initialization.
migration = """  await pool.query(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS contract_language TEXT NOT NULL DEFAULT 'en';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS terms_document_sha256 TEXT NOT NULL DEFAULT '';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS privacy_document_sha256 TEXT NOT NULL DEFAULT '';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS acceptance_method TEXT NOT NULL DEFAULT 'clickwrap';
  `);"""

init_start, init_end, _ = init_schema_bounds()
existing_migration = source.find(migration)
if existing_migration >= 0 and not (init_start < existing_migration < init_end):
    source = source[:existing_migration] + source[existing_migration + len(migration):]
    init_start, init_end, _ = init_schema_bounds()

if source.find(migration, init_start, init_end) < 0:
    source = source[:init_end] + '\n' + migration + source[init_end:]

# Transactional email follows the user-selected language.
send_pattern = re.compile(r"async function sendCode\(email, code, purpose\) \{.*?\n\}\n\nasync function storeCode", re.S)
if 'emailCopy(purpose, language' not in source:
    replacement = '''async function sendCode(email, code, purpose, language = 'en') {
  const localized = emailCopy(purpose, language, code, CODE_TTL_MINUTES);
  if (!RESEND_API_KEY) {
    if (NODE_ENV === 'production') throw new Error('RESEND_API_KEY_REQUIRED');
    console.log(`[DEV EMAIL] ${email} ${purpose}: ${code}`);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [email],
      subject: localized.subject,
      html: localized.html,
    }),
  });
  if (!response.ok) throw new Error(`EMAIL_PROVIDER_${response.status}`);
}

async function storeCode'''
    source, count = send_pattern.subn(replacement, source, count=1)
    if count != 1:
        raise RuntimeError('sendCode localization anchor missing')

# Expose acceptance evidence in account envelope for audit/support.
envelope_old = """    termsVersion: account.terms_version,
    privacyVersion: account.privacy_version,
    deviceCount,
"""
envelope_new = """    termsVersion: account.terms_version,
    privacyVersion: account.privacy_version,
    preferredLanguage: account.preferred_language || 'en',
    contractLanguage: account.contract_language || 'en',
    termsDocumentSha256: account.terms_document_sha256 || '',
    privacyDocumentSha256: account.privacy_document_sha256 || '',
    acceptanceMethod: account.acceptance_method || '',
    deviceCount,
"""
if 'termsDocumentSha256:' not in source:
    replace_once(envelope_old, envelope_new, 'account acceptance envelope')

# The legacy Italian-only page definitions are replaced by legal_documents.js.
if 'function legalShell(title, body)' in source:
    legal_pattern = re.compile(r"function legalShell\(title, body\) \{.*?\nfunction legalPage\(pathname\) \{.*?\n  return null;\n\}\n", re.S)
    source, count = legal_pattern.subn('', source, count=1)
    if count != 1:
        raise RuntimeError('legacy legal page block not removable')

legal_call_old = """  const legal = legalPage(url.pathname);
  if (req.method === 'GET' && legal) return sendHtml(res, 200, legal);
"""
legal_call_new = """  const legal = legalPage(url.pathname, url.searchParams.get('lang'), {
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
  });
  if (req.method === 'GET' && legal) return sendHtml(res, 200, legal);
"""
if "url.searchParams.get('lang')" not in source:
    replace_once(legal_call_old, legal_call_new, 'localized legal route')

# Registration: server computes language and immutable hashes from the exact
# localized documents it serves. Client-supplied versions are not authoritative.
reg_anchor = """    const creatorName = validateName(body.creatorName);
    if (body.acceptTerms !== true || body.acknowledgePrivacy !== true) throw publicError('TERMINI_NON_ACCETTATI', 400);
"""
reg_new = """    const creatorName = validateName(body.creatorName);
    const preferredLanguage = normalizeLanguage(body.languageCode);
    const termsDocument = legalDocument('terms', preferredLanguage, { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
    const privacyDocument = legalDocument('privacy', preferredLanguage, { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
    const termsDocumentSha256 = hash(`${termsDocument.title}\n${termsDocument.body}`);
    const privacyDocumentSha256 = hash(`${privacyDocument.title}\n${privacyDocument.body}`);
    if (body.acceptTerms !== true || body.acknowledgePrivacy !== true) throw publicError('TERMINI_NON_ACCETTATI', 400);
"""
if 'const termsDocumentSha256' not in source:
    replace_once(reg_anchor, reg_new, 'registration legal evidence')

insert_sql_old = """`INSERT INTO accounts(id,email_normalized,email_display,password_salt,password_hash,creator_name,creator_id,terms_version,privacy_version,terms_accepted_at,privacy_ack_at,adult_confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10)`, [accountId, email, String(body.email).trim(), pw.salt, pw.passwordHash, creatorName, String(body.creatorId || ''), TERMS_VERSION, PRIVACY_VERSION, now]"""
insert_sql_new = """`INSERT INTO accounts(id,email_normalized,email_display,password_salt,password_hash,creator_name,creator_id,terms_version,privacy_version,preferred_language,contract_language,terms_document_sha256,privacy_document_sha256,acceptance_method,terms_accepted_at,privacy_ack_at,adult_confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,'clickwrap',$13,$13,$13)`, [accountId, email, String(body.email).trim(), pw.salt, pw.passwordHash, creatorName, String(body.creatorId || ''), TERMS_VERSION, PRIVACY_VERSION, preferredLanguage, termsDocumentSha256, privacyDocumentSha256, now]"""
if "acceptance_method,terms_accepted_at" not in source:
    # The runtime-safety patch intentionally changes pool.query to client.query
    # inside a transaction. Replacing only the SQL+arguments preserves whichever
    # safe query object is already in use.
    replace_once(insert_sql_old, insert_sql_new, 'registration insert evidence')

source = source.replace(
    "await sendCode(String(body.email).trim(), code, 'verify_email');",
    "await sendCode(String(body.email).trim(), code, 'verify_email', preferredLanguage);",
)
source = source.replace(
    "await securityEvent(accountId, 'ACCOUNT_REGISTERED');",
    "await securityEvent(accountId, 'ACCOUNT_REGISTERED', { language: preferredLanguage, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, termsDocumentSha256, privacyDocumentSha256, acceptanceMethod: 'clickwrap' });",
)

# Resend / password recovery use the currently requested UI language when sent,
# falling back to the account language for older clients.
source = source.replace(
    "await sendCode(account.email_display, code, 'verify_email');",
    "await sendCode(account.email_display, code, 'verify_email', normalizeLanguage(body.languageCode || account.preferred_language));",
)
source = source.replace(
    "await sendCode(account.email_display, code, 'reset_password');",
    "await sendCode(account.email_display, code, 'reset_password', normalizeLanguage(body.languageCode || account.preferred_language));",
)

# Health exposes only revision metadata, not personal data.
health_old = "termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });"
health_new = "termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, legalLanguages: ['it','en','es','ru'] });"
if "legalLanguages: ['it','en','es','ru']" not in source:
    if health_old not in source:
        raise RuntimeError('health legal revision anchor missing')
    source = source.replace(health_old, health_new, 1)

required = [
    "require('./legal_documents')",
    "url.searchParams.get('lang')",
    'terms_document_sha256',
    'privacy_document_sha256',
    "acceptanceMethod: 'clickwrap'",
    "normalizeLanguage(body.languageCode)",
    "emailCopy(purpose, language",
]
for token in required:
    if token not in source:
        raise RuntimeError(f'backend legal localization token missing: {token}')

# Migration invariant: the additive account/legal migration must execute during
# initSchema startup, before any registration request can use the new columns.
init_start, init_end, _ = init_schema_bounds()
migration_token = 'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS preferred_language'
migration_pos = source.find(migration_token)
if migration_pos < init_start or migration_pos >= init_end:
    raise RuntimeError('legal account migration is outside initSchema')
if source.count(migration_token) != 1:
    raise RuntimeError('legal account migration must exist exactly once')

# Explicit invariant: this patch must not alter or replace HCV verification/storage
# implementation. The strings below must still exist after the legal patch.
for invariant in [
    'function verifyCertificateRaw(raw, expectedId)',
    "crypto.verify('RSA-SHA256'",
    'const rootHash = hash(JSON.stringify(chain));',
    "INSERT INTO certificates(hcv_id,account_id,certificate_raw,certificate_sha256)",
]:
    if invariant not in source:
        raise RuntimeError(f'HCV/Registry invariant missing after legal patch: {invariant}')

PATH.write_text(source, encoding='utf-8')
print('Applied multilingual legal pages, clickwrap evidence and email localization; HCV verification/storage unchanged')
