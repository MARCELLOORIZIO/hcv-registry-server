'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const ffmpegPath = require('ffmpeg-static');
const {
  createVerifiedOriginalsProduction,
} = require('./verified_originals_production');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');

const HCV_ID = 'HCV-0123456789ABCDEF';
const PHOTO_HCV_ID = 'HCV-FEDCBA9876543210';
const CHANNEL_ID = 'UC0123456789ABCDEFGHIJKL';
const VIDEO_ID = 'AbCdEfGhI_1';
const PHOTO_VIDEO_ID = 'PhOtORef_01';
const OWNER = 'acc-owner';
const FREE = 'acc-free';
const CREATOR_ID = 'creator-01';
const DEVICE = 'a'.repeat(64);
const HCVPACK_HASH = 'e'.repeat(64);
const PHOTO_HCVPACK_HASH = '9'.repeat(64);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-production-vo-'));
const originalPath = path.join(tmp, 'original.mp4');

execFileSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1',
  '-c:v', 'mpeg4', '-q:v', '5', '-pix_fmt', 'yuv420p', '-an',
  '-movflags', '+faststart', originalPath,
], {stdio:'pipe'});

const originalBytes = fs.readFileSync(originalPath);
const originalHash = crypto.createHash('sha256').update(originalBytes).digest('hex');
const certificateRaw = JSON.stringify({test:'production-verified-originals'});
const sessionId = 'session-closed-chain-test';
const provenanceEvent = {
  type:'SIGILLUM_PROVENANCE_EVENT',
  version:1,
  sequence:0,
  eventType:'CAPTURE_FINALIZED',
  inputHash:originalHash,
  timestamp:new Date().toISOString(),
  deviceFingerprint:DEVICE,
  sessionId,
  pipelineVersion:'HCV_CAPTURE_BINDING_V1',
  nonce:'00112233445566778899aabbccddeeff',
  parentEvent:'GENESIS',
  metadata:{
    hcvId:HCV_ID,
    mediaType:'video',
    contentSize:originalBytes.length,
    contentName:'original.mp4',
    capturedAt:new Date().toISOString(),
    captureSource:'HCV_CAMERA',
  },
  eventHash:'d'.repeat(64),
  signatureAlgorithm:'RSA-SHA256-HCV-PROVENANCE-V1',
  signature:'test-signature',
  publicKey:{modulus:'test',exponent:'AQAB'},
};
const certificate = {
  sessionId,
  meta:{hcvId:HCV_ID,identity:{creatorId:CREATOR_ID}},
  content:{type:'video',hash:originalHash,size:originalBytes.length,name:'original.mp4'},
  claims:{
    captureSource:'HCV_CAMERA',
    liveCapture:true,
    provenance:{
      type:'SIGILLUM_CAPTURE_PROVENANCE_BINDING',
      version:1,
      status:'VERIFIED',
      hcvId:HCV_ID,
      eventHash:provenanceEvent.eventHash,
      inputHash:originalHash,
      deviceFingerprint:DEVICE,
      sessionId,
      pipelineVersion:'HCV_CAPTURE_BINDING_V1',
      event:provenanceEvent,
    },
  },
};

const photoPath = path.join(tmp, 'original.jpg');
execFileSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=blue:s=640x480',
  '-frames:v', '1', photoPath,
], {stdio:'pipe'});
const photoBytes = fs.readFileSync(photoPath);
const photoHash = crypto.createHash('sha256').update(photoBytes).digest('hex');
const photoCertificateRaw = JSON.stringify({test:'production-photo-verified-originals'});
const photoSessionId = 'session-photo-closed-chain-test';
const photoProvenanceEvent = {
  type:'SIGILLUM_PROVENANCE_EVENT',
  version:1,
  sequence:0,
  eventType:'CAPTURE_FINALIZED',
  inputHash:photoHash,
  timestamp:new Date().toISOString(),
  deviceFingerprint:DEVICE,
  sessionId:photoSessionId,
  pipelineVersion:'HCV_CAPTURE_BINDING_V1',
  nonce:'11223344556677889900aabbccddeeff',
  parentEvent:'GENESIS',
  metadata:{
    hcvId:PHOTO_HCV_ID,
    mediaType:'photo',
    contentSize:photoBytes.length,
    contentName:'original.jpg',
    capturedAt:new Date().toISOString(),
    captureSource:'HCV_CAMERA',
  },
  eventHash:'8'.repeat(64),
  signatureAlgorithm:'RSA-SHA256-HCV-PROVENANCE-V1',
  signature:'test-photo-signature',
  publicKey:{modulus:'test',exponent:'AQAB'},
};
const photoCertificate = {
  sessionId:photoSessionId,
  meta:{hcvId:PHOTO_HCV_ID,identity:{creatorId:CREATOR_ID}},
  content:{type:'photo',hash:photoHash,size:photoBytes.length,name:'original.jpg'},
  claims:{
    captureSource:'HCV_CAMERA',
    liveCapture:true,
    provenance:{
      type:'SIGILLUM_CAPTURE_PROVENANCE_BINDING',
      version:1,
      status:'VERIFIED',
      hcvId:PHOTO_HCV_ID,
      eventHash:photoProvenanceEvent.eventHash,
      inputHash:photoHash,
      deviceFingerprint:DEVICE,
      sessionId:photoSessionId,
      pipelineVersion:'HCV_CAPTURE_BINDING_V1',
      event:photoProvenanceEvent,
    },
  },
};

const keys = crypto.generateKeyPairSync('rsa', {modulusLength:2048});
const privatePem = keys.privateKey.export({format:'pem',type:'pkcs8'}).toString();
const publicPem = keys.publicKey.export({format:'pem',type:'spki'}).toString();
process.env.SIGILLUM_DERIVATION_KEY_ID = 'sigillum_test_key';
process.env.SIGILLUM_DERIVATION_PRIVATE_KEY_PEM = privatePem;
process.env.SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON = JSON.stringify({
  sigillum_test_key: publicPem,
});
process.env.YOUTUBE_CLIENT_ID = 'client-id';
process.env.YOUTUBE_CLIENT_SECRET = 'server-secret';
process.env.YOUTUBE_REFRESH_TOKEN = 'refresh-token';
process.env.YOUTUBE_CHANNEL_ID = CHANNEL_ID;
process.env.SIGILLUM_PUBLISHER_ID = 'SIGILLUM_TEST_PUBLISHER';
process.env.YOUTUBE_PROCESSING_TIMEOUT_MS = '3000';
process.env.YOUTUBE_PROCESSING_POLL_MS = '10';
process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP = path.join(tmp, 'jobs');

const pool = new Pool({
  connectionString:DATABASE_URL,
  ssl:false,
  max:4,
});

function sha(value) {
  return crypto.createHash('sha256').update(String(value),'utf8').digest('hex');
}

function response(status, payload = {}, headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]),
  );
  return {
    status,
    ok:status >= 200 && status < 300,
    headers:{get:name=>normalized[String(name).toLowerCase()] ?? null},
    async json(){ return payload; },
  };
}

let uploadSessionCount = 0;
let uploadPutCount = 0;
let deleteCount = 0;
let uploadMetadata = null;
let uploadedBytes = null;
const uploadUrl =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=test';

async function fakeFetch(url, options = {}) {
  const target = String(url);
  if (target === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('client_secret'),'server-secret');
    assert.equal(body.get('grant_type'),'refresh_token');
    return response(200,{access_token:'access-token'});
  }
  if (target.includes('/youtube/v3/channels?part=id&mine=true')) {
    return response(200,{items:[{id:CHANNEL_ID}]});
  }
  if (target.includes('uploadType=resumable') && options.method === 'POST') {
    uploadSessionCount += 1;
    uploadMetadata = JSON.parse(options.body);
    return response(200,{}, {location:uploadUrl});
  }
  if (target === uploadUrl && options.method === 'PUT') {
    uploadPutCount += 1;
    uploadedBytes = Buffer.from(options.body);
    const id = uploadMetadata?.snippet?.title === 'SIGILLUM '+PHOTO_HCV_ID
      ? PHOTO_VIDEO_ID
      : VIDEO_ID;
    return response(201,{id});
  }
  if (target.includes('/youtube/v3/videos?part=status,processingDetails')) {
    const id = target.includes(encodeURIComponent(PHOTO_VIDEO_ID))
      ? PHOTO_VIDEO_ID
      : VIDEO_ID;
    return response(200,{
      items:[{
        id,
        etag:'etag-test',
        status:{privacyStatus:'unlisted',uploadStatus:'processed'},
        processingDetails:{processingStatus:'succeeded'},
      }],
    });
  }
  if (target.includes('/youtube/v3/videos?id=') && options.method === 'DELETE') {
    deleteCount += 1;
    return response(204,{});
  }
  throw new Error('UNEXPECTED_FETCH ' + target + ' ' + (options.method || 'GET'));
}

function publicError(code,statusCode=400,message) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.publicMessage = message || code;
  return error;
}

async function readJson(req,maxBytes=1000000) {
  const chunks=[];
  let total=0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw publicError('PAYLOAD_TOO_LARGE',413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (_) {
    throw publicError('INVALID_JSON',400);
  }
}

function sendJson(res,status,body) {
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    connection:'close',
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res,status,body) {
  res.writeHead(status,{
    'content-type':'text/html; charset=utf-8',
    connection:'close',
  });
  res.end(body);
}

function token(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
}

async function authenticate(req) {
  const t=token(req);
  if (t === 'owner-token') return {
    account_id:OWNER,
    creator_id:CREATOR_ID,
    device_key_fingerprint:DEVICE,
  };
  if (t === 'free-token') return {
    account_id:FREE,
    creator_id:'free-creator',
    device_key_fingerprint:'b'.repeat(64),
  };
  throw publicError('SESSIONE_MANCANTE',401);
}

async function accountEnvelope(accountId) {
  if (accountId === OWNER) return {
    id:OWNER,
    creatorId:CREATOR_ID,
    subscriptionStatus:'active',
    legalIdentityVerified:true,
    emailVerified:true,
    termsAccepted:true,
    privacyAcknowledged:true,
    adultConfirmed:true,
  };
  if (accountId === FREE) return {
    id:FREE,
    creatorId:'free-creator',
    subscriptionStatus:'inactive',
  };
  throw publicError('ACCOUNT_NON_TROVATO',404);
}

async function requireCreatorAccess(req) {
  const session=await authenticate(req);
  if (session.account_id !== OWNER) throw publicError('ABBONAMENTO_NON_ATTIVO',402);
  return {session,account:await accountEnvelope(OWNER)};
}

function verifyCertificateRaw(_raw,expectedId) {
  if (expectedId === HCV_ID) return certificate;
  if (expectedId === PHOTO_HCV_ID) return photoCertificate;
  throw new Error('UNEXPECTED_HCV_ID '+expectedId);
}

function provenanceEnvelopeFromRow(row) {
  return {
    status:'SIGILLUM_REGISTRY_VERIFIED',
    integrityValid:true,
    identityVerified:true,
    contentSha256:row.content_sha256,
  };
}

async function resetDb() {
  await pool.query(`
    DROP TABLE IF EXISTS verified_originals_audit CASCADE;
    DROP TABLE IF EXISTS verified_originals_publications CASCADE;
    DROP TABLE IF EXISTS verified_originals_platform_receipts CASCADE;
    DROP TABLE IF EXISTS trusted_derivations CASCADE;
    DROP TABLE IF EXISTS verified_originals_consents CASCADE;
    DROP TABLE IF EXISTS certificates CASCADE;
    DROP TABLE IF EXISTS accounts CASCADE;
    CREATE TABLE accounts(id TEXT PRIMARY KEY);
    CREATE TABLE certificates(
      hcv_id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      certificate_raw TEXT NOT NULL,
      certificate_sha256 TEXT NOT NULL,
      account_subject_hash TEXT NOT NULL,
      device_key_fingerprint TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      binding_version INTEGER NOT NULL,
      content_sha256 TEXT NOT NULL,
      identity_verified BOOLEAN NOT NULL,
      registry_attested_at TIMESTAMPTZ,
      provenance_version INTEGER NOT NULL,
      registry_attestation_sha256 TEXT NOT NULL
    );
  `);
  await pool.query('INSERT INTO accounts(id) VALUES($1),($2)',[OWNER,FREE]);
  await pool.query(`
    INSERT INTO certificates(
      hcv_id,account_id,certificate_raw,certificate_sha256,
      account_subject_hash,device_key_fingerprint,creator_id,binding_version,
      content_sha256,identity_verified,registry_attested_at,provenance_version,
      registry_attestation_sha256
    ) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,TRUE,NOW(),2,$9)
  `,[
    HCV_ID,OWNER,certificateRaw,sha(certificateRaw),sha(OWNER),DEVICE,
    CREATOR_ID,originalHash,'c'.repeat(64),
  ]);
  await pool.query(`
    INSERT INTO certificates(
      hcv_id,account_id,certificate_raw,certificate_sha256,
      account_subject_hash,device_key_fingerprint,creator_id,binding_version,
      content_sha256,identity_verified,registry_attested_at,provenance_version,
      registry_attestation_sha256
    ) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,TRUE,NOW(),2,$9)
  `,[
    PHOTO_HCV_ID,OWNER,photoCertificateRaw,sha(photoCertificateRaw),sha(OWNER),
    DEVICE,CREATOR_ID,photoHash,'6'.repeat(64),
  ]);
}

async function request(base,method,pathname,{bearer,body,bytes,contentType='video/mp4'}={}) {
  const target=new URL(pathname,base);
  const raw=body === undefined ? null : Buffer.from(JSON.stringify(body));
  const payload=bytes || raw;
  return new Promise((resolve,reject)=>{
    const req=http.request({
      protocol:target.protocol,
      hostname:target.hostname,
      port:target.port,
      path:target.pathname+target.search,
      method,
      agent:false,
      headers:{
        ...(bearer?{authorization:'Bearer '+bearer}:{}),
        ...(bytes?{'content-type':contentType}:{}),
        ...(raw?{'content-type':'application/json'}:{}),
        ...(payload?{'content-length':String(payload.length)}:{}),
        connection:'close',
      },
    },res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');
        let json=null;
        try{json=JSON.parse(text);}catch(_){}
        resolve({status:res.statusCode,json,text});
      });
    });
    req.setTimeout(20000,()=>req.destroy(new Error('HTTP_TIMEOUT')));
    req.on('error',reject);
    if(payload) req.write(payload);
    req.end();
  });
}

async function run() {
  await resetDb();
  const feature=createVerifiedOriginalsProduction({
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
    securityEvent:async()=>{},
    fetchImpl:fakeFetch,
    sleep:async()=>{},
    ffmpegPath,
  });
  await feature.initSchema();

  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://'+(req.headers.host||'localhost'));
    Promise.resolve(feature.handle(req,res,url)).then(handled=>{
      if(!handled) sendJson(res,404,{error:'NOT_FOUND'});
    }).catch(error=>sendJson(res,error.statusCode||500,{error:error.message}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  const base='http://127.0.0.1:'+address.port;

  try {
    const before=await request(base,'GET','/api/verified-originals/'+HCV_ID);
    assert.equal(before.status,200);
    assert.equal(before.json.availability,'REFERENCE_NOT_AVAILABLE');

    const consent=await request(base,'POST','/api/verified-originals/consents',{
      bearer:'owner-token',
      body:{
        hcvId:HCV_ID,
        intent:'PUBLISH_VERIFIED_ORIGINAL',
        publishReference:true,
        rightsConfirmed:true,
        monetizationConsent:false,
      },
    });
    assert.equal(consent.status,201,consent.text);
    const consentId=consent.json.recordId;
    assert.ok(consentId);

    const published=await request(
      base,'POST',
      '/api/verified-originals/publish/'+HCV_ID+
        '?consentRecordId='+encodeURIComponent(consentId)+
        '&monetizationEnabled=false'+
        '&hcvpackSha256='+HCVPACK_HASH,
      {bearer:'owner-token',bytes:originalBytes},
    );
    assert.equal(published.status,201,published.text);
    assert.equal(published.json.platform,'youtube');
    assert.equal(published.json.publicationStatus,'PUBLISHED');
    assert.equal(uploadSessionCount,1);
    assert.equal(uploadPutCount,1);
    assert.ok(uploadedBytes && uploadedBytes.length > 0);
    assert.equal(uploadMetadata.status.privacyStatus,'unlisted');
    assert.equal(uploadMetadata.snippet.title,'SIGILLUM '+HCV_ID);
    assert.ok(uploadMetadata.snippet.description.includes('Original SHA-256: '+originalHash));
    assert.ok(uploadMetadata.snippet.description.includes('HCVPACK SHA-256: '+HCVPACK_HASH));
    assert.equal(published.json.hcvpackSha256,HCVPACK_HASH);

    const freeLookup=await request(base,'GET','/api/verified-originals/'+HCV_ID);
    assert.equal(freeLookup.status,200);
    assert.equal(freeLookup.json.availability,'REFERENCE_AVAILABLE');
    assert.equal(freeLookup.json.viewAccess,'SUBSCRIPTION_REQUIRED');
    assert.equal(freeLookup.json.publicUrl,undefined);
    assert.equal(freeLookup.json.platformPostId,undefined);

    const freeView=await request(base,'GET','/api/verified-originals/'+HCV_ID+'/view',{
      bearer:'free-token',
    });
    assert.equal(freeView.status,402);

    const paidView=await request(base,'GET','/api/verified-originals/'+HCV_ID+'/view',{
      bearer:'owner-token',
    });
    assert.equal(paidView.status,200,paidView.text);
    assert.equal(paidView.json.access,'ENTITLED');
    assert.equal(paidView.json.publicUrl,'https://www.youtube.com/watch?v='+VIDEO_ID);
    assert.equal(paidView.json.socialFileVerdict,'NOT_VERIFIED');

    const withdrawal=await request(
      base,'POST','/api/verified-originals/consents/'+HCV_ID+'/withdraw',
      {bearer:'owner-token'},
    );
    assert.equal(withdrawal.status,200,withdrawal.text);
    assert.equal(withdrawal.json.referenceAvailable,false);
    assert.equal(withdrawal.json.platformTakedown,'COMPLETED');
    assert.equal(deleteCount,1);

    const after=await request(base,'GET','/api/verified-originals/'+HCV_ID);
    assert.equal(after.status,200);
    assert.equal(after.json.availability,'REFERENCE_NOT_AVAILABLE');

    const consent2=await request(base,'POST','/api/verified-originals/consents',{
      bearer:'owner-token',
      body:{
        hcvId:HCV_ID,
        intent:'PUBLISH_VERIFIED_ORIGINAL',
        publishReference:true,
        rightsConfirmed:true,
        monetizationConsent:false,
      },
    });
    assert.equal(consent2.status,201,consent2.text);
    const altered=Buffer.from(originalBytes);
    altered[altered.length-1] ^= 0xff;
    const uploadsBefore=uploadSessionCount;
    const rejected=await request(
      base,'POST',
      '/api/verified-originals/publish/'+HCV_ID+
        '?consentRecordId='+encodeURIComponent(consent2.json.recordId)+
        '&monetizationEnabled=false'+
        '&hcvpackSha256='+HCVPACK_HASH,
      {bearer:'owner-token',bytes:altered},
    );
    assert.equal(rejected.status,422,rejected.text);
    assert.equal(rejected.json.error,'DERIVATION_ORIGINAL_SHA_MISMATCH');
    assert.equal(uploadSessionCount,uploadsBefore);

    const photoConsent=await request(
      base,'POST','/api/verified-originals/consents',
      {
        bearer:'owner-token',
        body:{
          hcvId:PHOTO_HCV_ID,
          intent:'PUBLISH_VERIFIED_ORIGINAL',
          publishReference:true,
          rightsConfirmed:true,
          monetizationConsent:false,
        },
      },
    );
    assert.equal(photoConsent.status,201,photoConsent.text);

    const photoPublished=await request(
      base,'POST',
      '/api/verified-originals/publish/'+PHOTO_HCV_ID+
        '?consentRecordId='+encodeURIComponent(photoConsent.json.recordId)+
        '&monetizationEnabled=false'+
        '&hcvpackSha256='+PHOTO_HCVPACK_HASH,
      {
        bearer:'owner-token',
        bytes:photoBytes,
        contentType:'image/jpeg',
      },
    );
    assert.equal(photoPublished.status,201,photoPublished.text);
    assert.equal(photoPublished.json.platform,'youtube');
    assert.equal(
      photoPublished.json.derivationType,
      'photo_to_reference_video_v1',
    );
    assert.equal(photoPublished.json.hcvpackSha256,PHOTO_HCVPACK_HASH);
    assert.equal(uploadMetadata.snippet.title,'SIGILLUM '+PHOTO_HCV_ID);
    assert.ok(uploadedBytes && uploadedBytes.length > 1000);
    assert.notDeepEqual(uploadedBytes,photoBytes);

    const photoView=await request(
      base,'GET','/api/verified-originals/'+PHOTO_HCV_ID+'/view',
      {bearer:'owner-token'},
    );
    assert.equal(photoView.status,200,photoView.text);
    assert.equal(
      photoView.json.publicUrl,
      'https://www.youtube.com/watch?v='+PHOTO_VIDEO_ID,
    );
    assert.equal(photoView.json.hcvpackSha256,PHOTO_HCVPACK_HASH);

    const photoStored=await pool.query(
      'SELECT derivation_type,hcvpack_sha256 FROM verified_originals_publications WHERE hcv_id=$1 AND publication_status=\'PUBLISHED\'',
      [PHOTO_HCV_ID],
    );
    assert.equal(photoStored.rows.length,1);
    assert.equal(
      photoStored.rows[0].derivation_type,
      'photo_to_reference_video_v1',
    );
    assert.equal(photoStored.rows[0].hcvpack_sha256,PHOTO_HCVPACK_HASH);

    console.log(
      'verified_originals_production_test: PASS — PostgreSQL, video/photo exact originals, unlisted YouTube, free/paid, withdrawal, tamper stop',
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve=>server.close(resolve));
  }
}

run().finally(async()=>{
  await pool.end();
  fs.rmSync(tmp,{recursive:true,force:true});
}).catch(error=>{
  console.error(error);
  process.exitCode=1;
});