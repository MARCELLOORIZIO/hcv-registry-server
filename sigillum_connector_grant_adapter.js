'use strict';
const {createHash}=require('node:crypto');
const HCV=/^HCV-[A-F0-9]{16}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const denied=()=>Object.assign(new Error('AUDIT_NOT_AUTHORIZED'),{code:'AUDIT_NOT_AUTHORIZED'});
// DB-backed connector grant adapter. The external connector principal must be
// established by an independent, authenticated MCP transport; never derive it
// from user-submitted input, an HCV ID or the Safari owner's session.
function createConnectorGrantAdapter({pool,loadOriginal,checkReferenceEligible,now=()=>new Date()}){
 if(!pool?.connect||!pool?.query||typeof loadOriginal!=='function'||typeof checkReferenceEligible!=='function')throw new TypeError('CONNECTOR_DEPENDENCIES_REQUIRED');
 const getAuthorizedGrant=async({connectorPrincipal,grantId})=>{
   const result=await pool.query(`SELECT a.state,a.hcv_ids,a.expires_at,a.owner_account_id,
       a.owner_device_fingerprint,a.connector_principal_hash
       FROM verified_originals_delegated_audits a
       WHERE a.request_id=$1`,[grantId]);
   const row=result.rows[0];
   if(!row||!row.connector_principal_hash||row.connector_principal_hash!==hash(connectorPrincipal))return null;
   const reads=await pool.query('SELECT hcv_id FROM verified_originals_delegated_audit_reads WHERE request_id=$1',[grantId]);
   return {state:row.state,connectorPrincipal,hcvIds:row.hcv_ids,
     expiresAtMs:new Date(row.expires_at).getTime(),revoked:row.state==='REVOKED',
     reads:reads.rows.map(x=>x.hcv_id)};
 };
 const recordEvent=async({grantId,hcvId,connectorPrincipal,type})=>{
   await pool.query(`INSERT INTO verified_originals_delegated_audit_events
     (request_id,event_type,hcv_id,actor_hash) VALUES($1,$2,$3,$4)`,[grantId,type,hcvId,hash(connectorPrincipal)]);
 };
 const readApprovedReference=async({grantId,hcvId,connectorPrincipal})=>{
   if(!HCV.test(hcvId))throw denied();
   const client=await pool.connect();
   let ownerAccountId;
   try{
     await client.query('BEGIN');
     const result=await client.query(`SELECT * FROM verified_originals_delegated_audits
       WHERE request_id=$1 FOR UPDATE`,[grantId]);
     const row=result.rows[0];
     if(!row||row.state!=='APPROVED'||row.connector_principal_hash!==hash(connectorPrincipal)||
        new Date(row.expires_at)<=now()||!row.hcv_ids.includes(hcvId))throw denied();
     const device=await client.query(`SELECT 1 FROM account_devices
       WHERE account_id=$1 AND device_key_fingerprint=$2 AND revoked_at IS NULL`,
       [row.owner_account_id,row.owner_device_fingerprint]);
     if(!device.rows.length)throw denied();
     const cert=await client.query('SELECT account_id FROM certificates WHERE hcv_id=$1',[hcvId]);
     if(cert.rows[0]?.account_id!==row.owner_account_id)throw denied();
     // Re-check current paid entitlement, publication consent and R2 COMMITTED
     // reference while holding the grant lock. Approval alone is insufficient.
     if(!await checkReferenceEligible({client,hcvId,ownerAccountId:row.owner_account_id}))throw denied();
     const reserved=await client.query(`INSERT INTO verified_originals_delegated_audit_reads
       (token_hash,request_id,hcv_id) VALUES($1,$2,$3)
       ON CONFLICT DO NOTHING RETURNING hcv_id`,[hash('connector:'+grantId+':'+hcvId),grantId,hcvId]);
     if(!reserved.rows.length)throw denied();
     ownerAccountId=row.owner_account_id;
     await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
   // loadOriginal reuses SIGILLUM's existing verified AES-GCM/SHA256 reader.
   // Reservation commits before decryption, guaranteeing single-use on failures.
   return loadOriginal({hcvId,ownerAccountId});
 };
 return {getAuthorizedGrant,recordEvent,readApprovedReference};
}
module.exports={createConnectorGrantAdapter};
