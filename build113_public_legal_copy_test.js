'use strict';

const assert = require('assert');
const fs = require('fs');
const {
  SUPPORTED_LANGUAGES,
  legalDocument,
  legalPage,
} = require('./legal_documents');
const { publicVerifyCopy } = require('./public_verify_copy');

const versions = { termsVersion: '2026-09-16', privacyVersion: '2026-09-16' };
const audioNeedles = {
  it: ['traccia audio', 'fingerprint'],
  en: ['audio track', 'fingerprint'],
  es: ['pista de audio', 'huella'],
  ru: ['аудиодорож', 'отпечат'],
};

for (const lang of SUPPORTED_LANGUAGES) {
  const terms = legalDocument('terms', lang, versions);
  const privacy = legalDocument('privacy', lang, versions);
  const combined = `${terms.body}\n${privacy.body}`.toLowerCase();
  for (const needle of audioNeedles[lang]) {
    assert.ok(combined.includes(needle.toLowerCase()), `${lang} missing ${needle}`);
  }
  assert.ok(terms.body.includes('2026-09-16'));
  assert.ok(privacy.body.includes('2026-09-16'));
  const termsHtml = legalPage('/terms', lang, versions);
  const privacyHtml = legalPage('/privacy', lang, versions);
  assert.ok(termsHtml.includes(`<html lang="${lang}">`));
  assert.ok(privacyHtml.includes(`<html lang="${lang}">`));
  assert.ok(!publicVerifyCopy(lang).verifiedTitle.includes('HUMAN VERIFIED'));
  assert.ok(publicVerifyCopy(lang).scopeBody.length > 80);
}

const server = fs.readFileSync('production_server.js', 'utf8');
assert.ok(server.includes("normalizePublicVerifyLanguage(url.searchParams.get('lang'))"));
assert.ok(server.includes("legalShell(copy.verifiedTitle, body, lang, url.pathname)"));
assert.ok(!server.includes("legalShell('HUMAN VERIFIED'"));
assert.ok(server.includes("process.env.TERMS_VERSION || '2026-09-16'"));
assert.ok(server.includes("process.env.PRIVACY_VERSION || '2026-09-16'"));

console.log('BUILD113 public/legal copy gate: PASS');
