'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {memoryPool}=require('./tool/audit_test_database');
const {createDelegatedReferenceAudit}=require('./delegated_reference_audit');
const {createConnectorAuditRequest}=require('./sigillum_connector_audit_request');
const {createSigillumMcpDispatcher,REQUEST_TOOL}=require('./sigillum_mcp_dispatcher');
const ID='HCV-0000000000000051',principal='synthetic-client';
test('pending request is principal-bound, unapproved, scoped, logged and rate-limited',async()=>{
 const pool=await memoryPool();
 try{
  await pool.query('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
  await createDelegatedReferenceAudit({pool,enabled:true,origin:'https://synthetic.invalid'}).initSchema();
  await pool.query('ALTER TABLE verified_originals_delegated_audits ADD COLUMN connector_principal_hash TEXT');
  const request=createConnectorAuditRequest({pool,origin:'https://synthetic.invalid'});
  const first=await request({connectorPrincipal:principal,hcvIds:[ID]});
  assert.equal(first.state,'PENDING');assert.match(first.approvalUrl,/^https:\/\/synthetic\.invalid\/audit\/approve\/[a-f0-9]{32}$/);
  const row=(await pool.query('SELECT * FROM verified_originals_delegated_audits WHERE request_id=$1',[first.requestId])).rows[0];
  assert.equal(row.owner_account_id,null);assert.equal(row.owner_device_fingerprint,null);
  assert.equal(row.connector_principal_hash,crypto.createHash('sha256').update(principal).digest('hex'));
  assert.equal(JSON.stringify(first).includes(row.browser_hash),false);
  assert.equal((await pool.query('SELECT event_type FROM verified_originals_delegated_audit_events')).rows[0].event_type,'CONNECTOR_REQUEST_CREATED');
  await assert.rejects(request({connectorPrincipal:principal,hcvIds:[ID,ID]}));
  await assert.rejects(request({connectorPrincipal:'',hcvIds:[ID]}));
  for(let n=1;n<10;n++)await request({connectorPrincipal:principal,hcvIds:[ID]});
  await assert.rejects(request({connectorPrincipal:principal,hcvIds:[ID]}),/RATE_LIMITED/);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM verified_originals_delegated_audits')).rows[0].count,10);
 }finally{await pool.end();}
});
test('MCP request principal comes only from verified channel, never tool arguments',async()=>{
 let observed,calls=0;
 const dispatch=createSigillumMcpDispatcher({resolvePrincipal:async()=>principal,
  getAuthorizedGrant:async()=>null,recordEvent:async()=>{},readApprovedReference:async()=>{},
  requestAudit:async input=>{calls++;observed=input;return {state:'PENDING'};}
 });
 const message=args=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:REQUEST_TOOL,arguments:args}});
 assert.equal((await dispatch(message({hcvIds:[ID]}),{})).result.isError,false);
 assert.equal(observed.connectorPrincipal,principal);
 assert.equal((await dispatch(message({hcvIds:[ID],connectorPrincipal:'intruder'}),{})).result.isError,true);
 assert.equal(calls,1);
});
