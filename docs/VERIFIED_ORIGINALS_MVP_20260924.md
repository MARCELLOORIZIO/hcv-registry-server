# SIGILLUM Verified Originals — staged registry MVP (2026-09-24)

Status: DRAFT / NOT DEPLOYED. Independent of HCV Film, v0.4 and BUILD128.
This change offers discovery of an authorized audiovisual reference, not proof
that a particular Instagram/TikTok/YouTube download is byte-identical.

## Product flow

1. Capture A: original HCVPACK remains with the creator; signed HCV certificate
   and ORIGINAL_SHA256 are in the Registry. No video automatically uploaded.
2. A explicitly opts in to a public reference and separately chooses whether
   SIGILLUM may monetize it. Rights in video, soundtrack and identifiable people
   require appropriate clearance.
3. A TRUSTED, authenticated SIGILLUM publishing worker must read the certified
   source media, verify source SHA256 against its HCV certificate, render the
   public copy, hash the actual bytes it uploads, and record the SHA256 and audit
   reference. Merely writing "pipelineVerified": true is NOT a cryptographic
   attestation of this process.
4. Upload is performed from SIGILLUM's official authorized YouTube account.
   Confirm video ID, successful platform processing, public visibility and that
   the viewed rendition is available. The SHA256 of the UPLOADED file does NOT
   equal SHA256 of the transcoded video STREAMED by YouTube.
5. Restricted internal POST registers HCV-ID, source hash, rendition hash,
   YouTube ID, consent record, rights assertion and worker audit ID.
6. B searches HCV-ID: /verify/HCV-... handles certificate status; separate
   /api/verified-originals/HCV-... exposes the audiovisual reference (if eligible).
   /originals/HCV-... gives a public page without self-hosting the video.
7. Withdrawal revokes the reference in SIGILLUM, but an operator must also
   unpublish/delete the YouTube post and preserve a private audit event.
   A revoked/disputed certificate hides the reference independently.
8. None of these steps proves the truth of the scene or integrity of an
   arbitrary third-party social copy bearing a copied HCV-ID.

## Operational security

- The new Registry API is staged; POST requires
  SIGILLUM_VERIFIED_ORIGINALS_ADMIN_TOKEN (32+ characters, server-side ONLY).
  Without that secret all publication/withdrawal writes fail closed.
- Never expose that token in Flutter, URLs, QR codes, or creator devices.
- /api/verified-originals returns no reference for withdrawn, legacy,
  unverified, revoked, disputed or hash-mismatched certificates.
- The /api/certificate existing protocol stays unchanged.
- Monetization permission is a separate affirmative TRUE/FALSE choice;
  never infer it from permission to display a reference.
- Binding currently checks an operator-recorded consent subject equals the
  creatorId in the signed certificate. The trusted publisher must verify a
  creator-authenticated consent event (signature or logged authenticated
  session). JSON metadata alone is NOT proof of human consent.
- This extension DOES NOT include a YouTube OAuth integration, uploader,
  consent-capture UI, automatic takedown or media-original verification
  worker. Do not enter real publications before these exist and pass audit.
- The publisher token authenticates the trusted pipeline only; it does not
  independently attest a rendition or its derivation. No byte-integrity
  "green" for the YouTube-streamed copy.
- Use actual platform availability monitoring and link-removal procedures.
- Require privacy/minors/rights checks and clear licensing and payout rules.
- YouTube's reused-content policy may make raw reposts ineligible for YPP
  even with creator permission; do not promise advertising revenue.

## Endpoints

GET /api/verified-originals/HCV-0123456789ABCDEF
  {hcvId, availability:"REFERENCE_AVAILABLE", youtubeUrl,
   originalSha256, renditionSha256, publishedAt,
   certificateVerdict:"CERTIFICATE_RECORD_VERIFIED",
   socialFileVerdict:"NOT_VERIFIED", note}

GET /originals/HCV-0123456789ABCDEF
  Public link to verified Registry page and YouTube reference.
  No untrusted user-supplied URLs.

POST /api/verified-originals (operator only; staged)
{
  "hcvId":"HCV-0123456789ABCDEF",
  "originalSha256":"<64 hex from signed certificate>",
  "renditionSha256":"<64 hex from actual SIGILLUM output bytes>",
  "uploadedAssetSha256":"<same rendition SHA256 after read-back by worker>",
  "pipelineVerified":true,
  "pipelineAuditId":"unique-worker-audit-id",
  "youtubeVideoId":"AbCdEfGhI_1",
  "rightsConfirmed":true,
  "consent":{
    "version":1,
    "hcvId":"HCV-0123456789ABCDEF",
    "originalSha256":"<same source SHA256>",
    "creatorSubject":"<signed certificate meta.identity.creatorId>",
    "grantedAt":"2026-09-24T09:00:00Z",
    "recordId":"unique-consent-record-id",
    "publishReference":true,
    "monetize":false
  }
}

POST /api/verified-originals/HCV-0123456789ABCDEF/withdraw
Authorization: Bearer <server-only operator token>
{"auditId":"unique-withdrawal-audit-id"}

No self-serve creator POST exists in this MVP. It must not be mistaken for a
production consent solution. The write route remains disabled by default.

## Next production gate

YouTube channel creation/verification requires account-owner action; ChatGPT
has not opened a channel or received OAuth credentials. Build consent capture,
trusted upload and byte hashing, webhook/poll for completed processing,
withdrawal/takedown, account confirmation, rights compliance, then run real
end-to-end tests. PR remains draft; do not merge or deploy prematurely.
