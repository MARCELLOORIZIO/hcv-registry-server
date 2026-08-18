from pathlib import Path

path = Path('legal_documents.js')
source = path.read_text(encoding='utf-8')

old = "<style>body{margin:0;background:#071511;color:#f4f1e8;font:16px/1.58 Arial,sans-serif}.page{max-width:900px;margin:auto;padding:24px 20px 60px}a{color:#76ded3}h1{font-size:34px;line-height:1.15}h2{color:#76ded3;margin-top:30px}.card{background:#10201b;padding:20px;border-radius:10px;margin:18px 0}.muted{color:#b8c4be}.langs,.legal{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 20px}.langs a,.legal a{padding:7px 9px;border:1px solid #36534a;border-radius:7px;text-decoration:none}.langs a.active{background:#76ded3;color:#071511;font-weight:700}li{margin:7px 0}</style>"

new = "<style>:root{--cyan:#1FC7D4;--purple:#7645D9;--ink:#280D5F;--muted:#7A6EAA;--surface:#FFFFFF;--bg:#F8F7FC;--border:#E9E4F3}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.58 Arial,sans-serif}.page{max-width:900px;margin:auto;padding:24px 20px 60px}a{color:#0B8E99}h1{font-size:34px;line-height:1.15}h2{color:var(--purple);margin-top:30px}.card{background:var(--surface);padding:20px;border-radius:14px;margin:18px 0;border:1px solid var(--border)}.muted{color:var(--muted)}.langs,.legal{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 20px}.langs a,.legal a{padding:7px 9px;border:1px solid var(--border);background:var(--surface);border-radius:9px;text-decoration:none}.langs a.active{background:var(--cyan);color:var(--ink);font-weight:700}li{margin:7px 0}</style>"

if new not in source:
    if source.count(old) != 1:
        raise RuntimeError(f'legal consumer-theme anchor count={source.count(old)}')
    source = source.replace(old, new, 1)

for token in ['--cyan:#1FC7D4', '--purple:#7645D9', '--ink:#280D5F']:
    if token not in source:
        raise RuntimeError(f'approved legal palette token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Approved consumer palette applied to multilingual legal pages')
