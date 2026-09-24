'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { authenticateRegistrySession } = require('./registry_certificate_security');
const { verifyManifestAttestation } = require('./trusted_derivation_v1');
const { requireActiveViewEntitlement } = require('./verified_originals_entitlement');
const { getVerifiedPlatformReceipt } = require('./verified_originals_platform_receipts');
const {
  HCV_ID, SHA256, CONSENT_VERSION, parseObject, hashText,
  registryEligibility, creatorOwns, platformReference, trustedDerivation,
  sanitizeAuditMetadata, publicPublication,
} = require('./verified_originals_v2_policy');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'registry.db'));
db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS verified_originals_consents (
  record_id TEXT PRIMARY KEY,
  hcv_id TEXT NOT NULL,
  account_subject_hash TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  session_device_fingerprint TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  publication_consent INTEGER NOT NULL CHECK(publication_consent IN (0,1)),
  monetization_consent INTEGER NOT NULL CHECK(monetization_consent IN (0,1)),
  rights_confirmed INTEGER NOT NULL CHECK(rights_confirmed IN (0,1)),
  state TEXT NOT NULL CHECK(state IN ('ACTIVE','WITHDRAWN')),
  consented_at TEXT NOT NULL,
  withdrawn_at TEXT
);
CREATE INDEX IF NOT EXISTS verified_originals_consents_hcv_idx
  ON verified_originals_consents(hcv_id, consented_at);

CREATE TABLE IF NOT EXISTS verified_originals_publications (
  publication_id TEXT PRIMARY KEY,
  hcv_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_post_id TEXT NOT NULL,
  public_url TEXT NOT NULL,
  reference_sha256 TEXT NOT NULL,
  original_content_sha256 TEXT NOT NULL,
  derived_from TEXT NOT NULL,
  derivation_type TEXT NOT NULL,
  derivation_manifest_sha256 TEXT NOT NULL,
  platform_receipt_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  publication_status TEXT NOT NULL
    CHECK(publication_status IN ('PUBLISHED','REVOKED','UNAVAILABLE')),
  consent_record_id TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  monetization_consent INTEGER NOT NULL CHECK(monetization_consent IN (0,1)),
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL,
  revoked_at TEXT,
  unavailable_at TEXT,
  audit_metadata_raw TEXT NOT NULL DEFAULT '{}',
  UNIQUE(platform, platform_post_id)
);
CREATE INDEX IF NOT EXISTS verified_originals_publications_hcv_idx
  ON verified_originals_publications(hcv_id, published_at);
CREATE INDEX IF NOT EXISTS verified_originals_publications_active_idx
  ON verified_originals_publications(hcv_id, publication_status);

CREATE TABLE IF NOT EXISTS verified_originals_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hcv_id TEXT NOT NULL,
  publication_id TEXT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_subject_hash TEXT NOT NULL,
  metadata_raw TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS verified_originals_audit_hcv_idx
  ON verified_originals_audit(hcv_id, id);
`);

const publicationColumns = new Set(
  db.prepare('PRAGMA table_info(verified_originals_publications)').all()
    .map(row => row.name),
);
if (!publicationColumns.has('platform_receipt_id')) {
  db.exec('ALTER TABLE verified_originals_publications ADD COLUMN platform_receipt_id TEXT');
}

const certificate = db.prepare('SELECT * FROM certificates WHERE hcv_id = ?');
const provenance = db.prepare('SELECT * FROM registry_provenance WHERE hcv_id = ?');
const latestStatus = db.prepare(
  'SELECT status FROM certificate_status_events WHERE hcv_id = ? ORDER BY id DESC LIMIT 1'
);
const latestConsent = db.prepare(
  'SELECT * FROM verified_originals_consents WHERE hcv_id = ? ORDER BY consented_at DESC, rowid DESC LIMIT 1'
);
const consentById = db.prepare(
  'SELECT * FROM verified_originals_consents WHERE record_id = ?'
);
const insertConsent = db.prepare(`
INSERT INTO verified_originals_consents
(record_id,hcv_id,account_subject_hash,creator_id,session_device_fingerprint,
 consent_version,publication_consent,monetization_consent,rights_confirmed,
 state,consented_at,withdrawn_at)
VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',?,NULL)
`);
const withdrawConsent = db.prepare(
  "UPDATE verified_originals_consents SET state='WITHDRAWN',withdrawn_at=? WHERE record_id=? AND state='ACTIVE'"
);
const publicationById = db.prepare(
  'SELECT * FROM verified_originals_publications WHERE publication_id = ?'
);
const publicationsForHcv = db.prepare(
  'SELECT * FROM verified_originals_publications WHERE hcv_id = ? ORDER BY published_at DESC, rowid DESC'
);
const activePublication = db.prepare(
  "SELECT * FROM verified_originals_publications WHERE hcv_id = ? AND publication_status='PUBLISHED' ORDER BY published_at DESC, rowid DESC LIMIT 1"
);
const insertPublication = db.prepare(`
INSERT INTO verified_originals_publications
(publication_id,hcv_id,platform,platform_post_id,public_url,reference_sha256,
 original_content_sha256,derived_from,derivation_type,derivation_manifest_sha256,
 platform_receipt_id,created_at,publication_status,consent_record_id,consent_version,
 monetization_consent,published_by,published_at,revoked_at,unavailable_at,
 audit_metadata_raw)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'PUBLISHED',?,?,?,?,?,NULL,NULL,?)
`);
const setPublicationState = db.prepare(`
UPDATE verified_originals_publications
SET publication_status=?,
    revoked_at=CASE WHEN ?='REVOKED' THEN ? ELSE revoked_at END,
    unavailable_at=CASE WHEN ?='UNAVAILABLE' THEN ? ELSE unavailable_at END
WHERE publication_id=? AND publication_status='PUBLISHED'
`);
const revokePublishedForConsent = db.prepare(`
UPDATE verified_originals_publications
SET publication_status='REVOKED', revoked_at=?
WHERE hcv_id=? AND consent_record_id=? AND publication_status='PUBLISHED'
`);
const insertAudit = db.prepare(`
INSERT INTO verified_originals_audit
(hcv_id,publication_id,event_type,actor_type,actor_subject_hash,metadata_raw,created_at)
VALUES (?,?,?,?,?,?,?)
`);
const auditForHcv = db.prepare(
  'SELECT id,hcv_id,publication_id,event_type,actor_type,metadata_raw,created_at FROM verified_originals_audit WHERE hcv_id=? ORDER BY id DESC LIMIT 200'
);

function send(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function fail(code, statusCode = 400) {
  const error = new Error(code);
  error.statusCode = statusCode;
  throw error;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

async function readJson(req, maxBytes = 16384) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) fail('PAYLOAD_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (_) { fail('INVALID_JSON', 400); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_JSON', 400);
  }
  return value;
}

function eligibility(hcvId) {
  if (!HCV_ID.test(hcvId || '')) return null;
  return registryEligibility(
    certificate.get(hcvId), provenance.get(hcvId), latestStatus.get(hcvId),
  );
}

function ownerSession(req, hcvId) {
  const e = eligibility(hcvId);
  if (!e) fail('CERTIFICATE_NOT_ACTIVE_VERIFIED', 403);
  const session = authenticateRegistrySession(db, req.headers.authorization, new Date());
  if (!creatorOwns(e, session)) fail('CREATOR_OWNERSHIP_NOT_VERIFIED', 403);
  return {e, session};
}

function adminAuthorized(req) {
  const expected = String(process.env.SIGILLUM_VERIFIED_ORIGINALS_ADMIN_TOKEN || '');
  const givenHeader = String(req.headers.authorization || '');
  if (expected.length < 32 || !givenHeader.startsWith('Bearer ')) return false;
  const given = givenHeader.slice(7);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function adminSubject() {
  const id = String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1');
  return hashText(id);
}

function audit({hcvId, publicationId = null, eventType, actorType,
  actorSubjectHash, metadata = {}, at = new Date().toISOString()}) {
  insertAudit.run(
    hcvId, publicationId, eventType, actorType, actorSubjectHash,
    JSON.stringify(sanitizeAuditMetadata(metadata)), at,
  );
}

function publicRow(row, e) {
  if (!row || !e) return null;
  const consent = consentById.get(row.consent_record_id);
  const receipt = getVerifiedPlatformReceipt({
    hcvId: row.hcv_id,
    platform: row.platform,
    platformPostId: row.platform_post_id,
    expectedSha256: row.reference_sha256,
  });
  return publicPublication(row, e, consent, receipt);
}

function publicActiveReference(hcvId) {
  const e = eligibility(hcvId);
  if (!e) return null;
  return publicRow(activePublication.get(hcvId), e);
}

function publicAvailability(hcvId) {
  const reference = publicActiveReference(hcvId);
  if (!reference) {
    return {
      hcvId,
      availability: 'REFERENCE_NOT_AVAILABLE',
      socialFileVerdict: 'NOT_VERIFIED',
    };
  }
  return {
    hcvId,
    availability: 'REFERENCE_AVAILABLE',
    publicationStatus: 'PUBLISHED',
    platform: reference.platform,
    certificateVerdict: reference.certificateVerdict,
    socialFileVerdict: 'NOT_VERIFIED',
    viewAccess: 'SUBSCRIPTION_REQUIRED',
  };
}

function publicHistory(hcvId) {
  const e = eligibility(hcvId);
  if (!e) return [];
  return publicationsForHcv.all(hcvId).map((row) => ({
    publicationId: row.publication_id,
    hcvId: row.hcv_id,
    platform: row.platform,
    publicationStatus: row.publication_status,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    revokedAt: row.revoked_at,
    unavailableAt: row.unavailable_at,
    viewAccess: row.publication_status === 'PUBLISHED'
      ? 'SUBSCRIPTION_REQUIRED'
      : 'UNAVAILABLE',
    socialFileVerdict: 'NOT_VERIFIED',
  }));
}

function pinnedDerivationKeys() {
  try {
    const raw = String(process.env.SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON || '');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const result = {};
    for (const [keyId, pem] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9._-]{3,80}$/.test(keyId) ||
          typeof pem !== 'string' || !pem) {
        return null;
      }
      const key = crypto.createPublicKey(pem);
      if (key.asymmetricKeyType !== 'rsa' ||
          key.asymmetricKeyDetails?.modulusLength < 2048) {
        return null;
      }
      result[keyId] = pem;
    }
    return Object.keys(result).length ? result : null;
  } catch (_) {
    return null;
  }
}

function trustedRow(hcvId, outputSha256, parentHash) {
  if (!SHA256.test(outputSha256 || '')) return null;
  let row;
  try {
    row = db.prepare(
      'SELECT output_sha256,hcv_id,manifest_raw,registered_at FROM trusted_derivations WHERE output_sha256=? AND hcv_id=?'
    ).get(outputSha256, hcvId);
  } catch (_) {
    return null;
  }
  if (!row) return null;
  const manifest = trustedDerivation(
    row.manifest_raw, hcvId, outputSha256, parentHash,
  );
  if (!manifest) return null;

  const certificateRow = certificate.get(hcvId);
  const trustedKeys = pinnedDerivationKeys();
  if (!certificateRow || !trustedKeys ||
      !verifyManifestAttestation({
        manifest,
        certificateRaw: certificateRow.certificate_raw,
        trustedKeys,
      })) {
    return null;
  }
  return {row, manifest};
}

function referencePage(hcvId, reference) {
  const availability = reference
    ? '<p><strong>ORIGINALE CERTIFICATO DISPONIBILE</strong></p>' +
      '<p>La visualizzazione richiede un abbonamento SIGILLUM attivo e avviene dall’app.</p>'
    : '<p>Nessun originale certificato è attualmente disponibile.</p>';
  const state = reference ? 'CONTENUTO CERTIFICATO DISPONIBILE' : 'RIFERIMENTO NON DISPONIBILE';
  return '<!doctype html><html lang="it"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>SIGILLUM Verified Originals</title>' +
    '<main style="max-width:720px;margin:40px auto;font:17px/1.5 sans-serif">' +
    '<h1>' + escapeHtml(state) + '</h1><p>HCV-ID: ' + escapeHtml(hcvId) + '</p>' +
    availability +
    '<p><a href="/verify/' + escapeHtml(hcvId) + '">VERIFICA CODICE E CERTIFICATO</a></p>' +
    '<p>La presenza di un riferimento non dimostra che un file visto su un altro social sia identico. ' +
    'Un HCV-ID può essere copiato. La coincidenza esatta richiede una prova crittografica sui byte verificati.</p>' +
    '</main></html>';
}

function registerPublicationRecord({
  hcvId,
  consentRecordId,
  trustedDerivativeSha256,
  platform,
  platformPostId,
  monetizationEnabled,
  auditMetadata = {},
}) {
  const normalizedHcvId = String(hcvId || '').toUpperCase();
  if (!HCV_ID.test(normalizedHcvId)) fail('INVALID_HCV_ID', 400);
  const e = eligibility(normalizedHcvId);
  if (!e) fail('CERTIFICATE_NOT_ACTIVE_VERIFIED', 403);

  const consent = consentById.get(String(consentRecordId || ''));
  if (!consent || consent.hcv_id !== normalizedHcvId ||
      consent.state !== 'ACTIVE' ||
      consent.publication_consent !== 1 ||
      consent.rights_confirmed !== 1) {
    fail('ACTIVE_CREATOR_CONSENT_REQUIRED', 403);
  }
  if (monetizationEnabled !== true && monetizationEnabled !== false) {
    fail('MONETIZATION_STATE_REQUIRED', 400);
  }
  if (monetizationEnabled && consent.monetization_consent !== 1) {
    fail('MONETIZATION_NOT_AUTHORIZED', 403);
  }

  const trusted = trustedRow(
    normalizedHcvId, String(trustedDerivativeSha256 || ''), e.originalHash,
  );
  if (!trusted) fail('TRUSTED_DERIVATION_REQUIRED', 422);

  const ref = platformReference(
    String(platform || ''), String(platformPostId || ''),
  );
  if (!ref) fail('PLATFORM_REFERENCE_INVALID_OR_UNSUPPORTED', 400);

  const platformReceipt = getVerifiedPlatformReceipt({
    hcvId: normalizedHcvId,
    platform: ref.platform,
    platformPostId: ref.platformPostId,
    expectedSha256: trusted.manifest.output.sha256,
  });
  if (!platformReceipt) fail('PLATFORM_UPLOAD_RECEIPT_REQUIRED', 422);

  const now = new Date().toISOString();
  const publicationId = crypto.randomUUID();
  const manifestRaw = JSON.stringify(trusted.manifest);
  const manifestSha = hashText(manifestRaw);
  const publisher =
    String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1');
  const metadata = sanitizeAuditMetadata(auditMetadata);

  try {
    db.transaction(() => {
      insertPublication.run(
        publicationId, normalizedHcvId, ref.platform, ref.platformPostId,
        ref.publicUrl, trusted.manifest.output.sha256, e.originalHash,
        e.originalHash, trusted.manifest.transform.operation, manifestSha,
        platformReceipt.receipt_id, trusted.manifest.createdAt,
        consent.record_id, consent.consent_version,
        monetizationEnabled ? 1 : 0, publisher, now,
        JSON.stringify(metadata),
      );
      audit({
        hcvId: normalizedHcvId,
        publicationId,
        eventType: 'PUBLICATION_REGISTERED',
        actorType: 'SIGILLUM_PUBLISHER',
        actorSubjectHash: adminSubject(),
        metadata,
        at: now,
      });
    })();
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error))) {
      fail('PLATFORM_POST_ALREADY_REGISTERED', 409);
    }
    throw error;
  }

  return {
    ok: true,
    publicationId,
    hcvId: normalizedHcvId,
    platform: ref.platform,
    publicUrl: ref.publicUrl,
    publicationStatus: 'PUBLISHED',
    originalContentSha256: e.originalHash,
    referenceSha256: trusted.manifest.output.sha256,
    derivedFrom: e.originalHash,
    derivationType: trusted.manifest.transform.operation,
    socialFileVerdict: 'NOT_VERIFIED',
  };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  const compat = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
  const active = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/active$/.exec(url.pathname);
  const view = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/view$/.exec(url.pathname);
  const list = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/publications$/.exec(url.pathname);
  const consentStatus = /^\/api\/verified-originals\/consents\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
  const consentWithdraw = /^\/api\/verified-originals\/consents\/(HCV-[A-F0-9]{16})\/withdraw$/.exec(url.pathname);
  const auditRoute = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/audit$/.exec(url.pathname);
  const stateRoute = /^\/api\/verified-originals\/publications\/([0-9a-f-]{36})\/status$/i.exec(url.pathname);
  const page = /^\/originals\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);

  if (req.method === 'GET' && compat) {
    send(res, 200, publicAvailability(compat[1]));
    return true;
  }

  if (req.method === 'GET' && active) {
    send(res, 200, publicAvailability(active[1]));
    return true;
  }

  if (req.method === 'GET' && view) {
    await requireActiveViewEntitlement(req.headers.authorization);
    const ref = publicActiveReference(view[1]);
    if (!ref) fail('REFERENCE_NOT_AVAILABLE', 404);
    send(res, 200, {
      hcvId: view[1],
      availability: 'REFERENCE_AVAILABLE',
      access: 'ENTITLED',
      ...ref,
    });
    return true;
  }

  if (req.method === 'GET' && list) {
    send(res, 200, {hcvId: list[1], publications: publicHistory(list[1])});
    return true;
  }

  if (req.method === 'GET' && page) {
    const ref = publicActiveReference(page[1]);
    sendHtml(res, ref ? 200 : 404, referencePage(page[1], ref));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/verified-originals/consents') {
    const payload = await readJson(req);
    const hcvId = String(payload.hcvId || '').toUpperCase();
    if (!HCV_ID.test(hcvId)) fail('INVALID_HCV_ID', 400);
    const {e, session} = ownerSession(req, hcvId);
    if (payload.intent !== 'PUBLISH_VERIFIED_ORIGINAL' ||
        payload.publishReference !== true) {
      fail('EXPLICIT_PUBLICATION_CONSENT_REQUIRED', 400);
    }
    if (payload.rightsConfirmed !== true) fail('RIGHTS_NOT_CONFIRMED', 400);
    if (payload.monetizationConsent !== true &&
        payload.monetizationConsent !== false) {
      fail('MONETIZATION_CONSENT_REQUIRED', 400);
    }
    const prior = latestConsent.get(hcvId);
    if (prior?.state === 'ACTIVE') fail('ACTIVE_CONSENT_ALREADY_EXISTS', 409);
    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const accountHash = hashText(session.accountId);
    insertConsent.run(
      recordId, hcvId, accountHash, session.creatorId,
      String(session.deviceKeyFingerprint || ''), CONSENT_VERSION, 1,
      payload.monetizationConsent ? 1 : 0, 1, now,
    );
    audit({
      hcvId, eventType:'CREATOR_CONSENT_GRANTED', actorType:'CREATOR',
      actorSubjectHash:accountHash,
      metadata:{note:'Explicit publication consent recorded; no platform upload performed.'},
      at:now,
    });
    send(res, 201, {
      ok:true, hcvId, recordId, consentVersion:CONSENT_VERSION,
      publicationConsent:true,
      monetizationConsent:payload.monetizationConsent,
      originalContentSha256:e.originalHash,
      publicationStatus:'NOT_PUBLISHED',
    });
    return true;
  }

  if (req.method === 'GET' && consentStatus) {
    const hcvId = consentStatus[1];
    const {session} = ownerSession(req, hcvId);
    const row = latestConsent.get(hcvId);
    const accountHash = hashText(session.accountId);
    if (!row || row.account_subject_hash !== accountHash) {
      send(res, 200, {hcvId, consentState:'NONE'});
      return true;
    }
    send(res, 200, {
      hcvId, consentState:row.state, recordId:row.record_id,
      consentVersion:row.consent_version,
      publicationConsent:row.publication_consent === 1,
      monetizationConsent:row.monetization_consent === 1,
      consentedAt:row.consented_at, withdrawnAt:row.withdrawn_at,
    });
    return true;
  }

  if (req.method === 'POST' && consentWithdraw) {
    const hcvId = consentWithdraw[1];
    const {session} = ownerSession(req, hcvId);
    const row = latestConsent.get(hcvId);
    const accountHash = hashText(session.accountId);
    if (!row || row.state !== 'ACTIVE' || row.account_subject_hash !== accountHash) {
      fail('ACTIVE_CONSENT_NOT_FOUND', 404);
    }
    const now = new Date().toISOString();
    db.transaction(() => {
      withdrawConsent.run(now, row.record_id);
      revokePublishedForConsent.run(now, hcvId, row.record_id);
      audit({
        hcvId, eventType:'CREATOR_CONSENT_WITHDRAWN', actorType:'CREATOR',
        actorSubjectHash:accountHash,
        metadata:{platformStatus:'TAKEDOWN_PENDING',
          note:'Registry reference hidden immediately; platform takedown requires publisher action.'},
        at:now,
      });
    })();
    send(res, 200, {
      ok:true, hcvId, consentState:'WITHDRAWN',
      referenceAvailable:false, platformTakedown:'PENDING',
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/verified-originals/publications') {
    if (!adminAuthorized(req)) fail('PUBLISHER_NOT_AUTHORIZED', 403);
    const payload = await readJson(req);
    const result = registerPublicationRecord({
      hcvId: payload.hcvId,
      consentRecordId: payload.consentRecordId,
      trustedDerivativeSha256: payload.trustedDerivativeSha256,
      platform: payload.platform,
      platformPostId: payload.platformPostId,
      monetizationEnabled: payload.monetizationEnabled,
      auditMetadata: payload.auditMetadata,
    });
    send(res, 201, result);
    return true;
  }

  if (req.method === 'POST' && stateRoute) {
    if (!adminAuthorized(req)) fail('PUBLISHER_NOT_AUTHORIZED', 403);
    const row = publicationById.get(stateRoute[1]);
    if (!row) fail('PUBLICATION_NOT_FOUND', 404);
    const payload = await readJson(req);
    const next = String(payload.publicationStatus || '').toUpperCase();
    if (next !== 'REVOKED' && next !== 'UNAVAILABLE') {
      fail('PUBLICATION_STATUS_INVALID', 400);
    }
    const now = new Date().toISOString();
    const changed = setPublicationState.run(
      next, next, now, next, now, row.publication_id,
    );
    if (changed.changes !== 1) fail('PUBLICATION_NOT_ACTIVE', 409);
    audit({
      hcvId:row.hcv_id, publicationId:row.publication_id,
      eventType:'PUBLICATION_' + next, actorType:'SIGILLUM_PUBLISHER',
      actorSubjectHash:adminSubject(), metadata:payload.auditMetadata, at:now,
    });
    send(res, 200, {
      ok:true, publicationId:row.publication_id, hcvId:row.hcv_id,
      publicationStatus:next, referenceAvailable:false,
    });
    return true;
  }

  if (req.method === 'GET' && auditRoute) {
    const hcvId = auditRoute[1];
    ownerSession(req, hcvId);
    const events = auditForHcv.all(hcvId).map((row) => ({
      id:row.id, hcvId:row.hcv_id, publicationId:row.publication_id,
      eventType:row.event_type, actorType:row.actor_type,
      metadata:parseObject(row.metadata_raw) || {}, createdAt:row.created_at,
    }));
    send(res, 200, {hcvId, events});
    return true;
  }

  return false;
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function verifiedOriginalsV2CreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer((req, res) => {
    Promise.resolve(handle(req, res)).then((handled) => {
      if (!handled) return listener(req, res);
    }).catch((error) => {
      send(res, error.statusCode || 500, {
        ok:false,
        error:error.statusCode ? error.message : 'VERIFIED_ORIGINALS_UNAVAILABLE',
      });
    });
  });
};

module.exports = {
  handle, publicActiveReference, publicAvailability, publicHistory, registerPublicationRecord,
};
