'use strict';

const SUPPORTED_LANGUAGES = ['it', 'en', 'es', 'ru'];

function normalizePublicVerifyLanguage(value) {
  const code = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.includes(code) ? code : 'en';
}

const COPY = {
  it: {
    verifiedTitle: 'Certificato SIGILLUM verificato',
    validHeading: 'Autenticità crittografica del certificato verificata',
    notFoundTitle: 'Certificato non trovato',
    notFoundBody: 'Questo HCV-ID non è presente nel Registry.',
    invalidTitle: 'Certificato non valido',
    invalidBody: 'Il record esiste, ma la firma o la catena HCV non risultano valide.',
    id: 'HCV-ID',
    type: 'Tipo',
    signature: 'Firma',
    verifiedBody: 'Il Registry ha verificato la firma crittografica e la catena del certificato HCV.',
    scopeHeading: 'Cosa attesta questa pagina',
    scopeBody: 'Questa pagina conferma l’autenticità crittografica del certificato registrato. Non verifica da sola che un file esterno sia identico all’originale certificato o compatibile con i fingerprint del contenuto. Per verificare un file, aprilo in SIGILLUM e confrontalo con il certificato.',
  },
  en: {
    verifiedTitle: 'SIGILLUM certificate verified',
    validHeading: 'Certificate cryptographic authenticity verified',
    notFoundTitle: 'Certificate not found',
    notFoundBody: 'This HCV-ID is not present in the Registry.',
    invalidTitle: 'Invalid certificate',
    invalidBody: 'The record exists, but the HCV signature or chain is not valid.',
    id: 'HCV-ID',
    type: 'Type',
    signature: 'Signature',
    verifiedBody: 'The Registry verified the cryptographic signature and HCV certificate chain.',
    scopeHeading: 'What this page establishes',
    scopeBody: 'This page confirms the cryptographic authenticity of the registered certificate. By itself, it does not verify that an external media file is byte-identical to the certified original or compatible with the content fingerprints. To verify a file, open it in SIGILLUM and compare it with the certificate.',
  },
  es: {
    verifiedTitle: 'Certificado SIGILLUM verificado',
    validHeading: 'Autenticidad criptográfica del certificado verificada',
    notFoundTitle: 'Certificado no encontrado',
    notFoundBody: 'Este HCV-ID no está presente en Registry.',
    invalidTitle: 'Certificado no válido',
    invalidBody: 'El registro existe, pero la firma o la cadena HCV no son válidas.',
    id: 'HCV-ID',
    type: 'Tipo',
    signature: 'Firma',
    verifiedBody: 'Registry ha verificado la firma criptográfica y la cadena del certificado HCV.',
    scopeHeading: 'Qué acredita esta página',
    scopeBody: 'Esta página confirma la autenticidad criptográfica del certificado registrado. Por sí sola no verifica que un archivo externo sea idéntico byte por byte al original certificado ni compatible con las huellas del contenido. Para verificar un archivo, ábrelo en SIGILLUM y compáralo con el certificado.',
  },
  ru: {
    verifiedTitle: 'Сертификат SIGILLUM подтверждён',
    validHeading: 'Криптографическая подлинность сертификата подтверждена',
    notFoundTitle: 'Сертификат не найден',
    notFoundBody: 'Этот HCV-ID отсутствует в Registry.',
    invalidTitle: 'Недействительный сертификат',
    invalidBody: 'Запись существует, но подпись или цепочка HCV недействительны.',
    id: 'HCV-ID',
    type: 'Тип',
    signature: 'Подпись',
    verifiedBody: 'Registry проверил криптографическую подпись и цепочку HCV-сертификата.',
    scopeHeading: 'Что подтверждает эта страница',
    scopeBody: 'Эта страница подтверждает криптографическую подлинность зарегистрированного сертификата. Сама по себе она не подтверждает, что внешний медиафайл побайтно идентичен сертифицированному оригиналу или совместим с отпечатками контента. Для проверки файла откройте его в SIGILLUM и сопоставьте с сертификатом.',
  },
};

function publicVerifyCopy(language) {
  return COPY[normalizePublicVerifyLanguage(language)];
}

module.exports = {
  SUPPORTED_LANGUAGES,
  normalizePublicVerifyLanguage,
  publicVerifyCopy,
};
