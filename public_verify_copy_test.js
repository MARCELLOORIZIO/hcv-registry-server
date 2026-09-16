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
    'registryVerifiedTitle', 'integrityVerifiedTitle', 'validHeading',
    'registryV2Body', 'integrityOnlyBody', 'registryLabel',
    'registryV2Value', 'registryIntegrityValue', 'identityVerified',
    'device', 'registeredAt', 'yes', 'notFoundTitle', 'notFoundBody',
    'invalidTitle', 'invalidBody', 'id', 'type', 'signature',
    'scopeHeading', 'scopeBody',
  ]) {
    assert.ok(copy[key] && copy[key].length > 1, `${lang}:${key}`);
  }
  assert.ok(!copy.registryVerifiedTitle.includes('HUMAN VERIFIED'));
  assert.ok(!copy.integrityVerifiedTitle.includes('HUMAN VERIFIED'));
  assert.ok(copy.scopeBody.toLowerCase().includes(lang === 'ru' ? 'файл' : lang === 'es' ? 'archivo' : 'file'));
}

console.log('Public certificate verification copy: PASS');
