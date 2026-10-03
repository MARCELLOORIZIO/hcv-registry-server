# SIGILLUM Registry production target

## Production decision

The production architecture is:

- Render paid web service running stateless Node.js;
- Render managed PostgreSQL in the same EU region;
- public GET verification endpoints remain unauthenticated;
- account, identity and certificate-write endpoints are authenticated;
- certificate insert is immutable: an existing HCV-ID cannot be overwritten;
- server validates HCV-ID consistency and the existing HCV signature before persistence;
- account identity is bound to account ID first, then authorized devices;
- email verification, password reset, consent-version records and subscription entitlement are server-side;
- KYC/Stripe sessions require an authenticated account and use an internal account reference rather than a legal name in metadata where unnecessary;
- certified originals remain encrypted in the app vault; when sharing is requested, the backend commits an encrypted official technical reference to a private Cloudflare R2 bucket in EU jurisdiction before social export is released;
- R2 is the only permitted LIVE primary-reference provider; social platforms are optional downstream distribution targets and never authoritative primary storage;
- reference objects are encrypted before upload with AES-256-GCM, have opaque object keys, no permanent public URL, and are exposed only through authenticated short-lived one-use access;
- withdrawal revokes API availability before physical R2 deletion and deletion retries fail closed until provider absence is confirmed;
- health checks include database connectivity;
- rate limiting and audit logging must remain correct if the service scales to multiple instances.

## Migration rule

The app capture/certification payload is treated as an immutable external contract. Database and authorization migration must adapt around that contract instead of changing it.
