from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

anchor = """    const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);\n    return sendJson(res, 200, {\n      ok: true,\n      enforced: SUBSCRIPTIONS_ENFORCED,\n      appleConfigured: appStoreBilling.configured(),\n      status: account.subscriptionStatus,\n      productId: account.subscriptionProductId,\n      expiresAt: account.subscriptionExpiresAt,\n    });\n"""
replacement = """    const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);\n    const diagnosticSubscription = (await pool.query(\n      'SELECT environment,status,expires_at FROM subscriptions WHERE account_id=$1',\n      [session.account_id],\n    )).rows[0] || null;\n    console.log('APPLE_BILLING_DIAGNOSTIC', JSON.stringify({\n      appleConfigured: appStoreBilling.configured(),\n      environment: diagnosticSubscription?.environment || '',\n      status: account.subscriptionStatus,\n      expiresAt: account.subscriptionExpiresAt || null,\n    }));\n    return sendJson(res, 200, {\n      ok: true,\n      enforced: SUBSCRIPTIONS_ENFORCED,\n      appleConfigured: appStoreBilling.configured(),\n      status: account.subscriptionStatus,\n      productId: account.subscriptionProductId,\n      expiresAt: account.subscriptionExpiresAt,\n    });\n"""

if "APPLE_BILLING_DIAGNOSTIC" not in source:
    if anchor not in source:
        raise RuntimeError('billing status diagnostic anchor missing')
    source = source.replace(anchor, replacement, 1)

required = [
    "APPLE_BILLING_DIAGNOSTIC",
    "appleConfigured: appStoreBilling.configured()",
    "environment: diagnosticSubscription?.environment || ''",
    "status: account.subscriptionStatus",
    "expiresAt: account.subscriptionExpiresAt || null",
]
for token in required:
    if token not in source:
        raise RuntimeError(f'billing diagnostic token missing: {token}')

for forbidden in [
    'email_normalized',
    'email_display',
    'original_transaction_id',
    'latest_transaction_id',
    'APPLE_IAP_PRIVATE_KEY',
]:
    diagnostic_block = source[source.index("console.log('APPLE_BILLING_DIAGNOSTIC'"):source.index("return sendJson(res, 200, {", source.index("console.log('APPLE_BILLING_DIAGNOSTIC'"))]
    if forbidden in diagnostic_block:
        raise RuntimeError(f'sensitive field leaked in billing diagnostic: {forbidden}')

path.write_text(source, encoding='utf-8')
print('Safe Apple billing diagnostic logging applied')
