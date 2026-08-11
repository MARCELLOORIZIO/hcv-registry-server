from pathlib import Path

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

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

if "await pool.query('BEGIN');" in source:
    raise RuntimeError('unsafe pool-level transaction remains')

path.write_text(source, encoding='utf-8')
print('Production PostgreSQL transaction and idempotency safety applied')
