'use strict';

// Optional Registry extension. It never uploads media and NEVER marks a third-
// party social file as cryptographically verified.
// Required before use: trusted server-side publisher, explicit creator consent,
// SHA256 of rendition bytes, official account/channel, review of rights.

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {
  checkCreatorConsentRequest, checkPublication, publicReference,
} = require('./verified_originals_policy');
const { authenticateRegistrySession } = require('./registry_certificate_security');

const ID = /^HCV-[A-F0-9]{16}$/;
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'registry.db'));
db.pragma('busy_timeout = 5000');
db.exec([
  'CREATE TABLE IF NOT EXISTS verified_originals (',
  'hcv_id TEXT PRIMARY KEY, original_sha256 TEXT NOT NULL,',
  'rendition_sha256 TEXT NOT NULL, youtube_video_id TEXT NOT NULL,',
  'consent_raw TEXT NOT NULL, pipeline_audit_id TEXT NOT NULL,',
  'state TEXT NOT NULL, published_at TEXT NOT NULL, withdrawn_at TEXT',
  ');',
  'CREATE TABLE IF NOT EXISTS verified_originals_audit (',
  'id INTEGER PRIMARY KEY AUTOINCREMENT, hcv_id TEXT NOT NULL,',
  'event_type TEXT NOT NULL, audit_id TEXT NOT NULL,',
  'created_at TEXT NOT NULL',
  ');'
].join(' '));

db.exec([
  'CREATE TABLE IF NOT EXISTS verified_originals_consents (',
  'record_id TEXT PRIMARY KEY, hcv_id TEXT NOT NULL,',
  'account_subject_hash TEXT NOT NULL, consent_raw TEXT NOT NULL,',
  'state TEXT NOT NULL, granted_at TEXT NOT NULL, withdrawn_at TEXT',
  ');',
  'CREATE INDEX IF NOT EXISTS verified_originals_consents_hcv_idx',
  'ON verified_originals_consents(hcv_id, granted_at);'
].join(' '));

const consentById = db.prepare('SELECT * FROM verified_originals_consents WHERE record_id = ?');
const latestConsent = db.prepare(
  'SELECT * FROM verified_originals_consents WHERE hcv_id = ? ORDER BY granted_at DESC, rowid DESC LIMIT 1'
);
const insertConsent = db.prepare(
  'INSERT INTO verified_originals_consents (record_id,hcv_id,account_subject_hash,consent_raw,state,granted_at,withdrawn_at) VALUES (?,?,?,?,?,?,NULL)'
);
const revokeConsent = db.prepare(
  "UPDATE verified_originals_consents SET state='WITHDRAWN',withdrawn_at=? WHERE record_id=? AND state='ACTIVE'"
);

const certificate = db.prepare('SELECT * FROM certificates WHERE hcv_id = ?');
const provenance = db.prepare('SELECT * FROM registry_provenance WHERE hcv_id = ?');
const latestStatus = db.prepare('SELECT status FROM certificate_status_events WHERE hcv_id = ? ORDER BY id DESC LIMIT 1');
const existing = db.prepare('SELECT * FROM verified_originals WHERE hcv_id = ?');
const publish = db.prepare([
  'INSERT INTO verified_originals (hcv_id, original_sha256, rendition_sha256,',
  'youtube_video_id, consent_raw, pipeline_audit_id, state, published_at, withdrawn_at)',
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
  'ON CONFLICT(hcv_id) DO UPDATE SET original_sha256=excluded.original_sha256,',
  'rendition_sha256=excluded.rendition_sha256,',
  'youtube_video_id=excluded.youtube_video_id, consent_raw=excluded.consent_raw,',
  'pipeline_audit_id=excluded.pipeline_audit_id, state=excluded.state,',
  'published_at=excluded.published_at, withdrawn_at=NULL'
].join(' '));
const withdraw = db.prepare("UPDATE verified_originals SET state='WITHDRAWN', withdrawn_at=? WHERE hcv_id=?");
const audit = db.prepare('INSERT INTO verified_originals_audit (hcv_id,event_type,audit_id,created_at) VALUES (?,?,?,?)');
const save = db.transaction((p, at) => {
  publish.run(p.hcvId, p.originalSha256, p.renditionSha256,
    p.youtubeVideoId, JSON.stringify(p.consent), p.pipelineAuditId, 'PUBLISHED', at);
  audit.run(p.hcvId, 'PUBLISHED', p.pipelineAuditId, at);
});
const retract = db.transaction((id, at, why) => {
  const current = existing.get(id);
  if (current) {
    const c = JSON.parse(current.consent_raw);
    revokeConsent.run(at, c.recordId);
  }
  withdraw.run(at, id);
  audit.run(id, 'WITHDRAWN', why, at);
});

function send(res, code, obj) {
  if (res.headersSent) return;
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(obj));
}
function allowed(req) {
  const expected = process.env.SIGILLUM_VERIFIED_ORIGINALS_ADMIN_TOKEN || '';
  if (expected.length < 32) return false;
  const given = String(req.headers.authorization || '');
  if (!given.startsWith('Bearer ')) return false;
  const a = Buffer.from(given.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}
async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk.toString('utf8');
    if (data.length > 16384) {
      const e = new Error('BODY_TOO_LARGE'); e.statusCode = 413; throw e;
    }
  }
  let result;
  try { result = JSON.parse(data); } catch (_) {
    const e = new Error('INVALID_JSON'); e.statusCode = 400; throw e;
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    const e = new Error('INVALID_JSON'); e.statusCode = 400; throw e;
  }
  return result;
}
function record(id) {
  const row = existing.get(id);
  let saved = null;
  if (row) {
    try {
      saved = consentById.get(JSON.parse(row.consent_raw).recordId);
    } catch (_) {
      return null;
    }
  }
  return publicReference(row, certificate.get(id),
    provenance.get(id), latestStatus.get(id), saved);
}
function escapeHtml(v) {
  return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function referencePage(id, result) {
  const title = result ? 'Copia di riferimento SIGILLUM' : 'Copia di riferimento non disponibile';
  const link = result ? '<p><a rel="noopener noreferrer" href="' +
    escapeHtml(result.youtubeUrl) + '">Guarda la copia sul canale ufficiale</a></p>' : '';
  return '<!doctype html><html lang="it"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + '</title><main style="max-width:680px;margin:40px auto;font:17px/1.5 sans-serif">' +
    '<h1>' + title + '</h1><p>HCV-ID: ' + escapeHtml(id) + '</p>' + link +
    '<p><a href="/verify/' + escapeHtml(id) + '">Verifica il certificato</a></p>' +
    '<p>Il video su YouTube è una copia audiovisiva di riferimento. Il collegamento non prova ' +
    'che il file visto su un altro social sia identico e non prova la verità della scena.</p>' +
    '</main></html>';
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const view = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
  const page = /^\/originals\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
  const revoke = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/withdraw$/.exec(url.pathname);

  if (req.method === 'GET' && view) {
    const data = record(view[1]);
    send(res, 200, data || {hcvId:view[1], availability:'REFERENCE_NOT_AVAILABLE',
      socialFileVerdict:'NOT_VERIFIED'});
    return true;
  }
  if (req.method === 'GET' && page) {
    const data = record(page[1]);
    res.writeHead(data ? 200 : 404,
      {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
       'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"});
    res.end(referencePage(page[1], data));
    return true;
  }
  // Consent is written ONLY by the authenticated account that registered
  // the cryptographically validated original certificate.
  if (req.method === 'POST' && url.pathname === '/api/verified-originals/consents') {
    const session = authenticateRegistrySession(db, req.headers.authorization, new Date());
    const payload = await readJson(req);
    const id = payload.hcvId;
    if (!ID.test(id || '')) {send(res,400,{error:'INVALID_HCV_ID'});return true;}
    const cert = certificate.get(id);
    const p = provenance.get(id);
    const reason = checkCreatorConsentRequest(
      payload, cert, p, latestStatus.get(id), session,
    );
    if (reason) {send(res,422,{error:reason});return true;}
    const prior = latestConsent.get(id);
    if (prior?.state === 'ACTIVE') {
      send(res,409,{error:'ACTIVE_CONSENT_ALREADY_EXISTS'});return true;
    }
    const now = new Date().toISOString();
    const accountHash = crypto.createHash('sha256')
      .update(String(session.accountId)).digest('hex');
    const consent = {
      version:1,recordId:crypto.randomUUID(),hcvId:id,
      originalSha256:payload.originalSha256,
      creatorSubject:session.creatorId,grantedAt:now,
      publishReference:true,monetize:payload.monetize,
      rightsConfirmed:true,
    };
    insertConsent.run(consent.recordId,id,accountHash,JSON.stringify(consent),'ACTIVE',now);
    audit.run(id,'CREATOR_CONSENT_GRANTED',consent.recordId,now);
    send(res,201,{ok:true,hcvId:id,consent,publicationState:'NOT_PUBLISHED'});
    return true;
  }
  const creatorWithdraw =
    /^\\/api\\/verified-originals\\/consents\\/(HCV-[A-F0-9]{16})\\/withdraw$/.exec(url.pathname);
  if (req.method === 'POST' && creatorWithdraw) {
    const session = authenticateRegistrySession(db, req.headers.authorization, new Date());
    const id = creatorWithdraw[1];
    const p = provenance.get(id);
    let parsed = null;
    try {parsed=JSON.parse(p?.provenance_raw || 'null');}catch (_) {}
    const accountHash = crypto.createHash('sha256')
      .update(String(session.accountId)).digest('hex');
    if (!parsed || parsed.accountSubjectHash !== accountHash ||
        parsed.creatorId !== session.creatorId) {
      send(res,403,{error:'CREATOR_OWNERSHIP_NOT_VERIFIED'});return true;
    }
    const current = latestConsent.get(id);
    if (!current || current.state !== 'ACTIVE' ||
        current.account_subject_hash !== accountHash) {
      send(res,404,{error:'ACTIVE_CONSENT_NOT_FOUND'});return true;
    }
    const now = new Date().toISOString();
    const retractCreator = db.transaction(() => {
      revokeConsent.run(now,current.record_id);
      const published = existing.get(id);
      if (published && published.state === 'PUBLISHED') {
        withdraw.run(now,id);
      }
      audit.run(id,'CREATOR_CONSENT_WITHDRAWN',current.record_id,now);
    });
    retractCreator();
    send(res,200,{ok:true,hcvId:id,availability:'REFERENCE_NOT_AVAILABLE',
      platformTakedown:'PENDING_OPERATOR_CONFIRMATION'});
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/verified-originals') {
    if (!allowed(req)) { send(res, 403, {error:'PUBLISHER_NOT_AUTHORIZED'}); return true; }
    const payload = await readJson(req);
    const id = payload.hcvId;
    if (!ID.test(id || '')) {send(res, 400, {error:'INVALID_HCV_ID'});return true;}
    const savedConsent = consentById.get(payload.consent?.recordId || '');
    const reason = checkPublication(payload, certificate.get(id),
      provenance.get(id), latestStatus.get(id), savedConsent);
    if (reason) {send(res, 422, {error:reason});return true;}
    const old = existing.get(id);
    if (old && old.state === 'PUBLISHED') {
      if (old.youtube_video_id === payload.youtubeVideoId &&
        old.rendition_sha256 === payload.renditionSha256 &&
        JSON.parse(old.consent_raw).recordId === payload.consent.recordId) {
        send(res, 200, {ok:true,hcvId:id, idempotent:true});return true;
      }
      send(res, 409, {error:'ALREADY_PUBLISHED'});return true;
    }
    if (old && JSON.parse(old.consent_raw).recordId === payload.consent.recordId) {
      send(res, 409, {error:'NEW_CONSENT_REQUIRED'});return true;
    }
    save(payload, new Date().toISOString());
    send(res, 201, {ok:true,hcvId:id, referenceUrl:'/originals/' + id});
    return true;
  }
  if (req.method === 'POST' && revoke) {
    if (!allowed(req)) {send(res,403,{error:'PUBLISHER_NOT_AUTHORIZED'});return true;}
    const current = existing.get(revoke[1]);
    if (!current || current.state !== 'PUBLISHED') {
      send(res,404,{error:'PUBLICATION_NOT_FOUND'});return true;
    }
    const body = await readJson(req);
    if (typeof body.auditId !== 'string' || body.auditId.length < 12) {
      send(res,400,{error:'WITHDRAWAL_AUDIT_REQUIRED'});return true;
    }
    retract(revoke[1], new Date().toISOString(), body.auditId.slice(0,128));
    send(res,200,{ok:true,hcvId:revoke[1],availability:'REFERENCE_NOT_AVAILABLE'});
    return true;
  }
  return false;
}

// All endpoints are intentionally unavailable unless the operator has set up
// the secret, trusted publisher and platform account. Read-only GET is safe
// even without the publisher token: no link exists before a guarded write.
const previousCreateServer = http.createServer.bind(http);
http.createServer = function verifiedOriginalsCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer((req,res) => {
    Promise.resolve().then(() => handle(req,res)).then(handled => {
      if (!handled) listener(req,res);
    }).catch(error => send(res,error.statusCode || 500,
      {error: error.statusCode ? error.message : 'REFERENCE_SERVICE_UNAVAILABLE'}));
  });
};
module.exports = { handle };
