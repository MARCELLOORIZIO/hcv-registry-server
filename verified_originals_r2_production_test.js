'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const ffmpegPath = require('ffmpeg-static');
const {
  createVerifiedOriginalsProduction,
} = require('./verified_originals_production');
const {
  logicalIdempotencyKey,
} = require('./primary_reference_provider');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');

const HCV_ID = 'HCV-8899AABBCCDDEEFF';
const OWNER = 'acc-r2-owner';
const FREE = 'acc-r2-free';
const CREATOR_ID = 'creator-r2-01';
const DEVICE = 'c'.repeat(64);
const HCVPACK_HASH = '7'.repeat(64);

const deviceKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const deviceJwk = deviceKeys.publicKey.export({ format: 'jwk' });
const devicePublicKey = {
  modulus: Buffer.from(deviceJwk.n, 'base64url').toString('base64'),
  exponent: Buffer.from(deviceJwk.e, 'base64url').toString('base64'),
};

function packageHeaders(hcvId, mediaHash, packHash) {
  const statement =
    'SIGILLUM_HCVPACK_BINDING_V1|' + hcvId + '|' + mediaHash + '|' + packHash;
  return {
    'x-sigillum-hcvpack-binding-version': '1',
    'x-sigillum-hcvpack-signature': crypto.sign(
      'RSA-SHA256',
      Buffer.from(statement, 'utf8'),
      deviceKeys.privateKey,
    ).toString('base64'),
  };
}
function subtitleHeaders(
  hcvId,
  originalHashValue,
  captionedSha256,
  subtitleSha256,
  packHash,
) {
  const statement = [
    'SIGILLUM_SUBTITLE_DERIVATION_BINDING_V1',
    hcvId,
    originalHashValue,
    captionedSha256,
    subtitleSha256,
    packHash,
  ].join('|');
  return {
    'x-sigillum-captioned-sha256': captionedSha256,
    'x-sigillum-subtitle-binding-version': '1',
    'x-sigillum-subtitle-derivation-signature': crypto.sign(
      'RSA-SHA256',
      Buffer.from(statement, 'utf8'),
      deviceKeys.privateKey,
    ).toString('base64'),
  };
}


const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigillum-r2-vo-'));
const originalPath = path.join(tmp, 'original.mp4');
execFileSync(ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=1',
  '-c:v', 'mpeg4', '-q:v', '5', '-pix_fmt', 'yuv420p', '-an',
  '-movflags', '+faststart', originalPath,
], { stdio: 'pipe' });

const originalBytes = fs.readFileSync(originalPath);
const originalHash = crypto.createHash('sha256')
  .update(originalBytes)
  .digest('hex');
const certificateRaw = JSON.stringify({ test: 'r2-verified-originals' });
const sessionId = 'session-r2-closed-chain-test';
const provenanceEvent = {
  type: 'SIGILLUM_PROVENANCE_EVENT',
  version: 1,
  sequence: 0,
  eventType: 'CAPTURE_FINALIZED',
  inputHash: originalHash,
  timestamp: new Date().toISOString(),
  deviceFingerprint: DEVICE,
  sessionId,
  pipelineVersion: 'HCV_CAPTURE_BINDING_V1',
  nonce: 'aabbccddeeff00112233445566778899',
  parentEvent: 'GENESIS',
  metadata: {
    hcvId: HCV_ID,
    mediaType: 'video',
    contentSize: originalBytes.length,
    contentName: 'original.mp4',
    capturedAt: new Date().toISOString(),
    captureSource: 'HCV_CAMERA',
  },
  eventHash: '5'.repeat(64),
  signatureAlgorithm: 'RSA-SHA256-HCV-PROVENANCE-V1',
  signature: 'test-r2-signature',
  publicKey: { modulus: 'test', exponent: 'AQAB' },
};
const certificate = {
  sessionId,
  publicKey: devicePublicKey,
  meta: { hcvId: HCV_ID, identity: { creatorId: CREATOR_ID } },
  content: {
    type: 'video',
    hash: originalHash,
    size: originalBytes.length,
    name: 'original.mp4',
  },
  claims: {
    captureSource: 'HCV_CAMERA',
    liveCapture: true,
    provenance: {
      type: 'SIGILLUM_CAPTURE_PROVENANCE_BINDING',
      version: 1,
      status: 'VERIFIED',
      hcvId: HCV_ID,
      eventHash: provenanceEvent.eventHash,
      inputHash: originalHash,
      deviceFingerprint: DEVICE,
      sessionId,
      pipelineVersion: 'HCV_CAPTURE_BINDING_V1',
      event: provenanceEvent,
    },
  },
};

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.SIGILLUM_DERIVATION_KEY_ID = 'sigillum_r2_test_key';
process.env.SIGILLUM_DERIVATION_PRIVATE_KEY_PEM =
  keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
process.env.SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON = JSON.stringify({
  sigillum_r2_test_key:
    keys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
});
process.env.SIGILLUM_PUBLISHER_ID = 'SIGILLUM_R2_TEST_PUBLISHER';
process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP = path.join(tmp, 'jobs');
process.env.R2_REFERENCE_READ_TTL_SECONDS = '60';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: false,
  max: 4,
});

function sha(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function publicError(code, statusCode = 400, message) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.publicMessage = message || code;
  return error;
}

async function readJson(req, maxBytes = 1_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw publicError('PAYLOAD_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (_) {
    throw publicError('INVALID_JSON', 400);
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    connection: 'close',
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    connection: 'close',
  });
  res.end(body);
}

function token(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

async function authenticate(req) {
  const value = token(req);
  if (value === 'owner-token') {
    return {
      account_id: OWNER,
      creator_id: CREATOR_ID,
      device_key_fingerprint: DEVICE,
    };
  }
  if (value === 'free-token') {
    return {
      account_id: FREE,
      creator_id: 'free-r2',
      device_key_fingerprint: 'd'.repeat(64),
    };
  }
  throw publicError('SESSIONE_MANCANTE', 401);
}

async function accountEnvelope(accountId) {
  if (accountId === OWNER) {
    return {
      id: OWNER,
      creatorId: CREATOR_ID,
      subscriptionStatus: 'active',
      legalIdentityVerified: true,
      emailVerified: true,
      termsAccepted: true,
      privacyAcknowledged: true,
      adultConfirmed: true,
    };
  }
  if (accountId === FREE) {
    return { id: FREE, subscriptionStatus: 'inactive' };
  }
  throw publicError('ACCOUNT_NON_TROVATO', 404);
}

async function requireCreatorAccess(req) {
  const session = await authenticate(req);
  if (session.account_id !== OWNER) {
    throw publicError('ABBONAMENTO_NON_ATTIVO', 402);
  }
  return { session, account: await accountEnvelope(OWNER) };
}

function verifyCertificateRaw(_raw, expectedId) {
  if (expectedId === HCV_ID) return certificate;
  throw new Error('UNEXPECTED_HCV_ID ' + expectedId);
}

function provenanceEnvelopeFromRow(row) {
  return {
    status: 'SIGILLUM_REGISTRY_VERIFIED',
    integrityValid: true,
    identityVerified: true,
    contentSha256: row.content_sha256,
  };
}

const providerObjects = new Map();
let providerCommitCount = 0;
let providerDeleteCount = 0;
let providerDeleteFailuresRemaining = 0;
let providerLive = true;

const fakeR2Provider = {
  name: 'r2',

  async commitReference(input) {
    providerCommitCount += 1;
    const bytes = await fs.promises.readFile(input.sourcePath);
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      input.referenceSha256,
    );
    const binding = {
      hcvId: input.hcvId,
      referenceRole: input.referenceRole,
      referenceSha256: input.referenceSha256,
      originalContentSha256: input.originalContentSha256,
      hcvpackSha256: input.hcvpackSha256,
      derivationManifestSha256: input.derivationManifestSha256,
      objectId: input.objectId,
      mediaType: input.mediaType,
    };
    const receipt = {
      provider: 'r2',
      objectId: input.objectId,
      objectKey: input.objectKey,
      encryptionFormat: 'SIGILLUM_R2_REFERENCE_V2',
      encryptionKeyId: 'r2-test-key',
      ciphertextSha256: sha('cipher:' + input.objectId),
      ciphertextBytes: bytes.length + 64,
      referenceSha256: input.referenceSha256,
      originalContentSha256: input.originalContentSha256,
      hcvpackSha256: input.hcvpackSha256,
      derivationManifestSha256: input.derivationManifestSha256,
      referenceRole: input.referenceRole,
      mediaType: input.mediaType,
      idempotencyKey: logicalIdempotencyKey(binding),
      committedAt: new Date().toISOString(),
    };
    providerObjects.set(input.objectKey, { bytes, receipt });
    return receipt;
  },

  async referenceExists(receipt) {
    return providerLive && providerObjects.has(receipt.objectKey);
  },

  async materializeReference({ receipt, destinationPath }) {
    const stored = providerObjects.get(receipt.objectKey);
    if (!providerLive || !stored) {
      throw new Error('R2_TEST_REFERENCE_UNAVAILABLE');
    }
    await fs.promises.writeFile(destinationPath, stored.bytes, { mode: 0o600 });
    return {
      ok: true,
      referenceSha256:
        crypto.createHash('sha256').update(stored.bytes).digest('hex'),
      destinationPath,
    };
  },

  async deleteReference(receipt) {
    if (providerDeleteFailuresRemaining > 0) {
      providerDeleteFailuresRemaining -= 1;
      throw new Error('R2_TEST_DELETE_OUTAGE');
    }
    providerDeleteCount += 1;
    providerObjects.delete(receipt.objectKey);
    return { deleted: true, provider: 'r2' };
  },
};

async function resetDb() {
  await pool.query(`
    DROP TABLE IF EXISTS verified_originals_reference_read_tokens CASCADE;
    DROP TABLE IF EXISTS verified_originals_reference_jobs CASCADE;
    DROP TABLE IF EXISTS verified_originals_audit CASCADE;
    DROP TABLE IF EXISTS verified_originals_publications CASCADE;
    DROP TABLE IF EXISTS verified_originals_platform_receipts CASCADE;
    DROP TABLE IF EXISTS trusted_derivations CASCADE;
    DROP TABLE IF EXISTS verified_originals_consents CASCADE;
    DROP TABLE IF EXISTS certificates CASCADE;
    DROP TABLE IF EXISTS accounts CASCADE;

    CREATE TABLE accounts(id TEXT PRIMARY KEY);
    CREATE TABLE certificates(
      hcv_id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES accounts(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      certificate_raw TEXT NOT NULL,
      certificate_sha256 TEXT NOT NULL,
      account_subject_hash TEXT NOT NULL,
      device_key_fingerprint TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      binding_version INTEGER NOT NULL,
      content_sha256 TEXT NOT NULL,
      identity_verified BOOLEAN NOT NULL,
      registry_attested_at TIMESTAMPTZ,
      provenance_version INTEGER NOT NULL,
      registry_attestation_sha256 TEXT NOT NULL
    );
  `);
  await pool.query(
    'INSERT INTO accounts(id) VALUES($1),($2)',
    [OWNER, FREE],
  );
  await pool.query(`
    INSERT INTO certificates(
      hcv_id,account_id,certificate_raw,certificate_sha256,
      account_subject_hash,device_key_fingerprint,creator_id,binding_version,
      content_sha256,identity_verified,registry_attested_at,provenance_version,
      registry_attestation_sha256
    ) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,TRUE,NOW(),2,$9)
  `, [
    HCV_ID,
    OWNER,
    certificateRaw,
    sha(certificateRaw),
    sha(OWNER),
    DEVICE,
    CREATOR_ID,
    originalHash,
    '4'.repeat(64),
  ]);
}

async function cleanupDb() {
  await pool.query(`
    DROP TABLE IF EXISTS verified_originals_reference_read_tokens CASCADE;
    DROP TABLE IF EXISTS verified_originals_reference_jobs CASCADE;
    DROP TABLE IF EXISTS verified_originals_audit CASCADE;
    DROP TABLE IF EXISTS verified_originals_publications CASCADE;
    DROP TABLE IF EXISTS verified_originals_platform_receipts CASCADE;
    DROP TABLE IF EXISTS trusted_derivations CASCADE;
    DROP TABLE IF EXISTS verified_originals_consents CASCADE;
    DROP TABLE IF EXISTS certificates CASCADE;
    DROP TABLE IF EXISTS accounts CASCADE;
  `);
}

async function request(
  base,
  method,
  pathname,
  { bearer, body, bytes, contentType = 'video/mp4', headers = {} } = {},
) {
  const target = new URL(pathname, base);
  const raw = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const payload = bytes || raw;
  return new Promise((resolve, reject) => {
    const req = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method,
      agent: false,
      headers: {
        ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
        ...(bytes ? { 'content-type': contentType } : {}),
        ...(raw ? { 'content-type': 'application/json' } : {}),
        ...(payload ? { 'content-length': String(payload.length) } : {}),
        ...headers,
        connection: 'close',
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const responseBytes = Buffer.concat(chunks);
        const text = responseBytes.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          bytes: responseBytes,
          json,
          text,
        });
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('HTTP_TIMEOUT')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  await resetDb();

  const feature = createVerifiedOriginalsProduction({
    pool,
    authenticate,
    accountEnvelope,
    requireCreatorAccess,
    verifyCertificateRaw,
    provenanceEnvelopeFromRow,
    sendJson,
    sendHtml,
    publicError,
    readJson,
    securityEvent: async () => {},
    fetchImpl: async () => {
      throw new Error('YOUTUBE_MUST_NOT_BE_USED_IN_R2_TEST');
    },
    sleep: async () => {},
    ffmpegPath,
    primaryReferenceProviderOverride: fakeR2Provider,
  });
  await feature.initSchema();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    Promise.resolve(feature.handle(req, res, url))
      .then(handled => {
        if (!handled) sendJson(res, 404, { error: 'NOT_FOUND' });
      })
      .catch(error => {
        sendJson(
          res,
          error.statusCode || 500,
          { error: error.message },
        );
      });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;

  try {
    const before = await request(
      base,
      'GET',
      '/api/verified-originals/' + HCV_ID,
    );
    assert.equal(before.status, 200);
    assert.equal(before.json.availability, 'REFERENCE_NOT_AVAILABLE');

    const monetizationRejected = await request(
      base,
      'POST',
      '/api/verified-originals/consents',
      {
        bearer: 'owner-token',
        body: {
          hcvId: HCV_ID,
          intent: 'PUBLISH_VERIFIED_ORIGINAL',
          publishReference: true,
          rightsConfirmed: true,
          monetizationConsent: true,
        },
      },
    );
    assert.equal(monetizationRejected.status, 400, monetizationRejected.text);
    assert.equal(monetizationRejected.json.error, 'MONETIZATION_DISABLED');

    const consent = await request(
      base,
      'POST',
      '/api/verified-originals/consents',
      {
        bearer: 'owner-token',
        body: {
          hcvId: HCV_ID,
          intent: 'PUBLISH_VERIFIED_ORIGINAL',
          publishReference: true,
          rightsConfirmed: true,
          monetizationConsent: false,
        },
      },
    );
    assert.equal(consent.status, 201, consent.text);

    const published = await request(
      base,
      'POST',
      '/api/verified-originals/publish/' + HCV_ID +
        '?consentRecordId=' + encodeURIComponent(consent.json.recordId) +
        '&monetizationEnabled=false' +
        '&hcvpackSha256=' + HCVPACK_HASH,
      {
        bearer: 'owner-token',
        bytes: originalBytes,
        headers: packageHeaders(HCV_ID, originalHash, HCVPACK_HASH),
      },
    );
    assert.equal(published.status, 201, published.text);
    assert.equal(published.json.platform, 'r2');
    assert.equal(published.json.publicationStatus, 'PUBLISHED');
    assert.equal(
      published.json.referenceAccess,
      'SHORT_LIVED_AUTHORIZATION',
    );
    assert.equal(published.json.referenceSha256, originalHash);
    assert.equal(
      published.json.derivationType,
      'exact_original_reference_v1',
    );
    assert.equal(published.json.publicUrl, undefined);
    assert.equal(providerCommitCount, 1);
    assert.equal(providerObjects.size, 1);

    const freeLookup = await request(
      base,
      'GET',
      '/api/verified-originals/' + HCV_ID,
    );
    assert.equal(freeLookup.status, 200);
    assert.equal(freeLookup.json.availability, 'REFERENCE_AVAILABLE');
    assert.equal(freeLookup.json.platform, 'r2');
    assert.equal(freeLookup.json.viewAccess, 'SUBSCRIPTION_REQUIRED');
    assert.equal(freeLookup.json.publicUrl, undefined);
    assert.equal(freeLookup.json.platformPostId, undefined);

    const verification = await request(
      base,
      'GET',
      '/api/verified-originals/' + HCV_ID + '/verification-reference',
    );
    assert.equal(verification.status, 200, verification.text);
    assert.equal(verification.json.availability, 'REFERENCE_AVAILABLE');
    assert.equal(verification.json.platform, 'r2');
    assert.equal(verification.json.r2Live, true);
    assert.equal(verification.json.youtubeLive, false);
    assert.equal(verification.json.referenceLive, true);
    assert.equal(
      verification.json.comparisonMode,
      'R2_PRIVATE_EXACT_REFERENCE_SIGNED_V1',
    );
    assert.ok(verification.json.referenceVisualFingerprint);

    providerLive = false;
    const outage = await request(
      base,
      'GET',
      '/api/verified-originals/' + HCV_ID + '/verification-reference',
    );
    assert.equal(
      outage.json.availability,
      'REFERENCE_NOT_AVAILABLE',
      outage.text,
    );
    assert.equal(outage.json.r2Live, false);
    providerLive = true;

    const freeAuth = await request(
      base,
      'POST',
      '/api/verified-originals/' + HCV_ID + '/read-authorization',
      { bearer: 'free-token' },
    );
    assert.equal(freeAuth.status, 402);

    const paidView = await request(
      base,
      'GET',
      '/api/verified-originals/' + HCV_ID + '/view',
      { bearer: 'owner-token' },
    );
    assert.equal(paidView.status, 200, paidView.text);
    assert.equal(paidView.json.platform, 'r2');
    assert.equal(
      paidView.json.referenceAccess,
      'SHORT_LIVED_AUTHORIZATION',
    );
    assert.equal(paidView.json.publicUrl, undefined);
    assert.equal(paidView.json.platformPostId, undefined);
    assert.equal(paidView.json.providerReceipt, undefined);
    assert.equal(paidView.json.lifecycleJobId, undefined);
    assert.equal(paidView.json.objectKey, undefined);

    const auth = await request(
      base,
      'POST',
      '/api/verified-originals/' + HCV_ID + '/read-authorization',
      { bearer: 'owner-token' },
    );
    assert.equal(auth.status, 201, auth.text);
    assert.equal(auth.json.platform, 'r2');
    assert.match(
      auth.json.readPath,
      /^\/api\/verified-originals\/reference-read\//,
    );

    const materialized = await request(
      base,
      'GET',
      auth.json.readPath,
      { bearer: 'owner-token' },
    );
    assert.equal(materialized.status, 200, materialized.text);
    assert.deepEqual(materialized.bytes, originalBytes);
    assert.equal(materialized.headers['cache-control'], 'private, no-store, max-age=0');

    const replay = await request(
      base,
      'GET',
      auth.json.readPath,
      { bearer: 'owner-token' },
    );
    assert.equal(replay.status, 403);
    assert.equal(replay.json.error, 'REFERENCE_READ_AUTH_INVALID');

    const captionedPath = path.join(tmp, 'captioned.mp4');
    execFileSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', originalPath,
      '-vf', 'drawbox=x=20:y=180:w=280:h=40:color=black@0.8:t=fill',
      '-c:v', 'mpeg4', '-q:v', '5', '-pix_fmt', 'yuv420p', '-an',
      '-movflags', '+faststart', captionedPath,
    ], { stdio: 'pipe' });
    const captionedBytes = fs.readFileSync(captionedPath);
    const captionedSha256 = crypto
      .createHash('sha256')
      .update(captionedBytes)
      .digest('hex');
    assert.notEqual(captionedSha256, originalHash);
    const subtitleSha256 = sha('r2-subtitle-file');
    const subtitlePublication = await request(
      base,
      'POST',
      '/api/verified-originals/publish-subtitle/' + HCV_ID +
        '?consentRecordId=' + encodeURIComponent(consent.json.recordId) +
        '&monetizationEnabled=false' +
        '&hcvpackSha256=' + HCVPACK_HASH +
        '&subtitleSha256=' + subtitleSha256,
      {
        bearer: 'owner-token',
        bytes: captionedBytes,
        headers: subtitleHeaders(
          HCV_ID,
          originalHash,
          captionedSha256,
          subtitleSha256,
          HCVPACK_HASH,
        ),
      },
    );
    assert.equal(
      subtitlePublication.status,
      201,
      subtitlePublication.text,
    );
    assert.equal(subtitlePublication.json.platform, 'r2');
    assert.equal(
      subtitlePublication.json.referenceRole,
      'DERIVED_REFERENCE',
    );
    assert.equal(
      subtitlePublication.json.sourceDerivationSha256,
      captionedSha256,
    );
    assert.equal(
      subtitlePublication.json.subtitleSha256,
      subtitleSha256,
    );
    assert.equal(
      subtitlePublication.json.referenceSha256,
      captionedSha256,
      'R2 keeps the already-protected captioned bytes as the exact derived reference',
    );
    assert.equal(subtitlePublication.json.publicUrl, undefined);
    assert.equal(providerCommitCount, 2);
    assert.equal(providerObjects.size, 2);

    const derivedVerification = await request(
      base,
      'GET',
      '/api/verified-originals/' + HCV_ID + '/verification-reference',
    );
    assert.equal(derivedVerification.status, 200, derivedVerification.text);
    assert.equal(derivedVerification.json.availability, 'REFERENCE_AVAILABLE');
    assert.equal(
      derivedVerification.json.authorizedDerivations.length,
      1,
      derivedVerification.text,
    );
    assert.equal(
      derivedVerification.json.authorizedDerivations[0].referenceRole,
      'DERIVED_REFERENCE',
    );
    assert.equal(
      derivedVerification.json.authorizedDerivations[0].derivationType,
      'subtitle_burn_in_reference_v1',
    );
    assert.equal(
      derivedVerification.json.authorizedDerivations[0].editorialImpact,
      'caption_overlay',
    );
    assert.ok(
      derivedVerification.json.authorizedDerivations[0]
        .referenceVisualFingerprint,
    );

    const wrongBytes = Buffer.from(originalBytes);
    wrongBytes[wrongBytes.length - 1] ^= 0xff;
    const secondConsentAttempt = await request(
      base,
      'POST',
      '/api/verified-originals/consents',
      {
        bearer: 'owner-token',
        body: {
          hcvId: HCV_ID,
          intent: 'PUBLISH_VERIFIED_ORIGINAL',
          publishReference: true,
          rightsConfirmed: true,
          monetizationConsent: false,
        },
      },
    );
    assert.equal(secondConsentAttempt.status, 409);

    providerDeleteFailuresRemaining = 2;
    const withdrawalPending = await request(
      base,
      'POST',
      '/api/verified-originals/consents/' + HCV_ID + '/withdraw',
      { bearer: 'owner-token' },
    );
    assert.equal(withdrawalPending.status, 200, withdrawalPending.text);
    assert.equal(withdrawalPending.json.referenceAvailable, false);
    assert.equal(withdrawalPending.json.platformTakedown, 'PENDING');

    const afterPendingDelete = await request(
      base,
      'GET',
      '/api/verified-originals/' + HCV_ID,
    );
    assert.equal(
      afterPendingDelete.json.availability,
      'REFERENCE_NOT_AVAILABLE',
    );
    assert.equal(providerObjects.size, 2);

    // Production deletion retries use bounded backoff. Make the durable retry
    // due now so this test can exercise recovery without sleeping.
    await pool.query(`
      UPDATE verified_originals_reference_jobs
      SET delete_next_attempt_at=NOW()
      WHERE hcv_id=$1 AND state='DELETE_PENDING'
    `, [HCV_ID]);

    const withdrawalRetry = await request(
      base,
      'POST',
      '/api/verified-originals/consents/' + HCV_ID + '/withdraw',
      { bearer: 'owner-token' },
    );
    assert.equal(withdrawalRetry.status, 200, withdrawalRetry.text);
    assert.equal(withdrawalRetry.json.platformTakedown, 'COMPLETED');
    assert.equal(providerDeleteCount, 2);
    assert.equal(providerObjects.size, 0);

    const stored = await pool.query(`
      SELECT p.platform,p.public_url,p.reference_sha256,
             p.derivation_type,p.publication_status,
             r.visibility,r.processing_status,
             j.state,j.provider,j.receipt_json
      FROM verified_originals_publications p
      JOIN verified_originals_platform_receipts r
        ON r.receipt_id=p.platform_receipt_id
      JOIN verified_originals_reference_jobs j
        ON j.object_id=p.platform_post_id
      WHERE p.hcv_id=$1
    `, [HCV_ID]);
    assert.equal(stored.rows.length, 2);
    for (const row of stored.rows) {
      assert.equal(row.platform, 'r2');
      assert.equal(row.public_url, '');
      assert.equal(row.publication_status, 'REVOKED');
      assert.equal(row.visibility, 'unavailable');
      assert.equal(row.processing_status, 'withdrawn');
      assert.equal(row.state, 'DELETED');
      assert.equal(row.provider, 'r2');
    }
    const originalStored = stored.rows.find(
      row => row.derivation_type === 'exact_original_reference_v1',
    );
    const subtitleStored = stored.rows.find(
      row => row.derivation_type === 'subtitle_burn_in_reference_v1',
    );
    assert.ok(originalStored);
    assert.ok(subtitleStored);
    assert.equal(originalStored.reference_sha256, originalHash);
    assert.equal(subtitleStored.reference_sha256, captionedSha256);

    console.log(
      'verified_originals_r2_production_test: PASS — exact private R2 original, exact protected subtitle derivative, authorized-derivation verification, provider-neutral discovery, safe view, live HEAD attestation, subscription gate, one-use authenticated read, fail-closed withdrawal and delete retry',
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

run()
  .finally(async () => {
    try {
      await cleanupDb();
    } finally {
      await pool.end();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
