'use strict';

// Preload *after* registry_http_guard.js and registry_public_verify_guard.js.
// This module never accepts media bytes or claims that YouTube's transcode
// matches the capture SHA-256. It registers only a consented reference link.
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {authenticateRegistrySession} = require('./registry_certificate_security');
const {youtubeUrl, parseConsent, assertSha, accountSubjectHash,
  activeProvenance, assertHcvId} = require('./verified_originals_policy');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'registry.db'));
db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS verified_originals_consent (
 hcv_id TEXT PRIMARY KEY, account_subject_hash TEXT NOT NULL,
 allow_monetization INTEGER NOT NULL CHECK(allow_monetization IN (0,1)),
 consented_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS verified_originals_consent_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, hcv_id TEXT NOT NULL,
 account_subject_hash TEXT NOT NULL, event TEXT NOT NULL,
 allow_monetization INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verified_originals_publications (
 hcv_id TEXT PRIMARY KEY, video_id TEXT NOT NULL,
 original_sha256 TEXT NOT NULL, rendition_sha256 TEXT NOT NULL,
 channel TEXT NOT NULL, published_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PUBLISHED','REMOVED'))
);
`);
const getCert = db.prepare('SELECT hcv_id FROM certificates WHERE hcv_id=?');
const getProvenance = db.prepare('SELECT provenance_raw,registry_status FROM registry_provenance WHERE hcv_id=?');
const getStatus = db.prepare('SELECT status FROM certificate_status_events WHERE hcv_id=? ORDER BY id DESC LIMIT 1');
const getConsent = db.prepare('SELECT * FROM verified_originals_consent WHERE hcv_id=?');
const getPublication = db.prepare('SELECT * FROM verified_originals_publications WHERE hcv_id=?');
const upsertConsent = db.prepare(`INSERT INTO verified_originals_consent
 (hcv_id,account_subject_hash,allow_monetization,consented_at,revoked_at)
 VALUES (?,?,?,?,NULL) ON CONFLICT(hcv_id) DO UPDATE SET
 account_subject_hash=excluded.account_subject_hash,
 allow_monetization=excluded.allow_monetization,
 consented_at=excluded.consented_at,revoked_at=NULL`);
const audit = db.prepare(`INSERT INTO verified_originals_consent_events
 (hcv_id,account_subject_hash,event,allow_monetization,created_at) VALUES (?,?,?,?,?)`);
const revoke = db.prepare('UPDATE verified_originals_consent SET revoked_at=? WHERE hcv_id=?');
const upsertPublication = db.prepare(`INSERT INTO verified_originals_publications
 (hcv_id,video_id,original_sha256,rendition_sha256,channel,published_at,status)
 VALUES (?,?,?,?,?,?,'PUBLISHED') ON CONFLICT(hcv_id) DO UPDATE SET
 video_id=excluded.video_id,original_sha256=excluded.original_sha256,
 rendition_sha256=excluded.rendition_sha256,channel=excluded.channel,
 published_at=excluded.published_at,status='PUBLISHED'`);
const removePublication = db.prepare(`UPDATE verified_originals_publications SET status='REMOVED' WHERE hcv_id=?`);

function error(code, statusCode) {throw Object.assign(new Error(code), {statusCode});}
function send(res, code, payload) {
  if (res.headersSent) return;
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(payload));
}
function validRecord(id) {
  if (!getCert.get(id)) error('CERTIFICATE_NOT_FOUND',404);
  const row=getProvenance.get(id);
  const status=getStatus.get(id)?.status || row?.registry_status;
  const p= row && activeProvenance(row.provenance_raw,status);
  if (!p) error('CERTIFICATE_NOT_ACTIVE_AND_VERIFIED',403);
  return p;
}
function owner(req,provenance) {
  const session=authenticateRegistrySession(db,req.headers.authorization,new Date());
  if (provenance.accountSubjectHash!==accountSubjectHash(session.accountId) ||
      provenance.creatorId!==session.creatorId ||
      provenance.deviceKeyFingerprint!==session.deviceKeyFingerprint) {
    error('CERTIFICATE_CREATOR_MISMATCH',403);
  }
  return session;
}
function admin(req) {
  const secret=process.env.SIGILLUM_PUBLICATION_ADMIN_TOKEN || '';
  const supplied=String(req.headers['x-sigillum-publication-token']||'');
  if (!secret || !supplied || secret.length!==supplied.length ||
      !crypto.timingSafeEqual(Buffer.from(secret),Buffer.from(supplied))) {
    error('PUBLICATION_ADMIN_REQUIRED',403);
  }
}
async function body(req) {
  const chunks=[];let length=0;
  for await (const chunk of req) {
    length+=chunk.length;
    if (length>4096) error('PAYLOAD_TOO_LARGE',413);
    chunks.push(chunk);
  }
  let value;try {value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch (_) {error('JSON_INVALID',400);}
  if (!value || typeof value!=='object' || Array.isArray(value)) error('JSON_INVALID',400);
  return value;
}
async function handle(req,res) {
  const url=new URL(req.url,'http://localhost');
  const match=/^\/api\/verified-originals\/(HCV-[A-F0-9]{16})(?:\/(consent|revoke|publication|remove))?$/.exec(url.pathname);
  if(!match)return false;
  const id=assertHcvId(match[1]), action=match[2]||'';
  if(req.method==='GET' && !action){
    const p=validRecord(id),c=getConsent.get(id),pub=getPublication.get(id);
    const visible=Boolean(c&&!c.revoked_at&&pub&&pub.status==='PUBLISHED'&&
      p.contentSha256===pub.original_sha256);
    return send(res,200,{hcvId:id,certificateVerified:true,
      referenceAvailable:visible,
      reference:visible?{platform:'youtube',url:youtubeUrl(pub.video_id),
        videoId:pub.video_id,channel:pub.channel,
        renditionSha256:pub.rendition_sha256,
        claim:'AUTHOR_CONSENTED_SOCIAL_REFERENCE_NOT_EXACT_SOCIAL_INTEGRITY'}:null,
      caveat:'An HCV-ID may be copied. This does not verify an arbitrary social file.'}),true;
  }
  if(req.method!=='POST'||!action)error('METHOD_NOT_ALLOWED',405);
  const p=validRecord(id);
  if(action==='consent'){
    const session=owner(req,p), consent=parseConsent(await body(req));
    const now=new Date().toISOString(),subject=accountSubjectHash(session.accountId);
    db.transaction(()=>{upsertConsent.run(id,subject,consent.allowMonetization?1:0,now);
      audit.run(id,subject,'CONSENT',consent.allowMonetization?1:0,now);})();
    return send(res,200,{ok:true,hcvId:id,publicationConsent:true,
      monetizationConsent:consent.allowMonetization,published:false}),true;
  }
  if(action==='revoke'){
    const session=owner(req,p),subject=accountSubjectHash(session.accountId);
    const now=new Date().toISOString();
    db.transaction(()=>{revoke.run(now,id);removePublication.run(id);
      audit.run(id,subject,'REVOKE',0,now);})();
    return send(res,200,{ok:true,hcvId:id,referenceAvailable:false}),true;
  }
  admin(req);
  if(action==='remove'){
    removePublication.run(id);
    return send(res,200,{ok:true,hcvId:id,referenceAvailable:false}),true;
  }
  if(action==='publication'){
    const c=getConsent.get(id);
    if(!c||c.revoked_at)error('PUBLICATION_CONSENT_MISSING',403);
    const value=await body(req);
    const originalSha=assertSha(value.originalSha256,'ORIGINAL_SHA256');
    const renditionSha=assertSha(value.renditionSha256,'RENDITION_SHA256');
    if(p.contentSha256!==originalSha)error('ORIGINAL_SHA256_MISMATCH',409);
    const url=youtubeUrl(value.videoId);
    const officialChannel=process.env.SIGILLUM_YOUTUBE_CHANNEL_HANDLE || '';
    if (!officialChannel || value.channel !== officialChannel)
      error('OFFICIAL_CHANNEL_NOT_CONFIGURED_OR_MISMATCH',403);
    if (typeof value.monetizationEnabled !== 'boolean' ||
        (value.monetizationEnabled && !c.allow_monetization))
      error('MONETIZATION_NOT_AUTHORIZED',403);
    // Manually supplied rendition digest is NOT an attested transformation.
    if(typeof value.channel!=='string'||!/^@[A-Za-z0-9._-]{3,50}$/.test(value.channel))
      error('OFFICIAL_CHANNEL_INVALID',400);
    if(value.manualRightsReview!==true||value.referenceCopyCompared!==true)
      error('MANUAL_REVIEW_REQUIRED',400);
    upsertPublication.run(id,value.videoId,originalSha,renditionSha,value.channel,
      new Date().toISOString());
    return send(res,200,{ok:true,hcvId:id,url,
      claim:'REFERENCE_LINK_ONLY_NOT_CRYPTOGRAPHICALLY_ATTESTED_DERIVATION'}),true;
  }
  error('ROUTE_NOT_FOUND',404);
}
const previous=http.createServer.bind(http);
http.createServer=function verifiedOriginalsServer(listener){
  if(typeof listener!=='function')return previous(listener);
  return previous(async(req,res)=>{
    try{if(await handle(req,res))return;return listener(req,res);}
    catch(e){send(res,e.statusCode||500,{ok:false,error:e.statusCode?e.message:'REFERENCE_UNAVAILABLE'});}
  });
};
module.exports={handle};