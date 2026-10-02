'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');

const HCV_ID = /^HCV-[A-F0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REFERENCE_ROLES = new Set(['ORIGINAL_REFERENCE', 'DERIVED_REFERENCE']);
const MAGIC = Buffer.from('SGR2REF2', 'ascii');
const FORMAT_VERSION = 2;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_KEY_ID_BYTES = 80;
const DEFAULT_MAX_BYTES = 536870912;
const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
const MIN_MULTIPART_PART_SIZE = 5 * 1024 * 1024;
const DEFAULT_QUEUE_SIZE = 4;
const DEFAULT_PRESIGN_SECONDS = 60;

class PrimaryReferenceProvider {
  constructor(name) {
    if (!name) throw new Error('REFERENCE_PROVIDER_NAME_REQUIRED');
    this.name = name;
  }

  async commitReference() {
    throw new Error('REFERENCE_PROVIDER_COMMIT_NOT_IMPLEMENTED');
  }

  async materializeReference() {
    throw new Error('REFERENCE_PROVIDER_READ_NOT_IMPLEMENTED');
  }

  async deleteReference() {
    throw new Error('REFERENCE_PROVIDER_DELETE_NOT_IMPLEMENTED');
  }

  async createEncryptedReadAuthorization() {
    throw new Error('REFERENCE_PROVIDER_AUTH_NOT_IMPLEMENTED');
  }
}

function requiredEnv(env, key) {
  const value = String(env?.[key] || '').trim();
  if (!value) throw new Error('Missing required environment variable: ' + key);
  return value;
}

function normalizeEndpoint(value) {
  const url = new URL(String(value || '').trim().replace(/\/+$/, ''));
  if (url.protocol !== 'https:') {
    throw new Error('R2_ENDPOINT must use HTTPS.');
  }
  return url;
}

function strictPositiveInt(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }
  return parsed;
}

function selectPrimaryReferenceProvider(env = process.env) {
  const raw = String(env.SIGILLUM_PRIMARY_REFERENCE_PROVIDER || 'youtube')
    .trim()
    .toLowerCase();
  if (raw === 'youtube' || raw === 'r2') return raw;
  throw new Error('SIGILLUM_PRIMARY_REFERENCE_PROVIDER_INVALID');
}

function parseMasterKeyRing(env = process.env) {
  const activeKeyId = requiredEnv(env, 'R2_REFERENCE_ACTIVE_KEY_ID');
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(activeKeyId)) {
    throw new Error('R2_REFERENCE_ACTIVE_KEY_ID_INVALID');
  }
  let parsed;
  try {
    parsed = JSON.parse(requiredEnv(env, 'R2_REFERENCE_MASTER_KEYS_JSON'));
  } catch (_) {
    throw new Error('R2_REFERENCE_MASTER_KEYS_JSON_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('R2_REFERENCE_MASTER_KEYS_JSON_INVALID');
  }

  const keys = new Map();
  for (const [keyId, raw] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(keyId) || typeof raw !== 'string') {
      throw new Error('R2_REFERENCE_MASTER_KEYS_JSON_INVALID');
    }
    let key;
    try {
      key = Buffer.from(raw, 'base64');
    } catch (_) {
      throw new Error('R2_REFERENCE_MASTER_KEYS_JSON_INVALID');
    }
    if (key.length !== 32) {
      throw new Error('R2_REFERENCE_MASTER_KEY_LENGTH_INVALID');
    }
    keys.set(keyId, key);
  }
  if (!keys.has(activeKeyId)) {
    throw new Error('R2_REFERENCE_ACTIVE_KEY_NOT_FOUND');
  }
  return { activeKeyId, keys };
}

function validateBinding(binding) {
  const value = { ...binding };
  value.hcvId = String(value.hcvId || '');
  value.referenceRole = String(value.referenceRole || '');
  value.referenceSha256 = String(value.referenceSha256 || '').toLowerCase();
  value.originalContentSha256 = String(value.originalContentSha256 || '').toLowerCase();
  value.hcvpackSha256 = String(value.hcvpackSha256 || '').toLowerCase();
  value.derivationManifestSha256 =
    String(value.derivationManifestSha256 || '').toLowerCase();
  value.objectId = String(value.objectId || '');
  value.mediaType = String(value.mediaType || '').toLowerCase();

  if (!HCV_ID.test(value.hcvId)) throw new Error('REFERENCE_HCV_ID_INVALID');
  if (!REFERENCE_ROLES.has(value.referenceRole)) {
    throw new Error('REFERENCE_ROLE_INVALID');
  }
  for (const field of [
    'referenceSha256',
    'originalContentSha256',
    'hcvpackSha256',
    'derivationManifestSha256',
  ]) {
    if (!SHA256.test(value[field])) {
      throw new Error('REFERENCE_BINDING_SHA256_INVALID_' + field);
    }
  }
  if (!/^[0-9a-f-]{36}$/i.test(value.objectId)) {
    throw new Error('REFERENCE_OBJECT_ID_INVALID');
  }
  if (!['video', 'photo'].includes(value.mediaType)) {
    throw new Error('REFERENCE_MEDIA_TYPE_INVALID');
  }
  return value;
}

function canonicalBinding(binding) {
  const value = validateBinding(binding);
  return [
    'SIGILLUM_R2_REFERENCE_BINDING_V1',
    value.hcvId,
    value.referenceRole,
    value.referenceSha256,
    value.originalContentSha256,
    value.hcvpackSha256,
    value.derivationManifestSha256,
    value.objectId,
    value.mediaType,
  ].join('\n');
}

function logicalIdempotencyKey(binding) {
  const value = validateBinding(binding);
  return crypto.createHash('sha256').update([
    'SIGILLUM_PRIMARY_REFERENCE_IDEMPOTENCY_V1',
    value.hcvId,
    value.referenceRole,
    value.referenceSha256,
    value.originalContentSha256,
    value.hcvpackSha256,
    value.derivationManifestSha256,
    value.mediaType,
  ].join('\n'), 'utf8').digest('hex');
}

function opaqueObjectKey(objectId = crypto.randomUUID()) {
  if (!/^[0-9a-f-]{36}$/i.test(String(objectId || ''))) {
    throw new Error('REFERENCE_OBJECT_ID_INVALID');
  }
  const shard = crypto
    .createHash('sha256')
    .update(String(objectId), 'utf8')
    .digest('hex')
    .slice(0, 4);
  return 'references/v1/' + shard + '/' + objectId + '.sgref';
}

function deriveDataKey(masterKey, salt, bindingText) {
  const bindingHash = crypto.createHash('sha256')
    .update(bindingText, 'utf8')
    .digest();
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      masterKey,
      salt,
      Buffer.concat([
        Buffer.from('SIGILLUM_R2_REFERENCE_HKDF_V1\0', 'utf8'),
        bindingHash,
      ]),
      32,
    ),
  );
}

function encodeHeader({ keyId, salt, nonce }) {
  const keyIdBytes = Buffer.from(String(keyId), 'utf8');
  if (!keyIdBytes.length || keyIdBytes.length > MAX_KEY_ID_BYTES) {
    throw new Error('R2_REFERENCE_KEY_ID_INVALID');
  }
  return Buffer.concat([
    MAGIC,
    Buffer.from([FORMAT_VERSION, keyIdBytes.length]),
    keyIdBytes,
    salt,
    nonce,
  ]);
}

async function readHeader(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const prefix = Buffer.alloc(MAGIC.length + 2);
    await handle.read(prefix, 0, prefix.length, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('R2_REFERENCE_MAGIC_INVALID');
    }
    if (prefix[MAGIC.length] !== FORMAT_VERSION) {
      throw new Error('R2_REFERENCE_VERSION_UNSUPPORTED');
    }
    const keyIdLength = prefix[MAGIC.length + 1];
    if (!keyIdLength || keyIdLength > MAX_KEY_ID_BYTES) {
      throw new Error('R2_REFERENCE_KEY_ID_INVALID');
    }
    const remaining = Buffer.alloc(keyIdLength + SALT_BYTES + NONCE_BYTES);
    await handle.read(remaining, 0, remaining.length, prefix.length);
    const keyId = remaining.subarray(0, keyIdLength).toString('utf8');
    const saltStart = keyIdLength;
    const nonceStart = saltStart + SALT_BYTES;
    return {
      keyId,
      salt: remaining.subarray(saltStart, nonceStart),
      nonce: remaining.subarray(nonceStart, nonceStart + NONCE_BYTES),
      headerBytes: prefix.length + remaining.length,
    };
  } finally {
    await handle.close();
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function encryptReferenceFile({
  sourcePath,
  targetPath,
  masterKey,
  keyId,
  binding,
  randomBytes = crypto.randomBytes,
}) {
  const canonical = canonicalBinding(binding);
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const dataKey = deriveDataKey(masterKey, salt, canonical);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, nonce);
  cipher.setAAD(Buffer.from(canonical, 'utf8'));
  const header = encodeHeader({ keyId, salt, nonce });
  const output = fs.createWriteStream(targetPath, { flags: 'w', mode: 0o600 });
  output.write(header);
  try {
    await pipeline(fs.createReadStream(sourcePath), cipher, output, { end: false });
    output.write(cipher.getAuthTag());
    await new Promise((resolve, reject) => {
      output.once('error', reject);
      output.end(resolve);
    });
  } finally {
    dataKey.fill(0);
  }
}

async function decryptReferenceFile({
  sourcePath,
  targetPath,
  keyRing,
  binding,
}) {
  const stat = await fs.promises.stat(sourcePath);
  const header = await readHeader(sourcePath);
  if (stat.size <= header.headerBytes + TAG_BYTES) {
    throw new Error('R2_REFERENCE_CIPHERTEXT_TOO_SMALL');
  }
  const masterKey = keyRing.get(header.keyId);
  if (!masterKey) throw new Error('R2_REFERENCE_KEY_NOT_AVAILABLE');
  const canonical = canonicalBinding(binding);
  const dataKey = deriveDataKey(masterKey, header.salt, canonical);
  const handle = await fs.promises.open(sourcePath, 'r');
  let tag;
  try {
    tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, header.nonce);
  decipher.setAAD(Buffer.from(canonical, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(sourcePath, {
        start: header.headerBytes,
        end: stat.size - TAG_BYTES - 1,
      }),
      decipher,
      fs.createWriteStream(targetPath, { flags: 'w', mode: 0o600 }),
    );
  } finally {
    dataKey.fill(0);
  }
}

function safeAwsError(error) {
  const name = String(error?.name || error?.Code || 'AWS_ERROR');
  const status = Number(error?.$metadata?.httpStatusCode || 0);
  return status ? name + ' HTTP ' + status : name;
}

function loadAwsDependencies(overrides = {}) {
  if (overrides.S3Client &&
      overrides.HeadObjectCommand &&
      overrides.GetObjectCommand &&
      overrides.DeleteObjectCommand &&
      overrides.Upload &&
      overrides.getSignedUrl) {
    return overrides;
  }
  const s3 = require('@aws-sdk/client-s3');
  const { Upload } = require('@aws-sdk/lib-storage');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return {
    S3Client: s3.S3Client,
    HeadObjectCommand: s3.HeadObjectCommand,
    GetObjectCommand: s3.GetObjectCommand,
    DeleteObjectCommand: s3.DeleteObjectCommand,
    Upload,
    getSignedUrl,
  };
}

function createR2ReferenceProvider({
  env = process.env,
  aws = {},
  fsImpl = fs,
  osImpl = os,
} = {}) {
  const endpoint = normalizeEndpoint(requiredEnv(env, 'R2_ENDPOINT'));
  const bucket = requiredEnv(env, 'R2_BUCKET');
  const accessKeyId = requiredEnv(env, 'R2_ACCESS_KEY_ID');
  const secretAccessKey = requiredEnv(env, 'R2_SECRET_ACCESS_KEY');
  const requireEu = String(env.R2_REQUIRE_EU || 'true').toLowerCase() !== 'false';
  if (requireEu && !endpoint.hostname.endsWith('.eu.r2.cloudflarestorage.com')) {
    throw new Error('R2_REFERENCE_EU_JURISDICTION_REQUIRED');
  }
  const { activeKeyId, keys } = parseMasterKeyRing(env);
  const maxBytes = strictPositiveInt(
    env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES,
    DEFAULT_MAX_BYTES,
  );
  const partSize = strictPositiveInt(
    env.R2_REFERENCE_PART_SIZE_BYTES,
    DEFAULT_PART_SIZE,
    MIN_MULTIPART_PART_SIZE,
  );
  const queueSize = strictPositiveInt(
    env.R2_REFERENCE_QUEUE_SIZE,
    DEFAULT_QUEUE_SIZE,
    1,
    16,
  );
  const presignSeconds = strictPositiveInt(
    env.R2_REFERENCE_READ_TTL_SECONDS,
    DEFAULT_PRESIGN_SECONDS,
    15,
    900,
  );

  const deps = loadAwsDependencies(aws);
  const client = aws.client || new deps.S3Client({
    endpoint: endpoint.origin,
    region: 'auto',
    credentials: { accessKeyId, secretAccessKey },
  });

  class R2ReferenceProvider extends PrimaryReferenceProvider {
    constructor() {
      super('r2');
      this.endpoint = endpoint;
      this.bucket = bucket;
      this.client = client;
      this.keyRing = keys;
      this.activeKeyId = activeKeyId;
      this.maxBytes = maxBytes;
      this.partSize = partSize;
      this.queueSize = queueSize;
      this.presignSeconds = presignSeconds;
    }

    async commitReference({
      sourcePath,
      hcvId,
      referenceRole,
      referenceSha256,
      originalContentSha256,
      hcvpackSha256,
      derivationManifestSha256,
      mediaType,
      objectId = crypto.randomUUID(),
      objectKey = null,
    }) {
      const sourceStat = await fsImpl.promises.stat(sourcePath);
      if (!sourceStat.isFile() ||
          sourceStat.size <= 0 ||
          sourceStat.size > this.maxBytes) {
        throw new Error('R2_REFERENCE_SOURCE_SIZE_INVALID');
      }

      const binding = validateBinding({
        hcvId,
        referenceRole,
        referenceSha256,
        originalContentSha256,
        hcvpackSha256,
        derivationManifestSha256,
        objectId,
        mediaType,
      });
      const actualPlaintextSha256 = await sha256File(sourcePath);
      if (actualPlaintextSha256 !== binding.referenceSha256) {
        throw new Error('R2_REFERENCE_PLAINTEXT_SHA256_MISMATCH');
      }

      const resolvedObjectKey = objectKey || opaqueObjectKey(objectId);
      if (!/^references\/v1\/[a-f0-9]{4}\/[0-9a-f-]{36}\.sgref$/i.test(
        resolvedObjectKey,
      )) {
        throw new Error('R2_REFERENCE_OBJECT_KEY_INVALID');
      }
      if (resolvedObjectKey.includes(hcvId)) {
        throw new Error('R2_REFERENCE_OBJECT_KEY_NOT_OPAQUE');
      }

      const tempDir = await fsImpl.promises.mkdtemp(
        path.join(osImpl.tmpdir(), 'sigillum-r2-primary-'),
      );
      const encryptedPath = path.join(tempDir, 'reference.sgref');
      try {
        await encryptReferenceFile({
          sourcePath,
          targetPath: encryptedPath,
          masterKey: this.keyRing.get(this.activeKeyId),
          keyId: this.activeKeyId,
          binding,
        });
        const encryptedStat = await fsImpl.promises.stat(encryptedPath);
        const ciphertextSha256 = await sha256File(encryptedPath);

        const upload = new deps.Upload({
          client: this.client,
          params: {
            Bucket: this.bucket,
            Key: resolvedObjectKey,
            Body: fsImpl.createReadStream(encryptedPath),
            ContentLength: encryptedStat.size,
            ContentType: 'application/octet-stream',
            Metadata: {
              'sigillum-format': 'sgr2ref2',
              'cipher-sha256': ciphertextSha256,
            },
          },
          queueSize: this.queueSize,
          partSize: this.partSize,
          leavePartsOnError: false,
        });
        try {
          await upload.done();
        } catch (error) {
          throw new Error('R2_REFERENCE_UPLOAD_FAILED: ' + safeAwsError(error));
        }

        let head;
        try {
          head = await this.client.send(
            new deps.HeadObjectCommand({
              Bucket: this.bucket,
              Key: resolvedObjectKey,
            }),
          );
        } catch (error) {
          throw new Error('R2_REFERENCE_HEAD_FAILED: ' + safeAwsError(error));
        }
        if (Number(head.ContentLength ?? -1) !== encryptedStat.size) {
          throw new Error('R2_REFERENCE_HEAD_LENGTH_MISMATCH');
        }
        const metadata = head.Metadata || {};
        if (String(metadata['cipher-sha256'] || '') !== ciphertextSha256 ||
            String(metadata['sigillum-format'] || '') !== 'sgr2ref2') {
          throw new Error('R2_REFERENCE_HEAD_METADATA_MISMATCH');
        }

        return {
          provider: 'r2',
          objectId,
          objectKey: resolvedObjectKey,
          encryptionFormat: 'SIGILLUM_R2_REFERENCE_V2',
          encryptionKeyId: this.activeKeyId,
          ciphertextSha256,
          ciphertextBytes: encryptedStat.size,
          referenceSha256: binding.referenceSha256,
          originalContentSha256: binding.originalContentSha256,
          hcvpackSha256: binding.hcvpackSha256,
          derivationManifestSha256: binding.derivationManifestSha256,
          referenceRole: binding.referenceRole,
          mediaType: binding.mediaType,
          idempotencyKey: logicalIdempotencyKey(binding),
          committedAt: new Date().toISOString(),
        };
      } finally {
        await fsImpl.promises.rm(tempDir, { recursive: true, force: true });
      }
    }

    async materializeReference({ receipt, destinationPath, binding }) {
      if (!receipt || receipt.provider !== 'r2') {
        throw new Error('R2_REFERENCE_RECEIPT_INVALID');
      }
      const validated = validateBinding(binding);
      if (validated.objectId !== receipt.objectId ||
          validated.referenceSha256 !== receipt.referenceSha256 ||
          validated.originalContentSha256 !== receipt.originalContentSha256 ||
          validated.hcvpackSha256 !== receipt.hcvpackSha256 ||
          validated.derivationManifestSha256 !== receipt.derivationManifestSha256 ||
          validated.referenceRole !== receipt.referenceRole ||
          validated.mediaType !== receipt.mediaType) {
        throw new Error('R2_REFERENCE_BINDING_RECEIPT_MISMATCH');
      }

      const tempDir = await fsImpl.promises.mkdtemp(
        path.join(osImpl.tmpdir(), 'sigillum-r2-read-'),
      );
      const encryptedPath = path.join(tempDir, 'reference.sgref');
      try {
        let response;
        try {
          response = await this.client.send(
            new deps.GetObjectCommand({
              Bucket: this.bucket,
              Key: receipt.objectKey,
            }),
          );
        } catch (error) {
          throw new Error('R2_REFERENCE_GET_FAILED: ' + safeAwsError(error));
        }
        if (!response?.Body) throw new Error('R2_REFERENCE_GET_BODY_MISSING');
        await pipeline(
          response.Body,
          fsImpl.createWriteStream(encryptedPath, { flags: 'w', mode: 0o600 }),
        );
        const cipherHash = await sha256File(encryptedPath);
        if (cipherHash !== receipt.ciphertextSha256) {
          throw new Error('R2_REFERENCE_CIPHERTEXT_SHA256_MISMATCH');
        }
        await decryptReferenceFile({
          sourcePath: encryptedPath,
          targetPath: destinationPath,
          keyRing: this.keyRing,
          binding: validated,
        });
        const plaintextHash = await sha256File(destinationPath);
        if (plaintextHash !== receipt.referenceSha256) {
          throw new Error('R2_REFERENCE_DECRYPTED_SHA256_MISMATCH');
        }
        return {
          ok: true,
          referenceSha256: plaintextHash,
          destinationPath,
        };
      } finally {
        await fsImpl.promises.rm(tempDir, { recursive: true, force: true });
      }
    }

    async createEncryptedReadAuthorization(receipt) {
      if (!receipt || receipt.provider !== 'r2' || !receipt.objectKey) {
        throw new Error('R2_REFERENCE_RECEIPT_INVALID');
      }
      const command = new deps.GetObjectCommand({
        Bucket: this.bucket,
        Key: receipt.objectKey,
      });
      const url = await deps.getSignedUrl(this.client, command, {
        expiresIn: this.presignSeconds,
      });
      return {
        provider: 'r2',
        content: 'encrypted',
        url,
        expiresInSeconds: this.presignSeconds,
      };
    }

    async deleteReference(receipt) {
      if (!receipt || receipt.provider !== 'r2' || !receipt.objectKey) {
        throw new Error('R2_REFERENCE_RECEIPT_INVALID');
      }
      try {
        await this.client.send(
          new deps.DeleteObjectCommand({
            Bucket: this.bucket,
            Key: receipt.objectKey,
          }),
        );
      } catch (error) {
        throw new Error('R2_REFERENCE_DELETE_FAILED: ' + safeAwsError(error));
      }

      try {
        await this.client.send(
          new deps.HeadObjectCommand({
            Bucket: this.bucket,
            Key: receipt.objectKey,
          }),
        );
        return { deleted: false, provider: 'r2' };
      } catch (error) {
        const status = Number(error?.$metadata?.httpStatusCode || 0);
        if (status === 404 || String(error?.name || '') === 'NotFound') {
          return { deleted: true, provider: 'r2' };
        }
        throw new Error(
          'R2_REFERENCE_DELETE_CONFIRM_FAILED: ' + safeAwsError(error),
        );
      }
    }

    destroy() {
      this.client?.destroy?.();
    }
  }

  return new R2ReferenceProvider();
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_PART_SIZE,
  DEFAULT_QUEUE_SIZE,
  FORMAT_VERSION,
  MAGIC,
  PrimaryReferenceProvider,
  canonicalBinding,
  createR2ReferenceProvider,
  decryptReferenceFile,
  encryptReferenceFile,
  logicalIdempotencyKey,
  normalizeEndpoint,
  opaqueObjectKey,
  parseMasterKeyRing,
  selectPrimaryReferenceProvider,
  validateBinding,
};
