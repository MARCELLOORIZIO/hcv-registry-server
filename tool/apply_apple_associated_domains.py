from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global source
    if new in source:
        return
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one anchor, found {count}')
    source = source.replace(old, new, 1)


replace_once(
    """const APP_BASE_URL = process.env.APP_BASE_URL || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
""",
    """const APP_BASE_URL = process.env.APP_BASE_URL || '';
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || 'DN9W7Z3HCZ';
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.sigillum.hcv';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
""",
    'Apple application identity constants',
)

replace_once(
    """function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

async function readJson(req, maxBytes = 1_000_000) {
""",
    """function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function sendAppleAssociation(res) {
  const appId = `${APPLE_TEAM_ID}.${APPLE_BUNDLE_ID}`;
  const body = JSON.stringify({
    applinks: {
      apps: [],
      details: [
        {
          appID: appId,
          paths: ['/verify/*', '/v/*'],
        },
      ],
    },
    webcredentials: {
      apps: [appId],
    },
  });
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(body);
}

async function readJson(req, maxBytes = 1_000_000) {
""",
    'Apple association response helper',
)

if "url.pathname === '/.well-known/apple-app-site-association'" not in source:
    replace_once(
        """async function handle(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const legal = legalPage(url.pathname);
""",
        """async function handle(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (
    req.method === 'GET' &&
    (url.pathname === '/.well-known/apple-app-site-association' ||
      url.pathname === '/apple-app-site-association')
  ) {
    return sendAppleAssociation(res);
  }
  const legal = legalPage(url.pathname);
""",
        'Apple association routes',
    )

for token in [
    "const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || 'DN9W7Z3HCZ';",
    "url.pathname === '/.well-known/apple-app-site-association'",
    "url.pathname === '/apple-app-site-association'",
    "webcredentials:",
    "paths: ['/verify/*', '/v/*']",
    "'Content-Type': 'application/json'",
]:
    if token not in source:
        raise RuntimeError(f'Apple associated-domain token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Apple associated-domain AASA endpoints applied')
