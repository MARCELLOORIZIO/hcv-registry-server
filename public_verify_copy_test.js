'use strict';

const assert = require('assert');
const {
  SUPPORTED_LANGUAGES,
  normalizePublicVerifyLanguage,
  publicVerifyCopy,
} = require('./public_verify_copy');

assert.deepStrictEqual(SUPPORTED_LANGUAGES, ['it', 'en', 'es', 'ru']);
assert.strictEqual(normalizePublicVerifyLanguage('es-ES'), 'es');
assert.strictEqual(normalizePublicVerifyLanguage('ru_RU'), 'ru');
assert.strictEqual(normalizePublicVerifyLanguage('fr-FR'), 'en');

for (const lang of SUPPORTED_LANGUAGES) {
  const copy = publicVerifyCopy(lang);
  for (const key of [
    'verifiedTitle', 'validHeading', 'notFoundTitle', 'notFoundBody',
    'invalidTitle', 'invalidBody', 'id', 'type', 'signature',
    'verifiedBody', 'scopeHeading', 'scopeBody',
  ]) {
    assert.ok(copy[key] && copy[key].length > 2, `${lang}:${key}`);
  }
  assert.ok(!copy.verifiedTitle.includes('HUMAN VERIFIED'));
  assert.ok(copy.scopeBody.toLowerCase().includes(lang === 'ru' ? 'файл' : lang === 'es' ? 'archivo' : lang === 'it' ? 'file' : 'file'));
}

console.log('Public certificate verification copy: PASS');
