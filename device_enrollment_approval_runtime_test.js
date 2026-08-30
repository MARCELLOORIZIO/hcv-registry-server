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
requireToken("req.method === 'GET' && url.pathname === '/device/approve'");
requireToken("req.method === 'POST' && url.pathname === '/device/approve'");
requireToken('method="post"', 'explicit confirmation form');
requireToken("crypto.randomBytes(32).toString('base64url')", '256-bit approval token');
requireToken('token_hash TEXT NOT NULL UNIQUE');
requireToken("NOW()+INTERVAL '15 minutes'", '15-minute expiry');
requireToken("'NUOVO_DISPOSITIVO_DA_CONFERMARE'");
requireToken("'DEVICE_ENROLLMENT_REQUESTED'");
requireToken("'DEVICE_ENROLLMENT_APPROVED'");
requireToken('enforceRate(req, `new-device-enrollment:${account.id}`, 4, 15 * 60 * 1000)', 'account-scoped enrollment rate limit');
requireToken("SELECT device_key_fingerprint FROM account_devices WHERE account_id=$1 AND device_key_fingerprint=$2 AND revoked_at IS NULL");
requireToken("UPDATE account_devices SET public_key_json=$3,last_seen_at=NOW() WHERE account_id=$1 AND device_key_fingerprint=$2 AND revoked_at IS NULL");
requireToken('revoked_at=NULL');
requireToken('const client = await pool.connect();', 'dedicated approval DB connection');
requireToken("await client.query('BEGIN');", 'atomic approval begin');
requireToken("await client.query('COMMIT');", 'atomic approval commit');
requireToken('FOR UPDATE OF c', 'single-use row lock');
requireToken('client.release();', 'approval connection release');

for (const marker of [
  'Conferma nuovo dispositivo SIGILLUM',
  'Confirm new SIGILLUM device',
  'Confirma un nuevo dispositivo SIGILLUM',
  'Подтвердите новое устройство SIGILLUM',
]) {
  requireToken(marker, `localized copy: ${marker}`);
}

const getStart = source.indexOf("if (req.method === 'GET' && url.pathname === '/device/approve')");
const postStart = source.indexOf("if (req.method === 'POST' && url.pathname === '/device/approve')", getStart);
const loginStart = source.indexOf("if (req.method === 'POST' && url.pathname === '/api/auth/login')", postStart);
const loginEnd = source.indexOf("if (req.method === 'GET' && url.pathname === '/api/auth/session')", loginStart);
if (getStart < 0 || postStart < 0 || loginStart < 0 || loginEnd < 0) {
  throw new Error('Device approval/login route boundaries missing');
}

const getBlock = source.slice(getStart, postStart);
const postBlock = source.slice(postStart, loginStart);
const loginBlock = source.slice(loginStart, loginEnd);

// GET must only render the confirmation page. Email security scanners commonly
// prefetch links, so enrollment/consumption on GET would silently defeat 2FA.
for (const forbidden of [
  'INSERT INTO account_devices',
  'DELETE FROM device_enrollment_challenges WHERE token_hash=$1',
  'DEVICE_ENROLLMENT_APPROVED',
]) {
  if (getBlock.includes(forbidden)) {
    throw new Error(`GET approval route mutates security state: ${forbidden}`);
  }
}
if (!getBlock.includes("deviceApprovalPage(copy, 'confirm'")) {
  throw new Error('GET route does not require an explicit confirmation page');
}

// POST must lock and consume exactly the stored challenge before enrollment.
if (!postBlock.includes('FOR UPDATE OF c')) {
  throw new Error('POST approval route does not lock the challenge row');
}
if (!postBlock.includes('INSERT INTO account_devices')) {
  throw new Error('POST approval route does not enroll the approved device');
}
if (!postBlock.includes('DELETE FROM device_enrollment_challenges WHERE token_hash=$1')) {
  throw new Error('POST approval route does not consume the token');
}

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

if (source.includes('AND revoked_at IS NULL AND revoked_at IS NULL')) {
  throw new Error('Device revocation predicate duplicated by lifecycle patches');
}

console.log('Device enrollment approval runtime contract: OK');
