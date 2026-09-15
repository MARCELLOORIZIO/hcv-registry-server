'use strict';

const SUPPORTED_LANGUAGES = ['it', 'en', 'es', 'ru'];

function normalizePublicVerifyLanguage(value) {
  const code = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.includes(code) ? code : 'en';
}

const COPY = {
  it: {
    registryVerifiedTitle: 'Provenienza SIGILLUM Registry verificata',
    integrityVerifiedTitle: 'Integrità certificato HCV verificata',
    validHeading: 'Autenticità crittografica del certificato verificata',
    registryV2Body: 'Il Registry ha verificato firma, catena HCV, attestazione di provenienza Registry v2 e associazione a un’identità verificata.',
    integrityOnlyBody: 'Firma e catena HCV sono valide, ma l’attestazione completa di provenienza Registry v2 non risulta verificata.',
    registryLabel: 'Registry',
    registryV2Value: 'provenienza v2 verificata',
    registryIntegrityValue: 'integrità HCV verificata; provenienza v2 non verificata',
    identityVerified: 'Identità verificata',
    device: 'Dispositivo',
    registeredAt: 'Registrato',
    yes: 'sì',
    notFoundTitle: 'Certificato non trovato',
    notFoundBody: 'Questo HCV-ID non è presente nel Registry.',
    invalidTitle: 'Certificato non valido',
    invalidBody: 'Il record esiste, ma la firma o la catena HCV non risultano valide.',
    id: 'HCV-ID', type: 'Tipo', signature: 'Firma',
    scopeHeading: 'Cosa attesta questa pagina',
    scopeBody: 'Questa pagina verifica il certificato e, quando disponibile, la sua attestazione Registry. Non verifica da sola che un file esterno sia identico all’originale certificato o compatibile con i fingerprint del contenuto. Per verificare un file, aprilo in SIGILLUM e confrontalo con il certificato.',
  },
  en: {
    registryVerifiedTitle: 'SIGILLUM Registry provenance verified',
    integrityVerifiedTitle: 'HCV certificate integrity verified',
    validHeading: 'Certificate cryptographic authenticity verified',
    registryV2Body: 'The Registry verified the signature, HCV chain, Registry v2 provenance attestation, and binding to a verified identity.',
    integrityOnlyBody: 'The HCV signature and chain are valid, but the complete Registry v2 provenance attestation is not verified.',
    registryLabel: 'Registry',
    registryV2Value: 'v2 provenance verified',
    registryIntegrityValue: 'HCV integrity verified; v2 provenance not verified',
    identityVerified: 'Identity verified',
    device: 'Device',
    registeredAt: 'Registered',
    yes: 'yes',
    notFoundTitle: 'Certificate not found',
    notFoundBody: 'This HCV-ID is not present in the Registry.',
    invalidTitle: 'Invalid certificate',
    invalidBody: 'The record exists, but the HCV signature or chain is not valid.',
    id: 'HCV-ID', type: 'Type', signature: 'Signature',
    scopeHeading: 'What this page establishes',
    scopeBody: 'This page verifies the certificate and, when available, its Registry attestation. By itself, it does not verify that an external media file is byte-identical to the certified original or compatible with the content fingerprints. To verify a file, open it in SIGILLUM and compare it with the certificate.',
  },
  es: {
    registryVerifiedTitle: 'Procedencia SIGILLUM Registry verificada',
    integrityVerifiedTitle: 'Integridad del certificado HCV verificada',
    validHeading: 'Autenticidad criptográfica del certificado verificada',
    registryV2Body: 'Registry ha verificado la firma, la cadena HCV, la atestación de procedencia Registry v2 y el vínculo con una identidad verificada.',
    integrityOnlyBody: 'La firma y la cadena HCV son válidas, pero la atestación completa de procedencia Registry v2 no está verificada.',
    registryLabel: 'Registry',
    registryV2Value: 'procedencia v2 verificada',
    registryIntegrityValue: 'integridad HCV verificada; procedencia v2 no verificada',
    identityVerified: 'Identidad verificada',
    device: 'Dispositivo',
    registeredAt: 'Registrado',
    yes: 'sí',
    notFoundTitle: 'Certificado no encontrado',
    notFoundBody: 'Este HCV-ID no está presente en Registry.',
    invalidTitle: 'Certificado no válido',
    invalidBody: 'El registro existe, pero la firma o la cadena HCV no son válidas.',
    id: 'HCV-ID', type: 'Tipo', signature: 'Firma',
    scopeHeading: 'Qué acredita esta página',
    scopeBody: 'Esta página verifica el certificado y, cuando está disponible, su atestación Registry. Por sí sola no verifica que un archivo externo sea idéntico byte por byte al original certificado ni compatible con las huellas del contenido. Para verificar un archivo, ábrelo en SIGILLUM y compáralo con el certificado.',
  },
  ru: {
    registryVerifiedTitle: 'Происхождение SIGILLUM Registry подтверждено',
    integrityVerifiedTitle: 'Целостность HCV-сертификата подтверждена',
    validHeading: 'Криптографическая подлинность сертификата подтверждена',
    registryV2Body: 'Registry проверил подпись, цепочку HCV, аттестацию происхождения Registry v2 и привязку к подтверждённой личности.',
    integrityOnlyBody: 'Подпись и цепочка HCV действительны, но полная аттестация происхождения Registry v2 не подтверждена.',
    registryLabel: 'Registry',
    registryV2Value: 'происхождение v2 подтверждено',
    registryIntegrityValue: 'целостность HCV подтверждена; происхождение v2 не подтверждено',
    identityVerified: 'Личность подтверждена',
    device: 'Устройство',
    registeredAt: 'Зарегистрировано',
    yes: 'да',
    notFoundTitle: 'Сертификат не найден',
    notFoundBody: 'Этот HCV-ID отсутствует в Registry.',
    invalidTitle: 'Недействительный сертификат',
    invalidBody: 'Запись существует, но подпись или цепочка HCV недействительны.',
    id: 'HCV-ID', type: 'Тип', signature: 'Подпись',
    scopeHeading: 'Что подтверждает эта страница',
    scopeBody: 'Эта страница проверяет сертификат и, когда доступна, его аттестацию Registry. Сама по себе она не подтверждает, что внешний медиафайл побайтно идентичен сертифицированному оригиналу или совместим с отпечатками контента. Для проверки файла откройте его в SIGILLUM и сопоставьте с сертификатом.',
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
