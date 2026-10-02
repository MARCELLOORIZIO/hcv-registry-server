'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const { Pool } = require('pg');
const {
  createOrGetReferenceJob,
  claimUploadJob,
  initPrimaryReferenceLifecycleSchema,
  markCommitted,
} = require('./primary_reference_lifecycle');
const {
  consumeReadAuthorization,
  initPrimaryReferenceReadAuthSchema,
  issueReadAuthorization,
} = require('./primary_reference_read_auth');

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    max: 1,
  });
  const client = await pool.connect();
  const schema = (
    'primary_read_auth_' + process.pid + '_' + Date.now()
  ).replace(/[^a-z0-9_]/g, '');

  const scopedPool = {
    query: (...args) => client.query(...args),
    connect: async () => ({
      query: (...args) => client.query(...args),
      release() {},
    }),
  };

  try {
    await client.query('CREATE SCHEMA ' + schema);
    await client.query('SET search_path TO ' + schema);
    await client.query('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
    await client.query('CREATE TABLE certificates(hcv_id TEXT PRIMARY KEY)');
    await initPrimaryReferenceLifecycleSchema(scopedPool);
    await initPrimaryReferenceReadAuthSchema(scopedPool);

    const accountId = 'acct-primary-read';
    const hcvId = 'HCV-9988776655443322';
    await client.query('INSERT INTO accounts(id) VALUES($1)', [accountId]);
    await client.query('INSERT INTO certificates(hcv_id) VALUES($1)', [hcvId]);

    const objectId = crypto.randomUUID();
    const binding = {
      hcvId,
      referenceRole: 'ORIGINAL_REFERENCE',
      referenceSha256: sha('reference'),
      originalContentSha256: sha('original'),
      hcvpackSha256: sha('hcvpack'),
      derivationManifestSha256: sha('manifest'),
      mediaType: 'video',
    };
    const objectKey = 'references/v1/abcd/' + objectId + '.sgref';
    const created = await createOrGetReferenceJob(scopedPool, {
      binding,
      provider: 'r2',
      objectId,
      objectKey,
    });

    await assert.rejects(
      () => issueReadAuthorization(scopedPool, {
        jobId: created.job.jobId,
        hcvId,
        accountId,
      }),
      /REFERENCE_NOT_AVAILABLE/,
    );

    const claimed = await claimUploadJob(scopedPool, created.job.jobId);
    const receipt = {
      provider: 'r2',
      objectId,
      objectKey,
      encryptionFormat: 'SIGILLUM_R2_REFERENCE_V2',
      encryptionKeyId: 'r2-test-key',
      ciphertextSha256: sha('cipher'),
      ciphertextBytes: 1000,
      referenceSha256: binding.referenceSha256,
      originalContentSha256: binding.originalContentSha256,
      hcvpackSha256: binding.hcvpackSha256,
      derivationManifestSha256: binding.derivationManifestSha256,
      referenceRole: binding.referenceRole,
      mediaType: binding.mediaType,
      idempotencyKey: claimed.idempotencyKey,
      committedAt: new Date().toISOString(),
    };
    await markCommitted(scopedPool, created.job.jobId, receipt);

    const issued = await issueReadAuthorization(scopedPool, {
      jobId: created.job.jobId,
      hcvId,
      accountId,
      ttlSeconds: 60,
    });
    assert.equal(issued.expiresInSeconds, 60);
    assert.ok(issued.token.length >= 40);

    const consumed = await consumeReadAuthorization(scopedPool, {
      token: issued.token,
      accountId,
    });
    assert.equal(consumed.jobId, created.job.jobId);
    assert.equal(consumed.hcvId, hcvId);
    assert.equal(consumed.receipt.objectKey, objectKey);

    await assert.rejects(
      () => consumeReadAuthorization(scopedPool, {
        token: issued.token,
        accountId,
      }),
      /REFERENCE_READ_AUTH_INVALID/,
    );

    console.log(
      'primary_reference_read_auth_pg_test: PASS — committed-only issue, account binding and single-use consumption',
    );
  } finally {
    try {
      await client.query('RESET search_path');
      await client.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    } finally {
      client.release();
      await pool.end();
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
