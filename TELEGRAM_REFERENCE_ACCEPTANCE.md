# SIGILLUM — Telegram reference acceptance gate

Status: **REJECTED AS PRIMARY PROVIDER — research artifact only**. A deeper
review of the Telegram Bot Platform Developer Terms found that section 5.2(e)
prohibits using a TPA with external interfaces to build external services that
diverge significantly from intended Bot Platform use cases, explicitly citing
cloud storage sites. Telegram also disclaims persistence/availability guarantees
for TPA data. Do not migrate SIGILLUM reference storage to Telegram.

## Why this gate exists

The YouTube experiment proved that a platform can be technically integrated and
still be unsuitable as a mandatory reference backend because of a channel-level
upload cap. Telegram must therefore pass a stricter acceptance gate before any
production migration.

Official documentation checked for this gate:

- Bot FAQ / rate limits / persistent file IDs:
  https://core.telegram.org/bots/faq
- Local Bot API limits:
  https://core.telegram.org/bots/features#local-bot-api
- Bot API / protect_content:
  https://core.telegram.org/bots/api
- Content protection:
  https://core.telegram.org/api/content-protection
- Bot developer privacy/data-retention terms:
  https://telegram.org/tos/bot-developers
- Telegram privacy policy:
  https://telegram.org/privacy

## Why this experiment is not proceeding to production

The technical tests below remain useful as evidence of what was evaluated, but
passing them would not cure the contractual/storage-role problem. The canonical
provider decision is recorded in `REFERENCE_PROVIDER_DECISION_20261001.md`.

## Architecture that was under test

Telegram is **not** trusted with plaintext reference media in this design.

```
certified original on device
        |
        +-- signed metadata / hashes -> SIGILLUM Registry
        |
        +-- controlled reference derivation
                |
                +-- AES-256-GCM encryption (SIGILLUM-held key)
                |
                +-- encrypted document -> PRIVATE Telegram channel
```

The channel message contains no Creator name, email, phone number, GPS location
or other user-facing personal metadata. The media payload is ciphertext.

For a verification/manual comparison, the SIGILLUM backend retrieves the
encrypted document, verifies its SHA-256, decrypts it under SIGILLUM control and
serves the resulting reference through the SIGILLUM verification path.

A future public showcase, if retained at all, is a **separate optional feature**
and must use a separate explicit publication choice. It must not be the
technical reference store.

## Hard acceptance criteria

Telegram is rejected for production use unless all of these pass:

1. Destination is a private Telegram channel.
2. Bot is an administrator with post and delete rights.
3. Every reference is sent with content protection enabled.
4. Upload is performed as a **document**, never as Telegram photo/video media,
   so Telegram's media transformation pipeline is not relied upon.
5. Encrypted document SHA-256 before upload equals SHA-256 after download.
6. Decryption after the Telegram round trip reproduces the exact original test
   bytes (SHA-256 equality).
7. Returned `file_id` can be reused and its `file_unique_id` remains bound to
   the same Telegram file. Telegram's FAQ states that file IDs may be treated as
   persistent; SIGILLUM still stores message/channel bindings so it can refetch
   the source if required.
8. Bot can delete the test posts; deletion is part of the future withdrawal
   path.
9. A Local Bot API instance must pass a >50 MB exact round-trip test before
   SIGILLUM relies on Telegram for real video scale. Telegram documents up to
   2000 MB upload and no Bot-API download size limit when using a local server.
10. A throttled single-channel stress run must complete without data
    corruption. The free Bot FAQ guidance is to avoid more than about one
    message per second in one chat. SIGILLUM will use a durable queue and
    backoff on HTTP 429.
11. The implementation must retain a provider abstraction/fallback. Telegram
    must never become another single point of failure.
12. Privacy policy, retention, deletion and processor/controller roles must be
    reviewed before launch. Telegram cloud chats are not treated as end-to-end
    encrypted storage; payload encryption is mandatory for the private
    reference store.

## Credential handling

Never paste a bot token into source code, GitHub issues, logs or chat.

The acceptance tool accepts:

- `TELEGRAM_BOT_TOKEN` from a process secret; or
- `TELEGRAM_BOT_TOKEN_FILE`, defaulting to the ignored local file
  `.sigillum-telegram-bot-token.txt`.
- `TELEGRAM_REFERENCE_CHAT_ID` for the private channel.
- optional `TELEGRAM_BOT_API_BASE`; omit it for the official Bot API.

The repository ignores the local token file.

## Phase A — official Bot API, small exact-byte test

Create a dedicated private channel and a dedicated bot. Add the bot as a channel
administrator with permission to post and delete messages.

Then run:

```bash
npm run telegram:acceptance
```

The tool:

- verifies bot/channel/admin configuration;
- generates a real MP4 with audio and a real PNG;
- encrypts each locally with ephemeral AES-256-GCM;
- uploads each encrypted object with `sendDocument` and
  `protect_content=true`;
- downloads it with `getFile`;
- verifies ciphertext SHA-256 equality;
- decrypts it and verifies plaintext SHA-256 equality;
- reuses the returned `file_id`;
- deletes the test posts by default;
- prints a sanitized JSON report with no bot token and no file IDs.

The official Bot API download path is limited to small files, so this phase is
only a correctness gate.

## Phase B — Local Bot API, >50 MB gate

Run a separate Local Bot API server behind TLS, then set
`TELEGRAM_BOT_API_BASE` to its base URL. Follow Telegram's documented
migration requirement and call `logOut` on the official Bot API before moving
the bot to the local server.

A 64 MB minimum gate is:

```bash
npm run telegram:acceptance -- --large-mb 64
```

The same encrypted SHA-256/decrypt round-trip must pass.

Passing 64 MB proves that SIGILLUM is no longer constrained by the official
50 MB upload ceiling. Production sizing must still enforce Telegram's documented
2000 MB local-server ceiling and SIGILLUM's own safer product limit.

## Phase C — throttled load gate

After A and B are green:

```bash
npm run telegram:acceptance -- --stress 500 --stress-delay-ms 1100
```

This deliberately stays around the documented one-message-per-second guidance
for a single chat. Any 429 response is recorded and obeyed via `retry_after`.

The rate test reuses an already uploaded encrypted `file_id`; it validates
channel-message throughput and backoff, while the exact-byte tests validate
storage integrity.

## Evidence retention

By default all test posts are deleted. For one manually inspected evidence run:

```bash
npm run telegram:acceptance -- --keep-evidence --json telegram-report.json
```

Only use this in the dedicated acceptance channel. Remove the retained test
messages after inspection.

## Production decision

Do **not** replace YouTube in production merely because Phase A passes.

Telegram is **not** an approved SIGILLUM primary reference provider. The list
below is preserved only as the technical acceptance criteria that had been
planned before the terms blocker was found:

- Phase A green;
- Phase B >50 MB green;
- Phase C stress green;
- deletion/withdrawal verified;
- privacy/legal review complete;
- provider abstraction + durable queue implemented;
- failure injection demonstrates that Telegram downtime does not block local
  certification or destroy queued references.
