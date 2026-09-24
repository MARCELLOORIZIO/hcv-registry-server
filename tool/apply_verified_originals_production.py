from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

provenance_import = "const { buildRegistryProvenanceRecord, provenanceEnvelopeFromRow } = require('./registry_provenance_v2');\n"
feature_import = provenance_import + "const { createVerifiedOriginalsProduction } = require('./verified_originals_production');\n"
if "require('./verified_originals_production')" not in source:
    if provenance_import not in source:
        raise RuntimeError('Verified Originals production requires Registry provenance v2 first')
    source = source.replace(provenance_import, feature_import, 1)

handle_anchor = "async function handle(req, res) {\n"
factory = """const verifiedOriginals = createVerifiedOriginalsProduction({
  pool,
  authenticate,
  accountEnvelope,
  requireCreatorAccess,
  verifyCertificateRaw,
  provenanceEnvelopeFromRow,
  sendJson,
  sendHtml,
  publicError,
  readJson,
  securityEvent,
});

"""
if 'const verifiedOriginals = createVerifiedOriginalsProduction({' not in source:
    if handle_anchor not in source:
        raise RuntimeError('production handle anchor missing')
    source = source.replace(handle_anchor, factory + handle_anchor, 1)

url_anchor = "  const url = new URL(req.url, `http://${req.headers.host}`);\n"
route_hook = url_anchor + "  if (await verifiedOriginals.handle(req, res, url)) return;\n"
if 'verifiedOriginals.handle(req, res, url)' not in source:
    if url_anchor not in source:
        raise RuntimeError('production URL anchor missing')
    source = source.replace(url_anchor, route_hook, 1)

if 'await verifiedOriginals.initSchema();' not in source:
    main_idx = source.find('async function main()')
    if main_idx < 0:
        raise RuntimeError('production main anchor missing')
    tail = source[main_idx:]
    retry_anchor = "  await initSchemaWithRetry();\n"
    direct_anchor = "  await initSchema();\n"
    if retry_anchor in tail:
        tail = tail.replace(
            retry_anchor,
            retry_anchor + "  await verifiedOriginals.initSchema();\n",
            1,
        )
    elif direct_anchor in tail:
        tail = tail.replace(
            direct_anchor,
            direct_anchor + "  await verifiedOriginals.initSchema();\n",
            1,
        )
    else:
        raise RuntimeError('production schema startup anchor missing')
    source = source[:main_idx] + tail

if 'verifiedOriginals: true' not in source:
    health_anchor = '      certificateWritesEnabled: CERTIFICATE_WRITES_ENABLED,\n'
    if health_anchor not in source:
        raise RuntimeError('production health anchor missing')
    source = source.replace(
        health_anchor,
        health_anchor + '      verifiedOriginals: true,\n',
        1,
    )

required = [
    "require('./verified_originals_production')",
    'const verifiedOriginals = createVerifiedOriginalsProduction({',
    'verifiedOriginals.handle(req, res, url)',
    'await verifiedOriginals.initSchema();',
    'verifiedOriginals: true',
]
for token in required:
    if token not in source:
        raise RuntimeError(f'Verified Originals production token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Verified Originals PostgreSQL production integration applied')