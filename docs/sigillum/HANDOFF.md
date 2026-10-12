# Resume checkpoint — 2026-10-12

Read ARCHITECTURE, DEPLOYMENT_STATE, OPEN_ISSUES and TEST_MATRIX in this directory first. Inventory is generated from actual tracked paths; static edges are navigational, not a complete runtime graph.

Both repositories cloned and relevant production/bootstrap/connector/photo entry points inspected. Full-file audit remains incomplete. PR51 dispatcher now verifies principal before every valid method and exposes only allowlisted error codes. No production activation or original read performed.

Next: complete actual production-factory eligibility/reader integration design, inspect existing owner authentication and device-consent routes, verify current ChatGPT OAuth/MCP registration requirements using official documentation, then implement disabled experimental integration with real PostgreSQL regression coverage. Do not claim user-facing completion until real originals render.

Rollback: revert the isolated dispatcher hardening commit on experimental branch; no production or schema rollback needed. Avoid reverting pre-existing PR51 modules.

## Follow-up

Use createConnectorService from the real verified-originals factory when building the remote host. Do not expose raw R2 reader functions or introduce new decryption logic. Request tool creates an immutable principal-bound PENDING grant; existing owner approval must still occur. Current implementation has NO OAuth code/token endpoint and NO HTTPS remote MCP route. The local synthetic integration test requires NODE_PATH pointing to installed @electric-sql/pglite, which CI installs separately.

Rollback must revert the complete isolated follow-up changes, including factory method, request tool, owner UI disclosure, adapter rechecks and workflow/test additions. No production migration or endpoint activation was performed.

Official authentication design source read 2026-10-12: https://developers.openai.com/plugins/build/auth — supported OAuth authorization-code + S256 PKCE, protected resource metadata, resource audience, predefined OAuth clients/CIMD/DCR, issuer response validation. Existing administrative bearer issuance does not constitute that OAuth flow.
