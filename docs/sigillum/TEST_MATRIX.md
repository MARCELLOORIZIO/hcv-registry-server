# Local verification — 2026-10-12

Node connector suite: 47 tests passed, 0 failed, 0 skipped. Includes existing scoped/expired/revoked/replay checks, synthetic R2 capture, credential hash/revocation, loopback HTTP and four added dispatcher regressions.

Added tests use the actual principal verifier for unknown, expired and revoked token claims across initialize/tools-list/tools-call/initialized. They assert zero grant/decryption access. Internal storage error test checks only AUDIT_FAILED reaches the client.

Limits: mocked database, synthetic image bytes; no production database integration, actual OAuth, real protected photos, iPhone, TestFlight or App Store acceptance tested here. These results do not establish connector completion.
