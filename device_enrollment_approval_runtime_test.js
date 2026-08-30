const fs = require('fs');

const source = fs.readFileSync('production_server.js', 'utf8');

function requireToken(token, label = token) {
  if (!source.includes(token)) {
    throw new Error(`Missing device enrollment contract: ${label}`);
  }
}

requireToken('CREATE TABLE IF NOT EXISTS device_enrollment_challenges');
requireToken('ALTER TABLE account_devices ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ');
requireToken('function deviceEnrollmentCopy(language)');
requireToken("url.pathname === '/device/approve'");
requireToken("crypto.randomBytes(32).toString('base64url')", '256-bit approval token');
requireToken('token_hash TEXT NOT NULL UNIQUE');
requireToken("NOW()+INTERVAL '15 minutes'", '15-minute expiry');
requireToken("'NUOVO_DISPOSITIVO_DA_CONFERMARE'");
requireToken("'DEVICE_ENROLLMENT_REQUESTED'");
requireToken("'DEVICE_ENROLLMENT_APPROVED'");
requireToken("enforceRate(req, 'new-device-enrollment', 4, 15 * 60 * 1000)");
requireToken("SELECT device_key_fingerprint FROM account_devices WHERE account_id=$1 AND device_key_fingerprint=$2 AND revoked_at IS NULL");
requireToken("UPDATE account_devices SET public_key_json=$3,last_seen_at=NOW() WHERE account_id=$1 AND device_key_fingerprint=$2 AND revoked_at IS NULL");
requireToken('revoked_at=NULL');
requireToken('const client = await pool.connect();', 'dedicated approval DB connection');
requireToken("await client.query('BEGIN');", 'atomic approval begin');
requireToken("await client.query('COMMIT');", 'atomic approval commit');
requireToken('client.release();', 'approval connection release');

for (const marker of [
  'Conferma nuovo dispositivo SIGILLUM',
  'Confirm new SIGILLUM device',
  'Confirma un nuevo dispositivo SIGILLUM',
  'Подтвердите новое устройство SIGILLUM',
]) {
  requireToken(marker, `localized copy: ${marker}`);
}

const loginStart = source.indexOf("if (req.method === 'POST' && url.pathname === '/api/auth/login')");
const loginEnd = source.indexOf("if (req.method === 'GET' && url.pathname === '/api/auth/session')", loginStart);
if (loginStart < 0 || loginEnd < 0) throw new Error('Login route boundaries missing');
const loginBlock = source.slice(loginStart, loginEnd);

if (!loginBlock.includes('if (!knownDevice)')) {
  throw new Error('Unknown-device branch is not fail-closed');
}
if (!loginBlock.includes('requestDeviceEnrollment(req, account, proof)')) {
  throw new Error('Unknown device does not request email approval');
}
if (loginBlock.indexOf('issueSession(account.id, proof.fingerprint)') < loginBlock.indexOf('if (!knownDevice)')) {
  throw new Error('Session can be issued before unknown-device approval check');
}

// Preserve the provenance binding invariant: a revoked device must no longer be
// accepted as the registered device for a new certificate.
requireToken('SELECT device_key_fingerprint,public_key_json FROM account_devices WHERE account_id=$1 AND device_key_fingerprint=$2 AND revoked_at IS NULL');
requireToken("'CERTIFICATE_BINDING_REJECTED'");

console.log('Device enrollment approval runtime contract: OK');
