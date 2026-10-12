'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSigillumMcpService}=require('./sigillum_mcp_service');
const {createHash}=require('node:crypto');
const h=x=>createHash('sha256').update(x).digest('hex');
const id='HCV-D8FF76496D424CA5',principal='verified-mcp-user',grantId='f'.repeat(32);
function fixture({state='APPROVED',caller=principal,eligible=true}={}){
 const reads=new Set(),png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
 let decrypts=0;
 const row={state,hcv_ids:[id],owner_account_id:'acct',owner_device_fingerprint:'device',
  expires_at:new Date(Date.now()+300000).toISOString(),connector_principal_hash:h(principal)};
 const query=async(sql,args=[])=>{
  if(sql.includes('FROM verified_originals_delegated_audits'))return {rows:[row]};
  if(sql.includes('SELECT hcv_id FROM verified_originals_delegated_audit_reads'))return {rows:[...reads].map(hcv_id=>({hcv_id}))};
  if(sql.includes('FROM account_devices'))return {rows:[{ok:1}]};
  if(sql.includes('FROM certificates'))return {rows:[{account_id:'acct'}]};
  if(sql.includes('INSERT INTO verified_originals_delegated_audit_reads')){
   if(reads.has(args[2]))return {rows:[]};
   reads.add(args[2]);return {rows:[{hcv_id:args[2]}]};}
  return {rows:[]};
 };
 const client={query,release(){}};
 const service=createSigillumMcpService({
  pool:{query,connect:async()=>client},resolvePrincipal:async()=>caller,
  checkReferenceEligible:async()=>eligible,
  activeR2Reference:async()=>({providerReceipt:{mediaType:'photo'}}),
  streamR2Reference:async(res)=>{decrypts++;res.writeHead(200,{'content-type':'image/png','content-length':String(png.length)});await new Promise((resolve,reject)=>res.end(png,e=>e?reject(e):resolve()));}
 });
 const call=()=>service({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'sigillum_read_approved_original',arguments:{hcvId:id,grantId}}},{});
 return {call,get decrypts(){return decrypts;}};
}
test('approved authenticated MCP reader receives R2 decrypted image once',async()=>{
 const s=fixture();const ok=await s.call();assert.equal(ok.result.isError,false);assert.equal(ok.result.content[0].type,'image');assert.equal(s.decrypts,1);
 const replay=await s.call();assert.equal(replay.result.isError,true);assert.equal(s.decrypts,1);
});
for(const [name,opts] of [['pending',{state:'PENDING'}],['unauthorized principal',{caller:'attacker'}],['reference invalid',{eligible:false}]]){
 test('deny without decrypting: '+name,async()=>{const s=fixture(opts);assert.equal((await s.call()).result.isError,true);assert.equal(s.decrypts,0);});
}
