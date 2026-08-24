from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

old = """    await securityEvent(null, 'ACCOUNT_DELETED', { formerAccountHash: hash(account.id) });
    return sendJson(res, 200, { ok: true });
"""
new = """    await securityEvent(null, 'ACCOUNT_DELETED', { formerAccountHash: hash(account.id) });
    return sendJson(res, 200, { ok: true, emailReusable: true });
"""
if 'emailReusable: true' not in source:
    if old not in source:
        raise RuntimeError('account delete response anchor missing')
    source = source.replace(old, new, 1)

if 'emailReusable: true' not in source:
    raise RuntimeError('reusable-email deletion contract missing')
if not (
    "await client.query('DELETE FROM accounts WHERE id=$1'" in source
    or "await pool.query('DELETE FROM accounts WHERE id=$1'" in source
):
    raise RuntimeError('account deletion query missing')

path.write_text(source, encoding='utf-8')
print('Reusable-email account deletion contract applied')
