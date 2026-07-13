import type { Outcome } from "../../core/contracts/public.js";
import type { JobQueueFailure } from "../../modules/jobs/public.js";

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

const MIGRATION_KEY = "002_jobs";

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);`;

const JOBS_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS job_batches (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'cancelled')),
  total_count INTEGER NOT NULL CHECK (total_count > 0),
  created_at TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES job_batches(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type = 'health_check'),
  target_kind TEXT NOT NULL CHECK (target_kind = 'bookmark'),
  bookmark_id TEXT NOT NULL,
  input_version TEXT NOT NULL,
  priority INTEGER NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  not_before TEXT,
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'leased', 'succeeded', 'retry_wait', 'failed', 'cancelled')
  ),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  lease_token TEXT UNIQUE,
  worker_id TEXT,
  leased_at TEXT,
  lease_expires_at TEXT,
  retry_at TEXT,
  result_kind TEXT,
  result_id TEXT,
  failure_code TEXT,
  failure_disposition TEXT,
  failure_diagnostic TEXT,
  completed_at TEXT,
  UNIQUE (batch_id, sequence),
  CHECK (
    (state = 'leased' AND lease_token IS NOT NULL AND worker_id IS NOT NULL
      AND leased_at IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (state <> 'leased' AND lease_token IS NULL AND worker_id IS NULL
      AND leased_at IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (state = 'retry_wait' AND retry_at IS NOT NULL)
    OR (state <> 'retry_wait' AND retry_at IS NULL)
  ),
  CHECK (
    (state = 'succeeded' AND result_kind = 'health_observation'
      AND result_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (state <> 'succeeded' AND result_kind IS NULL AND result_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS jobs_batch_state
  ON jobs(batch_id, state);

CREATE INDEX IF NOT EXISTS jobs_lease_expiry
  ON jobs(state, lease_expires_at)
  WHERE state = 'leased';

CREATE INDEX IF NOT EXISTS jobs_eligibility
  ON jobs(state, type, priority DESC, sequence ASC, not_before, retry_at);`;

function storageUnavailable(): Outcome<void, JobQueueFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function rollbackBestEffort(database: SqliteDatabase): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Rollback is best effort after an engine failure.
  }
}

function migrateJobsSchema(
  database: SqliteDatabase,
): Outcome<void, JobQueueFailure> {
  let transactionStarted = false;

  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    database.exec(MIGRATIONS_TABLE_DDL);

    const existing = database
      .prepare("SELECT migration_key FROM schema_migrations WHERE migration_key = ?")
      .get(MIGRATION_KEY);
    if (existing !== undefined) {
      database.exec("COMMIT");
      transactionStarted = false;
      return { ok: true, value: undefined };
    }

    database.exec(JOBS_SCHEMA_DDL);
    database
      .prepare(
        "INSERT INTO schema_migrations(migration_key, applied_at) " +
          "VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
      )
      .run(MIGRATION_KEY);
    database.exec("COMMIT");
    transactionStarted = false;
    return { ok: true, value: undefined };
  } catch {
    if (transactionStarted) {
      rollbackBestEffort(database);
    }
    return storageUnavailable();
  }
}

declare const module: {
  exports: {
    migrateJobsSchema: typeof migrateJobsSchema;
  };
};

module.exports = { migrateJobsSchema };
