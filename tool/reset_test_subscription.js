const { Pool } = require('pg');
const crypto = require('crypto');

const email = String(process.argv[2] || '').trim().toLowerCase();
const confirmation = String(process.argv[3] || '');
const databaseUrl = process.env.DATABASE_URL || '';

if (!databaseUrl) {
  console.error('DATABASE_URL_REQUIRED');
  process.exit(2);
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('USAGE: node tool/reset_test_subscription.js <email> RESET_SUBSCRIPTION');
  process.exit(2);
}
if (confirmation !== 'RESET_SUBSCRIPTION') {
  console.error('CONFIRMATION_REQUIRED: RESET_SUBSCRIPTION');
  process.exit(2);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 10000,
});

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 12);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const accountResult = await client.query(
      'SELECT id FROM accounts WHERE email_normalized=$1',
      [email],
    );
    if (accountResult.rowCount !== 1) {
      throw new Error(accountResult.rowCount === 0 ? 'ACCOUNT_NOT_FOUND' : 'ACCOUNT_NOT_UNIQUE');
    }

    const accountId = accountResult.rows[0].id;
    const before = await client.query(
      'SELECT product_id,status,expires_at,environment FROM subscriptions WHERE account_id=$1',
      [accountId],
    );

    const deleted = await client.query(
      'DELETE FROM subscriptions WHERE account_id=$1',
      [accountId],
    );

    await client.query(
      `INSERT INTO security_events(account_id,event_type,detail_json)
       VALUES($1,'TEST_SUBSCRIPTION_RESET',$2::jsonb)`,
      [
        accountId,
        JSON.stringify({
          previousSubscriptionPresent: before.rowCount === 1,
          previousProductId: before.rows[0]?.product_id || '',
          previousStatus: before.rows[0]?.status || '',
          previousEnvironment: before.rows[0]?.environment || '',
        }),
      ],
    );

    await client.query('COMMIT');
    console.log('TEST_SUBSCRIPTION_RESET_OK', JSON.stringify({
      accountHash: shortHash(accountId),
      deletedRows: deleted.rowCount,
      accountPreserved: true,
      identityPreserved: true,
      certificatesPreserved: true,
    }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('TEST_SUBSCRIPTION_RESET_FAILED', error.message || error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
