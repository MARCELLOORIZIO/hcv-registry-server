'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createConnectorGrantAdapter}=require('./sigillum_connector_grant_adapter');
const h=x=>createHash('sha256').update(x).digest('hex');
const id='HCV-D8FF76496D424CA5';
function harness(opts={}){
 const events=[],reads=new Set(), principal='mcp-principal';
 const row={state:'APPROVED',hcv_ids:[id],expires_at:new Date(Date.now()+300000).toISOString(),
 owner_account_id:'owner',owner_device_fingerprint:'device',connector_principal_hash:h(principal),
 ...opts.row};
 let loaded=0;
 const query=async(sql,args=[])=>{
 if(sql.includes('FROM verified_originals_delegated_audits'))return {rows:opts.missing?[]:[row]};
 if(sql.includes('SELECT hcv_id FROM verified_originals_delegated_audit_reads'))return {rows:[...reads].map(hcv_id=>({hcv_id}))};
 if(sql.includes('INSERT INTO verified_originals_delegated_audit_events')){events.push(args);return {rows:[]};}
 if(sql.includes('FROM account_devices'))return {rows:opts.revoked?[]:[{ok:1}]};
 if(sql.includes('FROM certificates'))return {rows:[{account_id:opts.wrongOwner?'other':'owner'}]};
 if(sql.includes('INSERT INTO verified_originals_delegated_audit_reads')){
 if(reads.has(args[2]))return {rows:[]};
 reads.add(args[2]);return {rows:[{hcv_id:args[2]}]};
 }
 return {rows:[]};
 };
 const client={query,release(){}};
 const pool={connect:async()=>client,query};
 const adapter=createConnectorGrantAdapter({pool,checkReferenceEligible:async()=>!opts.ineligible,loadOriginal:async()=>{loaded++;return {bytes:new Uint8Array([255,216,255]),contentType:'image/jpeg'};}});
 return {adapter,reads,events,get loaded(){return loaded;}};
}
test('valid principal and owner scope consume once',async()=>{
 const m=harness();const grant=await m.adapter.getAuthorizedGrant({connectorPrincipal:'mcp-principal',grantId:'0'.repeat(32)});
 assert.equal(grant.state,'APPROVED');assert.deepEqual(grant.hcvIds,[id]);
 await m.adapter.readApprovedReference({grantId:'0'.repeat(32),hcvId:id,connectorPrincipal:'mcp-principal'});
 assert.equal(m.loaded,1);
 await assert.rejects(m.adapter.readApprovedReference({grantId:'0'.repeat(32),hcvId:id,connectorPrincipal:'mcp-principal'}),{code:'AUDIT_NOT_AUTHORIZED'});
});
for(const [label,opts] of [['revoked',{revoked:true}],['wrong owner',{wrongOwner:true}],['reference or subscription ineligible',{ineligible:true}],['expired',{row:{expires_at:new Date(0).toISOString()}}],['not approved',{row:{state:'PENDING'}}],['wrong principal',{row:{connector_principal_hash:'different'}}]]){
 test('no decryption '+label,async()=>{const m=harness(opts);
 await assert.rejects(m.adapter.readApprovedReference({grantId:'0'.repeat(32),hcvId:id,connectorPrincipal:'mcp-principal'}),{code:'AUDIT_NOT_AUTHORIZED'});
 assert.equal(m.loaded,0);});
}
