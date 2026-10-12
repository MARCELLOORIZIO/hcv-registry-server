'use strict';
const crypto=require('node:crypto');
const {scopeIds,digest}=require('./delegated_reference_audit');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
// Called only with the principal resolved from the authenticated MCP channel.
// Never rebind an existing browser grant; approval uses the existing owner flow.
function createConnectorAuditRequest({pool,origin,now=()=>new Date()}){
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.origin!==origin)throw Error('CONNECTOR_HTTPS_ORIGIN_REQUIRED');
 return async({connectorPrincipal,hcvIds})=>{
  if(typeof connectorPrincipal!=='string'||!connectorPrincipal||connectorPrincipal.length>120)
   throw Error('CONNECTOR_AUTH_REQUIRED');
  const ids=scopeIds(hcvIds),principalHash=hash(connectorPrincipal);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // Serialize requests for this principal across Registry instances. The hash
   // is not an authorization token; it is only the transaction lock key.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[principalHash]);
   const count=await client.query(`SELECT COUNT(*)::int AS count FROM verified_originals_delegated_audits
     WHERE connector_principal_hash=$1 AND created_at>$2`,[principalHash,new Date(now().getTime()-300000)]);
   if(count.rows[0].count>=10)throw Error('CONNECTOR_AUDIT_RATE_LIMITED');
   const requestId=crypto.randomBytes(16).toString('hex');
   const expiresAt=new Date(now().getTime()+300000);
   await client.query(`INSERT INTO verified_originals_delegated_audits
     (request_id,browser_hash,hcv_ids,scope_digest,state,expires_at,connector_principal_hash)
     VALUES($1,$2,$3,$4,'PENDING',$5,$6)`,
    [requestId,hash(crypto.randomBytes(32)),JSON.stringify(ids),digest(ids),expiresAt,principalHash]);
   await client.query(`INSERT INTO verified_originals_delegated_audit_events
     (request_id,event_type,actor_hash) VALUES($1,'CONNECTOR_REQUEST_CREATED',$2)`,[requestId,principalHash]);
   await client.query('COMMIT');
   return {requestId,hcvIds:ids,scopeDigest:digest(ids),state:'PENDING',expiresAt:expiresAt.toISOString(),
    approvalUrl:origin+'/audit/approve/'+requestId};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 };
}
module.exports={createConnectorAuditRequest};
