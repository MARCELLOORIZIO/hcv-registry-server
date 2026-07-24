const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PUBLIC_PORT = Number(process.env.PORT || 8080);
const LEGACY_PORT = Number(process.env.LEGACY_PORT || PUBLIC_PORT + 1);
const originalPort = process.env.PORT;

// Start the existing Registry server unchanged on a private loopback port.
process.env.PORT = String(LEGACY_PORT);
require('./server.js');
if (originalPort == null) {
  delete process.env.PORT;
} else {
  process.env.PORT = originalPort;
}

const dbPath = process.env.DB_PATH || path.join(__dirname, 'registry.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS kyc_device_bindings (
    device_key_fingerprint TEXT PRIMARY KEY,
    public_key_json TEXT NOT NULL,
    provider_session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    creator_id TEXT,
    status TEXT NOT NULL,
    verified_legal_name TEXT,
    verified_country TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`);

const upsertKycBinding = db.prepare(`
INSERT INTO kyc_device_bindings (
    device_key_fingerprint, public_key_json, provider_session_id, provider,
    creator_id, status, verified_legal_name, verified_country,
    created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(device_key_fingerprint) DO UPDATE SET
    public_key_json = excluded.public_key_json,
    provider_session_id = excluded.provider_session_id,
    provider = excluded.provider,
    creator_id = excluded.creator_id,
    status = excluded.status,
    verified_legal_name = excluded.verified_legal_name,
    verified_country = excluded.verified_country,
    updated_at = excluded.updated_at
`);

const getKycBinding = db.prepare(`
SELECT * FROM kyc_device_bindings WHERE device_key_fingerprint = ?
`);

const updateKycBindingStatus = db.prepare(`
UPDATE kyc_device_bindings
SET status = ?, verified_legal_name = ?, verified_country = ?, updated_at = ?
WHERE provider_session_id = ?
`);

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifyDeviceKeyProof(payload) {
  const deviceKeyFingerprint = String(payload.deviceKeyFingerprint || '').trim();
  const publicKey = payload.publicKey || {};
  const modulus = String(publicKey.modulus || '');
  const exponent = String(publicKey.exponent || '');
  const signedAt = String(payload.signedAt || '');
  const signature = String(payload.signature || '');
  const signedTime = Date.parse(signedAt);

  if (
    !/^[a-f0-9]{64}$/i.test(deviceKeyFingerprint) ||
    !modulus ||
    !exponent ||
    !signature ||
    !Number.isFinite(signedTime)
  ) {
    throw Object.assign(new Error('INVALID_DEVICE_KEY_PROOF'), { statusCode: 400 });
  }

  if (Math.abs(Date.now() - signedTime) > 5 * 60 * 1000) {
    throw Object.assign(new Error('EXPIRED_DEVICE_KEY_PROOF'), { statusCode: 401 });
  }

  const normalizedPublicKey = { modulus, exponent };
  const calculatedFingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(normalizedPublicKey), 'utf8')
    .digest('hex');

  if (calculatedFingerprint.toLowerCase() !== deviceKeyFingerprint.toLowerCase()) {
    throw Object.assign(new Error('DEVICE_KEY_FINGERPRINT_MISMATCH'), {
      statusCode: 401,
    });
  }

  const statement = JSON.stringify({
    purpose: 'SIGILLUM_KYC_DEVICE_BINDING_V1',
    deviceKeyFingerprint,
    signedAt,
  });

  const keyObject = crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: Buffer.from(modulus, 'base64').toString('base64url'),
      e: Buffer.from(exponent, 'base64').toString('base64url'),
    },
    format: 'jwk',
  });

  const valid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(statement, 'utf8'),
    keyObject,
    Buffer.from(signature, 'base64'),
  );

  if (!valid) {
    throw Object.assign(new Error('INVALID_DEVICE_KEY_SIGNATURE'), {
      statusCode: 401,
    });
  }

  return { deviceKeyFingerprint, normalizedPublicKey };
}

async function createKycSession(payload, origin) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw Object.assign(new Error('KYC_NOT_CONFIGURED'), { statusCode: 501 });
  }

  const creatorId = String(payload.creatorId || '').slice(0, 120);
  const creatorName = String(payload.creatorName || '').slice(0, 160);
  const returnUrl =
    process.env.SIGILLUM_KYC_RETURN_URL || `${origin}/kyc-return`;

  const params = new URLSearchParams();
  params.append('type', 'document');
  params.append('options[document][require_live_capture]', 'true');
  params.append('options[document][require_matching_selfie]', 'true');
  params.append('metadata[creatorId]', creatorId);
  params.append('metadata[creatorName]', creatorName);
  params.append('return_url', returnUrl);

  const stripeResponse = await fetch(
    'https://api.stripe.com/v1/identity/verification_sessions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  );

  const text = await stripeResponse.text();
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch (_) {
    decoded = { raw: text };
  }

  if (!stripeResponse.ok) {
    throw Object.assign(
      new Error(decoded?.error?.message || `STRIPE_HTTP_${stripeResponse.status}`),
      { statusCode: 502 },
    );
  }

  return {
    ok: true,
    provider: 'stripe_identity',
    sessionId: decoded.id,
    url: decoded.url || '',
    status: decoded.status || 'created',
  };
}

async function getKycSessionStatus(sessionId) {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw Object.assign(new Error('KYC_NOT_CONFIGURED'), { statusCode: 501 });
  }

  const cleaned = String(sessionId || '').trim();
  if (!cleaned || !cleaned.startsWith('vs_')) {
    throw Object.assign(new Error('INVALID_KYC_SESSION'), { statusCode: 400 });
  }

  const stripeResponse = await fetch(
    `https://api.stripe.com/v1/identity/verification_sessions/${encodeURIComponent(cleaned)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      },
    },
  );

  const text = await stripeResponse.text();
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch (_) {
    decoded = { raw: text };
  }

  if (!stripeResponse.ok) {
    throw Object.assign(
      new Error(decoded?.error?.message || `STRIPE_HTTP_${stripeResponse.status}`),
      { statusCode: 502 },
    );
  }

  let verificationReport = null;
  const reportId =
    typeof decoded.last_verification_report === 'string'
      ? decoded.last_verification_report
      : decoded.last_verification_report?.id;

  if (reportId) {
    try {
      const reportResponse = await fetch(
        `https://api.stripe.com/v1/identity/verification_reports/${encodeURIComponent(reportId)}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          },
        },
      );
      if (reportResponse.ok) {
        verificationReport = JSON.parse(await reportResponse.text());
      }
    } catch (_) {}
  }

  const reportDocument = verificationReport?.document || {};
  const verifiedOutputs =
    decoded.verified_outputs || reportDocument.verified_outputs || {};
  const firstName =
    verifiedOutputs.first_name ||
    reportDocument.first_name ||
    reportDocument.name?.first_name ||
    '';
  const lastName =
    verifiedOutputs.last_name ||
    reportDocument.last_name ||
    reportDocument.name?.last_name ||
    '';
  const legalName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const country =
    verifiedOutputs.address?.country || reportDocument.address?.country || '';

  return {
    ok: true,
    provider: 'stripe_identity',
    sessionId: decoded.id,
    creatorId: String(decoded.metadata?.creatorId || '').slice(0, 120),
    status: decoded.status,
    url: decoded.url || '',
    lastError: decoded.last_error || null,
    verifiedOutputs: {
      legalName,
      firstName,
      lastName,
      country,
    },
    verified: decoded.status === 'verified',
  };
}

function storeKycBinding(payload, proof, session) {
  const now = new Date().toISOString();
  upsertKycBinding.run(
    proof.deviceKeyFingerprint,
    JSON.stringify(proof.normalizedPublicKey),
    session.sessionId,
    session.provider || 'stripe_identity',
    String(payload.creatorId || '').slice(0, 120),
    session.status || 'created',
    session.verifiedOutputs?.legalName || '',
    session.verifiedOutputs?.country || '',
    now,
    now,
  );
}

function storeKycStatus(session) {
  updateKycBindingStatus.run(
    session.status || 'unknown',
    session.verifiedOutputs?.legalName || '',
    session.verifiedOutputs?.country || '',
    new Date().toISOString(),
    session.sessionId,
  );
}

function kycErrorBody(error, operation) {
  const configuredMessage =
    'KYC non ancora configurato sul server. Configura STRIPE_SECRET_KEY per attivare Stripe Identity.';
  const fallback = {
    start: 'KYC non disponibile in questo momento.',
    recover: 'Recupero KYC non disponibile in questo momento.',
    bind: 'Associazione KYC non disponibile in questo momento.',
    status: 'Stato KYC non disponibile in questo momento.',
  }[operation];

  return {
    ok: false,
    error: error.message || String(error),
    message: error.message === 'KYC_NOT_CONFIGURED' ? configuredMessage : fallback,
  };
}

async function handleKyc(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/identity/kyc/start') {
    const payload = JSON.parse((await readBody(req)) || '{}');
    try {
      const proof = verifyDeviceKeyProof(payload);
      const existing = getKycBinding.get(proof.deviceKeyFingerprint);
      if (existing) {
        const recovered = await getKycSessionStatus(existing.provider_session_id);
        storeKycStatus(recovered);
        return sendJson(res, 200, {
          ...recovered,
          found: true,
          recovered: true,
        });
      }

      const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim();
      const protocol = forwardedProto || 'https';
      const origin = `${protocol}://${req.headers.host}`;
      const session = await createKycSession(payload, origin);
      storeKycBinding(payload, proof, session);
      return sendJson(res, 200, session);
    } catch (error) {
      return sendJson(res, error.statusCode || 500, kycErrorBody(error, 'start'));
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/identity/kyc/recover') {
    const payload = JSON.parse((await readBody(req)) || '{}');
    try {
      const proof = verifyDeviceKeyProof(payload);
      const binding = getKycBinding.get(proof.deviceKeyFingerprint);
      if (!binding) {
        return sendJson(res, 404, { ok: false, found: false });
      }
      const session = await getKycSessionStatus(binding.provider_session_id);
      storeKycStatus(session);
      return sendJson(res, 200, {
        ...session,
        found: true,
        recovered: true,
      });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ...kycErrorBody(error, 'recover'),
        found: false,
      });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/identity/kyc/bind') {
    const payload = JSON.parse((await readBody(req)) || '{}');
    try {
      const proof = verifyDeviceKeyProof(payload);
      const sessionId = String(payload.sessionId || '').trim();
      if (!sessionId) {
        throw Object.assign(new Error('MISSING_KYC_SESSION_ID'), {
          statusCode: 400,
        });
      }
      const session = await getKycSessionStatus(sessionId);
      const creatorId = String(payload.creatorId || '').slice(0, 120);
      if (session.creatorId && session.creatorId !== creatorId) {
        throw Object.assign(new Error('KYC_CREATOR_MISMATCH'), {
          statusCode: 403,
        });
      }
      storeKycBinding(payload, proof, session);
      return sendJson(res, 200, {
        ...session,
        found: true,
        bound: true,
      });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, kycErrorBody(error, 'bind'));
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/identity/kyc/status') {
    try {
      const session = await getKycSessionStatus(url.searchParams.get('sessionId'));
      storeKycStatus(session);
      return sendJson(res, 200, session);
    } catch (error) {
      return sendJson(res, error.statusCode || 500, kycErrorBody(error, 'status'));
    }
  }

  return false;
}

function proxyToLegacy(req, res) {
  const proxy = http.request(
    {
      hostname: '127.0.0.1',
      port: LEGACY_PORT,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    legacyResponse => {
      res.writeHead(legacyResponse.statusCode || 502, legacyResponse.headers);
      legacyResponse.pipe(res);
    },
  );

  proxy.on('error', error => {
    if (!res.headersSent) {
      sendJson(res, 502, {
        ok: false,
        error: 'LEGACY_REGISTRY_UNAVAILABLE',
        message: error.message,
      });
    } else {
      res.end();
    }
  });

  req.pipe(proxy);
}

const publicServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'hcv-registry-proxy',
        certificateRegistry: true,
        kycApi: true,
        stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      });
    }

    if (url.pathname.startsWith('/api/identity/kyc/')) {
      const handled = await handleKyc(req, res, url);
      if (handled !== false) return handled;
      return sendJson(res, 404, {
        ok: false,
        error: 'Endpoint KYC non trovato',
      });
    }

    return proxyToLegacy(req, res);
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || String(error),
    });
  }
});

publicServer.listen(PUBLIC_PORT, '0.0.0.0', () => {
  console.log(
    `HCV Registry KYC proxy listening on http://0.0.0.0:${PUBLIC_PORT}; legacy registry on 127.0.0.1:${LEGACY_PORT}`,
  );
});
