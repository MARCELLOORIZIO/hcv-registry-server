'use strict';

const crypto = require('crypto');

function authError(code, statusCode = 403) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function tokenHash(token) {
  return crypto
    .createHash('sha256')
    .update(String(token || ''), 'utf8')
    .digest('hex');
}

async function initPrimaryReferenceReadAuthSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS verified_originals_reference_read_tokens (
      token_hash TEXT PRIMARY KEY,
      job_id TEXT NOT NULL
        REFERENCES verified_originals_reference_jobs(job_id)
        ON DELETE CASCADE,
      hcv_id TEXT NOT NULL
        REFERENCES certificates(hcv_id)
        ON DELETE CASCADE,
      account_id TEXT NOT NULL
        REFERENCES accounts(id)
        ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS verified_originals_reference_read_expiry_idx
      ON verified_originals_reference_read_tokens(expires_at);

    CREATE INDEX IF NOT EXISTS verified_originals_reference_read_account_idx
      ON verified_originals_reference_read_tokens(
        account_id,hcv_id,created_at DESC
      );
  `);
}

async function purgeExpiredReadTokens(pool) {
  const result = await pool.query(`
    DELETE FROM verified_originals_reference_read_tokens
    WHERE expires_at < NOW() - INTERVAL '5 minutes'
       OR consumed_at < NOW() - INTERVAL '5 minutes'
  `);
  return Number(result.rowCount || 0);
}

async function issueReadAuthorization(pool, {
  jobId,
  hcvId,
  accountId,
  ttlSeconds = 60,
  randomBytes = crypto.randomBytes,
}) {
  const ttl = Math.max(15, Math.min(300, Number(ttlSeconds) || 60));
  if (!jobId || !hcvId || !accountId) {
    throw authError('REFERENCE_READ_AUTH_INPUT_INVALID', 400);
  }

  await purgeExpiredReadTokens(pool).catch(() => {});

  const job = (await pool.query(`
    SELECT job_id,hcv_id,state,provider
    FROM verified_originals_reference_jobs
    WHERE job_id=$1 AND hcv_id=$2
  `, [jobId, hcvId])).rows[0];
  if (!job ||
      job.state !== 'COMMITTED' ||
      job.provider !== 'r2') {
    throw authError('REFERENCE_NOT_AVAILABLE', 404);
  }

  const token = randomBytes(32).toString('base64url');
  const hash = tokenHash(token);
  const row = (await pool.query(`
    INSERT INTO verified_originals_reference_read_tokens(
      token_hash,job_id,hcv_id,account_id,expires_at
    ) VALUES(
      $1,$2,$3,$4,NOW()+($5::double precision * INTERVAL '1 second')
    )
    RETURNING expires_at
  `, [hash, jobId, hcvId, accountId, ttl])).rows[0];

  return {
    token,
    expiresAt: row.expires_at,
    expiresInSeconds: ttl,
  };
}

async function consumeReadAuthorization(pool, {
  token,
  accountId,
}) {
  if (!token ||
      token.length < 32 ||
      token.length > 256 ||
      !accountId) {
    throw authError('REFERENCE_READ_AUTH_INVALID', 403);
  }
  const hash = tokenHash(token);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`
      SELECT t.*,j.state,j.provider,j.receipt_json
      FROM verified_originals_reference_read_tokens t
      JOIN verified_originals_reference_jobs j
        ON j.job_id=t.job_id
      WHERE t.token_hash=$1
      FOR UPDATE OF t
    `, [hash])).rows[0];

    if (!row ||
        row.account_id !== accountId ||
        row.consumed_at ||
        row.state !== 'COMMITTED' ||
        row.provider !== 'r2' ||
        new Date(row.expires_at).getTime() <= Date.now()) {
      throw authError('REFERENCE_READ_AUTH_INVALID', 403);
    }

    await client.query(`
      UPDATE verified_originals_reference_read_tokens
      SET consumed_at=NOW()
      WHERE token_hash=$1 AND consumed_at IS NULL
    `, [hash]);
    await client.query('COMMIT');

    return {
      jobId: row.job_id,
      hcvId: row.hcv_id,
      receipt: row.receipt_json,
      expiresAt: row.expires_at,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  authError,
  consumeReadAuthorization,
  initPrimaryReferenceReadAuthSchema,
  issueReadAuthorization,
  purgeExpiredReadTokens,
  tokenHash,
};
