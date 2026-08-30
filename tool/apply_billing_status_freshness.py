from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

old = r'''  if (req.method === 'GET' && url.pathname === '/api/billing/status') {
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

new = r'''  if (req.method === 'GET' && url.pathname === '/api/billing/status') {
    const session = await authenticate(req);
    const subscription = await refreshAppleSubscriptionForAccount(session.account_id);
    const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
    const lastVerifiedAt = subscription?.last_verified_at
      ? new Date(subscription.last_verified_at).toISOString()
      : null;
    const lastVerifiedMs = lastVerifiedAt ? Date.parse(lastVerifiedAt) : 0;
    const verificationFresh = Boolean(
      lastVerifiedMs &&
      Number.isFinite(lastVerifiedMs) &&
      Date.now() >= lastVerifiedMs &&
      Date.now() - lastVerifiedMs < 15 * 60 * 1000
    );
    return sendJson(res, 200, {
      ok: true,
      enforced: SUBSCRIPTIONS_ENFORCED,
      appleConfigured: appStoreBilling.configured(),
      status: account.subscriptionStatus,
      productId: account.subscriptionProductId,
      expiresAt: account.subscriptionExpiresAt,
      lastVerifiedAt,
      verificationFresh,
      verificationSource: verificationFresh ? 'apple_server_fresh' : 'apple_server_stale',
    });
  }
'''

if "verificationSource: verificationFresh ? 'apple_server_fresh'" not in source:
    if old not in source:
        raise RuntimeError('billing status route anchor missing')
    source = source.replace(old, new, 1)

for required in [
    'const subscription = await refreshAppleSubscriptionForAccount(session.account_id);',
    'lastVerifiedAt,',
    'verificationFresh,',
    "verificationSource: verificationFresh ? 'apple_server_fresh' : 'apple_server_stale'",
]:
    if required not in source:
        raise RuntimeError(f'billing freshness patch incomplete: {required}')

path.write_text(source, encoding='utf-8')
print('Apple billing status freshness contract applied')
