# Delegated read-only reference audit — PR #49

The feature is **off by default**. This branch must not be merged or deployed to
production until a real Cloud Browser transport test and an owner-approved real
reference acceptance test have passed. Synthetic fixture results do not attest to
the existence, recoverability or contents of the two real photographs.

## Native backend flow

Enable only in an explicitly reviewed environment:

- `SIGILLUM_DELEGATED_AUDIT_ENABLED=true`
- `SIGILLUM_DELEGATED_AUDIT_ORIGIN=https://<exact-SIGILLUM-host>` (no trailing slash)

1. Auditor opens `/audit`, submits an explicit list (maximum 25 HCV IDs).
2. Backend creates a pending request expiring in 5 minutes. The auditor's browser
   receives a random `__Host-` Secure, HttpOnly, SameSite=Strict cookie. Neither the
   cookie nor an owner's Bearer session is included in a URL.
3. Auditor provides the owner the `/audit/approve/{requestId}` page and shows the
   request ID/browser fingerprint. This page alone gives no media access.
4. Owner signs in on that page using the existing `/api/auth/login` device-bound
   authentication. Their RSA private key is non-extractable and stored in
   IndexedDB; their password and account session are never persisted in storage
   or transferred to the auditor. New web-device enrollment requires existing
   SIGILLUM email confirmation. This approval is independent of audit consent.
5. `GET .../owner-scope` with the owner's session verifies ownership of **all** IDs
   and returns the exact scope. Owner checks IDs and fingerprint, checks explicit
   consent and clicks **Autorizza audit**. The POST must contain the matching IDs,
   scope digest and `confirm:true`. Approval is transactional, not replayable,
   requires active subscription and is logged.
6. Auditor clicks **Verifica approvazione**. A separate POST per approved ID issues
   an existing monouse reference-read authorization, mapped to this browser grant.
   The cookie and grant are revalidated before streaming. The owner's current
   subscription, ownership, approving device revocation, committed private R2
   reference and active reference consent must still be valid.
7. The native adapter calls existing `consumeReadAuthorization`, validates the
   reference binding and calls the same extracted `streamR2Reference` function as
   the normal account-authenticated reader. This uses the unchanged existing
   `materializeReference` AES-GCM/SHA-256 verification. It does not redirect to R2,
   create a public object, expose provider keys or modify reference bytes.

An approved grant lasts at most 5 minutes after approval and at most 10 minutes
from request creation. Each ID can have one issued read; replay fails. A failed or
lost read requires a fresh owner-approved request. Revocation blocks new reads;
a stream already admitted before revocation may finish. GET never approves or
revokes. POST requires the exact configured Origin. Pending requests disclose no
reference availability to unauthenticated callers.

Events: REQUEST_CREATED, OWNER_APPROVED, OWNER_REVOKED, READ_AUTHORIZED,
READ_STARTED, READ_COMPLETED, READ_FAILED, ACCESS_REJECTED. Credentials, read
tokens, cookie values, R2 object locators and plaintext are never logged. Normal
session timestamps, grants, read-token consumption and audit events are written;
original objects, certificates and reference lifecycle states are not changed by
the delegated audit.

## Exact iPhone steps once the reviewed environment is available

1. Open the concrete approval link supplied by the auditor in Safari on iPhone.
2. Enter your existing SIGILLUM email and password, then press **Accedi**.
3. If `NUOVO_DISPOSITIVO_DA_CONFERMARE` appears, open the SIGILLUM email, compare
   the displayed device fingerprint and press **CONFERMA NUOVO DISPOSITIVO**.
   Return to the original Safari approval tab and sign in again. Do not send the
   email link, password, session token or private device key in chat.
4. Verify the request/browser fingerprint and exactly these IDs:
   `HCV-D8FF76496D424CA5`, `HCV-255DEE0995364F99`.
5. Check **Autorizzo questo browser...** and press **Autorizza audit**.
6. Tell the auditor approval is complete. Keep the page open if you want to use
   **Revoca audit**. The auditor must retrieve within 5 minutes.

These controls are newly implemented in this PR, not asserted to exist in the
current production app/site. No manual original-file download is required.

## Isolated acceptance environment

`tool/delegated_audit_browser_fixture.js` is explicitly synthetic. It refuses to
start with DATABASE_URL or production R2 credentials, uses an in-memory test DB,
generates temporary encryption keys and serves two labeled test PNGs encrypted
with the actual existing `encryptReferenceFile` function. Retrieval uses the real
R2 provider `materializeReference` implementation with an in-memory GetObject
transport. No real Cloudflare or production database is contacted. The HCV IDs
are labels only in this fixture. The fixture-only approval button represents a
synthetic authenticated owner; it never grants access to real originals.

Run locally:

```
npm ci --ignore-scripts
node --test audit_reference_scope_test.js audit_reference_route_contract_test.js delegated_reference_audit_test.js
node primary_reference_provider_test.js
SIGILLUM_AUDIT_FIXTURE_ONLY=true node tool/delegated_audit_browser_fixture.js
```

Without DATABASE_URL the new HTTP tests use embedded PGlite. CI uses real
PostgreSQL 16 and validates the SQL/transaction contracts. Neither test path uses
production credentials. The browser fixture is a separate free Render service,
auto-deploy disabled, branch `experiment/secure-r2-audit-20261012`:

- Build: `npm ci --ignore-scripts --no-audit --no-fund`
- Start: `node tool/delegated_audit_browser_fixture.js`
- Environment: only `SIGILLUM_AUDIT_FIXTURE_ONLY=true`

Cloud Browser acceptance: create a request, verify unauthenticated denial, approve
synthetic data, retrieve both images through the HttpOnly-cookie flow, inspect
rendered images and their natural dimensions, verify no provider/decryption
credentials are in the DOM or image URLs. Do not treat successful HTTP calls as
proof of browser rendering. Do not enable production based only on synthetic
acceptance; real owner authorization and an appropriate isolated real-data
acceptance environment remain required.
