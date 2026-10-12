'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const crypto = require('node:crypto');
const {Pool} = require('pg');
const {createDelegatedReferenceAudit,scopeIds} = require('./delegated_reference_audit');
const {issueReadAuthorization,consumeReadAuthorization,initPrimaryReferenceReadAuthSchema} = require('./primary_reference_read_auth');
const {auditPage} = require('./delegated_reference_audit_ui');
const A='HCV-D8FF76496D424CA5', B='HCV-255DEE0995364F99', C='HCV-0000000000000001';
test('scope and browser UI parse without inline external resources',()=>{
  assert.deepEqual(scopeIds([B,A]),[B,A].sort());
  for(const ids of [[],[A,A],['bad'],Array(26).fill(A)])assert.throws(()=>scopeIds(ids));
  for(const mode of ['new','approve','browser']){
    const page=auditPage({mode,requestId:'a'.repeat(32),nonce:'test'});
    new Function(page.match(/<script[^>]*>([\s\S]*)<\/script>/)[1]);
    assert.ok(!page.includes('localStorage'));
    assert.ok(page.includes("HttpOnly")===false);
  }
});
test('delegated audit HTTP and PostgreSQL permissions',async t=>{
  const usePostgres = Boolean(process.env.DATABASE_URL);
  const schema='audit_test_'+crypto.randomBytes(8).toString('hex');
  const admin=usePostgres ? new Pool({connectionString:process.env.DATABASE_URL}) : await require('./tool/audit_test_database').memoryPool();
  await admin.query('CREATE SCHEMA '+schema);
  const pool=usePostgres ? new Pool({connectionString:process.env.DATABASE_URL,options:'-c search_path='+schema}) : {...admin,end:async()=>{}};
  if (!usePostgres) await pool.query('SET search_path TO '+schema);
  let server;
  try{
    await pool.query(`CREATE TABLE accounts(id TEXT PRIMARY KEY);
      CREATE TABLE account_devices(account_id TEXT,device_key_fingerprint TEXT,revoked_at TIMESTAMPTZ);
      CREATE TABLE certificates(hcv_id TEXT PRIMARY KEY,account_id TEXT);
      CREATE TABLE verified_originals_reference_jobs(job_id TEXT PRIMARY KEY,hcv_id TEXT,state TEXT,provider TEXT,receipt_json JSONB);
      INSERT INTO accounts VALUES('owner'),('other');
      INSERT INTO account_devices VALUES('owner','device',NULL),('other','other-device',NULL);`);
    for(const id of [A,B,C]){
      await pool.query('INSERT INTO certificates VALUES($1,$2)',[id,id===C?'other':'owner']);
      await pool.query("INSERT INTO verified_originals_reference_jobs VALUES($1,$2,'COMMITTED','r2','{}')",['job-'+id,id]);
    }
    await initPrimaryReferenceReadAuthSchema(pool);
    const accounts={owner:{subscriptionStatus:'active',emailVerified:true},other:{subscriptionStatus:'active',emailVerified:true}};
    const available=new Set([A,B,C]);
    let streamCount=0, feature;
    server=http.createServer(async(req,res)=>{
      try{
        const handled=await feature.handle(req,res,new URL(req.url,'http://127.0.0.1'));
        if(!handled){res.writeHead(404);res.end();}
      }catch(error){if(res.headersSent){res.destroy();return;}res.writeHead(error.statusCode||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.code||error.message}));}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    const deps={pool,enabled:true,origin,allowTestHttp:true,
      authenticate:async req=>{
        if(req.headers.authorization==='Bearer fixture-owner')return {account_id:'owner',device_key_fingerprint:'device'};
        if(req.headers.authorization==='Bearer fixture-other')return {account_id:'other',device_key_fingerprint:'other-device'};
        throw Object.assign(new Error('SESSIONE_MANCANTE'),{statusCode:401});
      },
      accountEnvelope:async id=>accounts[id],
      activeReference:async id=>available.has(id)?{lifecycleJobId:'job-'+id}:null,
      issueRead:(client,ref,hcvId,accountId,ttlSeconds)=>issueReadAuthorization(client,{jobId:ref.lifecycleJobId,hcvId,accountId,ttlSeconds}),
      streamRead:async(req,res,token,accountId,hcvId)=>{
        const auth=await consumeReadAuthorization(pool,{token,accountId});
        assert.equal(auth.hcvId,hcvId);streamCount++;
        res.writeHead(200,{'Content-Type':'image/png'});res.end(Buffer.from('fixture-only-'+hcvId));
      },
      readJson:async req=>{let s='';for await(const chunk of req)s+=chunk;return JSON.parse(s||'{}');},
      sendJson:(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));},
      sendHtml:(res,code,html)=>{res.writeHead(code,{'Content-Type':'text/html'});res.end(html);}};
    feature=createDelegatedReferenceAudit(deps);await feature.initSchema();
    const root='/api/verified-originals/audit/requests';
    async function call(path,{method='GET',body,cookie,who,requestOrigin=origin}={}){
      const res=await fetch(origin+path,{method,headers:{Origin:requestOrigin,...(cookie?{Cookie:cookie}:{}),...(who?{Authorization:'Bearer fixture-'+who}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      const text=await res.text();let data;try{data=JSON.parse(text);}catch{data=text;}
      return {status:res.status,data,cookie:res.headers.get('set-cookie')?.split(';')[0],headers:res.headers};
    }
    const request=await call(root,{method:'POST',body:{hcvIds:[A,B]}});
    assert.equal(request.status,201);const id=request.data.requestId,cookie=request.cookie;
    assert.ok(request.headers.get('set-cookie').includes('HttpOnly; SameSite=Strict'));
    const detail=root+'/'+id;
    assert.equal((await call(detail)).status,401);
    assert.equal((await call(detail,{cookie:'sigillum-audit-test='+crypto.randomBytes(32).toString('base64url')})).status,403);
    assert.equal((await call(detail+'/'+A+'/read-authorization',{method:'POST',cookie,body:{}})).status,403);
    assert.equal((await call(root,{method:'POST',body:{hcvIds:[A]},requestOrigin:'https://evil.invalid'})).status,403);
    assert.equal((await call(detail+'/owner-scope',{who:'other'})).status,403);
    const consent={confirm:true,hcvIds:[A,B],scopeDigest:request.data.scopeDigest};
    assert.equal((await call(detail+'/approve',{method:'POST',who:'owner',body:{...consent,confirm:false}})).status,403);
    assert.equal((await call(detail+'/approve',{method:'POST',who:'owner',body:{...consent,hcvIds:[A,C]}})).status,403);
    assert.equal((await call(detail+'/approve',{method:'POST',who:'other',body:consent})).status,403);
    assert.equal((await call(detail+'/approve',{method:'POST',who:'owner',body:consent})).status,200);
    assert.equal((await call(detail+'/approve',{method:'POST',who:'owner',body:consent})).status,403);
    assert.equal((await call(detail+'/'+C+'/read-authorization',{method:'POST',cookie,body:{}})).status,403);
    accounts.owner.subscriptionStatus='inactive';
    assert.equal((await call(detail+'/'+A+'/read-authorization',{method:'POST',cookie,body:{}})).status,402);
    accounts.owner.subscriptionStatus='active';
    const authorization=await call(detail+'/'+A+'/read-authorization',{method:'POST',cookie,body:{}});
    assert.equal(authorization.status,201);
    assert.equal((await call(authorization.data.readPath)).status,401);
    assert.equal((await call(authorization.data.readPath,{cookie})).status,200);
    assert.equal((await call(authorization.data.readPath,{cookie})).status,403);
    assert.equal((await call(detail+'/'+A+'/read-authorization',{method:'POST',cookie,body:{}})).status,403); // one read per approved photo
    const bAuth=await call(detail+'/'+B+'/read-authorization',{method:'POST',cookie,body:{}});assert.equal(bAuth.status,201);
    assert.equal((await call(detail+'/revoke',{method:'POST',who:'other',body:{}})).status,403);
    assert.equal((await call(detail+'/revoke',{method:'POST',who:'owner',body:{}})).status,200);
    assert.equal((await call(bAuth.data.readPath,{cookie})).status,403);
    assert.equal(streamCount,1);
    const expiry=await call(root,{method:'POST',body:{hcvIds:[B]},cookie});
    await pool.query("UPDATE verified_originals_delegated_audits SET expires_at=NOW()-INTERVAL '1 second' WHERE request_id=$1",[expiry.data.requestId]);
    assert.equal((await call(root+'/'+expiry.data.requestId,{cookie})).status,403);
    const devices=await call(root,{method:'POST',body:{hcvIds:[B]},cookie});
    const dPath=root+'/'+devices.data.requestId;
    const dConsent={confirm:true,hcvIds:[B],scopeDigest:devices.data.scopeDigest};
    assert.equal((await call(dPath+'/approve',{method:'POST',who:'owner',body:dConsent})).status,200);
    await pool.query("UPDATE account_devices SET revoked_at=NOW() WHERE account_id='owner'");
    assert.equal((await call(dPath+'/'+B+'/read-authorization',{method:'POST',cookie,body:{}})).status,403);
    const events=(await pool.query('SELECT * FROM verified_originals_delegated_audit_events')).rows;
    for(const type of ['OWNER_APPROVED','ACCESS_REJECTED','READ_AUTHORIZED','READ_STARTED','READ_COMPLETED','READ_FAILED','OWNER_REVOKED'])assert.ok(events.some(e=>e.event_type===type),type);
    assert.ok(!JSON.stringify(events).includes('fixture-owner'));
    assert.ok(!JSON.stringify(events).includes(authorization.data.readPath.split('/').at(-1)));
    assert.deepEqual((await pool.query('SELECT hcv_id,account_id FROM certificates ORDER BY hcv_id')).rows,
      [{hcv_id:C,account_id:'other'},{hcv_id:B,account_id:'owner'},{hcv_id:A,account_id:'owner'}]);
    feature=createDelegatedReferenceAudit({...deps,enabled:false});
    assert.equal((await call('/audit')).status,404);
    await t.test('secure origin required',()=>assert.throws(()=>createDelegatedReferenceAudit({...deps,origin:'http://example.test',allowTestHttp:false})));
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();
  }
});
