# Open issues — current checkpoint

1. Real OpenAI private connection registration, exact predefined client/redirect validation, operator deployment/activation permission and actual Render edge acceptance. OAuth/SDK host implemented locally, not connected to ChatGPT.
2. Real original delivery/rendering for the two existing photo cases, followed by expiry/revocation/replay acceptance on actual data. Prior owner grant expired; do not bypass approval.
3. Large-photo/video protected resource transfer. Current inline photos are bounded at eight MiB; unsupported formats/size fail closed. No lossy conversion allowed.
4. OAuth refresh/connection lifecycle UX and expired-flow/token/rate-row retention policies before broad public release. Minimal implementation deliberately does not advertise offline_access/refresh.
5. Full app file/call-graph review and reported defect reproduction: display false positives, altered photos, identical originals, Messenger derivatives, subtitles, purchases, GPS, text and UI. No resolution claimed without test evidence.
6. Actual Codemagic/App Store/TestFlight artifact identity: experiment pubspec149 versus reported157; device preprocessing parity remains unverified.

Confirmed fixes: principal verification on all valid MCP methods; internal error redaction; grant/device/owner/entitlement checks after slow decryption; immutable principal-bound PENDING requests; explicit connector-specific owner consent; request rate limit; failed-read audit logs. Existing original reader is reused.

Implemented but not deployed: OAuth PKCE flow and remote SDK transport with account/device/issuer/resource/scope binding. Native HTTPS + official SDK client + synthetic encrypted SQL fixture passes; this does not establish real original acceptance or production readiness.
