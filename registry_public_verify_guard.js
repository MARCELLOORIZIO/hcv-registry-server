'use strict';

// Public verification must report exactly what the Registry has proved.
// Presence of a legacy row is not equivalent to cryptographic verification.

const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');

const HCV_ID_PATTERN = /^HCV-[A-F0-9]{16}$/;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'registry.db');
const db = new Database(dbPath);
db.pragma('busy_timeout = 5000');

const getCertificate = db.prepare(`
SELECT hcv_id, created_at, certificate_raw
FROM certificates
WHERE hcv_id = ?
`);
const getProvenance = db.prepare(`
SELECT * FROM registry_provenance WHERE hcv_id = ?
`);
const getLatestStatus = db.prepare(`
SELECT status, reason_code, created_at, actor
FROM certificate_status_events
WHERE hcv_id = ?
ORDER BY id DESC
LIMIT 1
`);

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseJsonObject(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function provenanceState(row, latestStatus) {
  if (!row) {
    return {
      state: 'LEGACY',
      heading: 'Registry record found',
      badge: 'LEGACY',
      tone: '#8a6d1d',
      summary:
        'This record predates server-side cryptographic Registry verification. Its presence alone is not proof that the certificate signature or the media file was verified by the Registry.',
    };
  }

  const provenance = parseJsonObject(row.provenance_raw);
  const cryptographicallyVerified =
    provenance &&
    provenance.type === 'SIGILLUM_REGISTRY_PROVENANCE' &&
    provenance.version === 2 &&
    provenance.status === 'SIGILLUM_REGISTRY_VERIFIED' &&
    provenance.integrityValid === true;

  if (!cryptographicallyVerified) {
    return {
      state: 'UNVERIFIED',
      heading: 'Registry verification unavailable',
      badge: 'CHECK',
      tone: '#8a4b1d',
      summary:
        'A Registry record exists, but its cryptographic verification provenance is missing or invalid. Do not treat this page as an integrity confirmation.',
    };
  }

  const status = String(latestStatus?.status || row.registry_status || 'ACTIVE').toUpperCase();
  if (status === 'REVOKED') {
    return {
      state: status,
      heading: 'Certificate revoked',
      badge: 'REVOKED',
      tone: '#a12622',
      summary:
        'The Registry previously verified this certificate, but its current Registry status is REVOKED. The original certificate record remains immutable for audit purposes.',
    };
  }
  if (status === 'DISPUTED') {
    return {
      state: status,
      heading: 'Certificate disputed',
      badge: 'DISPUTED',
      tone: '#a85b00',
      summary:
        'The Registry verified this certificate at registration, but a dispute status is currently recorded. The underlying immutable certificate remains available for audit.',
    };
  }

  return {
    state: status,
    heading: 'Certificate verified',
    badge: 'VERIFIED',
    tone: '#1f7a45',
    summary:
      'At registration, the Registry verified the HCV certificate signature, event-chain integrity, and the signed creator/device identity against an authenticated session. This page does not by itself verify a separate copy of the media file.',
  };
}

function renderVerificationPage({ row, provenanceRow, latestStatus }) {
  const certificate = parseJsonObject(row.certificate_raw) || {};
  const provenance = provenanceRow ? parseJsonObject(provenanceRow.provenance_raw) : null;
  const state = provenanceState(provenanceRow, latestStatus);
  const creator =
    certificate?.meta?.identity?.creatorName ||
    certificate?.meta?.identity?.name ||
    'Unknown creator';
  const createdAt = certificate?.createdAt || row.created_at || 'Unknown';
  const contentType = certificate?.content?.type || 'unknown';
  const software = certificate?.meta?.softwareAttestation;
  const sourceCommit =
    provenanceRow?.source_commit ||
    (software && typeof software.sourceCommit === 'string' ? software.sourceCommit : '');
  const appVersion =
    provenanceRow?.app_version ||
    (software && typeof software.appVersion === 'string' ? software.appVersion : '');
  const buildNumber =
    provenanceRow?.build_number ||
    (software && typeof software.buildNumber === 'string' ? software.buildNumber : '');
  const registeredAt = provenance?.registeredAt || provenanceRow?.registered_at || row.created_at;
  const status = latestStatus?.status || provenanceRow?.registry_status || state.state;
  const certificateSha256 = provenance?.certificateSha256 || provenanceRow?.certificate_sha256 || '';
  const contentSha256 = provenance?.contentSha256 || certificate?.content?.hash || '';
  const attestationStatus = provenance?.softwareAttestationStatus || software?.status || 'LEGACY_UNATTESTED';

  const details = [
    ['HCV-ID', row.hcv_id],
    ['Registry state', status],
    ['Creator', creator],
    ['Certificate created', createdAt],
    ['Registry registered', registeredAt || 'Unknown'],
    ['Content type', contentType],
    ['Certificate SHA-256', certificateSha256 || 'Legacy record: not recorded'],
    ['Content SHA-256', contentSha256 || 'Not available'],
    ['Software attestation', attestationStatus],
    ['Source commit', sourceCommit || 'Not bound / legacy'],
    ['App version', appVersion || 'Not recorded'],
    ['Build number', buildNumber || 'Not recorded'],
  ];

  const rows = details
    .map(
      ([label, value]) => `
        <div class="row">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
        </div>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SIGILLUM HCV ${escapeHtml(row.hcv_id)}</title>
  <style>
    body{margin:0;background:#f6f7f6;color:#202522;font-family:Arial,Helvetica,sans-serif;line-height:1.45}
    .wrap{max-width:820px;margin:40px auto;padding:20px}
    .card{background:#fff;border:1px solid #dde3df;border-radius:20px;padding:30px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
    .badge{display:inline-block;padding:8px 12px;border-radius:999px;background:${state.tone};color:#fff;font-weight:700;letter-spacing:.04em;font-size:13px}
    h1{margin:16px 0 8px;color:${state.tone};font-size:30px}
    .summary{color:#4d5751;margin:0 0 26px}
    .grid{display:grid;gap:12px}
    .row{background:#f8faf8;border:1px solid #e5eae6;border-radius:12px;padding:12px 14px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6c756f}
    .value{margin-top:4px;font-size:14px;word-break:break-all}
    .note{margin-top:24px;padding-top:18px;border-top:1px solid #e2e7e3;color:#667069;font-size:12px}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <div class="badge">${escapeHtml(state.badge)}</div>
      <h1>${escapeHtml(state.heading)}</h1>
      <p class="summary">${escapeHtml(state.summary)}</p>
      <div class="grid">${rows}</div>
      <div class="note">SIGILLUM reports technical certificate and Registry evidence. It does not assert the truth of the depicted scene and does not replace a forensic or legal expert assessment.</div>
    </section>
  </main>
</body>
</html>`;
}

function sendHtml(res, statusCode, body) {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function handlePublicVerify(req, res) {
  if (req.method !== 'GET') return false;
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  const match = /^\/verify\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
  if (!match) return false;

  const hcvId = match[1];
  if (!HCV_ID_PATTERN.test(hcvId)) return false;
  const row = getCertificate.get(hcvId);
  if (!row) {
    sendHtml(
      res,
      404,
      '<!doctype html><html><body><h1>Certificate not found</h1><p>No Registry record exists for this HCV-ID.</p></body></html>',
    );
    return true;
  }

  let provenanceRow = null;
  let latestStatus = null;
  try {
    provenanceRow = getProvenance.get(hcvId) || null;
    latestStatus = getLatestStatus.get(hcvId) || null;
  } catch (_) {
    // Compatibility with a database that has not yet been migrated by the
    // certificate guard. Such a row is displayed conservatively as legacy.
  }

  sendHtml(
    res,
    200,
    renderVerificationPage({ row, provenanceRow, latestStatus }),
  );
  return true;
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function phaseDPublicVerifierCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer((req, res) => {
    try {
      if (handlePublicVerify(req, res)) return;
      return listener(req, res);
    } catch (error) {
      sendHtml(
        res,
        500,
        '<!doctype html><html><body><h1>Registry verification unavailable</h1></body></html>',
      );
    }
  });
};

module.exports = {
  handlePublicVerify,
  provenanceState,
  renderVerificationPage,
};
