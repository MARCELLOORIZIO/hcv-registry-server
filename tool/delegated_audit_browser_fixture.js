'use strict';
// Isolated transport/decryption fixture, never a proxy to real R2 or production.
if(process.env.SIGILLUM_AUDIT_FIXTURE_ONLY!=='true' || process.env.DATABASE_URL ||
  process.env.R2_ACCESS_KEY_ID || process.env.R2_SECRET_ACCESS_KEY || process.env.R2_REFERENCE_MASTER_KEYS_JSON){
  throw new Error('FIXTURE_REQUIRES_ISOLATION_WITHOUT_PRODUCTION_CREDENTIALS');
}
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {fixturePool}=require('./audit_fixture_store');
const {createDelegatedReferenceAudit}=require('../delegated_reference_audit');
const {issueReadAuthorization,consumeReadAuthorization,initPrimaryReferenceReadAuthSchema}=require('../primary_reference_read_auth');
const {createR2ReferenceProvider,encryptReferenceFile}=require('../primary_reference_provider');
const {auditPage}=require('../delegated_reference_audit_ui');
const fixtures=require('./delegated_audit_fixture_images.json');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const readJson=async(req,max=4096)=>{let value='';for await(const b of req){value+=b;if(value.length>max)throw new Error('BODY_TOO_LARGE');}return JSON.parse(value||'{}');};
const sendJson=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'private, no-store'});res.end(JSON.stringify(data));};
async function main(){
 const pool=fixturePool();
 await pool.query(`CREATE TABLE accounts(id TEXT PRIMARY KEY);
 CREATE TABLE account_devices(account_id TEXT,device_key_fingerprint TEXT,revoked_at TIMESTAMPTZ);
 CREATE TABLE certificates(hcv_id TEXT PRIMARY KEY,account_id TEXT);
 CREATE TABLE verified_originals_reference_jobs(job_id TEXT PRIMARY KEY,hcv_id TEXT,state TEXT,provider TEXT,receipt_json JSONB);
 INSERT INTO accounts VALUES('synthetic-owner');
 INSERT INTO account_devices VALUES('synthetic-owner','synthetic-device',NULL);`);
 await initPrimaryReferenceReadAuthSchema(pool);
 const objects=new Map(),references=new Map(),masterKey=crypto.randomBytes(32);
 const tmp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'sigillum-synthetic-audit-'));
 class GetObjectCommand{constructor(input){this.input=input;}}
 const provider=createR2ReferenceProvider({env:{R2_ENDPOINT:'https://synthetic.eu.r2.cloudflarestorage.com',R2_BUCKET:'synthetic',R2_ACCESS_KEY_ID:'not-a-real-key',R2_SECRET_ACCESS_KEY:'not-a-real-key',R2_REFERENCE_ACTIVE_KEY_ID:'fixture',R2_REFERENCE_MASTER_KEYS_JSON:JSON.stringify({fixture:masterKey.toString('base64')})},aws:{GetObjectCommand,S3Client:class {},HeadObjectCommand:class {},DeleteObjectCommand:class {},Upload:class {constructor(){throw new Error('FIXTURE_WRITES_FORBIDDEN');}},getSignedUrl:async()=>{throw new Error('FIXTURE_PUBLIC_URL_FORBIDDEN');},client:{send:async command=>{
  if(!(command instanceof GetObjectCommand))throw new Error('FIXTURE_FORBIDS_REMOTE_AND_WRITE_OPERATIONS');
  const bytes=objects.get(command.input.Key);if(!bytes)throw new Error('NOT_FOUND');return {Body:Readable.from(bytes)};
 }}}});
 for(const [id,encoded] of Object.entries(fixtures)){
  const bytes=Buffer.from(encoded,'base64'),sha=hash(bytes),objectId=crypto.randomUUID();
  const binding={hcvId:id,referenceRole:'ORIGINAL_REFERENCE',referenceSha256:sha,originalContentSha256:sha,hcvpackSha256:hash('synthetic-pack'),derivationManifestSha256:hash('synthetic-manifest'),objectId,mediaType:'photo'};
  const source=path.join(tmp,id+'.png'),encrypted=path.join(tmp,id+'.sgref');
  await fs.promises.writeFile(source,bytes,{mode:0o600});
  await encryptReferenceFile({sourcePath:source,targetPath:encrypted,masterKey,keyId:'fixture',binding});
  const ciphertext=await fs.promises.readFile(encrypted),objectKey='synthetic/'+objectId;
  const receipt={...binding,provider:'r2',objectKey,ciphertextSha256:hash(ciphertext)};
  objects.set(objectKey,ciphertext);references.set(id,{lifecycleJobId:'job-'+id,receipt,binding,sha});
  await pool.query('INSERT INTO certificates VALUES($1,$2)',[id,'synthetic-owner']);
  await pool.query("INSERT INTO verified_originals_reference_jobs VALUES($1,$2,'COMMITTED','r2',$3)",['job-'+id,id,JSON.stringify(receipt)]);
 }
 let feature; const port=Number(process.env.PORT||8766);
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://fixture.local');
   if(req.method==='GET' && url.pathname==='/health')return sendJson(res,200,{fixture:true,productionAccess:false});
   if(req.method==='GET' && url.pathname==='/'){res.writeHead(302,{Location:'/audit'});return res.end();}
   if(req.method==='POST' && url.pathname==='/fixture-approve'){
    if(req.headers.origin!==origin)throw Object.assign(new Error('ORIGIN_REJECTED'),{statusCode:403});
    const body=await readJson(req);if(!/^[a-f0-9]{32}$/.test(body.requestId))throw new Error('INVALID_ID');
    const row=(await pool.query('SELECT * FROM verified_originals_delegated_audits WHERE request_id=$1',[body.requestId])).rows[0];
    if(!row)throw new Error('NOT_FOUND');
    const ownerReq=Readable.from([JSON.stringify({confirm:true,hcvIds:row.hcv_ids,scopeDigest:row.scope_digest})]);
    ownerReq.method='POST';ownerReq.headers={origin,authorization:'Bearer synthetic-owner'};
    return await feature.handle(ownerReq,res,new URL('/api/verified-originals/audit/requests/'+body.requestId+'/approve',origin));
   }
   if(req.method==='GET' && /^\/audit\/browser\/[a-f0-9]{32}$/.test(url.pathname)){
    const id=url.pathname.split('/').at(-1),nonce=crypto.randomBytes(18).toString('base64');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'`);
    res.setHeader('Referrer-Policy','no-referrer');
    let html=auditPage({mode:'browser',requestId:id,nonce});
    html=html.replace('<h1>Audit privato SIGILLUM</h1>','<h1>TEST CON IMMAGINI SINTETICHE</h1><p>Questo servizio non accede alla produzione. Gli HCV-ID sono etichette di collaudo, non le foto reali.</p><button id="fixtureApprove">Approva soltanto i dati sintetici</button>');
    html=html.replace('</body>',`<script nonce="${nonce}">document.getElementById('fixtureApprove').onclick=async()=>{const r=await fetch('/fixture-approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'${id}'})});document.getElementById('status').textContent=r.ok?'Approvazione sintetica completata. Premi Verifica approvazione.':'Errore collaudo';};</script></body>`);
    res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'private, no-store'});return res.end(html);
   }
   if(!await feature.handle(req,res,url))sendJson(res,404,{error:'NOT_FOUND'});
  }catch(error){if(res.headersSent)return res.destroy();sendJson(res,error.statusCode||500,{error:error.code||error.message});}
 });
 const origin=process.env.RENDER_EXTERNAL_URL || 'http://127.0.0.1:'+port;
 feature=createDelegatedReferenceAudit({pool,enabled:true,origin,allowTestHttp:!process.env.RENDER_EXTERNAL_URL,
  authenticate:async req=>{if(req.headers.authorization!=='Bearer synthetic-owner')throw Object.assign(new Error('SESSIONE_MANCANTE'),{statusCode:401});return {account_id:'synthetic-owner',device_key_fingerprint:'synthetic-device'};},
  accountEnvelope:async()=>({subscriptionStatus:'active',emailVerified:true}),
  activeReference:async id=>references.get(id),readJson,sendJson,
  sendHtml:(res,status,html)=>{res.writeHead(status,{'Content-Type':'text/html'});res.end(html);},
  issueRead:(client,reference,hcvId,accountId,ttlSeconds)=>issueReadAuthorization(client,{jobId:reference.lifecycleJobId,hcvId,accountId,ttlSeconds}),
  streamRead:async(req,res,token,accountId,id)=>{
   const authorization=await consumeReadAuthorization(pool,{token,accountId});
   if(authorization.hcvId!==id)throw new Error('SCOPE_MISMATCH');
   const reference=references.get(id),dir=await fs.promises.mkdtemp(path.join(tmp,'read-')),dest=path.join(dir,'photo.png');
   try{
    const before=hash(objects.get(reference.receipt.objectKey));
    await provider.materializeReference({receipt:reference.receipt,binding:reference.binding,destinationPath:dest});
    const plain=await fs.promises.readFile(dest);if(hash(plain)!==reference.sha)throw new Error('FIXTURE_HASH_MISMATCH');
    if(hash(objects.get(reference.receipt.objectKey))!==before)throw new Error('FIXTURE_ORIGINAL_MUTATED');
    res.writeHead(200,{'Content-Type':'image/png','Content-Length':plain.length,'Cache-Control':'private, no-store','X-SIGILLUM-Fixture':'synthetic-only'});
    await pipeline(fs.createReadStream(dest),res);
   }finally{await fs.promises.rm(dir,{recursive:true,force:true});}
  }});
 await feature.initSchema();server.listen(port,'0.0.0.0',()=>console.log('SYNTHETIC_AUDIT_FIXTURE_READY'));
 const stop=()=>server.close(async()=>{await pool.end();await fs.promises.rm(tmp,{recursive:true,force:true});process.exit(0);});
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
