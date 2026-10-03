# SIGILLUM — Primary Reference lifecycle v1 (R2)

Date: 2026-10-02  
Status: **implemented and deployed in PRELAUNCH on the canonical production backend**

## Scope

This contract separates the mandatory SIGILLUM technical reference from optional
social publication. The primary reference is provider-backed evidence used by
SIGILLUM verification. YouTube and other social platforms remain optional
mirrors and must never block certification, primary-reference commit, export or
verification.

The canonical production backend now uses R2 for new authoritative references.
Historical YouTube records remain readable for compatibility, but YouTube is no
longer permitted as the LIVE primary-reference provider.

## Primary-reference invariants

1. The primary R2 bucket stays private.
2. The production bucket must use the Cloudflare R2 **EU jurisdiction**.
3. Plaintext reference bytes are never uploaded to R2.
4. Reference bytes are encrypted before upload with AES-256-GCM.
5. Every encrypted object is cryptographically bound to:
   - HCV-ID;
   - reference role;
   - plaintext reference SHA-256;
   - original-content SHA-256;
   - HCVPACK SHA-256;
   - signed derivation-manifest SHA-256;
   - an opaque object id.
6. Object keys are opaque. They must not contain Creator name, email, phone,
   GPS/location, HCV-ID or original filenames.
7. A reference is not marked available until the provider commit has completed
   and a provider HEAD check confirms the committed encrypted object.
8. Social mirrors are downstream jobs. Their failure never changes a committed
   primary reference to unavailable.
9. Withdrawal is fail-closed: API availability is revoked transactionally before
   physical object deletion is attempted.
10. Provider credentials and encryption master keys exist only as server-side
    secrets and are never returned by an API.

## Encryption and key rotation

Format: `SIGILLUM_R2_REFERENCE_V2`.

A configured master key ring is supplied as
`R2_REFERENCE_MASTER_KEYS_JSON`. The active key is named by
`R2_REFERENCE_ACTIVE_KEY_ID`.

Each object receives a fresh random salt and nonce. A per-object 256-bit data
key is derived with HKDF-SHA256 from the active master key. AES-256-GCM
additional authenticated data is the canonical reference binding listed above.

The encrypted object header stores only format/version information, key id,
salt and nonce. The HCV-ID and binding hashes are not embedded in the object
key. Historical master keys remain in the key ring for reads until all objects
using them have been deleted or re-encrypted. Rotation changes the active key;
it does not invalidate old references.

## Durable lifecycle state machine

The persistence layer to be wired in the next gate uses these states:

```
PENDING
  -> UPLOADING
  -> COMMITTED

PENDING / UPLOADING
  -> RETRY_WAIT
  -> UPLOADING

COMMITTED
  -> DELETE_PENDING
  -> DELETED

RETRY_WAIT
  -> FAILED_PERMANENT   only for deterministic/non-retryable input errors

DELETE_PENDING
  -> DELETE_PENDING     on provider outage
  -> DELETED            after provider confirms object absence
```

### Visibility rule

Only `COMMITTED` is reference-available.

`DELETE_PENDING`, `DELETED`, `FAILED_PERMANENT`, `PENDING`,
`UPLOADING` and `RETRY_WAIT` are never exposed as an available reference.

## Idempotency

The logical idempotency key is SHA-256 over:

```
HCV-ID
reference role
reference SHA-256
original-content SHA-256
HCVPACK SHA-256
derivation-manifest SHA-256
```

A retry for the same logical reference reuses the same lifecycle record and
opaque object key. It must not create duplicate authoritative objects.

A request that conflicts with an already committed authoritative reference for
the same role must fail closed rather than silently replacing evidence.

## Upload and retry

The R2 provider uses the AWS S3-compatible API with `region=auto`.

Production uploads use multipart-capable `@aws-sdk/lib-storage` Upload with:

- bounded part size;
- bounded concurrency;
- automatic multipart cleanup on failure;
- streaming input from the temporary encrypted file.

Provider/network failures are retryable. Retry state is durable in PostgreSQL;
process memory is never the source of truth.

The local certification/Registry flow remains independent of R2 availability.
A provider outage may delay the primary reference, but it must not destroy the
local protected original or its certificate.

## Commit receipt

A successful R2 commit returns/stores only the data needed to prove and operate
the reference:

- provider = `r2`;
- opaque object key;
- object id;
- encryption format/version;
- key id;
- ciphertext SHA-256;
- ciphertext byte length;
- plaintext/reference SHA-256;
- original-content SHA-256;
- HCVPACK SHA-256;
- derivation-manifest SHA-256;
- committed timestamp.

The receipt does not contain a permanent public URL.

## Read authorization

R2 objects remain encrypted and private.

The R2 provider may create a short-lived presigned URL for **encrypted** bytes
for internal/backend use. The public/app verification API must not expose
long-lived object URLs or encryption master keys.

The app-facing read path is implemented with authenticated short-lived
authorization and one-use application tokens. The provider may issue only
short-lived authorization for encrypted bytes; server-side materialization
verifies ciphertext and plaintext hashes before the app receives the reference.

## Withdrawal and deletion

Creator withdrawal performs these operations in order:

1. transactionally mark consent withdrawn;
2. mark the authoritative reference unavailable to every read/verification
   endpoint;
3. mark its provider object `DELETE_PENDING`;
4. attempt provider deletion immediately;
5. confirm absence with HEAD/NotFound;
6. mark `DELETED`.

If R2 is unavailable at step 4 or 5, the API remains unavailable and the durable
delete worker retries. A failed physical deletion can never reactivate a
reference.

Audit records and cryptographic hashes may be retained as evidence of the
historical event, but the media object is removed. No v1 legal-hold exception is
implemented implicitly.

## Retention

Active references are retained while the associated consent/reference remains
active.

On withdrawal, the media object is scheduled for immediate deletion. There is
no arbitrary post-withdrawal media retention period in v1.

Incomplete orphan objects created by an interrupted upload must be reclaimed by
a sweeper after a short operational grace period; the target is 24 hours.
Multipart failures must abort their incomplete parts.

## Social mirrors

After a primary reference reaches `COMMITTED`, optional mirrors may be queued
independently:

```
PRIMARY COMMITTED
   -> optional YouTube / Facebook / Instagram / TikTok mirror jobs
```

Mirror status is informational. It is not part of primary-reference
availability.

## Current release state

The R2 migration gates are complete for the PRELAUNCH backend:

- encrypted R2 acceptance tests — PASSED;
- EU-jurisdiction configuration validation — PASSED;
- provider abstraction and commit tests — PASSED;
- durable PostgreSQL lifecycle/idempotency tests — PASSED;
- withdrawal/delete retry tests — PASSED;
- authenticated short-lived one-use read path — PASSED;
- BUILD143 original + authorized subtitle-derivation tests — PASSED;
- production database shows new references on R2 and historical YouTube records only as legacy compatibility data.

Before commercial LIVE activation:

- LIVE readiness must require `SIGILLUM_PRIMARY_REFERENCE_PROVIDER=r2`;
- the Render production blueprint and environment must contain the complete R2 configuration;
- TestFlight/Sandbox purchase, restore, renewal/expiry and server-notification acceptance must pass;
- legal documents/version `2026-10-04` and four-language USER copy must be deployed;
- a final manual Render deployment and health/readiness check must pass;
- `PRODUCTION_LIVE`, certificate writes and subscription enforcement remain off until the final activation step.

