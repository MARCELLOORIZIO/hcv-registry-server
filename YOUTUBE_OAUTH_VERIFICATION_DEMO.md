# SIGILLUM — Google OAuth verification demo

Purpose: demonstrate the only Google OAuth workflow used by SIGILLUM and the
real use of the sensitive scope:

`https://www.googleapis.com/auth/youtube.force-ssl`

SIGILLUM end users do not connect personal Google or YouTube accounts. OAuth is
used administratively by the SIGILLUM operator to authorize the official
SIGILLUM YouTube channel. The resulting refresh token is stored only in the
server environment and is used server-side for official reference management.

## Before recording

1. Google Auth Platform branding must be verified and published.
2. OAuth publishing status must be **In production**.
3. The Web OAuth client must contain this exact authorized redirect URI:
   `http://127.0.0.1:53682/oauth2/callback`
4. YouTube Studio defaults for new videos must have comments disabled.
5. The channel authorized by OAuth must match `YOUTUBE_CHANNEL_ID`.
6. Do not show the client secret, refresh token, Render secrets, private keys or
   other credentials in the recording.
7. Set the Google OAuth consent screen language to **English** before granting
   consent, as required by Google's verification guidance.

## Part A — show project identity

Record:

- Google Cloud project: SIGILLUM-YouTube.
- OAuth client name: SIGILLUM YouTube Publisher.
- Application name: SIGILLUM.
- Published/verified branding.
- Data Access page showing the single sensitive scope
  `youtube.force-ssl`.

Do not expose the OAuth client secret.

## Part B — show the OAuth grant

Run locally, with credentials supplied only as environment variables:

```
npm run youtube:oauth:provision
```

The tool:

- binds only to `127.0.0.1`;
- uses a cryptographically random OAuth `state`;
- requests exactly `youtube.force-ssl`;
- requests `access_type=offline`;
- uses `prompt=consent`;
- disables incremental-scope carry-over for the demo;
- opens the real Google consent screen;
- exchanges the code server-side;
- verifies that the granted account controls the configured SIGILLUM channel;
- saves the refresh token only to
  `.sigillum-youtube-refresh-token.txt`, which is ignored by Git.

Record the complete consent screen in English and the successful channel-ID
verification. Do not display the refresh-token file.

## Part C — show actual use of youtube.force-ssl

After moving the new refresh token directly into the secure server environment,
run:

```
npm run youtube:scope:demo
```

Record the tool showing:

1. access-token refresh;
2. `channels.list(mine=true)` channel identity check;
3. generation of a temporary SIGILLUM demo video;
4. resumable `videos.insert` upload;
5. video privacy = `unlisted`;
6. processing status = `succeeded`;
7. comments disabled check;
8. the temporary video in YouTube Studio if useful;
9. `videos.delete` deletion;
10. successful cleanup.

The delete operation is why SIGILLUM requires `youtube.force-ssl` instead of
the narrower `youtube.upload` scope.

## Part D — show SIGILLUM product functionality

Record the user-visible workflow separately:

1. create/certify a SIGILLUM photo or video;
2. show its HCV-ID/certificate;
3. choose the external-share workflow;
4. explain that SIGILLUM first creates an official YouTube reference;
5. show the Registry/reference result;
6. show automatic verification;
7. show subscriber-only manual visual/audio comparison with the official copy.

If the production publication gate is still awaiting OAuth approval, use a
clearly identified staging/test backend for this part. Do not falsely enable
`YOUTUBE_COMPLIANCE_APPROVED` or `PRODUCTION_LIVE` before Google approval.

## Suggested narration

"SIGILLUM uses one Google OAuth authorization for the SIGILLUM-owned YouTube
channel. End users do not grant Google access. The backend uses the
youtube.force-ssl scope only to upload and inspect unlisted official reference
copies and to delete failed or withdrawn references. The narrower
youtube.upload scope is insufficient because SIGILLUM must be able to perform
videos.delete in order to preserve the integrity of its reference chain.
Google data is not used for advertising, profiling or sale, and OAuth tokens
are not exposed to end users."

## Submission

Upload the finished screen recording to YouTube as **Unlisted** and paste its
URL into Google Auth Platform -> Verification Center -> Data Access ->
"Demo video: how will the scopes be used?".

Do not submit the OAuth verification request until the recording visibly shows
the complete English consent screen and the actual scope-dependent operations.
