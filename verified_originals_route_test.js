'use strict';
// Fast in-memory route contract test. Production SQLite/HTTP integration must
// additionally run with better-sqlite3 in CI before deployment.
const assert=require('node:assert/strict');
const Module=require('module');
const http=require('http');
const {accountSubjectHash}=require('./verified_originals_policy');
const id='HCV-0123456789ABCDEF', original='a'.repeat(64), rendition='b'.repeat(64);
const consent=new Map(), publication=new Map(), events=[];
const provenance={type:'SIGILLUM_REGISTRY_PROVENANCE',version:2,
 status:'SIGILLUM_REGISTRY_VERIFIED',integrityValid:true,contentSha256:original,
 accountSubjectHash:accountSubjectHash('accountA'),creatorId:'creatorA',
 deviceKeyFingerprint:'f'.repeat(64)};
class Database {
 pragma(){} exec(){} transaction(fn){return fn;}
 prepare(sql){const s=sql.replace(/\s+/g,' ').trim();return {
 get(key){
  if(s.includes('FROM certificates'))return key===id?{hcv_id:id}:undefined;
  if(s.includes('FROM registry_provenance'))return key===id?{provenance_raw:JSON.stringify(provenance),registry_status:'ACTIVE'}:undefined;
  if(s.includes('FROM certificate_status_events'))return {status:'ACTIVE'};
  if(s.includes('FROM verified_originals_consent'))return consent.get(key);
  if(s.includes('FROM verified_originals_publications'))return publication.get(key);
  throw Error('unknown query: '+s);
 },
 run(...args){
  if(s.startsWith('INSERT INTO verified_originals_consent_events')){events.push(args);return;}
  if(s.startsWith('INSERT INTO verified_originals_consent')){
   consent.set(args[0],{hcv_id:args[0],account_subject_hash:args[1],
    allow_monetization:args[2],consented_at:args[3],revoked_at:null});return;
  }
  if(s.startsWith('UPDATE verified_originals_consent')){
   const v=consent.get(args[1]);if(v)v.revoked_at=args[0];return;
  }
  if(s.startsWith('INSERT INTO verified_originals_publications')){
   publication.set(args[0],{hcv_id:args[0],video_id:args[1],
    original_sha256:args[2],rendition_sha256:args[3],channel:args[4],
    published_at:args[5],status:'PUBLISHED'});return;
  }
  if(s.startsWith('UPDATE verified_originals_publications')){
   const v=publication.get(args[0]);if(v)v.status='REMOVED';return;
  }
  throw Error('unknown mutation: '+s);
 }};}
}
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='better-sqlite3')return Database;
 if(request==='./registry_certificate_security')return {
  authenticateRegistrySession:(_db,authorization)=>{
   if(authorization==='Bearer owner')return {accountId:'accountA',creatorId:'creatorA',deviceKeyFingerprint:'f'.repeat(64)};
   if(authorization==='Bearer other')return {accountId:'other',creatorId:'other',deviceKeyFingerprint:'0'.repeat(64)};
   throw Object.assign(Error('SESSIONE_NON_VALIDA'),{statusCode:401});
  }};
 return originalLoad.call(this,request,parent,isMain);
};
process.env.SIGILLUM_PUBLICATION_ADMIN_TOKEN='admin-secret';
process.env.SIGILLUM_YOUTUBE_CHANNEL_HANDLE='@sigillumtest';
require('./verified_originals_guard');
Module._load=originalLoad;
const server=http.createServer((_req,res)=>{res.statusCode=404;res.end('other route');});
function api(path,{method='GET',token,admin,body}={}){
 const port=server.address().port;
 return fetch(`http://127.0.0.1:${port}${path}`,{
  method,headers:{...(token?{authorization:`Bearer ${token}`}:{ }),
   ...(admin?{'x-sigillum-publication-token':admin}:{}),
   'content-type':'application/json'},
  ...(body!==undefined?{body:JSON.stringify(body)}:{})
 }).then(async r=>({status:r.status,body:await r.json()}));
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base=`/api/verified-originals/${id}`;
  assert.equal((await api(base)).body.referenceAvailable,false);
  assert.equal((await api(`${base}/publication`,{method:'POST',admin:'admin-secret',body:{}})).status,403);
  let valid={allowPublication:true,allowMonetization:false,rightsConfirmed:true,publicVisibilityAcknowledged:true};
  assert.equal((await api(`${base}/consent`,{method:'POST',token:'other',body:valid})).status,403);
  assert.equal((await api(`${base}/consent`,{method:'POST',token:'owner',body:{...valid,rightsConfirmed:false}})).status,400);
  assert.equal((await api(`${base}/consent`,{method:'POST',token:'owner',body:valid})).status,200);
  assert.equal((await api(base)).body.referenceAvailable,false);
  const pub={originalSha256:original,renditionSha256:rendition,
    videoId:'AaBbCcDd123',channel:'@sigillumtest',
    manualRightsReview:true,referenceCopyCompared:true,monetizationEnabled:false};
  assert.equal((await api(`${base}/publication`,{method:'POST',body:pub})).status,403);
  assert.equal((await api(`${base}/publication`,{method:'POST',admin:'admin-secret',body:{...pub,monetizationEnabled:true}})).status,403);
  assert.equal((await api(`${base}/publication`,{method:'POST',admin:'admin-secret',body:{...pub,originalSha256:rendition}})).status,409);
  assert.equal((await api(`${base}/publication`,{method:'POST',admin:'admin-secret',body:{...pub,channel:'@impostor'}})).status,403);
  assert.equal((await api(`${base}/publication`,{method:'POST',admin:'admin-secret',body:pub})).status,200);
  assert.equal((await api(base)).body.reference.url,'https://www.youtube.com/watch?v=AaBbCcDd123');
  assert.equal((await api(`${base}/revoke`,{method:'POST',token:'other',body:{}})).status,403);
  assert.equal((await api(`${base}/revoke`,{method:'POST',token:'owner',body:{}})).status,200);
  assert.equal((await api(base)).body.referenceAvailable,false);
  assert.equal((await api(`${base}/publication`,{method:'POST',admin:'admin-secret',body:pub})).status,403);
  assert.equal(events.length,2);
  console.log('PASS route scenarios: private default, owner consent, rights, admin, monetization, SHA, channel, link, revoke');
 }finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});