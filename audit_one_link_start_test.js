'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {auditPage}=require('./delegated_reference_audit_ui');
test('one-link launch is restricted to explicit HCV IDs and creates pending request only',()=>{
 const html=auditPage({mode:'new',requestId:'',nonce:'test'});
 assert.match(html,/\^#start=/);
 assert.match(html,/new Set\(ids\)\.size===ids\.length/);
 assert.match(html,/history\.replaceState/);
 assert.match(html,/void createRequest\(\)/);
 assert.match(html,/audit\/requests','POST',\{hcvIds\}/);
 assert.doesNotMatch(html,/automaticApproval|bypassOwnerApproval/);
});
