import type {
  IsoDateTime,
  JobBatchId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  JobProgress,
  JobQueueFailure,
} from "../../modules/jobs/public.js";

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  all(...parameters: unknown[]): SqliteRow[];
  get(...parameters: unknown[]): SqliteRow | undefined;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface ExpiredLeaseRecoveryApi {
  recoverExpiredLeases(database: SqliteDatabase, now: IsoDateTime): void;
}

interface ProgressValidationApi {
  readBatchRow(row: SqliteRow): {
    readonly id: string;
    readonly state: "active" | "paused" | "cancelled";
    readonly totalCount: number;
  };
  readJobRow(row: SqliteRow): {
    readonly state:
      | "pending"
      | "leased"
      | "succeeded"
      | "retry_wait"
      | "failed"
      | "cancelled";
    readonly notBefore: IsoDateTime | null;
    readonly retryAt: IsoDateTime | null;
    readonly leaseExpiresAt: IsoDateTime | null;
  };
  buildProgress(
    batch: {
      readonly id: string;
      readonly state: "active" | "paused" | "cancelled";
      readonly totalCount: number;
    },
    jobs: readonly {
      readonly state:
        | "pending"
        | "leased"
        | "succeeded"
        | "retry_wait"
        | "failed"
        | "cancelled";
      readonly notBefore: IsoDateTime | null;
      readonly retryAt: IsoDateTime | null;
      readonly leaseExpiresAt: IsoDateTime | null;
    }[],
    now: IsoDateTime,
  ): JobProgress;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { recoverExpiredLeases } = loadModule(
  "./jobs-expired-lease.ts",
) as ExpiredLeaseRecoveryApi;
const { readBatchRow, readJobRow, buildProgress } = loadModule(
  "./jobs-progress-validation.ts",
) as ProgressValidationApi;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCanonicalUtc(value: unknown): value is IsoDateTime {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function invalidRequest(): Outcome<JobProgress, JobQueueFailure> {
  return { ok: false, error: { code: "invalid_request" } };
}

function batchNotFound(): Outcome<JobProgress, JobQueueFailure> {
  return { ok: false, error: { code: "batch_not_found" } };
}

function storageUnavailable(): Outcome<JobProgress, JobQueueFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function rollbackBestEffort(database: SqliteDatabase): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Rollback is best effort after an engine failure.
  }
}

function readJobsProgress(
  database: SqliteDatabase,
  batchId: JobBatchId,
  now: IsoDateTime,
): Outcome<JobProgress, JobQueueFailure> {
  if (!isNonEmptyString(batchId) || !isCanonicalUtc(now)) {
    return invalidRequest();
  }

  let transactionStarted = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    recoverExpiredLeases(database, now);
    const batchRow = database
      .prepare(
        "SELECT id, state, total_count, created_at, changed_at " +
          "FROM job_batches WHERE id = ?",
      )
      .get(batchId);
    if (batchRow === undefined) {
      database.exec("COMMIT");
      transactionStarted = false;
      return batchNotFound();
    }

    const batch = readBatchRow(batchRow);
    const jobs = database
      .prepare(
        "SELECT id, state, not_before, retry_at, lease_expires_at " +
          "FROM jobs WHERE batch_id = ?",
      )
      .all(batchId)
      .map(readJobRow);
    const progress = buildProgress(batch, jobs, now);
    database.exec("COMMIT");
    transactionStarted = false;
    return { ok: true, value: progress };
  } catch {
    if (transactionStarted) {
      rollbackBestEffort(database);
    }
    return storageUnavailable();
  }
}

declare const module: {
  exports: {
    readJobsProgress: typeof readJobsProgress;
  };
};

module.exports = { readJobsProgress };
