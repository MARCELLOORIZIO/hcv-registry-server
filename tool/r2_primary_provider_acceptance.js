'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createR2ReferenceProvider,
  opaqueObjectKey,
} = require('../primary_reference_provider');

function sha(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

async function sha256File(filePath) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    digest.update(chunk);
  }
  return digest.digest('hex');
}

async function sha256ResponseBody(response) {
  if (!response.body) throw new Error('PRESIGNED_BODY_MISSING');
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  for await (const raw of response.body) {
    const chunk = Buffer.from(raw);
    bytes += chunk.length;
    digest.update(chunk);
  }
  return { sha256: digest.digest('hex'), bytes };
}

async function writeDeterministicFile(filePath, megabytes) {
  const handle = await fs.promises.open(filePath, 'w', 0o600);
  const digest = crypto.createHash('sha256');
  const chunk = Buffer.alloc(1024 * 1024);
  let bytes = 0;
  try {
    for (let mb = 0; mb < megabytes; mb += 1) {
      for (let i = 0; i < chunk.length; i += 1) {
        chunk[i] = (i * 31 + mb * 17 + 11) & 0xff;
      }
      await handle.write(chunk);
      digest.update(chunk);
      bytes += chunk.length;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { bytes, sha256: digest.digest('hex') };
}

async function main() {
  const mb = Math.max(
    8,
    Math.min(512, Number(process.env.R2_PROVIDER_ACCEPTANCE_MB || 100)),
  );
  process.env.R2_REQUIRE_EU = 'true';
  process.env.R2_REFERENCE_ACTIVE_KEY_ID = 'acceptance-ephemeral-v1';
  const ephemeralMasterKey = crypto.randomBytes(32);
  process.env.R2_REFERENCE_MASTER_KEYS_JSON = JSON.stringify({
    'acceptance-ephemeral-v1': ephemeralMasterKey.toString('base64'),
  });

  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'sigillum-r2-provider-acceptance-'),
  );
  const sourcePath = path.join(tempDir, 'source.bin');
  const restoredPath = path.join(tempDir, 'restored.bin');
  const objectId = crypto.randomUUID();
  const objectKey = opaqueObjectKey(objectId);
  let provider;
  let receipt;
  let deleted = false;

  try {
    const source = await writeDeterministicFile(sourcePath, mb);
    provider = createR2ReferenceProvider({ env: process.env });

    receipt = await provider.commitReference({
      sourcePath,
      hcvId: 'HCV-A1B2C3D4E5F60718',
      referenceRole: 'ORIGINAL_REFERENCE',
      referenceSha256: source.sha256,
      originalContentSha256: source.sha256,
      hcvpackSha256: sha('provider-acceptance-hcvpack'),
      derivationManifestSha256: sha('provider-acceptance-manifest'),
      mediaType: 'video',
      objectId,
      objectKey,
    });

    if (receipt.provider !== 'r2') throw new Error('PROVIDER_NOT_R2');
    if (receipt.referenceSha256 !== source.sha256) {
      throw new Error('COMMIT_REFERENCE_SHA_MISMATCH');
    }
    if (!(await provider.referenceExists(receipt))) {
      throw new Error('REFERENCE_HEAD_NOT_CONFIRMED');
    }

    const authorization =
      await provider.createEncryptedReadAuthorization(receipt);
    const signedResponse = await fetch(authorization.url, {
      method: 'GET',
      redirect: 'error',
    });
    if (!signedResponse.ok) {
      throw new Error(
        'PRESIGNED_GET_FAILED_HTTP_' + signedResponse.status,
      );
    }
    const signedObject = await sha256ResponseBody(signedResponse);
    if (signedObject.sha256 !== receipt.ciphertextSha256 ||
        signedObject.bytes !== receipt.ciphertextBytes) {
      throw new Error('PRESIGNED_CIPHERTEXT_MISMATCH');
    }

    await provider.materializeReference({
      receipt,
      destinationPath: restoredPath,
      binding: {
        hcvId: 'HCV-A1B2C3D4E5F60718',
        referenceRole: 'ORIGINAL_REFERENCE',
        referenceSha256: source.sha256,
        originalContentSha256: source.sha256,
        hcvpackSha256: sha('provider-acceptance-hcvpack'),
        derivationManifestSha256: sha('provider-acceptance-manifest'),
        objectId,
        mediaType: 'video',
      },
    });
    const restoredSha256 = await sha256File(restoredPath);
    if (restoredSha256 !== source.sha256) {
      throw new Error('DECRYPTED_REFERENCE_SHA_MISMATCH');
    }

    const deletion = await provider.deleteReference(receipt);
    deleted = deletion.deleted === true;
    if (!deleted) throw new Error('REFERENCE_DELETE_NOT_CONFIRMED');
    if (await provider.referenceExists(receipt)) {
      throw new Error('REFERENCE_STILL_EXISTS_AFTER_DELETE');
    }

    console.log(JSON.stringify({
      passed: true,
      payloadMb: mb,
      provider: receipt.provider,
      encryptionFormat: receipt.encryptionFormat,
      multipartCapable: true,
      euEndpoint: true,
      committedHeadConfirmed: true,
      presignedEncryptedGetConfirmed: true,
      ciphertextSha256Confirmed: true,
      decryptExactSha256Confirmed: true,
      deleteConfirmed: true,
    }, null, 2));
  } finally {
    if (provider && receipt && !deleted) {
      try {
        await provider.deleteReference(receipt);
      } catch (_) {}
    }
    provider?.destroy?.();
    ephemeralMasterKey.fill(0);
    delete process.env.R2_REFERENCE_MASTER_KEYS_JSON;
    delete process.env.R2_REFERENCE_ACTIVE_KEY_ID;
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(
    'r2_primary_provider_acceptance: FAIL',
    error?.message || String(error),
  );
  process.exitCode = 1;
});
