from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

pg_import = "const { Pool } = require('pg');\n"
config_import = "const { assertProductionConfig, validateProductionConfig } = require('./production_config');\n"
if config_import not in source:
    if pg_import not in source:
        raise RuntimeError('pg import anchor missing')
    source = source.replace(pg_import, pg_import + config_import, 1)

privacy_anchor = "const PRIVACY_VERSION = process.env.PRIVACY_VERSION || '2026-08-11';\n"
contact_constants = privacy_anchor + "const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'marcelloorizio@legalmail.it';\nconst PRIVACY_EMAIL = process.env.PRIVACY_EMAIL || 'marcelloorizio@legalmail.it';\n"
if 'const SUPPORT_EMAIL =' not in source:
    if privacy_anchor not in source:
        raise RuntimeError('privacy version anchor missing')
    source = source.replace(privacy_anchor, contact_constants, 1)

old_contact = "<h2>Contatti</h2><p>PEC: marcelloorizio@legalmail.it. Prima del lancio verrà indicato anche l'indirizzo email dedicato privacy/supporto.</p>"
new_contact = "<h2>Contatti</h2><p>Email privacy: ${PRIVACY_EMAIL}. Assistenza: ${SUPPORT_EMAIL}. PEC per comunicazioni formali: marcelloorizio@legalmail.it.</p>"
if old_contact in source:
    source = source.replace(old_contact, new_contact, 1)
elif new_contact not in source:
    raise RuntimeError('privacy contact anchor missing')

health_old = "return sendJson(res, 200, { ok: true, service: 'sigillum-production-postgres', database: true, dbTime: db.rows[0].now, subscriptionsEnforced: SUBSCRIPTIONS_ENFORCED, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });"
health_new = """const readiness = validateProductionConfig(process.env);
    return sendJson(res, 200, {
      ok: true,
      service: 'sigillum-production-postgres',
      database: true,
      dbTime: db.rows[0].now,
      subscriptionsEnforced: SUBSCRIPTIONS_ENFORCED,
      productionLive: readiness.live,
      readyForLive: readiness.live && readiness.ready,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
    });"""
if health_old in source:
    source = source.replace(health_old, health_new, 1)
elif 'readyForLive:' not in source:
    raise RuntimeError('health readiness anchor missing')

main_old = """async function main() {
  await initSchema();
"""
main_new = """async function main() {
  const productionConfig = assertProductionConfig(process.env);
  if (productionConfig.live) {
    console.log('SIGILLUM production LIVE configuration validated');
  } else {
    console.log('SIGILLUM production server running in PRELAUNCH mode');
  }
  await initSchema();
"""
if main_old in source:
    source = source.replace(main_old, main_new, 1)
elif 'assertProductionConfig(process.env)' not in source:
    raise RuntimeError('main production guard anchor missing')

required = [
    "require('./production_config')",
    'assertProductionConfig(process.env)',
    'readyForLive:',
    'productionLive:',
    'SUPPORT_EMAIL',
    'PRIVACY_EMAIL',
]
for token in required:
    if token not in source:
        raise RuntimeError(f'production live guard token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Production LIVE readiness guard and dedicated legal contacts applied')
