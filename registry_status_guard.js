'use strict';

const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');
const {
  authenticateRegistrySession,
  verifyCertificateRaw,
  verifyRegistrationIdentity,
} = require('./registry_certificate_security');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'registry.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const getCertificate = db.prepare(`
SELECT hcv_id, created_at, certificate_raw
FROM certificates
WHERE hcv_id = ?
`);
const getLatestStatus = db.prepare(`
SELECT id, status, reason_code, created_at, actor
FROM certificate_status_events
WHERE hcv_id = ?
ORDER BY id DESC
LIMIT 1
`);
const insertStatusEvent = db.prepare(`
INSERT INTO certificate_status_events (
  hcv_id, status, reason_code, created_at, actor
) VALUES (?, ?, ?, ?, ?)
`);
const updateProvenanceStatus = db.prepare(`
UPDATE registry_provenance
SET registry_status = ?
WHERE hcv_id = ?
`);

function sendJson(res, statusCode, body) {
  if (res.headersSent) return;
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  });
  res.end(JSON.stringify(body, null, 2));
}

function readJsonBody(req, maxBytes = 32_000) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
        const error = new Error('PAYLOAD_TOO_LARGE');
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const value = JSON.parse(raw || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('INVALID_JSON');
        }
        resolve(value);
      } catch (_) {
        const error = new Error('INVALID_JSON');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function normalizeReasonCode(value) {
  const reason = String(value || '').trim().toUpperCase();
  if (!reason) return '';
  if (!/^[A-Z0-9_:-]{3,80}$/.test(reason)) return null;
  return reason;
}

function transitionAllowed(currentStatus, requestedStatus) {
  const current = String(currentStatus || 'ACTIVE').toUpperCase();
  const requested = String(requestedStatus || '').toUpperCase();

  if (current === 'REVOKED') return false;
  if (current === requested) return true;
  if (current === 'ACTIVE') {
    return requested === 'DISPUTED' || requested === 'REVOKED';
  }
  if (current === 'DISPUTED') {
    return requested === 'ACTIVE' || requested === 'REVOKED';
  }
  return false;
}

function statusResponse(hcvId) {
  const latest = getLatestStatus.get(hcvId);
  return {
    hcvId,
    status: latest?.status || 'ACTIVE',
    reasonCode: latest?.reason_code || '',
    changedAt: latest?.created_at || null,
    actor: latest?.actor || null,
  };
}

function assertCreatorOwnsCertificate(req, hcvId, row) {
  const session = authenticateRegistrySession(
    db,
    req.headers.authorization,
    new Date(),
  );
  const verified = verifyCertificateRaw(row.certificate_raw, hcvId);
  verifyRegistrationIdentity(verified, session);
  return { session, verified };
}

async function handleStatusPost(req, res, hcvId) {
  const row = getCertificate.get(hcvId);
  if (!row) {
    return sendJson(res, 404, {
      ok: false,
      error: 'CERTIFICATE_NOT_FOUND',
    });
  }

  const { verified } = assertCreatorOwnsCertificate(req, hcvId, row);
  const body = await readJsonBody(req);
  const requestedStatus = String(body.status || '').trim().toUpperCase();
  if (!['ACTIVE', 'DISPUTED', 'REVOKED'].includes(requestedStatus)) {
    return sendJson(res, 400, {
      ok: false,
      error: 'REGISTRY_STATUS_INVALID',
    });
  }
  const reasonCode = normalizeReasonCode(body.reasonCode);
  if (reasonCode == null) {
    return sendJson(res, 400, {
      ok: false,
      error: 'REGISTRY_REASON_INVALID',
    });
  }

  const current = getLatestStatus.get(hcvId);
  const currentStatus = String(current?.status || 'ACTIVE').toUpperCase();
  if (!transitionAllowed(currentStatus, requestedStatus)) {
    return sendJson(res, 409, {
      ok: false,
      error: 'REGISTRY_STATUS_TRANSITION_FORBIDDEN',
      hcvId,
      currentStatus,
      requestedStatus,
    });
  }

  if (currentStatus === requestedStatus) {
    return sendJson(res, 200, {
      ok: true,
      idempotent: true,
      immutableCertificate: true,
      ...statusResponse(hcvId),
    });
  }

  const changedAt = new Date().toISOString();
  const actor = `CREATOR:${verified.creatorId}`;
  const commit = db.transaction(() => {
    insertStatusEvent.run(
      hcvId,
      requestedStatus,
      reasonCode || 'CREATOR_STATUS_CHANGE',
      changedAt,
      actor,
    );
    updateProvenanceStatus.run(requestedStatus, hcvId);
  });
  commit();

  return sendJson(res, 200, {
    ok: true,
    idempotent: false,
    immutableCertificate: true,
    ...statusResponse(hcvId),
  });
}

function handleStatusGet(res, hcvId) {
  if (!getCertificate.get(hcvId)) {
    return sendJson(res, 404, {
      ok: false,
      error: 'CERTIFICATE_NOT_FOUND',
    });
  }
  return sendJson(res, 200, {
    ok: true,
    immutableCertificate: true,
    ...statusResponse(hcvId),
  });
}

async function handleStatusRequest(req, res) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  const match = /^\/api\/certificate\/(HCV-[A-F0-9]{16})\/status$/.exec(
    url.pathname,
  );
  if (!match) return false;
  const hcvId = match[1];

  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'GET') {
    handleStatusGet(res, hcvId);
    return true;
  }
  if (req.method === 'POST') {
    await handleStatusPost(req, res, hcvId);
    return true;
  }
  return false;
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function phaseDStatusCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    try {
      if (await handleStatusRequest(req, res)) return;
      return listener(req, res);
    } catch (error) {
      const statusCode = Number(error.statusCode) || 500;
      sendJson(res, statusCode, {
        ok: false,
        error: String(error.message || 'REGISTRY_STATUS_ERROR'),
      });
    }
  });
};

module.exports = {
  handleStatusRequest,
  normalizeReasonCode,
  transitionAllowed,
};
