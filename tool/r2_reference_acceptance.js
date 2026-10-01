'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('SGR2REF1', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + NONCE_BYTES;
const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex');

function requiredEnv(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error('Missing required environment variable: ' + key);
  return value;
}

function normalizeEndpoint(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  const url = new URL(raw);
  if (url.protocol !== 'https:') {
    throw new Error('R2_ENDPOINT must use HTTPS.');
  }
  return url;
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, ch =>
    '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  );
}

function canonicalObjectPath(bucket, key) {
  return '/' + awsEncode(bucket) + '/' +
    String(key).split('/').map(awsEncode).join('/');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function signingKey(secret, date, region = 'auto', service = 's3') {
  const dateKey = hmac(Buffer.from('AWS4' + secret, 'utf8'), date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, 'aws4_request');
}

function amzDate(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function shortDate(amz) {
  return amz.slice(0, 8);
}

function signedHeaders({
  method,
  endpoint,
  bucket,
  key,
  accessKey,
  secretKey,
  payloadHash,
  now = new Date(),
}) {
  const stamp = amzDate(now);
  const date = shortDate(stamp);
  const canonicalUri = canonicalObjectPath(bucket, key);
  const canonicalHeaders =
    'host:' + endpoint.host + '\n' +
    'x-amz-content-sha256:' + payloadHash + '\n' +
    'x-amz-date:' + stamp + '\n';
  const signedHeaderNames = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaderNames,
    payloadHash,
  ].join('\n');
  const scope = date + '/auto/s3/aws4_request';
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const signature = crypto
    .createHmac('sha256', signingKey(secretKey, date))
    .update(stringToSign)
    .digest('hex');

  return {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
    authorization:
      'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + scope +
      ', SignedHeaders=' + signedHeaderNames +
      ', Signature=' + signature,
  };
}

function presignedGetUrl({
  endpoint,
  bucket,
  key,
  accessKey,
  secretKey,
  expiresSeconds = 60,
  now = new Date(),
}) {
  if (!Number.isInteger(expiresSeconds) ||
      expiresSeconds < 1 ||
      expiresSeconds > 604800) {
    throw new Error('Presigned URL expiry must be between 1 and 604800 seconds.');
  }
  const stamp = amzDate(now);
  const date = shortDate(stamp);
  const scope = date + '/auto/s3/aws4_request';
  const credential = accessKey + '/' + scope;
  const query = new URLSearchParams();
  query.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  query.set('X-Amz-Credential', credential);
  query.set('X-Amz-Date', stamp);
  query.set('X-Amz-Expires', String(expiresSeconds));
  query.set('X-Amz-SignedHeaders', 'host');

  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
    .map(([k, v]) => k + '=' + v)
    .join('&');
  const canonicalUri = canonicalObjectPath(bucket, key);
  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    'host:' + endpoint.host + '\n',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const signature = crypto
    .createHmac('sha256', signingKey(secretKey, date))
    .update(stringToSign)
    .digest('hex');
  query.set('X-Amz-Signature', signature);

  return endpoint.origin + canonicalUri + '?' + query.toString();
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function encryptFile(sourcePath, targetPath, key) {
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const output = fs.createWriteStream(targetPath, { flags: 'w' });
  output.write(MAGIC);
  output.write(nonce);
  await pipeline(fs.createReadStream(sourcePath), cipher, output, { end: false });
  output.write(cipher.getAuthTag());
  await new Promise((resolve, reject) => {
    output.once('error', reject);
    output.end(resolve);
  });
}

async function decryptFile(sourcePath, targetPath, key) {
  const stat = await fs.promises.stat(sourcePath);
  if (stat.size <= HEADER_BYTES + TAG_BYTES) {
    throw new Error('Encrypted R2 reference is too small.');
  }
  const handle = await fs.promises.open(sourcePath, 'r');
  let header;
  let tag;
  try {
    header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Encrypted R2 reference magic mismatch.');
  }
  const nonce = header.subarray(MAGIC.length);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  await pipeline(
    fs.createReadStream(sourcePath, {
      start: HEADER_BYTES,
      end: stat.size - TAG_BYTES - 1,
    }),
    decipher,
    fs.createWriteStream(targetPath, { flags: 'w' }),
  );
}

async function createDeterministicFile(filePath, bytes) {
  const handle = await fs.promises.open(filePath, 'w');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < chunk.length; i++) {
      chunk[i] = (i * 29 + 71) & 0xff;
    }
    let remaining = bytes;
    while (remaining > 0) {
      const length = Math.min(chunk.length, remaining);
      await handle.write(chunk, 0, length);
      remaining -= length;
    }
  } finally {
    await handle.close();
  }
}

function requestObject({
  endpoint,
  method,
  bucket,
  key,
  accessKey,
  secretKey,
  payloadHash,
  contentLength,
  sourcePath,
  destinationPath,
}) {
  const headers = signedHeaders({
    method,
    endpoint,
    bucket,
    key,
    accessKey,
    secretKey,
    payloadHash,
  });
  if (contentLength != null) {
    headers['content-length'] = String(contentLength);
  }
  if (method === 'PUT') headers['content-type'] = 'application/octet-stream';

  const url = new URL(endpoint.origin + canonicalObjectPath(bucket, key));
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, response => {
      const status = response.statusCode || 0;
      if (destinationPath && status >= 200 && status < 300) {
        const output = fs.createWriteStream(destinationPath, { flags: 'w' });
        response.pipe(output);
        output.once('error', reject);
        output.once('finish', () => {
          output.close();
          resolve({ status, headers: response.headers });
        });
        return;
      }

      const chunks = [];
      response.on('data', chunk => {
        if (chunks.reduce((n, item) => n + item.length, 0) < 16384) {
          chunks.push(Buffer.from(chunk));
        }
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status, headers: response.headers, body });
      });
    });
    req.once('error', reject);

    if (sourcePath) {
      const input = fs.createReadStream(sourcePath);
      input.once('error', reject);
      input.pipe(req);
    } else {
      req.end();
    }
  });
}

function safeS3Error(response) {
  const body = String(response?.body || '');
  const code = /<Code>([^<]{1,120})<\/Code>/i.exec(body)?.[1] || '';
  const message = /<Message>([^<]{1,300})<\/Message>/i.exec(body)?.[1] || '';
  const parts = [];
  if (code) parts.push(code);
  if (message) parts.push(message);
  return parts.length ? ' [' + parts.join(': ') + ']' : '';
}

async function putObject(args) {
  const payloadHash = await sha256File(args.sourcePath);
  const stat = await fs.promises.stat(args.sourcePath);
  const response = await requestObject({
    ...args,
    method: 'PUT',
    payloadHash,
    contentLength: stat.size,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error('R2 PUT failed: HTTP ' + response.status + safeS3Error(response));
  }
  return { ...response, payloadHash, size: stat.size };
}

async function getObject(args) {
  const response = await requestObject({
    ...args,
    method: 'GET',
    payloadHash: EMPTY_SHA256,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error('R2 GET failed: HTTP ' + response.status + safeS3Error(response));
  }
  return response;
}

async function headObject(args) {
  return requestObject({
    ...args,
    method: 'HEAD',
    payloadHash: EMPTY_SHA256,
  });
}

async function deleteObject(args) {
  const response = await requestObject({
    ...args,
    method: 'DELETE',
    payloadHash: EMPTY_SHA256,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error('R2 DELETE failed: HTTP ' + response.status + safeS3Error(response));
  }
  return response;
}

async function fetchPresigned(url, destinationPath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error('R2 presigned GET failed: HTTP ' + response.status);
  }
  const { Readable } = require('stream');
  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(destinationPath, { flags: 'w' }),
  );
}

function parseArgs(argv) {
  const out = { mb: 8, jsonPath: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mb' && argv[i + 1]) out.mb = Number(argv[++i]);
    else if (argv[i] === '--json' && argv[i + 1]) out.jsonPath = argv[++i];
    else throw new Error('Unknown or incomplete argument: ' + argv[i]);
  }
  if (!Number.isInteger(out.mb) || out.mb < 1 || out.mb > 1024) {
    throw new Error('--mb must be an integer from 1 to 1024.');
  }
  return out;
}

async function main(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const endpoint = normalizeEndpoint(requiredEnv(env, 'R2_ENDPOINT'));
  const bucket = requiredEnv(env, 'R2_BUCKET');
  const accessKey = requiredEnv(env, 'R2_ACCESS_KEY_ID');
  const secretKey = requiredEnv(env, 'R2_SECRET_ACCESS_KEY');

  const requireEu = String(env.R2_REQUIRE_EU || 'true').toLowerCase() !== 'false';
  if (requireEu && !endpoint.hostname.includes('.eu.r2.cloudflarestorage.com')) {
    throw new Error(
      'EU acceptance requires an R2 jurisdiction endpoint ending in .eu.r2.cloudflarestorage.com.',
    );
  }

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'sigillum-r2-acceptance-'),
  );
  const source = path.join(tempDir, 'reference-source.bin');
  const encrypted = path.join(tempDir, 'reference.sgref');
  const downloaded = path.join(tempDir, 'reference.downloaded.sgref');
  const decrypted = path.join(tempDir, 'reference.decrypted.bin');
  const presignedDownload = path.join(tempDir, 'reference.presigned.sgref');
  const key = crypto.randomBytes(32);
  const objectKey =
    'acceptance/' + new Date().toISOString().slice(0, 10) + '/' +
    crypto.randomUUID() + '.sgref';

  const report = {
    version: 'SIGILLUM_R2_REFERENCE_ACCEPTANCE_V1',
    startedAt: new Date().toISOString(),
    euJurisdictionEndpoint: endpoint.hostname.includes('.eu.r2.cloudflarestorage.com'),
    payloadMb: args.mb,
    put: false,
    head: false,
    encryptedRoundTripSha256: false,
    decryptRoundTripSha256: false,
    presignedGetSha256: false,
    delete: false,
    deletedObjectUnavailable: false,
    passed: false,
  };

  try {
    await createDeterministicFile(source, args.mb * 1024 * 1024);
    const sourceHash = await sha256File(source);
    await encryptFile(source, encrypted, key);
    const encryptedHash = await sha256File(encrypted);

    const put = await putObject({
      endpoint,
      bucket,
      key: objectKey,
      accessKey,
      secretKey,
      sourcePath: encrypted,
    });
    report.put = true;

    const head = await headObject({
      endpoint,
      bucket,
      key: objectKey,
      accessKey,
      secretKey,
    });
    if (head.status < 200 || head.status >= 300) {
      throw new Error('R2 HEAD failed: HTTP ' + head.status);
    }
    const remoteLength = Number(head.headers['content-length'] || -1);
    if (remoteLength !== put.size) {
      throw new Error('R2 HEAD content-length mismatch.');
    }
    report.head = true;

    await getObject({
      endpoint,
      bucket,
      key: objectKey,
      accessKey,
      secretKey,
      destinationPath: downloaded,
    });
    report.encryptedRoundTripSha256 =
      (await sha256File(downloaded)) === encryptedHash;
    if (!report.encryptedRoundTripSha256) {
      throw new Error('R2 encrypted SHA-256 round-trip mismatch.');
    }

    await decryptFile(downloaded, decrypted, key);
    report.decryptRoundTripSha256 =
      (await sha256File(decrypted)) === sourceHash;
    if (!report.decryptRoundTripSha256) {
      throw new Error('R2 plaintext SHA-256 after decrypt mismatch.');
    }

    const presigned = presignedGetUrl({
      endpoint,
      bucket,
      key: objectKey,
      accessKey,
      secretKey,
      expiresSeconds: 60,
    });
    await fetchPresigned(presigned, presignedDownload);
    report.presignedGetSha256 =
      (await sha256File(presignedDownload)) === encryptedHash;
    if (!report.presignedGetSha256) {
      throw new Error('R2 presigned GET SHA-256 mismatch.');
    }

    await deleteObject({
      endpoint,
      bucket,
      key: objectKey,
      accessKey,
      secretKey,
    });
    report.delete = true;

    const afterDelete = await headObject({
      endpoint,
      bucket,
      key: objectKey,
      accessKey,
      secretKey,
    });
    report.deletedObjectUnavailable = afterDelete.status === 404;
    if (!report.deletedObjectUnavailable) {
      throw new Error(
        'R2 deleted object still answered HEAD with HTTP ' + afterDelete.status,
      );
    }

    report.finishedAt = new Date().toISOString();
    report.passed =
      report.euJurisdictionEndpoint &&
      report.put &&
      report.head &&
      report.encryptedRoundTripSha256 &&
      report.decryptRoundTripSha256 &&
      report.presignedGetSha256 &&
      report.delete &&
      report.deletedObjectUnavailable;

    const rendered = JSON.stringify(report, null, 2);
    console.log(rendered);
    if (args.jsonPath) {
      await fs.promises.writeFile(args.jsonPath, rendered + '\n', 'utf8');
    }
    if (!report.passed) process.exitCode = 1;
    return report;
  } finally {
    key.fill(0);
    await deleteObject({
      endpoint,
      bucket,
      key: objectKey,
      accessKey,
      secretKey,
    }).catch(() => {});
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('R2_ACCEPTANCE_FAILED:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  MAGIC,
  awsEncode,
  canonicalObjectPath,
  decryptFile,
  encryptFile,
  normalizeEndpoint,
  parseArgs,
  presignedGetUrl,
  sha256File,
  signedHeaders,
};
