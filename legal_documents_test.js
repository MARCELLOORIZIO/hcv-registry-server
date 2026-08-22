const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const {
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  legalDocument,
  legalPage,
  emailCopy,
} = require('./legal_documents');

const versions = { termsVersion: '2026-08-18', privacyVersion: '2026-08-18' };

assert.deepStrictEqual(SUPPORTED_LANGUAGES, ['it', 'en', 'es', 'ru']);
assert.strictEqual(normalizeLanguage('es-ES'), 'es');
assert.strictEqual(normalizeLanguage('ru_RU'), 'ru');
assert.strictEqual(normalizeLanguage('fr'), 'en');

for (const lang of SUPPORTED_LANGUAGES) {
  const terms = legalDocument('terms', lang, versions);
  const privacy = legalDocument('privacy', lang, versions);
  const support = legalDocument('support', lang, versions);
  const deletion = legalDocument('delete-data', lang, versions);

  assert.ok(terms.title.length > 5);
  assert.ok(terms.body.includes('2026-08-18'));
  assert.ok(terms.body.toLowerCase().includes('hcvpack'));
  assert.ok(privacy.title.length > 5);
  assert.ok(privacy.body.includes('2026-08-18'));
  assert.ok(support.body.includes('marcelloorizio@legalmail.it'));
  assert.ok(deletion.body.length > 200);

  const termsHash = crypto
    .createHash('sha256')
    .update(`${terms.title}\n${terms.body}`, 'utf8')
    .digest('hex');
  assert.match(termsHash, /^[a-f0-9]{64}$/);

  for (const path of ['/terms', '/privacy', '/support', '/delete-data']) {
    const html = legalPage(path, lang, versions);
    assert.ok(html.includes(`<html lang="${lang}">`));
    assert.ok(html.includes(`?lang=${lang}`));
  }

  const mail = emailCopy('verify_email', lang, '123456', 15);
  assert.ok(mail.subject.length > 5);
  assert.ok(mail.html.includes('123456'));
}

// The precheck step patches production_server.js before this test executes.
// Ensure the additive legal/account migration is actually inside initSchema(),
// not accidentally inside withTransaction() or another later function.
const serverSource = fs.readFileSync('production_server.js', 'utf8');
const initStart = serverSource.indexOf('async function initSchema() {');
assert.ok(initStart >= 0, 'initSchema missing');
const withTransactionStart = serverSource.indexOf('\nasync function withTransaction', initStart);
const securityEventStart = serverSource.indexOf('\nasync function securityEvent', initStart);
const successorCandidates = [withTransactionStart, securityEventStart].filter((pos) => pos >= 0);
assert.ok(successorCandidates.length > 0, 'initSchema successor missing');
const initBoundary = Math.min(...successorCandidates);
const migrationToken = 'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS preferred_language';
const migrationPos = serverSource.indexOf(migrationToken);
assert.ok(migrationPos > initStart && migrationPos < initBoundary, 'legal migration must run inside initSchema');
assert.strictEqual(serverSource.split(migrationToken).length - 1, 1, 'legal migration must exist exactly once');
assert.ok(serverSource.includes('preferred_language,contract_language,terms_document_sha256,privacy_document_sha256,acceptance_method'), 'registration must persist legal acceptance evidence');

console.log('Multilingual legal documents: PASS');
