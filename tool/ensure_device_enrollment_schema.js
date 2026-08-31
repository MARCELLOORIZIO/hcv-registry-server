const { Pool } = require('pg');

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL_REQUIRED_FOR_DEVICE_ENROLLMENT_SCHEMA');
  }

  const sslRequired = process.env.PG_SSL_REQUIRED === 'true';
  const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false';
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('localhost')
      ? false
      : sslRequired
        ? { rejectUnauthorized }
        : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT to_regclass('public.account_devices') AS account_devices,
              to_regclass('public.accounts') AS accounts`,
    );

    if (!existing.rows[0]?.account_devices || !existing.rows[0]?.accounts) {
      console.log('[schema] Base account tables not present yet; initSchema will create them on first start.');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      'ALTER TABLE account_devices ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ',
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_enrollment_challenges (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        device_key_fingerprint TEXT NOT NULL,
        public_key_json JSONB NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(account_id, device_key_fingerprint)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS device_enrollment_challenges_expiry_idx
      ON device_enrollment_challenges(expires_at)
    `);

    const verified = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='account_devices'
          AND column_name='revoked_at'
      ) AS revoked_at_ready,
      to_regclass('public.device_enrollment_challenges') IS NOT NULL AS challenges_ready
    `);

    if (!verified.rows[0]?.revoked_at_ready || !verified.rows[0]?.challenges_ready) {
      throw new Error('DEVICE_ENROLLMENT_SCHEMA_VERIFICATION_FAILED');
    }

    await client.query('COMMIT');
    console.log('[schema] Device enrollment schema verified before server start.');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[schema] Device enrollment schema migration failed:', error);
  process.exit(1);
});
