const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 8080;

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', chunk => {
      data += chunk;

      if (data.length > 10_000_000) {
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

    // HEALTH
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'hcv-registry-sqlite',
      });
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
      <title>HCV Verification ${hcvId}</title>
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
          <div class="badge">✓</div>
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