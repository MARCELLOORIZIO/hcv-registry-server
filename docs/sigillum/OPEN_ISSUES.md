# Priorities

1. Complete secure owner-to-connector principal grant exchange and OAuth/client provisioning. Existing store is admin-only token storage, not an end-user OAuth flow.
2. Implement standards-compatible authenticated HTTPS MCP transport; loopback HTTP cannot be registered as the production connector.
3. Wire factory-private R2 functions and actual eligibility checks without duplicating decryption. Review revocation/expiry races through streaming and log failures.
4. Prove real original receipt/rendering, then expiry/revocation/replay and existing endpoint regressions. Previous owner grant expired; no bypass allowed.
5. Inspect actual iOS build artifact/source correspondence: experiment pubspec149 versus reported build157.
6. Complete file-level review, verification graph and app defect reproduction before changing display/integrity logic.

Confirmed and fixed in experimental dispatcher: metadata/initialization skipped principal verification; arbitrary internal storage errors were returned to the MCP client.

Not confirmed resolved: false display positives, altered photos, Messenger derivation, subtitles, premium purchases, GPS, text and UI issues described in the uploaded handoff.

## Follow-up status

In-process production-factory reader composition and principal-bound PENDING request creation are now implemented and tested against a synthetic encrypted SQL fixture. Remaining: real OAuth provisioning/owner identity binding, authenticated remote transport/registration, real-data visual acceptance, real PostgreSQL regressions and full app review. They are not activated by this code.
