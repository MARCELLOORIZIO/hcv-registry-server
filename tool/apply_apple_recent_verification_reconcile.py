from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

anchor = r'''    if (!appStoreBilling.configured()) {
      throw publicError(
        'APPLE_BILLING_NOT_CONFIGURED',
        503,
        'Verifica App Store temporaneamente non disponibile.',
      );
    }
'''

replacement = r'''    const recentVerifiedMs = row.last_verified_at
      ? new Date(row.last_verified_at).getTime()
      : 0;
    const recentAppleVerification = Boolean(
      recentVerifiedMs &&
      Number.isFinite(recentVerifiedMs) &&
      Date.now() >= recentVerifiedMs &&
      Date.now() - recentVerifiedMs < 15 * 60 * 1000
    );
    if (recentAppleVerification && ['active', 'grace'].includes(row.status)) {
      await securityEvent(session.account_id, 'APPLE_SUBSCRIPTION_RECONCILED', {
        productId: row.product_id || '',
        originalTransactionIdHash: hash(row.original_transaction_id || ''),
        environment: row.environment || '',
        status: row.status,
        source: 'recent_apple_verification',
      });
      return sendJson(res, 200, {
        ok: true,
        verified: true,
        status: row.status,
        productId: row.product_id || '',
        expiresAt: row.expires_at || null,
        environment: row.environment || '',
        source: 'recent_apple_verification',
      });
    }

    if (!appStoreBilling.configured()) {
      throw publicError(
        'APPLE_BILLING_NOT_CONFIGURED',
        503,
        'Verifica App Store temporaneamente non disponibile.',
      );
    }
'''

if "source: 'recent_apple_verification'" not in source:
    if anchor not in source:
        raise RuntimeError('Apple reconcile configured anchor missing')
    source = source.replace(anchor, replacement, 1)

for required in [
    "Date.now() - recentVerifiedMs < 15 * 60 * 1000",
    "['active', 'grace'].includes(row.status)",
    "source: 'recent_apple_verification'",
    "verified: true",
]:
    if required not in source:
        raise RuntimeError(f'recent Apple verification reconcile patch incomplete: {required}')

path.write_text(source, encoding='utf-8')
print('Apple recent verification reconcile contract applied')
