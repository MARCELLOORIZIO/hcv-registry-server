'use strict';
// Startup remains inert unless an operator explicitly configures and activates
// the experimental connector. Never infer OAuth callbacks or trust any proxy
// merely because an HTTP request supplies X-Forwarded-Proto.
function createConnectorRuntime({verifiedOriginals,env=process.env}){
 if(env.SIGILLUM_CONNECTOR_ENABLED!=='true')return {enabled:false,initSchema:async()=>{},handle:async()=>false};
 let clients;try{clients=JSON.parse(env.SIGILLUM_CONNECTOR_OAUTH_CLIENTS_JSON||'');}catch(_){throw Error('CONNECTOR_CLIENT_CONFIG_REQUIRED');}
 const issuer=String(env.SIGILLUM_DELEGATED_AUDIT_ORIGIN||''),url=new URL(issuer);
 if(url.origin!==issuer||url.protocol!=='https:')throw Error('CONNECTOR_HTTPS_ORIGIN_REQUIRED');
 const mode=String(env.SIGILLUM_CONNECTOR_TLS_MODE||'');
 if(!['NATIVE_TLS','RENDER_EDGE'].includes(mode))throw Error('CONNECTOR_TLS_POLICY_REQUIRED');
 if(mode==='RENDER_EDGE'&&(env.RENDER!=='true'||env.RENDER_EXTERNAL_HOSTNAME!==url.host||!env.RENDER_SERVICE_ID))
  throw Error('CONNECTOR_RENDER_EDGE_CONFIG_INVALID');
 const isTrustedTransport=req=>req.socket?.encrypted===true||mode==='RENDER_EDGE'&&
  req.headers.host===env.RENDER_EXTERNAL_HOSTNAME&&req.headers['x-forwarded-proto']==='https';
 const host=verifiedOriginals.createConnectorRemoteHost({issuer,resource:issuer+'/connector/mcp',clients,isTrustedTransport});
 return {enabled:true,initSchema:host.initSchema,handle:host.handle};
}
module.exports={createConnectorRuntime};
