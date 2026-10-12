from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')
anchor = "const { createVerifiedOriginalsProduction } = require('./verified_originals_production');\n"
if "require('./sigillum_connector_runtime')" not in source:
    if anchor not in source:
        raise RuntimeError('Connector requires existing Verified Originals integration first')
    source = source.replace(anchor, anchor + "const { createConnectorRuntime } = require('./sigillum_connector_runtime');\n", 1)

anchor = 'async function handle(req, res) {\n'
if 'const connectorRuntime = createConnectorRuntime({ verifiedOriginals });' not in source:
    if 'const verifiedOriginals = createVerifiedOriginalsProduction({' not in source or anchor not in source:
        raise RuntimeError('Connector factory startup anchor missing')
    source = source.replace(anchor, 'const connectorRuntime = createConnectorRuntime({ verifiedOriginals });\n\n' + anchor, 1)

anchor = '  if (await verifiedOriginals.handle(req, res, url)) return;\n'
if 'connectorRuntime.handle(req, res, url)' not in source:
    if anchor not in source:
        raise RuntimeError('Connector request anchor missing')
    source = source.replace(anchor, '  if (await connectorRuntime.handle(req, res, url)) return;\n' + anchor, 1)

anchor = '  await verifiedOriginals.initSchema();\n'
if 'await connectorRuntime.initSchema();' not in source:
    if anchor not in source:
        raise RuntimeError('Connector schema startup anchor missing')
    source = source.replace(anchor, anchor + '  await connectorRuntime.initSchema();\n', 1)

path.write_text(source, encoding='utf-8')
print('Optional SIGILLUM connector startup wired; activation requires explicit environment configuration')
