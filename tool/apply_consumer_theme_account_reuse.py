from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

old_shell = '''function legalShell(title, body) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - SIGILLUM</title><style>body{margin:0;background:#071511;color:#f4f1e8;font:16px/1.55 Arial,sans-serif}.page{max-width:900px;margin:auto;padding:28px 20px 60px}a{color:#76ded3}h1{font-size:34px}h2{color:#76ded3;margin-top:30px}.card{background:#10201b;padding:20px;border-radius:10px;margin:18px 0}.muted{color:#b8c4be}</style></head><body><main class="page"><h1>${title}</h1>${body}<p class="muted">MAORI DI MARCELLO ORIZIO · Via della Battaglia 28, 25030 Maclodio (BS) · P.IVA 04773680980 · REA BS-640525 · PEC marcelloorizio@legalmail.it</p></main></body></html>`;
}
'''
new_shell = '''function legalShell(title, body) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - SIGILLUM</title><style>:root{--ink:#280D5F;--muted:#7A6EAA;--bg:#FAF9FA;--panel:#FFFFFF;--soft:#EEEAF4;--border:#E7E3EB;--cyan:#1FC7D4;--purple:#7645D9}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#eefcff 0,#FAF9FA 36%);color:var(--ink);font:16px/1.58 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.page{max-width:900px;margin:auto;padding:34px 20px 72px}h1{font-size:clamp(34px,7vw,52px);line-height:1.05;margin:12px 0 28px;color:var(--ink);letter-spacing:-1px}h2{color:var(--purple);margin:30px 0 10px;font-size:24px}p{background:var(--panel);border:1px solid var(--border);border-radius:24px;padding:18px 20px;margin:12px 0;box-shadow:0 8px 30px rgba(40,13,95,.05)}a{color:var(--purple);font-weight:700}.card{background:var(--panel);border:1px solid var(--border);padding:20px;border-radius:24px;margin:18px 0}.muted{color:var(--muted);background:var(--soft)}::selection{background:var(--cyan);color:var(--ink)}@media(max-width:600px){.page{padding:24px 16px 48px}h2{font-size:21px}p{border-radius:20px;padding:16px}}</style></head><body><main class="page"><h1>${title}</h1>${body}<p class="muted">MAORI DI MARCELLO ORIZIO · Via della Battaglia 28, 25030 Maclodio (BS) · P.IVA 04773680980 · REA BS-640525 · PEC marcelloorizio@legalmail.it</p></main></body></html>`;
}
'''
if new_shell not in source:
    if source.count(old_shell) != 1:
        raise RuntimeError(f'legal shell anchor: expected 1, found {source.count(old_shell)}')
    source = source.replace(old_shell, new_shell, 1)

old_delete = '''    await securityEvent(null, 'ACCOUNT_DELETED', { formerAccountHash: hash(account.id) });
    return sendJson(res, 200, { ok: true });
'''
new_delete = '''    await securityEvent(null, 'ACCOUNT_DELETED', { formerAccountHash: hash(account.id) });
    return sendJson(res, 200, { ok: true, emailReusable: true });
'''
if new_delete not in source:
    if source.count(old_delete) != 1:
        raise RuntimeError(f'account delete response anchor: expected 1, found {source.count(old_delete)}')
    source = source.replace(old_delete, new_delete, 1)

for token in [
    '--cyan:#1FC7D4',
    '--purple:#7645D9',
    '--ink:#280D5F',
    'emailReusable: true',
]:
    if token not in source:
        raise RuntimeError(f'consumer refinement token missing: {token}')

delete_query_tokens = [
    "await client.query('DELETE FROM accounts WHERE id=$1'",
    "await pool.query('DELETE FROM accounts WHERE id=$1'",
]
if not any(token in source for token in delete_query_tokens):
    raise RuntimeError('consumer refinement token missing: account deletion query')

path.write_text(source, encoding='utf-8')
print('Consumer legal palette and reusable-email account deletion contract applied')
