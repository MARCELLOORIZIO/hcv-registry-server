from pathlib import Path
import re

path = Path('production_server.js')
source = path.read_text(encoding='utf-8')

start_pattern = re.compile(
    r"async function startKyc\(accountId, origin\) \{.*?\n\}\n\nasync function refreshKyc",
    re.S,
)
start_replacement = r'''async function startKyc(accountId, origin) {
  const existing = (await pool.query('SELECT * FROM identities WHERE account_id=$1', [accountId])).rows[0];
  if (existing?.provider_session_id) {
    const current = await stripeRequest(
      `/v1/identity/verification_sessions/${encodeURIComponent(existing.provider_session_id)}?expand[]=last_verification_report`,
    );
    const currentStatus = current.status || existing.status || 'unknown';
    await pool.query(
      'UPDATE identities SET status=$2,updated_at=NOW() WHERE account_id=$1',
      [accountId, currentStatus],
    );
    if (['requires_input', 'processing', 'verified'].includes(currentStatus)) {
      return {
        ok: true,
        provider: 'stripe_identity',
        sessionId: existing.provider_session_id,
        url: currentStatus === 'requires_input' ? (current.url || '') : '',
        status: currentStatus,
        verificationLivemode: current.livemode === true,
        reused: true,
      };
    }
  }

  const returnUrl = process.env.SIGILLUM_KYC_RETURN_URL || `${origin}/kyc-return`;
  const params = new URLSearchParams();
  params.append('type', 'document');
  params.append('options[document][require_live_capture]', 'true');
  params.append('options[document][require_matching_selfie]', 'true');
  params.append('metadata[accountId]', accountId);
  params.append('return_url', returnUrl);
  const decoded = await stripeRequest('/v1/identity/verification_sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(),
  });
  await pool.query(`
    INSERT INTO identities(account_id,provider,provider_session_id,status,updated_at)
    VALUES($1,'stripe_identity',$2,$3,NOW())
    ON CONFLICT(account_id) DO UPDATE SET provider_session_id=EXCLUDED.provider_session_id,status=EXCLUDED.status,verified_legal_name='',verified_country='',verified_at=NULL,updated_at=NOW()
  `, [accountId, decoded.id, decoded.status || 'created']);
  return {
    ok: true,
    provider: 'stripe_identity',
    sessionId: decoded.id,
    url: decoded.url || '',
    status: decoded.status || 'created',
    verificationLivemode: decoded.livemode === true,
    reused: false,
  };
}

async function refreshKyc'''
source, start_count = start_pattern.subn(start_replacement, source, count=1)
if start_count != 1 and 'verificationLivemode: current.livemode === true' not in source:
    raise RuntimeError('startKyc session reuse anchor missing')

refresh_pattern = re.compile(
    r"async function refreshKyc\(accountId\) \{.*?\n\}\n\nfunction legalShell",
    re.S,
)
refresh_replacement = r'''async function refreshKyc(accountId) {
  const identity = (await pool.query('SELECT * FROM identities WHERE account_id=$1', [accountId])).rows[0];
  if (!identity?.provider_session_id) {
    return {
      ok: true,
      status: 'not_started',
      verified: false,
      url: '',
      verificationLivemode: false,
    };
  }
  const decoded = await stripeRequest(
    `/v1/identity/verification_sessions/${encodeURIComponent(identity.provider_session_id)}?expand[]=last_verification_report`,
  );
  const report = decoded.last_verification_report || {};
  const doc = report.document || {};
  const rawFirstName = doc.first_name || doc.name?.first_name || '';
  const rawLastName = doc.last_name || doc.name?.last_name || '';
  const rawLegalName = [rawFirstName, rawLastName].filter(Boolean).join(' ').trim();
  const rawCountry = doc.address?.country || '';
  const livemode = decoded.livemode === true;
  const legalName = livemode ? rawLegalName : '';
  const country = livemode ? rawCountry : '';
  const verified = decoded.status === 'verified';
  await pool.query(
    `UPDATE identities
     SET status=$2,
         verified_legal_name=$3,
         verified_country=$4,
         verified_at=CASE WHEN $5 THEN COALESCE(verified_at,NOW()) ELSE NULL END,
         updated_at=NOW()
     WHERE account_id=$1`,
    [accountId, decoded.status || 'unknown', legalName, country, verified],
  );
  return {
    ok: true,
    provider: 'stripe_identity',
    sessionId: identity.provider_session_id,
    status: decoded.status || 'unknown',
    url: decoded.status === 'requires_input' ? (decoded.url || '') : '',
    verified,
    verificationLivemode: livemode,
    verifiedOutputs: livemode ? { legalName, country } : null,
    lastError: decoded.last_error || null,
  };
}

function legalShell'''
source, refresh_count = refresh_pattern.subn(refresh_replacement, source, count=1)
if refresh_count != 1 and 'verifiedOutputs: livemode ? { legalName, country } : null' not in source:
    raise RuntimeError('refreshKyc live/test output anchor missing')

required = [
    "['requires_input', 'processing', 'verified'].includes(currentStatus)",
    'verificationLivemode: current.livemode === true',
    "const livemode = decoded.livemode === true;",
    "const legalName = livemode ? rawLegalName : '';",
    'verifiedOutputs: livemode ? { legalName, country } : null',
]
for token in required:
    if token not in source:
        raise RuntimeError(f'KYC session safety token missing: {token}')

path.write_text(source, encoding='utf-8')
print('Stripe Identity session reuse and test-output safety applied')
