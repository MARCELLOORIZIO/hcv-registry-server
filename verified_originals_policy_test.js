'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {checkPublication, eligibleCertificate, publicReference} = require('./verified_originals_policy');

const id = 'HCV-0123456789ABCDEF';
const hash = 'a'.repeat(64);
const rendition = 'b'.repeat(64);
const certificate = {certificate_raw:JSON.stringify({content:{hash},meta:{identity:{creatorId:'creator-01'}}})};
const provenance = {provenance_raw:JSON.stringify({
  type:'SIGILLUM_REGISTRY_PROVENANCE',version:2,
  status:'SIGILLUM_REGISTRY_VERIFIED',integrityValid:true
}),registry_status:'ACTIVE'};
const consent = {version:1, hcvId:id, originalSha256:hash,
  creatorSubject:'creator-01', grantedAt:'2026-09-24T09:00:00Z',
  recordId:'consent-record-0001',publishReference:true,monetize:false};
const publication = {hcvId:id, originalSha256:hash, renditionSha256:rendition,
  uploadedAssetSha256:rendition,pipelineVerified:true,pipelineAuditId:'pipeline-run-001',
  youtubeVideoId:'AbCdEfGhI_1',rightsConfirmed:true,consent};
const row = {hcv_id:id,original_sha256:hash,rendition_sha256:rendition,
  youtube_video_id:publication.youtubeVideoId,published_at:'2026-09-24T09:01:00Z',
  state:'PUBLISHED',consent_raw:JSON.stringify(consent)};

test('reference is available only for verified active certificates and consent', () => {
  assert.equal(checkPublication(publication,certificate,provenance,null),null);
  const shown = publicReference(row,certificate,provenance,null);
  assert.equal(shown.availability,'REFERENCE_AVAILABLE');
  assert.equal(shown.socialFileVerdict,'NOT_VERIFIED');
  assert.equal(shown.youtubeUrl,'https://www.youtube.com/watch?v=AbCdEfGhI_1');
});
test('legacy, revoked and disputed certificates fail closed', () => {
  assert.equal(eligibleCertificate(certificate,null,null),false);
  assert.equal(eligibleCertificate(certificate,provenance,{status:'REVOKED'}),false);
  assert.equal(eligibleCertificate(certificate,provenance,{status:'DISPUTED'}),false);
  assert.equal(publicReference(row,certificate,provenance,{status:'REVOKED'}),null);
  assert.equal(publicReference(row,certificate,{provenance_raw:'{}'},null),null);
  assert.equal(checkPublication(publication,certificate,null,null),'CERTIFICATE_NOT_ELIGIBLE');
});
test('no publication without separate affirmative consent and rights', () => {
  assert.equal(checkPublication({...publication,consent:{...consent,publishReference:false}},
    certificate,provenance,null),'CONSENT_NOT_BOUND');
  assert.equal(checkPublication({...publication,consent:{...consent,hcvId:'HCV-FFFFFFFFFFFFFFFF'}},
    certificate,provenance,null),'CONSENT_NOT_BOUND');
  assert.equal(checkPublication({...publication,consent:{...consent,creatorSubject:'creator-02'}},
    certificate,provenance,null),'CONSENT_NOT_BOUND');
  assert.equal(checkPublication({...publication,consent:{...consent,monetize:null}},
    certificate,provenance,null),'MONETIZATION_CONSENT_MISSING');
  assert.equal(checkPublication({...publication,rightsConfirmed:false},
    certificate,provenance,null),'RIGHTS_NOT_CONFIRMED');
  assert.equal(publicReference({...row,state:'WITHDRAWN'},certificate,provenance,null),null);
});
test('hash and publisher pipeline assertions cannot be omitted', () => {
  assert.equal(checkPublication({...publication,originalSha256:rendition},
    certificate,provenance,null),'ORIGINAL_HASH_MISMATCH');
  assert.equal(checkPublication({...publication,renditionSha256:hash},
    certificate,provenance,null),'UNVERIFIED_PIPELINE');
  assert.equal(checkPublication({...publication,pipelineVerified:false},
    certificate,provenance,null),'UNVERIFIED_PIPELINE');
  assert.equal(checkPublication({...publication,pipelineAuditId:''},
    certificate,provenance,null),'AUDIT_MISSING');
  assert.equal(publicReference({...row,original_sha256:rendition},certificate,provenance,null),null);
});
test('social URL cannot be used for open redirects', () => {
  for (const malicious of ['https://example.net/ab','../../etc/passwd',
    'AbCdEfGhI_1?x=1', 'AbCdEfGhI_1#', '']) {
    assert.equal(checkPublication({...publication,youtubeVideoId:malicious},
      certificate,provenance,null),'INVALID_YOUTUBE_ID');
  }
  assert.equal(publicReference({...row,youtube_video_id:'evil.com'},certificate,provenance,null),null);
});
console.log('VERIFIED_ORIGINALS_POLICY_TESTS_COMPLETE');
