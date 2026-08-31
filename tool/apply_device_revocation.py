from pathlib import Path

PATH = Path('production_server.js')
source = PATH.read_text(encoding='utf-8')

# Add localized copy for security-sensitive device revocation. This patch runs
# after device enrollment and profile-language synchronization.
helper_anchor = '\nasync function issueSession(accountId, fingerprint) {'
if 'function deviceRevocationCopy(language)' not in source:
    pos = source.find(helper_anchor)
    if pos < 0 or source.find(helper_anchor, pos + 1) >= 0:
        raise RuntimeError('issueSession anchor missing or not unique')
    helper = r'''
function deviceRevocationCopy(language) {
  const lang = normalizeLanguage(language);
  const all = {
    it: {
      wrongPassword: 'Password non corretta.',
      currentDevice: 'Non puoi revocare il dispositivo che stai utilizzando.',
      notFound: 'Dispositivo non trovato o già revocato.',
      success: 'Dispositivo revocato.',
    },
    en: {
      wrongPassword: 'Incorrect password.',
      currentDevice: 'You cannot revoke the device you are currently using.',
      notFound: 'Device not found or already revoked.',
      success: 'Device revoked.',
    },
    es: {
      wrongPassword: 'Contraseña incorrecta.',
      currentDevice: 'No puedes revocar el dispositivo que estás utilizando.',
      notFound: 'Dispositivo no encontrado o ya revocado.',
      success: 'Dispositivo revocado.',
    },
    ru: {
      wrongPassword: 'Неверный пароль.',
      currentDevice: 'Нельзя отозвать устройство, которое используется сейчас.',
      notFound: 'Устройство не найдено или уже отозвано.',
      success: 'Устройство отозвано.',
    },
  };
  return { lang, ...all[lang] };
}
'''
    source = source[:pos] + '\n' + helper + source[pos:]

route_anchor = "  if (req.method === 'GET' && url.pathname === '/api/auth/devices') {"
if "url.pathname === '/api/auth/devices/revoke'" not in source:
    pos = source.find(route_anchor)
    if pos < 0 or source.find(route_anchor, pos + 1) >= 0:
        raise RuntimeError('device list route anchor missing or not unique')
    route = r'''  if (req.method === 'POST' && url.pathname === '/api/auth/devices/revoke') {
    const session = await authenticate(req);
    enforceRate(req, `device-revoke:${session.account_id}`, 6, 15 * 60 * 1000);
    const body = await readJson(req);
    const fingerprint = String(body.deviceKeyFingerprint || '').trim().toLowerCase();
    const password = String(body.password || '');

    const account = (await pool.query(`
      SELECT password_salt,password_hash,preferred_language
      FROM accounts
      WHERE id=$1
    `, [session.account_id])).rows[0];
    const copy = deviceRevocationCopy(account?.preferred_language || 'en');

    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw publicError('DISPOSITIVO_NON_TROVATO', 404, copy.notFound);
    }
    if (!account || !(await passwordMatches(password, account))) {
      throw publicError('CREDENZIALI_NON_VALIDE', 401, copy.wrongPassword);
    }
    if (fingerprint === String(session.device_key_fingerprint || '').toLowerCase()) {
      throw publicError('DISPOSITIVO_CORRENTE_NON_REVOCABILE', 400, copy.currentDevice);
    }

    const client = await pool.connect();
    let sessionsRevoked = 0;
    try {
      await client.query('BEGIN');
      const target = (await client.query(`
        SELECT device_key_fingerprint
        FROM account_devices
        WHERE account_id=$1
          AND LOWER(device_key_fingerprint)=$2
          AND revoked_at IS NULL
        FOR UPDATE
      `, [session.account_id, fingerprint])).rows[0];

      if (!target) {
        await client.query('ROLLBACK');
        throw publicError('DISPOSITIVO_NON_TROVATO', 404, copy.notFound);
      }

      await client.query(`
        UPDATE account_devices
        SET revoked_at=NOW()
        WHERE account_id=$1
          AND LOWER(device_key_fingerprint)=$2
          AND revoked_at IS NULL
      `, [session.account_id, fingerprint]);

      const revokedSessions = await client.query(`
        UPDATE sessions
        SET revoked_at=COALESCE(revoked_at,NOW())
        WHERE account_id=$1
          AND LOWER(device_key_fingerprint)=$2
          AND revoked_at IS NULL
        RETURNING token_hash
      `, [session.account_id, fingerprint]);
      sessionsRevoked = revokedSessions.rowCount;

      await client.query(`
        DELETE FROM device_enrollment_challenges
        WHERE account_id=$1
          AND LOWER(device_key_fingerprint)=$2
      `, [session.account_id, fingerprint]);

      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }

    await securityEvent(session.account_id, 'DEVICE_REVOKED', {
      device: fingerprint,
      byDevice: session.device_key_fingerprint,
      sessionsRevoked,
    });
    return sendJson(res, 200, { ok: true, sessionsRevoked, message: copy.success });
  }

'''
    source = source[:pos] + route + source[pos:]

required = [
    'function deviceRevocationCopy(language)',
    "url.pathname === '/api/auth/devices/revoke'",
    'passwordMatches(password, account)',
    'DISPOSITIVO_CORRENTE_NON_REVOCABILE',
    'FOR UPDATE',
    'UPDATE account_devices',
    'SET revoked_at=NOW()',
    'UPDATE sessions',
    'SET revoked_at=COALESCE(revoked_at,NOW())',
    'DELETE FROM device_enrollment_challenges',
    "securityEvent(session.account_id, 'DEVICE_REVOKED'",
]
for marker in required:
    if marker not in source:
        raise RuntimeError(f'device revocation marker missing: {marker}')

PATH.write_text(source, encoding='utf-8')
print('Device revocation contract applied')
