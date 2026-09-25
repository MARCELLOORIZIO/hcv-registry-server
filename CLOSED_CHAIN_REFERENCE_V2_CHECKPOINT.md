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

## Resume rule

Resume from this file and the app checkpoint. Do not re-design already locked decisions unless a failing test or external platform constraint forces a change.
