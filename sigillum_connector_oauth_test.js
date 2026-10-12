'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {memoryPool}=require('./tool/audit_test_database');
const {createConnectorOAuth,SCOPE}=require('./sigillum_connector_oauth');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function fixture(){
 const pool=await memoryPool();let clock=Date.now();
 await pool.query(`CREATE TABLE accounts(id TEXT PRIMARY KEY,email_verified BOOLEAN);
  CREATE TABLE account_devices(account_id TEXT,device_key_fingerprint TEXT,revoked_at TIMESTAMPTZ);
  INSERT INTO accounts VALUES('owner',TRUE);
  INSERT INTO account_devices VALUES('owner','device',NULL);`);
 const issuer='https://registry.synthetic.invalid',resource=issuer+'/connector/mcp',client_id='synthetic-chatgpt',
  redirect_uri='https://chatgpt.com/connector_platform_oauth_redirect',session={account_id:'owner',device_key_fingerprint:'device'};
 const oauth=createConnectorOAuth({pool,issuer,resource,clients:[{clientId:client_id,redirectUris:[redirect_uri]},
  {clientId:'other-client',redirectUris:[redirect_uri]}],now:()=>new Date(clock),checkOwnerEligible:async({client,accountId,deviceFingerprint})=>{
   const row=(await client.query(`SELECT 1 FROM accounts a JOIN account_devices d ON d.account_id=a.id
    WHERE a.id=$1 AND a.email_verified=TRUE AND d.device_key_fingerprint=$2 AND d.revoked_at IS NULL`,[accountId,deviceFingerprint])).rows[0];
   return Boolean(row);
  }});
 await oauth.initSchema();
 const verifier='v'.repeat(64),params={client_id,redirect_uri,response_type:'code',resource,scope:SCOPE,state:'client-csrf-state',
  code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')};
 async function code(){const flow=await oauth.beginAuthorization(params),r=await oauth.consent({flowId:flow.flowId,csrf:flow.csrf,session,confirm:true});
  const u=new URL(r.redirectUrl);assert.equal(u.searchParams.get('state'),params.state);assert.equal(u.searchParams.get('iss'),issuer);
  return u.searchParams.get('code');}
 const exchange=(codeValue,extra={})=>oauth.exchange({grant_type:'authorization_code',client_id,redirect_uri,resource,
  code:codeValue,code_verifier:verifier,...extra});
 return {pool,oauth,params,session,code,exchange,advance:ms=>{clock+=ms;},close:()=>pool.end()};
}
test('complete owner consent and PKCE exchange stores only credential hashes',async()=>{
 const f=await fixture();try{
  const code=await f.code(),token=await f.exchange(code);
  const principal=await f.oauth.resolvePrincipal({authorization:'Bearer '+token.access_token});assert.match(principal,/^oauth:[a-f0-9]{64}$/);
  const c=(await f.pool.query('SELECT * FROM sigillum_connector_oauth_codes')).rows[0];assert.equal(c.code_hash,hash(code));
  const t=(await f.pool.query('SELECT * FROM sigillum_connector_oauth_tokens')).rows[0];assert.equal(t.token_hash,hash(token.access_token));
  assert.equal(JSON.stringify(c).includes(code),false);assert.equal(JSON.stringify(t).includes(token.access_token),false);
  assert.equal(t.account_id,'owner');assert.equal(t.client_id,f.params.client_id);
  assert.equal(f.oauth.authorizationMetadata.code_challenge_methods_supported[0],'S256');
 }finally{await f.close();}
});
test('deny implicit consent, wrong browser CSRF, expired flow and reused consent',async()=>{
 const f=await fixture();try{
  const flow=await f.oauth.beginAuthorization(f.params),request={flowId:flow.flowId,csrf:flow.csrf,session:f.session,confirm:true};
  await assert.rejects(f.oauth.consent({...request,confirm:false}),/access_denied/);
  await assert.rejects(f.oauth.consent({...request,csrf:'wrong'}),/invalid_request/);
  await f.oauth.consent(request);await assert.rejects(f.oauth.consent(request),/invalid_request/);
  const expired=await f.oauth.beginAuthorization(f.params);f.advance(300001);
  await assert.rejects(f.oauth.consent({...request,flowId:expired.flowId,csrf:expired.csrf}),/invalid_request/);
 }finally{await f.close();}
});
test('reject alternate callback, audience, client, scope and PKCE downgrade',async()=>{
 const f=await fixture();try{
  for(const change of [{redirect_uri:'https://attacker.invalid/callback'},{resource:'https://attacker.invalid/mcp'},
   {client_id:'unknown'},{scope:'admin'},{code_challenge_method:'plain'}])await assert.rejects(f.oauth.beginAuthorization({...f.params,...change}));
  const code=await f.code();
  for(const change of [{code_verifier:'x'.repeat(64)},{client_id:'other-client'},{resource:'https://attacker.invalid/mcp'},
   {redirect_uri:'https://attacker.invalid/callback'},{grant_type:'client_credentials'},{client_secret:'shared'}])await assert.rejects(f.exchange(code,change));
  const token=await f.exchange(code);assert.equal(typeof await f.oauth.resolvePrincipal({authorization:'Bearer '+token.access_token}),'string');
 }finally{await f.close();}
});
test('authorization code replay revokes its issued token',async()=>{
 const f=await fixture();try{
  const code=await f.code(),token=await f.exchange(code);await assert.rejects(f.exchange(code),/invalid_grant/);
  await assert.rejects(f.oauth.resolvePrincipal({authorization:'Bearer '+token.access_token}),/MCP_AUTH_REJECTED/);
 }finally{await f.close();}
});
test('expired code, device revocation, token revocation and expiry fail closed',async()=>{
 const f=await fixture();try{
  const expired=await f.code();f.advance(60001);await assert.rejects(f.exchange(expired),/invalid_grant/);
  const token=await f.exchange(await f.code());
  await f.pool.query('UPDATE account_devices SET revoked_at=NOW()');
  await assert.rejects(f.oauth.resolvePrincipal({authorization:'Bearer '+token.access_token}),/MCP_AUTH_REJECTED/);
  await f.pool.query('UPDATE account_devices SET revoked_at=NULL');
  await f.oauth.revoke({client_id:f.params.client_id,token:token.access_token});
  await assert.rejects(f.oauth.resolvePrincipal({authorization:'Bearer '+token.access_token}),/MCP_AUTH_REJECTED/);
  const next=await f.exchange(await f.code());f.advance(1800001);
  await assert.rejects(f.oauth.resolvePrincipal({authorization:'Bearer '+next.access_token}),/MCP_AUTH_REJECTED/);
  await assert.rejects(f.oauth.resolvePrincipal({cookie:'owner-session'}),/MCP_AUTH_REJECTED/);
 }finally{await f.close();}
});
test('token table cannot bypass audience, scope or principal binding',async()=>{
 const f=await fixture();try{
  for(const [column,value] of [['resource','https://attacker.invalid'],['scope','admin'],['issuer','https://attacker.invalid'],['principal','intruder']]){
   const token=await f.exchange(await f.code());
   await f.pool.query('UPDATE sigillum_connector_oauth_tokens SET '+column+'=$1 WHERE token_hash=$2',[value,hash(token.access_token)]);
   await assert.rejects(f.oauth.resolvePrincipal({authorization:'Bearer '+token.access_token}),/MCP_AUTH_REJECTED/);
  }
 }finally{await f.close();}
});
test('persistent rate limit resets and OAuth initialization issues no tokens',async()=>{
 const f=await fixture();try{
  await f.oauth.enforceRate('client',2);await f.oauth.enforceRate('client',2);await assert.rejects(f.oauth.enforceRate('client',2),/RATE_LIMITED/);
  f.advance(60000);await f.oauth.enforceRate('client',2);
  assert.equal((await f.pool.query('SELECT COUNT(*)::int AS count FROM sigillum_connector_oauth_tokens')).rows[0].count,0);
 }finally{await f.close();}
});
