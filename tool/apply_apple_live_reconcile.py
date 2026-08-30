from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

marker = "  if (req.method === 'GET' && url.pathname === '/api/billing/status') {\n"
route = r'''  if (req.method === 'POST' && url.pathname === '/api/billing/apple/reconcile') {
    const session = await authenticate(req);
    const row = (await pool.query(
      'SELECT * FROM subscriptions WHERE account_id=$1',
      [session.account_id],
    )).rows[0];

    if (!row?.original_transaction_id) {
      return sendJson(res, 200, {
        ok: true,
        verified: false,
        status: 'inactive',
        reason: 'NO_SUBSCRIPTION',
      });
    }

    const owner = await resolveAppleSubscriptionOwner(
      session.account_id,
      row.original_transaction_id,
    );
    if (!owner || owner !== session.account_id) {
      if (owner && owner !== session.account_id) {
        await removeForeignAppleSubscription(
          session.account_id,
          row.original_transaction_id,
        );
      }
      throw publicError(
        'APPLE_SUBSCRIPTION_ALREADY_LINKED',
        409,
        'Questo abbonamento App Store è già associato a un altro account SIGILLUM.',
      );
    }

    if (!appStoreBilling.configured()) {
      throw publicError(
        'APPLE_BILLING_NOT_CONFIGURED',
        503,
        'Verifica App Store temporaneamente non disponibile.',
      );
    }

    let refreshed;
    try {
      refreshed = await appStoreBilling.refreshSubscription(
        row.original_transaction_id,
        row.product_id,
      );
    } catch (error) {
      console.error('APPLE_SUBSCRIPTION_LIVE_RECONCILE', error.message || error);
      throw publicError(
        'APPLE_SUBSCRIPTION_RECONCILE_FAILED',
        503,
        'Impossibile verificare in tempo reale lo stato dell’abbonamento App Store.',
      );
    }

    await saveAppleSubscription(session.account_id, refreshed);
    await securityEvent(session.account_id, 'APPLE_SUBSCRIPTION_RECONCILED', {
      productId: refreshed.productId || '',
      originalTransactionIdHash: hash(refreshed.originalTransactionId || ''),
      environment: refreshed.environment || '',
      status: refreshed.status || 'inactive',
    });

    return sendJson(res, 200, {
      ok: true,
      verified: true,
      status: refreshed.status || 'inactive',
      productId: refreshed.productId || '',
      expiresAt: refreshed.expiresAt || null,
      environment: refreshed.environment || '',
      source: 'apple_server_live_reconcile',
    });
  }

'''

if "/api/billing/apple/reconcile" not in source:
    if marker not in source:
        raise RuntimeError('billing status route anchor missing')
    source = source.replace(marker, route + marker, 1)

for required in [
    "/api/billing/apple/reconcile",
    "APPLE_SUBSCRIPTION_RECONCILED",
    "APPLE_SUBSCRIPTION_RECONCILE_FAILED",
    "appStoreBilling.refreshSubscription(",
    "source: 'apple_server_live_reconcile'",
]:
    if required not in source:
        raise RuntimeError(f'live reconcile patch incomplete: {required}')

path.write_text(source, encoding='utf-8')
print('Apple live subscription reconcile route applied')
