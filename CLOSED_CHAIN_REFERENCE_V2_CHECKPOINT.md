# Verified Originals closed-chain backend checkpoint

Date: 2026-09-25
Status: IN PROGRESS
Base branch: release/reconciled-prelaunch-backend-clean-20260824
Feature branch: feature/closed-chain-reference-v2-20260925
Companion app branch: MARCELLOORIZIO/sigillum-hcv:feature/build133-closed-chain-vault-youtube-20260925

## Locked backend requirements

- Publication must NOT be gated on displayRiskDecision.
- Publication must fail closed unless the certificate is Registry-provenance verified and is a signed SIGILLUM camera capture.
- Uploaded bytes must exactly match certificate content SHA-256 and content size.
- Creator/account/device ownership checks remain mandatory.
- Support canonical video uploads and canonical photo uploads; a photo reference is converted server-side to a signed non-editorial MP4 derivative before YouTube upload.
- Bind HCVPACK SHA-256 to the publication/audit record and include it in public-reference metadata/description; do not pretend YouTube stores .hcvpack attachments.
- Reference is created before app social export is allowed.
- YouTube remains server-only; no YouTube credentials in the app.
- IT/EN/ES/RU external/public copy must be audited.
- Existing release branch remains untouched until tests pass.

## Progress log

- 2026-09-25: feature branch created.
- 2026-09-25: implementation started.
- 2026-09-25: publication now requires signed HCV camera-capture provenance in addition to Registry provenance/account/device/creator binding; display-risk verdict is explicitly not a publication gate.
- 2026-09-25: exact original ingest now supports VIDEO MP4 and PHOTO JPEG/PNG. Photos are converted server-side into a 5-second signed non-editorial MP4 reference.
- 2026-09-25: HCVPACK SHA-256 is required, stored in publication/audit metadata and included in the YouTube reference description alongside original SHA-256 and Registry URL.
- 2026-09-25: public /originals page localized for IT/EN/ES/RU.
- 2026-09-25: contract/integration tests updated for camera provenance and HCVPACK binding.
- 2026-09-25: added `.github/workflows/closed-chain-reference-v2-validation.yml`.
- 2026-09-25: backend validation run `36117377113` GREEN. Full backend checks and Verified Originals PostgreSQL integration test both passed.
- 2026-09-25: legal documents updated in IT/EN/ES/RU for encrypted local originals, temporary reference processing and YouTube hosting; legal revision is now 2026-09-25 and CI run 36119439169 passed.
- 2026-09-25: withdrawal semantics confirmed: the active reference is taken down while HCV/Registry verification remains available.
- 2026-09-25: full PostgreSQL photo publication path added to `verified_originals_production_test.js`; canonical JPEG is verified, converted to `photo_to_reference_video_v1`, uploaded through the mocked unlisted YouTube path, stored with HCVPACK SHA-256, and exposed through the paid `/view` route. CI run `36120172433` GREEN.
- 2026-09-25: YouTube platform preflight rechecked against current official Google documentation. API projects created after 2020-07-28 that are still unverified have uploads forced to private until the YouTube API compliance audit is passed; this must be resolved before the live unlisted-reference test. OAuth consent is still in Testing, so its refresh token is time-limited and must not be treated as production-stable.
- 2026-09-25: YouTube Data API video insert/update does not expose a per-video switch that disables comments. Comments-off must therefore be configured in YouTube Studio/channel upload defaults (and verified on the controlled live upload), not falsely represented as enforced by `verified_originals_production.js`.
- 2026-09-25: draft PR `#35` opened into `release/reconciled-prelaunch-backend-clean-20260824`; intentionally not merged or deployed.\n- Remaining before release: live YouTube compliance/upload test; confirm channel comments-off default; align production TERMS_VERSION and PRIVACY_VERSION with 2026-09-25 before deployment; no production deploy yet.

- 2026-09-25: post-audit backend hardening applied. Runtime registration now assigns Creator IDs server-side rather than trusting a device-carried ID; LIVE readiness requires YouTube credentials, compliance approval, confirmed unlisted upload capability and derivation signing material; HCVPACK publication hash now requires a device-key signature; withdrawal is idempotent/retryable, records `takedown_pending`, treats already-deleted YouTube objects as success, and includes a periodic retry worker so a transient YouTube failure cannot be reported as permanently complete. No merge/deploy.

## Resume rule

Resume from this file and the app checkpoint. Do not re-design already locked decisions unless a failing test or external platform constraint forces a change.

## 2026-09-29 Official-copy fingerprint V3

- The server computes the V3 visual fingerprint from the SIGILLUM official derivative before YouTube upload.
- Fingerprint parameters match the app exactly: 128x72 grayscale, 16x9 grid, mean/range/edge features, global frame hash, 2 fps video sampling, max 120 frames.
- The fingerprint is embedded in `statement.output.referenceVisualFingerprint` inside the RSA-signed trusted derivation manifest.
- `activeReference` validates the signed manifest before exposing the fingerprint; public availability exposes the fingerprint but does not expose the YouTube locator.
- Cross-language golden matches the app: globalHash `03030f0f1f1f7f7f`; local-feature SHA-256 `4ae46d0f4d9b9f5ef680cb4c6eda75b67a2a1a3a4037e336efe34b748265bcd4`.
- Closed-chain backend validation GREEN. No Render deployment performed.

## 2026-09-30 V3 RGB hardening and real-media regression

- Official derivative fingerprint upgraded to `SIGILLUM_LOCAL_RGB_GRID_V3`: RGB24 normalized frames, 128x72, 16x9 grid, luma mean/range/edge + RGB means.
- Signed derivation manifest continues to bind `output.referenceVisualFingerprint` before YouTube upload.
- Real FFmpeg regression is mandatory in `npm run check`: H.264/JPEG recompression remains conforming; small UFO insertion, hue change, brightness change and crop are all classified modified for both video and photo workflows.
- Photo regression uses the real SIGILLUM photo -> 5-second MP4 official-reference transform before comparison against recompressed JPEG social copies.
- Backend validation GREEN after RGB hardening. No Render deployment performed.

## 2026-09-30 Separate signed subtitle derivations

- Registry schema now distinguishes `ORIGINAL_REFERENCE` from `DERIVED_REFERENCE`; `activeReference()` resolves only the original role, so a captioned publication can never replace the canonical official reference.
- Added signed subtitle derivation contract `SIGILLUM_SUBTITLE_DERIVATION_V1` / `subtitle_burn_in_reference_v1`.
- Captioned upload requires an already active original reference plus a device signature over `SIGILLUM_SUBTITLE_DERIVATION_BINDING_V1|HCV-ID|original SHA-256|captioned SHA-256|SRT SHA-256|HCVPACK SHA-256`.
- Server normalizes the captioned MP4, computes V3 visual fingerprint, signs/persists a trusted derivation manifest, uploads an unlisted YouTube derived reference, verifies platform receipt, then stores a `DERIVED_REFERENCE` publication containing source and subtitle hashes.
- Idempotent lookup reuses an existing active captioned reference only when captioned-video SHA-256 and SRT SHA-256 both match.
- Backend validation GREEN at commit `a111f8ade851edb721056553c97f94f43ebe1c07`.
- No Render deployment performed.


## 2026-09-30 Live YouTube reference attestation and publication retry hardening

- Added GET `/api/verified-originals/:hcvId/verification-reference`. The endpoint resolves only the active ORIGINAL_REFERENCE, re-authenticates the configured YouTube publisher, verifies the expected channel, checks the current YouTube video status and returns the signed V3 fingerprint only while the platform object is still usable.
- Live-reference mode is `YOUTUBE_LIVE_ATTESTED_SIGNED_V3`. The endpoint does not expose the YouTube locator. Removed/out-of-band deleted YouTube objects resolve to REFERENCE_NOT_AVAILABLE instead of producing a server error.
- Publication now verifies the comments state after the YouTube upload. The YouTube Data API still does not expose a supported per-video comments-off switch through videos.insert/update, so SIGILLUM does not claim to set it there. Instead the controlled channel must be configured comments-off in YouTube Studio; if the uploaded video does not actually report comments disabled, the backend deletes the candidate reference and fails closed with YOUTUBE_COMMENTS_MUST_BE_DISABLED.
- YouTube OAuth access tokens are cached in-process until shortly before expiry and expected-channel verification is cached for a bounded TTL (default 5 minutes), avoiding redundant token/channel calls on every verification while preserving live per-reference status checks.
- Trusted original and subtitle derivations are now retry-idempotent. If a deterministic output SHA-256 already has a stored trusted derivation, the server verifies the existing signed manifest and all parent/source/output/V3 bindings and reuses it; it does not generate a new nonce that would conflict after a temporary YouTube failure.
- Integration coverage now exercises: comments-enabled rejection + cleanup, successful retry of the exact same original, cached OAuth/channel preflight, live-reference success, out-of-band missing YouTube reference, and no signed V3 disclosure while the live reference is unavailable.
- Platform limitation recorded explicitly: the official YouTube Data API exposes video metadata/status operations but no supported endpoint for downloading the transcoded media bytes. No scraping/yt-dlp/undocumented extraction is used. The current compliant chain therefore attests the real YouTube object live and binds it to the RSA-signed V3 generated from the exact trusted derivative uploaded to that object. Direct fresh-transcode byte/frame comparison remains unavailable without a supported media-byte source.
- Closed-chain backend validation GREEN at commit 79efb2923280d89a97d31620f6a8b79470ae4025: run 36700673428.
- No Render deploy, release-branch merge/rebase or production credential change was performed.


### 2026-09-30 follow-up hardening

- Added a bounded live-reference status cache to reduce repeated YouTube API latency. Positive/negative status is cached by platform video ID with `YOUTUBE_REFERENCE_STATUS_TTL_MS`; accepted range is 1–30 seconds and the production default is 5 seconds. The endpoint exposes `cacheHit` and reports `youtubeCheckMs=0` on a cache hit. Tests verify cache expiry returns an out-of-band removed YouTube object as REFERENCE_NOT_AVAILABLE.
- Extended the real-media V3 regression through four consecutive social-like recompression generations for both video and photo. Generations 1–4 remain conforming, while the existing small-object insertion, hue, brightness and crop mutations remain modified.
- Latest functional backend validation GREEN at commit `692be12f354911e4a04979c1fef7a9827cfc6149`: run `36701623366`.
- Current branch comparison against `release/reconciled-prelaunch-backend-clean-20260824`: diverged, 38 commits ahead and 1 behind. Reconciliation remains intentionally deferred to the final release consolidation.


### 2026-09-30 final follow-up before production/live test

- YouTube publication cleanup is fail-closed across comment-status failures: if the post-upload comment-state API call errors, the just-uploaded candidate is deleted before the error is propagated; comments-enabled candidates are likewise deleted.
- Closed-chain validation GREEN at exact feature HEAD `7786ba037af9f28ab454fc5e784897b15fb567dc`, run `36701824508`, including comments-status cleanup, idempotent retry, live-reference attestation/cache expiry and the four-generation V3 real-media regression.
- Current branch is diverged from `release/reconciled-prelaunch-backend-clean-20260824`: 41 commits ahead and 1 behind. Reconciliation remains deferred until the final release consolidation.
- Render production inspection confirms `sigillum-registry-production` uses that release branch with auto-deploy OFF. Current live deployment is commit `3e62c5afc2c94f2585dbfefbe7c0981a1233b083` deployed 2026-09-25; none of this feature branch's live-reference/cache/comment-status changes are production-deployed yet.
- Render connector exposes service/deploy configuration but no read operation for environment-variable values. Therefore OAuth client/refresh-token/channel readiness is not marked complete from configuration inspection alone; it remains a live production test item.
- No Render deploy, production environment-variable mutation, release merge/rebase or credential rotation was performed.
