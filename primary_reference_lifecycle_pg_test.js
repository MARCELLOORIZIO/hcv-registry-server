'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const { Pool } = require('pg');
const {
  STATES,
  availableReference,
  claimDeleteJobs,
  claimUploadJob,
  claimUploadJobs,
  createOrGetReferenceJob,
  initPrimaryReferenceLifecycleSchema,
  markCommitted,
  markDeleteRetry,
  markDeleted,
  markUploadRetry,
  requestDelete,
} = require('./primary_reference_lifecycle');

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_REQUIRED');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    max: 1,
  });
  const client = await pool.connect();
  const schema = 'primary_reference_test_' +
    String(process.pid) + '_' + String(Date.now());
  const safeSchema = schema.replace(/[^a-z0-9_]/g, '');

  const scopedPool = {
    query: (...args) => client.query(...args),
    connect: async () => ({
      query: (...args) => client.query(...args),
      release() {},
    }),
  };

  try {
    await client.query('CREATE SCHEMA ' + safeSchema);
    await client.query('SET search_path TO ' + safeSchema);
    await client.query(
      'CREATE TABLE certificates(hcv_id TEXT PRIMARY KEY)',
    );
    await initPrimaryReferenceLifecycleSchema(scopedPool);

    const hcvId = 'HCV-1122334455667788';
    await client.query(
      'INSERT INTO certificates(hcv_id) VALUES($1)',
      [hcvId],
    );

    const objectId = crypto.randomUUID();
    const binding = {
      hcvId,
      referenceRole: 'ORIGINAL_REFERENCE',
      referenceSha256: sha('reference-v1'),
      originalContentSha256: sha('original-v1'),
      hcvpackSha256: sha('hcvpack-v1'),
      derivationManifestSha256: sha('manifest-v1'),
      mediaType: 'video',
    };
    const objectKey =
      'references/v1/abcd/' + objectId + '.sgref';

    const created = await createOrGetReferenceJob(scopedPool, {
      binding,
      provider: 'r2',
      objectId,
      objectKey,
    });
    assert.equal(created.created, true);
    assert.equal(created.job.state, STATES.PENDING);
    assert.equal(created.job.attemptCount, 0);

    const same = await createOrGetReferenceJob(scopedPool, {
      binding,
      provider: 'r2',
      objectId: crypto.randomUUID(),
      objectKey: 'references/v1/beef/' + crypto.randomUUID() + '.sgref',
    });
    assert.equal(same.created, false);
    assert.equal(same.job.jobId, created.job.jobId);
    assert.equal(same.job.objectId, objectId);

    await assert.rejects(
      () => createOrGetReferenceJob(scopedPool, {
        binding: {
          ...binding,
          referenceSha256: sha('conflicting-reference'),
          derivationManifestSha256: sha('conflicting-manifest'),
        },
        provider: 'r2',
        objectId: crypto.randomUUID(),
        objectKey: 'references/v1/cafe/' + crypto.randomUUID() + '.sgref',
      }),
      /PRIMARY_REFERENCE_ROLE_CONFLICT/,
    );

    let claimed = await claimUploadJobs(scopedPool, {
      provider: 'r2',
      limit: 10,
    });
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].jobId, created.job.jobId);
    assert.equal(claimed[0].state, STATES.UPLOADING);
    assert.equal(claimed[0].attemptCount, 1);

    const retry = await markUploadRetry(
      scopedPool,
      created.job.jobId,
      'R2_TEMPORARY_OUTAGE',
      { delayMs: 0 },
    );
    assert.equal(retry.state, STATES.RETRY_WAIT);
    assert.equal(retry.lastErrorCode, 'R2_TEMPORARY_OUTAGE');

    const claimedSingle = await claimUploadJob(
      scopedPool,
      created.job.jobId,
    );
    assert.equal(claimedSingle.state, STATES.UPLOADING);
    assert.equal(claimedSingle.attemptCount, 2);

    const receipt = {
      provider: 'r2',
      objectId,
      objectKey,
      encryptionFormat: 'SIGILLUM_R2_REFERENCE_V2',
      encryptionKeyId: 'r2-2026-10',
      ciphertextSha256: sha('ciphertext'),
      ciphertextBytes: 12345,
      referenceSha256: binding.referenceSha256,
      originalContentSha256: binding.originalContentSha256,
      hcvpackSha256: binding.hcvpackSha256,
      derivationManifestSha256: binding.derivationManifestSha256,
      referenceRole: binding.referenceRole,
      mediaType: binding.mediaType,
      idempotencyKey: created.job.idempotencyKey,
      committedAt: new Date().toISOString(),
    };

    const committed = await markCommitted(
      scopedPool,
      created.job.jobId,
      receipt,
    );
    assert.equal(committed.state, STATES.COMMITTED);
    assert.equal(committed.receipt.objectKey, objectKey);

    const available = await availableReference(
      scopedPool,
      hcvId,
      'ORIGINAL_REFERENCE',
    );
    assert.equal(available.jobId, created.job.jobId);
    assert.equal(available.state, STATES.COMMITTED);

    const deletePending = await requestDelete(
      scopedPool,
      created.job.jobId,
    );
    assert.equal(deletePending.state, STATES.DELETE_PENDING);

    const unavailable = await availableReference(
      scopedPool,
      hcvId,
      'ORIGINAL_REFERENCE',
    );
    assert.equal(unavailable, null);

    let deleteClaims = await claimDeleteJobs(scopedPool, {
      provider: 'r2',
      limit: 10,
    });
    assert.equal(deleteClaims.length, 1);
    assert.equal(deleteClaims[0].deleteAttemptCount, 1);

    const deleteRetry = await markDeleteRetry(
      scopedPool,
      created.job.jobId,
      'R2_DELETE_OUTAGE',
      { delayMs: 0 },
    );
    assert.equal(deleteRetry.state, STATES.DELETE_PENDING);
    assert.equal(deleteRetry.lastErrorCode, 'R2_DELETE_OUTAGE');

    deleteClaims = await claimDeleteJobs(scopedPool, {
      provider: 'r2',
      limit: 10,
    });
    assert.equal(deleteClaims.length, 1);
    assert.equal(deleteClaims[0].deleteAttemptCount, 2);

    const deleted = await markDeleted(scopedPool, created.job.jobId);
    assert.equal(deleted.state, STATES.DELETED);
    assert.ok(deleted.deletedAt);

    const newObjectId = crypto.randomUUID();
    const second = await createOrGetReferenceJob(scopedPool, {
      binding: {
        ...binding,
        referenceSha256: sha('reference-v2'),
        derivationManifestSha256: sha('manifest-v2'),
      },
      provider: 'r2',
      objectId: newObjectId,
      objectKey: 'references/v1/face/' + newObjectId + '.sgref',
    });
    assert.equal(second.created, true);
    assert.equal(second.job.state, STATES.PENDING);

    console.log(
      'primary_reference_lifecycle_pg_test: PASS — durable idempotency, authority conflict, upload retry, commit visibility, fail-closed withdrawal, delete retry and terminal deletion',
    );
  } finally {
    try {
      await client.query('RESET search_path');
      await client.query('DROP SCHEMA IF EXISTS ' + safeSchema + ' CASCADE');
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
