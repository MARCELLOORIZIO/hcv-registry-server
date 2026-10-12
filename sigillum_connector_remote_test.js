'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {memoryPool}=require('./tool/audit_test_database');
const {connectorTlsFixture}=require('./tool/connector_tls_fixture');
const {createConnectorOAuth,SCOPE}=require('./sigillum_connector_oauth');
const {createConnectorRemoteHandler}=require('./sigillum_connector_remote');
const {createSigillumMcpDispatcher}=require('./sigillum_mcp_dispatcher');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');

test('real HTTPS OAuth endpoints and official MCP client enforce auth, origin and exact bytes',async()=>{
 const pool=await memoryPool();let handler,reads=0,granted=false,revokeDuringRead=false;
 const tls=await connectorTlsFixture(async(req,res)=>{
  try{if(!await handler(req,res,new URL(req.url,tls.origin))){res.writeHead(404);res.end();}}
  catch(_){res.writeHead(500);res.end();}
 });
 const client=new Client({name:'synthetic-acceptance-client',version:'1.0'});
 try{
  await pool.query("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('synthetic-owner');");
  const clientId='synthetic-openai',redirect='https://chatgpt.com/connector_platform_oauth_redirect';
  let ownerValid=true;
  const oauth=createConnectorOAuth({pool,issuer:tls.origin,resource:tls.origin+'/connector/mcp',
   clients:[{clientId,redirectUris:[redirect]}],checkOwnerEligible:async()=>ownerValid});
  await oauth.initSchema();
  const bytes=Buffer.from(require('./tool/delegated_audit_fixture_images.json')['HCV-D8FF76496D424CA5'],'base64');
  const grantId='a'.repeat(32),hcvId='HCV-0000000000000051';
  handler=createConnectorRemoteHandler({oauth,isTrustedTransport:req=>req.socket.encrypted===true,
   authenticateOwner:async req=>{assert.equal(req.headers.authorization,'Bearer synthetic-owner-session');return {account_id:'synthetic-owner',device_key_fingerprint:'device'};},
   createDispatch:({resolvePrincipal})=>createSigillumMcpDispatcher({resolvePrincipal,
    getAuthorizedGrant:async({connectorPrincipal})=>granted?{state:'APPROVED',connectorPrincipal,hcvIds:[hcvId],expiresAtMs:Date.now()+60000}:null,
    recordEvent:async()=>{},readApprovedReference:async()=>{reads++;if(revokeDuringRead)ownerValid=false;return {bytes:new Uint8Array(bytes),contentType:'image/png'};},
    requestAudit:async()=>({requestId:grantId,state:'PENDING'})
   })});
  const request=(p,options={})=>tls.fetch(tls.origin+p,options);
  const mcp={method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}})};
  let response=await request('/connector/mcp',mcp);assert.equal(response.status,401);assert.match(response.headers.get('www-authenticate'),/resource_metadata=/);
  assert.equal((await (await request('/.well-known/oauth-protected-resource/connector/mcp')).json()).resource,oauth.resource);
  const metadata=await (await request('/.well-known/oauth-authorization-server')).json();assert.equal(metadata.issuer,tls.origin);assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);
  const verifier='v'.repeat(64),params=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',resource:oauth.resource,
   scope:SCOPE,state:'test-state',code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url')});
  response=await request('/connector/oauth/authorize?'+params);assert.equal(response.status,200);
  const html=await response.text(),cookie=response.headers.get('set-cookie').split(';')[0],flowId=/const flowId="([a-f0-9]{32})"/.exec(html)[1];
  assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Secure/);
  new Function(html.match(/<script[^>]*>([\s\S]*)<\/script>/)[1]);
  assert.match(html,/approvazione separata/);assert.equal(html.includes('localStorage'),false);
  const consent={method:'POST',headers:{'Content-Type':'application/json',Origin:tls.origin,Cookie:cookie,Authorization:'Bearer synthetic-owner-session'},
   body:JSON.stringify({flowId,confirm:true})};
  response=await request('/connector/oauth/consent',{...consent,headers:{...consent.headers,Origin:'https://attacker.invalid'}});assert.equal(response.status,403);
  response=await request('/connector/oauth/consent',{...consent,headers:{...consent.headers,Cookie:''}});assert.equal(response.status,400);
  response=await request('/connector/oauth/consent',consent);assert.equal(response.status,200);
  const callback=new URL((await response.json()).redirectUrl);assert.equal(callback.searchParams.get('state'),'test-state');assert.equal(callback.searchParams.get('iss'),tls.origin);
  const tokenParams=new URLSearchParams({grant_type:'authorization_code',client_id:clientId,redirect_uri:redirect,resource:oauth.resource,
   code:callback.searchParams.get('code'),code_verifier:verifier});
  response=await request('/connector/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:tokenParams});assert.equal(response.status,200);
  const issued=await response.json();
  const transport=new StreamableHTTPClientTransport(new URL(oauth.resource),{fetch:tls.fetch,requestInit:{headers:{Authorization:'Bearer '+issued.access_token}}});
  await client.connect(transport);
  const list=await client.listTools();assert.equal(list.tools.length,2);assert.equal(list.tools[0]._meta.securitySchemes[0].type,'oauth2');
  const call=()=>client.callTool({name:'sigillum_read_approved_original',arguments:{grantId,hcvId}});
  assert.equal((await call()).isError,true);assert.equal(reads,0); // OAuth alone grants no original.
  granted=true;const result=await call();assert.equal(result.isError,false);assert.deepEqual(Buffer.from(result.content[0].data,'base64'),bytes);
  response=await request('/connector/mcp',{...mcp,headers:{...mcp.headers,Authorization:'Bearer '+issued.access_token,Origin:'https://attacker.invalid'}});assert.equal(response.status,403);
  response=await tls.request('/connector/mcp',{...mcp,headers:{...mcp.headers,Authorization:'Bearer '+issued.access_token,Host:'attacker.invalid'}});assert.equal(response.status,403);
  const extraArgs=await client.callTool({name:'sigillum_read_approved_original',arguments:{grantId,hcvId,connectorPrincipal:'intruder'}});assert.equal(extraArgs.isError,true);
  response=await request('/connector/mcp',{...mcp,headers:{...mcp.headers,Authorization:'Bearer '+issued.access_token},body:' '.repeat(16385)});assert.equal(response.status,413);
  response=await request('/connector/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'client_id=a&client_id=b'});assert.equal(response.status,400);
  revokeDuringRead=true;const withheld=await call();assert.equal(withheld.isError,true);
  assert.equal(withheld.content.some(x=>x.type==='image'),false);assert(withheld._meta['mcp/www_authenticate']);
  response=await request('/connector/mcp',{...mcp,headers:{...mcp.headers,Authorization:'Bearer '+issued.access_token}});assert.equal(response.status,401);
  assert.equal(reads,2);
 }finally{await client.close();await tls.close();await pool.end();}
});
