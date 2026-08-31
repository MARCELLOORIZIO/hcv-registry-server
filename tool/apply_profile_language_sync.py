from pathlib import Path

PATH = Path('production_server.js')
source = PATH.read_text(encoding='utf-8')

old = """  if (req.method === 'POST' && url.pathname === '/api/auth/profile') {
    const session = await authenticate(req); const body = await readJson(req); const name = validateName(body.creatorName);
    await pool.query('UPDATE accounts SET creator_name=$2,updated_at=NOW() WHERE id=$1', [session.account_id, name]);
    return sendJson(res, 200, { ok: true, expiresAt: session.expires_at, account: await accountEnvelope(session.account_id, session.device_key_fingerprint) });
  }
"""

new = """  if (req.method === 'POST' && url.pathname === '/api/auth/profile') {
    const session = await authenticate(req); const body = await readJson(req); const name = validateName(body.creatorName);
    const preferredLanguage = body.languageCode == null ? null : normalizeLanguage(body.languageCode);
    await pool.query(
      'UPDATE accounts SET creator_name=$2,preferred_language=COALESCE($3,preferred_language),updated_at=NOW() WHERE id=$1',
      [session.account_id, name, preferredLanguage],
    );
    await securityEvent(session.account_id, 'PROFILE_UPDATED', { language: preferredLanguage || undefined });
    return sendJson(res, 200, { ok: true, expiresAt: session.expires_at, account: await accountEnvelope(session.account_id, session.device_key_fingerprint) });
  }
"""

if new not in source:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'profile route anchor expected once, found {count}')
    source = source.replace(old, new, 1)

for token in [
    "body.languageCode == null ? null : normalizeLanguage(body.languageCode)",
    "preferred_language=COALESCE($3,preferred_language)",
    "'PROFILE_UPDATED'",
]:
    if token not in source:
        raise RuntimeError(f'profile language synchronization token missing: {token}')

PATH.write_text(source, encoding='utf-8')
print('Profile preferred-language synchronization applied')
