'use strict';
// Actual Registry factory + SQL + existing AES-GCM/SHA256 reader, with synthetic
// certificate verification and in-memory encrypted S3 objects. No network/R2 keys.
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Readable}=require('node:stream');
const {memoryPool}=require('./tool/audit_test_database');
const {createVerifiedOriginalsProduction,referenceVisualFingerprintV3FromRaw}=require('./verified_originals_production');
const {createPrimaryReferenceManifest}=require('./primary_reference_manifest');
const {createR2ReferenceProvider,encryptReferenceFile}=require('./primary_reference_provider');
const {createMcpPrincipalVerifier}=require('./sigillum_mcp_auth');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const ID='HCV-0000000000000051',DEVICE='a'.repeat(64),OWNER='synthetic-owner';
const PRINCIPAL='synthetic-connector',TOKEN='t'.repeat(48);

test('Registry factory returns exact decrypted synthetic photo; rechecks rights and revocation',async()=>{
 const pool=await memoryPool(),tmp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'sigillum-connector-test-'));
 const previousKeys=process.env.SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON;
 const previousAudit=process.env.SIGILLUM_DELEGATED_AUDIT_ENABLED;
 const previousOrigin=process.env.SIGILLUM_DELEGATED_AUDIT_ORIGIN;
 let decrypts=0,subscription='active',duringMaterialize=null,clock=Date.now();
 try{
  await pool.query(`CREATE TABLE accounts(id TEXT PRIMARY KEY);
   CREATE TABLE certificates(hcv_id TEXT PRIMARY KEY,account_id TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),
    certificate_raw TEXT,certificate_sha256 TEXT,account_subject_hash TEXT,device_key_fingerprint TEXT,
    creator_id TEXT,binding_version INTEGER,content_sha256 TEXT,identity_verified BOOLEAN,
    registry_attested_at TIMESTAMPTZ,provenance_version INTEGER,registry_attestation_sha256 TEXT);
   CREATE TABLE account_devices(account_id TEXT,device_key_fingerprint TEXT,revoked_at TIMESTAMPTZ);`);
  await pool.query('INSERT INTO accounts VALUES($1)',[OWNER]);
  await pool.query('INSERT INTO account_devices VALUES($1,$2,NULL)',[OWNER,DEVICE]);
  const bytes=Buffer.from(require('./tool/delegated_audit_fixture_images.json')['HCV-D8FF76496D424CA5'],'base64');
  const sha=hash(bytes),pack=hash('synthetic-pack'),sessionId='synthetic-session';
  const event={type:'SIGILLUM_PROVENANCE_EVENT',version:1,sequence:0,eventType:'CAPTURE_FINALIZED',
   inputHash:sha,deviceFingerprint:DEVICE,sessionId,pipelineVersion:'HCV_CAPTURE_BINDING_V1',
   parentEvent:'GENESIS',eventHash:hash('event'),metadata:{hcvId:ID,captureSource:'HCV_CAMERA',mediaType:'photo',contentSize:bytes.length}};
  const certificate={sessionId,content:{type:'photo',hash:sha,size:bytes.length},claims:{captureSource:'HCV_CAMERA',liveCapture:true,
   provenance:{type:'SIGILLUM_CAPTURE_PROVENANCE_BINDING',version:1,status:'VERIFIED',hcvId:ID,inputHash:sha,
    deviceFingerprint:DEVICE,sessionId,pipelineVersion:'HCV_CAPTURE_BINDING_V1',eventHash:event.eventHash,event}}};
  const raw=JSON.stringify(certificate);
  await pool.query(`INSERT INTO certificates VALUES($1,$2,NOW(),$3,$4,$5,$6,$7,1,$8,TRUE,NOW(),2,$9)`,
   [ID,OWNER,raw,hash(raw),hash(OWNER),DEVICE,'synthetic-creator',sha,hash('attestation')]);
  const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  process.env.SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON=JSON.stringify({'synthetic-key':keys.publicKey.export({format:'pem',type:'spki'})});
  process.env.SIGILLUM_DELEGATED_AUDIT_ENABLED='true';
  process.env.SIGILLUM_DELEGATED_AUDIT_ORIGIN='https://synthetic.invalid';
  const manifest=createPrimaryReferenceManifest({hcvId:ID,originalContentSha256:sha,byteLength:bytes.length,
   mediaType:'photo',referenceVisualFingerprint:referenceVisualFingerprintV3FromRaw(Buffer.alloc(128*72*3,80),'photo'),
   certificateRaw:raw,keyId:'synthetic-key',privateKeyPem:keys.privateKey.export({format:'pem',type:'pkcs8'})}).manifest;
  const binding={hcvId:ID,referenceRole:'ORIGINAL_REFERENCE',referenceSha256:sha,originalContentSha256:sha,
   hcvpackSha256:pack,derivationManifestSha256:hash(JSON.stringify(manifest)),objectId:crypto.randomUUID(),mediaType:'photo'};
  const masterKey=crypto.randomBytes(32),source=path.join(tmp,'source.png'),encrypted=path.join(tmp,'reference.enc');
  await fs.promises.writeFile(source,bytes);
  await encryptReferenceFile({sourcePath:source,targetPath:encrypted,masterKey,keyId:'synthetic-key',binding});
  const ciphertext=await fs.promises.readFile(encrypted);
  const receipt={...binding,provider:'r2',objectKey:'synthetic/object',ciphertextSha256:hash(ciphertext)};
  class GetObjectCommand{constructor(input){this.input=input;}}
  const provider=createR2ReferenceProvider({env:{R2_ENDPOINT:'https://synthetic.eu.r2.cloudflarestorage.com',
   R2_BUCKET:'synthetic',R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'fixture',R2_REFERENCE_ACTIVE_KEY_ID:'synthetic-key',
   R2_REFERENCE_MASTER_KEYS_JSON:JSON.stringify({'synthetic-key':masterKey.toString('base64')})},
   aws:{GetObjectCommand,S3Client:class {},HeadObjectCommand:class {},DeleteObjectCommand:class {},Upload:class {},
    getSignedUrl:async()=>{throw Error('PUBLIC_URL_FORBIDDEN');},client:{send:async command=>{
     assert(command instanceof GetObjectCommand);assert.equal(command.input.Key,receipt.objectKey);
     return {Body:Readable.from(ciphertext)};
    }}}});
  const wrappedProvider={name:'r2',materializeReference:async args=>{
   decrypts++;await provider.materializeReference(args);if(duringMaterialize)await duringMaterialize();
  }};
  let ownerResponse;
  const feature=createVerifiedOriginalsProduction({pool,authenticate:async req=>{
   assert.equal(req.headers.authorization,'Bearer synthetic-owner-session');
   return {account_id:OWNER,device_key_fingerprint:DEVICE};
  },
   accountEnvelope:async(account,device)=>{assert.equal(account,OWNER);assert.equal(device,DEVICE);return {subscriptionStatus:subscription,emailVerified:true};},
   requireCreatorAccess:async()=>{},verifyCertificateRaw:value=>JSON.parse(value),
   provenanceEnvelopeFromRow:()=>({status:'SIGILLUM_REGISTRY_VERIFIED',integrityValid:true,identityVerified:true,contentSha256:sha}),
   sendJson:(res,status,body)=>{ownerResponse={status,body};},sendHtml:()=>{},readJson:async req=>req.body,publicError:(code)=>Object.assign(Error(code),{code}),
   primaryReferenceProviderOverride:wrappedProvider,ffmpegPath:'/unused-synthetic-fixture'});
  await feature.initSchema();
  await pool.query(fs.readFileSync(path.join(__dirname,'migrations/20261012_sigillum_connector_principal.sql'),'utf8'));
  await pool.query(`INSERT INTO verified_originals_consents(record_id,hcv_id,account_id,creator_id,session_device_fingerprint,
   consent_version,publication_consent,monetization_consent,rights_confirmed,state)
   VALUES('consent',$1,$2,'synthetic-creator',$3,'synthetic',TRUE,FALSE,TRUE,'ACTIVE')`,[ID,OWNER,DEVICE]);
  await pool.query(`INSERT INTO trusted_derivations(output_sha256,hcv_id,manifest_raw) VALUES($1,$2,$3)`,[sha,ID,JSON.stringify(manifest)]);
  await pool.query(`INSERT INTO verified_originals_reference_jobs(job_id,hcv_id,reference_role,reference_sha256,original_content_sha256,
   hcvpack_sha256,derivation_manifest_sha256,media_type,idempotency_key,provider,object_id,object_key,state,receipt_json)
   VALUES('job',$1,'ORIGINAL_REFERENCE',$2,$2,$3,$4,'photo','synthetic','r2',$5,$6,'COMMITTED',$7)`,
   [ID,sha,pack,binding.derivationManifestSha256,binding.objectId,receipt.objectKey,JSON.stringify(receipt)]);
  await pool.query(`INSERT INTO verified_originals_platform_receipts(receipt_id,hcv_id,platform,platform_post_id,uploaded_sha256,
   upload_session_hash,processing_status,visibility,publisher_subject_hash)
   VALUES('receipt',$1,'r2',$2,$3,'synthetic','succeeded','private','synthetic')`,[ID,binding.objectId,receipt.ciphertextSha256]);
  await pool.query(`INSERT INTO verified_originals_publications(publication_id,hcv_id,platform,platform_post_id,public_url,reference_sha256,
   original_content_sha256,derived_from,derivation_type,derivation_manifest_sha256,platform_receipt_id,created_at,publication_status,
   consent_record_id,consent_version,monetization_consent,published_by,hcvpack_sha256)
   VALUES('publication',$1,'r2',$2,'',$3,$3,$3,'synthetic',$4,'receipt',NOW(),'PUBLISHED','consent','synthetic',FALSE,'synthetic',$5)`,
   [ID,binding.objectId,sha,binding.derivationManifestSha256,pack]);
  const resolvePrincipal=createMcpPrincipalVerifier({lookupTokenHash:async digest=>digest===hash(TOKEN)?
   {principal:PRINCIPAL,expiresAtMs:clock+600000,revoked:false}:null,now:()=>clock});
  const dispatch=feature.createConnectorService({resolvePrincipal,now:()=>new Date(clock)});
  const call=id=>dispatch({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'sigillum_read_approved_original',
   arguments:{grantId:id,hcvId:ID}}},{authorization:'Bearer '+TOKEN});
  async function request(){
   const reply=await dispatch({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'sigillum_request_original_audit',
    arguments:{hcvIds:[ID]}}},{authorization:'Bearer '+TOKEN});
   assert.equal(reply.result.isError,false,JSON.stringify(reply));
   return JSON.parse(reply.result.content[0].text);
  }
  async function grant(){
   const requestData=await request();
   assert.equal(requestData.state,'PENDING');
   const before=decrypts;assert.equal((await call(requestData.requestId)).result.isError,true);assert.equal(decrypts,before);
   const req={method:'POST',headers:{origin:'https://synthetic.invalid',authorization:'Bearer synthetic-owner-session'},
    body:{confirm:true,hcvIds:requestData.hcvIds,scopeDigest:requestData.scopeDigest}};
   await feature.handle(req,{setHeader(){}},new URL(requestData.approvalUrl.replace('/audit/approve/','/api/verified-originals/audit/requests/')+'/approve'));
   assert.equal(ownerResponse.status,200);assert.equal(ownerResponse.body.state,'APPROVED');
   return requestData.requestId;
  }
  const first=await grant(),reply=await call(first);
  assert.equal(reply.result.isError,false,JSON.stringify(reply));
  assert.deepEqual(Buffer.from(reply.result.content[0].data,'base64'),bytes);
  assert.equal(decrypts,1);assert.equal((await call(first)).result.isError,true);assert.equal(decrypts,1);
  const noSubscription=await grant();subscription='inactive';assert.equal((await call(noSubscription)).result.isError,true);assert.equal(decrypts,1);subscription='active';
  await pool.query("UPDATE verified_originals_consents SET rights_confirmed=FALSE");
  assert.equal((await call(await grant())).result.isError,true);assert.equal(decrypts,1);
  await pool.query("UPDATE verified_originals_consents SET rights_confirmed=TRUE");
  const revoke=await grant();duringMaterialize=()=>pool.query("UPDATE verified_originals_delegated_audits SET state='REVOKED' WHERE request_id=$1",[revoke]);
  assert.equal((await call(revoke)).result.isError,true);assert.equal(decrypts,2);
  const expiring=await grant();duringMaterialize=async()=>{
   const row=(await pool.query('SELECT expires_at FROM verified_originals_delegated_audits WHERE request_id=$1',[expiring])).rows[0];
   clock=new Date(row.expires_at).getTime()+1;
  };
  assert.equal((await call(expiring)).result.isError,true);assert.equal(decrypts,3);
  const events=(await pool.query('SELECT event_type FROM verified_originals_delegated_audit_events')).rows;
  assert.equal(events.filter(e=>e.event_type==='READ_COMPLETED').length,1);
  assert.equal(events.filter(e=>e.event_type==='READ_FAILED').length,4);
 }finally{
  if(previousKeys===undefined)delete process.env.SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON;else process.env.SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON=previousKeys;
  if(previousAudit===undefined)delete process.env.SIGILLUM_DELEGATED_AUDIT_ENABLED;else process.env.SIGILLUM_DELEGATED_AUDIT_ENABLED=previousAudit;
  if(previousOrigin===undefined)delete process.env.SIGILLUM_DELEGATED_AUDIT_ORIGIN;else process.env.SIGILLUM_DELEGATED_AUDIT_ORIGIN=previousOrigin;
  await pool.end();await fs.promises.rm(tmp,{recursive:true,force:true});
 }
});
