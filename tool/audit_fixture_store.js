'use strict';
// Deterministic synthetic fixture adapter. NOT a database driver; never load in production.
// Real PostgreSQL semantics are tested in CI. This avoids a WASM PostgreSQL
// instance exceeding the memory limit of the free transport-test service.
function fixturePool(){
 let state={requests:new Map(),reads:new Map(),tokens:new Map(),jobs:new Map(),certificates:new Map(),events:[]};
 let tail=Promise.resolve();
 const result=(rows=[])=>({rows,rowCount:rows.length});
 async function query(source,args=[]){
  const sql=source.replace(/\s+/g,' ').trim();
  if(sql.startsWith('CREATE ')||sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return result();
  if(sql.startsWith('INSERT INTO certificates')){state.certificates.set(args[0],args[1]);return result();}
  if(sql.startsWith('INSERT INTO verified_originals_reference_jobs')){state.jobs.set(args[0],{job_id:args[0],hcv_id:args[1],state:'COMMITTED',provider:'r2',receipt_json:JSON.parse(args[2])});return result();}
  if(sql.startsWith('INSERT INTO verified_originals_delegated_audits')){
   state.requests.set(args[0],{request_id:args[0],browser_hash:args[1],hcv_ids:JSON.parse(args[2]),scope_digest:args[3],state:'PENDING',expires_at:new Date(Date.now()+300000),created_at:new Date()});return result();
  }
  if(sql.startsWith('INSERT INTO verified_originals_delegated_audit_events')){state.events.push({request_id:args[0],event_type:args[1],hcv_id:args[2],actor_hash:args[3]});return result();}
  if(sql.startsWith('SELECT * FROM verified_originals_delegated_audits'))return result(state.requests.has(args[0])?[structuredClone(state.requests.get(args[0]))]:[]);
  if(sql.startsWith('SELECT account_id FROM certificates'))return result(state.certificates.has(args[0])?[{account_id:state.certificates.get(args[0])}]:[]);
  if(sql.startsWith('SELECT device_key_fingerprint FROM account_devices'))return result(args[0]==='synthetic-owner'&&args[1]==='synthetic-device'?[{device_key_fingerprint:'synthetic-device'}]:[]);
  if(sql.startsWith('UPDATE verified_originals_delegated_audits')){
   const row=state.requests.get(args[0]);if(!row)return result();
   if(sql.includes("state='REVOKED'"))row.state='REVOKED';
   else{row.state='APPROVED';row.owner_account_id=args[1];row.owner_device_fingerprint=args[2];row.approved_at=new Date();row.expires_at=new Date(Math.min(row.created_at.getTime()+600000,Date.now()+300000));}
   return result([{expires_at:row.expires_at}]);
  }
  if(sql.startsWith('DELETE FROM verified_originals_reference_read_tokens')){
   for(const [key,row] of state.tokens)if(row.expires_at.getTime()<Date.now()-300000||(row.consumed_at&&row.consumed_at.getTime()<Date.now()-300000))state.tokens.delete(key);return result();
  }
  if(sql.startsWith('SELECT job_id,hcv_id,state,provider FROM verified_originals_reference_jobs')){
   const row=state.jobs.get(args[0]);return result(row&&row.hcv_id===args[1]?[structuredClone(row)]:[]);
  }
  if(sql.startsWith('INSERT INTO verified_originals_reference_read_tokens')){
   const expires_at=new Date(Date.now()+args[4]*1000);state.tokens.set(args[0],{token_hash:args[0],job_id:args[1],hcv_id:args[2],account_id:args[3],expires_at,consumed_at:null});return result([{expires_at}]);
  }
  if(sql.startsWith('INSERT INTO verified_originals_delegated_audit_reads')){
   if([...state.reads.values()].some(row=>row.request_id===args[1]&&row.hcv_id===args[2]))throw new Error('FIXTURE_DUPLICATE_READ');
   state.reads.set(args[0],{token_hash:args[0],request_id:args[1],hcv_id:args[2]});return result();
  }
  if(sql.startsWith('SELECT token_hash FROM verified_originals_delegated_audit_reads'))return result([...state.reads.values()].filter(row=>row.request_id===args[0]&&row.hcv_id===args[1]).map(row=>({token_hash:row.token_hash})));
  if(sql.startsWith('SELECT hcv_id FROM verified_originals_delegated_audit_reads')){
   const row=state.reads.get(args[0]);return result(row&&row.request_id===args[1]?[{hcv_id:row.hcv_id}]:[]);
  }
  if(sql.startsWith('SELECT t.*,j.state,j.provider,j.receipt_json')){
   const token=state.tokens.get(args[0]),job=token&&state.jobs.get(token.job_id);return result(token&&job?[structuredClone({...token,state:job.state,provider:job.provider,receipt_json:job.receipt_json})]:[]);
  }
  if(sql.startsWith('UPDATE verified_originals_reference_read_tokens SET consumed_at=NOW()')){
   const row=state.tokens.get(args[0]);if(row&&!row.consumed_at)row.consumed_at=new Date();return result();
  }
  throw new Error('FIXTURE_UNSUPPORTED_QUERY');
 }
 return {query,async connect(){
  const previous=tail;let unlock;tail=new Promise(resolve=>unlock=resolve);await previous;
  let snapshot;
  return {query:async(sql,args)=>{
   if(sql==='BEGIN')snapshot=structuredClone(state);
   if(sql==='ROLLBACK'&&snapshot)state=snapshot;
   return query(sql,args);
  },release:unlock};
 },end:async()=>{}};
}
module.exports={fixturePool};
