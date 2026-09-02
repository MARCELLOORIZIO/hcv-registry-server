'use strict';

// Preloaded by Node before server.js. It wraps http.createServer so the existing
// Registry/KYC/Auth application can remain unchanged while certificate writes
// and reads are handled by the fail-closed Phase D security layer.

const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');
const {
  authenticateRegistrySession,
  buildRegistryProvenance,
  verifyCertificateRaw,
  verifyRegistrationIdentity,
} = require('./registry_certificate_security');

const HCV_ID_PATTERN = /^HCV-[A-F0-9]{16}$/;
const MAX_CERTIFICATE_BODY_BYTES = 4_000_000;
const dbPath = process.env.DB_PATH || path.join(__dirname, 'registry.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS certificates (
    hcv_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    certificate_raw TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registry_provenance (
    hcv_id TEXT PRIMARY KEY,
    registered_at TEXT NOT NULL,
    certificate_sha256 TEXT NOT NULL,
    provenance_raw TEXT NOT NULL,
    source_commit TEXT,
    app_version TEXT,
    build_number TEXT,
    registry_status TEXT NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS certificate_status_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hcv_id TEXT NOT NULL,
    status TEXT NOT NULL,
    reason_code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'REGISTRY'
);

CREATE INDEX IF NOT EXISTS certificate_status_events_hcv_idx
ON certificate_status_events(hcv_id, id);
`);

const getCertificate = db.prepare(`
SELECT hcv_id, created_at, certificate_raw
FROM certificates
WHERE hcv_id = ?
`);
const insertCertificate = db.prepare(`
INSERT INTO certificates (hcv_id, created_at, certificate_raw)
VALUES (?, ?, ?)
`);
const getProvenance = db.prepare(`
SELECT * FROM registry_provenance WHERE hcv_id = ?
`);
const insertProvenance = db.prepare(`
INSERT INTO registry_provenance (
  hcv_id, registered_at, certificate_sha256, provenance_raw,
  source_commit, app_version, build_number, registry_status
) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
`);
const insertStatusEvent = db.prepare(`
INSERT INTO certificate_status_events (
  hcv_id, status, reason_code, created_at, actor
) VALUES (?, ?, ?, ?, ?)
`);
const getLatestStatus = db.prepare(`
SELECT status, reason_code, created_at, actor
FROM certificate_status_events
WHERE hcv_id = ?
ORDER BY id DESC
LIMIT 1
`);

function sendJson(res, statusCode, body) {
  if (res.headersSent) return;
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > MAX_CERTIFICATE_BODY_BYTES) {
        const error = new Error('PAYLOAD_TOO_LARGE');
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const decoded = JSON.parse(raw || '{}');
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
          throw new Error('INVALID_JSON');
        }
        resolve(decoded);
      } catch (_) {
        const error = new Error('INVALID_JSON');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function parseHcvId(value) {
  const hcvId = String(value || '').trim().toUpperCase();
  return HCV_ID_PATTERN.test(hcvId) ? hcvId : null;
}

function softwareFields(verified) {
  const raw = verified?.certificate?.meta?.softwareAttestation;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { sourceCommit: null, appVersion: null, buildNumber: null };
  }
  return {
    sourceCommit:
      typeof raw.sourceCommit === 'string' ? raw.sourceCommit.trim().toLowerCase() : null,
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion.trim() : null,
    buildNumber: typeof raw.buildNumber === 'string' ? raw.buildNumber.trim() : null,
  };
}

function parseProvenanceRow(row) {
  if (!row) return null;
  try {
    const provenance = JSON.parse(row.provenance_raw);
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
      return null;
    }
    return {
      ...provenance,
      registryStatus: row.registry_status || 'ACTIVE',
      ...(row.app_version ? { appVersion: row.app_version } : {}),
      ...(row.build_number ? { buildNumber: row.build_number } : {}),
    };
  } catch (_) {
    return null;
  }
}

function persistProvenance({ hcvId, verified, session, registeredAt }) {
  const existing = getProvenance.get(hcvId);
  if (existing) return parseProvenanceRow(existing);

  const provenance = buildRegistryProvenance({
    verifiedCertificate: verified,
    session,
    registeredAt,
  });
  const software = softwareFields(verified);
  insertProvenance.run(
    hcvId,
    registeredAt,
    verified.certificateSha256,
    JSON.stringify(provenance),
    software.sourceCommit,
    software.appVersion,
    software.buildNumber,
  );
  insertStatusEvent.run(
    hcvId,
    'ACTIVE',
    'INITIAL_REGISTRATION',
    registeredAt,
    'REGISTRY',
  );
  return {
    ...provenance,
    registryStatus: 'ACTIVE',
    ...(software.appVersion ? { appVersion: software.appVersion } : {}),
    ...(software.buildNumber ? { buildNumber: software.buildNumber } : {}),
  };
}

async function handleCertificatePost(req, res) {
  const session = authenticateRegistrySession(
    db,
    req.headers.authorization,
    new Date(),
  );
  const payload = await readJsonBody(req);
  const hcvId = parseHcvId(payload.hcvId);
  if (!hcvId || typeof payload.certificateRaw !== 'string') {
    return sendJson(res, 400, {
      ok: false,
      error: 'CERTIFICATE_REQUEST_INVALID',
    });
  }

  const verified = verifyCertificateRaw(payload.certificateRaw, hcvId);
  verifyRegistrationIdentity(verified, session);

  const existing = getCertificate.get(hcvId);
  if (existing && existing.certificate_raw !== payload.certificateRaw) {
    return sendJson(res, 409, {
      ok: false,
      error: 'HCV_ID_CONFLICT',
      message: 'This HCV-ID is already bound to a different immutable certificate.',
    });
  }

  const registeredAt = existing?.created_at || new Date().toISOString();
  const commitRegistration = db.transaction(() => {
    if (!existing) {
      insertCertificate.run(hcvId, registeredAt, payload.certificateRaw);
    }
    return persistProvenance({
      hcvId,
      verified,
      session,
      registeredAt,
    });
  });

  let provenance;
  try {
    provenance = commitRegistration();
  } catch (error) {
    if (String(error.code || '').includes('SQLITE_CONSTRAINT')) {
      const raced = getCertificate.get(hcvId);
      if (!raced || raced.certificate_raw !== payload.certificateRaw) {
        return sendJson(res, 409, {
          ok: false,
          error: 'HCV_ID_CONFLICT',
        });
      }
      provenance = parseProvenanceRow(getProvenance.get(hcvId));
    } else {
      throw error;
    }
  }

  return sendJson(res, existing ? 200 : 201, {
    ok: true,
    hcvId,
    immutable: true,
    storage: 'sqlite',
    provenance,
    url: `/api/certificate/${hcvId}`,
  });
}

function handleCertificateGet(res, hcvId) {
  const row = getCertificate.get(hcvId);
  if (!row) {
    return sendJson(res, 404, {
      ok: false,
      error: 'CERTIFICATE_NOT_FOUND',
    });
  }
  const provenance = parseProvenanceRow(getProvenance.get(hcvId));
  const latestStatus = getLatestStatus.get(hcvId) || null;
  return sendJson(res, 200, {
    ok: true,
    hcvId: row.hcv_id,
    createdAt: row.created_at,
    certificateRaw: row.certificate_raw,
    ...(provenance ? { provenance } : {}),
    ...(latestStatus ? { registryStatus: latestStatus } : {}),
  });
}

async function handleSecureRegistryRequest(req, res) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);

  if (url.pathname === '/api/certificate' && req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (url.pathname === '/api/certificate' && req.method === 'POST') {
    await handleCertificatePost(req, res);
    return true;
  }
  const match = /^\/api\/certificate\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
  if (match && req.method === 'GET') {
    handleCertificateGet(res, match[1]);
    return true;
  }
  return false;
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function phaseDCreateServer(listener) {
  if (typeof listener !== 'function') return originalCreateServer(listener);
  return originalCreateServer(async (req, res) => {
    try {
      if (await handleSecureRegistryRequest(req, res)) return;
      return listener(req, res);
    } catch (error) {
      const statusCode = Number(error.statusCode) || 500;
      return sendJson(res, statusCode, {
        ok: false,
        error: String(error.message || 'REGISTRY_SECURITY_ERROR'),
      });
    }
  });
};

module.exports = {
  handleSecureRegistryRequest,
};
