'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const src=fs.readFileSync(require('node:path').join(__dirname,'verified_originals_production.js'),'utf8');
test('scoped audit read route reuses authenticated single-use reference stream',()=>{
  assert.match(src,/audit-read-authorization/);
  const f=src.slice(src.indexOf('async function createScopedAuditReadAuthorization('),src.indexOf('async function streamAuthorizedR2Reference('));
  assert.match(f,/await authenticate\(req\)/);
  assert.match(f,/account\.subscriptionStatus !== 'active'/);
  assert.match(f,/SELECT account_id FROM certificates WHERE hcv_id=\$1/);
  assert.match(f,/assertAuditReferenceEligible\(scope/);
  assert.match(f,/createR2ReadAuthorization\(req,hcvId\)/);
  assert.match(f,/REFERENCE_AUDIT_READ_AUTHORIZED/);
  assert.doesNotMatch(f,/STRIPE_SECRET_KEY|R2_REFERENCE_MASTER_KEYS_JSON|materializeReference\(/);
});
test('no unauthenticated GET audit path and no provider read bypass',()=>{
  assert.match(src,/if \(req\.method === 'POST' && auditReadAuthorization\)/);
  assert.doesNotMatch(src,/if \(req\.method === 'GET' && auditReadAuthorization\)/);
  assert.match(src,/if \(req\.method === 'GET' && readReference\)/);
  assert.match(src,/consumeReadAuthorization\(pool/);
});
