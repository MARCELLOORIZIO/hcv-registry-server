from pathlib import Path

path = Path('legal_documents.js')
source = path.read_text(encoding='utf-8')

if '--cyan:#1FC7D4' not in source:
    anchor = '<style>body{margin:0;background:#071511;color:#f4f1e8;font:16px/1.58 Arial,sans-serif}'
    replacement = '<style>:root{--ink:#280D5F;--muted:#7A6EAA;--bg:#FAF9FA;--panel:#FFFFFF;--cyan:#1FC7D4;--purple:#7645D9}body{margin:0;background:#FAF9FA;color:var(--ink);font:16px/1.58 Arial,sans-serif}'
    if anchor not in source:
        raise RuntimeError('legal theme anchor missing')
    source = source.replace(anchor, replacement, 1)
    source = source.replace('a{color:#76ded3}', 'a{color:var(--purple)}', 1)
    source = source.replace('h2{color:#76ded3;margin-top:30px}', 'h2{color:var(--purple);margin-top:30px}', 1)
    source = source.replace('.card{background:#10201b;padding:20px;border-radius:10px;margin:18px 0}', '.card{background:#FFFFFF;padding:20px;border-radius:24px;margin:18px 0}', 1)
    source = source.replace('.muted{color:#b8c4be}', '.muted{color:var(--muted)}', 1)

for token in ['--cyan:#1FC7D4', '--purple:#7645D9', '--ink:#280D5F']:
    if token not in source:
        raise RuntimeError(f'legal theme token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Consumer legal theme applied to modular legal documents')
