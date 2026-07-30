import json
from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if new in source:
        return source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    return source.replace(old, new, 1)


# Reuse the already implemented and reviewed authentication handlers, but expose
# them as a module that can be mounted by the server Render actually starts.
proxy_source = Path("auth_proxy.js").read_text()
core_start = proxy_source.index("const dbPath =")
core_end = proxy_source.index("\nfunction proxyToRegistry")
core = proxy_source[core_start:core_end]

core = replace_once(
    core,
    """db.exec(`
CREATE TABLE IF NOT EXISTS auth_accounts (""",
    """db.exec(`
CREATE TABLE IF NOT EXISTS kyc_device_bindings (
    device_key_fingerprint TEXT PRIMARY KEY,
    public_key_json TEXT NOT NULL,
    provider_session_id TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    creator_id TEXT,
    status TEXT NOT NULL DEFAULT 'not_started',
    verified_legal_name TEXT,
    verified_country TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS auth_accounts (""",
    "KYC binding table",
)

auth_module = """const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

""" + core + """

module.exports = {
  handleAuth,
};
"""
Path("auth_api.js").write_text(auth_module)


server_path = Path("server.js")
server = server_path.read_text()
server = replace_once(
    server,
    "const Database = require('better-sqlite3');\n",
    "const Database = require('better-sqlite3');\nconst { handleAuth } = require('./auth_api');\n",
    "server auth import",
)
server = replace_once(
    server,
    """    const url = new URL(req.url, `http://${req.headers.host}`);

    const staticLegalPage = legalPage(url.pathname);""",
    """    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/auth/')) {
      const handled = await handleAuth(req, res, url);
      if (handled !== false) return handled;
      return sendJson(res, 404, {
        ok: false,
        error: 'ENDPOINT_ACCOUNT_NON_TROVATO',
        message: 'Endpoint account non trovato.',
      });
    }

    const staticLegalPage = legalPage(url.pathname);""",
    "live server auth routing",
)
server = replace_once(
    server,
    """        aiTrainer: true,
        aiModel: OPENAI_MODEL,""",
    """        aiTrainer: true,
        aiModel: OPENAI_MODEL,
        authApi: true,""",
    "health auth flag",
)
server_path.write_text(server)


smoke_path = Path("auth_smoke_test.js")
smoke = smoke_path.read_text()
smoke = replace_once(
    smoke,
    "const child = spawn(process.execPath, ['auth_proxy.js'], {",
    "const child = spawn(process.execPath, ['server.js'], {",
    "smoke live entrypoint",
)
smoke_path.write_text(smoke)


package_path = Path("package.json")
package = json.loads(package_path.read_text())
package["main"] = "server.js"
package.setdefault("scripts", {})["start"] = "node server.js"
package["scripts"]["check"] = (
    "node --check server.js && node --check auth_api.js && "
    "node --check kyc_proxy.js && node --check auth_proxy.js && "
    "node --check auth_smoke_test.js"
)
package_path.write_text(json.dumps(package, indent=2) + "\n")

print("Account API mounted in the live server.js entrypoint")
