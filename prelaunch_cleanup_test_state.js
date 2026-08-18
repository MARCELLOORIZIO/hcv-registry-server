const { Pool } = require('pg');

const email = String(process.env.TEST_EMAIL || '').trim().toLowerCase();
const databaseUrl = String(process.env.DATABASE_URL || '');
const confirm = String(process.env.CONFIRM_PRELAUNCH_CLEANUP || '');

if (!email || !databaseUrl) {
  console.error('TEST_EMAIL_AND_DATABASE_URL_REQUIRED');
  process.exit(2);
}
if (confirm !== 'YES') {
  console.error('CONFIRM_PRELAUNCH_CLEANUP=YES_REQUIRED');
  process.exit(3);
}
if (String(process.env.PRODUCTION_LIVE || '').toLowerCase() === 'true') {
  console.error('REFUSING_TO_CLEAN_WHILE_PRODUCTION_LIVE');
  process.exit(4);
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
    console.error('PRELAUNCH_CLEANUP: ACCOUNT_NOT_FOUND');
    process.exit(1);
  }

  const sub = (await pool.query(
    'SELECT environment,status FROM subscriptions WHERE account_id=$1',
    [account.id],
  )).rows[0];

  if (sub && sub.environment !== 'PrelaunchTest') {
    console.error('PRELAUNCH_CLEANUP: REFUSING_NON_TEST_SUBSCRIPTION');
    process.exit(5);
  }

  await pool.query('BEGIN');
  try {
    await pool.query("DELETE FROM subscriptions WHERE account_id=$1 AND environment='PrelaunchTest'", [account.id]);
    await pool.query("DELETE FROM identities WHERE account_id=$1 AND provider='stripe_identity'", [account.id]);
    await pool.query(
      `INSERT INTO security_events(account_id,event_type,detail_json)
       VALUES($1,'PRELAUNCH_TEST_STATE_CLEANED',$2::jsonb)`,
      [account.id, JSON.stringify({ cleanedAt: new Date().toISOString() })],
    );
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }

  console.log('PRELAUNCH_CLEANUP: OK');
  console.log(JSON.stringify({
    email: account.email_display,
    subscription: 'removed_if_PrelaunchTest',
    stripeIdentityTestState: 'removed',
    accountPreserved: true,
  }));
}

main()
  .catch(error => {
    console.error('PRELAUNCH_CLEANUP: ERROR');
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
