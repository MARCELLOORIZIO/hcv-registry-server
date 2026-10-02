'use strict';

const crypto = require('crypto');
const {
  logicalIdempotencyKey,
  validateBinding,
} = require('./primary_reference_provider');

const STATES = Object.freeze({
  PENDING: 'PENDING',
  UPLOADING: 'UPLOADING',
  RETRY_WAIT: 'RETRY_WAIT',
  COMMITTED: 'COMMITTED',
  DELETE_PENDING: 'DELETE_PENDING',
  DELETED: 'DELETED',
  FAILED_PERMANENT: 'FAILED_PERMANENT',
});

const RETRYABLE_UPLOAD_STATES = new Set([
  STATES.PENDING,
  STATES.RETRY_WAIT,
]);
const ACTIVE_AUTHORITY_STATES = new Set([
  STATES.PENDING,
  STATES.UPLOADING,
  STATES.RETRY_WAIT,
  STATES.COMMITTED,
]);

function retryDelayMs(attempt, {
  baseMs = 15000,
  maxMs = 60 * 60 * 1000,
} = {}) {
  const normalized = Math.max(1, Number(attempt) || 1);
  return Math.min(maxMs, baseMs * (2 ** Math.min(12, normalized - 1)));
}

function lifecycleError(code, statusCode = 409) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function validProvider(value) {
  return value === 'r2' || value === 'youtube';
}

function rowEnvelope(row) {
  if (!row) return null;
  return {
    jobId: row.job_id,
    hcvId: row.hcv_id,
    referenceRole: row.reference_role,
    referenceSha256: row.reference_sha256,
    originalContentSha256: row.original_content_sha256,
    hcvpackSha256: row.hcvpack_sha256,
    derivationManifestSha256: row.derivation_manifest_sha256,
    mediaType: row.media_type,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    objectId: row.object_id,
    objectKey: row.object_key,
    state: row.state,
    attemptCount: Number(row.attempt_count || 0),
    deleteAttemptCount: Number(row.delete_attempt_count || 0),
    nextAttemptAt: row.next_attempt_at || null,
    deleteNextAttemptAt: row.delete_next_attempt_at || null,
    lastErrorCode: row.last_error_code || '',
    receipt: row.receipt_json || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    committedAt: row.committed_at || null,
    deleteRequestedAt: row.delete_requested_at || null,
    deletedAt: row.deleted_at || null,
  };
}

async function initPrimaryReferenceLifecycleSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS verified_originals_reference_jobs (
      job_id TEXT PRIMARY KEY,
      hcv_id TEXT NOT NULL REFERENCES certificates(hcv_id) ON DELETE CASCADE,
      reference_role TEXT NOT NULL
        CHECK(reference_role IN ('ORIGINAL_REFERENCE','DERIVED_REFERENCE')),
      reference_sha256 TEXT NOT NULL,
      original_content_sha256 TEXT NOT NULL,
      hcvpack_sha256 TEXT NOT NULL,
      derivation_manifest_sha256 TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('video','photo')),
      idempotency_key TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL CHECK(provider IN ('r2','youtube')),
      object_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN (
        'PENDING','UPLOADING','RETRY_WAIT','COMMITTED',
        'DELETE_PENDING','DELETED','FAILED_PERMANENT'
      )),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      delete_attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ,
      delete_next_attempt_at TIMESTAMPTZ,
      last_error_code TEXT NOT NULL DEFAULT '',
      receipt_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      committed_at TIMESTAMPTZ,
      delete_requested_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS verified_originals_reference_jobs_hcv_idx
      ON verified_originals_reference_jobs(hcv_id, reference_role, created_at DESC);

    CREATE INDEX IF NOT EXISTS verified_originals_reference_jobs_retry_idx
      ON verified_originals_reference_jobs(state, next_attempt_at, created_at);

    CREATE INDEX IF NOT EXISTS verified_originals_reference_jobs_delete_retry_idx
      ON verified_originals_reference_jobs(
        state, delete_next_attempt_at, delete_requested_at
      );

    CREATE UNIQUE INDEX IF NOT EXISTS verified_originals_reference_authority_idx
      ON verified_originals_reference_jobs(hcv_id, reference_role)
      WHERE state IN ('PENDING','UPLOADING','RETRY_WAIT','COMMITTED');
  `);
}

async function createOrGetReferenceJob(pool, {
  binding,
  provider,
  objectId,
  objectKey,
}) {
  const validated = validateBinding({ ...binding, objectId });
  if (!validProvider(provider)) {
    throw lifecycleError('PRIMARY_REFERENCE_PROVIDER_INVALID', 400);
  }
  if (!objectKey || typeof objectKey !== 'string') {
    throw lifecycleError('PRIMARY_REFERENCE_OBJECT_KEY_INVALID', 400);
  }
  const idempotencyKey = logicalIdempotencyKey(validated);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const same = (await client.query(`
      SELECT * FROM verified_originals_reference_jobs
      WHERE idempotency_key=$1
      FOR UPDATE
    `, [idempotencyKey])).rows[0];
    if (same) {
      await client.query('COMMIT');
      return { created: false, job: rowEnvelope(same) };
    }

    const authority = (await client.query(`
      SELECT * FROM verified_originals_reference_jobs
      WHERE hcv_id=$1
        AND reference_role=$2
        AND state IN ('PENDING','UPLOADING','RETRY_WAIT','COMMITTED')
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `, [validated.hcvId, validated.referenceRole])).rows[0];

    if (authority) {
      throw lifecycleError('PRIMARY_REFERENCE_ROLE_CONFLICT', 409);
    }

    const jobId = crypto.randomUUID();
    const inserted = (await client.query(`
      INSERT INTO verified_originals_reference_jobs(
        job_id,hcv_id,reference_role,reference_sha256,
        original_content_sha256,hcvpack_sha256,derivation_manifest_sha256,
        media_type,idempotency_key,provider,object_id,object_key,state
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING')
      RETURNING *
    `, [
      jobId,
      validated.hcvId,
      validated.referenceRole,
      validated.referenceSha256,
      validated.originalContentSha256,
      validated.hcvpackSha256,
      validated.derivationManifestSha256,
      validated.mediaType,
      idempotencyKey,
      provider,
      objectId,
      objectKey,
    ])).rows[0];

    await client.query('COMMIT');
    return { created: true, job: rowEnvelope(inserted) };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (error?.code === '23505') {
      const same = (await pool.query(`
        SELECT * FROM verified_originals_reference_jobs
        WHERE idempotency_key=$1
      `, [idempotencyKey])).rows[0];
      if (same) return { created: false, job: rowEnvelope(same) };
      throw lifecycleError('PRIMARY_REFERENCE_ROLE_CONFLICT', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function claimUploadJobs(pool, {
  limit = 25,
  provider = 'r2',
} = {}) {
  if (!validProvider(provider)) {
    throw lifecycleError('PRIMARY_REFERENCE_PROVIDER_INVALID', 400);
  }
  const bounded = Math.max(1, Math.min(100, Number(limit) || 25));
  const rows = (await pool.query(`
    WITH candidates AS (
      SELECT job_id
      FROM verified_originals_reference_jobs
      WHERE provider=$1
        AND (
          state='PENDING'
          OR (
            state='RETRY_WAIT'
            AND (next_attempt_at IS NULL OR next_attempt_at<=NOW())
          )
        )
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $2
    )
    UPDATE verified_originals_reference_jobs j
    SET state='UPLOADING',
        attempt_count=j.attempt_count+1,
        next_attempt_at=NULL,
        updated_at=NOW()
    FROM candidates
    WHERE j.job_id=candidates.job_id
    RETURNING j.*
  `, [provider, bounded])).rows;
  return rows.map(rowEnvelope);
}

async function markUploadRetry(pool, jobId, errorCode, {
  delayMs = null,
} = {}) {
  const current = (await pool.query(`
    SELECT attempt_count,state FROM verified_originals_reference_jobs
    WHERE job_id=$1
  `, [jobId])).rows[0];
  if (!current) throw lifecycleError('PRIMARY_REFERENCE_JOB_NOT_FOUND', 404);
  if (current.state !== STATES.UPLOADING) {
    throw lifecycleError('PRIMARY_REFERENCE_UPLOAD_STATE_CONFLICT', 409);
  }
  const resolvedDelay = delayMs == null
    ? retryDelayMs(current.attempt_count)
    : Math.max(0, Number(delayMs) || 0);
  const row = (await pool.query(`
    UPDATE verified_originals_reference_jobs
    SET state='RETRY_WAIT',
        next_attempt_at=NOW()+($2::double precision * INTERVAL '1 millisecond'),
        last_error_code=$3,
        updated_at=NOW()
    WHERE job_id=$1 AND state='UPLOADING'
    RETURNING *
  `, [jobId, resolvedDelay, String(errorCode || 'PROVIDER_RETRY')])).rows[0];
  if (!row) throw lifecycleError('PRIMARY_REFERENCE_UPLOAD_STATE_CONFLICT', 409);
  return rowEnvelope(row);
}

async function markUploadPermanentFailure(pool, jobId, errorCode) {
  const row = (await pool.query(`
    UPDATE verified_originals_reference_jobs
    SET state='FAILED_PERMANENT',
        next_attempt_at=NULL,
        last_error_code=$2,
        updated_at=NOW()
    WHERE job_id=$1
      AND state IN ('PENDING','UPLOADING','RETRY_WAIT')
    RETURNING *
  `, [jobId, String(errorCode || 'PROVIDER_PERMANENT_FAILURE')])).rows[0];
  if (!row) throw lifecycleError('PRIMARY_REFERENCE_UPLOAD_STATE_CONFLICT', 409);
  return rowEnvelope(row);
}

async function markCommitted(pool, jobId, receipt) {
  if (!receipt || receipt.provider !== 'r2' || !receipt.objectKey) {
    throw lifecycleError('PRIMARY_REFERENCE_RECEIPT_INVALID', 422);
  }

  const existing = (await pool.query(`
    SELECT * FROM verified_originals_reference_jobs WHERE job_id=$1
  `, [jobId])).rows[0];
  if (!existing) throw lifecycleError('PRIMARY_REFERENCE_JOB_NOT_FOUND', 404);
  if (existing.state === STATES.COMMITTED) {
    return rowEnvelope(existing);
  }
  if (existing.state !== STATES.UPLOADING) {
    throw lifecycleError('PRIMARY_REFERENCE_COMMIT_STATE_CONFLICT', 409);
  }
  if (existing.provider !== receipt.provider ||
      existing.object_id !== receipt.objectId ||
      existing.object_key !== receipt.objectKey ||
      existing.reference_sha256 !== receipt.referenceSha256 ||
      existing.original_content_sha256 !== receipt.originalContentSha256 ||
      existing.hcvpack_sha256 !== receipt.hcvpackSha256 ||
      existing.derivation_manifest_sha256 !== receipt.derivationManifestSha256 ||
      existing.reference_role !== receipt.referenceRole ||
      existing.media_type !== receipt.mediaType ||
      existing.idempotency_key !== receipt.idempotencyKey) {
    throw lifecycleError('PRIMARY_REFERENCE_RECEIPT_BINDING_MISMATCH', 422);
  }

  const row = (await pool.query(`
    UPDATE verified_originals_reference_jobs
    SET state='COMMITTED',
        receipt_json=$2::jsonb,
        committed_at=NOW(),
        next_attempt_at=NULL,
        last_error_code='',
        updated_at=NOW()
    WHERE job_id=$1 AND state='UPLOADING'
    RETURNING *
  `, [jobId, JSON.stringify(receipt)])).rows[0];
  if (!row) throw lifecycleError('PRIMARY_REFERENCE_COMMIT_STATE_CONFLICT', 409);
  return rowEnvelope(row);
}

async function availableReference(pool, hcvId, referenceRole) {
  const row = (await pool.query(`
    SELECT * FROM verified_originals_reference_jobs
    WHERE hcv_id=$1 AND reference_role=$2 AND state='COMMITTED'
    ORDER BY committed_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  `, [hcvId, referenceRole])).rows[0];
  return rowEnvelope(row);
}

async function requestDelete(pool, jobId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = (await client.query(`
      SELECT * FROM verified_originals_reference_jobs
      WHERE job_id=$1
      FOR UPDATE
    `, [jobId])).rows[0];
    if (!existing) throw lifecycleError('PRIMARY_REFERENCE_JOB_NOT_FOUND', 404);
    if (existing.state === STATES.DELETED ||
        existing.state === STATES.DELETE_PENDING) {
      await client.query('COMMIT');
      return rowEnvelope(existing);
    }
    if (existing.state !== STATES.COMMITTED) {
      throw lifecycleError('PRIMARY_REFERENCE_DELETE_STATE_CONFLICT', 409);
    }
    const row = (await client.query(`
      UPDATE verified_originals_reference_jobs
      SET state='DELETE_PENDING',
          delete_requested_at=COALESCE(delete_requested_at,NOW()),
          delete_next_attempt_at=NOW(),
          updated_at=NOW()
      WHERE job_id=$1 AND state='COMMITTED'
      RETURNING *
    `, [jobId])).rows[0];
    await client.query('COMMIT');
    return rowEnvelope(row);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function claimDeleteJobs(pool, {
  limit = 25,
  provider = 'r2',
} = {}) {
  if (!validProvider(provider)) {
    throw lifecycleError('PRIMARY_REFERENCE_PROVIDER_INVALID', 400);
  }
  const bounded = Math.max(1, Math.min(100, Number(limit) || 25));
  const rows = (await pool.query(`
    WITH candidates AS (
      SELECT job_id
      FROM verified_originals_reference_jobs
      WHERE provider=$1
        AND state='DELETE_PENDING'
        AND (
          delete_next_attempt_at IS NULL
          OR delete_next_attempt_at<=NOW()
        )
      ORDER BY delete_requested_at ASC NULLS LAST, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $2
    )
    UPDATE verified_originals_reference_jobs j
    SET delete_attempt_count=j.delete_attempt_count+1,
        delete_next_attempt_at=NULL,
        updated_at=NOW()
    FROM candidates
    WHERE j.job_id=candidates.job_id
    RETURNING j.*
  `, [provider, bounded])).rows;
  return rows.map(rowEnvelope);
}

async function markDeleteRetry(pool, jobId, errorCode, {
  delayMs = null,
} = {}) {
  const current = (await pool.query(`
    SELECT delete_attempt_count,state
    FROM verified_originals_reference_jobs
    WHERE job_id=$1
  `, [jobId])).rows[0];
  if (!current) throw lifecycleError('PRIMARY_REFERENCE_JOB_NOT_FOUND', 404);
  if (current.state !== STATES.DELETE_PENDING) {
    throw lifecycleError('PRIMARY_REFERENCE_DELETE_STATE_CONFLICT', 409);
  }
  const resolvedDelay = delayMs == null
    ? retryDelayMs(current.delete_attempt_count)
    : Math.max(0, Number(delayMs) || 0);
  const row = (await pool.query(`
    UPDATE verified_originals_reference_jobs
    SET delete_next_attempt_at=
          NOW()+($2::double precision * INTERVAL '1 millisecond'),
        last_error_code=$3,
        updated_at=NOW()
    WHERE job_id=$1 AND state='DELETE_PENDING'
    RETURNING *
  `, [jobId, resolvedDelay, String(errorCode || 'PROVIDER_DELETE_RETRY')])).rows[0];
  if (!row) throw lifecycleError('PRIMARY_REFERENCE_DELETE_STATE_CONFLICT', 409);
  return rowEnvelope(row);
}

async function markDeleted(pool, jobId) {
  const row = (await pool.query(`
    UPDATE verified_originals_reference_jobs
    SET state='DELETED',
        delete_next_attempt_at=NULL,
        last_error_code='',
        deleted_at=NOW(),
        updated_at=NOW()
    WHERE job_id=$1 AND state='DELETE_PENDING'
    RETURNING *
  `, [jobId])).rows[0];
  if (!row) {
    const existing = (await pool.query(`
      SELECT * FROM verified_originals_reference_jobs WHERE job_id=$1
    `, [jobId])).rows[0];
    if (existing?.state === STATES.DELETED) return rowEnvelope(existing);
    throw lifecycleError('PRIMARY_REFERENCE_DELETE_STATE_CONFLICT', 409);
  }
  return rowEnvelope(row);
}

async function deleteOrphanedNonCommittedJobs(pool, {
  olderThanHours = 24,
} = {}) {
  const hours = Math.max(1, Math.min(168, Number(olderThanHours) || 24));
  const rows = (await pool.query(`
    UPDATE verified_originals_reference_jobs
    SET state='FAILED_PERMANENT',
        next_attempt_at=NULL,
        last_error_code='ORPHAN_RECLAIMED',
        updated_at=NOW()
    WHERE state IN ('PENDING','RETRY_WAIT')
      AND created_at < NOW()-($1::double precision * INTERVAL '1 hour')
    RETURNING *
  `, [hours])).rows;
  return rows.map(rowEnvelope);
}

module.exports = {
  ACTIVE_AUTHORITY_STATES,
  RETRYABLE_UPLOAD_STATES,
  STATES,
  availableReference,
  claimDeleteJobs,
  claimUploadJobs,
  createOrGetReferenceJob,
  deleteOrphanedNonCommittedJobs,
  initPrimaryReferenceLifecycleSchema,
  lifecycleError,
  markCommitted,
  markDeleteRetry,
  markDeleted,
  markUploadPermanentFailure,
  markUploadRetry,
  requestDelete,
  retryDelayMs,
  rowEnvelope,
};
