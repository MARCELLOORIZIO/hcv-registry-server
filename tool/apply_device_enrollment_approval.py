from pathlib import Path

PATH = Path('production_server.js')
source = PATH.read_text(encoding='utf-8')

# This patch runs after the existing auth/legal/certificate patches. It adds a
# second factor for a previously unseen device key without changing the login
# contract for already enrolled devices.

# 1) Add additive schema for revocation-aware devices and single-use approval
# challenges. Existing devices remain active (revoked_at NULL).
if 'CREATE TABLE IF NOT EXISTS device_enrollment_challenges' not in source:
    security_marker = '\nasync function securityEvent'
    security_pos = source.find(security_marker)
    if security_pos < 0 or source.find(security_marker, security_pos + 1) >= 0:
        raise RuntimeError('securityEvent boundary not unique')
    init_end = source.rfind('\n}', 0, security_pos)
    if init_end < 0:
        raise RuntimeError('initSchema closing boundary not found')
    migration = '''
  await pool.query(`
    ALTER TABLE account_devices ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS device_enrollment_challenges (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      device_key_fingerprint TEXT NOT NULL,
      public_key_json JSONB NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(account_id, device_key_fingerprint)
    );
    CREATE INDEX IF NOT EXISTS device_enrollment_challenges_expiry_idx
      ON device_enrollment_challenges(expires_at);
  `);
'''
    source = source[:init_end] + '\n' + migration + source[init_end:]

# 2) Helpers: 4-language email + approval page. The token is random, stored only
# as SHA-256 server-side, expires after 15 minutes and is single-use. Opening the
# email link with GET is intentionally non-mutating: actual enrollment requires a
# second explicit POST from the confirmation page, protecting against email link
# scanners and security prefetchers.
helper_anchor = '\nasync function issueSession(accountId, fingerprint) {'
if 'function deviceEnrollmentCopy(language)' not in source:
    helper_pos = source.find(helper_anchor)
    if helper_pos < 0 or source.find(helper_anchor, helper_pos + 1) >= 0:
        raise RuntimeError('issueSession anchor missing or not unique')
    helpers = r'''
function deviceEnrollmentCopy(language) {
  const lang = normalizeLanguage(language);
  const all = {
    it: {
      subject: 'Conferma nuovo dispositivo SIGILLUM',
      intro: 'È stato richiesto l’accesso al tuo account SIGILLUM da un nuovo dispositivo.',
      action: 'CONFERMA NUOVO DISPOSITIVO',
      ignore: 'Se non sei stato tu, non approvare questo dispositivo e cambia la password del tuo account.',
      expires: 'Il link scade tra 15 minuti.',
      pending: 'Nuovo dispositivo rilevato. Ti abbiamo inviato un’email di conferma. Approva il dispositivo dal link ricevuto, poi premi di nuovo ACCEDI.',
      confirmTitle: 'Conferma questo dispositivo',
      confirmBody: 'Conferma solo se sei stato tu a tentare l’accesso a SIGILLUM da questo dispositivo.',
      approvedTitle: 'Dispositivo confermato',
      approvedBody: 'Il dispositivo è stato autorizzato. Torna in SIGILLUM e premi di nuovo ACCEDI.',
      invalidTitle: 'Link non valido o scaduto',
      invalidBody: 'La richiesta di autorizzazione non è più valida. Torna in SIGILLUM e ripeti l’accesso per ricevere un nuovo link.',
      fingerprint: 'Impronta dispositivo',
    },
    en: {
      subject: 'Confirm new SIGILLUM device',
      intro: 'A sign-in to your SIGILLUM account was requested from a new device.',
      action: 'CONFIRM NEW DEVICE',
      ignore: 'If this was not you, do not approve the device and change your account password.',
      expires: 'The link expires in 15 minutes.',
      pending: 'New device detected. We sent you a confirmation email. Approve the device from the link, then tap SIGN IN again.',
      confirmTitle: 'Confirm this device',
      confirmBody: 'Confirm only if you attempted to sign in to SIGILLUM from this device.',
      approvedTitle: 'Device confirmed',
      approvedBody: 'The device has been authorized. Return to SIGILLUM and tap SIGN IN again.',
      invalidTitle: 'Invalid or expired link',
      invalidBody: 'This authorization request is no longer valid. Return to SIGILLUM and sign in again to receive a new link.',
      fingerprint: 'Device fingerprint',
    },
    es: {
      subject: 'Confirma un nuevo dispositivo SIGILLUM',
      intro: 'Se ha solicitado el acceso a tu cuenta SIGILLUM desde un nuevo dispositivo.',
      action: 'CONFIRMAR NUEVO DISPOSITIVO',
      ignore: 'Si no has sido tú, no apruebes el dispositivo y cambia la contraseña de tu cuenta.',
      expires: 'El enlace caduca en 15 minutos.',
      pending: 'Se ha detectado un nuevo dispositivo. Te hemos enviado un email de confirmación. Aprueba el dispositivo desde el enlace y después pulsa ACCEDER de nuevo.',
      confirmTitle: 'Confirma este dispositivo',
      confirmBody: 'Confirma solo si has intentado acceder a SIGILLUM desde este dispositivo.',
      approvedTitle: 'Dispositivo confirmado',
      approvedBody: 'El dispositivo ha sido autorizado. Vuelve a SIGILLUM y pulsa ACCEDER de nuevo.',
      invalidTitle: 'Enlace no válido o caducado',
      invalidBody: 'La solicitud de autorización ya no es válida. Vuelve a SIGILLUM e inicia sesión de nuevo para recibir otro enlace.',
      fingerprint: 'Huella del dispositivo',
    },
    ru: {
      subject: 'Подтвердите новое устройство SIGILLUM',
      intro: 'Запрошен вход в ваш аккаунт SIGILLUM с нового устройства.',
      action: 'ПОДТВЕРДИТЬ НОВОЕ УСТРОЙСТВО',
      ignore: 'Если это были не вы, не подтверждайте устройство и смените пароль аккаунта.',
      expires: 'Ссылка действует 15 минут.',
      pending: 'Обнаружено новое устройство. Мы отправили письмо для подтверждения. Подтвердите устройство по ссылке, затем снова нажмите ВОЙТИ.',
      confirmTitle: 'Подтвердите это устройство',
      confirmBody: 'Подтверждайте только в том случае, если именно вы пытались войти в SIGILLUM с этого устройства.',
      approvedTitle: 'Устройство подтверждено',
      approvedBody: 'Устройство авторизовано. Вернитесь в SIGILLUM и снова нажмите ВОЙТИ.',
      invalidTitle: 'Ссылка недействительна или истекла',
      invalidBody: 'Запрос авторизации больше недействителен. Вернитесь в SIGILLUM и снова выполните вход, чтобы получить новую ссылку.',
      fingerprint: 'Отпечаток устройства',
    },
  };
  return { lang, ...all[lang] };
}

function deviceApprovalOrigin(req) {
  const configured = String(APP_BASE_URL || '').trim().replace(/\/$/, '');
  if (/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(configured)) return configured;
  const host = String(req.headers.host || '').trim();
  if (/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return `https://${host}`;
  return 'https://sigillum-registry-production.onrender.com';
}

function deviceApprovalPage(copy, mode, token = '', fingerprint = '') {
  const isConfirm = mode === 'confirm';
  const isSuccess = mode === 'success';
  const title = isConfirm ? copy.confirmTitle : (isSuccess ? copy.approvedTitle : copy.invalidTitle);
  const body = isConfirm ? copy.confirmBody : (isSuccess ? copy.approvedBody : copy.invalidBody);
  const fpTail = String(fingerprint || '').slice(-12).toUpperCase();
  const action = isConfirm
    ? `<form method="post" action="/device/approve?token=${encodeURIComponent(token)}&lang=${copy.lang}"><button type="submit">${copy.action}</button></form>`
    : '';
  const fp = isConfirm && fpTail
    ? `<p class="muted"><strong>${copy.fingerprint}:</strong> …${fpTail}</p>`
    : '';
  return `<!doctype html><html lang="${copy.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - SIGILLUM</title><style>body{margin:0;background:#eefaff;color:#2b0b67;font:16px/1.55 Arial,sans-serif}.wrap{max-width:620px;margin:48px auto;padding:24px}.card{background:white;border:1px solid #ddd5e6;border-radius:24px;padding:30px;box-shadow:0 12px 35px #30107012}h1{margin:0 0 16px;font-size:30px}.ok{color:#17b98a;font-weight:800}.muted{color:#76679a}button{border:0;border-radius:14px;background:#23c4cc;color:#2b0b67;font-weight:900;font-size:16px;padding:15px 20px;cursor:pointer}</style></head><body><main class="wrap"><section class="card"><div class="ok">SIGILLUM</div><h1>${title}</h1><p>${body}</p>${fp}${action}<p class="muted">SIGILLUM Creator</p></section></main></body></html>`;
}

async function sendDeviceEnrollmentEmail(account, token, fingerprint, origin) {
  const copy = deviceEnrollmentCopy(account.preferred_language || 'en');
  const approvalUrl = `${origin}/device/approve?token=${encodeURIComponent(token)}&lang=${copy.lang}`;
  const fpTail = String(fingerprint || '').slice(-12).toUpperCase();
  if (!RESEND_API_KEY) {
    if (NODE_ENV === 'production') throw new Error('RESEND_API_KEY_REQUIRED');
    console.log(`[DEV EMAIL] ${account.email_display} device_enrollment: ${approvalUrl}`);
    return copy;
  }
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>SIGILLUM</h2><p>${copy.intro}</p><p><strong>${copy.fingerprint}:</strong> …${fpTail}</p><p style="margin:28px 0"><a href="${approvalUrl}" style="display:inline-block;background:#23c4cc;color:#2b0b67;text-decoration:none;font-weight:800;padding:14px 18px;border-radius:12px">${copy.action}</a></p><p>${copy.expires}</p><p>${copy.ignore}</p></div>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [account.email_display], subject: copy.subject, html }),
  });
  if (!response.ok) throw new Error(`EMAIL_PROVIDER_${response.status}`);
  return copy;
}

async function requestDeviceEnrollment(req, account, proof) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hash(token);
  await pool.query('DELETE FROM device_enrollment_challenges WHERE expires_at <= NOW()');
  await pool.query(`
    INSERT INTO device_enrollment_challenges(
      account_id,device_key_fingerprint,public_key_json,token_hash,expires_at,created_at
    ) VALUES($1,$2,$3,$4,NOW()+INTERVAL '15 minutes',NOW())
    ON CONFLICT(account_id,device_key_fingerprint) DO UPDATE SET
      public_key_json=EXCLUDED.public_key_json,
      token_hash=EXCLUDED.token_hash,
      expires_at=EXCLUDED.expires_at,
      created_at=NOW()
  `, [account.id, proof.fingerprint, proof.normalized, tokenHash]);
  const copy = await sendDeviceEnrollmentEmail(
    account,
    token,
    proof.fingerprint,
    deviceApprovalOrigin(req),
  );
  await securityEvent(account.id, 'DEVICE_ENROLLMENT_REQUESTED', {
    device: proof.fingerprint,
    language: copy.lang,
  });
  return copy;
}
'''
    source = source[:helper_pos] + '\n' + helpers + source[helper_pos:]

# 3) GET only previews the confirmation page. It never writes account_devices or
# consumes the token, so automatic email security scanners cannot approve a key.
approval_anchor = "  if (req.method === 'POST' && url.pathname === '/api/auth/login') {"
if "req.method === 'GET' && url.pathname === '/device/approve'" not in source:
    pos = source.find(approval_anchor)
    if pos < 0 or source.find(approval_anchor, pos + 1) >= 0:
        raise RuntimeError('login route anchor missing or not unique')
    approval_routes = r'''  if (req.method === 'GET' && url.pathname === '/device/approve') {
    const fallbackCopy = deviceEnrollmentCopy(url.searchParams.get('lang'));
    const token = String(url.searchParams.get('token') || '');
    if (!token || token.length < 20) return sendHtml(res, 400, deviceApprovalPage(fallbackCopy, 'invalid'));
    const tokenHash = hash(token);
    const challenge = (await pool.query(`
      SELECT c.device_key_fingerprint, a.preferred_language
      FROM device_enrollment_challenges c
      JOIN accounts a ON a.id=c.account_id
      WHERE c.token_hash=$1 AND c.expires_at>NOW()
    `, [tokenHash])).rows[0];
    if (!challenge) return sendHtml(res, 400, deviceApprovalPage(fallbackCopy, 'invalid'));
    const copy = deviceEnrollmentCopy(challenge.preferred_language || fallbackCopy.lang);
    return sendHtml(res, 200, deviceApprovalPage(copy, 'confirm', token, challenge.device_key_fingerprint));
  }

  if (req.method === 'POST' && url.pathname === '/device/approve') {
    const fallbackCopy = deviceEnrollmentCopy(url.searchParams.get('lang'));
    const token = String(url.searchParams.get('token') || '');
    if (!token || token.length < 20) return sendHtml(res, 400, deviceApprovalPage(fallbackCopy, 'invalid'));
    const tokenHash = hash(token);
    const client = await pool.connect();
    let challenge;
    try {
      await client.query('BEGIN');
      challenge = (await client.query(`
        SELECT c.*, a.email_display, a.preferred_language
        FROM device_enrollment_challenges c
        JOIN accounts a ON a.id=c.account_id
        WHERE c.token_hash=$1 AND c.expires_at>NOW()
        FOR UPDATE OF c
      `, [tokenHash])).rows[0];
      if (!challenge) {
        await client.query('ROLLBACK');
        return sendHtml(res, 400, deviceApprovalPage(fallbackCopy, 'invalid'));
      }
      await client.query(`
        INSERT INTO account_devices(
          account_id,device_key_fingerprint,public_key_json,created_at,last_seen_at,revoked_at
        ) VALUES($1,$2,$3,NOW(),NOW(),NULL)
        ON CONFLICT(account_id,device_key_fingerprint) DO UPDATE SET
          public_key_json=EXCLUDED.public_key_json,
          created_at=NOW(),
          last_seen_at=NOW(),
          revoked_at=NULL
      `, [challenge.account_id, challenge.device_key_fingerprint, challenge.public_key_json]);
      await client.query('DELETE FROM device_enrollment_challenges WHERE token_hash=$1', [tokenHash]);
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
    await securityEvent(challenge.account_id, 'DEVICE_ENROLLMENT_APPROVED', {
      device: challenge.device_key_fingerprint,
    });
    const copy = deviceEnrollmentCopy(challenge.preferred_language || fallbackCopy.lang);
    return sendHtml(res, 200, deviceApprovalPage(copy, 'success'));
  }

'''
    source = source[:pos] + approval_routes + source[pos:]

# 4) Replace auto-enrollment-on-password-login. Known active devices behave as
# before. Unknown/revoked keys receive no session until email approval.
old_login = """    const proof = verifyDeviceProof(body);
    await pool.query(`INSERT INTO account_devices(account_id,device_key_fingerprint,public_key_json,last_seen_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(account_id,device_key_fingerprint) DO UPDATE SET public_key_json=EXCLUDED.public_key_json,last_seen_at=NOW()`, [account.id, proof.fingerprint, proof.normalized]);
    const session = await issueSession(account.id, proof.fingerprint);
    await securityEvent(account.id, 'LOGIN', { device: proof.fingerprint });
    return sendJson(res, 200, { ok: true, token: session.token, expiresAt: session.expiresAt, account: await accountEnvelope(account.id, proof.fingerprint) });
"""
new_login = """    const proof = verifyDeviceProof(body);
    const knownDevice = (await pool.query(
      'SELECT device_key_fingerprint FROM account_devices WHERE account_id=$1 AND device_key_fingerprint=$2 AND revoked_at IS NULL',
      [account.id, proof.fingerprint],
    )).rows[0];
    if (!knownDevice) {
      enforceRate(req, 'new-device-enrollment', 4, 15 * 60 * 1000);
      const copy = await requestDeviceEnrollment(req, account, proof);
      throw publicError('NUOVO_DISPOSITIVO_DA_CONFERMARE', 403, copy.pending);
    }
    await pool.query(
      'UPDATE account_devices SET public_key_json=$3,last_seen_at=NOW() WHERE account_id=$1 AND device_key_fingerprint=$2 AND revoked_at IS NULL',
      [account.id, proof.fingerprint, proof.normalized],
    );
    await pool.query('DELETE FROM device_enrollment_challenges WHERE account_id=$1 AND device_key_fingerprint=$2', [account.id, proof.fingerprint]);
    const session = await issueSession(account.id, proof.fingerprint);
    await securityEvent(account.id, 'LOGIN', { device: proof.fingerprint });
    return sendJson(res, 200, { ok: true, token: session.token, expiresAt: session.expiresAt, account: await accountEnvelope(account.id, proof.fingerprint) });
"""
if old_login in source:
    source = source.replace(old_login, new_login, 1)
elif "'NUOVO_DISPOSITIVO_DA_CONFERMARE'" not in source:
    raise RuntimeError('login auto-enrollment anchor missing')

# 5) Device counts/lists and certificate binding should consider only active
# devices. This also prepares a clean invariant for the later revocation UI.
source = source.replace(
    "SELECT COUNT(*)::int AS c FROM account_devices WHERE account_id=$1",
    "SELECT COUNT(*)::int AS c FROM account_devices WHERE account_id=$1 AND revoked_at IS NULL",
)
source = source.replace(
    "SELECT device_key_fingerprint,created_at,last_seen_at FROM account_devices WHERE account_id=$1 ORDER BY last_seen_at DESC",
    "SELECT device_key_fingerprint,created_at,last_seen_at FROM account_devices WHERE account_id=$1 AND revoked_at IS NULL ORDER BY last_seen_at DESC",
)
source = source.replace(
    "SELECT device_key_fingerprint,public_key_json FROM account_devices WHERE account_id=$1 AND device_key_fingerprint=$2",
    "SELECT device_key_fingerprint,public_key_json FROM account_devices WHERE account_id=$1 AND device_key_fingerprint=$2 AND revoked_at IS NULL",
)

required = [
    'CREATE TABLE IF NOT EXISTS device_enrollment_challenges',
    'ALTER TABLE account_devices ADD COLUMN IF NOT EXISTS revoked_at',
    'function deviceEnrollmentCopy(language)',
    "req.method === 'GET' && url.pathname === '/device/approve'",
    "req.method === 'POST' && url.pathname === '/device/approve'",
    'DEVICE_ENROLLMENT_REQUESTED',
    'DEVICE_ENROLLMENT_APPROVED',
    'NUOVO_DISPOSITIVO_DA_CONFERMARE',
    "enforceRate(req, 'new-device-enrollment'",
    "device_key_fingerprint=$2 AND revoked_at IS NULL",
    'const client = await pool.connect();',
    'FOR UPDATE OF c',
    'method="post"',
    "it: {",
    "en: {",
    "es: {",
    "ru: {",
]
for token in required:
    if token not in source:
        raise RuntimeError(f'device enrollment invariant missing: {token}')

# Explicit safety invariants: device enrollment must not weaken certificate,
# billing or KYC gates already materialized by earlier patches.
for invariant in [
    "'CERTIFICATE_BINDING_REJECTED'",
    'inspectCertificateAccountBinding({',
    "'/api/billing/apple/reconcile'",
    'verificationFresh',
    'requireCreatorAccess(req)',
]:
    if invariant not in source:
        raise RuntimeError(f'pre-existing security invariant missing: {invariant}')

PATH.write_text(source, encoding='utf-8')
print('Secure new-device email approval applied')
