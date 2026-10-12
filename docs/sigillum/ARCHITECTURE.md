# Verified architecture checkpoint — 2026-10-12

Scope: entry points and connector boundary inspected directly; not a completed review of every file.

Registry: Render Frankfurt starts `npm start`; package.json executes the ordered Python prestart patchers before `node production_server.js`. `server.js` is a legacy alternative. `tool/apply_verified_originals_production.py` injects the production factory, request hook and schema initialization. Reading only unpatched production_server.js is insufficient.

`verified_originals_production.js` creates delegated_reference_audit with account authentication and accountEnvelope, and holds activeR2Reference/streamR2Reference inside its factory. The browser audit consumes a read authorization, rechecks lifecycle job identity and streams through the existing R2 materializeReference path. These functions are not standalone module exports. Connecting MCP requires a deliberate factory-level integration, not invented public exports.

PR51: HTTP loopback -> dispatcher -> connector bridge -> PostgreSQL grant adapter -> injected eligibility checker -> R2 capture adapter -> injected existing streamer -> MCP image. Credential store and principal verifier are separate modules. No production import of the MCP HTTP host exists. Grants require principal hash, approved state, exact scope, unrevoked device, certificate owner and injected current eligibility; reservation commits before decryption.

App: lib/main.dart purges materialized plaintext in HCVSecureMediaVault before runApp. User entry goes through CommercialGate; lab entry uses HomePage. Camera photo claims include framing evidence, visual diagnostic and semantic diagnostic. Semantic inference checks the asset checksum, bakes orientation, uses average RGB resize to 160x160 and float32 NCHW input; native source-JPEG parity remains explicitly unverified.

Codemagic validates committed source, pins TFLite iOS runtime, installs pods, checks TensorFlowLiteSwift 2.17.0, and builds IPA. Automatic TestFlight triggers name release branches, not the photo experiment. Identity, subscriptions and full verification call graphs require further inspection.

## In-process integration added in PR51 follow-up

The real createVerifiedOriginalsProduction factory now exposes createConnectorService, which injects its own private activeR2Reference and streamR2Reference into MCP; no public HTTP route calls it. Current entitlement uses accountEnvelope with the approving device. Owner certificate and active publication consent/rights are checked in SQL; activeR2Reference reuses certificate/provenance, lifecycle, private receipt and manifest validation. Only photos are eligible for inline transport.

Authenticated MCP can create a PENDING principal-bound audit request. Principal hash is immutable from creation, the browser hash has a random undisclosed preimage, and old browser grants are never rebound. Existing owner approval checks exact HCV scope and ownership. Owner UI explicitly distinguishes connector approval from browser approval. Requests have a SQL transaction advisory lock and ten-per-five-minute principal limit.

The read adapter checks grant, device, owner and eligibility both before reservation and after decryption. Failed reads stay consumed and are logged READ_FAILED. This prevents returning bytes after revocation/expiry during materialization. Grant locking does not claim atomicity with independent subscription/publication transactions or the entire outgoing network transfer.

## OAuth and remote host follow-up

verified-originals factory -> createConnectorRemoteHost -> OAuth engine + remote handler -> official SDK Server/StreamableHTTPServerTransport -> existing MCP dispatcher -> original grant/read path. Owner connection UI -> existing device-bound /api/auth/login -> same-origin consent endpoint with per-flow secure HttpOnly cookie -> monouse code -> public-client PKCE token endpoint. Raw codes, CSRF values and tokens are never persisted; only hashes are stored. Account/device identity is from existing authenticate/accountEnvelope, not MCP arguments.

Optional startup runtime is injected only after the existing verified-originals materializer. It stays inert by default; enabled startup requires explicit OAuth clients, shared owner-approval origin and NATIVE_TLS or RENDER_EDGE transport policy. Render mode requires actual Render service environment identity and the canonical onrender hostname; trust of the platform edge/private network is an explicit deployment assumption that still needs isolated acceptance. SDK host does not create public R2 URLs.
