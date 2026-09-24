'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const {checkCreatorConsentRequest,checkPublication,eligibleCertificate,publicReference} = require('./verified_originals_policy');

const id = 'HCV-0123456789ABCDEF';
const hash = 'a'.repeat(64);
const rendition = 'b'.repeat(64);
const certificate = {certificate_raw:JSON.stringify({content:{hash},meta:{identity:{creatorId:'creator-01'}}})};
const provenance = {provenance_raw:JSON.stringify({
  type:'SIGILLUM_REGISTRY_PROVENANCE',version:2,
  status:'SIGILLUM_REGISTRY_VERIFIED',integrityValid:true,
  accountSubjectHash:crypto.createHash('sha256').update('account-01').digest('hex'),creatorId:'creator-01'
}),registry_status:'ACTIVE'};
const consent = {version:1, hcvId:id, originalSha256:hash,
  creatorSubject:'creator-01', grantedAt:'2026-09-24T09:00:00Z',
  recordId:'consent-record-0001',publishReference:true,monetize:false,rightsConfirmed:true};
const publication = {hcvId:id, originalSha256:hash, renditionSha256:rendition,
  uploadedAssetSha256:rendition,pipelineVerified:true,pipelineAuditId:'pipeline-run-001',
  youtubeVideoId:'AbCdEfGhI_1',rightsConfirmed:true,consent};
const row = {hcv_id:id,original_sha256:hash,rendition_sha256:rendition,
  youtube_video_id:publication.youtubeVideoId,published_at:'2026-09-24T09:01:00Z',
  state:'PUBLISHED',consent_raw:JSON.stringify(consent)};
const storedConsent={record_id:consent.recordId,hcv_id:id,state:'ACTIVE',
 account_subject_hash:crypto.createHash('sha256').update('account-01').digest('hex'),
 consent_raw:JSON.stringify(consent)};

test('reference is available only for verified active certificates and consent', () => {
  assert.equal(checkPublication(publication,certificate,provenance,null,storedConsent),null);
  const shown = publicReference(row,certificate,provenance,null,storedConsent);
  assert.equal(shown.availability,'REFERENCE_AVAILABLE');
  assert.equal(shown.socialFileVerdict,'NOT_VERIFIED');
  assert.equal(shown.youtubeUrl,'https://www.youtube.com/watch?v=AbCdEfGhI_1');
});
test('legacy, revoked and disputed certificates fail closed', () => {
  assert.equal(eligibleCertificate(certificate,null,null),false);
  assert.equal(eligibleCertificate(certificate,provenance,{status:'REVOKED'}),false);
  assert.equal(eligibleCertificate(certificate,provenance,{status:'DISPUTED'}),false);
  assert.equal(publicReference(row,certificate,provenance,{status:'REVOKED'},storedConsent),null);
  assert.equal(publicReference(row,certificate,{provenance_raw:'{}'},null,storedConsent),null);
  assert.equal(checkPublication(publication,certificate,null,null,storedConsent),'CERTIFICATE_NOT_ELIGIBLE');
});
test('no publication without separate affirmative consent and rights', () => {
  assert.equal(checkPublication({...publication,consent:{...consent,publishReference:false}},
    certificate,provenance,null,storedConsent),'CONSENT_NOT_BOUND');
  assert.equal(checkPublication({...publication,consent:{...consent,hcvId:'HCV-FFFFFFFFFFFFFFFF'}},
    certificate,provenance,null,storedConsent),'CONSENT_NOT_BOUND');
  assert.equal(checkPublication({...publication,consent:{...consent,creatorSubject:'creator-02'}},
    certificate,provenance,null,storedConsent),'CONSENT_NOT_BOUND');
  assert.equal(checkPublication({...publication,consent:{...consent,monetize:null}},
    certificate,provenance,null,storedConsent),'MONETIZATION_CONSENT_MISSING');
  assert.equal(checkPublication({...publication,rightsConfirmed:false},
    certificate,provenance,null,storedConsent),'RIGHTS_NOT_CONFIRMED');
  assert.equal(publicReference({...row,state:'WITHDRAWN'},certificate,provenance,null,storedConsent),null);
});
test('hash and publisher pipeline assertions cannot be omitted', () => {
  assert.equal(checkPublication({...publication,originalSha256:rendition},
    certificate,provenance,null,storedConsent),'ORIGINAL_HASH_MISMATCH');
  assert.equal(checkPublication({...publication,renditionSha256:hash},
    certificate,provenance,null,storedConsent),'UNVERIFIED_PIPELINE');
  assert.equal(checkPublication({...publication,pipelineVerified:false},
    certificate,provenance,null,storedConsent),'UNVERIFIED_PIPELINE');
  assert.equal(checkPublication({...publication,pipelineAuditId:''},
    certificate,provenance,null,storedConsent),'AUDIT_MISSING');
  assert.equal(publicReference({...row,original_sha256:rendition},certificate,provenance,null,storedConsent),null);
});
test('social URL cannot be used for open redirects', () => {
  for (const malicious of ['https://example.net/ab','../../etc/passwd',
    'AbCdEfGhI_1?x=1', 'AbCdEfGhI_1#', '']) {
    assert.equal(checkPublication({...publication,youtubeVideoId:malicious},
      certificate,provenance,null,storedConsent),'INVALID_YOUTUBE_ID');
  }
  assert.equal(publicReference({...row,youtube_video_id:'evil.com'},certificate,provenance,null,storedConsent),null);
});
console.log('VERIFIED_ORIGINALS_POLICY_TESTS_COMPLETE');


test('creator-authenticated consent is required before a publisher can bind an HCV ID', () => {
  const request = {hcvId:id,originalSha256:hash,intent:'PUBLISH_VERIFIED_ORIGINAL',
    publishReference:true,monetize:false,rightsConfirmed:true};
  assert.equal(checkCreatorConsentRequest(request,certificate,provenance,null,
    {accountId:'account-01',creatorId:'creator-01'}),null);
  assert.equal(checkCreatorConsentRequest(request,certificate,provenance,null,
    {accountId:'someone-else',creatorId:'creator-01'}),'CREATOR_OWNERSHIP_NOT_VERIFIED');
  assert.equal(checkCreatorConsentRequest({...request,monetize:null},certificate,provenance,null,
    {accountId:'account-01',creatorId:'creator-01'}),'MONETIZATION_CONSENT_MISSING');
  assert.equal(checkCreatorConsentRequest({...request,publishReference:false},certificate,provenance,null,
    {accountId:'account-01',creatorId:'creator-01'}),'EXPLICIT_PUBLICATION_CONSENT_REQUIRED');
  assert.equal(checkPublication(publication,certificate,provenance,null,null),
    'CREATOR_CONSENT_NOT_AUTHENTICATED');
  assert.equal(checkPublication(publication,certificate,provenance,null,
    {...storedConsent,state:'WITHDRAWN'}),'CREATOR_CONSENT_NOT_AUTHENTICATED');
  assert.equal(checkPublication(publication,certificate,provenance,null,
    {...storedConsent,account_subject_hash:'0'.repeat(64)}),'CREATOR_CONSENT_NOT_AUTHENTICATED');
  assert.equal(publicReference(row,certificate,provenance,null,null),null);
  assert.equal(publicReference(row,certificate,provenance,null,
    {...storedConsent,state:'WITHDRAWN'}),null);
});
