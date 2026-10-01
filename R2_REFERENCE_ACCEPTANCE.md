# SIGILLUM — Cloudflare R2 reference acceptance gate

Status: **candidate test infrastructure only**. No production SIGILLUM route is
changed by this file.

## Why R2 is being tested

The social-platform review found that none of YouTube, Instagram, TikTok,
Telegram or Facebook provides the combination required for SIGILLUM's mandatory
technical reference layer: high-volume object persistence, predictable
programmatic capacity, private-by-default access and a suitable contractual role
as storage infrastructure.

Cloudflare R2 is designed as object storage rather than as a social publishing
surface.

Official documentation currently states:

- unlimited objects per bucket and unlimited bucket storage;
- object size up to 5 TiB;
- S3-compatible PUT/GET/HEAD/DELETE and multipart uploads;
- no R2 egress fee;
- buckets private by default;
- presigned temporary access URLs;
- an `eu` jurisdiction that guarantees objects are stored and processed in the
  European Union.

Sources:
- https://developers.cloudflare.com/r2/platform/limits/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/reference/data-location/
- https://developers.cloudflare.com/r2/api/s3/presigned-urls/

## Privacy design under test

SIGILLUM must not upload the plaintext reference object.

The acceptance tool:

1. generates a deterministic test reference;
2. encrypts it locally with AES-256-GCM;
3. uploads only the encrypted `.sgref` object;
4. downloads it from the private R2 bucket;
5. requires ciphertext SHA-256 equality;
6. decrypts it and requires plaintext SHA-256 equality;
7. tests a 60-second presigned GET;
8. deletes the object and requires a subsequent HEAD to return 404.

No Creator name, email, phone number, GPS location or other personal metadata is
written into the object key. Production keys must remain opaque.

## Required Cloudflare configuration

Create a dedicated bucket in **Jurisdiction: European Union**, not merely a
location hint.

Create an API token restricted to the dedicated bucket and only the object
operations needed by SIGILLUM.

Never paste R2 credentials into source code, logs, issues or chat.

The acceptance tool reads:

- `R2_ENDPOINT` — jurisdiction endpoint, expected form
  `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- optional `R2_REQUIRE_EU=false` only for non-production laboratory testing.

## Phase A — 8 MB correctness gate

```bash
npm run r2:acceptance
```

Required result: every boolean in the report is true and `passed=true`.

## Phase B — real reference size gate

```bash
npm run r2:acceptance -- --mb 100
```

Then test a larger object representative of the maximum reference size selected
for SIGILLUM.

The tool currently supports up to 1024 MB for acceptance. R2 supports much
larger objects; production multipart/resumable logic is a separate implementation
gate and must be tested before release.

## Phase C — production integration gates still required

Passing this script is necessary but not sufficient. Before production:

- implement provider abstraction, leaving social platforms optional;
- implement multipart/resumable upload + durable retry queue;
- encrypt references with production key management and rotation;
- sign the reference derivation manifest;
- bind HCV-ID + original SHA-256 + HCVPACK SHA-256 + reference SHA-256;
- expose comparison bytes only through authenticated/short-lived authorization;
- test deletion/withdrawal and retention policy;
- inject R2 outages and prove local certification still completes safely;
- perform privacy/DPA review.

## Cost model

R2 Standard storage is currently documented at roughly $0.015/GB-month after
the included free tier and R2 does not charge egress. Object operation charges
still apply.

Illustrative *new storage added each month* if every reference is retained:

| References/day | Average reference | Added/month | Added storage cost/month |
|---:|---:|---:|---:|
| 1,000 | 20 MB | ~600 GB | ~US$9 |
| 5,000 | 20 MB | ~3 TB | ~US$45 |
| 10,000 | 20 MB | ~6 TB | ~US$90 |
| 5,000 | 50 MB | ~7.5 TB | ~US$112.50 |

These figures are only storage-order estimates, exclude operations/taxes, and
storage accumulates if there is no retention/deletion policy.
