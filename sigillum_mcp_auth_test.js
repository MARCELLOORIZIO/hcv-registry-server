'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createMcpPrincipalVerifier}=require('./sigillum_mcp_auth');
const token='x'.repeat(48),digest=crypto.createHash('sha256').update(token).digest('hex');
function verifier(overrides={}){
 return createMcpPrincipalVerifier({now:()=>100,lookupTokenHash:async h=>h===digest?{principal:'sigillum-chatgpt',expiresAtMs:1000,revoked:false,...overrides}:null});
}
test('accept valid independently issued credential',async()=>{
 assert.equal(await verifier()({authorization:'Bearer '+token}),'sigillum-chatgpt');
});
test('do not accept safari cookie or owner session instead',async()=>{
 await assert.rejects(verifier()({cookie:'__Host-sigillum-audit=test'}),/MCP_AUTH_REQUIRED/);
});
for(const [title,options] of [['expired',{expiresAtMs:99}],['revoked',{revoked:true}],['missing identity',{principal:''}]]){
 test('reject '+title,async()=>assert.rejects(verifier(options)({authorization:'Bearer '+token}),/MCP_AUTH_REJECTED/));
}
test('reject unrecognized token',async()=>assert.rejects(verifier()({authorization:'Bearer '+ 'y'.repeat(48)}),/MCP_AUTH_REJECTED/));
