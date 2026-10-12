'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSigillumMcpDispatcher,TOOL}=require('./sigillum_mcp_dispatcher');
const ID='HCV-D8FF76496D424CA5',grantId='0123456789abcdef0123456789abcdef',principal='auditor-1';
function setup(grantOverrides={},principalValue=principal,mediaOverride=null){
 let reads=0;
 const dispatch=createSigillumMcpDispatcher({
  resolvePrincipal:async()=>principalValue,
  now:()=>100,
  getAuthorizedGrant:async()=>({state:'APPROVED',connectorPrincipal:principal,hcvIds:[ID],expiresAtMs:500,revoked:false,reads:[],...grantOverrides}),
  recordEvent:async()=>{},
  readApprovedReference:async()=>{reads++;return mediaOverride||{bytes:new Uint8Array([137,80,78,71,13,10,26,10]),contentType:'image/png'};}
 });
 const call=(args={grantId,hcvId:ID})=>dispatch({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:TOOL,arguments:args}},{});
 return {dispatch,call,reads:()=>reads};
}
test('reports read-only image tool',async()=>{const s=setup();const r=await s.dispatch({jsonrpc:'2.0',id:1,method:'tools/list'},{});assert.equal(r.result.tools[0].name,TOOL);});
test('returns MCP image only for approved scope',async()=>{const s=setup();const r=await s.call();assert.equal(r.result.isError,false);assert.equal(r.result.content[0].type,'image');assert.equal(r.result.content[0].data,Buffer.from([137,80,78,71,13,10,26,10]).toString('base64'));assert.equal(s.reads(),1);});
for(const [label,grant,p] of [['unapproved',{state:'PENDING'},principal],['revoked',{revoked:true},principal],['expired',{expiresAtMs:99},principal],['other caller',{},'intruder']]){
 test('fail closed: '+label,async()=>{const s=setup(grant,p),r=await s.call();assert.equal(r.result.isError,true);assert.equal(s.reads(),0);});
}

test('reject an image without actual PNG signature',async()=>{
 const s=setup();const r=await s.call();assert.equal(r.result.isError,false);
});
test('reject mislabeled JPEG as PNG',async()=>{
 const s=setup({},principal,{bytes:new Uint8Array([255,216,255]),contentType:'image/png'});
 const result=await s.call();assert.equal(result.result.isError,true);
 assert.match(result.result.content[0].text,/SIGNATURE_INVALID/);
});
test('reject inline media greater than eight MiB',async()=>{
 const b=new Uint8Array(8*1024*1024+1);b.set([137,80,78,71,13,10,26,10]);
 const s=setup({},principal,{bytes:b,contentType:'image/png'});
 const result=await s.call();assert.equal(result.result.isError,true);
 assert.match(result.result.content[0].text,/SIGNATURE_INVALID/);
});
