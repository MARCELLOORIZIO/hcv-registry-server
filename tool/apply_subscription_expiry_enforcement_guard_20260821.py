from pathlib import Path
import re

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

helper = r'''function effectiveSubscriptionStatus(subscription) {
  const rawStatus = String(subscription?.status || (SUBSCRIPTIONS_ENFORCED ? 'inactive' : 'development_allowed'));
  if (rawStatus === 'grace') return 'grace';
  if (rawStatus !== 'active') return rawStatus;

  const expiresMs = subscription?.expires_at
    ? new Date(subscription.expires_at).getTime()
    : 0;
  if (!Number.isFinite(expiresMs) || !expiresMs || expiresMs <= Date.now()) {
    return 'expired';
  }
  return 'active';
}

'''
anchor = 'async function accountEnvelope(accountId, currentFingerprint = \'\') {'
if 'function effectiveSubscriptionStatus(subscription)' not in source:
    if anchor not in source:
        raise RuntimeError('accountEnvelope anchor missing')
    source = source.replace(anchor, helper + anchor, 1)

subscription_query = "  const subscription = (await pool.query('SELECT * FROM subscriptions WHERE account_id=$1', [accountId])).rows[0];\n"
status_line = '  const effectiveSubscriptionStatusValue = effectiveSubscriptionStatus(subscription);\n'
if status_line not in source:
    if subscription_query not in source:
        raise RuntimeError('subscription query anchor missing')
    source = source.replace(subscription_query, subscription_query + status_line, 1)

source, status_count = re.subn(
    r"subscriptionStatus:\s*subscription\?\.status\s*\|\|\s*\(SUBSCRIPTIONS_ENFORCED \? 'inactive' : 'development_allowed'\),",
    'subscriptionStatus: effectiveSubscriptionStatusValue,',
    source,
    count=1,
)
if status_count != 1 and 'subscriptionStatus: effectiveSubscriptionStatusValue,' not in source:
    raise RuntimeError('subscriptionStatus envelope anchor missing')

creator_patterns = [
    r"\(!SUBSCRIPTIONS_ENFORCED \|\| subscription\?\.status === 'active'\)",
    r"\(!SUBSCRIPTIONS_ENFORCED \|\| \['active', 'grace'\]\.includes\(subscription\?\.status\)\)",
]
creator_replacement = "(!SUBSCRIPTIONS_ENFORCED || ['active', 'grace'].includes(effectiveSubscriptionStatusValue))"
if creator_replacement not in source:
    replaced = 0
    for pattern in creator_patterns:
        source, count = re.subn(pattern, creator_replacement, source, count=1)
        replaced += count
        if count:
            break
    if replaced != 1:
        raise RuntimeError('creatorAccess subscription anchor missing')

required = [
    'function effectiveSubscriptionStatus(subscription)',
    'expiresMs <= Date.now()',
    'subscriptionStatus: effectiveSubscriptionStatusValue,',
    "['active', 'grace'].includes(effectiveSubscriptionStatusValue)",
]
for token in required:
    if token not in source:
        raise RuntimeError(f'subscription expiry guard token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Expired active subscriptions are denied at the account-envelope boundary')
