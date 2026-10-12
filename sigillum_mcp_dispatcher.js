'use strict';
// Minimal MCP tool dispatcher. This module is deliberately transport-independent:
// an authenticated connector host must supply an already verified principal and
// a grant reader. No owner password, browser cookie or R2 secret is accepted.
const {createSigillumConnectorBridge}=require('./sigillum_connector_bridge');
const TOOL='sigillum_read_approved_original';
const definitions=[{name:TOOL,description:'Read one explicitly owner-approved SIGILLUM original from an unexpired, one-time, principal-bound audit grant.',inputSchema:{type:'object',additionalProperties:false,required:['grantId','hcvId'],properties:{grantId:{type:'string',pattern:'^[a-f0-9]{32}$'},hcvId:{type:'string',pattern:'^HCV-[A-F0-9]{16}$'}}}}];
function createSigillumMcpDispatcher({resolvePrincipal,...adapters}){
 if(typeof resolvePrincipal!=='function')throw new TypeError('AUTHENTICATED_PRINCIPAL_REQUIRED');
 const bridge=createSigillumConnectorBridge(adapters);
 return async function dispatch(message,channel){
  if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string') return {jsonrpc:'2.0',id:message?.id??null,error:{code:-32600,message:'Invalid Request'}};
  const id=message.id;
  if(message.method==='notifications/initialized')return null;
  if(message.method==='initialize')return {jsonrpc:'2.0',id,result:{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'sigillum-read-only',version:'0.1.0'}}};
  if(message.method==='tools/list')return {jsonrpc:'2.0',id,result:{tools:definitions}};
  if(message.method!=='tools/call')return {jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}};
  if(message.params?.name!==TOOL)return {jsonrpc:'2.0',id,error:{code:-32602,message:'Unknown tool'}};
  try{
   const principal=await resolvePrincipal(channel);
   if(typeof principal!=='string'||!principal)throw Error('CONNECTOR_AUTH_REQUIRED');
   const args=message.params.arguments||{};
   const result=await bridge.readOriginal({connectorPrincipal:principal,grantId:args.grantId,hcvId:args.hcvId});
   // MCP image items support PNG/JPEG. Video needs a separately negotiated,
   // authenticated resource transport, not inline text/base64.
   if(!['image/png','image/jpeg'].includes(result.contentType))throw Error('CONNECTOR_VIDEO_RESOURCE_TRANSPORT_REQUIRED');
   return {jsonrpc:'2.0',id,result:{content:[{type:'image',mimeType:result.contentType,data:Buffer.from(result.bytes).toString('base64')},{type:'text',text:'Owner-approved SIGILLUM original: '+args.hcvId}],isError:false}};
  }catch(error){
   return {jsonrpc:'2.0',id,result:{content:[{type:'text',text: String(error.code||error.message||'AUDIT_FAILED')}],isError:true}};
  }
 };
}
module.exports={createSigillumMcpDispatcher,TOOL};
