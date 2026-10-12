# SIGILLUM resume checkpoint — 2026-10-12

## Current implementation

PR51 branch: feature/sigillum-chatgpt-connector-contract-20261012. Starting parent for OAuth/HTTPS follow-up: 0fe8df466ad4175498d14497a4c0dd4be375b9a6. Production remains separate; no merge/deploy/config changes performed.

Implemented: principal-bound PENDING original-audit requests; explicit existing owner approval; factory-private R2 reader reuse; before/after-decrypt grant/device/owner/entitlement/consent checks; one-time reservation; audit failure logging; internal error redaction; authenticated MCP metadata methods.

Added: predefined-public-client OAuth authorization-code + S256 PKCE; browser-bound explicit connection consent; account/device-bound opaque hashed credentials; issuer/resource/scope/expiry/revocation validation; code replay invalidates its issued token; persistent SQL rate limits. Access token TTL 30 minutes, authorization code 60 seconds, consent flow five minutes. No refresh/offline_access grant is advertised or implemented. Connection consent never approves originals.

Remote HTTP: official @modelcontextprotocol/sdk 1.32.1 stateless Streamable HTTP, JSON responses, exact Host and Origin policy, 16 KiB request bound, body deadline, OAuth 401 discovery challenge, tool OAuth metadata and accurate read/request annotations. Credentials are rechecked before delivering slow tool results; rejected delivery has no image and returns reauthorization metadata.

Startup: optional Python materializer wired after existing verified-originals installer in prestart/precheck. SIGILLUM_CONNECTOR_ENABLED is OFF by default. Enabled mode requires explicit client callback allowlist and TLS policy. Schema is applied only on explicitly enabled startup. Original media/decryption and account login protocols are unchanged; browser login reuses the existing IndexedDB device key through a shared helper.

## Verification and limits

Local combined connector + existing audit tests: 77 passed with no skips; subsequent changed HTTPS boundary test also passed. Existing provider encryption/decrypt/binding regression passed. Actual local TLS and official MCP Client passed complete OAuth -> PENDING audit -> existing owner approval handler -> Registry factory -> RSA reference manifest -> existing AES-GCM/SHA256 reader -> exact synthetic PNG bytes -> replay denial. Synthetic account authentication/certificate/provenance adapters and encrypted in-memory S3 objects are used; SQL uses PGlite. This is NOT real ChatGPT installation, real R2, iPhone or production original acceptance.

Previous code d3da54d9 had all four CI suites green (Connector Boundary 38285197808; production PostgreSQL 38285197814; audit security 38285197825; Registry account 38285197987). New follow-up must pass its own CI before rollout.

Plugin Management did not find SIGILLUM. Read-only Cloud Browser inspection of https://chatgpt.com/plugins showed the signed-out page; no sign-in, app registration or permissions were submitted. Tools cannot silently install this private custom connection. Exact OpenAI management-page client ID/redirect must be verified before setting the live allowlist.

## Next actions

1. Inspect new commit CI and fix failures; no production rollout on synthetic-only results.
2. Validate trusted Render edge policy and actual forwarded-proto behavior in an isolated non-production environment. Runtime RENDER_EDGE mode is explicit operator trust in Render TLS termination/private network, NOT proof supplied by arbitrary headers. Never enable it outside the verified Render service.
3. Register the private MCP connection through the real signed-in OpenAI management UI, verify exact predefined OAuth client/redirect, then configure the reviewed allowlist.
4. Obtain required owner approval for merge/deploy/activation. Previous browser original grants expired and must not be rebound or renewed silently.
5. Execute real OAuth, separate real owner original approval, actual R2 byte receipt and image rendering before declaring completion. Then investigate the two photo cases and app defects.

## Rollback

Disable SIGILLUM_CONNECTOR_ENABLED and return to previous approved deploy. New optional tables/nullable principal column are backward-compatible; do not drop historical audit events. Code rollback reverts the entire isolated OAuth/runtime follow-up including package lock, shared browser helper, materializer and tests. No existing certificate/media changes occurred.

## Sources read

https://developers.openai.com/plugins/build/auth
https://developers.openai.com/plugins/build/mcp-server
https://render.com/docs/web-services
https://render.com/docs/tls
https://render.com/docs/environment-variables

Full app review remains incomplete. FILE_INVENTORY is actual tracked paths/static imports, not proof every file has been manually reviewed. Build157 vs experiment pubspec149 requires artifact reconciliation. Never alter display thresholds to force desired results.
