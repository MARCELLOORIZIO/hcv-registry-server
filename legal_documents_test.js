const assert = require('assert');
const crypto = require('crypto');
const {
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  legalDocument,
  legalPage,
  emailCopy,
} = require('./legal_documents');

const versions = { termsVersion: '2026-10-04', privacyVersion: '2026-10-08' };

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
  assert.ok(terms.body.includes('2026-10-04'));
  assert.ok(terms.body.toLowerCase().includes('hcvpack'));
  assert.ok(!terms.body.includes('YouTube'));
  assert.ok(privacy.title.length > 5);
  assert.ok(privacy.body.includes('2026-10-08'));
  assert.ok(privacy.body.includes('Cloudflare R2'));
  assert.ok(privacy.body.includes('Stripe'));
  assert.ok(
    privacy.body.includes('processor') ||
    privacy.body.includes('responsabile del trattamento') ||
    privacy.body.includes('encargado del tratamiento') ||
    privacy.body.includes('обработчик данных'),
  );
  assert.ok(!privacy.body.includes('YouTube'));
  assert.ok(!privacy.body.includes('Google/YouTube'));
  assert.ok(
    terms.body.includes('14-bis') ||
    terms.body.includes('14-бис'),
  );
  assert.ok(support.body.includes('marcelloorizio@legalmail.it'));
  assert.ok(deletion.body.length > 200);

  const termsHash = crypto
    .createHash('sha256')
    .update(`${terms.title}\n${terms.body}`, 'utf8')
    .digest('hex');
  assert.match(termsHash, /^[a-f0-9]{64}$/);

  const home = legalPage('/', lang, versions);
  assert.ok(home.includes(`<html lang="${lang}">`));
  const translatedLabels = {
    it: ['Privacy', 'Termini', 'Supporto'],
    en: ['Privacy', 'Terms', 'Support'],
    es: ['Privacidad', 'Términos', 'Soporte'],
    ru: ['Конфиденциальность', 'Условия', 'Поддержка'],
  }[lang];
  for (const label of translatedLabels) assert.ok(home.includes(label));

  const productClaims = {
    it: ['Tu crei. SIGILLUM protegge l’origine.', 'iOS 16'],
    en: ['You create. SIGILLUM protects the origin.', 'iOS 16'],
    es: ['Tú creas. SIGILLUM protege el origen.', 'iOS 16'],
    ru: ['Вы создаёте. SIGILLUM защищает источник.', 'iOS 16'],
  }[lang];
  for (const claim of productClaims) assert.ok(home.includes(claim));

  for (const path of ['/terms', '/privacy', '/support', '/delete-data']) {
    const html = legalPage(path, lang, versions);
    assert.ok(html.includes(`<html lang="${lang}">`));
    assert.ok(html.includes(`?lang=${lang}`));
  }

  const mail = emailCopy('verify_email', lang, '123456', 15);
  assert.ok(mail.subject.length > 5);
  assert.ok(mail.html.includes('123456'));
}

console.log('Multilingual legal documents: PASS');
