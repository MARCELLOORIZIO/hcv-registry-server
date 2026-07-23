'use strict';

const { Pool } = require('pg');
const { assertAccountMatchesDevice } = require('./identity_policy');

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL_MISSING');
  const useSsl = process.env.PGSSLMODE !== 'disable';
  return new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

const pool = createPool();

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      creator_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS devices (
      device_key_fingerprint TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
      public_key_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS devices_account_idx ON devices(account_id);
    CREATE TABLE IF NOT EXISTS kyc_sessions (
      session_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'stripe_identity',
      status TEXT NOT NULL DEFAULT 'requires_input',
      url TEXT NOT NULL DEFAULT '',
      verified_outputs JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_error JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS kyc_sessions_account_idx ON kyc_sessions(account_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS certificates (
      hcv_id TEXT PRIMARY KEY,
      certificate_sha256 TEXT NOT NULL UNIQUE,
      certificate_raw JSONB NOT NULL,
      signer_fingerprint TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      event_id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      subject_id TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS audit_events_subject_idx ON audit_events(subject_id, created_at DESC);
  `);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function upsertAccountAndDevice({ accountId, creatorName, deviceKeyFingerprint, publicKey }) {
  const boundAccountId = assertAccountMatchesDevice(accountId, deviceKeyFingerprint);
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO accounts (account_id, creator_name) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET
         creator_name = CASE WHEN EXCLUDED.creator_name <> '' THEN EXCLUDED.creator_name ELSE accounts.creator_name END,
         updated_at = NOW()`,
      [boundAccountId, creatorName || ''],
    );
    const existing = await client.query(
      'SELECT account_id, public_key_json FROM devices WHERE device_key_fingerprint = $1',
      [deviceKeyFingerprint],
    );
    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      if (row.account_id !== boundAccountId) {
        const error = new Error('DEVICE_ALREADY_BOUND_TO_ANOTHER_ACCOUNT');
        error.statusCode = 409;
        throw error;
      }
      if (JSON.stringify(row.public_key_json) !== JSON.stringify(publicKey)) {
        const error = new Error('DEVICE_PUBLIC_KEY_MISMATCH');
        error.statusCode = 409;
        throw error;
      }
    }
    await client.query(
      `INSERT INTO devices (device_key_fingerprint, account_id, public_key_json)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (device_key_fingerprint) DO UPDATE SET last_seen_at = NOW()`,
      [deviceKeyFingerprint, boundAccountId, JSON.stringify(publicKey)],
    );
    return { accountId: boundAccountId, deviceKeyFingerprint };
  });
}

async function upsertKycSession({ sessionId, accountId, provider = 'stripe_identity', status, url = '', verifiedOutputs = {}, lastError = null }) {
  await pool.query(
    `INSERT INTO kyc_sessions (session_id, account_id, provider, status, url, verified_outputs, last_error)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     ON CONFLICT (session_id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       provider = EXCLUDED.provider,
       status = EXCLUDED.status,
       url = EXCLUDED.url,
       verified_outputs = EXCLUDED.verified_outputs,
       last_error = EXCLUDED.last_error,
       updated_at = NOW()`,
    [sessionId, accountId, provider, status || 'unknown', url || '', JSON.stringify(verifiedOutputs || {}), JSON.stringify(lastError)],
  );
}

async function bindKycSession({ sessionId, accountId }) {
  const result = await pool.query(
    'UPDATE kyc_sessions SET account_id = $2, updated_at = NOW() WHERE session_id = $1 RETURNING session_id',
    [sessionId, accountId],
  );
  return result.rowCount > 0;
}

async function getLatestKycByDevice(deviceKeyFingerprint) {
  const result = await pool.query(
    `SELECT ks.session_id, ks.account_id, ks.provider, ks.status, ks.url, ks.verified_outputs, ks.last_error, ks.updated_at
     FROM devices d JOIN kyc_sessions ks ON ks.account_id = d.account_id
     WHERE d.device_key_fingerprint = $1 ORDER BY ks.updated_at DESC LIMIT 1`,
    [deviceKeyFingerprint],
  );
  return result.rows[0] || null;
}

async function getLatestKycByAccount(accountId) {
  const result = await pool.query(
    `SELECT session_id, account_id, provider, status, url, verified_outputs, last_error, updated_at
     FROM kyc_sessions WHERE account_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [accountId],
  );
  return result.rows[0] || null;
}

async function storeCertificateImmutable({ hcvId, certificateSha256, certificate, signerFingerprint, contentHash }) {
  return withTransaction(async (client) => {
    const existing = await client.query('SELECT certificate_sha256 FROM certificates WHERE hcv_id = $1', [hcvId]);
    if (existing.rowCount > 0) {
      if (existing.rows[0].certificate_sha256 === certificateSha256) return { created: false, idempotent: true };
      const error = new Error('HCV_ID_ALREADY_EXISTS_WITH_DIFFERENT_CERTIFICATE');
      error.statusCode = 409;
      throw error;
    }
    await client.query(
      `INSERT INTO certificates (hcv_id, certificate_sha256, certificate_raw, signer_fingerprint, content_hash)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [hcvId, certificateSha256, JSON.stringify(certificate), signerFingerprint, contentHash],
    );
    return { created: true, idempotent: false };
  });
}

async function getCertificate(hcvId) {
  const result = await pool.query(
    `SELECT hcv_id, certificate_sha256, certificate_raw, signer_fingerprint, content_hash, created_at
     FROM certificates WHERE hcv_id = $1`,
    [hcvId],
  );
  return result.rows[0] || null;
}

async function writeAudit(eventType, subjectId, payload = {}) {
  await pool.query(
    'INSERT INTO audit_events (event_type, subject_id, payload) VALUES ($1, $2, $3::jsonb)',
    [eventType, subjectId || '', JSON.stringify(payload || {})],
  );
}

async function healthCheck() {
  const result = await pool.query('SELECT NOW() AS now');
  return result.rows[0];
}

module.exports = {
  pool,
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
};
