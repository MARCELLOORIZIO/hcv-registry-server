# SIGILLUM — Production activation runbook

This document is operational. It does not modify the HCV capture or certification algorithms.

## Validated prelaunch source of truth — 24 August 2026

### App

- Current commercial app branch: `commercial/prelaunch-20260811`
- App source audited for the current TestFlight recipe: `08e93af502bb6e15b009ed7b70091f234253dc48`
- Historical commercial checkpoint: `3ea10197157cdcb80508bfefa7b38f58a55a0c2e`
- Frozen capture-engine base used by the Codemagic protected-file guard: `f810af479546075ffe84c3ea2411dcc6300c0bb3`

The current commercial app is intentionally newer than the historical `3ea1019...` checkpoint. Codemagic must continue to enforce the frozen-engine guard and the audited patch order. A later app commit is acceptable only after the same guard, Flutter tests and build-recipe validation pass again; do not silently fall back to the historical checkpoint simply because it is older.

### Backend

- Validated reconciled backend commit: `632c53a209d642821387768272905c0f2b35386a`
- Guarded backend checkpoint branch: `stable/commercial-prelaunch-backend-reconciled-20260824`
- Reconciliation source branch: `reconcile/commercial-stable-20260824`
- Previous guarded branch retained for rollback/history: `stable/commercial-prelaunch-backend-guarded-20260811`

The reconciled checkpoint combines the newer commercial/legal line with the stable-only protections that were previously on a separate branch:

- Dart-compatible HCV V2 signature canonicalization;
- Stripe Identity session reuse and live/test-output safety;
- Apple Associated Domains / AASA endpoints;
- multilingual legal/clickwrap revision `2026-08-18`;
- consumer legal-page presentation adapted to the `legal_documents.js` architecture;
- reusable-email account-deletion contract;
- production LIVE guard, write kill-switch, PostgreSQL startup/runtime safety and App Store server verification.

Validation status for backend commit `632c53a...`:

- reconciliation contract/syntax suite: PASS;
- Registry account check + smoke: PASS;
- PostgreSQL production validation: PASS;
- multilingual legal endpoints IT/EN/ES/RU + fallback: PASS;
- Apple AASA HTTP endpoint contract: PASS;
- prelaunch certificate-write kill-switch (`503 CERTIFICATE_WRITES_DISABLED`): PASS;
- isolated writes-enabled Creator/account/Apple billing smoke: PASS;
- localized clickwrap evidence: PASS (`termsVersion` / `privacyVersion` `2026-08-18`);
- Creator gate blocks unverified identity: PASS;
- PostgreSQL CI load probe: 43,241/43,241 successful requests, 0 failures, 4,323.67 req/s, p50 5.15 ms, p95 10.03 ms, p99 14.88 ms, concurrency 25 for 10 seconds.

The load figure above is a GitHub-runner/local-PostgreSQL baseline only. It is NOT a capacity guarantee for Render Starter. The production service remains PRELAUNCH until the external services below are configured and the LIVE gates are explicitly enabled.

## Phase 1 — Dedicated communications

Create dedicated addresses on the SIGILLUM domain, preferably through Google Workspace:

- `support@<sigillum-domain>`
- `privacy@<sigillum-domain>`
- recommended transactional sender: `noreply@<sigillum-domain>`

Keep `marcelloorizio@legalmail.it` as the formal PEC contact.

Configure the backend variables:

- `SUPPORT_EMAIL`
- `PRIVACY_EMAIL`
- `EMAIL_FROM=SIGILLUM <noreply@<sigillum-domain>>`

## Phase 2 — Resend

1. Add and verify the SIGILLUM sending domain in Resend.
2. Configure the DNS records required by Resend.
3. Create a production API key.
4. Configure `RESEND_API_KEY` on Render.
5. Verify registration email, resend-code flow and password-reset email.

Do not put the Resend key in GitHub.

## Phase 3 — Render prelaunch deployment

Create or update the paid Render Blueprint only after explicitly choosing to deploy the validated PRELAUNCH checkpoint. Do not modify or attach the legacy Free/SQLite Registry service.

Blueprint source configuration:

```text
Repository: MARCELLOORIZIO/hcv-registry-server
Blueprint branch: stable/commercial-prelaunch-backend-reconciled-20260824
Blueprint path: render.production.yaml
```

The validated `render.production.yaml` points the web service to the same guarded branch:

```text
stable/commercial-prelaunch-backend-reconciled-20260824
```

and sets:

```text
autoDeployTrigger: off
```

so future commits cannot automatically replace the validated backend running on Render. Keep Blueprint Auto Sync disabled as an additional deployment-control safeguard. Subsequent Blueprint changes must be reviewed and synced manually.

The Blueprint provisions in Frankfurt:

```text
Render Web Service Starter
+
Render PostgreSQL Basic-256mb
```

Initial safety state MUST remain:

```text
PRODUCTION_LIVE=false
CERTIFICATE_WRITES_ENABLED=false
SUBSCRIPTIONS_ENFORCED=false
KYC_REQUIRES_SUBSCRIPTION=true
APPLE_IAP_ENVIRONMENT=AUTO
TERMS_VERSION=2026-08-18
PRIVACY_VERSION=2026-08-18
```

The service can then be tested without accepting new production certificate writes.

Expected health state:

```json
{
  "productionLive": false,
  "readyForLive": false,
  "certificateWritesEnabled": false,
  "termsVersion": "2026-08-18",
  "privacyVersion": "2026-08-18"
}
```

Run the load probe against the real Render URL after deployment. Compare p95, p99, error rate and sustained throughput with the CI baseline; do not assume the local figure transfers to Render Starter.

## Phase 4 — Stripe Identity

Configure the production Stripe secret key on Render:

- `STRIPE_SECRET_KEY`
- `APP_BASE_URL`
- `SIGILLUM_KYC_RETURN_URL`

`KYC_REQUIRES_SUBSCRIPTION=true` must remain enabled. The server must not create a paid Stripe Identity verification before an App Store subscription has been server-verified.

The reconciled backend also prevents Stripe test-mode identity outputs from becoming verified legal identity data and reuses an existing active Identity session where appropriate.

## Phase 5 — App Store Connect

Create or confirm the app record for bundle ID:

```text
com.sigillum.hcv
```

Create one auto-renewable subscription group and these products:

```text
com.sigillum.hcv.creator.monthly
com.sigillum.hcv.creator.annual
```

Commercial target prices:

```text
Monthly: EUR 6.99
Annual:  EUR 69.99
```

Record the numeric App Apple ID and create the In-App Purchase server key in App Store Connect. Configure on Render:

- `APPLE_APP_ID`
- `APPLE_IAP_ISSUER_ID`
- `APPLE_IAP_KEY_ID`
- `APPLE_IAP_PRIVATE_KEY_BASE64`

Never commit the `.p8` private key to GitHub.

Configure App Store Server Notifications V2 to the production endpoint:

```text
https://<production-api-host>/api/billing/apple/notifications/v2
```

The iOS User target declares Associated Domains for `sigillum-hcv.com`; the reconciled backend serves the Apple association document for the configured Team ID/bundle ID and paths `/verify/*` and `/v/*`. Verify the final public domain routing before App Store submission.

## Phase 6 — Sandbox acceptance tests

Before enabling production enforcement, test on a physical iPhone with an App Store sandbox account:

1. new account registration;
2. email verification;
3. monthly purchase;
4. backend verification of the transaction;
5. Stripe Identity starts only after subscription verification;
6. identity reaches `verified`;
7. Creator access is granted;
8. certificate POST succeeds only for the verified creator;
9. public certificate GET works without login;
10. restore purchase on a clean session;
11. renewal/expiry state refresh;
12. cancellation/expiration removes Creator access;
13. App Store Server Notification V2 updates the stored subscription state;
14. Terms/Privacy shown by the app and recorded by the server are revision `2026-08-18`;
15. AASA endpoints are reachable on the final public domain.

Repeat at least the essential purchase/restore path for the annual product.

## Phase 7 — Final LIVE switch

Only after the preceding phases pass, set:

```text
APPLE_IAP_ENVIRONMENT=PRODUCTION
SUBSCRIPTIONS_ENFORCED=true
CERTIFICATE_WRITES_ENABLED=true
PRODUCTION_LIVE=true
```

`PRODUCTION_LIVE=true` is guarded. The server refuses to start if the mandatory Apple, Stripe, email, legal-contact, HTTPS or subscription settings are missing/unsafe.

Expected health state after successful activation:

```json
{
  "productionLive": true,
  "readyForLive": true,
  "certificateWritesEnabled": true,
  "subscriptionsEnforced": true
}
```

## Emergency rollback

If new certificate issuance must be stopped without breaking public verification:

```text
PRODUCTION_LIVE=false
CERTIFICATE_WRITES_ENABLED=false
```

Keep PostgreSQL and the web service online. Existing certificate GET/verification remains available while new certificate POSTs are disabled.

Do not delete or recreate the production database as a rollback mechanism.

The previous guarded backend branch remains available as a historical rollback reference, but rollback must not silently reintroduce the older legal revision or remove protections required by the current app. Validate the exact rollback target before switching a service branch.

## App build connection

The commercial app, account service and Registry transport use the compile-time value:

```text
SIGILLUM_API_BASE_URL
```

The current TestFlight/User build recipe must use the audited commercial app line (`commercial/prelaunch-20260811`, audited at `08e93af502bb6e15b009ed7b70091f234253dc48`) or a later commit that has passed the same frozen-engine guard and Flutter contract tests. It must set `SIGILLUM_API_BASE_URL` to the paid production API URL.

Do not ship a commercial build that still uses the legacy Free Registry URL, and do not replace the current audited app with historical commit `3ea1019...` merely because the old runbook named it.

## Legal publication gate

Before App Store submission:

- configure final dedicated support/privacy addresses;
- obtain final review of Privacy Policy and Terms;
- keep app/server legal revision and served-document hashes coherent;
- verify retention and deletion language against the implemented Registry behavior;
- keep public identity disclosure off by default unless explicitly chosen by the user;
- complete the privacy disclosures required in App Store Connect;
- remove or justify any User-build permission text that only serves Lab/test functions, including local-network AI Trainer wording if no User feature requires it.
