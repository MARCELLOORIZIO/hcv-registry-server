const fs = require('fs');

const source = fs.readFileSync('production_server.js', 'utf8');

function requireToken(token, label = token) {
  if (!source.includes(token)) {
    throw new Error(`Missing profile-language contract: ${label}`);
  }
}

requireToken("req.method === 'POST' && url.pathname === '/api/auth/profile'", 'profile route');
requireToken("body.languageCode == null ? null : normalizeLanguage(body.languageCode)", 'validated optional language');
requireToken('preferred_language=COALESCE($3,preferred_language)', 'preferred-language persistence');
requireToken("'PROFILE_UPDATED'", 'profile audit event');
requireToken('preferredLanguage: account.preferred_language || \'en\'', 'account envelope language');

const profileStart = source.indexOf("if (req.method === 'POST' && url.pathname === '/api/auth/profile')");
const nextRoute = source.indexOf("if (req.method ===", profileStart + 20);
if (profileStart < 0 || nextRoute < 0) {
  throw new Error('Profile route boundaries missing');
}
const profileBlock = source.slice(profileStart, nextRoute);

if (!profileBlock.includes('normalizeLanguage(body.languageCode)')) {
  throw new Error('Profile route does not normalize supplied language');
}
if (!profileBlock.includes('COALESCE($3,preferred_language)')) {
  throw new Error('Legacy clients without languageCode would overwrite preferred language');
}
if (!profileBlock.includes('accountEnvelope(session.account_id, session.device_key_fingerprint)')) {
  throw new Error('Updated profile response does not return refreshed account envelope');
}

for (const language of ['it', 'en', 'es', 'ru']) {
  requireToken(`${language}: {`, `device enrollment copy ${language}`);
}

console.log('Profile language synchronization runtime contract: OK');
