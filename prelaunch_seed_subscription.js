const { Pool } = require('pg');

const email = String(process.env.TEST_EMAIL || '').trim().toLowerCase();
const databaseUrl = String(process.env.DATABASE_URL || '');

if (!email || !databaseUrl) {
  console.error('TEST_EMAIL_AND_DATABASE_URL_REQUIRED');
  process.exit(2);
}

if (String(process.env.PRODUCTION_LIVE || '').toLowerCase() === 'true') {
  console.error('REFUSING_TO_SEED_WHILE_PRODUCTION_LIVE');
  process.exit(3);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PG_SSL_REQUIRED === 'true'
    ? { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  max: 1,
});

async function main() {
  const account = (await pool.query(
    'SELECT id,email_display FROM accounts WHERE email_normalized=$1',
    [email],
  )).rows[0];

  if (!account) {
    console.error('PRELAUNCH_SUBSCRIPTION_TEST: ACCOUNT_NOT_FOUND');
    process.exit(1);
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tx = `PRELAUNCH-KYC-${Date.now()}`;

  await pool.query(`
    INSERT INTO subscriptions(
      account_id,provider,product_id,original_transaction_id,status,expires_at,environment,updated_at
    ) VALUES($1,'app_store',$2,$3,'active',$4,'PrelaunchTest',NOW())
    ON CONFLICT(account_id) DO UPDATE SET
      provider='app_store',
      product_id=EXCLUDED.product_id,
      original_transaction_id=EXCLUDED.original_transaction_id,
      status='active',
      expires_at=EXCLUDED.expires_at,
      environment='PrelaunchTest',
      updated_at=NOW()
  `, [
    account.id,
    'com.sigillum.hcv.creator.monthly',
    tx,
    expiresAt.toISOString(),
  ]);

  await pool.query(
    `INSERT INTO security_events(account_id,event_type,detail_json)
     VALUES($1,'PRELAUNCH_TEST_SUBSCRIPTION_SEEDED',$2::jsonb)`,
    [account.id, JSON.stringify({ environment: 'PrelaunchTest', expiresAt: expiresAt.toISOString() })],
  );

  console.log('PRELAUNCH_SUBSCRIPTION_TEST: ACTIVE');
  console.log(JSON.stringify({
    email: account.email_display,
    status: 'active',
    productId: 'com.sigillum.hcv.creator.monthly',
    environment: 'PrelaunchTest',
    expiresAt: expiresAt.toISOString(),
  }));
}

main()
  .catch(error => {
    console.error('PRELAUNCH_SUBSCRIPTION_TEST: ERROR');
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
