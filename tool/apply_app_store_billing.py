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

old_access = "identity?.status === 'verified' && (!SUBSCRIPTIONS_ENFORCED || subscription?.status === 'active')"
new_access = "identity?.status === 'verified' && (!SUBSCRIPTIONS_ENFORCED || ['active', 'grace'].includes(subscription?.status))"
if old_access in source:
    source = source.replace(old_access, new_access, 1)

old_require = "if (SUBSCRIPTIONS_ENFORCED && account.subscriptionStatus !== 'active') throw publicError('ABBONAMENTO_NON_ATTIVO', 402);"
new_require = "if (SUBSCRIPTIONS_ENFORCED && !['active', 'grace'].includes(account.subscriptionStatus)) throw publicError('ABBONAMENTO_NON_ATTIVO', 402);"
source = source.replace(old_require, new_require)

helper_anchor = "function safeHcvId(value) {"
helpers = r'''async function saveAppleSubscription(accountId, subscription) {
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
  let row = (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1', [accountId])).rows[0];
  if (!row?.original_transaction_id || !appStoreBilling.configured()) {
    if (SUBSCRIPTIONS_ENFORCED && ['active', 'grace'].includes(row?.status)) {
      await pool.query(
        "UPDATE subscriptions SET status='inactive',last_verified_at=NULL,updated_at=NOW() WHERE account_id=$1",
        [accountId],
      );
      row = (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1', [accountId])).rows[0] || null;
    }
    return row || null;
  }
  const lastVerified = row.last_verified_at ? new Date(row.last_verified_at).getTime() : 0;
  const sandbox = String(row.environment || '').toLowerCase() === 'sandbox';
  const maxAgeMs = sandbox ? 0 : 15 * 60 * 1000;
  if (maxAgeMs > 0 && Date.now() - lastVerified < maxAgeMs) return row;
  try {
    const refreshed = await appStoreBilling.refreshSubscription(row.original_transaction_id, row.product_id);
    await saveAppleSubscription(accountId, refreshed);
    return (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1', [accountId])).rows[0] || null;
  } catch (error) {
    console.error('APPLE_SUBSCRIPTION_REFRESH', error.message || error);
    const expiresMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    const expiredStoredActive = row.status === 'active' &&
      (!Number.isFinite(expiresMs) || !expiresMs || expiresMs <= Date.now());
    const sandboxEntitlementUnconfirmed = sandbox &&
      ['active', 'grace'].includes(row.status);
    if (expiredStoredActive || sandboxEntitlementUnconfirmed) {
      const fallbackStatus = expiredStoredActive ? 'expired' : 'inactive';
      await pool.query(
        'UPDATE subscriptions SET status=$2,last_verified_at=NULL,updated_at=NOW() WHERE account_id=$1',
        [accountId, fallbackStatus],
      );
      return (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1', [accountId])).rows[0] || null;
    }
    return row;
  }
}

async function applyAppleNotification(subscription) {
  if (!subscription?.originalTransactionId) return 0;
  const result = await pool.query(`
    UPDATE subscriptions SET
      product_id=$2,
      latest_transaction_id=$3,
      status=$4,
      expires_at=$5,
      environment=$6,
      last_verified_at=NOW(),
      updated_at=NOW()
    WHERE original_transaction_id=$1
  `, [
    subscription.originalTransactionId,
    subscription.productId || '',
    subscription.transactionId || '',
    subscription.status || 'inactive',
    subscription.expiresAt || null,
    subscription.environment || '',
  ]);
  return result.rowCount || 0;
}

'''
if 'async function saveAppleSubscription' not in source:
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
    const transaction = await appStoreBilling.verifyPurchase({
      transactionId: body.transactionId,
      receiptData: body.receiptData,
      expectedProductId: String(body.productId || ''),
    });

    // Transaction authenticity and current entitlement are separate. A valid
    // historical transaction proves the Apple purchase, but only Apple's
    // current auto-renewable subscription status can grant Creator access.
    let current = transaction;
    let entitlementConfirmed = false;
    try {
      current = await appStoreBilling.refreshSubscription(
        transaction.originalTransactionId || transaction.transactionId,
        transaction.productId,
      );
      entitlementConfirmed = true;
    } catch (error) {
      // Fail closed for entitlement while still allowing the client to finish
      // an authentic StoreKit delivery. A subsequent billing/status request
      // retries Apple immediately because last_verified_at is cleared below.
      console.error('APPLE_ENTITLEMENT_REFRESH', error.message || error);
      current = { ...transaction, status: 'inactive' };
    }

    await saveAppleSubscription(session.account_id, current);
    if (!entitlementConfirmed) {
      await pool.query('UPDATE subscriptions SET last_verified_at=NULL WHERE account_id=$1', [session.account_id]);
    }
    await securityEvent(session.account_id, 'APPLE_SUBSCRIPTION_VERIFIED', {
      productId: current.productId,
      originalTransactionIdHash: hash(current.originalTransactionId),
      environment: current.environment,
      transactionStatus: transaction.status,
      currentStatus: current.status,
      entitlementConfirmed,
    });
    return sendJson(res, 200, {
      ok: true,
      verified: true,
      status: current.status,
      productId: current.productId,
      expiresAt: current.expiresAt,
      environment: current.environment,
      entitlementConfirmed,
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

if "require('./app_store_billing')" not in source or "/api/billing/apple/verify" not in source:
    raise RuntimeError('Apple billing integration incomplete')

path.write_text(source, encoding='utf-8')
print('Apple App Store server verification routes applied')
