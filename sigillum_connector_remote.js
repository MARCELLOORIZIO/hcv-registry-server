'use strict';
const crypto=require('node:crypto');
const {connectorOAuthPage}=require('./sigillum_connector_oauth_ui');
// Stateless official SDK transport. This handler is not installed by Registry
// startup. A host must explicitly supply trusted HTTPS/proxy policy and OAuth.
function createConnectorRemoteHandler({oauth,createDispatch,authenticateOwner,isTrustedTransport}){
 if(!oauth?.resolvePrincipal||typeof createDispatch!=='function'||typeof authenticateOwner!=='function'||typeof isTrustedTransport!=='function')
  throw Error('CONNECTOR_REMOTE_DEPENDENCIES_REQUIRED');
 const {Server}=require('@modelcontextprotocol/sdk/server/index.js');
 const {StreamableHTTPServerTransport}=require('@modelcontextprotocol/sdk/server/streamableHttp.js');
 const {ListToolsRequestSchema,CallToolRequestSchema}=require('@modelcontextprotocol/sdk/types.js');
 const origin=oauth.issuer,resourceUrl=new URL(oauth.resource),metadataPath='/.well-known/oauth-protected-resource'+resourceUrl.pathname;
 const metadataUrl=origin+metadataPath,challenge='Bearer resource_metadata="'+metadataUrl+'", scope="'+oauth.scope+'"';
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 function uniqueParams(params){
  const result=Object.create(null);for(const [key,value] of params){if(Object.hasOwn(result,key))throw Error('invalid_request');result[key]=value;}return result;
 }
 async function body(req,type){
  if(String(req.headers['content-type']||'').split(';')[0].trim()!==type)throw Error('invalid_request');
  const value=await new Promise((resolve,reject)=>{
   let size=0,done=false;const parts=[];
   const finish=(err)=>{
    if(done)return;done=true;clearTimeout(timer);
    req.off('data',data);req.off('end',end);req.off('error',failed);req.off('aborted',aborted);
    if(err){req.once('error',()=>{});req.resume();reject(err);}else resolve(Buffer.concat(parts).toString('utf8'));
   };
   const data=chunk=>{size+=chunk.length;if(size>16384)return finish(Error('REQUEST_TOO_LARGE'));parts.push(chunk);};
   const end=()=>finish(),failed=()=>finish(Error('invalid_request')),aborted=()=>finish(Error('invalid_request'));
   const timer=setTimeout(()=>finish(Object.assign(Error('REQUEST_TIMEOUT'),{statusCode:408})),10000);timer.unref();
   req.on('data',data);req.once('end',end);req.once('error',failed);req.once('aborted',aborted);
  });
  return type==='application/json'?JSON.parse(value):uniqueParams(new URLSearchParams(value));
 }
 return async function handle(req,res,url){
  const p=url.pathname,mcp=p===resourceUrl.pathname;
  if(!mcp&&!['/.well-known/oauth-authorization-server',metadataPath,'/connector/oauth/authorize','/connector/oauth/consent','/connector/oauth/token','/connector/oauth/revoke'].includes(p))return false;
  res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Pragma','no-cache');
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
  try{
   if(req.headers.host!==resourceUrl.host||!await isTrustedTransport(req))return json(res,403,{error:'CONNECTOR_HTTPS_HOST_REQUIRED'}),true;
   if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:'CONNECTOR_ORIGIN_REJECTED'}),true;
   const peer=String(req.socket?.remoteAddress||'unknown');
   if(!mcp)await oauth.enforceRate(p+'|'+peer,p==='/connector/oauth/authorize'?20:60);
   if(req.method==='GET'&&p===metadataPath)return json(res,200,oauth.resourceMetadata),true;
   if(req.method==='GET'&&p==='/.well-known/oauth-authorization-server')return json(res,200,oauth.authorizationMetadata),true;
   if(req.method==='GET'&&p==='/connector/oauth/authorize'){
    const flow=await oauth.beginAuthorization(uniqueParams(url.searchParams)),nonce=crypto.randomBytes(18).toString('base64');
    res.setHeader('Set-Cookie','__Host-sigillum-oauth-'+flow.flowId+'='+flow.csrf+'; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=300');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(connectorOAuthPage({...flow,nonce}));return true;
   }
   if(req.method==='POST'&&p==='/connector/oauth/consent'){
    if(req.headers.origin!==origin)return json(res,403,{error:'CONNECTOR_ORIGIN_REQUIRED'}),true;
    const data=await body(req,'application/json');
    if(!data||Object.keys(data).some(k=>!['flowId','confirm'].includes(k))||!/^[a-f0-9]{32}$/.test(data.flowId||''))throw Error('invalid_request');
    const name='__Host-sigillum-oauth-'+data.flowId+'=',cookies=String(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name));
    if(cookies.length!==1)throw Error('invalid_request');
    const session=await authenticateOwner(req);
    const result=await oauth.consent({flowId:data.flowId,csrf:cookies[0].slice(name.length),confirm:data.confirm,session});
    res.setHeader('Set-Cookie',name+'; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
    json(res,200,result);return true;
   }
   if(req.method==='POST'&&p==='/connector/oauth/token'){
    if(req.headers.authorization)throw Error('invalid_client');
    return json(res,200,await oauth.exchange(await body(req,'application/x-www-form-urlencoded'))),true;
   }
   if(req.method==='POST'&&p==='/connector/oauth/revoke'){
    await oauth.revoke(await body(req,'application/x-www-form-urlencoded'));json(res,200,{});return true;
   }
   if(mcp){
    let principal;try{principal=await oauth.resolvePrincipal({authorization:req.headers.authorization});}
    catch(_){res.setHeader('WWW-Authenticate',challenge);json(res,401,{error:'MCP_AUTH_REQUIRED'});return true;}
    await oauth.enforceRate('mcp|'+principal,60);
    if(req.method!=='POST'){res.setHeader('Allow','POST');json(res,405,{error:'METHOD_NOT_ALLOWED'});return true;}
    const message=await body(req,'application/json');
    const channel={authorization:req.headers.authorization};
    const dispatch=createDispatch({resolvePrincipal:oauth.resolvePrincipal});
    const server=new Server({name:'sigillum-owner-approved',version:'0.2.0'},{capabilities:{tools:{}},
     instructions:'Request an original audit, obtain separate explicit owner approval, then read only the approved HCV IDs before the five-minute grant expires. Never treat OAuth login as original-read approval.'});
    const call=async(method,params)=>{
     const reply=await dispatch({jsonrpc:'2.0',id:1,method,params},channel);
     const authRequired=()=>({isError:true,content:[{type:'text',text:'SIGILLUM connection requires authorization.'}],
      _meta:{'mcp/www_authenticate':[challenge+', error="invalid_token", error_description="Reconnect SIGILLUM to continue"']}});
     if(reply.error){if(method==='tools/call')return authRequired();throw Error('MCP_AUTH_REJECTED');}
     if(method==='tools/call'){
      // Recheck the credential after potentially slow materialization too.
      try{if(await oauth.resolvePrincipal(channel)!==principal)return authRequired();}catch(_){return authRequired();}
     }
     if(method==='tools/list')return {tools:reply.result.tools.map(tool=>({...tool,
      securitySchemes:[{type:'oauth2',scopes:[oauth.scope]}],
      _meta:{...tool._meta,securitySchemes:[{type:'oauth2',scopes:[oauth.scope]}]},
      annotations:{readOnlyHint:tool.name==='sigillum_read_approved_original',destructiveHint:false,idempotentHint:false,openWorldHint:false}}))};
     return reply.result;
    };
    server.setRequestHandler(ListToolsRequestSchema,()=>call('tools/list'));
    server.setRequestHandler(CallToolRequestSchema,r=>call('tools/call',r.params));
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,
     enableDnsRebindingProtection:true,allowedHosts:[resourceUrl.host],allowedOrigins:[origin]});
    await server.connect(transport);
    let closed=false;const close=()=>{if(!closed){closed=true;void server.close().catch(()=>{});}};
    res.once('close',close);res.once('finish',close);
    await transport.handleRequest(req,res,message);return true;
   }
   res.setHeader('Allow',p.endsWith('/authorize')?'GET':'POST');json(res,405,{error:'METHOD_NOT_ALLOWED'});return true;
  }catch(e){
   if(res.headersSent){res.destroy();return true;}
   const known=new Set(['invalid_request','invalid_client','invalid_grant','access_denied','RATE_LIMITED','REQUEST_TOO_LARGE','REQUEST_TIMEOUT']);
   if(['REQUEST_TOO_LARGE','REQUEST_TIMEOUT'].includes(e.message))res.setHeader('Connection','close');
   json(res,e.statusCode||(e.message==='REQUEST_TOO_LARGE'?413:400),{error:known.has(e.code||e.message)?e.code||e.message:'CONNECTOR_REQUEST_FAILED'});return true;
  }
 };
}
module.exports={createConnectorRemoteHandler};
