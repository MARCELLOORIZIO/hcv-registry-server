'use strict';
const crypto=require('node:crypto');
const h=x=>crypto.createHash('sha256').update(x).digest('hex');
// Storage adapter for connector-specific credentials. Token issuance is
// deliberately separate from audit approval and requires a trusted
// administrative provisioning step; never issue tokens from HCV IDs.
function createMcpCredentialStore({pool,now=()=>new Date()}){
 if(!pool?.query)throw new TypeError('MCP_DATABASE_REQUIRED');
 async function lookupTokenHash(tokenHash){
  if(!/^[a-f0-9]{64}$/.test(String(tokenHash)))return null;
  const r=await pool.query(`SELECT principal,expires_at,revoked_at FROM sigillum_mcp_credentials WHERE token_hash=$1`,[tokenHash]);
  const row=r.rows[0];if(!row)return null;
  return {principal:row.principal,expiresAtMs:new Date(row.expires_at).getTime(),revoked:row.revoked_at!==null};
 }
 // Provisioning must only be called by trusted administrative code, not MCP.
 async function provision({principal,ttlSeconds=3600}){
  if(!/^[A-Za-z0-9:._-]{3,120}$/.test(principal)||!Number.isInteger(ttlSeconds)||ttlSeconds<60||ttlSeconds>86400)throw Error('MCP_CREDENTIAL_SCOPE_INVALID');
  const token=crypto.randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO sigillum_mcp_credentials(token_hash,principal,expires_at)
     VALUES($1,$2,$3)`,[h(token),principal,new Date(now().getTime()+ttlSeconds*1000)]);
  return {token,principal,expiresAt:new Date(now().getTime()+ttlSeconds*1000).toISOString()};
 }
 async function revoke({tokenHash}){
  await pool.query('UPDATE sigillum_mcp_credentials SET revoked_at=NOW() WHERE token_hash=$1',[tokenHash]);
 }
 return {lookupTokenHash,provision,revoke};
}
module.exports={createMcpCredentialStore};
