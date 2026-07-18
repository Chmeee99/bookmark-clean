import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";
import type { JobQueueFailure } from "../../modules/jobs/public.js";

interface UnknownRecord {
  readonly [key: string]: unknown;
}

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  get(...parameters: unknown[]): SqliteRow | undefined;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

type JobState =
  | "pending"
  | "leased"
  | "succeeded"
  | "retry_wait"
  | "failed"
  | "cancelled";
type BatchState = "active" | "paused" | "cancelled";

interface LeaseRow {
  readonly id: string;
  readonly state: JobState;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: IsoDateTime;
  readonly batchState?: BatchState;
}

interface StoredBatchRow {
  readonly id: string;
  readonly state: BatchState;
  readonly changedAt: IsoDateTime;
}

interface StoredQueueIntegrityApi {
  rejectStoredQueue(): never;
}

declare const require: (specifier: string) => unknown;

const { rejectStoredQueue } = (require as unknown as (
  specifier: string,
) => unknown)("./jobs-stored-queue-integrity.ts") as StoredQueueIntegrityApi;

const JOB_STATES: readonly JobState[] = [
  "pending",
  "leased",
  "succeeded",
  "retry_wait",
  "failed",
  "cancelled",
];
const BATCH_STATES: readonly BatchState[] = ["active", "paused", "cancelled"];
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isCanonicalUtc(value: unknown): value is IsoDateTime {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isJobState(value: unknown): value is JobState {
  return typeof value === "string" && JOB_STATES.includes(value as JobState);
}

function isBatchState(value: unknown): value is BatchState {
  return typeof value === "string" && BATCH_STATES.includes(value as BatchState);
}

function requireChangedExactlyOnce(result: unknown): void {
  if (
    !isRecord(result) ||
    (result.changes !== 1 && result.changes !== 1n)
  ) {
    throw new Error("SQLite compare-and-set changed an unexpected number of rows");
  }
}

function rollbackBestEffort(database: SqliteDatabase): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Rollback is best effort after an engine failure.
  }
}

function readLeaseRow(
  database: SqliteDatabase,
  token: string,
  includeBatchState: boolean,
): LeaseRow | undefined {
  const batchState = includeBatchState
    ? ", job_batches.state AS batch_state"
    : "";
  const join = includeBatchState
    ? " LEFT JOIN job_batches ON job_batches.id = jobs.batch_id"
    : "";
  const row = database
    .prepare(
      "SELECT jobs.id, jobs.state, jobs.attempt, jobs.max_attempts, " +
        "jobs.lease_token, jobs.lease_expires_at" +
        batchState +
        " FROM jobs" +
        join +
        " WHERE jobs.lease_token = ?",
    )
    .get(token);
  if (row === undefined) return undefined;
  if (
    !isNonEmptyString(row.id) ||
    !isJobState(row.state) ||
    !isSafeInteger(row.attempt) ||
    row.attempt < 0 ||
    !isSafeInteger(row.max_attempts) ||
    row.max_attempts <= 0 ||
    !isNonEmptyString(row.lease_token) ||
    !isCanonicalUtc(row.lease_expires_at) ||
    (includeBatchState && !isBatchState(row.batch_state))
  ) {
    rejectStoredQueue();
  }
  return {
    id: row.id as string,
    state: row.state as JobState,
    attempt: row.attempt as number,
    maxAttempts: row.max_attempts as number,
    leaseToken: row.lease_token as string,
    leaseExpiresAt: row.lease_expires_at as IsoDateTime,
    ...(includeBatchState ? { batchState: row.batch_state as BatchState } : {}),
  };
}

function readBatchRow(row: SqliteRow): StoredBatchRow {
  if (
    !isNonEmptyString(row.id) ||
    !isBatchState(row.state) ||
    !isCanonicalUtc(row.changed_at)
  ) {
    rejectStoredQueue();
  }
  return {
    id: row.id as string,
    state: row.state as BatchState,
    changedAt: row.changed_at as IsoDateTime,
  };
}

function isCurrentLease(
  lease: LeaseRow,
  expectedAttempt: number,
  commandTime: IsoDateTime,
): boolean {
  return (
    lease.state === "leased" &&
    lease.attempt === expectedAttempt &&
    lease.leaseExpiresAt > commandTime
  );
}

function failure(code: JobQueueFailure["code"]): Outcome<void, JobQueueFailure> {
  return { ok: false, error: { code } };
}

function storageUnavailable(): Outcome<void, JobQueueFailure> {
  return failure("storage_unavailable");
}
function invalidRequest(): Outcome<void, JobQueueFailure> {
  return failure("invalid_request");
}
function staleLease(): Outcome<void, JobQueueFailure> {
  return failure("stale_lease");
}
function batchNotFound(): Outcome<void, JobQueueFailure> {
  return failure("batch_not_found");
}
function invalidTransition(): Outcome<void, JobQueueFailure> {
  return failure("invalid_transition");
}
function success(): Outcome<void, JobQueueFailure> {
  return { ok: true, value: undefined };
}

interface TransitionStoreApi {
  readLeaseRow: typeof readLeaseRow;
  readBatchRow: typeof readBatchRow;
  isCurrentLease: typeof isCurrentLease;
  requireChangedExactlyOnce: typeof requireChangedExactlyOnce;
  rollbackBestEffort: typeof rollbackBestEffort;
  storageUnavailable: typeof storageUnavailable;
  invalidRequest: typeof invalidRequest;
  staleLease: typeof staleLease;
  batchNotFound: typeof batchNotFound;
  invalidTransition: typeof invalidTransition;
  success: typeof success;
}

declare const module: { exports: TransitionStoreApi };

module.exports = {
  readLeaseRow,
  readBatchRow,
  isCurrentLease,
  requireChangedExactlyOnce,
  rollbackBestEffort,
  storageUnavailable,
  invalidRequest,
  staleLease,
  batchNotFound,
  invalidTransition,
  success,
};
