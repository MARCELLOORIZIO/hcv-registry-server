const http = require('http');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'SIGILLUM <noreply@example.invalid>';
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const NODE_ENV = process.env.NODE_ENV || 'development';
const SUBSCRIPTIONS_ENFORCED = process.env.SUBSCRIPTIONS_ENFORCED === 'true';
const TERMS_VERSION = process.env.TERMS_VERSION || '2026-08-11';
const PRIVACY_VERSION = process.env.PRIVACY_VERSION || '2026-08-11';
const SESSION_DAYS = 30;
const CODE_TTL_MINUTES = 15;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL_REQUIRED');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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

async function readJson(req, maxBytes = 1_000_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
      const err = new Error('PAYLOAD_TOO_LARGE');
      err.statusCode = 413;
      throw err;
    }
  }
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (_) {
    const err = new Error('INVALID_JSON');
    err.statusCode = 400;
    throw err;
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validateEmail(value) {
  const email = normalizeEmail(value);
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw publicError('EMAIL_NON_VALIDA', 400);
  }
  return email;
}

function validatePassword(value, code = 'PASSWORD_NON_VALIDA') {
  const password = String(value || '');
  if (password.length < 12 || password.length > 128) throw publicError(code, 400);
  return password;
}

function validateName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 160) throw publicError('NOME_NON_VALIDO', 400);
  return name;
}

function publicError(code, statusCode = 400, customMessage = '') {
  const messages = {
    EMAIL_NON_VALIDA: 'Inserisci un indirizzo email valido.',
    PASSWORD_NON_VALIDA: 'La password deve contenere da 12 a 128 caratteri.',
    NUOVA_PASSWORD_NON_VALIDA: 'La nuova password deve contenere da 12 a 128 caratteri.',
    NOME_NON_VALIDO: 'Inserisci un nome valido.',
    ACCOUNT_ESISTENTE: 'Esiste già un account con questa email.',
    ACCOUNT_NON_TROVATO: 'Account non trovato.',
    CREDENZIALI_NON_VALIDE: 'Email o password non corrette.',
    EMAIL_NON_VERIFICATA: 'Verifica prima il tuo indirizzo email.',
    CODICE_NON_VALIDO: 'Il codice non è valido o è scaduto.',
    SESSIONE_MANCANTE: 'Accedi per continuare.',
    SESSIONE_NON_VALIDA: 'La sessione non è valida. Accedi nuovamente.',
    IDENTITA_NON_VERIFICATA: 'Completa la verifica della tua identità per certificare contenuti.',
    ABBONAMENTO_NON_ATTIVO: 'È necessario un abbonamento Creator attivo per certificare contenuti.',
    TERMINI_NON_ACCETTATI: 'Accetta i Termini di servizio e conferma di aver letto la Privacy Policy.',
    MAGGIORENNE_RICHIESTO: 'SIGILLUM Creator è riservato agli utenti maggiorenni.',
    CERTIFICATO_ESISTENTE: 'Questo HCV-ID è già presente nel Registry.',
    CERTIFICATO_NON_VALIDO: 'Il certificato HCV non è valido.',
    TROPPI_TENTATIVI: 'Troppi tentativi. Riprova più tardi.',
  };
  const error = new Error(code);
  error.statusCode = statusCode;
  error.publicMessage = customMessage || messages[code] || 'Operazione non disponibile.';
  return error;
}

function randomId(prefix = '') {
  return prefix + crypto.randomBytes(18).toString('base64url');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function makeCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

async function hashPassword(password, salt = crypto.randomBytes(16)) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) return reject(err);
      resolve({ salt: salt.toString('base64'), passwordHash: key.toString('base64') });
    });
  });
}

async function passwordMatches(password, account) {
  const candidate = await hashPassword(password, Buffer.from(account.password_salt, 'base64'));
  const a = Buffer.from(candidate.passwordHash, 'base64');
  const b = Buffer.from(account.password_hash, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email_normalized TEXT UNIQUE NOT NULL,
      email_display TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      creator_id TEXT,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      terms_version TEXT NOT NULL DEFAULT '',
      privacy_version TEXT NOT NULL DEFAULT '',
      terms_accepted_at TIMESTAMPTZ,
      privacy_ack_at TIMESTAMPTZ,
      adult_confirmed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS account_devices (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      device_key_fingerprint TEXT NOT NULL,
      public_key_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(account_id, device_key_fingerprint)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      device_key_fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id, revoked_at, expires_at);
    CREATE TABLE IF NOT EXISTS email_codes (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(account_id, purpose)
    );
    CREATE TABLE IF NOT EXISTS identities (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'stripe_identity',
      provider_session_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'not_started',
      verified_legal_name TEXT NOT NULL DEFAULT '',
      verified_country TEXT NOT NULL DEFAULT '',
      verified_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'app_store',
      product_id TEXT NOT NULL DEFAULT '',
      original_transaction_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'inactive',
      expires_at TIMESTAMPTZ,
      environment TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS certificates (
      hcv_id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      certificate_raw TEXT NOT NULL,
      certificate_sha256 TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS certificates_account_idx ON certificates(account_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS security_events (
      id BIGSERIAL PRIMARY KEY,
      account_id TEXT,
      event_type TEXT NOT NULL,
      detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function securityEvent(accountId, type, detail = {}) {
  try {
    await pool.query('INSERT INTO security_events(account_id,event_type,detail_json) VALUES($1,$2,$3)', [accountId || null, type, detail]);
  } catch (_) {}
}

const rateMap = new Map();
function enforceRate(req, key, limit = 12, windowMs = 15 * 60 * 1000) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const id = `${ip}|${key}`;
  const now = Date.now();
  let entry = rateMap.get(id);
  if (!entry || now - entry.start >= windowMs) entry = { start: now, count: 0 };
  entry.count += 1;
  rateMap.set(id, entry);
  if (entry.count > limit) throw publicError('TROPPI_TENTATIVI', 429);
  if (rateMap.size > 10000) {
    for (const [candidate, value] of rateMap) if (now - value.start > windowMs) rateMap.delete(candidate);
  }
}

async function sendCode(email, code, purpose) {
  const label = purpose === 'verify_email' ? 'verifica il tuo indirizzo email' : 'reimposta la password';
  if (!RESEND_API_KEY) {
    if (NODE_ENV === 'production') throw new Error('RESEND_API_KEY_REQUIRED');
    console.log(`[DEV EMAIL] ${email} ${purpose}: ${code}`);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [email],
      subject: purpose === 'verify_email' ? 'Verifica il tuo account SIGILLUM' : 'Reimposta la password SIGILLUM',
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>SIGILLUM</h2><p>Usa questo codice per ${label}:</p><div style="font-size:34px;font-weight:800;letter-spacing:8px">${code}</div><p>Il codice scade tra ${CODE_TTL_MINUTES} minuti. Se non hai richiesto questa operazione, ignora il messaggio.</p></div>`,
    }),
  });
  if (!response.ok) throw new Error(`EMAIL_PROVIDER_${response.status}`);
}

async function storeCode(accountId, purpose, code) {
  await pool.query(`
    INSERT INTO email_codes(account_id,purpose,code_hash,expires_at,attempts,created_at)
    VALUES($1,$2,$3,NOW()+($4 || ' minutes')::interval,0,NOW())
    ON CONFLICT(account_id,purpose) DO UPDATE SET code_hash=EXCLUDED.code_hash, expires_at=EXCLUDED.expires_at, attempts=0, created_at=NOW()
  `, [accountId, purpose, hash(code), String(CODE_TTL_MINUTES)]);
}

async function consumeCode(accountId, purpose, code) {
  const result = await pool.query('SELECT * FROM email_codes WHERE account_id=$1 AND purpose=$2', [accountId, purpose]);
  const row = result.rows[0];
  if (!row || new Date(row.expires_at).getTime() <= Date.now() || row.attempts >= 8 || row.code_hash !== hash(String(code || '').trim())) {
    if (row) await pool.query('UPDATE email_codes SET attempts=attempts+1 WHERE account_id=$1 AND purpose=$2', [accountId, purpose]);
    throw publicError('CODICE_NON_VALIDO', 400);
  }
  await pool.query('DELETE FROM email_codes WHERE account_id=$1 AND purpose=$2', [accountId, purpose]);
}

function verifyDeviceProof(payload) {
  const fingerprint = String(payload.deviceKeyFingerprint || '').trim();
  const publicKey = payload.publicKey || {};
  const modulus = String(publicKey.modulus || '');
  const exponent = String(publicKey.exponent || '');
  const signedAt = String(payload.signedAt || '');
  const signature = String(payload.signature || '');
  const ts = Date.parse(signedAt);
  if (!/^[a-f0-9]{64}$/i.test(fingerprint) || !modulus || !exponent || !signature || !Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    throw publicError('SESSIONE_NON_VALIDA', 401, 'Identità tecnica del dispositivo non valida.');
  }
  const normalized = { modulus, exponent };
  const calculated = hash(JSON.stringify(normalized));
  if (calculated.toLowerCase() !== fingerprint.toLowerCase()) throw publicError('SESSIONE_NON_VALIDA', 401, 'La chiave del dispositivo non coincide.');
  const statement = JSON.stringify({ purpose: 'SIGILLUM_AUTH_DEVICE_BINDING_V1', deviceKeyFingerprint: fingerprint, signedAt });
  const keyObject = crypto.createPublicKey({
    key: { kty: 'RSA', n: Buffer.from(modulus, 'base64').toString('base64url'), e: Buffer.from(exponent, 'base64').toString('base64url') },
    format: 'jwk',
  });
  const valid = crypto.verify('RSA-SHA256', Buffer.from(statement), keyObject, Buffer.from(signature, 'base64'));
  if (!valid) throw publicError('SESSIONE_NON_VALIDA', 401, 'Firma del dispositivo non valida.');
  return { fingerprint, normalized };
}

async function issueSession(accountId, fingerprint) {
  const token = randomId('s_');
  const tokenHash = hash(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await pool.query('INSERT INTO sessions(token_hash,account_id,device_key_fingerprint,expires_at) VALUES($1,$2,$3,$4)', [tokenHash, accountId, fingerprint, expiresAt]);
  return { token, expiresAt: expiresAt.toISOString() };
}

function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  return match ? match[1].trim() : '';
}

async function authenticate(req) {
  const token = bearer(req);
  if (!token) throw publicError('SESSIONE_MANCANTE', 401);
  const result = await pool.query(`
    SELECT s.*, a.email_display, a.creator_name, a.creator_id, a.email_verified,
           a.terms_version, a.privacy_version, a.terms_accepted_at, a.privacy_ack_at, a.adult_confirmed_at
    FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1
  `, [hash(token)]);
  const row = result.rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) throw publicError('SESSIONE_NON_VALIDA', 401);
  await pool.query('UPDATE sessions SET last_seen_at=NOW() WHERE token_hash=$1', [row.token_hash]);
  return row;
}

async function accountEnvelope(accountId, currentFingerprint = '') {
  const account = (await pool.query('SELECT * FROM accounts WHERE id=$1', [accountId])).rows[0];
  if (!account) throw publicError('ACCOUNT_NON_TROVATO', 404);
  const identity = (await pool.query('SELECT * FROM identities WHERE account_id=$1', [accountId])).rows[0];
  const subscription = (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1', [accountId])).rows[0];
  const deviceCount = Number((await pool.query('SELECT COUNT(*)::int AS c FROM account_devices WHERE account_id=$1', [accountId])).rows[0].c || 0);
  return {
    id: account.id,
    email: account.email_display,
    creatorName: account.creator_name,
    creatorId: account.creator_id || '',
    emailVerified: Boolean(account.email_verified),
    termsAccepted: Boolean(account.terms_accepted_at),
    privacyAcknowledged: Boolean(account.privacy_ack_at),
    adultConfirmed: Boolean(account.adult_confirmed_at),
    termsVersion: account.terms_version,
    privacyVersion: account.privacy_version,
    deviceCount,
    currentDeviceKeyFingerprint: currentFingerprint,
    kycStatus: identity?.status || 'not_started',
    legalIdentityVerified: identity?.status === 'verified',
    subscriptionStatus: subscription?.status || (SUBSCRIPTIONS_ENFORCED ? 'inactive' : 'development_allowed'),
    subscriptionProductId: subscription?.product_id || '',
    subscriptionExpiresAt: subscription?.expires_at || null,
    creatorAccess: Boolean(account.email_verified && account.terms_accepted_at && account.privacy_ack_at && account.adult_confirmed_at && identity?.status === 'verified' && (!SUBSCRIPTIONS_ENFORCED || subscription?.status === 'active')),
  };
}

function safeHcvId(value) {
  const id = String(value || '').trim().toUpperCase();
  return /^HCV-[A-F0-9]{16}$/.test(id) ? id : null;
}

function verifyCertificateRaw(raw, expectedId) {
  let cert;
  try { cert = JSON.parse(raw); } catch (_) { throw publicError('CERTIFICATO_NON_VALIDO', 400); }
  if (!cert || typeof cert !== 'object' || cert.format !== 'HCV_CERTIFICATE' || Number(cert.version) !== 2) throw publicError('CERTIFICATO_NON_VALIDO', 400);
  const hcvId = safeHcvId(cert?.meta?.hcvId);
  if (!hcvId || hcvId !== expectedId) throw publicError('CERTIFICATO_NON_VALIDO', 400, 'HCV-ID non coerente con il certificato.');
  if (cert.signatureAlgorithm !== 'RSA-SHA256-HCV-V2' || !cert.signature || !cert.publicKey?.modulus || !cert.publicKey?.exponent) throw publicError('CERTIFICATO_NON_VALIDO', 400);
  const signed = { ...cert };
  delete signed.signatureAlgorithm;
  delete signed.signature;
  delete signed.publicKey;
  const keyObject = crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: Buffer.from(String(cert.publicKey.modulus), 'base64').toString('base64url'),
      e: Buffer.from(String(cert.publicKey.exponent), 'base64').toString('base64url'),
    },
    format: 'jwk',
  });
  const valid = crypto.verify('RSA-SHA256', Buffer.from(JSON.stringify(signed), 'utf8'), keyObject, Buffer.from(String(cert.signature), 'base64'));
  if (!valid) throw publicError('CERTIFICATO_NON_VALIDO', 400, 'Firma HCV non valida.');
  const chain = Array.isArray(cert.chain) ? cert.chain : [];
  for (let i = 0; i < chain.length; i += 1) {
    const event = chain[i];
    const expectedPrev = i === 0 ? 'GENESIS' : chain[i - 1]?.hash;
    if (event?.prev !== expectedPrev) throw publicError('CERTIFICATO_NON_VALIDO', 400, 'Catena HCV non coerente.');
    const copy = { type: event.type, timestamp: event.timestamp, prev: event.prev };
    const eventHash = hash(JSON.stringify(copy));
    if (event.hash !== eventHash) throw publicError('CERTIFICATO_NON_VALIDO', 400, 'Hash della catena HCV non valido.');
  }
  const rootHash = hash(JSON.stringify(chain));
  if (cert.rootHash !== rootHash) throw publicError('CERTIFICATO_NON_VALIDO', 400, 'Root hash HCV non valido.');
  return cert;
}

async function requireCreatorAccess(req) {
  const session = await authenticate(req);
  const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
  if (!account.emailVerified || !account.termsAccepted || !account.privacyAcknowledged || !account.adultConfirmed) throw publicError('TERMINI_NON_ACCETTATI', 403);
  if (!account.legalIdentityVerified) throw publicError('IDENTITA_NON_VERIFICATA', 403);
  if (SUBSCRIPTIONS_ENFORCED && account.subscriptionStatus !== 'active') throw publicError('ABBONAMENTO_NON_ATTIVO', 402);
  return { session, account };
}

async function stripeRequest(path, options = {}) {
  if (!STRIPE_SECRET_KEY) throw Object.assign(new Error('KYC_NOT_CONFIGURED'), { statusCode: 501 });
  const response = await fetch(`https://api.stripe.com${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, ...(options.headers || {}) },
  });
  const text = await response.text();
  let decoded = {};
  try { decoded = JSON.parse(text); } catch (_) {}
  if (!response.ok) throw Object.assign(new Error(decoded?.error?.message || `STRIPE_HTTP_${response.status}`), { statusCode: 502 });
  return decoded;
}

async function startKyc(accountId, origin) {
  const existing = (await pool.query('SELECT * FROM identities WHERE account_id=$1', [accountId])).rows[0];
  if (existing?.status === 'verified') return { status: 'verified', verified: true, sessionId: existing.provider_session_id, url: '' };
  const returnUrl = process.env.SIGILLUM_KYC_RETURN_URL || `${origin}/kyc-return`;
  const params = new URLSearchParams();
  params.append('type', 'document');
  params.append('options[document][require_live_capture]', 'true');
  params.append('options[document][require_matching_selfie]', 'true');
  params.append('metadata[accountId]', accountId);
  params.append('return_url', returnUrl);
  const decoded = await stripeRequest('/v1/identity/verification_sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(),
  });
  await pool.query(`
    INSERT INTO identities(account_id,provider,provider_session_id,status,updated_at)
    VALUES($1,'stripe_identity',$2,$3,NOW())
    ON CONFLICT(account_id) DO UPDATE SET provider_session_id=EXCLUDED.provider_session_id,status=EXCLUDED.status,updated_at=NOW()
  `, [accountId, decoded.id, decoded.status || 'created']);
  return { ok: true, provider: 'stripe_identity', sessionId: decoded.id, url: decoded.url || '', status: decoded.status || 'created' };
}

async function refreshKyc(accountId) {
  const identity = (await pool.query('SELECT * FROM identities WHERE account_id=$1', [accountId])).rows[0];
  if (!identity?.provider_session_id) return { ok: true, status: 'not_started', verified: false, url: '' };
  const decoded = await stripeRequest(`/v1/identity/verification_sessions/${encodeURIComponent(identity.provider_session_id)}?expand[]=last_verification_report`);
  const report = decoded.last_verification_report || {};
  const doc = report.document || {};
  const firstName = doc.first_name || doc.name?.first_name || '';
  const lastName = doc.last_name || doc.name?.last_name || '';
  const legalName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const country = doc.address?.country || '';
  const verified = decoded.status === 'verified';
  await pool.query(`UPDATE identities SET status=$2, verified_legal_name=$3, verified_country=$4, verified_at=CASE WHEN $5 THEN COALESCE(verified_at,NOW()) ELSE verified_at END, updated_at=NOW() WHERE account_id=$1`, [accountId, decoded.status || 'unknown', legalName, country, verified]);
  return { ok: true, provider: 'stripe_identity', sessionId: identity.provider_session_id, status: decoded.status || 'unknown', url: decoded.url || '', verified, verifiedOutputs: { legalName, country }, lastError: decoded.last_error || null };
}

function legalShell(title, body) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - SIGILLUM</title><style>body{margin:0;background:#071511;color:#f4f1e8;font:16px/1.55 Arial,sans-serif}.page{max-width:900px;margin:auto;padding:28px 20px 60px}a{color:#76ded3}h1{font-size:34px}h2{color:#76ded3;margin-top:30px}.card{background:#10201b;padding:20px;border-radius:10px;margin:18px 0}.muted{color:#b8c4be}</style></head><body><main class="page"><h1>${title}</h1>${body}<p class="muted">MAORI DI MARCELLO ORIZIO · Via della Battaglia 28, 25030 Maclodio (BS) · P.IVA 04773680980 · REA BS-640525 · PEC marcelloorizio@legalmail.it</p></main></body></html>`;
}

function legalPage(pathname) {
  if (pathname === '/privacy') return legalShell('Informativa Privacy SIGILLUM', `<p>Versione ${PRIVACY_VERSION}. Titolare del trattamento: MAORI DI MARCELLO ORIZIO.</p><h2>Dati trattati</h2><p>Account, email, dati tecnici del dispositivo, dati e stato della verifica identità, informazioni di abbonamento, HCV-ID, certificati, hash e metadati necessari alla certificazione e verifica.</p><h2>Finalità</h2><p>Creazione e gestione dell'account; sicurezza e prevenzione abusi; verifica dell'identità dei creator; erogazione del servizio di certificazione e Registry; assistenza; adempimenti legali e contabili.</p><h2>Base giuridica</h2><p>Esecuzione del contratto e misure precontrattuali per le funzioni richieste; obblighi di legge ove applicabili; legittimo interesse per sicurezza, antifrode e tutela dell'integrità del Registry. Eventuali trattamenti facoltativi richiederanno consenso separato.</p><h2>Stripe Identity</h2><p>La verifica identità utilizza Stripe Identity. Documenti e selfie sono acquisiti e trattati tramite Stripe per verificare l'identità. SIGILLUM conserva lo stato della verifica, il riferimento tecnico della sessione e i dati minimi necessari al collegamento dell'identità con l'account.</p><h2>Conservazione</h2><p>I dati account sono conservati per la durata del rapporto e successivamente per il tempo necessario agli obblighi applicabili. I record tecnici dei certificati possono essere conservati per preservare integrità, verificabilità e prevenzione delle frodi, con minimizzazione o pseudonimizzazione dei dati personali quando possibile.</p><h2>Diritti</h2><p>L'interessato può esercitare i diritti previsti dalla normativa applicabile, inclusi accesso, rettifica, cancellazione, limitazione, opposizione e portabilità ove applicabili, e proporre reclamo all'autorità di controllo competente.</p><h2>Contatti</h2><p>PEC: marcelloorizio@legalmail.it. Prima del lancio verrà indicato anche l'indirizzo email dedicato privacy/supporto.</p>`);
  if (pathname === '/terms') return legalShell('Termini di Servizio SIGILLUM', `<p>Versione ${TERMS_VERSION}. Il servizio è fornito da MAORI DI MARCELLO ORIZIO.</p><h2>Funzione del servizio</h2><p>SIGILLUM crea e verifica evidenze tecniche di provenienza e integrità per foto, video e testo. Non garantisce la verità assoluta del contenuto e non sostituisce una perizia legale o forense.</p><h2>Creator</h2><p>Le funzioni di certificazione sono riservate a utenti maggiorenni con account, email verificata, identità verificata e, quando previsto, abbonamento Creator attivo.</p><h2>Responsabilità</h2><p>L'utente è responsabile dei contenuti prodotti, pubblicati o condivisi e non può utilizzare SIGILLUM per frode, impersonificazione, contenuti illeciti o dichiarazioni ingannevoli.</p><h2>Abbonamento</h2><p>Gli abbonamenti digitali acquistati tramite App Store sono gestiti secondo le condizioni e i sistemi di fatturazione Apple. La cancellazione dell'account non annulla automaticamente un abbonamento Apple.</p><h2>Registry</h2><p>Un certificato HCV valido è progettato per essere immutabile. La cancellazione dell'account può comportare la cancellazione o pseudonimizzazione dei dati personali separabili, mentre i record tecnici necessari a preservare la verificabilità possono essere mantenuti nei limiti consentiti dalla legge.</p>`);
  if (pathname === '/delete-data') return legalShell('Cancellazione account e dati', `<p>La cancellazione dell'account può essere avviata direttamente dall'app. Account, sessioni e dispositivi vengono cancellati. I record tecnici dei certificati già emessi possono essere mantenuti in forma minimizzata o pseudonimizzata quando necessario a preservare la verificabilità e l'integrità del Registry.</p>`);
  if (pathname === '/kyc-return') return legalShell('Verifica identità', `<p>La procedura di verifica è terminata. <a href="sigillum://kyc-return">Torna a SIGILLUM</a>.</p><script>setTimeout(()=>location.href='sigillum://kyc-return',300)</script>`);
  return null;
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const legal = legalPage(url.pathname);
  if (req.method === 'GET' && legal) return sendHtml(res, 200, legal);

  if (req.method === 'GET' && url.pathname === '/health') {
    const db = await pool.query('SELECT NOW() AS now');
    return sendJson(res, 200, { ok: true, service: 'sigillum-production-postgres', database: true, dbTime: db.rows[0].now, subscriptionsEnforced: SUBSCRIPTIONS_ENFORCED, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    enforceRate(req, 'register', 8);
    const body = await readJson(req);
    const email = validateEmail(body.email);
    const password = validatePassword(body.password);
    const creatorName = validateName(body.creatorName);
    if (body.acceptTerms !== true || body.acknowledgePrivacy !== true) throw publicError('TERMINI_NON_ACCETTATI', 400);
    if (body.adultConfirmed !== true) throw publicError('MAGGIORENNE_RICHIESTO', 400);
    const proof = verifyDeviceProof(body);
    const existing = await pool.query('SELECT id FROM accounts WHERE email_normalized=$1', [email]);
    if (existing.rowCount) throw publicError('ACCOUNT_ESISTENTE', 409);
    const pw = await hashPassword(password);
    const accountId = randomId('acc_');
    const now = new Date();
    await pool.query('BEGIN');
    try {
      await pool.query(`INSERT INTO accounts(id,email_normalized,email_display,password_salt,password_hash,creator_name,creator_id,terms_version,privacy_version,terms_accepted_at,privacy_ack_at,adult_confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10)`, [accountId, email, String(body.email).trim(), pw.salt, pw.passwordHash, creatorName, String(body.creatorId || ''), TERMS_VERSION, PRIVACY_VERSION, now]);
      await pool.query('INSERT INTO account_devices(account_id,device_key_fingerprint,public_key_json) VALUES($1,$2,$3)', [accountId, proof.fingerprint, proof.normalized]);
      await pool.query('COMMIT');
    } catch (err) { await pool.query('ROLLBACK'); throw err; }
    const code = makeCode();
    await storeCode(accountId, 'verify_email', code);
    await sendCode(String(body.email).trim(), code, 'verify_email');
    await securityEvent(accountId, 'ACCOUNT_REGISTERED');
    return sendJson(res, 201, { ok: true, requiresEmailVerification: true, email: String(body.email).trim() });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/verify-email') {
    enforceRate(req, 'verify-email', 12);
    const body = await readJson(req);
    const email = validateEmail(body.email);
    const account = (await pool.query('SELECT * FROM accounts WHERE email_normalized=$1', [email])).rows[0];
    if (!account) throw publicError('ACCOUNT_NON_TROVATO', 404);
    await consumeCode(account.id, 'verify_email', body.code);
    await pool.query('UPDATE accounts SET email_verified=TRUE, updated_at=NOW() WHERE id=$1', [account.id]);
    await securityEvent(account.id, 'EMAIL_VERIFIED');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/resend-email-code') {
    enforceRate(req, 'resend-email', 5);
    const body = await readJson(req);
    const email = validateEmail(body.email);
    const account = (await pool.query('SELECT * FROM accounts WHERE email_normalized=$1', [email])).rows[0];
    if (!account) return sendJson(res, 200, { ok: true });
    if (account.email_verified) return sendJson(res, 200, { ok: true, alreadyVerified: true });
    const code = makeCode(); await storeCode(account.id, 'verify_email', code); await sendCode(account.email_display, code, 'verify_email');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    enforceRate(req, 'login', 12);
    const body = await readJson(req);
    const email = validateEmail(body.email);
    const account = (await pool.query('SELECT * FROM accounts WHERE email_normalized=$1', [email])).rows[0];
    if (!account || !(await passwordMatches(String(body.password || ''), account))) throw publicError('CREDENZIALI_NON_VALIDE', 401);
    if (!account.email_verified) throw publicError('EMAIL_NON_VERIFICATA', 403);
    const proof = verifyDeviceProof(body);
    await pool.query(`INSERT INTO account_devices(account_id,device_key_fingerprint,public_key_json,last_seen_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(account_id,device_key_fingerprint) DO UPDATE SET public_key_json=EXCLUDED.public_key_json,last_seen_at=NOW()`, [account.id, proof.fingerprint, proof.normalized]);
    const session = await issueSession(account.id, proof.fingerprint);
    await securityEvent(account.id, 'LOGIN', { device: proof.fingerprint });
    return sendJson(res, 200, { ok: true, token: session.token, expiresAt: session.expiresAt, account: await accountEnvelope(account.id, proof.fingerprint) });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const session = await authenticate(req);
    return sendJson(res, 200, { ok: true, expiresAt: session.expires_at, account: await accountEnvelope(session.account_id, session.device_key_fingerprint) });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/password/forgot') {
    enforceRate(req, 'forgot', 5);
    const body = await readJson(req);
    const email = validateEmail(body.email);
    const account = (await pool.query('SELECT * FROM accounts WHERE email_normalized=$1', [email])).rows[0];
    if (account) { const code = makeCode(); await storeCode(account.id, 'reset_password', code); await sendCode(account.email_display, code, 'reset_password'); }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/password/reset') {
    enforceRate(req, 'reset', 10);
    const body = await readJson(req);
    const email = validateEmail(body.email);
    const next = validatePassword(body.newPassword, 'NUOVA_PASSWORD_NON_VALIDA');
    const account = (await pool.query('SELECT * FROM accounts WHERE email_normalized=$1', [email])).rows[0];
    if (!account) throw publicError('CODICE_NON_VALIDO', 400);
    await consumeCode(account.id, 'reset_password', body.code);
    const pw = await hashPassword(next);
    await pool.query('BEGIN');
    try { await pool.query('UPDATE accounts SET password_salt=$2,password_hash=$3,updated_at=NOW() WHERE id=$1', [account.id, pw.salt, pw.passwordHash]); await pool.query('UPDATE sessions SET revoked_at=NOW() WHERE account_id=$1 AND revoked_at IS NULL', [account.id]); await pool.query('COMMIT'); } catch (err) { await pool.query('ROLLBACK'); throw err; }
    await securityEvent(account.id, 'PASSWORD_RESET');
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/profile') {
    const session = await authenticate(req); const body = await readJson(req); const name = validateName(body.creatorName);
    await pool.query('UPDATE accounts SET creator_name=$2,updated_at=NOW() WHERE id=$1', [session.account_id, name]);
    return sendJson(res, 200, { ok: true, expiresAt: session.expires_at, account: await accountEnvelope(session.account_id, session.device_key_fingerprint) });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/devices') {
    const session = await authenticate(req);
    const rows = (await pool.query('SELECT device_key_fingerprint,created_at,last_seen_at FROM account_devices WHERE account_id=$1 ORDER BY last_seen_at DESC', [session.account_id])).rows;
    return sendJson(res, 200, { ok: true, devices: rows.map(r => ({ fingerprint: r.device_key_fingerprint, createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.device_key_fingerprint === session.device_key_fingerprint })) });
  }

  if (req.method === 'POST' && (url.pathname === '/api/auth/logout' || url.pathname === '/api/auth/logout-all')) {
    const session = await authenticate(req);
    if (url.pathname.endsWith('logout-all')) await pool.query('UPDATE sessions SET revoked_at=NOW() WHERE account_id=$1 AND revoked_at IS NULL', [session.account_id]);
    else await pool.query('UPDATE sessions SET revoked_at=NOW() WHERE token_hash=$1', [session.token_hash]);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/delete') {
    const session = await authenticate(req); const body = await readJson(req);
    const account = (await pool.query('SELECT * FROM accounts WHERE id=$1', [session.account_id])).rows[0];
    if (!account || !(await passwordMatches(String(body.password || ''), account)) || body.confirmation !== 'DELETE') throw publicError('CREDENZIALI_NON_VALIDE', 401);
    await pool.query('BEGIN');
    try {
      await pool.query(`UPDATE certificates SET account_id=NULL, certificate_raw=certificate_raw WHERE account_id=$1`, [account.id]);
      await pool.query('DELETE FROM accounts WHERE id=$1', [account.id]);
      await pool.query('COMMIT');
    } catch (err) { await pool.query('ROLLBACK'); throw err; }
    await securityEvent(null, 'ACCOUNT_DELETED', { formerAccountHash: hash(account.id) });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/identity/kyc/start') {
    const session = await authenticate(req); const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
    if (!account.emailVerified || !account.termsAccepted || !account.adultConfirmed) throw publicError('TERMINI_NON_ACCETTATI', 403);
    if (SUBSCRIPTIONS_ENFORCED && account.subscriptionStatus !== 'active') throw publicError('ABBONAMENTO_NON_ATTIVO', 402);
    const origin = APP_BASE_URL || `https://${req.headers.host}`;
    return sendJson(res, 200, await startKyc(session.account_id, origin));
  }

  if (req.method === 'GET' && url.pathname === '/api/identity/kyc/status') {
    const session = await authenticate(req);
    return sendJson(res, 200, await refreshKyc(session.account_id));
  }

  if (req.method === 'GET' && url.pathname === '/api/billing/status') {
    const session = await authenticate(req);
    const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
    return sendJson(res, 200, { ok: true, enforced: SUBSCRIPTIONS_ENFORCED, status: account.subscriptionStatus, productId: account.subscriptionProductId, expiresAt: account.subscriptionExpiresAt });
  }

  if (req.method === 'POST' && url.pathname === '/api/certificate') {
    const access = await requireCreatorAccess(req); const body = await readJson(req, 5_000_000);
    const hcvId = safeHcvId(body.hcvId); const raw = String(body.certificateRaw || '');
    if (!hcvId || !raw) throw publicError('CERTIFICATO_NON_VALIDO', 400);
    verifyCertificateRaw(raw, hcvId);
    try {
      await pool.query('INSERT INTO certificates(hcv_id,account_id,certificate_raw,certificate_sha256) VALUES($1,$2,$3,$4)', [hcvId, access.session.account_id, raw, hash(raw)]);
    } catch (err) {
      if (err.code === '23505') throw publicError('CERTIFICATO_ESISTENTE', 409);
      throw err;
    }
    return sendJson(res, 201, { ok: true, hcvId, storage: 'postgres', url: `/api/certificate/${hcvId}` });
  }

  const certMatch = url.pathname.match(/^\/api\/certificate\/(HCV-[A-Fa-f0-9]{16})$/);
  if (req.method === 'GET' && certMatch) {
    const hcvId = safeHcvId(certMatch[1]);
    const row = (await pool.query('SELECT hcv_id,created_at,certificate_raw FROM certificates WHERE hcv_id=$1', [hcvId])).rows[0];
    if (!row) return sendJson(res, 404, { ok: false, error: 'Certificato non trovato' });
    return sendJson(res, 200, { ok: true, hcvId: row.hcv_id, createdAt: row.created_at, certificateRaw: row.certificate_raw });
  }

  const verifyMatch = url.pathname.match(/^\/verify\/(HCV-[A-Fa-f0-9]{16})$/);
  if (req.method === 'GET' && verifyMatch) {
    const hcvId = safeHcvId(verifyMatch[1]);
    const row = (await pool.query('SELECT created_at,certificate_raw FROM certificates WHERE hcv_id=$1', [hcvId])).rows[0];
    if (!row) return sendHtml(res, 404, legalShell('Certificato non trovato', '<p>Questo HCV-ID non è presente nel Registry.</p>'));
    let cert; try { cert = verifyCertificateRaw(row.certificate_raw, hcvId); } catch (_) { return sendHtml(res, 422, legalShell('Certificato non valido', '<p>Il record esiste ma la firma o la catena HCV non risultano valide.</p>')); }
    const type = cert?.content?.type || 'unknown';
    return sendHtml(res, 200, legalShell('HUMAN VERIFIED', `<div class="card"><h2>Certificato HCV valido</h2><p><strong>HCV-ID:</strong> ${hcvId}</p><p><strong>Tipo:</strong> ${type}</p><p><strong>Firma:</strong> RSA-SHA256-HCV-V2</p><p>Il Registry ha verificato firma e catena crittografica del certificato.</p></div>`));
  }

  return sendJson(res, 404, { ok: false, error: 'ENDPOINT_NOT_FOUND' });
}

async function main() {
  await initSchema();
  const server = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      console.error(err);
      sendJson(res, err.statusCode || 500, { ok: false, error: err.message || 'INTERNAL_ERROR', message: err.publicMessage || (err.statusCode ? 'Operazione non disponibile.' : 'Errore interno del server.') });
    });
  });
  server.listen(PORT, '0.0.0.0', () => console.log(`SIGILLUM production PostgreSQL server listening on ${PORT}`));
}

main().catch(err => { console.error(err); process.exit(1); });
