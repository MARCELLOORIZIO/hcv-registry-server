# SIGILLUM — reference provider decision review (2026-10-01)

## Decision state

**No consumer social platform is approved as the mandatory SIGILLUM reference
backend.**

The production app remains unchanged while the reference layer is redesigned
behind a provider abstraction. Social platforms may later be optional mirrors
or showcase destinations, but verification/export must not depend on their
availability or posting quota.

## Evidence that invalidated YouTube as mandatory provider

The live SIGILLUM backend received:

```
HTTP 400
reason: uploadLimitExceeded
message: The user has exceeded the number of videos they may upload.
```

This occurred at resumable-session creation, before the iOS share sheet could
open. It proves that successful OAuth scope verification and API quota are not
enough to guarantee reference publication capacity on a single YouTube
channel.

## Platform review

### YouTube — REJECT as mandatory provider

- Channel-level daily upload limit exists separately from API quota.
- Limit is not a dependable high-volume capacity contract for SIGILLUM.
- YouTube transcodes video, so the platform copy is inherently derivative.
- Suitable only as an optional public mirror/showcase after the primary
  reference has been committed elsewhere.

### Instagram — REJECT as mandatory provider

- Content Publishing API has a rolling 24-hour per-account publishing quota.
- The enforced quota must be read at runtime via the content publishing limit
  endpoint; current Meta documentation has carried inconsistent headline
  values, so SIGILLUM cannot design around a fixed large number.
- Publication requires Instagram professional-account/API permissions.
- Suitable only as an optional destination chosen by the user.

### TikTok — REJECT as mandatory provider

- Content Posting API has user/client publishing and upload caps plus anti-spam
  enforcement.
- Unaudited clients are restricted in visibility.
- Intended for creator posting workflows, not technical reference persistence.
- Suitable only as an optional destination chosen by the user.

### Telegram Bot Platform — REJECT as primary reference storage

Telegram looked attractive technically because the Local Bot API documents
large uploads and Telegram documents persistent `file_id` values. A deeper
terms review produces a decisive blocker:

- Telegram Bot Platform Developer Terms section 5.2(e) prohibits using a TPA
  together with external interfaces/frameworks/tools to develop external
  services that diverge significantly from intended Bot Platform use cases,
  explicitly giving **cloud storage sites** as an example.
- The same terms explicitly say Telegram gives no guarantee that data connected
  to a TPA will remain available, uncorrupted or fit for a particular purpose,
  and instruct developers to design persistence so Telegram data loss has no
  material effect.
- Therefore SIGILLUM must not use a private Telegram channel as its authoritative
  object store for an external verification application.

The already-added Telegram acceptance harness is retained only as research
evidence. It must not be promoted to the production provider.

Official references:
- https://telegram.org/tos/bot-developers
- https://core.telegram.org/bots/faq
- https://core.telegram.org/bots/features#local-bot-api

### Facebook Page — NOT APPROVED as mandatory provider

Facebook Pages API does permit app-managed Page publishing with
`pages_manage_posts`, but it remains a rate-limited social publishing API.
Page/API calls are governed by Meta rate-limit systems and the documented Page
budget is tied to engaged users over a rolling 24-hour window. This is not an
unlimited persistence contract and a new/low-engagement technical Page is a
poor dependency for a verification service.

Facebook can be evaluated later as an optional public showcase/mirror, never as
the sole evidence/reference store.

## Required architecture

Separate two jobs that were incorrectly coupled in the YouTube design:

```
A) TECHNICAL REFERENCE / EVIDENCE
   private, durable, scalable, provider-controlled object storage
   -> required for verification

B) PUBLIC SHOWCASE / SOCIAL DISTRIBUTION
   YouTube / Facebook / Instagram / TikTok / other
   -> optional mirror
   -> queue/retry independently
   -> failure never blocks SIGILLUM verification
```

## Primary infrastructure candidate

Cloudflare R2 is the current infrastructure candidate for the technical
reference layer because its official documentation currently provides:

- unlimited objects per bucket;
- unlimited bucket storage;
- objects up to 5 TiB;
- multipart/resumable uploads;
- no R2 egress charge;
- private buckets by default;
- time-limited presigned GET/PUT/DELETE URLs;
- an EU jurisdiction option that guarantees objects are stored and processed in
  the European Union.

Official references:
- https://developers.cloudflare.com/r2/platform/limits/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/reference/data-location/
- https://developers.cloudflare.com/r2/api/s3/presigned-urls/

## Privacy baseline for the new reference provider

The future primary reference must be:

1. private by default;
2. stored in EU jurisdiction where available;
3. encrypted at application level with AES-256-GCM before object upload;
4. addressed by opaque object key, not Creator name/email/phone/GPS;
5. integrity-bound to HCV-ID, original SHA-256, HCVPACK SHA-256 and a signed
   reference-derivation manifest;
6. exposed for manual comparison only by short-lived authorization;
7. deletable/revocable under a defined retention policy;
8. mirrored socially only after the technical reference commit succeeds.

## Release rule

Do not change the app to Telegram, Facebook, Instagram or TikTok as the primary
reference provider.

Before a new production provider is wired into SIGILLUM, run an acceptance gate
covering:

- exact encrypted-byte round trip;
- decrypt-to-reference SHA-256 equality;
- 100 MB / 1 GB multipart upload;
- concurrent upload queue;
- forced outage and retry;
- delete/withdraw;
- short-lived read authorization;
- EU data-location confirmation;
- cost at 1k / 5k / 10k references per day;
- provider outage without loss of local certification.
