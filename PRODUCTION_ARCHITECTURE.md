# SIGILLUM Registry production target

## Production decision

The current Free Render + local SQLite setup is development-only. Production target is:

- Render paid web service running stateless Node.js;
- Render managed PostgreSQL in the same EU region;
- public GET verification endpoints remain unauthenticated;
- account, identity and certificate-write endpoints are authenticated;
- certificate insert is immutable: an existing HCV-ID cannot be overwritten;
- server validates HCV-ID consistency and the existing HCV signature before persistence;
- account identity is bound to account ID first, then authorized devices;
- email verification, password reset, consent-version records and subscription entitlement are server-side;
- KYC/Stripe sessions require an authenticated account and use an internal account reference rather than a legal name in metadata where unnecessary;
- no original photo/video media is stored by the Registry unless a future feature explicitly requires it;
- health checks include database connectivity;
- rate limiting and audit logging must remain correct if the service scales to multiple instances.

## Migration rule

The app capture/certification payload is treated as an immutable external contract. Database and authorization migration must adapt around that contract instead of changing it.
