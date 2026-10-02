'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const {
  createR2ReferenceProvider,
  opaqueObjectKey,
} = require('../primary_reference_provider');

function requiredEnv(key) {
  const value = String(process.env[key] || '').trim();
  if (!value) throw new Error('Missing required environment variable: ' + key);
  return value;
}

function parseArgs(argv) {
  const out = { mb: 8, jsonPath: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mb' && argv[i + 1]) out.mb = Number(argv[++i]);
    else if (argv[i] === '--json' && argv[i + 1]) out.jsonPath = argv[++i];
    else throw new Error('Unknown or incomplete argument: ' + argv[i]);
  }
  if (!Number.isInteger(out.mb) || out.mb < 6 || out.mb > 1024) {
    throw new Error('--mb must be an integer from 6 to 1024.');
  }
  return out;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function createDeterministicFile(filePath, bytes) {
  const handle = await fs.promises.open(filePath, 'w', 0o600);
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < chunk.length; i++) {
      chunk[i] = (i * 37 + 19) & 0xff;
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

async function fetchToFile(url, targetPath) {
  const response = await fetch(url, {
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok || !response.body) {
    throw new Error(
      'R2 encrypted authorization fetch failed: HTTP ' + response.status,
    );
  }
  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(targetPath, { flags: 'w', mode: 0o600 }),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requiredEnv('R2_ENDPOINT');
  requiredEnv('R2_BUCKET');
  requiredEnv('R2_ACCESS_KEY_ID');
  requiredEnv('R2_SECRET_ACCESS_KEY');

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'sigillum-r2-provider-acceptance-'),
  );
  const sourcePath = path.join(tempDir, 'source.bin');
  const materializedPath = path.join(tempDir, 'materialized.bin');
  const encryptedAuthorizedPath = path.join(tempDir, 'authorized.sgref');

  const master = crypto.randomBytes(32);
  const keyId = 'acceptance-' + Date.now();
  const env = {
    ...process.env,
    R2_REQUIRE_EU: 'true',
    R2_REFERENCE_ACTIVE_KEY_ID: keyId,
    R2_REFERENCE_MASTER_KEYS_JSON: JSON.stringify({
      [keyId]: master.toString('base64'),
    }),
    R2_REFERENCE_PART_SIZE_BYTES: String(5 * 1024 * 1024),
    R2_REFERENCE_QUEUE_SIZE: '2',
    R2_REFERENCE_READ_TTL_SECONDS: '60',
    SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES:
      String(Math.max(536870912, args.mb * 1024 * 1024 + 1024)),
  };

  const provider = createR2ReferenceProvider({ env });
  let receipt = null;
  const hcvId =
    'HCV-' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const objectId = crypto.randomUUID();
  const objectKey = opaqueObjectKey(objectId);

  const report = {
    version: 'SIGILLUM_R2_PRIMARY_PROVIDER_ACCEPTANCE_V1',
    providerFormat: 'SIGILLUM_R2_REFERENCE_V2',
    payloadMb: args.mb,
    euJurisdiction: false,
    opaqueObjectKey: false,
    multipartCommit: false,
    providerHead: false,
    exactMaterializationSha256: false,
    encryptedAuthorizationSha256: false,
    providerDelete: false,
    deletedObjectUnavailable: false,
    passed: false,
    startedAt: new Date().toISOString(),
  };

  try {
    await createDeterministicFile(
      sourcePath,
      args.mb * 1024 * 1024,
    );
    const referenceSha256 = await sha256File(sourcePath);
    const binding = {
      hcvId,
      referenceRole: 'ORIGINAL_REFERENCE',
      referenceSha256,
      originalContentSha256: referenceSha256,
      hcvpackSha256: crypto
        .createHash('sha256')
        .update('provider-acceptance-hcvpack')
        .digest('hex'),
      derivationManifestSha256: crypto
        .createHash('sha256')
        .update('provider-acceptance-manifest')
        .digest('hex'),
      mediaType: 'video',
      objectId,
    };

    report.euJurisdiction =
      provider.endpoint.hostname.endsWith('.eu.r2.cloudflarestorage.com');
    report.opaqueObjectKey =
      objectKey.startsWith('references/v1/') &&
      !objectKey.includes(hcvId);

    receipt = await provider.commitReference({
      sourcePath,
      ...binding,
      objectKey,
    });
    report.multipartCommit =
      receipt.provider === 'r2' &&
      receipt.objectId === objectId &&
      receipt.objectKey === objectKey &&
      receipt.encryptionFormat === 'SIGILLUM_R2_REFERENCE_V2' &&
      receipt.referenceSha256 === referenceSha256 &&
      receipt.ciphertextBytes > args.mb * 1024 * 1024;

    report.providerHead = await provider.referenceExists(receipt);

    await provider.materializeReference({
      receipt,
      destinationPath: materializedPath,
      binding,
    });
    report.exactMaterializationSha256 =
      (await sha256File(materializedPath)) === referenceSha256;

    const authorization =
      await provider.createEncryptedReadAuthorization(receipt);
    await fetchToFile(authorization.url, encryptedAuthorizedPath);
    report.encryptedAuthorizationSha256 =
      (await sha256File(encryptedAuthorizedPath)) ===
      receipt.ciphertextSha256;

    const deleted = await provider.deleteReference(receipt);
    report.providerDelete = deleted?.deleted === true;
    report.deletedObjectUnavailable =
      !(await provider.referenceExists(receipt));

    report.finishedAt = new Date().toISOString();
    report.passed =
      report.euJurisdiction &&
      report.opaqueObjectKey &&
      report.multipartCommit &&
      report.providerHead &&
      report.exactMaterializationSha256 &&
      report.encryptedAuthorizationSha256 &&
      report.providerDelete &&
      report.deletedObjectUnavailable;

    const rendered = JSON.stringify(report, null, 2);
    console.log(rendered);
    if (args.jsonPath) {
      await fs.promises.writeFile(
        args.jsonPath,
        rendered + '\n',
        'utf8',
      );
    }
    if (!report.passed) process.exitCode = 1;
  } finally {
    if (receipt) {
      await provider.deleteReference(receipt).catch(() => {});
    }
    provider.destroy();
    master.fill(0);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(
    'R2_PRIMARY_PROVIDER_ACCEPTANCE_FAILED:',
    error.message,
  );
  process.exitCode = 1;
});
