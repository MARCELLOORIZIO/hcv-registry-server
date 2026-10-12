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
