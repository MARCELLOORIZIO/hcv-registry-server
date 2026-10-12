'use strict';
const crypto=require('node:crypto');
// Fail-closed bearer authenticator for a separately hosted MCP transport.
// Requires a verified token-to-principal binding configured by the host.
// Do not reuse an owner's SIGILLUM session or Safari audit cookie.
function createMcpPrincipalVerifier({lookupTokenHash,now=()=>Date.now()}){
 if(typeof lookupTokenHash!=='function')throw new TypeError('MCP_TOKEN_LOOKUP_REQUIRED');
 return async function resolvePrincipal(channel){
   const header=String(channel?.authorization||'');
   const match=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header);
   if(!match)throw Error('MCP_AUTH_REQUIRED');
   const tokenHash=crypto.createHash('sha256').update(match[1]).digest('hex');
   const claim=await lookupTokenHash(tokenHash);
   if(!claim||claim.revoked||typeof claim.principal!=='string'||!claim.principal||
      !Number.isFinite(claim.expiresAtMs)||claim.expiresAtMs<=now())
      throw Error('MCP_AUTH_REJECTED');
   return claim.principal;
 };
}
module.exports={createMcpPrincipalVerifier};
