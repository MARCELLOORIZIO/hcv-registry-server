'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const SCOPE='sigillum:originals:read';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const secret=()=>crypto.randomBytes(32).toString('base64url');
const error=(code,statusCode=400)=>Object.assign(Error(code),{code,statusCode});
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
// Predefined PUBLIC OAuth clients. Configuration must contain the exact client
// and redirect shown by the OpenAI connection management page. No wildcards,
// automatic DCR, arbitrary URL fetching, shared admin tokens or owner cookies.
function createConnectorOAuth({pool,issuer,resource,clients,checkOwnerEligible,now=()=>new Date()}){
 const base=new URL(issuer),audience=new URL(resource);
 if(base.protocol!=='https:'||base.origin!==issuer||audience.origin!==issuer||audience.search||audience.hash||
    audience.href!==resource||!pool?.connect||!pool?.query||typeof checkOwnerEligible!=='function'||
    !Array.isArray(clients)||!clients.length)throw error('OAUTH_CONFIGURATION_INVALID');
 const allowlist=new Map();
 for(const config of clients){
  if(!config||typeof config.clientId!=='string'||!config.clientId||config.clientId.length>512||
     allowlist.has(config.clientId)||!Array.isArray(config.redirectUris)||!config.redirectUris.length)
   throw error('OAUTH_CLIENT_CONFIGURATION_INVALID');
  for(const value of config.redirectUris){
   const u=new URL(value);
   if(u.protocol!=='https:'||u.username||u.password||u.hash||u.href!==value)
    throw error('OAUTH_REDIRECT_CONFIGURATION_INVALID');
  }
  allowlist.set(config.clientId,new Set(config.redirectUris));
 }
 const principalFor=(accountId,clientId)=>'oauth:'+hash(issuer+'|'+clientId+'|'+accountId);
 const validDate=value=>Number.isFinite(new Date(value).getTime())&&new Date(value).getTime()>now().getTime();
 const requireClient=(clientId,redirectUri)=>{
  const client=allowlist.get(clientId);
  if(!client||redirectUri!==undefined&&!client.has(redirectUri))throw error('invalid_client');
 };
 async function transaction(action){
  const client=await pool.connect();
  try{await client.query('BEGIN');const result=await action(client);await client.query('COMMIT');return result;}
  catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 }
 const initSchema=()=>pool.query(fs.readFileSync(path.join(__dirname,'migrations/20261012_sigillum_connector_oauth.sql'),'utf8'));
 const resourceMetadata={resource,authorization_servers:[issuer],scopes_supported:[SCOPE],bearer_methods_supported:['header']};
 const authorizationMetadata={issuer,authorization_endpoint:issuer+'/connector/oauth/authorize',token_endpoint:issuer+'/connector/oauth/token',
  revocation_endpoint:issuer+'/connector/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code'],
  token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:[SCOPE],
  authorization_response_iss_parameter_supported:true};
 async function beginAuthorization(params){
  if(typeof params.redirect_uri!=='string')throw error('invalid_request');
  requireClient(params.client_id,params.redirect_uri);
  if(params.response_type!=='code'||params.resource!==resource||params.scope!==SCOPE||params.code_challenge_method!=='S256'||
     !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge||'')||typeof params.state!=='string'||!params.state||params.state.length>1024)
   throw error('invalid_request');
  const flowId=crypto.randomBytes(16).toString('hex'),csrf=secret(),expiresAt=new Date(now().getTime()+300000);
  await pool.query(`INSERT INTO sigillum_connector_oauth_flows
   (flow_id,csrf_hash,client_id,redirect_uri,resource,scope,client_state,code_challenge,expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
   [flowId,hash(csrf),params.client_id,params.redirect_uri,resource,SCOPE,params.state,params.code_challenge,expiresAt]);
  return {flowId,csrf,clientId:params.client_id,scope:SCOPE,expiresAt:expiresAt.toISOString()};
 }
 async function consent({flowId,csrf,session,confirm}){
  if(!/^[a-f0-9]{32}$/.test(flowId||'')||typeof csrf!=='string'||!session?.account_id||!session?.device_key_fingerprint||confirm!==true)
   throw error('access_denied',403);
  return transaction(async client=>{
   const flow=(await client.query('SELECT * FROM sigillum_connector_oauth_flows WHERE flow_id=$1 FOR UPDATE',[flowId])).rows[0];
   if(!flow||flow.consumed_at||!validDate(flow.expires_at)||!same(flow.csrf_hash,hash(csrf))||flow.resource!==resource||flow.scope!==SCOPE)
    throw error('invalid_request');
   requireClient(flow.client_id,flow.redirect_uri);
   if(!await checkOwnerEligible({client,accountId:session.account_id,deviceFingerprint:session.device_key_fingerprint}))
    throw error('access_denied',403);
   const code=secret();
   await client.query(`INSERT INTO sigillum_connector_oauth_codes
    (code_hash,client_id,redirect_uri,resource,scope,code_challenge,account_id,device_fingerprint,principal,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [hash(code),flow.client_id,flow.redirect_uri,flow.resource,flow.scope,flow.code_challenge,session.account_id,
     session.device_key_fingerprint,principalFor(session.account_id,flow.client_id),new Date(now().getTime()+60000)]);
   await client.query('UPDATE sigillum_connector_oauth_flows SET consumed_at=$2 WHERE flow_id=$1',[flowId,now()]);
   const redirect=new URL(flow.redirect_uri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',flow.client_state);
   redirect.searchParams.set('iss',issuer);
   return {redirectUrl:redirect.href};
  });
 }
 async function exchange(params){
  requireClient(params.client_id,params.redirect_uri);
  if(params.grant_type!=='authorization_code'||params.resource!==resource||params.client_secret!==undefined||
     !/^[A-Za-z0-9_-]{43}$/.test(params.code||'')||!/^[A-Za-z0-9._~-]{43,128}$/.test(params.code_verifier||''))
   throw error('invalid_grant');
  const result=await transaction(async client=>{
   const row=(await client.query('SELECT * FROM sigillum_connector_oauth_codes WHERE code_hash=$1 FOR UPDATE',[hash(params.code)])).rows[0];
   if(!row||row.client_id!==params.client_id||row.redirect_uri!==params.redirect_uri||row.resource!==resource||row.scope!==SCOPE||
      !same(row.code_challenge,crypto.createHash('sha256').update(params.code_verifier).digest('base64url')))
    throw error('invalid_grant');
   // Valid verifier replay invalidates the originally issued access token.
   // Wrong clients/verifiers cannot revoke someone else's connection.
   if(row.consumed_at){
    await client.query('UPDATE sigillum_connector_oauth_tokens SET revoked_at=$2 WHERE source_code_hash=$1',[row.code_hash,now()]);
    return null;
   }
   if(!validDate(row.expires_at)||!await checkOwnerEligible({client,accountId:row.account_id,deviceFingerprint:row.device_fingerprint}))
    throw error('invalid_grant');
   const token=secret();
   await client.query(`INSERT INTO sigillum_connector_oauth_tokens
    (token_hash,source_code_hash,client_id,account_id,device_fingerprint,principal,issuer,resource,scope,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[hash(token),row.code_hash,row.client_id,row.account_id,row.device_fingerprint,
     row.principal,issuer,resource,SCOPE,new Date(now().getTime()+1800000)]);
   await client.query('UPDATE sigillum_connector_oauth_codes SET consumed_at=$2 WHERE code_hash=$1',[row.code_hash,now()]);
   return {access_token:token,token_type:'Bearer',expires_in:1800,scope:SCOPE};
  });
  if(!result)throw error('invalid_grant');return result;
 }
 async function resolvePrincipal(channel){
  const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(channel?.authorization||''));
  if(!match)throw error('MCP_AUTH_REJECTED',401);
  const row=(await pool.query('SELECT * FROM sigillum_connector_oauth_tokens WHERE token_hash=$1',[hash(match[1])])).rows[0];
  if(!row||row.revoked_at||!validDate(row.expires_at)||row.issuer!==issuer||row.resource!==resource||row.scope!==SCOPE||
     !allowlist.has(row.client_id)||row.principal!==principalFor(row.account_id,row.client_id)||
     !await checkOwnerEligible({client:pool,accountId:row.account_id,deviceFingerprint:row.device_fingerprint}))
   throw error('MCP_AUTH_REJECTED',401);
  return row.principal;
 }
 async function revoke({client_id,token}){
  requireClient(client_id);
  if(typeof token!=='string'||token.length>256)throw error('invalid_request');
  await pool.query('UPDATE sigillum_connector_oauth_tokens SET revoked_at=$3 WHERE token_hash=$1 AND client_id=$2',[hash(token),client_id,now()]);
 }
 async function enforceRate(key,maximum=60){
  const cutoff=new Date(now().getTime()-60000);
  const row=(await pool.query(`INSERT INTO sigillum_connector_http_rates(key_hash,window_started_at,request_count)
   VALUES($1,$2,1) ON CONFLICT(key_hash) DO UPDATE SET
   window_started_at=CASE WHEN sigillum_connector_http_rates.window_started_at<=$3 THEN $2 ELSE sigillum_connector_http_rates.window_started_at END,
   request_count=CASE WHEN sigillum_connector_http_rates.window_started_at<=$3 THEN 1 ELSE sigillum_connector_http_rates.request_count+1 END
   RETURNING request_count`,[hash(key),now(),cutoff])).rows[0];
  if(row.request_count>maximum)throw error('RATE_LIMITED',429);
 }
 return {initSchema,beginAuthorization,consent,exchange,resolvePrincipal,revoke,enforceRate,resourceMetadata,authorizationMetadata,
  issuer,resource,scope:SCOPE};
}
module.exports={createConnectorOAuth,SCOPE};
