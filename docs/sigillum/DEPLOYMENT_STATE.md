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
