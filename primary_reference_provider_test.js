'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const {
  createR2ReferenceProvider,
  logicalIdempotencyKey,
  selectPrimaryReferenceProvider,
} = require('./primary_reference_provider');

class HeadObjectCommand {
  constructor(input) { this.input = input; }
}
class GetObjectCommand {
  constructor(input) { this.input = input; }
}
class DeleteObjectCommand {
  constructor(input) { this.input = input; }
}
class S3Client {}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main() {
  assert.equal(selectPrimaryReferenceProvider({}), 'youtube');
  assert.equal(
    selectPrimaryReferenceProvider({ SIGILLUM_PRIMARY_REFERENCE_PROVIDER: 'R2' }),
    'r2',
  );
  assert.throws(
    () => selectPrimaryReferenceProvider({
      SIGILLUM_PRIMARY_REFERENCE_PROVIDER: 'telegram',
    }),
    /SIGILLUM_PRIMARY_REFERENCE_PROVIDER_INVALID/,
  );

  const masterKey = crypto.randomBytes(32);
  const env = {
    R2_ENDPOINT: 'https://example-account.eu.r2.cloudflarestorage.com',
    R2_BUCKET: 'sigillum-hcv-references-eu',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_REQUIRE_EU: 'true',
    R2_REFERENCE_ACTIVE_KEY_ID: 'r2-2026-10',
    R2_REFERENCE_MASTER_KEYS_JSON: JSON.stringify({
      'r2-2026-10': masterKey.toString('base64'),
    }),
    R2_REFERENCE_PART_SIZE_BYTES: String(5 * 1024 * 1024),
    R2_REFERENCE_QUEUE_SIZE: '2',
    R2_REFERENCE_READ_TTL_SECONDS: '60',
    SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES: String(20 * 1024 * 1024),
  };

  assert.throws(
    () => createR2ReferenceProvider({
      env: { ...env, R2_ENDPOINT: 'https://example-account.r2.cloudflarestorage.com' },
      aws: {
        S3Client,
        HeadObjectCommand,
        GetObjectCommand,
        DeleteObjectCommand,
        Upload: class {},
        getSignedUrl: async () => '',
        client: { send: async () => ({}) },
      },
    }),
    /R2_REFERENCE_EU_JURISDICTION_REQUIRED/,
  );

  const objects = new Map();
  let lastUploadOptions = null;

  const client = {
    async send(command) {
      const key = command.input.Key;
      if (command instanceof HeadObjectCommand) {
        const item = objects.get(key);
        if (!item) {
          const error = new Error('NotFound');
          error.name = 'NotFound';
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        return {
          ContentLength: item.body.length,
          Metadata: item.metadata,
        };
      }
      if (command instanceof GetObjectCommand) {
        const item = objects.get(key);
        if (!item) {
          const error = new Error('NotFound');
          error.name = 'NoSuchKey';
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        return { Body: Readable.from(item.body) };
      }
      if (command instanceof DeleteObjectCommand) {
        objects.delete(key);
        return {};
      }
      throw new Error('unexpected command');
    },
    destroy() {},
  };

  class Upload {
    constructor(options) {
      this.options = options;
      lastUploadOptions = options;
    }
    async done() {
      const body = await streamToBuffer(this.options.params.Body);
      objects.set(this.options.params.Key, {
        body,
        metadata: this.options.params.Metadata,
      });
      return { ETag: '"fake"' };
    }
  }

  const aws = {
    S3Client,
    HeadObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    Upload,
    getSignedUrl: async (_client, command, options) =>
      'https://signed.invalid/' +
      encodeURIComponent(command.input.Key) +
      '?expires=' + options.expiresIn,
    client,
  };

  const provider = createR2ReferenceProvider({ env, aws });
  assert.equal(provider.name, 'r2');
  assert.equal(provider.bucket, 'sigillum-hcv-references-eu');
  assert.equal(provider.partSize, 5 * 1024 * 1024);
  assert.equal(provider.queueSize, 2);

  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'sigillum-primary-reference-test-'),
  );
  const sourcePath = path.join(dir, 'source.mp4');
  const materializedPath = path.join(dir, 'materialized.mp4');

  try {
    const source = Buffer.alloc(2 * 1024 * 1024 + 131);
    for (let i = 0; i < source.length; i += 1) {
      source[i] = (i * 17 + 31) & 0xff;
    }
    await fs.promises.writeFile(sourcePath, source);
    const referenceSha256 = crypto.createHash('sha256').update(source).digest('hex');
    const originalContentSha256 = referenceSha256;
    const hcvpackSha256 = crypto.createHash('sha256')
      .update('hcvpack-test')
      .digest('hex');
    const derivationManifestSha256 = crypto.createHash('sha256')
      .update('derivation-test')
      .digest('hex');

    const objectId = crypto.randomUUID();
    const binding = {
      hcvId: 'HCV-ABCDEF0123456789',
      referenceRole: 'ORIGINAL_REFERENCE',
      referenceSha256,
      originalContentSha256,
      hcvpackSha256,
      derivationManifestSha256,
      objectId,
      mediaType: 'video',
    };

    const sameLogicalDifferentObject = {
      ...binding,
      objectId: crypto.randomUUID(),
    };
    assert.equal(
      logicalIdempotencyKey(binding),
      logicalIdempotencyKey(sameLogicalDifferentObject),
    );

    const receipt = await provider.commitReference({
      sourcePath,
      ...binding,
    });

    assert.equal(receipt.provider, 'r2');
    assert.equal(receipt.objectId, objectId);
    assert.equal(receipt.referenceSha256, referenceSha256);
    assert.equal(receipt.originalContentSha256, originalContentSha256);
    assert.equal(receipt.hcvpackSha256, hcvpackSha256);
    assert.equal(
      receipt.derivationManifestSha256,
      derivationManifestSha256,
    );
    assert.equal(receipt.referenceRole, 'ORIGINAL_REFERENCE');
    assert.equal(receipt.mediaType, 'video');
    assert.ok(receipt.objectKey.startsWith('references/v1/'));
    assert.ok(!receipt.objectKey.includes(binding.hcvId));
    assert.ok(!receipt.objectKey.toLowerCase().includes('marcello'));
    assert.ok(objects.has(receipt.objectKey));
    assert.ok(lastUploadOptions);
    assert.equal(lastUploadOptions.leavePartsOnError, false);
    assert.equal(lastUploadOptions.partSize, 5 * 1024 * 1024);
    assert.equal(lastUploadOptions.queueSize, 2);

    const encrypted = objects.get(receipt.objectKey).body;
    assert.notDeepEqual(encrypted, source);
    assert.equal(
      encrypted.includes(Buffer.from(binding.hcvId, 'utf8')),
      false,
      'HCV-ID must not be embedded in encrypted object bytes',
    );
    assert.equal(
      objects.get(receipt.objectKey).metadata['sigillum-format'],
      'sgr2ref2',
    );
    assert.equal(
      objects.get(receipt.objectKey).metadata['cipher-sha256'],
      receipt.ciphertextSha256,
    );

    assert.equal(await provider.referenceExists(receipt), true);

    await provider.materializeReference({
      receipt,
      destinationPath: materializedPath,
      binding,
    });
    const materialized = await fs.promises.readFile(materializedPath);
    assert.deepEqual(materialized, source);

    await assert.rejects(
      () => provider.materializeReference({
        receipt,
        destinationPath: materializedPath,
        binding: {
          ...binding,
          hcvpackSha256: crypto.createHash('sha256')
            .update('wrong-hcvpack')
            .digest('hex'),
        },
      }),
      /R2_REFERENCE_BINDING_RECEIPT_MISMATCH/,
    );

    const auth = await provider.createEncryptedReadAuthorization(receipt);
    assert.equal(auth.provider, 'r2');
    assert.equal(auth.content, 'encrypted');
    assert.equal(auth.expiresInSeconds, 60);
    assert.ok(auth.url.startsWith('https://signed.invalid/'));

    const deletion = await provider.deleteReference(receipt);
    assert.deepEqual(deletion, { deleted: true, provider: 'r2' });
    assert.equal(objects.has(receipt.objectKey), false);
    assert.equal(await provider.referenceExists(receipt), false);

    console.log(
      'primary_reference_provider_test: PASS — provider selection, EU guard, opaque keys, AES-256-GCM binding, multipart-capable commit, exact decrypt, short-lived encrypted read auth, delete confirmation',
    );
  } finally {
    provider.destroy();
    masterKey.fill(0);
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
