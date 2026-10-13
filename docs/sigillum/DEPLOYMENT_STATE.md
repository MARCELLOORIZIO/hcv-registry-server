# Observed state — 2026-10-12

GitHub connector metadata and git clones agree:
- Backend PR49/50 merged; release base and latest Render LIVE commit b83cfcd213de1e594829fcd2c563fa7d1c50aa62.
- Render service srv-d9u3inbm8hqs73eee5g0, Frankfurt, npm install / npm start, auto deploy off.
- PR51 open draft, starting HEAD 8af22cb751397c7c67933cedde851cbfe72229fa.
- App PR139 open draft, HEAD f7023853bcdfce927fd760357fe427e9d92ad34b.
- App experiment pubspec.yaml says 1.0.0+149. Reported build157 cannot be established from that value; Codemagic and App Store Connect artifact records still need checking.

No production deployment, merge, migration application or remote MCP activation performed in this checkpoint. Experimental connector changes only.

## PR51 follow-up

Published implementation d3da54d9f5e5819f00c307926a2b7dadd322ec95; all four associated CI suites passed. Experimental in-process factory integration and request/approval boundary implemented. No remote MCP endpoint activated, no migration applied in production, no production deploy or merge.

## Optional connector activation configuration (not applied)

SIGILLUM_CONNECTOR_ENABLED defaults off. Explicit enabled startup requires SIGILLUM_CONNECTOR_OAUTH_CLIENTS_JSON with exact predefined public client and callback from OpenAI management; SIGILLUM_CONNECTOR_TLS_MODE=NATIVE_TLS or RENDER_EDGE; existing SIGILLUM_DELEGATED_AUDIT_ENABLED=true and canonical HTTPS SIGILLUM_DELEGATED_AUDIT_ORIGIN. RENDER_EDGE additionally requires platform RENDER, RENDER_EXTERNAL_HOSTNAME and RENDER_SERVICE_ID to match the reviewed deployment, with forwarded HTTPS traffic accepted only under that explicit platform trust policy. No environment variables were changed.

Remote endpoint when explicitly activated: /connector/mcp. Resource discovery: /.well-known/oauth-protected-resource/connector/mcp. Authorization-server discovery: /.well-known/oauth-authorization-server. OAuth routes: /connector/oauth/authorize, /consent, /token, /revoke. OAuth migration is separate and not applied while disabled. Exact public OpenAI callback has not been observed in a signed-in management page yet.

## Authorized rollout — 2026-10-12 21:39 UTC

The user explicitly authorized Registry deployment and OAuth activation in the conversation. PR51 merged into release/reconciled-prelaunch-backend-clean-20260824 at a678bdfd976b554e38679160efba6b08896a6ef6. All four PR CI suites on bac064e8456a36c0d36de028dc0026161e4278b0 succeeded (38290687095, 38290686789, 38290686728, 38290686736). Render deployment dep-db6l6dc8q0ns73ebgkpg is LIVE at that merge commit.

Before rollout SIGILLUM_CONNECTOR_ENABLED was explicitly set to false, merging rather than replacing existing environment variables. This environment change automatically triggered a redeploy of the old commit; the separately triggered new-commit deploy completed subsequently. Remote MCP/OAuth remains inactive pending the exact ChatGPT predefined public OAuth client/redirect. No fabricated callback, shared owner credential or dynamic unrestricted registration was configured. Optional OAuth schema remains inactive. Production originals have not been received or visually inspected. Owner device email confirmation was reported, but the browser audit request expired and no valid original-read grant was obtained.

Cloud Browser credential protection blocks the original audit workflow and the attempted ChatGPT management page. Private connection registration cannot be performed with the currently available plugin tools. Deployment authorization persists; do not ask for it again. Obtain actual account connection metadata and validate edge behavior before activation. Rollback code baseline: b83cfcd213de1e594829fcd2c563fa7d1c50aa62; keep connector disabled until configuration and acceptance are complete.

## OAuth activation — 2026-10-13 07:43 UTC

User supplied exact ChatGPT callback https://chatgpt.com/connector/oauth/MF2jG4JPscn8. Predefined public client sigillum-chatgpt-private configured with only that redirect; token endpoint authentication none, S256 PKCE, scope sigillum:originals:read. Explicit authorization from the prior conversation covers activation and deployment. Render environment variables merged (no secret inspection): SIGILLUM_CONNECTOR_ENABLED=true, SIGILLUM_CONNECTOR_TLS_MODE=RENDER_EDGE, existing delegated audit enabled and canonical origin configured. Deployment dep-db6u1h59fdbs73ec73d0 is LIVE at 03071ad9f4c80de572b3ced34021267c2b4ee2bd.

Live edge HTTP checks: health200/database=true; authorization metadata200 and protected resource metadata200 with canonical issuer/resource and expected scope/PKCE; unauthenticated MCP401 with WWW-Authenticate resource metadata; hostile Origin403. These establish actual Render edge routing and fail-closed unauthenticated access, not authenticated OAuth completion, MCP tool acceptance or original rendering. User must complete private plugin creation with the same client/callback and account connection consent; original-read consent remains separate. If the management form generates a new callback, stop and update only after receiving that exact value. No original media read or visual diagnosis completed.

## Callback correction — 2026-10-13 07:53 UTC

A newly opened ChatGPT creation form displayed callback https://chatgpt.com/connector_platform_oauth_redirect, confirmed by the user's text and screenshot. Replaced the previous callback in the allowlist; sigillum-chatgpt-private now accepts only this exact URI. Existing public-client/no-secret/none/S256 policy unchanged. Environment update triggered deployment dep-db6u68ou01pc73bk945g, verified LIVE at 349b40cf048e74ef9ad74e91d89c476e16b53280. Post-deployment health and OAuth authorization metadata both200. Screenshot still showed empty client ID; user instructed to enter predefined ID. No completed ChatGPT OAuth, tool discovery or original receipt is claimed.
