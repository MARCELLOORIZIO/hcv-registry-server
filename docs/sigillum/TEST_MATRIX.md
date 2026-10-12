# Local verification — 2026-10-12

Node connector suite: 47 tests passed, 0 failed, 0 skipped. Includes existing scoped/expired/revoked/replay checks, synthetic R2 capture, credential hash/revocation, loopback HTTP and four added dispatcher regressions.

Added tests use the actual principal verifier for unknown, expired and revoked token claims across initialize/tools-list/tools-call/initialized. They assert zero grant/decryption access. Internal storage error test checks only AUDIT_FAILED reaches the client.

Limits: mocked database, synthetic image bytes; no production database integration, actual OAuth, real protected photos, iPhone, TestFlight or App Store acceptance tested here. These results do not establish connector completion.

## Follow-up integration validation

Added actual Registry factory test with PGlite SQL, actual RSA-signed primary reference manifest and AES-GCM/SHA256 materializeReference against encrypted in-memory synthetic S3 data. Certificate/provenance verification and accountEnvelope remain controlled synthetic stubs; this is not a live account, PostgreSQL network service or actual R2 test. Exact byte preservation, pending denial, actual existing owner approval handler, replay, inactive subscription, invalid rights, revoke-during-decrypt and expire-during-decrypt covered.

Dedicated request tests cover principal-only channel binding, pending state, undisclosed browser secret, audit event and ten-per-five-minute rate limit. CI now runs the factory and request SQL tests.

Results for this follow-up: 57 connector tests passed (54 boundary/unit plus 3 SQL/factory/request tests). Nine existing audit scope/route/browser/one-link tests passed separately, plus primary_reference_provider_test exact decrypt/binding regression passed. One initial audit-suite launch failed because pg installation was still pending; after installation the affected suite passed with no skips. Git diff whitespace check passed. Real PostgreSQL CI remains a separate acceptance gate.

## GitHub CI verified for d3da54d9

All four runs passed: Connector Boundary 38285197808; Verified Originals production PostgreSQL 38285197814; R2 audit security 38285197825; Registry account check 38285197987. PostgreSQL 16 production/audit and patched runtime regressions therefore passed remotely. The new connector factory integration uses PGlite and synthetic encrypted S3 in its dedicated test; live original receipt/rendering and real OAuth remain untested.
