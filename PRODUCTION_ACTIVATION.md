# SIGILLUM — Production activation runbook

This document is operational. It does not modify the HCV capture or certification algorithms.

## Frozen code snapshots

- App: `stable/commercial-prelaunch-code-20260811`
- Backend: `stable/commercial-prelaunch-backend-20260811`

The active commercial branches remain validation branches until the external services below are configured and tested.

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

Deploy `render.production.yaml` in Frankfurt.

Initial safety state MUST remain:

```text
PRODUCTION_LIVE=false
CERTIFICATE_WRITES_ENABLED=false
SUBSCRIPTIONS_ENFORCED=false
KYC_REQUIRES_SUBSCRIPTION=true
APPLE_IAP_ENVIRONMENT=AUTO
```

The service can then be tested without accepting new production certificate writes.

Expected health state:

```json
{
  "productionLive": false,
  "readyForLive": false,
  "certificateWritesEnabled": false
}
```

Run the load probe against the real Render URL after deployment. The GitHub CI load result is only a local PostgreSQL baseline and is not a capacity guarantee for Render.

## Phase 4 — Stripe Identity

Configure the production Stripe secret key on Render:

- `STRIPE_SECRET_KEY`
- `APP_BASE_URL`
- `SIGILLUM_KYC_RETURN_URL`

`KYC_REQUIRES_SUBSCRIPTION=true` must remain enabled. The server must not create a paid Stripe Identity verification before an App Store subscription has been server-verified.

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
13. App Store Server Notification V2 updates the stored subscription state.

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

## App build connection

The commercial app, account service and Registry transport use the same compile-time value:

```text
SIGILLUM_API_BASE_URL
```

The final iOS production/TestFlight build must set this to the paid production API URL. Do not ship a commercial build that still uses the legacy Free Registry URL.

## Legal publication gate

Before App Store submission:

- replace all temporary support/privacy addresses with the dedicated domain addresses;
- obtain final review of Privacy Policy and Terms;
- verify retention and deletion language against the implemented Registry behavior;
- keep public identity disclosure off by default unless explicitly chosen by the user;
- complete the privacy disclosures required in App Store Connect.
