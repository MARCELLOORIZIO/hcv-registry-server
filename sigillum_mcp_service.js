'use strict';
const {createSigillumMcpDispatcher}=require('./sigillum_mcp_dispatcher');
const {createConnectorGrantAdapter}=require('./sigillum_connector_grant_adapter');
const {captureVerifiedR2Image}=require('./sigillum_connector_r2_capture');

// Composition for a separately authenticated MCP host. The host MUST provide
// resolvePrincipal(channel) from verified auth middleware, never tool arguments.
// Reuses activeR2Reference and streamR2Reference unchanged. This module
// deliberately does not expose an unauthenticated HTTP endpoint.
function createSigillumMcpService({pool,resolvePrincipal,activeR2Reference,
 streamR2Reference,checkReferenceEligible,requestAudit,now=()=>new Date()}){
 if(typeof resolvePrincipal!=='function'||typeof activeR2Reference!=='function'||
    typeof streamR2Reference!=='function'||typeof checkReferenceEligible!=='function')
   throw new TypeError('CONNECTOR_HOST_DEPENDENCIES_REQUIRED');
 const adapter=createConnectorGrantAdapter({
   pool,now,checkReferenceEligible,
   loadOriginal:async({hcvId,ownerAccountId})=>{
     const reference=await activeR2Reference(hcvId);
     if(!reference||!reference.providerReceipt||
        reference.providerReceipt.mediaType!=='photo')
       throw Error('CONNECTOR_PHOTO_REFERENCE_UNAVAILABLE');
     return captureVerifiedR2Image({
       streamReference:streamR2Reference,reference,hcvId,
     });
   },
 });
 return createSigillumMcpDispatcher({resolvePrincipal,...adapter,requestAudit,now:()=>now().getTime()});
}
module.exports={createSigillumMcpService};
