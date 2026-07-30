const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'registry.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS kyc_device_bindings (
    device_key_fingerprint TEXT PRIMARY KEY,
    public_key_json TEXT NOT NULL,
    provider_session_id TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    creator_id TEXT,
    status TEXT NOT NULL DEFAULT 'not_started',
    verified_legal_name TEXT,
    verified_country TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS auth_accounts (
    id TEXT PRIMARY KEY,
    email_normalized TEXT NOT NULL UNIQUE,
    email_display TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    creator_name TEXT NOT NULL,
    creator_id TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_account_devices (
    account_id TEXT NOT NULL,
    device_key_fingerprint TEXT NOT NULL,
    public_key_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (account_id, device_key_fingerprint),
    FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    device_key_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS auth_sessions_account_idx
ON auth_sessions(account_id, revoked_at, expires_at);
`);

const findAccountByEmail = db.prepare(`
SELECT * FROM auth_accounts WHERE email_normalized = ?
`);
const findAccountById = db.prepare(`
SELECT * FROM auth_accounts WHERE id = ?
`);
const insertAccount = db.prepare(`
INSERT INTO auth_accounts (
    id, email_normalized, email_display, password_salt, password_hash,
    creator_name, creator_id, email_verified, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
`);
const updateAccountProfile = db.prepare(`
UPDATE auth_accounts SET creator_name = ?, updated_at = ? WHERE id = ?
`);
const updateAccountPassword = db.prepare(`
UPDATE auth_accounts
SET password_salt = ?, password_hash = ?, updated_at = ?
WHERE id = ?
`);
const deleteAccount = db.prepare(`
DELETE FROM auth_accounts WHERE id = ?
`);
const upsertDevice = db.prepare(`
INSERT INTO auth_account_devices (
    account_id, device_key_fingerprint, public_key_json, created_at, last_seen_at
) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(account_id, device_key_fingerprint) DO UPDATE SET
    public_key_json = excluded.public_key_json,
    last_seen_at = excluded.last_seen_at
`);
const listDevices = db.prepare(`
SELECT device_key_fingerprint, created_at, last_seen_at
FROM auth_account_devices
WHERE account_id = ?
ORDER BY last_seen_at DESC
`);
const countDevices = db.prepare(`
SELECT COUNT(*) AS count FROM auth_account_devices WHERE account_id = ?
`);
const insertSession = db.prepare(`
INSERT INTO auth_sessions (
    token_hash, account_id, device_key_fingerprint,
    created_at, last_seen_at, expires_at, revoked_at
) VALUES (?, ?, ?, ?, ?, ?, NULL)
`);
const findSession = db.prepare(`
SELECT
    s.token_hash, s.account_id, s.device_key_fingerprint,
    s.created_at AS session_created_at,
    s.last_seen_at, s.expires_at, s.revoked_at,
    a.email_display, a.creator_name, a.creator_id,
    a.email_verified, a.created_at AS account_created_at,
    a.updated_at AS account_updated_at
FROM auth_sessions s
JOIN auth_accounts a ON a.id = s.account_id
WHERE s.token_hash = ?
`);
const touchSession = db.prepare(`
UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?
`);
const revokeSession = db.prepare(`
UPDATE auth_sessions SET revoked_at = ?
WHERE token_hash = ? AND revoked_at IS NULL
`);
const revokeAccountSessions = db.prepare(`
UPDATE auth_sessions SET revoked_at = ?
WHERE account_id = ? AND revoked_at IS NULL
`);
const revokeOtherSessions = db.prepare(`
UPDATE auth_sessions SET revoked_at = ?
WHERE account_id = ? AND token_hash <> ? AND revoked_at IS NULL
`);
const getKycBinding = db.prepare(`
SELECT status, verified_legal_name, verified_country
FROM kyc_device_bindings
WHERE device_key_fingerprint = ?
`);
const deleteKycBinding = db.prepare(`
DELETE FROM kyc_device_bindings WHERE device_key_fingerprint = ?
`);

const AUTH_PROOF_PURPOSE = 'SIGILLUM_AUTH_DEVICE_BINDING_V1';
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_KEY_LENGTH = 64;
const MAX_BODY_BYTES = 1_000_000;
const rateWindows = new Map();

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function parseJsonBody(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('INVALID_JSON_OBJECT');
    }
    return parsed;
  } catch (_) {
    throw Object.assign(new Error('INVALID_JSON'), { statusCode: 400 });
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validateEmail(value) {
  const email = normalizeEmail(value);
  if (
    email.length < 5 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw Object.assign(new Error('EMAIL_NON_VALIDA'), { statusCode: 400 });
  }
  return email;
}

function validatePassword(value, field = 'PASSWORD_NON_VALIDA') {
  const password = String(value || '');
  if (password.length < 12 || password.length > 128) {
    throw Object.assign(new Error(field), { statusCode: 400 });
  }
  return password;
}

function validateCreatorName(value) {
  const name = String(value || '').trim();
  if (name.length < 1 || name.length > 160) {
    throw Object.assign(new Error('NOME_NON_VALIDO'), { statusCode: 400 });
  }
  return name;
}

function enforceRateLimit(req, discriminator) {
  const now = Date.now();
  const ip = String(
    req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
  )
    .split(',')[0]
    .trim();
  const key = `${ip}|${String(discriminator || '').slice(0, 254)}`;
  const existing = rateWindows.get(key);
  const windowMs = 15 * 60 * 1000;
  if (!existing || now - existing.startedAt >= windowMs) {
    rateWindows.set(key, { startedAt: now, count: 1 });
    return;
  }
  existing.count += 1;
  if (existing.count > 12) {
    throw Object.assign(new Error('TROPPI_TENTATIVI'), { statusCode: 429 });
  }
  if (rateWindows.size > 5000) {
    for (const [candidate, state] of rateWindows) {
      if (now - state.startedAt >= windowMs) rateWindows.delete(candidate);
    }
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, derivedKey) => {
        if (error) return reject(error);
        resolve({
          salt: salt.toString('base64'),
          hash: derivedKey.toString('base64'),
        });
      },
    );
  });
}

async function passwordMatches(password, account) {
  const salt = Buffer.from(account.password_salt, 'base64');
  const expected = Buffer.from(account.password_hash, 'base64');
  const candidate = await hashPassword(password, salt);
  const actual = Buffer.from(candidate.hash, 'base64');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function verifyAuthDeviceProof(payload) {
  const deviceKeyFingerprint = String(
    payload.deviceKeyFingerprint || '',
  ).trim();
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
    throw Object.assign(new Error('PROVA_DISPOSITIVO_NON_VALIDA'), {
      statusCode: 400,
    });
  }
  if (Math.abs(Date.now() - signedTime) > 5 * 60 * 1000) {
    throw Object.assign(new Error('PROVA_DISPOSITIVO_SCADUTA'), {
      statusCode: 401,
    });
  }

  const normalizedPublicKey = { modulus, exponent };
  const calculatedFingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(normalizedPublicKey), 'utf8')
    .digest('hex');
  if (calculatedFingerprint.toLowerCase() !== deviceKeyFingerprint.toLowerCase()) {
    throw Object.assign(new Error('CHIAVE_DISPOSITIVO_NON_COINCIDE'), {
      statusCode: 401,
    });
  }

  const statement = JSON.stringify({
    purpose: AUTH_PROOF_PURPOSE,
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
    throw Object.assign(new Error('FIRMA_DISPOSITIVO_NON_VALIDA'), {
      statusCode: 401,
    });
  }
  return { deviceKeyFingerprint, normalizedPublicKey };
}

function issueSession(accountId, deviceKeyFingerprint) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DURATION_MS);
  insertSession.run(
    tokenHash,
    accountId,
    deviceKeyFingerprint,
    now.toISOString(),
    now.toISOString(),
    expires.toISOString(),
  );
  return { token, tokenHash, expiresAt: expires.toISOString() };
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

function authenticate(req) {
  const token = bearerToken(req);
  if (!token) {
    throw Object.assign(new Error('SESSIONE_MANCANTE'), { statusCode: 401 });
  }
  const tokenHash = hashToken(token);
  const session = findSession.get(tokenHash);
  if (!session || session.revoked_at) {
    throw Object.assign(new Error('SESSIONE_NON_VALIDA'), { statusCode: 401 });
  }
  if (Date.parse(session.expires_at) <= Date.now()) {
    revokeSession.run(new Date().toISOString(), tokenHash);
    throw Object.assign(new Error('SESSIONE_SCADUTA'), { statusCode: 401 });
  }
  touchSession.run(new Date().toISOString(), tokenHash);
  return { ...session, tokenHash };
}

function accountResponse(account, deviceKeyFingerprint) {
  const kyc = getKycBinding.get(deviceKeyFingerprint);
  const deviceCount = Number(countDevices.get(account.id || account.account_id)?.count || 0);
  return {
    id: account.id || account.account_id,
    email: account.email_display,
    creatorName: account.creator_name,
    creatorId: account.creator_id || '',
    emailVerified: Boolean(account.email_verified),
    accountCreatedAt: account.created_at || account.account_created_at,
    accountUpdatedAt: account.updated_at || account.account_updated_at,
    deviceCount,
    currentDeviceKeyFingerprint: deviceKeyFingerprint,
    kycStatus: kyc?.status || 'not_started',
    legalIdentityVerified: kyc?.status === 'verified',
    verifiedLegalName: kyc?.verified_legal_name || '',
    verifiedCountry: kyc?.verified_country || '',
  };
}

function publicError(error) {
  const code = error.message || String(error);
  const messages = {
    EMAIL_NON_VALIDA: 'Inserisci un indirizzo email valido.',
    PASSWORD_NON_VALIDA: 'La password deve contenere da 12 a 128 caratteri.',
    NUOVA_PASSWORD_NON_VALIDA: 'La nuova password deve contenere da 12 a 128 caratteri.',
    NOME_NON_VALIDO: 'Inserisci un nome valido.',
    ACCOUNT_ESISTENTE: 'Esiste già un account con questa email.',
    CREDENZIALI_NON_VALIDE: 'Email o password non corrette.',
    SESSIONE_MANCANTE: 'Accedi per continuare.',
    SESSIONE_NON_VALIDA: 'La sessione non è valida. Accedi nuovamente.',
    SESSIONE_SCADUTA: 'La sessione è scaduta. Accedi nuovamente.',
    CONFERMA_ELIMINAZIONE_NON_VALIDA: 'Conferma l’eliminazione dell’account.',
    TROPPI_TENTATIVI: 'Troppi tentativi. Riprova più tardi.',
    PROVA_DISPOSITIVO_NON_VALIDA: 'Identità tecnica del dispositivo non valida.',
    PROVA_DISPOSITIVO_SCADUTA: 'Prova del dispositivo scaduta. Riprova.',
    CHIAVE_DISPOSITIVO_NON_COINCIDE: 'La chiave del dispositivo non coincide.',
    FIRMA_DISPOSITIVO_NON_VALIDA: 'Firma del dispositivo non valida.',
    INVALID_JSON: 'Richiesta non valida.',
    PAYLOAD_TOO_LARGE: 'Richiesta troppo grande.',
  };
  return {
    ok: false,
    error: code,
    message: messages[code] || 'Operazione account non disponibile.',
  };
}

async function handleRegister(req, res) {
  const payload = parseJsonBody(await readBody(req));
  const email = validateEmail(payload.email);
  enforceRateLimit(req, `register:${email}`);
  const password = validatePassword(payload.password);
  const creatorName = validateCreatorName(payload.creatorName);
  const proof = verifyAuthDeviceProof(payload);
  if (findAccountByEmail.get(email)) {
    throw Object.assign(new Error('ACCOUNT_ESISTENTE'), { statusCode: 409 });
  }
  const passwordRecord = await hashPassword(password);
  const accountId = crypto.randomUUID();
  const now = new Date().toISOString();
  const creatorId = String(payload.creatorId || '').slice(0, 120);

  try {
    db.transaction(() => {
      insertAccount.run(
        accountId,
        email,
        String(payload.email || '').trim(),
        passwordRecord.salt,
        passwordRecord.hash,
        creatorName,
        creatorId,
        now,
        now,
      );
      upsertDevice.run(
        accountId,
        proof.deviceKeyFingerprint,
        JSON.stringify(proof.normalizedPublicKey),
        now,
        now,
      );
    })();
  } catch (error) {
    if (String(error.code || '').includes('SQLITE_CONSTRAINT')) {
      throw Object.assign(new Error('ACCOUNT_ESISTENTE'), { statusCode: 409 });
    }
    throw error;
  }

  const issued = issueSession(accountId, proof.deviceKeyFingerprint);
  const account = findAccountById.get(accountId);
  return sendJson(res, 201, {
    ok: true,
    token: issued.token,
    expiresAt: issued.expiresAt,
    account: accountResponse(account, proof.deviceKeyFingerprint),
  });
}

async function handleLogin(req, res) {
  const payload = parseJsonBody(await readBody(req));
  const email = validateEmail(payload.email);
  enforceRateLimit(req, `login:${email}`);
  const password = String(payload.password || '');
  const account = findAccountByEmail.get(email);
  if (!account || !(await passwordMatches(password, account))) {
    throw Object.assign(new Error('CREDENZIALI_NON_VALIDE'), {
      statusCode: 401,
    });
  }
  const proof = verifyAuthDeviceProof(payload);
  const now = new Date().toISOString();
  upsertDevice.run(
    account.id,
    proof.deviceKeyFingerprint,
    JSON.stringify(proof.normalizedPublicKey),
    now,
    now,
  );
  const issued = issueSession(account.id, proof.deviceKeyFingerprint);
  return sendJson(res, 200, {
    ok: true,
    token: issued.token,
    expiresAt: issued.expiresAt,
    account: accountResponse(account, proof.deviceKeyFingerprint),
  });
}

async function handleProfile(req, res) {
  const session = authenticate(req);
  const payload = parseJsonBody(await readBody(req));
  const creatorName = validateCreatorName(payload.creatorName);
  const now = new Date().toISOString();
  updateAccountProfile.run(creatorName, now, session.account_id);
  const account = findAccountById.get(session.account_id);
  return sendJson(res, 200, {
    ok: true,
    account: accountResponse(account, session.device_key_fingerprint),
  });
}

async function handlePasswordChange(req, res) {
  const session = authenticate(req);
  const payload = parseJsonBody(await readBody(req));
  const currentPassword = String(payload.currentPassword || '');
  const newPassword = validatePassword(
    payload.newPassword,
    'NUOVA_PASSWORD_NON_VALIDA',
  );
  const account = findAccountById.get(session.account_id);
  if (!account || !(await passwordMatches(currentPassword, account))) {
    throw Object.assign(new Error('CREDENZIALI_NON_VALIDE'), {
      statusCode: 401,
    });
  }
  const passwordRecord = await hashPassword(newPassword);
  const now = new Date().toISOString();
  updateAccountPassword.run(
    passwordRecord.salt,
    passwordRecord.hash,
    now,
    account.id,
  );
  revokeOtherSessions.run(now, account.id, session.tokenHash);
  return sendJson(res, 200, { ok: true, sessionsRevoked: true });
}

async function handleDelete(req, res) {
  const session = authenticate(req);
  const payload = parseJsonBody(await readBody(req));
  if (String(payload.confirmation || '') !== 'DELETE') {
    throw Object.assign(new Error('CONFERMA_ELIMINAZIONE_NON_VALIDA'), {
      statusCode: 400,
    });
  }
  const account = findAccountById.get(session.account_id);
  const password = String(payload.password || '');
  if (!account || !(await passwordMatches(password, account))) {
    throw Object.assign(new Error('CREDENZIALI_NON_VALIDE'), {
      statusCode: 401,
    });
  }
  const devices = listDevices.all(account.id);
  db.transaction(() => {
    for (const device of devices) {
      deleteKycBinding.run(device.device_key_fingerprint);
    }
    deleteAccount.run(account.id);
  })();
  return sendJson(res, 200, {
    ok: true,
    deleted: true,
    retainedCertificateRecords: true,
    message:
      'Account, sessioni, dispositivi e collegamenti KYC eliminati. I certificati HCV già firmati restano immutabili e verificabili.',
  });
}

async function handleAuth(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    return handleRegister(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    return handleLogin(req, res);
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    const session = authenticate(req);
    return sendJson(res, 200, {
      ok: true,
      expiresAt: session.expires_at,
      account: accountResponse(session, session.device_key_fingerprint),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/devices') {
    const session = authenticate(req);
    return sendJson(res, 200, {
      ok: true,
      devices: listDevices.all(session.account_id).map(device => ({
        fingerprint: device.device_key_fingerprint,
        createdAt: device.created_at,
        lastSeenAt: device.last_seen_at,
        current: device.device_key_fingerprint === session.device_key_fingerprint,
      })),
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/profile') {
    return handleProfile(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/password') {
    return handlePasswordChange(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const session = authenticate(req);
    revokeSession.run(new Date().toISOString(), session.tokenHash);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout-all') {
    const session = authenticate(req);
    revokeAccountSessions.run(new Date().toISOString(), session.account_id);
    return sendJson(res, 200, { ok: true });
  }
  if (
    (req.method === 'DELETE' || req.method === 'POST') &&
    url.pathname === '/api/auth/delete'
  ) {
    return handleDelete(req, res);
  }
  return false;
}


module.exports = {
  handleAuth,
};
