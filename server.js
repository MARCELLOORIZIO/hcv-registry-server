const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 8080;
const OPENAI_MODEL = process.env.SIGILLUM_AI_MODEL || 'gpt-4o-mini';

const dbPath = process.env.DB_PATH || path.join(__dirname, 'registry.db');

const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS certificates (
    hcv_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    certificate_raw TEXT NOT NULL
);
`);

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(html);
}

function pageShell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} - SIGILLUM HCV</title><style>body{margin:0;background:#071511;color:#f4f1e8;font-family:Arial,Helvetica,sans-serif;line-height:1.55}a{color:#76ded3}.page{max-width:920px;margin:0 auto;padding:32px 20px 56px}.top{display:flex;justify-content:space-between;gap:18px;align-items:center;border-bottom:1px solid rgba(244,241,232,.16);padding-bottom:18px;margin-bottom:28px}.brand{font-size:24px;font-weight:800;letter-spacing:.08em}.nav{display:flex;flex-wrap:wrap;gap:12px;font-size:14px}.nav a{text-decoration:none}.hero{background:#10201b;border:1px solid rgba(118,222,211,.22);border-radius:8px;padding:24px;margin-bottom:22px}h1{margin:0 0 12px;font-size:34px;line-height:1.1}h2{margin-top:30px;color:#76ded3}h3{margin-top:22px}.muted{color:#c8d2cc}.card{background:#0f1b18;border:1px solid rgba(244,241,232,.12);border-radius:8px;padding:18px;margin:16px 0}li{margin:8px 0}.footer{margin-top:42px;padding-top:18px;border-top:1px solid rgba(244,241,232,.16);color:#aeb9b3;font-size:14px}@media(max-width:640px){.top{display:block}.nav{margin-top:12px}h1{font-size:28px}}</style></head><body><main class="page"><header class="top"><div class="brand">SIGILLUM HCV</div><nav class="nav"><a href="/">Home</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/support">Support</a><a href="/delete-data">Delete data</a></nav></header>${body}<footer class="footer">Temporary public pages for SIGILLUM HCV. Last updated: 3 July 2026.</footer></main></body></html>`;
}

function legalPage(pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return pageShell('SIGILLUM HCV', '<section class="hero"><h1>Technical proof for human-created content.</h1><p class="muted">SIGILLUM links photos, videos and text to an HCV-ID, technical creator identity, file fingerprint, signed certificate and online Registry record.</p></section><div class="card"><h2>Provenance</h2><p>Check whether content is linked to a SIGILLUM certificate and Registry record.</p></div><div class="card"><h2>Integrity</h2><p>Compare the verified file with the certified fingerprint and certificate data.</p></div><div class="card"><h2>Social verification</h2><p>Use the share menu from Photos, Messenger, Facebook or other apps to send a file to SIGILLUM for verification.</p></div><p class="muted">SIGILLUM provides technical evidence. It does not replace a legal, notarial or forensic expert report.</p>');
  }
  if (pathname === '/privacy') {
    return pageShell('Privacy Policy', '<section class="hero"><h1>Privacy Policy</h1><p class="muted">SIGILLUM minimizes server-side storage of original media and focuses on certificates, identifiers and verification data.</p></section><h2>Data processed</h2><ul><li>Content created or selected by the user, such as photos, videos, text, documents or HCVPACK files.</li><li>HCV-ID, cryptographic file hash, technical fingerprint, certificate data and verification status.</li><li>Technical metadata required to create or verify a certificate.</li><li>Technical creator identity data, such as device key fingerprint and user-declared creator name.</li><li>Future identity verification status if KYC is enabled through an external provider.</li></ul><h2>Original media</h2><p>In the intended production model, original photos, videos and text are stored on the user device and may be saved in the Photos library. The online Registry stores certificate and verification data such as HCV-ID, hashes, fingerprints, metadata and identity status.</p><h2>KYC and identity</h2><p>If identity verification is introduced, SIGILLUM should use a specialized provider. Identity documents and selfies should be processed by that provider where possible. SIGILLUM should store only verification status, provider reference and minimum technical data.</p><h2>Italiano</h2><p>SIGILLUM tratta contenuti creati o selezionati dall utente, HCV-ID, hash, fingerprint, certificati, metadati e identita tecnica. Foto e video originali restano sul dispositivo o nella libreria Foto, salvo funzioni esplicitamente richieste dall utente.</p>');
  }
  if (pathname === '/terms') {
    return pageShell('Terms of Service', '<section class="hero"><h1>Terms of Service</h1><p class="muted">SIGILLUM provides technical tools to create, sign and verify digital content.</p></section><h2>Scope</h2><p>SIGILLUM may help users create verifiable technical evidence for photos, videos, text and related packages.</p><h2>No absolute truth guarantee</h2><p>SIGILLUM does not prove the absolute truth of a scene and does not replace a legal, notarial or forensic expert report.</p><h2>User responsibility</h2><p>Users are responsible for the content they create, import, verify, publish or share. SIGILLUM must not be used for fraud, impersonation, unlawful content or misleading claims.</p><h2>Identity</h2><p>Until a formal KYC process is enabled, creator identity may include technical device identity and a user-declared name. A declared name is not the same as a legally verified identity.</p><h2>Italiano</h2><p>SIGILLUM fornisce strumenti tecnici di verifica, non una perizia legale. L utente resta responsabile dei contenuti creati, importati, verificati o condivisi.</p>');
  }
  if (pathname === '/support') {
    return pageShell('Support', '<section class="hero"><h1>Support</h1><p class="muted">Help for certification, verification and social sharing.</p></section><h2>Verify content from social apps</h2><ol><li>Open the photo or video in Photos, Facebook, Messenger, WhatsApp or another app.</li><li>Tap Share.</li><li>Choose SIGILLUM from the app list.</li><li>Open SIGILLUM manually if iOS does not open it automatically.</li></ol><h2>Contact</h2><p>Temporary support contact: <a href="mailto:marcelloorizio@yahoo.it">marcelloorizio@yahoo.it</a></p><h2>Italiano</h2><p>Per verificare un contenuto da social: apri il contenuto, tocca Condividi, scegli SIGILLUM e poi apri SIGILLUM se iOS non lo apre automaticamente.</p>');
  }
  if (pathname === '/kyc-return') {
    return pageShell(
      'KYC Return',
      '<section class="hero"><h1>Identity verification complete</h1><p class="muted">Returning to SIGILLUM.</p><p><a href="sigillum://kyc-return">Open SIGILLUM</a></p></section><script>setTimeout(function(){ window.location.href = "sigillum://kyc-return"; }, 300);</script><h2>Italiano</h2><p>La verifica identita e terminata. Se SIGILLUM non si apre automaticamente, tocca il link qui sopra.</p>'
    );
  }
  if (pathname === '/delete-data') {
    return pageShell('Data Deletion', '<section class="hero"><h1>Data Deletion</h1><p class="muted">How to request deletion or correction of SIGILLUM data.</p></section><h2>How to request deletion</h2><p>Send a request to <a href="mailto:marcelloorizio@yahoo.it">marcelloorizio@yahoo.it</a> with your HCV-ID, contact email and a description of the data concerned.</p><h2>Registry integrity</h2><p>Some Registry records may need to remain available to preserve certificate integrity, anti-fraud evidence and auditability. SIGILLUM may remove or minimize personal data while retaining technical certificate records needed for verification.</p><h2>KYC provider data</h2><p>If KYC is enabled, identity documents and biometric checks should be handled by the selected KYC provider. Deletion requests may need to be processed by SIGILLUM and by that provider.</p><h2>Italiano</h2><p>Per chiedere cancellazione o correzione dati, invia una richiesta con HCV-ID, email di contatto e descrizione dei dati interessati.</p>');
  }
  return null;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', chunk => {
      data += chunk;

      if (data.length > 35_000_000) {
        reject(new Error('Payload troppo grande'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function safeHcvId(id) {
  const cleaned = String(id || '').trim().toUpperCase();

  if (!/^HCV-[A-Z0-9_-]{4,64}$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

function validateCertificateRaw(raw, hcvId) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('certificateRaw mancante');
  }

  const cert = JSON.parse(raw);

  if (!cert || typeof cert !== 'object') {
    throw new Error('certificateRaw non valido');
  }

  const metaId = cert?.meta?.hcvId;

  if (metaId && safeHcvId(metaId) !== hcvId) {
    throw new Error('hcvId non coincide con certificate.meta.hcvId');
  }

  return cert;
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || '').toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeAiTrainerResponse(value, classes) {
  const suggestedLabel = classes.includes(value?.suggestedLabel)
    ? value.suggestedLabel
    : classes[0];

  const confidence = Number.isFinite(Number(value?.confidence))
    ? Math.max(0, Math.min(1, Number(value.confidence)))
    : 0;

  return {
    suggestedLabel,
    confidence,
    screenReplayRisk: normalizeEnum(
      value?.screenReplayRisk,
      ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'],
      'UNKNOWN'
    ),
    quality: normalizeEnum(
      value?.quality,
      ['GOOD_FOR_TRAINING', 'REVIEW', 'REJECT'],
      'REVIEW'
    ),
    reason:
      typeof value?.reason === 'string'
        ? value.reason.slice(0, 600)
        : 'Valutazione AI disponibile.',
    nextInstruction:
      typeof value?.nextInstruction === 'string'
        ? value.nextInstruction.slice(0, 600)
        : 'Raccogli altri campioni bilanciati tra schermo e realta.',
  };
}

function buildAiTrainerPrompt({ classes, userSelectedLabel, localProposal }) {
  return [
    'Analyze these SIGILLUM training sample images.',
    '',
    'Choose exactly one label from this list:',
    classes.join(', '),
    '',
    `User selected initial label: ${userSelectedLabel || 'UNKNOWN'}`,
    `Local TFLite proposal: ${JSON.stringify(localProposal || {})}`,
    '',
    'Definitions:',
    '- SCREEN_MONITOR: desktop/laptop/TV monitor showing content.',
    '- SCREEN_PHONE: phone screen showing content.',
    '- SCREEN_TABLET: tablet screen showing content.',
    '- REALITY_PAPER: real paper/document, not displayed on a screen.',
    '- REALITY_ROOM: real room/environment, not a screen.',
    '- REALITY_OBJECT: physical object, not a screen.',
    '- REALITY_OUTDOOR: outdoor real scene, not a screen.',
    '',
    'Return only strict JSON with exactly these keys:',
    '{',
    '  "suggestedLabel": "one class from the list",',
    '  "confidence": 0.0,',
    '  "screenReplayRisk": "LOW|MEDIUM|HIGH|UNKNOWN",',
    '  "quality": "GOOD_FOR_TRAINING|REVIEW|REJECT",',
    '  "reason": "short Italian explanation",',
    '  "nextInstruction": "short Italian instruction for what to collect next"',
    '}',
    '',
    'Prefer REVIEW when uncertain. Use REJECT for blurry, dark, duplicate, or ambiguous samples.',
  ].join('\n');
}

async function analyzeTrainingSample(payload) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('OPENAI_API_KEY_MISSING');
    error.statusCode = 500;
    throw error;
  }

  const classes = Array.isArray(payload.classes) ? payload.classes : [];
  const images = Array.isArray(payload.images) ? payload.images.slice(0, 5) : [];

  if (classes.length === 0) {
    const error = new Error('CLASSES_REQUIRED');
    error.statusCode = 400;
    throw error;
  }

  if (images.length === 0) {
    const error = new Error('IMAGES_REQUIRED');
    error.statusCode = 400;
    throw error;
  }

  const content = [
    {
      type: 'text',
      text: buildAiTrainerPrompt({
        classes,
        userSelectedLabel: payload.userSelectedLabel,
        localProposal: payload.localProposal,
      }),
    },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType || 'image/jpeg'};base64,${image.base64}`,
        detail: 'low',
      },
    })),
  ];

  const openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are SIGILLUM AI Trainer. Return only strict JSON. You classify training images for screen replay detection.',
        },
        {
          role: 'user',
          content,
        },
      ],
    }),
  });

  const text = await openAiResponse.text();
  if (!openAiResponse.ok) {
    const error = new Error(`OPENAI_HTTP_${openAiResponse.status}: ${text}`);
    error.statusCode = 502;
    throw error;
  }

  const decoded = JSON.parse(text);
  const contentText = decoded?.choices?.[0]?.message?.content;
  if (!contentText) {
    const error = new Error('EMPTY_OPENAI_RESPONSE');
    error.statusCode = 502;
    throw error;
  }

  return normalizeAiTrainerResponse(JSON.parse(contentText), classes);
}

async function createKycSession(payload, origin) {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error('KYC_NOT_CONFIGURED');
    error.statusCode = 501;
    throw error;
  }

  const creatorId = String(payload.creatorId || '').slice(0, 120);
  const creatorName = String(payload.creatorName || '').slice(0, 160);
  const returnUrl = process.env.SIGILLUM_KYC_RETURN_URL || `${origin}/kyc-return`;

  const params = new URLSearchParams();
  params.append('type', 'document');
  params.append('options[document][require_live_capture]', 'true');
  params.append('options[document][require_matching_selfie]', 'true');
  params.append('metadata[creatorId]', creatorId);
  params.append('metadata[creatorName]', creatorName);
  params.append('return_url', returnUrl);

  const stripeResponse = await fetch('https://api.stripe.com/v1/identity/verification_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const text = await stripeResponse.text();
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch (_) {
    decoded = { raw: text };
  }

  if (!stripeResponse.ok) {
    const error = new Error(decoded?.error?.message || `STRIPE_HTTP_${stripeResponse.status}`);
    error.statusCode = 502;
    throw error;
  }

  return {
    ok: true,
    provider: 'stripe_identity',
    sessionId: decoded.id,
    url: decoded.url,
    status: decoded.status,
  };
}
async function getKycSessionStatus(sessionId) {
  if (!process.env.STRIPE_SECRET_KEY) {
    const error = new Error('KYC_NOT_CONFIGURED');
    error.statusCode = 501;
    throw error;
  }

  const cleaned = String(sessionId || '').trim();
  if (!cleaned || !cleaned.startsWith('vs_')) {
    const error = new Error('INVALID_KYC_SESSION');
    error.statusCode = 400;
    throw error;
  }

  const stripeResponse = await fetch(
    `https://api.stripe.com/v1/identity/verification_sessions/${encodeURIComponent(cleaned)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      },
    },
  );

  const text = await stripeResponse.text();
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch (_) {
    decoded = { raw: text };
  }

  if (!stripeResponse.ok) {
    const error = new Error(decoded?.error?.message || `STRIPE_HTTP_${stripeResponse.status}`);
    error.statusCode = 502;
    throw error;
  }

  let verificationReport = null;
  if (decoded.last_verification_report) {
    const reportId = typeof decoded.last_verification_report === 'string'
      ? decoded.last_verification_report
      : decoded.last_verification_report?.id;

    if (reportId) {
      try {
        const reportResponse = await fetch(
          `https://api.stripe.com/v1/identity/verification_reports/${encodeURIComponent(reportId)}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            },
          },
        );
        const reportText = await reportResponse.text();
        if (reportResponse.ok) {
          verificationReport = JSON.parse(reportText);
        }
      } catch (_) {}
    }
  }

  const reportDocument = verificationReport?.document || {};
  const verifiedOutputs =
    decoded.verified_outputs ||
    reportDocument.verified_outputs ||
    {};
  const firstName =
    verifiedOutputs.first_name ||
    reportDocument.first_name ||
    reportDocument.name?.first_name ||
    '';
  const lastName =
    verifiedOutputs.last_name ||
    reportDocument.last_name ||
    reportDocument.name?.last_name ||
    '';
  const verifiedLegalName = [firstName, lastName]
    .filter((part) => part)
    .join(' ')
    .trim();
  const verifiedCountry =
    verifiedOutputs.address?.country ||
    reportDocument.address?.country ||
    '';

  return {
    ok: true,
    provider: 'stripe_identity',
    sessionId: decoded.id,
    status: decoded.status,
    url: decoded.url || '',
    lastError: decoded.last_error || null,
    verifiedOutputs: {
      legalName: verifiedLegalName,
      firstName,
      lastName,
      country: verifiedCountry,
    },
    verified: decoded.status === 'verified',
  };
}
const insertCertificate = db.prepare(`
INSERT OR REPLACE INTO certificates (
    hcv_id,
    created_at,
    certificate_raw
) VALUES (?, ?, ?)
`);

const getCertificate = db.prepare(`
SELECT *
FROM certificates
WHERE hcv_id = ?
`);

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    const staticLegalPage = legalPage(url.pathname);
    if (req.method === 'GET' && staticLegalPage) {
      return sendHtml(res, 200, staticLegalPage);
    }

    // KYC SESSION
    if (req.method === 'POST' && url.pathname === '/api/identity/kyc/start') {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      const origin = `${url.protocol}//${req.headers.host}`;

      try {
        const session = await createKycSession(payload, origin);
        return sendJson(res, 200, session);
      } catch (err) {
        return sendJson(res, err.statusCode || 500, {
          ok: false,
          error: err.message || String(err),
          message:
            err.message === 'KYC_NOT_CONFIGURED'
              ? 'KYC non ancora configurato sul server. Configura STRIPE_SECRET_KEY per attivare Stripe Identity.'
              : 'KYC non disponibile in questo momento.',
          supportUrl: '/support',
        });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/identity/kyc/status') {
      try {
        const session = await getKycSessionStatus(url.searchParams.get('sessionId'));
        return sendJson(res, 200, session);
      } catch (err) {
        return sendJson(res, err.statusCode || 500, {
          ok: false,
          error: err.message || String(err),
          message:
            err.message === 'KYC_NOT_CONFIGURED'
              ? 'KYC non ancora configurato sul server. Configura STRIPE_SECRET_KEY per attivare Stripe Identity.'
              : 'Stato KYC non disponibile in questo momento.',
        });
      }
    }
    // HEALTH
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'hcv-registry-sqlite',
        aiTrainer: true,
        aiModel: OPENAI_MODEL,
      });
    }

    // AI TRAINER
    if (req.method === 'POST' && url.pathname === '/sigillum/ai-trainer/analyze') {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');

      try {
        const analysis = await analyzeTrainingSample(payload);
        return sendJson(res, 200, analysis);
      } catch (err) {
        return sendJson(res, err.statusCode || 500, {
          ok: false,
          error: err.message || String(err),
        });
      }
    }

    // POST CERTIFICATE
    if (req.method === 'POST' && url.pathname === '/api/certificate') {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');

      const hcvId = safeHcvId(payload.hcvId);
      const certificateRaw = payload.certificateRaw;

      if (!hcvId || !certificateRaw) {
        return sendJson(res, 400, {
          ok: false,
          error: 'Servono hcvId e certificateRaw',
        });
      }

      try {
        validateCertificateRaw(certificateRaw, hcvId);
      } catch (err) {
        return sendJson(res, 400, {
          ok: false,
          error: err.message,
        });
      }

      insertCertificate.run(
        hcvId,
        new Date().toISOString(),
        certificateRaw
      );

      return sendJson(res, 201, {
        ok: true,
        hcvId,
        storage: 'sqlite',
        url: `/api/certificate/${hcvId}`,
      });
    }

    // PUBLIC VERIFY PAGE
    const verifyMatch = url.pathname.match(
      /^\/verify\/(HCV-[A-Za-z0-9_-]+)$/
    );

    if (req.method === 'GET' && verifyMatch) {
      const hcvId = safeHcvId(verifyMatch[1]);

      if (!hcvId) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<h1>Invalid HCV-ID</h1>');
      }

      const row = getCertificate.get(hcvId);

      if (!row) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<h1>Certificate not found</h1>');
      }

      let cert;

      try {
        cert = JSON.parse(row.certificate_raw);
      } catch (_) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<h1>Stored certificate is invalid</h1>');
      }

      const creator =
        cert?.meta?.identity?.creatorName ||
        cert?.meta?.identity?.name ||
        'Unknown creator';

      const createdAt =
        cert?.createdAt ||
        row.created_at ||
        'Unknown timestamp';

      const contentType =
        cert?.content?.type ||
        'unknown';

      const trustLevel =
        cert?.claims?.trustLevel ||
        cert?.claims?.trust ||
        cert?.meta?.trust ||
        'LOCAL_VERIFIED';

      const html = `
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>SIGILLUM Verification ${hcvId}</title>
      <style>
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #f8f5fb;
          color: #1f1f1f;
        }
        .wrap {
          max-width: 720px;
          margin: 40px auto;
          padding: 24px;
        }
        .card {
          background: white;
          border-radius: 24px;
          padding: 32px;
          box-shadow: 0 12px 40px rgba(0,0,0,.08);
          text-align: center;
        }
        .badge {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: #36b24a;
          color: white;
          font-size: 42px;
          line-height: 72px;
          margin: 0 auto 18px;
        }
        h1 {
          margin: 0;
          color: #209b38;
          font-size: 32px;
        }
        .sub {
          margin-top: 8px;
          color: #666;
        }
        .grid {
          margin-top: 30px;
          display: grid;
          gap: 14px;
          text-align: left;
        }
        .row {
          background: #fafafa;
          border: 1px solid #eee;
          border-radius: 14px;
          padding: 14px 16px;
        }
        .label {
          font-size: 12px;
          color: #777;
          text-transform: uppercase;
          letter-spacing: .06em;
        }
        .value {
          margin-top: 4px;
          font-size: 16px;
          word-break: break-word;
        }
        .footer {
          margin-top: 26px;
          font-size: 12px;
          color: #777;
        }
      </style>
    </head>
    <body>
      <main class="wrap">
        <section class="card">
          <div class="badge">OK</div>
          <h1>HUMAN VERIFIED</h1>
          <div class="sub">This media has an HCV registry certificate.</div>

          <div class="grid">
            <div class="row">
              <div class="label">HCV-ID</div>
              <div class="value">${hcvId}</div>
            </div>

            <div class="row">
              <div class="label">Creator</div>
              <div class="value">${creator}</div>
            </div>

            <div class="row">
              <div class="label">Created At</div>
              <div class="value">${createdAt}</div>
            </div>

            <div class="row">
              <div class="label">Content Type</div>
              <div class="value">${contentType}</div>
            </div>

            <div class="row">
              <div class="label">Trust</div>
              <div class="value">${trustLevel}</div>
            </div>

            <div class="row">
              <div class="label">Signature Algorithm</div>
              <div class="value">${cert.signatureAlgorithm || 'RSA-SHA256-HCV-V2'}</div>
            </div>
          </div>

          <div class="footer">
            SIGILLUM verifies provenance and integrity. Powered by HCV Protocol.
          </div>
        </section>
      </main>
    </body>
    </html>
    `;

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
      });

      return res.end(html);
    }

    // GET CERTIFICATE
    const match = url.pathname.match(
      /^\/api\/certificate\/(HCV-[A-Za-z0-9_-]+)$/
    );

    if (req.method === 'GET' && match) {
      const hcvId = safeHcvId(match[1]);

      if (!hcvId) {
        return sendJson(res, 400, {
          ok: false,
          error: 'HCV-ID non valido',
        });
      }

      const row = getCertificate.get(hcvId);

      if (!row) {
        return sendJson(res, 404, {
          ok: false,
          error: 'Certificato non trovato',
        });
      }

      return sendJson(res, 200, {
        ok: true,
        hcvId: row.hcv_id,
        createdAt: row.created_at,
        certificateRaw: row.certificate_raw,
      });
    }

    return sendJson(res, 404, {
      ok: false,
      error: 'Endpoint non trovato',
    });

  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: String(err.message || err),
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`HCV Registry SQLite listening on http://0.0.0.0:${PORT}`);
});
