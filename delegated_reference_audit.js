'use strict';
const crypto = require('node:crypto');
const { auditPage } = require('./delegated_reference_audit_ui');
const HCV = /^HCV-[A-F0-9]{16}$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function failure(code, statusCode = 403) {
  return Object.assign(new Error(code), { code, statusCode });
}
function scopeIds(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 25 ||
      ids.some(id => typeof id !== 'string' || !HCV.test(id)) ||
      new Set(ids).size !== ids.length) throw failure('AUDIT_SCOPE_INVALID', 400);
  return [...ids].sort();
}
const digest = ids => hash(JSON.stringify(ids));
function createDelegatedReferenceAudit({ pool, authenticate, accountEnvelope,
  activeReference, issueRead, streamRead, readJson, sendJson, sendHtml,
  enabled = false, origin = '', allowTestHttp = false }) {
  if (enabled && !(/^https:\/\/[^/]+$/.test(origin) ||
      (allowTestHttp && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)))) {
    throw failure('AUDIT_HTTPS_ORIGIN_REQUIRED', 500);
  }
  const secure = origin.startsWith('https:');
  const cookieName = secure ? '__Host-sigillum-audit' : 'sigillum-audit-test';
  const limiter = new Map();
  async function initSchema() {
    if (!enabled) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS verified_originals_delegated_audits (
        request_id TEXT PRIMARY KEY,
        browser_hash TEXT NOT NULL,
        hcv_ids JSONB NOT NULL,
        scope_digest TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('PENDING','APPROVED','REVOKED')),
        owner_account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
        owner_device_fingerprint TEXT,
        approved_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS verified_originals_delegated_audit_reads (
        token_hash TEXT PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES verified_originals_delegated_audits(request_id) ON DELETE CASCADE,
        hcv_id TEXT NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(request_id,hcv_id)
      );
      CREATE TABLE IF NOT EXISTS verified_originals_delegated_audit_events (
        id BIGSERIAL PRIMARY KEY,
        request_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        hcv_id TEXT,
        actor_hash TEXT,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS delegated_audit_expiry_idx ON verified_originals_delegated_audits(expires_at);
    `);
  }
  async function event(client, requestId, type, hcvId = null, actorHash = null) {
    await client.query(`INSERT INTO verified_originals_delegated_audit_events
      (request_id,event_type,hcv_id,actor_hash) VALUES($1,$2,$3,$4)`,
    [requestId, type, hcvId, actorHash]);
  }
  function sameOrigin(req) {
    if (req.headers.origin !== origin) throw failure('AUDIT_ORIGIN_REJECTED');
  }
  function browserHash(req) {
    const cookies = String(req.headers.cookie || '').split(';').map(v => v.trim());
    const values = cookies.filter(v => v.startsWith(cookieName + '='));
    if (values.length !== 1) throw failure('AUDIT_BROWSER_REQUIRED', 401);
    const value = values[0].slice(cookieName.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw failure('AUDIT_BROWSER_REQUIRED', 401);
    return hash(value);
  }
  function limit(req) {
    // Do not trust a caller-controlled X-Forwarded-For value.
    const key = hash(String(req.socket?.remoteAddress || 'unknown'));
    const now = Date.now();
    for (const [k,v] of limiter) if (v.until <= now) limiter.delete(k);
    const state = limiter.get(key) || { count: 0, until: now + 300000 };
    if (state.count >= 10 || limiter.size >= 10000) throw failure('AUDIT_RATE_LIMITED', 429);
    state.count += 1; limiter.set(key, state);
  }
  async function owner(req) {
    const session = await authenticate(req);
    const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
    if (account.subscriptionStatus !== 'active') throw failure('SUBSCRIPTION_REQUIRED', 402);
    if (account.emailVerified !== true) throw failure('AUDIT_VERIFIED_OWNER_REQUIRED');
    return session;
  }
  async function eligible(row) {
    const account = await accountEnvelope(row.owner_account_id, row.owner_device_fingerprint);
    if (account.subscriptionStatus !== 'active') throw failure('SUBSCRIPTION_REQUIRED', 402);
    // Revoking the approving device invalidates its delegates as well.
    const device = (await pool.query(`SELECT device_key_fingerprint FROM account_devices
      WHERE account_id=$1 AND device_key_fingerprint=$2 AND revoked_at IS NULL`,
    [row.owner_account_id,row.owner_device_fingerprint])).rows[0];
    if (!device) throw failure('AUDIT_APPROVING_DEVICE_REVOKED');
    for (const id of row.hcv_ids) {
      const certificate = (await pool.query('SELECT account_id FROM certificates WHERE hcv_id=$1', [id])).rows[0];
      if (certificate?.account_id !== row.owner_account_id) throw failure('AUDIT_OWNER_MISMATCH');
    }
  }
  async function locked(requestId, action) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`SELECT * FROM verified_originals_delegated_audits
        WHERE request_id=$1 FOR UPDATE`, [requestId])).rows[0];
      if (!row || new Date(row.expires_at).getTime() <= Date.now()) throw failure('AUDIT_EXPIRED_OR_INVALID');
      const result = await action(row,client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      // Fail closed if access logging fails; never log credentials, query strings or cookies.
      await event(pool,requestId,'ACCESS_REJECTED');
      throw error;
    } finally { client.release(); }
  }
  function requireBrowser(row,req) {
    if (row.browser_hash !== browserHash(req)) throw failure('AUDIT_BROWSER_MISMATCH');
  }
  async function handle(req,res,url) {
    const root = '/api/verified-originals/audit';
    const page = /^\/audit\/(browser|approve)\/([a-f0-9]{32})$/.exec(url.pathname);
    const detail = /^\/api\/verified-originals\/audit\/requests\/([a-f0-9]{32})(?:\/(approve|revoke))?$/.exec(url.pathname);
    const authorize = /^\/api\/verified-originals\/audit\/requests\/([a-f0-9]{32})\/(HCV-[A-F0-9]{16})\/read-authorization$/.exec(url.pathname);
    const read = /^\/api\/verified-originals\/audit\/requests\/([a-f0-9]{32})\/reference-read\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
    if (!(url.pathname === '/audit' || page || detail || authorize || read || url.pathname === root + '/requests')) return false;
    if (!enabled) throw failure('AUDIT_DISABLED',404);
    res.setHeader('Cache-Control','private, no-store, max-age=0');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    if (req.method === 'POST') sameOrigin(req);
    if (req.method === 'GET' && (page || url.pathname === '/audit')) {
      const nonce = crypto.randomBytes(18).toString('base64');
      res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
      sendHtml(res,200,auditPage({mode:page?.[1] || 'new',requestId:page?.[2] || '',nonce}));
      return true;
    }
    if (req.method === 'POST' && url.pathname === root + '/requests') {
      limit(req);
      const body = await readJson(req,4096);
      const ids = scopeIds(body.hcvIds);
      const requestId = crypto.randomBytes(16).toString('hex');
      // One browser identity can support several explicit requests; no session or R2 key is exposed.
      let secret;
      try { secret = browserHash(req); } catch (_) { secret = null; }
      if (!secret) {
        const cookie = crypto.randomBytes(32).toString('base64url');
        secret = hash(cookie);
        res.setHeader('Set-Cookie', `${cookieName}=${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${secure ? '; Secure' : ''}`);
      }
      await pool.query(`INSERT INTO verified_originals_delegated_audits
        (request_id,browser_hash,hcv_ids,scope_digest,state,expires_at)
        VALUES($1,$2,$3,$4,'PENDING',NOW()+INTERVAL '5 minutes')`,
      [requestId,secret,JSON.stringify(ids),digest(ids)]);
      await event(pool,requestId,'REQUEST_CREATED',null,secret);
      sendJson(res,201,{requestId,hcvIds:ids,scopeDigest:digest(ids),browserPath:'/audit/browser/'+requestId,
        approvalPath:'/audit/approve/'+requestId,expiresInSeconds:300}); return true;
    }
    if (detail && req.method === 'GET' && !detail[2]) {
      const data = await locked(detail[1], async row => {
        requireBrowser(row,req);
        return {requestId:row.request_id,hcvIds:row.hcv_ids,scopeDigest:row.scope_digest,
          state:row.state,expiresAt:row.expires_at,browserFingerprint:row.browser_hash.slice(0,12)};
      });
      sendJson(res,200,data); return true;
    }
    if (detail && req.method === 'POST' && ['approve','revoke'].includes(detail[2])) {
      const session = await owner(req);
      const body = await readJson(req,4096);
      const result = await locked(detail[1],async (row,client) => {
        if (detail[2] === 'revoke') {
          if (row.owner_account_id !== session.account_id) throw failure('AUDIT_OWNER_MISMATCH');
          await client.query("UPDATE verified_originals_delegated_audits SET state='REVOKED' WHERE request_id=$1",[row.request_id]);
          await event(client,row.request_id,'OWNER_REVOKED',null,hash(session.account_id));
          return {state:'REVOKED'};
        }
        if (row.state !== 'PENDING') throw failure('AUDIT_ALREADY_DECIDED');
        if (body.confirm !== true || body.scopeDigest !== row.scope_digest ||
            JSON.stringify(scopeIds(body.hcvIds)) !== JSON.stringify(row.hcv_ids)) throw failure('AUDIT_EXPLICIT_CONSENT_REQUIRED');
        for (const id of row.hcv_ids) {
          const certificate = (await client.query('SELECT account_id FROM certificates WHERE hcv_id=$1',[id])).rows[0];
          if (certificate?.account_id !== session.account_id) throw failure('AUDIT_OWNER_MISMATCH');
          if (!await activeReference(id)) throw failure('REFERENCE_NOT_AVAILABLE',404);
        }
        const approved = (await client.query(`UPDATE verified_originals_delegated_audits
          SET state='APPROVED',owner_account_id=$2,owner_device_fingerprint=$3,
          approved_at=NOW(),expires_at=LEAST(created_at+INTERVAL '10 minutes',NOW()+INTERVAL '5 minutes')
          WHERE request_id=$1 RETURNING expires_at`,[row.request_id,session.account_id,session.device_key_fingerprint])).rows[0];
        await event(client,row.request_id,'OWNER_APPROVED',null,hash(session.account_id));
        return {state:'APPROVED',expiresAt:approved.expires_at};
      });
      sendJson(res,200,result); return true;
    }
    if (authorize && req.method === 'POST') {
      const data = await locked(authorize[1],async (row,client) => {
        requireBrowser(row,req);
        if (row.state !== 'APPROVED' || !row.hcv_ids.includes(authorize[2])) throw failure('AUDIT_OUT_OF_SCOPE');
        await eligible(row);
        const reference = await activeReference(authorize[2]);
        if (!reference) throw failure('REFERENCE_NOT_AVAILABLE',404);
        const existing = (await client.query(`SELECT token_hash FROM verified_originals_delegated_audit_reads
          WHERE request_id=$1 AND hcv_id=$2`, [row.request_id,authorize[2]])).rows[0];
        if (existing) throw failure('AUDIT_READ_ALREADY_ISSUED');
        const authorization = await issueRead(client,reference,authorize[2],row.owner_account_id,
          Math.max(1,Math.min(60,Math.floor((new Date(row.expires_at).getTime()-Date.now())/1000))));
        await client.query(`INSERT INTO verified_originals_delegated_audit_reads
          (token_hash,request_id,hcv_id) VALUES($1,$2,$3)`,[hash(authorization.token),row.request_id,authorize[2]]);
        await event(client,row.request_id,'READ_AUTHORIZED',authorize[2],row.browser_hash);
        return {readPath:root+'/requests/'+row.request_id+'/reference-read/'+authorization.token,
          expiresAt:authorization.expiresAt};
      });
      sendJson(res,201,data); return true;
    }
    if (read && req.method === 'GET') {
      const data = await locked(read[1],async (row,client) => {
        requireBrowser(row,req);
        if (row.state !== 'APPROVED') throw failure('AUDIT_OUT_OF_SCOPE');
        await eligible(row);
        const item = (await client.query(`SELECT hcv_id FROM verified_originals_delegated_audit_reads
          WHERE token_hash=$1 AND request_id=$2`,[hash(read[2]),row.request_id])).rows[0];
        if (!item || !row.hcv_ids.includes(item.hcv_id)) throw failure('AUDIT_OUT_OF_SCOPE');
        await event(client,row.request_id,'READ_STARTED',item.hcv_id,row.browser_hash);
        return {owner:row.owner_account_id,hcvId:item.hcv_id,browserHash:row.browser_hash};
      });
      try {
        await streamRead(req,res,read[2],data.owner,data.hcvId);
        await event(pool,read[1],'READ_COMPLETED',data.hcvId,data.browserHash);
      } catch (error) {
        await event(pool,read[1],'READ_FAILED',data.hcvId,data.browserHash);
        throw error;
      }
      return true;
    }
    throw failure('AUDIT_METHOD_OR_ROUTE_INVALID',404);
  }
  async function routedHandle(req,res,url) {
    const match = /^\/api\/verified-originals\/audit\/requests\/([a-f0-9]{32})\/owner-scope$/.exec(url.pathname);
    if (!match) return handle(req,res,url);
    if (!enabled) throw failure('AUDIT_DISABLED',404);
    if (req.method !== 'GET') throw failure('AUDIT_METHOD_OR_ROUTE_INVALID',404);
    const session = await owner(req);
    const data = await locked(match[1],async row => {
      for (const id of row.hcv_ids) {
        const cert = (await pool.query('SELECT account_id FROM certificates WHERE hcv_id=$1',[id])).rows[0];
        if (cert?.account_id !== session.account_id) throw failure('AUDIT_OWNER_MISMATCH');
      }
      return {requestId:row.request_id,hcvIds:row.hcv_ids,scopeDigest:row.scope_digest,
        browserFingerprint:row.browser_hash.slice(0,12),state:row.state,
        requesterType:row.connector_principal_hash?'CONNECTOR':'BROWSER',
        connectorFingerprint:row.connector_principal_hash?.slice(0,12)||null};
    });
    res.setHeader('Cache-Control','private, no-store, max-age=0');
    sendJson(res,200,data); return true;
  }
  return {initSchema,handle:routedHandle};
}
module.exports = {createDelegatedReferenceAudit,scopeIds,digest};
