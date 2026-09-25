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
- Remaining before release: add/confirm full photo integration path coverage; live YouTube compliance/upload test; align production TERMS_VERSION and PRIVACY_VERSION with 2026-09-25 before deployment; no production deploy yet.

## Resume rule

Resume from this file and the app checkpoint. Do not re-design already locked decisions unless a failing test or external platform constraint forces a change.
