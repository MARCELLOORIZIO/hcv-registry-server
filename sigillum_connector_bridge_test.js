'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSigillumConnectorBridge}=require('./sigillum_connector_bridge');
const id='HCV-D8FF76496D424CA5', principal='connected-chatgpt-auditor', grantId='0123456789abcdef0123456789abcdef';
const now=Date.parse('2026-10-12T12:00:00Z');
function build(overrides={}) {
 let calls=0;
 const grant={state:'APPROVED',connectorPrincipal:principal,hcvIds:[id],expiresAtMs:now+300000,revoked:false,reads:[],...overrides};
 const bridge=createSigillumConnectorBridge({
  now:()=>now,
  getAuthorizedGrant:async()=>grant,
  recordEvent:async()=>{calls++;},
  readApprovedReference:async()=>({bytes:new Uint8Array([1,2,3]),contentType:'image/png'})
 });
 return {bridge,calls:()=>calls};
}
const request={connectorPrincipal:principal,grantId,hcvId:id};
test('explicit approved scoped reference can be read',async()=>{
 const b=build();const result=await b.bridge.readOriginal(request);
 assert.equal(result.contentType,'image/png');assert.equal(b.calls(),2);
});
for(const [title,overrides] of [
 ['pending',{state:'PENDING'}],['expired',{expiresAtMs:now}],
 ['revoked',{revoked:true}],['wrong owner',{connectorPrincipal:'other'}],
 ['unscoped',{hcvIds:[]}],['replay',{reads:[id]}],
]){
 test('reject '+title,async()=>{const b=build(overrides);
  await assert.rejects(b.bridge.readOriginal(request),{code:title==='replay'?'AUDIT_READ_ALREADY_ISSUED':'AUDIT_NOT_AUTHORIZED'});
  assert.equal(b.calls(),0);
 });
}
test('refuse input without exact HCV ID and principal',async()=>{
 const b=build();await assert.rejects(b.bridge.readOriginal({...request,hcvId:'HCV-FOO'}),{code:'AUDIT_INPUT_INVALID'});
});
