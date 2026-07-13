import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";
import type {
  JobQueueFailure,
  StoredCompletionCommand,
  StoredFailureCommand,
} from "../../modules/jobs/public.js";

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

const COMPLETION_COMMAND_KEYS = [
  "token",
  "expectedAttempt",
  "result",
  "completedAt",
] as const;
const FAILURE_COMMAND_KEYS = [
  "token",
  "expectedAttempt",
  "failure",
  "failedAt",
] as const;
const RESULT_KEYS = ["kind", "id"] as const;
const FAILURE_KEYS = ["code", "disposition"] as const;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const JOB_STATES = [
  "pending",
  "leased",
  "succeeded",
  "retry_wait",
  "failed",
  "cancelled",
] as const;
const BATCH_STATES = ["active", "paused", "cancelled"] as const;

type JobState = (typeof JOB_STATES)[number];
type BatchState = (typeof BATCH_STATES)[number];

interface LeaseRow {
  readonly id: string;
  readonly state: JobState;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: IsoDateTime;
  readonly batchState?: BatchState;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(record);
  const allowed = [...required, ...optional];
  return (
    keys.length >= required.length &&
    keys.length <= allowed.length &&
    keys.every((key) => typeof key === "string" && allowed.includes(key)) &&
    required.every((key) => keys.includes(key))
  );
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

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

function validateCompletionCommand(
  input: unknown,
): input is StoredCompletionCommand {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, COMPLETION_COMMAND_KEYS) ||
    !isNonEmptyString(input.token) ||
    !Number.isSafeInteger(input.expectedAttempt) ||
    input.expectedAttempt <= 0 ||
    !isCanonicalUtc(input.completedAt) ||
    !isRecord(input.result) ||
    !hasExactKeys(input.result, RESULT_KEYS) ||
    input.result.kind !== "health_observation" ||
    !isNonEmptyString(input.result.id)
  ) {
    return false;
  }
  return true;
}

function validateFailureCommand(input: unknown): input is StoredFailureCommand {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, FAILURE_COMMAND_KEYS, ["retryAt"]) ||
    !isNonEmptyString(input.token) ||
    !Number.isSafeInteger(input.expectedAttempt) ||
    input.expectedAttempt <= 0 ||
    !isCanonicalUtc(input.failedAt) ||
    !isRecord(input.failure) ||
    !hasExactKeys(input.failure, FAILURE_KEYS, ["diagnostic"]) ||
    !isNonEmptyString(input.failure.code) ||
    (input.failure.disposition !== "retry" &&
      input.failure.disposition !== "terminal") ||
    (hasOwn(input.failure, "diagnostic") &&
      typeof input.failure.diagnostic !== "string")
  ) {
    return false;
  }

  if (input.failure.disposition === "retry") {
    return (
      hasOwn(input, "retryAt") &&
      isCanonicalUtc(input.retryAt) &&
      input.retryAt >= input.failedAt
    );
  }

  return !hasOwn(input, "retryAt");
}

function validateBatchStateInput(
  batchId: unknown,
  action: unknown,
  changedAt: unknown,
): boolean {
  return (
    isNonEmptyString(batchId) &&
    (action === "pause" || action === "resume" || action === "cancel") &&
    isCanonicalUtc(changedAt)
  );
}

function isJobState(value: unknown): value is JobState {
  return typeof value === "string" && JOB_STATES.includes(value as JobState);
}

function isBatchState(value: unknown): value is BatchState {
  return typeof value === "string" && BATCH_STATES.includes(value as BatchState);
}

function changedExactlyOnce(result: unknown): boolean {
  if (!isRecord(result)) {
    return false;
  }
  return result.changes === 1 || result.changes === 1n;
}

function requireChangedExactlyOnce(result: unknown): void {
  if (!changedExactlyOnce(result)) {
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
  if (row === undefined) {
    return undefined;
  }
  if (
    !isNonEmptyString(row.id) ||
    !isJobState(row.state) ||
    !Number.isSafeInteger(row.attempt) ||
    row.attempt < 0 ||
    !Number.isSafeInteger(row.max_attempts) ||
    row.max_attempts <= 0 ||
    !isNonEmptyString(row.lease_token) ||
    !isCanonicalUtc(row.lease_expires_at)
  ) {
    throw new Error("Stored lease row is invalid");
  }
  if (includeBatchState && !isBatchState(row.batch_state)) {
    throw new Error("Stored lease batch state is invalid");
  }
  return {
    id: row.id,
    state: row.state,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    ...(includeBatchState ? { batchState: row.batch_state as BatchState } : {}),
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

function storageUnavailable(): Outcome<void, JobQueueFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function invalidRequest(): Outcome<void, JobQueueFailure> {
  return { ok: false, error: { code: "invalid_request" } };
}

function staleLease(): Outcome<void, JobQueueFailure> {
  return { ok: false, error: { code: "stale_lease" } };
}

function batchNotFound(): Outcome<void, JobQueueFailure> {
  return { ok: false, error: { code: "batch_not_found" } };
}

function invalidTransition(): Outcome<void, JobQueueFailure> {
  return { ok: false, error: { code: "invalid_transition" } };
}

function success(): Outcome<void, JobQueueFailure> {
  return { ok: true, value: undefined };
}

interface ValidationApi {
  readonly isCanonicalUtc: typeof isCanonicalUtc;
  readonly isNonEmptyString: typeof isNonEmptyString;
  readonly validateCompletionCommand: typeof validateCompletionCommand;
  readonly validateFailureCommand: typeof validateFailureCommand;
  readonly validateBatchStateInput: typeof validateBatchStateInput;
  readonly isBatchState: typeof isBatchState;
  readonly readLeaseRow: typeof readLeaseRow;
  readonly isCurrentLease: typeof isCurrentLease;
  readonly requireChangedExactlyOnce: typeof requireChangedExactlyOnce;
  readonly rollbackBestEffort: typeof rollbackBestEffort;
  readonly storageUnavailable: typeof storageUnavailable;
  readonly invalidRequest: typeof invalidRequest;
  readonly staleLease: typeof staleLease;
  readonly batchNotFound: typeof batchNotFound;
  readonly invalidTransition: typeof invalidTransition;
  readonly success: typeof success;
}

declare const module: { exports: ValidationApi };

module.exports = {
  isCanonicalUtc,
  isNonEmptyString,
  validateCompletionCommand,
  validateFailureCommand,
  validateBatchStateInput,
  isBatchState,
  readLeaseRow,
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
