import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";
import type {
  EnqueueBatchRequest,
  EnqueueJob,
  JobBatchSummary,
  JobQueueFailure,
  StoredEnqueueCommand,
} from "../../modules/jobs/public.js";

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

interface UnknownRecord {
  readonly [key: string]: unknown;
}

const COMMAND_KEYS = [
  "request",
  "requestFingerprint",
  "batchId",
  "jobIds",
  "createdAt",
] as const;
const REQUEST_KEYS = ["idempotencyKey", "jobs"] as const;
const JOB_KEYS = ["type", "target", "priority", "sequence", "maxAttempts"] as const;
const TARGET_KEYS = ["kind", "bookmarkId", "inputVersion"] as const;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

function hasArrayShape(value: readonly unknown[]): boolean {
  return Reflect.ownKeys(value).every((key) => {
    if (key === "length") {
      return true;
    }
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
      return false;
    }
    return Number(key) < value.length;
  });
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

function validateTarget(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, TARGET_KEYS) &&
    value.kind === "bookmark" &&
    isNonEmptyString(value.bookmarkId) &&
    isNonEmptyString(value.inputVersion)
  );
}

function validateCommand(input: unknown): input is StoredEnqueueCommand {
  if (!isRecord(input) || !hasExactKeys(input, COMMAND_KEYS)) {
    return false;
  }
  if (
    !isRecord(input.request) ||
    !hasExactKeys(input.request, REQUEST_KEYS) ||
    !isNonEmptyString(input.requestFingerprint) ||
    !isNonEmptyString(input.batchId) ||
    !isCanonicalUtc(input.createdAt) ||
    !Array.isArray(input.jobIds) ||
    !hasArrayShape(input.jobIds) ||
    input.jobIds.length === 0 ||
    !input.jobIds.every(isNonEmptyString) ||
    new Set([input.batchId, ...input.jobIds]).size !== input.jobIds.length + 1
  ) {
    return false;
  }

  for (let index = 0; index < input.jobIds.length; index += 1) {
    if (
      !hasOwn(input.jobIds, String(index)) ||
      !isNonEmptyString(input.jobIds[index])
    ) {
      return false;
    }
  }

  const request = input.request;
  if (
    !isNonEmptyString(request.idempotencyKey) ||
    !Array.isArray(request.jobs) ||
    !hasArrayShape(request.jobs) ||
    request.jobs.length === 0 ||
    request.jobs.length !== input.jobIds.length
  ) {
    return false;
  }

  const sequences = new Set<number>();
  for (let index = 0; index < request.jobs.length; index += 1) {
    if (!hasOwn(request.jobs, String(index))) {
      return false;
    }
    const job = request.jobs[index];
    if (
      !isRecord(job) ||
      !hasExactKeys(job, JOB_KEYS, ["notBefore"]) ||
      job.type !== "health_check" ||
      !validateTarget(job.target) ||
      !Number.isSafeInteger(job.priority) ||
      !Number.isSafeInteger(job.sequence) ||
      job.sequence < 0 ||
      sequences.has(job.sequence) ||
      !Number.isSafeInteger(job.maxAttempts) ||
      job.maxAttempts <= 0 ||
      (hasOwn(job, "notBefore") && !isCanonicalUtc(job.notBefore))
    ) {
      return false;
    }
    sequences.add(job.sequence);
  }
  return true;
}

function invalidRequest(): Outcome<JobBatchSummary, JobQueueFailure> {
  return { ok: false, error: { code: "invalid_request" } };
}

function storageUnavailable(): Outcome<JobBatchSummary, JobQueueFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function rollbackBestEffort(database: SqliteDatabase): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Rollback is best effort after an engine failure.
  }
}

function summaryFromRow(row: SqliteRow): JobBatchSummary {
  return {
    batchId: row.id as JobBatchSummary["batchId"],
    state: row.state as JobBatchSummary["state"],
    totalCount: row.total_count as number,
    createdAt: row.created_at as IsoDateTime,
  };
}

function enqueueJobsBatch(
  database: SqliteDatabase,
  command: StoredEnqueueCommand,
): Outcome<JobBatchSummary, JobQueueFailure> {
  if (!validateCommand(command)) {
    return invalidRequest();
  }

  let transactionStarted = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const existing = database
      .prepare(
        "SELECT id, request_fingerprint, state, total_count, created_at " +
          "FROM job_batches WHERE idempotency_key = ?",
      )
      .get(command.request.idempotencyKey);

    if (existing !== undefined) {
      if (existing.request_fingerprint !== command.requestFingerprint) {
        rollbackBestEffort(database);
        transactionStarted = false;
        return { ok: false, error: { code: "idempotency_conflict" } };
      }
      const summary = summaryFromRow(existing);
      database.exec("COMMIT");
      transactionStarted = false;
      return { ok: true, value: summary };
    }

    const ids = [command.batchId, ...command.jobIds];
    const placeholders = ids.map(() => "?").join(", ");
    const collision = database
      .prepare(
        `SELECT id FROM job_batches WHERE id IN (${placeholders}) ` +
          `UNION ALL SELECT id FROM jobs WHERE id IN (${placeholders}) LIMIT 1`,
      )
      .get(...ids, ...ids);
    if (collision !== undefined) {
      rollbackBestEffort(database);
      transactionStarted = false;
      return invalidRequest();
    }

    database
      .prepare(
        "INSERT INTO job_batches " +
          "(id, idempotency_key, request_fingerprint, state, total_count, created_at, changed_at) " +
          "VALUES (?, ?, ?, 'active', ?, ?, ?)",
      )
      .run(
        command.batchId,
        command.request.idempotencyKey,
        command.requestFingerprint,
        command.request.jobs.length,
        command.createdAt,
        command.createdAt,
      );

    const insertJob = database.prepare(
      "INSERT INTO jobs " +
        "(id, batch_id, type, target_kind, bookmark_id, input_version, priority, sequence, max_attempts, not_before, state) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
    );
    for (let index = 0; index < command.request.jobs.length; index += 1) {
      const job = command.request.jobs[index] as EnqueueJob;
      insertJob.run(
        command.jobIds[index],
        command.batchId,
        job.type,
        job.target.kind,
        job.target.bookmarkId,
        job.target.inputVersion,
        job.priority,
        job.sequence,
        job.maxAttempts,
        job.notBefore === undefined ? null : job.notBefore,
      );
    }

    database.exec("COMMIT");
    transactionStarted = false;
    return {
      ok: true,
      value: {
        batchId: command.batchId,
        state: "active",
        totalCount: command.request.jobs.length,
        createdAt: command.createdAt,
      },
    };
  } catch {
    if (transactionStarted) {
      rollbackBestEffort(database);
    }
    return storageUnavailable();
  }
}

declare const module: {
  exports: {
    enqueueJobsBatch: typeof enqueueJobsBatch;
  };
};

module.exports = { enqueueJobsBatch };
