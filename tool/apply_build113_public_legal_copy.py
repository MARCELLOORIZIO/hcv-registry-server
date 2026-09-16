from pathlib import Path
import re

LEGAL = Path('legal_documents.js')
SERVER = Path('production_server.js')

legal = LEGAL.read_text(encoding='utf-8')
server = SERVER.read_text(encoding='utf-8')

# Legal document revision must change because registration stores the exact
# localized document hashes and version accepted by the user.
legal = legal.replace("versions.termsVersion || '2026-08-18'", "versions.termsVersion || '2026-09-16'")
legal = legal.replace("versions.privacyVersion || '2026-08-18'", "versions.privacyVersion || '2026-09-16'")
server = server.replace("process.env.TERMS_VERSION || '2026-08-18'", "process.env.TERMS_VERSION || '2026-09-16'")
server = server.replace("process.env.PRIVACY_VERSION || '2026-08-18'", "process.env.PRIVACY_VERSION || '2026-09-16'")

# Terms / scope: explain modern recompressed-copy fingerprints, including audio.
for old, new in [
    ('impronte crittografiche, certificati firmati', 'impronte crittografiche e, per le copie ricompresse, fingerprint percettivi di immagine, sequenza video e traccia audio quando disponibili, certificati firmati'),
    ('cryptographic fingerprints, signed certificates', 'cryptographic fingerprints and, for recompressed copies, perceptual image, video-sequence and audio-track fingerprints where available, signed certificates'),
    ('huellas criptográficas, certificados firmados', 'huellas criptográficas y, para copias recomprimidas, huellas perceptivas de imagen, secuencia de vídeo y pista de audio cuando estén disponibles, certificados firmados'),
    ('криптографических отпечатков, подписанных сертификатов', 'криптографических отпечатков и, для перекодированных копий, перцептивных отпечатков изображения, видеоряда и аудиодорожки, когда они доступны, подписанных сертификатов'),
]:
    if old not in legal:
        raise RuntimeError(f'legal scope anchor missing: {old}')
    legal = legal.replace(old, new)

# Privacy data categories: the current BUILD113 certificate can contain media
# fingerprints, including a separate audio fingerprint for modern video.
for old, new in [
    ('HCV-ID, certificati, hash, firme, metadati tecnici, segnali di cattura', 'HCV-ID, certificati, hash, firme, fingerprint percettivi del contenuto (immagine, sequenza video e, per i video moderni, traccia audio), metadati tecnici, segnali di cattura'),
    ('HCV-IDs, certificates, hashes, signatures, technical metadata, capture signals', 'HCV-IDs, certificates, hashes, signatures, perceptual content fingerprints (image, video sequence and, for modern videos, audio track), technical metadata, capture signals'),
    ('HCV-ID, certificados, hashes, firmas, metadatos técnicos, señales de captura', 'HCV-ID, certificados, hashes, firmas, huellas perceptivas del contenido (imagen, secuencia de vídeo y, para vídeos modernos, pista de audio), metadatos técnicos, señales de captura'),
    ('HCV-ID, сертификаты, хеши, подписи, технические метаданные, сигналы захвата', 'HCV-ID, сертификаты, хеши, подписи, перцептивные отпечатки контента (изображение, видеоряд и, для современных видео, аудиодорожка), технические метаданные, сигналы захвата'),
]:
    if old not in legal:
        raise RuntimeError(f'privacy fingerprint anchor missing: {old}')
    legal = legal.replace(old, new, 1)

# Add public certificate-page copy module to the runtime server.
import_anchor = "const { Pool } = require('pg');\n"
import_line = "const { Pool } = require('pg');\nconst { publicVerifyCopy, normalizePublicVerifyLanguage } = require('./public_verify_copy');\n"
if "require('./public_verify_copy')" not in server:
    if import_anchor not in server:
        raise RuntimeError('public verify import anchor missing')
    server = server.replace(import_anchor, import_line, 1)

# Replace the public verification page created by the provenance-v2 patch. The
# route keeps the provenance distinction and localizes it in IT/EN/ES/RU.
start = server.find("  const verifyMatch = url.pathname.match(/^\\/verify\\/(HCV-[A-Fa-f0-9]{16})$/);")
end_marker = "\n\n  return sendJson(res, 404, { ok: false, error: 'ENDPOINT_NOT_FOUND' });"
end = server.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError('public verify route boundary missing')

new_route = r'''  const verifyMatch = url.pathname.match(/^\/verify\/(HCV-[A-Fa-f0-9]{16})$/);
  if (req.method === 'GET' && verifyMatch) {
    const hcvId = safeHcvId(verifyMatch[1]);
    const lang = normalizePublicVerifyLanguage(url.searchParams.get('lang'));
    const copy = publicVerifyCopy(lang);
    const row = (await pool.query(`SELECT
      hcv_id,created_at,certificate_raw,certificate_sha256,
      account_subject_hash,device_key_fingerprint,creator_id,binding_version,
      content_sha256,identity_verified,registry_attested_at,provenance_version,
      registry_attestation_sha256
      FROM certificates WHERE hcv_id=$1`, [hcvId])).rows[0];
    if (!row) {
      return sendHtml(
        res,
        404,
        legalShell(copy.notFoundTitle, `<p>${copy.notFoundBody}</p>`, lang, url.pathname),
      );
    }
    let cert;
    try {
      cert = verifyCertificateRaw(row.certificate_raw, hcvId);
    } catch (_) {
      return sendHtml(
        res,
        422,
        legalShell(copy.invalidTitle, `<p>${copy.invalidBody}</p>`, lang, url.pathname),
      );
    }
    const type = String(cert?.content?.type || 'unknown')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
    const provenance = provenanceEnvelopeFromRow(row);
    const registryV2 = provenance.status === 'SIGILLUM_REGISTRY_VERIFIED'
      && provenance.integrityValid === true
      && provenance.identityVerified === true;
    const pageTitle = registryV2
      ? copy.registryVerifiedTitle
      : copy.integrityVerifiedTitle;
    const provenanceBody = registryV2
      ? copy.registryV2Body
      : copy.integrityOnlyBody;
    const registryValue = registryV2
      ? copy.registryV2Value
      : copy.registryIntegrityValue;
    const registryDetails = registryV2
      ? `<p><strong>${copy.identityVerified}:</strong> ${copy.yes}</p>`
        + `<p><strong>${copy.device}:</strong> …${String(provenance.deviceKeyFingerprint || '').slice(-12).toUpperCase()}</p>`
        + `<p><strong>${copy.registeredAt}:</strong> ${provenance.registeredAt || '-'}</p>`
      : '';
    const body = `<div class="card"><h2>${copy.validHeading}</h2>`
      + `<p><strong>${copy.id}:</strong> ${hcvId}</p>`
      + `<p><strong>${copy.type}:</strong> ${type}</p>`
      + `<p><strong>${copy.signature}:</strong> RSA-SHA256-HCV-V2</p>`
      + `<p><strong>${copy.registryLabel}:</strong> ${registryValue}</p>`
      + registryDetails
      + `<p>${provenanceBody}</p></div>`
      + `<div class="card"><h2>${copy.scopeHeading}</h2><p>${copy.scopeBody}</p></div>`;
    return sendHtml(res, 200, legalShell(pageTitle, body, lang, url.pathname));
  }'''
server = server[:start] + new_route + server[end:]

# Guard intended scope and ensure old overclaim is gone from the public route.
for token in [
    "require('./public_verify_copy')",
    "normalizePublicVerifyLanguage(url.searchParams.get('lang'))",
    "provenanceEnvelopeFromRow(row)",
    "copy.registryVerifiedTitle",
    "copy.integrityVerifiedTitle",
    "copy.scopeBody",
    "legalShell(pageTitle, body, lang, url.pathname)",
    "process.env.TERMS_VERSION || '2026-09-16'",
    "process.env.PRIVACY_VERSION || '2026-09-16'",
]:
    if token not in server:
        raise RuntimeError(f'BUILD113 public/legal token missing: {token}')

if "legalShell('HUMAN VERIFIED'" in server:
    raise RuntimeError('legacy HUMAN VERIFIED public page remains')
if 'fingerprint percettivi del contenuto' not in legal:
    raise RuntimeError('Italian privacy fingerprint update missing')
if 'audio track' not in legal:
    raise RuntimeError('English audio fingerprint legal update missing')

LEGAL.write_text(legal, encoding='utf-8')
SERVER.write_text(server, encoding='utf-8')
print('Applied BUILD113 public verification and legal copy update')
