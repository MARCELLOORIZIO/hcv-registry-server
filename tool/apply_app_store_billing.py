from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

import_anchor = "const { Pool } = require('pg');\n"
if "require('./app_store_billing')" not in source:
    if import_anchor not in source:
        raise RuntimeError('pg import anchor missing')
    source = source.replace(import_anchor, import_anchor + "const appStoreBilling = require('./app_store_billing');\n", 1)

subscription_schema = """    CREATE TABLE IF NOT EXISTS subscriptions (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'app_store',
      product_id TEXT NOT NULL DEFAULT '',
      original_transaction_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'inactive',
      expires_at TIMESTAMPTZ,
      environment TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
"""
subscription_schema_v2 = subscription_schema + """    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS latest_transaction_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS subscriptions_original_transaction_idx ON subscriptions(original_transaction_id);
"""
if "subscriptions_original_transaction_idx" not in source:
    if subscription_schema not in source:
        raise RuntimeError('subscriptions schema anchor missing')
    source = source.replace(subscription_schema, subscription_schema_v2, 1)

ownership_schema = """    CREATE TABLE IF NOT EXISTS apple_subscription_owners (
      original_transaction_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS apple_subscription_owners_account_idx
      ON apple_subscription_owners(account_id);
"""
if "apple_subscription_owners_account_idx" not in source:
    ownership_anchor = "    CREATE INDEX IF NOT EXISTS subscriptions_original_transaction_idx ON subscriptions(original_transaction_id);\n"
    if ownership_anchor not in source:
        raise RuntimeError('subscription index anchor missing')
    source = source.replace(ownership_anchor, ownership_anchor + ownership_schema, 1)

old_access = "identity?.status === 'verified' && (!SUBSCRIPTIONS_ENFORCED || subscription?.status === 'active')"
new_access = "identity?.status === 'verified' && (!SUBSCRIPTIONS_ENFORCED || ['active', 'grace'].includes(subscription?.status))"
if old_access in source:
    source = source.replace(old_access, new_access, 1)

old_require = "if (SUBSCRIPTIONS_ENFORCED && account.subscriptionStatus !== 'active') throw publicError('ABBONAMENTO_NON_ATTIVO', 402);"
new_require = "if (SUBSCRIPTIONS_ENFORCED && !['active', 'grace'].includes(account.subscriptionStatus)) throw publicError('ABBONAMENTO_NON_ATTIVO', 402);"
source = source.replace(old_require, new_require)

subscription_lookup = "  const subscription = (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1', [accountId])).rows[0];\n"
subscription_lookup_v2 = """  let subscription = (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1', [accountId])).rows[0];
  if (subscription?.original_transaction_id) {
    const owner = await resolveAppleSubscriptionOwner(accountId, subscription.original_transaction_id);
    if (owner && owner !== accountId) {
      await removeForeignAppleSubscription(accountId, subscription.original_transaction_id);
      subscription = null;
    }
  }
"""
if "let subscription = (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1'" not in source:
    if subscription_lookup not in source:
        raise RuntimeError('account subscription lookup anchor missing')
    source = source.replace(subscription_lookup, subscription_lookup_v2, 1)

helper_anchor = "function safeHcvId(value) {"
helpers = r'''async function resolveAppleSubscriptionOwner(accountId, originalTransactionId) {
  const original = String(originalTransactionId || '').trim();
  if (!original) return '';

  const existing = (await pool.query(
    'SELECT account_id FROM apple_subscription_owners WHERE original_transaction_id=$1',
    [original],
  )).rows[0];
  if (existing?.account_id) return existing.account_id;

  const originalHash = hash(original);
  const historical = (await pool.query(`
    SELECT se.account_id
    FROM security_events se
    JOIN accounts a ON a.id=se.account_id
    WHERE se.event_type='APPLE_SUBSCRIPTION_VERIFIED'
      AND se.detail_json->>'originalTransactionIdHash'=$1
    ORDER BY se.created_at ASC, se.id ASC
    LIMIT 1
  `, [originalHash])).rows[0];

  let ownerAccountId = String(historical?.account_id || '').trim();
  if (!ownerAccountId) {
    const candidate = (await pool.query(`
      SELECT s.account_id
      FROM subscriptions s
      JOIN accounts a ON a.id=s.account_id
      WHERE s.original_transaction_id=$1
      ORDER BY a.created_at ASC, s.updated_at ASC, s.account_id ASC
      LIMIT 1
    `, [original])).rows[0];
    ownerAccountId = String(candidate?.account_id || accountId || '').trim();
  }

  if (!ownerAccountId) return '';

  await pool.query(`
    INSERT INTO apple_subscription_owners(original_transaction_id,account_id,claimed_at,updated_at)
    VALUES($1,$2,NOW(),NOW())
    ON CONFLICT(original_transaction_id) DO NOTHING
  `, [original, ownerAccountId]);

  const owner = (await pool.query(
    'SELECT account_id FROM apple_subscription_owners WHERE original_transaction_id=$1',
    [original],
  )).rows[0];
  return String(owner?.account_id || ownerAccountId);
}

async function removeForeignAppleSubscription(accountId, originalTransactionId) {
  const original = String(originalTransactionId || '').trim();
  if (!original) return;
  await pool.query(
    'DELETE FROM subscriptions WHERE account_id=$1 AND original_transaction_id=$2',
    [accountId, original],
  );
  await securityEvent(accountId, 'APPLE_SUBSCRIPTION_OWNERSHIP_REJECTED', {
    originalTransactionIdHash: hash(original),
  });
}

async function assertAppleSubscriptionOwnership(accountId, subscription) {
  const original = String(subscription?.originalTransactionId || '').trim();
  if (!original) {
    throw publicError(
      'APPLE_ORIGINAL_TRANSACTION_ID_REQUIRED',
      422,
      'Impossibile associare in modo sicuro questo abbonamento App Store.',
    );
  }
  const owner = await resolveAppleSubscriptionOwner(accountId, original);
  if (owner && owner !== accountId) {
    await removeForeignAppleSubscription(accountId, original);
    throw publicError(
      'APPLE_SUBSCRIPTION_ALREADY_LINKED',
      409,
      'Questo abbonamento App Store è già associato a un altro account SIGILLUM.',
    );
  }
}

async function saveAppleSubscription(accountId, subscription) {
  await assertAppleSubscriptionOwnership(accountId, subscription);
  await pool.query(`
    INSERT INTO subscriptions(
      account_id,provider,product_id,original_transaction_id,latest_transaction_id,
      status,expires_at,environment,last_verified_at,updated_at
    ) VALUES($1,'app_store',$2,$3,$4,$5,$6,$7,NOW(),NOW())
    ON CONFLICT(account_id) DO UPDATE SET
      provider='app_store',
      product_id=EXCLUDED.product_id,
      original_transaction_id=EXCLUDED.original_transaction_id,
      latest_transaction_id=EXCLUDED.latest_transaction_id,
      status=EXCLUDED.status,
      expires_at=EXCLUDED.expires_at,
      environment=EXCLUDED.environment,
      last_verified_at=NOW(),
      updated_at=NOW()
  `, [
    accountId,
    subscription.productId || '',
    subscription.originalTransactionId || '',
    subscription.transactionId || '',
    subscription.status || 'inactive',
    subscription.expiresAt || null,
    subscription.environment || '',
  ]);
}

async function refreshAppleSubscriptionForAccount(accountId) {
  const row = (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1', [accountId])).rows[0];
  if (!row?.original_transaction_id) return row || null;

  const owner = await resolveAppleSubscriptionOwner(accountId, row.original_transaction_id);
  if (owner && owner !== accountId) {
    await removeForeignAppleSubscription(accountId, row.original_transaction_id);
    return null;
  }

  if (!appStoreBilling.configured()) return row;
  const lastVerified = row.last_verified_at ? new Date(row.last_verified_at).getTime() : 0;
  if (Date.now() - lastVerified < 15 * 60 * 1000) return row;
  try {
    const refreshed = await appStoreBilling.refreshSubscription(row.original_transaction_id, row.product_id);
    await saveAppleSubscription(accountId, refreshed);
    return (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1', [accountId])).rows[0] || null;
  } catch (error) {
    console.error('APPLE_SUBSCRIPTION_REFRESH', error.message || error);
    return row;
  }
}

async function applyAppleNotification(subscription) {
  const original = String(subscription?.originalTransactionId || '').trim();
  if (!original) return 0;
  const owner = await resolveAppleSubscriptionOwner('', original);
  if (!owner) return 0;
  const result = await pool.query(`
    UPDATE subscriptions SET
      product_id=$3,
      latest_transaction_id=$4,
      status=$5,
      expires_at=$6,
      environment=$7,
      last_verified_at=NOW(),
      updated_at=NOW()
    WHERE original_transaction_id=$1 AND account_id=$2
  `, [
    original,
    owner,
    subscription.productId || '',
    subscription.transactionId || '',
    subscription.status || 'inactive',
    subscription.expiresAt || null,
    subscription.environment || '',
  ]);
  return result.rowCount || 0;
}

'''
if 'async function resolveAppleSubscriptionOwner' not in source:
    if helper_anchor not in source:
        raise RuntimeError('billing helper anchor missing')
    source = source.replace(helper_anchor, helpers + helper_anchor, 1)

old_billing = r'''  if (req.method === 'GET' && url.pathname === '/api/billing/status') {
    const session = await authenticate(req);
    const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
    return sendJson(res, 200, { ok: true, enforced: SUBSCRIPTIONS_ENFORCED, status: account.subscriptionStatus, productId: account.subscriptionProductId, expiresAt: account.subscriptionExpiresAt });
  }
'''
new_billing = r'''  if (req.method === 'POST' && url.pathname === '/api/billing/apple/verify') {
    const session = await authenticate(req);
    const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
    if (!account.emailVerified || !account.termsAccepted || !account.privacyAcknowledged || !account.adultConfirmed) {
      throw publicError('TERMINI_NON_ACCETTATI', 403);
    }
    const body = await readJson(req, 2_000_000);
    const verified = await appStoreBilling.verifyPurchase({
      transactionId: body.transactionId,
      receiptData: body.receiptData,
      expectedProductId: String(body.productId || ''),
    });
    // Authenticity and entitlement are separate. Persist and return Apple's
    // verified status even when the transaction is expired or revoked so the
    // client can finish a stale StoreKit transaction and start a new purchase.
    // Creator access remains fail-closed because both client and protected
    // server routes grant entitlement only for active/grace states.
    await saveAppleSubscription(session.account_id, verified);
    await securityEvent(session.account_id, 'APPLE_SUBSCRIPTION_VERIFIED', {
      productId: verified.productId,
      originalTransactionIdHash: hash(verified.originalTransactionId),
      environment: verified.environment,
      status: verified.status,
    });
    return sendJson(res, 200, {
      ok: true,
      verified: true,
      status: verified.status,
      productId: verified.productId,
      expiresAt: verified.expiresAt,
      environment: verified.environment,
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/billing/apple/notifications/v2') {
    const body = await readJson(req, 2_000_000);
    const notification = await appStoreBilling.verifyNotification(body.signedPayload);
    const updated = notification.subscription ? await applyAppleNotification(notification.subscription) : 0;
    return sendJson(res, 200, { ok: true, notificationType: notification.notificationType || '', updated });
  }

  if (req.method === 'GET' && url.pathname === '/api/billing/status') {
    const session = await authenticate(req);
    await refreshAppleSubscriptionForAccount(session.account_id);
    const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
    return sendJson(res, 200, {
      ok: true,
      enforced: SUBSCRIPTIONS_ENFORCED,
      appleConfigured: appStoreBilling.configured(),
      status: account.subscriptionStatus,
      productId: account.subscriptionProductId,
      expiresAt: account.subscriptionExpiresAt,
    });
  }
'''
if "/api/billing/apple/verify" not in source:
    if old_billing not in source:
        raise RuntimeError('billing status route anchor missing')
    source = source.replace(old_billing, new_billing, 1)

required_markers = [
    "require('./app_store_billing')",
    "/api/billing/apple/verify",
    "apple_subscription_owners",
    "APPLE_SUBSCRIPTION_ALREADY_LINKED",
    "resolveAppleSubscriptionOwner",
]
if any(marker not in source for marker in required_markers):
    raise RuntimeError('Apple billing integration incomplete')

path.write_text(source, encoding='utf-8')
print('Apple App Store server verification routes applied')
