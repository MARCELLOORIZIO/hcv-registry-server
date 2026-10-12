'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSigillumMcpDispatcher,TOOL}=require('./sigillum_mcp_dispatcher');
const ID='HCV-D8FF76496D424CA5',grantId='0123456789abcdef0123456789abcdef',principal='auditor-1';
function setup(grantOverrides={},principalValue=principal){
 let reads=0;
 const dispatch=createSigillumMcpDispatcher({
  resolvePrincipal:async()=>principalValue,
  now:()=>100,
  getAuthorizedGrant:async()=>({state:'APPROVED',connectorPrincipal:principal,hcvIds:[ID],expiresAtMs:500,revoked:false,reads:[],...grantOverrides}),
  recordEvent:async()=>{},
  readApprovedReference:async()=>{reads++;return {bytes:new Uint8Array([137,80,78,71]),contentType:'image/png'};}
 });
 const call=(args={grantId,hcvId:ID})=>dispatch({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:TOOL,arguments:args}},{});
 return {dispatch,call,reads:()=>reads};
}
test('reports read-only image tool',async()=>{const s=setup();const r=await s.dispatch({jsonrpc:'2.0',id:1,method:'tools/list'},{});assert.equal(r.result.tools[0].name,TOOL);});
test('returns MCP image only for approved scope',async()=>{const s=setup();const r=await s.call();assert.equal(r.result.isError,false);assert.equal(r.result.content[0].type,'image');assert.equal(r.result.content[0].data,Buffer.from([137,80,78,71]).toString('base64'));assert.equal(s.reads(),1);});
for(const [label,grant,p] of [['unapproved',{state:'PENDING'},principal],['revoked',{revoked:true},principal],['expired',{expiresAtMs:99},principal],['other caller',{},'intruder']]){
 test('fail closed: '+label,async()=>{const s=setup(grant,p),r=await s.call();assert.equal(r.result.isError,true);assert.equal(s.reads(),0);});
}
