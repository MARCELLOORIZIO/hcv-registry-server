from pathlib import Path

PATH = Path('production_server.js')
source = PATH.read_text(encoding='utf-8')

# Scope the enrollment throttle to the account as well as the IP used by
# enforceRate(), avoiding cross-account lockouts on shared networks.
old_rate = "enforceRate(req, 'new-device-enrollment', 4, 15 * 60 * 1000);"
new_rate = "enforceRate(req, `new-device-enrollment:${account.id}`, 4, 15 * 60 * 1000);"
if old_rate in source:
    source = source.replace(old_rate, new_rate, 1)
elif new_rate not in source:
    raise RuntimeError('new-device enrollment rate-limit anchor missing')

# apply_device_enrollment_approval.py is intentionally additive, but its SQL
# filter replacements use prefixes of the already-hardened queries. A second
# lifecycle materialization (for example npm precheck followed by npm prestart)
# must therefore normalize repeated predicates instead of accumulating them.
duplicate = 'AND revoked_at IS NULL AND revoked_at IS NULL'
while duplicate in source:
    source = source.replace(duplicate, 'AND revoked_at IS NULL')

required = [
    'enforceRate(req, `new-device-enrollment:${account.id}`',
    "req.method === 'GET' && url.pathname === '/device/approve'",
    "req.method === 'POST' && url.pathname === '/device/approve'",
    'FOR UPDATE OF c',
    'method="post"',
    "'CERTIFICATE_BINDING_REJECTED'",
]
for token in required:
    if token not in source:
        raise RuntimeError(f'post-review device hardening invariant missing: {token}')

if duplicate in source:
    raise RuntimeError('device revocation predicate is not idempotent')

PATH.write_text(source, encoding='utf-8')
print('Device enrollment post-review hardening applied')
