from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

old_ssl = """const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
"""
new_ssl = """const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PG_SSL_REQUIRED === 'true'
    ? { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  max: Number(process.env.PG_POOL_MAX || 10),
"""
if old_ssl in source:
    source = source.replace(old_ssl, new_ssl, 1)

subscription_flag_anchor = "const SUBSCRIPTIONS_ENFORCED = process.env.SUBSCRIPTIONS_ENFORCED === 'true';\n"
subscription_flag_value = subscription_flag_anchor + "const KYC_REQUIRES_SUBSCRIPTION = process.env.KYC_REQUIRES_SUBSCRIPTION !== 'false';\n"
if 'const KYC_REQUIRES_SUBSCRIPTION' not in source:
    if subscription_flag_anchor not in source:
        raise RuntimeError('subscription flag anchor missing')
    source = source.replace(subscription_flag_anchor, subscription_flag_value, 1)

old_code = """function makeCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}
"""
new_code = """function makeCode() {
  if (NODE_ENV === 'test' && /^\\d{6}$/.test(process.env.TEST_FIXED_CODE || '')) {
    return process.env.TEST_FIXED_CODE;
  }
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}
"""
if old_code in source:
    source = source.replace(old_code, new_code, 1)

anchor = "async function securityEvent(accountId, type, detail = {}) {"
helper = """async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

"""
if 'async function withTransaction(work)' not in source:
    if anchor not in source:
        raise RuntimeError('transaction helper anchor missing')
    source = source.replace(anchor, helper + anchor, 1)

old_register = """    await pool.query('BEGIN');
    try {
      await pool.query(`INSERT INTO accounts(id,email_normalized,email_display,password_salt,password_hash,creator_name,creator_id,terms_version,privacy_version,terms_accepted_at,privacy_ack_at,adult_confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10)`, [accountId, email, String(body.email).trim(), pw.salt, pw.passwordHash, creatorName, String(body.creatorId || ''), TERMS_VERSION, PRIVACY_VERSION, now]);
      await pool.query('INSERT INTO account_devices(account_id,device_key_fingerprint,public_key_json) VALUES($1,$2,$3)', [accountId, proof.fingerprint, proof.normalized]);
      await pool.query('COMMIT');
    } catch (err) { await pool.query('ROLLBACK'); throw err; }
"""
new_register = """    await withTransaction(async (client) => {
      await client.query(`INSERT INTO accounts(id,email_normalized,email_display,password_salt,password_hash,creator_name,creator_id,terms_version,privacy_version,terms_accepted_at,privacy_ack_at,adult_confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10)`, [accountId, email, String(body.email).trim(), pw.salt, pw.passwordHash, creatorName, String(body.creatorId || ''), TERMS_VERSION, PRIVACY_VERSION, now]);
      await client.query('INSERT INTO account_devices(account_id,device_key_fingerprint,public_key_json) VALUES($1,$2,$3)', [accountId, proof.fingerprint, proof.normalized]);
    });
"""
if old_register in source:
    source = source.replace(old_register, new_register, 1)

old_reset = """    await pool.query('BEGIN');
    try { await pool.query('UPDATE accounts SET password_salt=$2,password_hash=$3,updated_at=NOW() WHERE id=$1', [account.id, pw.salt, pw.passwordHash]); await pool.query('UPDATE sessions SET revoked_at=NOW() WHERE account_id=$1 AND revoked_at IS NULL', [account.id]); await pool.query('COMMIT'); } catch (err) { await pool.query('ROLLBACK'); throw err; }
"""
new_reset = """    await withTransaction(async (client) => {
      await client.query('UPDATE accounts SET password_salt=$2,password_hash=$3,updated_at=NOW() WHERE id=$1', [account.id, pw.salt, pw.passwordHash]);
      await client.query('UPDATE sessions SET revoked_at=NOW() WHERE account_id=$1 AND revoked_at IS NULL', [account.id]);
    });
"""
if old_reset in source:
    source = source.replace(old_reset, new_reset, 1)

old_delete = """    await pool.query('BEGIN');
    try {
      await pool.query(`UPDATE certificates SET account_id=NULL, certificate_raw=certificate_raw WHERE account_id=$1`, [account.id]);
      await pool.query('DELETE FROM accounts WHERE id=$1', [account.id]);
      await pool.query('COMMIT');
    } catch (err) { await pool.query('ROLLBACK'); throw err; }
"""
new_delete = """    await withTransaction(async (client) => {
      await client.query('UPDATE certificates SET account_id=NULL WHERE account_id=$1', [account.id]);
      await client.query('DELETE FROM accounts WHERE id=$1', [account.id]);
    });
"""
if old_delete in source:
    source = source.replace(old_delete, new_delete, 1)

old_duplicate = """    } catch (err) {
      if (err.code === '23505') throw publicError('CERTIFICATO_ESISTENTE', 409);
      throw err;
    }
    return sendJson(res, 201, { ok: true, hcvId, storage: 'postgres', url: `/api/certificate/${hcvId}` });
"""
new_duplicate = """    } catch (err) {
      if (err.code === '23505') {
        const existing = (await pool.query('SELECT certificate_sha256 FROM certificates WHERE hcv_id=$1', [hcvId])).rows[0];
        if (existing?.certificate_sha256 === hash(raw)) {
          return sendJson(res, 200, { ok: true, hcvId, storage: 'postgres', idempotent: true, url: `/api/certificate/${hcvId}` });
        }
        throw publicError('CERTIFICATO_ESISTENTE', 409);
      }
      throw err;
    }
    return sendJson(res, 201, { ok: true, hcvId, storage: 'postgres', url: `/api/certificate/${hcvId}` });
"""
if old_duplicate in source:
    source = source.replace(old_duplicate, new_duplicate, 1)

password_anchor = """  if (req.method === 'POST' && url.pathname === '/api/auth/password/forgot') {
"""
password_route = """  if (req.method === 'POST' && url.pathname === '/api/auth/password') {
    const session = await authenticate(req);
    const body = await readJson(req);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = validatePassword(body.newPassword, 'NUOVA_PASSWORD_NON_VALIDIDA');
    const account = (await pool.query('SELECT * FROM accounts WHERE id=$1', [session.account_id])).rows[0];
    if (!account || !(await passwordMatches(currentPassword, account))) {
      throw publicError('CREDENZIALI_NON_VALIDE', 401);
    }
    const next = await hashPassword(newPassword);
    await withTransaction(async (client) => {
      await client.query('UPDATE accounts SET password_salt=$2,password_hash=$3,updated_at=NOW() WHERE id=$1', [account.id, next.salt, next.passwordHash]);
      await client.query('UPDATE sessions SET revoked_at=NOW() WHERE account_id=$1 AND token_hash<>$2 AND revoked_at IS NULL', [account.id, session.token_hash]);
    });
    await securityEvent(account.id, 'PASSWORD_CHANGED');
    return sendJson(res, 200, { ok: true });
  }

"""
# Preserve the already validated error code spelling when generating the route.
password_route = password_route.replace('NUOVA_PASSWORD_NON_VALIDIDA', 'NUOVA_PASSWORD_NON_VALIDA')
if "url.pathname === '/api/auth/password')" not in source:
    if password_anchor not in source:
        raise RuntimeError('password route anchor missing')
    source = source.replace(password_anchor, password_route + password_anchor, 1)

old_kyc = """  if (req.method === 'POST' && url.pathname === '/api/identity/kyc/start') {
    const session = await authenticate(req); const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
    if (!account.emailVerified || !account.termsAccepted || !account.adultConfirmed) throw publicError('TERMINI_NON_ACCETTATI', 403);
    if (SUBSCRIPTIONS_ENFORCED && account.subscriptionStatus !== 'active') throw publicError('ABBONAMENTO_NON_ATTIVO', 402);
    const origin = APP_BASE_URL || `https://${req.headers.host}`;
    return sendJson(res, 200, await startKyc(session.account_id, origin));
  }
"""
new_kyc = """  if (req.method === 'POST' && url.pathname === '/api/identity/kyc/start') {
    enforceRate(req, 'kyc-start', 6, 60 * 60 * 1000);
    const session = await authenticate(req); const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
    if (!account.emailVerified || !account.termsAccepted || !account.privacyAcknowledged || !account.adultConfirmed) throw publicError('TERMINI_NON_ACCETTATI', 403);
    if (KYC_REQUIRES_SUBSCRIPTION && !['active', 'grace'].includes(account.subscriptionStatus)) throw publicError('ABBONAMENTO_NON_ATTIVO', 402);
    const origin = APP_BASE_URL || `https://${req.headers.host}`;
    return sendJson(res, 200, await startKyc(session.account_id, origin));
  }
"""
if old_kyc in source:
    source = source.replace(old_kyc, new_kyc, 1)
elif "enforceRate(req, 'kyc-start'" not in source:
    raise RuntimeError('KYC billing protection anchor missing')

if "await pool.query('BEGIN');" in source:
    raise RuntimeError('unsafe pool-level transaction remains')
if "DATABASE_URL.includes('localhost')" in source:
    raise RuntimeError('legacy implicit SSL selection remains')
for token in [
    'const KYC_REQUIRES_SUBSCRIPTION',
    "enforceRate(req, 'kyc-start'",
    "!['active', 'grace'].includes(account.subscriptionStatus)",
]:
    if token not in source:
        raise RuntimeError(f'KYC production safety token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Production PostgreSQL SSL, transaction, password, KYC billing and test safety applied')
