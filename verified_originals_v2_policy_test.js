'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const {
  CONSENT_VERSION, registryEligibility, creatorOwns, platformReference,
  trustedDerivation, publicPublication, hashText,
} = require('./verified_originals_v2_policy');

const id = 'HCV-0123456789ABCDEF';
const original = 'a'.repeat(64);
const reference = 'b'.repeat(64);
const cert = {hcv_id:id,certificate_raw:JSON.stringify({
  meta:{hcvId:id,identity:{creatorId:'creator-01'}},
  content:{type:'video',hash:original}
})};
const prov = {registry_status:'ACTIVE',provenance_raw:JSON.stringify({
  type:'SIGILLUM_REGISTRY_PROVENANCE',version:2,
  status:'SIGILLUM_REGISTRY_VERIFIED',integrityValid:true,
  contentSha256:original,accountSubjectHash:hashText('account-01')
})};
const session={accountId:'account-01',creatorId:'creator-01',
  deviceKeyFingerprint:'c'.repeat(64)};
const consent={record_id:'consent-01',hcv_id:id,state:'ACTIVE'};
const receipt={receipt_id:'receipt-01',hcv_id:id,platform:'youtube',
  platform_post_id:'AbCdEfGhI_1',uploaded_sha256:reference,
  processing_status:'succeeded',visibility:'unlisted'};
const pub={
  publication_id:'11111111-1111-4111-8111-111111111111',hcv_id:id,
  platform:'youtube',platform_post_id:'AbCdEfGhI_1',
  public_url:'https://www.youtube.com/watch?v=AbCdEfGhI_1',
  reference_sha256:reference,original_content_sha256:original,
  derived_from:original,derivation_type:'video_transcode_h264_aac_v1',
  created_at:'2026-09-24T10:00:00.000Z',published_at:'2026-09-24T10:01:00.000Z',
  publication_status:'PUBLISHED',consent_record_id:'consent-01',
  platform_receipt_id:'receipt-01',
  consent_version:CONSENT_VERSION,monetization_consent:0
};

test('active verified registry record and account creator ownership are required',()=>{
  const e=registryEligibility(cert,prov,null);
  assert.equal(e.originalHash,original);
  assert.equal(creatorOwns(e,session),true);
  assert.equal(creatorOwns(e,{...session,accountId:'other'}),false);
  assert.equal(creatorOwns(e,{...session,creatorId:'other'}),false);
  assert.equal(registryEligibility(cert,prov,{status:'REVOKED'}),null);
  assert.equal(registryEligibility(cert,prov,{status:'DISPUTED'}),null);
  assert.equal(registryEligibility(cert,null,null),null);
});

test('platform URL is server-derived and YouTube ID is strict',()=>{
  assert.deepEqual(platformReference('youtube','AbCdEfGhI_1'),{
    platform:'youtube',platformPostId:'AbCdEfGhI_1',
    publicUrl:'https://www.youtube.com/watch?v=AbCdEfGhI_1'
  });
  for (const bad of ['evil.com','AbCdEfGhI_1?x=1','../../passwd','']) {
    assert.equal(platformReference('youtube',bad),null);
  }
  assert.equal(platformReference('other','AbCdEfGhI_1'),null);
});

test('publication requires a previously trusted derivative bound to same parent and output',()=>{
  const manifest={
    schema:'SIGILLUM_TRUSTED_DERIVATION_V1',hcvId:id,
    parent:{kind:'original',sha256:original},
    output:{sha256:reference,byteLength:1234,mediaType:'video'},
    transform:{operation:'video_transcode_h264_aac_v1',editorialImpact:'non_editorial'},
    signature:'x'.repeat(64)
  };
  assert.ok(trustedDerivation(JSON.stringify(manifest),id,reference,original));
  assert.equal(trustedDerivation(JSON.stringify({...manifest,
    parent:{kind:'original',sha256:'0'.repeat(64)}}),id,reference,original),null);
  assert.equal(trustedDerivation(JSON.stringify({...manifest,
    output:{...manifest.output,sha256:'0'.repeat(64)}}),id,reference,original),null);
  assert.equal(trustedDerivation(JSON.stringify({...manifest,
    transform:{...manifest.transform,editorialImpact:'edited'}}),id,reference,original),null);
});

test('public reference is fail closed on consent, state, hashes and URL',()=>{
  const e=registryEligibility(cert,prov,null);
  const shown=publicPublication(pub,e,consent,receipt);
  assert.equal(shown.publicUrl,pub.public_url);
  assert.equal(shown.socialFileVerdict,'NOT_VERIFIED');
  assert.equal(shown.certificateVerdict,'CERTIFICATE_RECORD_VERIFIED');
  assert.equal(publicPublication({...pub,publication_status:'UNAVAILABLE'},e,consent,receipt),null);
  assert.equal(publicPublication({...pub,reference_sha256:'x'},e,consent,receipt),null);
  assert.equal(publicPublication({...pub,public_url:'https://evil.example'},e,consent,receipt),null);
  assert.equal(publicPublication(pub,e,{...consent,state:'WITHDRAWN'},receipt),null);
  assert.equal(publicPublication(pub,e,consent,null),null);
  assert.equal(publicPublication(pub,e,consent,{...receipt,uploaded_sha256:'0'.repeat(64)}),null);
});
console.log('VERIFIED_ORIGINALS_V2_POLICY_TESTS_COMPLETE');
