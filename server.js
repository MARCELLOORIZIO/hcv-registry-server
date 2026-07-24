'use strict';

const http = require('http');
const {
  initSchema,
  upsertAccountAndDevice,
  upsertKycSession,
  bindKycSession,
  getLatestKycByDevice,
  getLatestKycByAccount,
  storeCertificateImmutable,
  getCertificate,
  writeAudit,
  healthCheck,
} = require('./db');
const { verifyDeviceProof, verifyCertificate } = require('./crypto_verifier');
const {
  createVerificationSession,
  retrieveVerificationSession,
  normalizeSession,
  findLatestSessionForAccount,
} = require('./stripe_identity');
const { verifyStripeWebhook } = require('./webhook_verifier');
const { evaluateLegacyKycMigration } = require('./kyc_migration_policy');

const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 35000000);

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Stripe-Signature',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data, 'utf8') > MAX_BODY_BYTES) {
        const error = new Error('PAYLOAD_TOO_LARGE');
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch (_) {
    const error = new Error('INVALID_JSON');
    error.statusCode = 400;
    throw error;
  }
}

function safeHcvId(value) {
  const cleaned = String(value || '').trim().toUpperCase();
  return /^HCV-[A-F0-9]{8,32}$/.test(cleaned) ? cleaned : null;
}

function safeAccountId(value) {
  const cleaned = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{8,160}$/.test(cleaned) ? cleaned : null;
}

function safeSessionId(value) {
  const cleaned = String(value || '').trim();
  return /^vs_[A-Za-z0-9_]{8,200}$/.test(cleaned) ? cleaned : null;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseStoredCertificate(raw) {
  if (typeof raw !== 'string' || !raw) {
    const error = new Error('STORED_CERTIFICATE_RAW_INVALID');
    error.statusCode = 500;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    const error = new Error('STORED_CERTIFICATE_JSON_INVALID');
    error.statusCode = 500;
    throw error;
  }
}

function publicKycPayload(row) {
  if (!row) return { found: false, ok: true };
  return {
    found: true,
    ok: true,
    provider: row.provider || 'stripe_identity',
    sessionId: row.session_id || row.sessionId,
    accountId: row.account_id || row.accountId || '',
    status: row.status || 'unknown',
    url: row.url || '',
    lastError: row.last_error || row.lastError || null,
    verifiedOutputs: row.verified_outputs || row.verifiedOutputs || {},
    verified: row.status === 'verified',
  };
}

async function saveNormalizedKyc(normalized, fallbackAccountId = '') {
  const accountId = safeAccountId(normalized.accountId || fallbackAccountId);
  if (!accountId) return;
  await upsertKycSession({
    sessionId: normalized.sessionId,
    accountId,
    provider: normalized.provider,
    status: normalized.status,
    url: normalized.url,
    verifiedOutputs: normalized.verifiedOutputs,
    lastError: normalized.lastError,
  });
}

async function handleKycStart(payload, origin) {
  const proof = verifyDeviceProof(payload);
  const accountId = safeAccountId(payload.accountId || payload.creatorId);
  if (!accountId) {
    const error = new Error('ACCOUNT_ID_INVALID');
    error.statusCode = 400;
    throw error;
  }
  const creatorName = String(payload.creatorName || '').slice(0, 160);
  await upsertAccountAndDevice({
    accountId,
    creatorName,
    deviceKeyFingerprint: proof.deviceKeyFingerprint,
    publicKey: proof.publicKey,
  });

  const local = await getLatestKycByAccount(accountId);
  if (local && ['verified', 'processing', 'requires_input'].includes(local.status)) {
    if (local.status !== 'requires_input' || local.url) return publicKycPayload(local);
  }

  const stripeExisting = await findLatestSessionForAccount(accountId);
  if (stripeExisting && ['verified', 'processing', 'requires_input'].includes(stripeExisting.status)) {
    await saveNormalizedKyc(stripeExisting, accountId);
    return { ...stripeExisting, found: true, ok: true };
  }

  const returnUrl = process.env.SIGILLUM_KYC_RETURN_URL || `${origin}/kyc-return`;
  const created = await createVerificationSession({ accountId, creatorName, returnUrl });
  const normalized = await normalizeSession(created);
  await saveNormalizedKyc(normalized, accountId);
  await writeAudit('KYC_SESSION_CREATED', accountId, {
    sessionId: normalized.sessionId,
    deviceKeyFingerprint: proof.deviceKeyFingerprint,
  });
  return { ...normalized, found: true, ok: true };
}

async function handleKycRecover(payload) {
  const proof = verifyDeviceProof(payload);
  const accountId = safeAccountId(payload.accountId || payload.creatorId);
  const localByDevice = await getLatestKycByDevice(proof.deviceKeyFingerprint);
  if (localByDevice) {
    try {
      const stripe = await retrieveVerificationSession(localByDevice.session_id);
      const normalized = await normalizeSession(stripe);
      await saveNormalizedKyc(normalized, localByDevice.account_id);
      return { ...normalized, found: true, ok: true };
    } catch (_) {
      return publicKycPayload(localByDevice);
    }
  }
  if (!accountId) return { found: false, ok: true };

  const creatorName = String(payload.creatorName || '').slice(0, 160);
  await upsertAccountAndDevice({
    accountId,
    creatorName,
    deviceKeyFingerprint: proof.deviceKeyFingerprint,
    publicKey: proof.publicKey,
  });
  const stripeExisting = await findLatestSessionForAccount(accountId);
  if (!stripeExisting) return { found: false, ok: true };
  await saveNormalizedKyc(stripeExisting, accountId);
  await writeAudit('KYC_SESSION_RECOVERED', accountId, {
    sessionId: stripeExisting.sessionId,
    deviceKeyFingerprint: proof.deviceKeyFingerprint,
  });
  return { ...stripeExisting, found: true, ok: true };
}

async function handleKycBind(payload) {
  const proof = verifyDeviceProof(payload);
  const accountId = safeAccountId(payload.accountId || payload.creatorId);
  const sessionId = safeSessionId(payload.sessionId);
  if (!accountId || !sessionId) {
    const error = new Error('KYC_BIND_INPUT_INVALID');
    error.statusCode = 400;
    throw error;
  }

  const creatorName = String(payload.creatorName || '').slice(0, 160);
  const stripe = await retrieveVerificationSession(sessionId);
  const normalized = await normalizeSession(stripe);
  const migration = evaluateLegacyKycMigration({
    sessionAccountId: normalized.accountId,
    targetAccountId: accountId,
    status: normalized.status,
    verifiedLegalName: normalized.verifiedOutputs?.legalName,
    claimedLegalName: creatorName,
  });

  await upsertAccountAndDevice({
    accountId,
    creatorName,
    deviceKeyFingerprint: proof.deviceKeyFingerprint,
    publicKey: proof.publicKey,
  });

  if (migration.legacyMigration) {
    await upsertKycSession({
      sessionId,
      accountId,
      provider: normalized.provider,
      status: normalized.status,
      url: normalized.url,
      verifiedOutputs: normalized.verifiedOutputs,
      lastError: normalized.lastError,
    });
    await writeAudit('KYC_LEGACY_ACCOUNT_MIGRATED', accountId, {
      sessionId,
      sourceAccountId: migration.sourceAccountId,
      deviceKeyFingerprint: proof.deviceKeyFingerprint,
    });
  } else {
    await saveNormalizedKyc(normalized, accountId);
    await bindKycSession({ sessionId, accountId });
    await writeAudit('KYC_DEVICE_BOUND', accountId, {
      sessionId,
      deviceKeyFingerprint: proof.deviceKeyFingerprint,
    });
  }

  return {
    ...normalized,
    accountId,
    found: true,
    ok: true,
    legacyMigration: migration.legacyMigration,
  };
}

async function handleKycStatus(payload) {
  const proof = verifyDeviceProof(payload);
  const accountId = safeAccountId(payload.accountId || payload.creatorId);
  const sessionId = safeSessionId(payload.sessionId);
  if (!accountId || !sessionId) {
    const error = new Error('KYC_STATUS_INPUT_INVALID');
    error.statusCode = 400;
    throw error;
  }

  await upsertAccountAndDevice({
    accountId,
    creatorName: String(payload.creatorName || '').slice(0, 160),
    deviceKeyFingerprint: proof.deviceKeyFingerprint,
    publicKey: proof.publicKey,
  });

  const stripe = await retrieveVerificationSession(sessionId);
  const normalized = await normalizeSession(stripe);
  if (normalized.accountId && normalized.accountId !== accountId) {
    const error = new Error('KYC_SESSION_ACCOUNT_MISMATCH');
    error.statusCode = 409;
    throw error;
  }
  await saveNormalizedKyc(normalized, accountId);
  await writeAudit('KYC_STATUS_CHECKED', accountId, {
    sessionId,
    status: normalized.status,
    deviceKeyFingerprint: proof.deviceKeyFingerprint,
  });
  return { ...normalized, found: true, ok: true };
}

function certificatePage(row) {
  const cert = parseStoredCertificate(row.certificate_raw);
  const hcvId = escapeHtml(row.hcv_id);
  const creator = escapeHtml(cert?.meta?.identity?.creatorName || 'Unknown creator');
  const createdAt = escapeHtml(cert?.createdAt || row.created_at);
  const contentType = escapeHtml(cert?.content?.type || 'unknown');
  const trust = escapeHtml(cert?.claims?.trustLevel || cert?.meta?.identity?.trustLevel || 'UNKNOWN');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${hcvId} - SIGILLUM</title><style>body{font-family:Arial,sans-serif;background:#071511;color:#f4f1e8;margin:0}.wrap{max-width:760px;margin:40px auto;padding:20px}.card{background:#10201b;border:1px solid #31534a;border-radius:18px;padding:28px}.ok{font-size:30px;font-weight:800;color:#76ded3}.row{padding:12px 0;border-bottom:1px solid #27423b}.label{font-size:12px;color:#aeb9b3}.value{margin-top:4px;word-break:break-word}</style></head><body><main class="wrap"><section class="card"><div class="ok">REGISTRY CONFIRMED</div><div class="row"><div class="label">HCV-ID</div><div class="value">${hcvId}</div></div><div class="row"><div class="label">Creator</div><div class="value">${creator}</div></div><div class="row"><div class="label">Created</div><div class="value">${createdAt}</div></div><div class="row"><div class="label">Content</div><div class="value">${contentType}</div></div><div class="row"><div class="label">Trust</div><div class="value">${trust}</div></div><div class="row"><div class="label">Certificate SHA-256</div><div class="value">${escapeHtml(row.certificate_sha256)}</div></div></section></main></body></html>`;
}

async function requestHandler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    return sendJson(res, 200, { ok: true, service: 'sigillum-registry-postgres', version: 2 });
  }
  if (req.method === 'GET' && url.pathname === '/kyc-return') {
    return sendHtml(res, 200, '<!doctype html><html><body><h1>Identity verification complete</h1><p><a href="sigillum://kyc-return">Open SIGILLUM</a></p><script>setTimeout(()=>location.href="sigillum://kyc-return",300)</script></body></html>');
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    const database = await healthCheck();
    return sendJson(res, 200, {
      ok: true,
      service: 'sigillum-registry-postgres',
      version: 2,
      databaseTime: database.now,
      kycConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/stripe/webhook') {
    const rawBody = await readBody(req);
    const event = verifyStripeWebhook(rawBody, req.headers['stripe-signature']);
    const session = event?.data?.object;
    if (event?.type?.startsWith('identity.verification_session.') && session?.id) {
      const normalized = await normalizeSession(session);
      await saveNormalizedKyc(normalized, normalized.accountId);
      await writeAudit('STRIPE_WEBHOOK', normalized.accountId, {
        eventId: event.id,
        type: event.type,
        sessionId: normalized.sessionId,
        status: normalized.status,
      });
    }
    return sendJson(res, 200, { received: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/identity/kyc/start') {
    const payload = parseJson(await readBody(req));
    const origin = `${url.protocol}//${req.headers.host}`;
    return sendJson(res, 200, await handleKycStart(payload, origin));
  }
  if (req.method === 'POST' && url.pathname === '/api/identity/kyc/recover') {
    const payload = parseJson(await readBody(req));
    return sendJson(res, 200, await handleKycRecover(payload));
  }
  if (req.method === 'POST' && url.pathname === '/api/identity/kyc/bind') {
    const payload = parseJson(await readBody(req));
    return sendJson(res, 200, await handleKycBind(payload));
  }
  if (req.method === 'POST' && url.pathname === '/api/identity/kyc/status') {
    const payload = parseJson(await readBody(req));
    return sendJson(res, 200, await handleKycStatus(payload));
  }
  if (req.method === 'GET' && url.pathname === '/api/identity/kyc/status') {
    return sendJson(res, 405, {
      ok: false,
      error: 'SIGNED_POST_REQUIRED',
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/certificate') {
    const payload = parseJson(await readBody(req));
    const hcvId = safeHcvId(payload.hcvId);
    if (!hcvId) {
      const error = new Error('HCV_ID_INVALID');
      error.statusCode = 400;
      throw error;
    }
    const certificateRaw = payload.certificateRaw;
    const verified = verifyCertificate(certificateRaw, hcvId);
    const stored = await storeCertificateImmutable({
      hcvId,
      certificateSha256: verified.certificateSha256,
      certificateRaw,
      signerFingerprint: verified.signerFingerprint,
      contentHash: verified.contentHash,
    });
    await writeAudit(stored.created ? 'CERTIFICATE_CREATED' : 'CERTIFICATE_RETRY', hcvId, {
      certificateSha256: verified.certificateSha256,
    });
    return sendJson(res, stored.created ? 201 : 200, {
      ok: true,
      hcvId,
      created: stored.created,
      idempotent: stored.idempotent,
      certificateSha256: verified.certificateSha256,
      storage: 'postgresql',
      url: `/api/certificate/${hcvId}`,
    });
  }

  const certificateMatch = url.pathname.match(/^\/api\/certificate\/(HCV-[A-Za-z0-9_-]+)$/);
  if (req.method === 'GET' && certificateMatch) {
    const hcvId = safeHcvId(certificateMatch[1]);
    if (!hcvId) return sendJson(res, 400, { ok: false, error: 'HCV_ID_INVALID' });
    const row = await getCertificate(hcvId);
    if (!row) return sendJson(res, 404, { ok: false, error: 'CERTIFICATE_NOT_FOUND' });
    return sendJson(res, 200, {
      ok: true,
      hcvId: row.hcv_id,
      createdAt: row.created_at,
      certificateSha256: row.certificate_sha256,
      certificateRaw: row.certificate_raw,
    });
  }

  const verifyMatch = url.pathname.match(/^\/verify\/(HCV-[A-Za-z0-9_-]+)$/);
  if (req.method === 'GET' && verifyMatch) {
    const hcvId = safeHcvId(verifyMatch[1]);
    if (!hcvId) return sendHtml(res, 400, '<h1>Invalid HCV-ID</h1>');
    const row = await getCertificate(hcvId);
    if (!row) return sendHtml(res, 404, '<h1>Certificate not found</h1>');
    return sendHtml(res, 200, certificatePage(row));
  }

  return sendJson(res, 404, { ok: false, error: 'ENDPOINT_NOT_FOUND' });
}

async function main() {
  await initSchema();
  const server = http.createServer((req, res) => {
    requestHandler(req, res).catch((error) => {
      console.error('[request-error]', error.message);
      sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'INTERNAL_ERROR',
      });
    });
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SIGILLUM Registry PostgreSQL listening on 0.0.0.0:${PORT}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[startup-error]', error);
    process.exit(1);
  });
}

module.exports = {
  safeHcvId,
  safeAccountId,
  safeSessionId,
  parseStoredCertificate,
  publicKycPayload,
};
