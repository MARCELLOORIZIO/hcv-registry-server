'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const { normalizeAuditScope, assertAuditReferenceEligible, auditEventDigest }=require('./audit_reference_scope');

const A='HCV-D8FF76496D424CA5';
const B='HCV-255DEE0995364F99';
const now=Date.parse('2026-10-12T11:00:00Z');
const scope=()=>normalizeAuditScope({
  hcvIds:[A,B],
  purpose:'PHOTO_DISPLAY_CONFLICT',
  approvedBy:'verified-account-subject',
  expiresAt:new Date(now+60000).toISOString(),
},now);
test('only explicit IDs in bounded scopes are allowed',()=>{
  const s=scope();
  assert.deepEqual(s.hcvIds,[B,A].sort());
  assert.equal(assertAuditReferenceEligible(s,{hcvId:A,ownerAccountId:'owner',requestingAccountId:'owner',state:'COMMITTED',provider:'r2'},now).existingAuthRequired,true);
  assert.throws(()=>assertAuditReferenceEligible(s,{hcvId:'HCV-54A1914F4E2D4C47',ownerAccountId:'owner',requestingAccountId:'owner',state:'COMMITTED',provider:'r2'},now),/AUDIT_REFERENCE_OUT_OF_SCOPE/);
});
test('rejects cross-account, expired, absent or deleted references',()=>{
  const s=scope();
  assert.throws(()=>assertAuditReferenceEligible(s,{hcvId:A,ownerAccountId:'owner',requestingAccountId:'intruder',state:'COMMITTED',provider:'r2'},now),/AUDIT_REFERENCE_OWNER_MISMATCH/);
  assert.throws(()=>assertAuditReferenceEligible(s,{hcvId:A,ownerAccountId:'owner',requestingAccountId:'owner',state:'DELETED',provider:'r2'},now),/AUDIT_REFERENCE_NOT_AVAILABLE/);
  assert.throws(()=>assertAuditReferenceEligible(s,{hcvId:A,ownerAccountId:'owner',requestingAccountId:'owner',state:'COMMITTED',provider:'r2'},now+61000),/AUDIT_REFERENCE_OUT_OF_SCOPE/);
});
test('rejects untrusted approval, duplicate ids, invalid purpose and long expiry',()=>{
  assert.throws(()=>normalizeAuditScope({hcvIds:[A],purpose:'PHOTO_DISPLAY_CONFLICT',expiresAt:new Date(now+60000).toISOString()},now),/AUDIT_SCOPE_APPROVER_REQUIRED/);
  assert.throws(()=>normalizeAuditScope({hcvIds:[A,A],purpose:'PHOTO_DISPLAY_CONFLICT',approvedBy:'a',expiresAt:new Date(now+60000).toISOString()},now),/AUDIT_SCOPE_DUPLICATE_HCV_ID/);
  assert.throws(()=>normalizeAuditScope({hcvIds:[A],purpose:'ADMIN_OVERRIDE',approvedBy:'a',expiresAt:new Date(now+60000).toISOString()},now),/AUDIT_SCOPE_INVALID_PURPOSE/);
  assert.throws(()=>normalizeAuditScope({hcvIds:[A],purpose:'PHOTO_DISPLAY_CONFLICT',approvedBy:'a',expiresAt:new Date(now+3600000).toISOString()},now),/AUDIT_SCOPE_EXPIRY_INVALID/);
  assert.match(auditEventDigest({hcvId:A,purpose:'PHOTO_DISPLAY_CONFLICT',principalId:'a',timestamp:'now'}),/^[0-9a-f]{64}$/);
});
