from pathlib import Path

server_path = Path('production_server.js')
legal_path = Path('legal_documents.js')

server = server_path.read_text(encoding='utf-8')
legal = legal_path.read_text(encoding='utf-8')

# The 18-Aug legal architecture moved legalShell into legal_documents.js.
# Apply the approved consumer palette there rather than restoring the obsolete
# production_server.js shell from the older stable branch.
if '--cyan:#1FC7D4' not in legal:
    old = '<style>body{margin:0;background:#071511;color:#f4f1e8;font:16px/1.58 Arial,sans-serif}'
    new = '<style>:root{--ink:#280D5F;--muted:#7A6EAA;--bg:#FAF9FA;--panel:#FFFFFF;--soft:#EEEAF4;--border:#E7E3EB;--cyan:#1FC7D4;--purple:#7645D9}body{margin:0;background:linear-gradient(180deg,#eefcff 0,#FAF9FA 36%);color:var(--ink);font:16px/1.58 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}'
    if old not in legal:
        raise RuntimeError('18-Aug legal shell palette anchor missing')
    legal = legal.replace(old, new, 1)

    replacements = {
        'a{color:#76ded3}': 'a{color:var(--purple);font-weight:700}',
        'h2{color:#76ded3;margin-top:30px}': 'h2{color:var(--purple);margin-top:30px}',
        '.card{background:#10201b;padding:20px;border-radius:10px;margin:18px 0}': '.card{background:var(--panel);border:1px solid var(--border);padding:20px;border-radius:24px;margin:18px 0}',
        '.muted{color:#b8c4be}': '.muted{color:var(--muted);background:var(--soft)}',
        '.langs a,.legal a{padding:7px 9px;border:1px solid #36534a;border-radius:7px;text-decoration:none}': '.langs a,.legal a{padding:7px 9px;border:1px solid var(--border);border-radius:12px;text-decoration:none;background:var(--panel)}',
        '.langs a.active{background:#76ded3;color:#071511;font-weight:700}': '.langs a.active{background:var(--cyan);color:var(--ink);font-weight:700}',
    }
    for old_token, new_token in replacements.items():
        if old_token not in legal:
            raise RuntimeError(f'18-Aug legal theme token missing: {old_token}')
        legal = legal.replace(old_token, new_token, 1)

# Preserve the stable account deletion contract: deleting the account removes
# the account row, allowing the same email to register again.
old_delete = """    await securityEvent(null, 'ACCOUNT_DELETED', { formerAccountHash: hash(account.id) });
    return sendJson(res, 200, { ok: true });
"""
new_delete = """    await securityEvent(null, 'ACCOUNT_DELETED', { formerAccountHash: hash(account.id) });
    return sendJson(res, 200, { ok: true, emailReusable: true });
"""
if new_delete not in server:
    if server.count(old_delete) != 1:
        raise RuntimeError(f'account delete response anchor: expected 1, found {server.count(old_delete)}')
    server = server.replace(old_delete, new_delete, 1)

for token in [
    '--cyan:#1FC7D4',
    '--purple:#7645D9',
    '--ink:#280D5F',
]:
    if token not in legal:
        raise RuntimeError(f'reconciled legal palette token missing: {token}')

if 'emailReusable: true' not in server:
    raise RuntimeError('reusable-email account deletion token missing')
if not any(token in server for token in [
    "await client.query('DELETE FROM accounts WHERE id=$1'",
    "await pool.query('DELETE FROM accounts WHERE id=$1'",
]):
    raise RuntimeError('account deletion query missing')

legal_path.write_text(legal, encoding='utf-8')
server_path.write_text(server, encoding='utf-8')
print('Reconciled 18-Aug legal consumer palette and reusable-email deletion contract applied')
