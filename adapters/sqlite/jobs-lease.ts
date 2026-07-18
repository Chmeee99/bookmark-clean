import type {
  BookmarkId,
  IsoDateTime,
  JobBatchId,
  JobId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  JobLease,
  JobQueueFailure,
  JobType,
  StoredLeaseCommand,
} from "../../modules/jobs/public.js";

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  all(...parameters: unknown[]): SqliteRow[];
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

interface ExpiredLeaseRecoveryApi { recoverExpiredLeases(database: SqliteDatabase, now: IsoDateTime): void; }
interface StoredQueueIntegrityApi {
  rejectStoredQueue(): never;
  isStoredQueueInvalid(error: unknown): boolean;
}

declare const require: (specifier: string) => unknown;

const COMMAND_KEYS = [
  "worker",
  "capabilities",
  "now",
  "expiresAt",
  "token",
] as const;
const WORKER_KEYS = ["id"] as const;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const { recoverExpiredLeases } = (require as unknown as (specifier: string) => unknown)(
  "./jobs-expired-lease.ts",
) as ExpiredLeaseRecoveryApi;
const { rejectStoredQueue, isStoredQueueInvalid } = (require as unknown as (
  specifier: string,
) => unknown)("./jobs-stored-queue-integrity.ts") as StoredQueueIntegrityApi;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  record: UnknownRecord,
  required: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(record);
  return (
    keys.length === required.length &&
    keys.every((key) => typeof key === "string" && required.includes(key)) &&
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

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
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

function validateCommand(input: unknown): input is StoredLeaseCommand {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, COMMAND_KEYS) ||
    !isRecord(input.worker) ||
    !hasExactKeys(input.worker, WORKER_KEYS) ||
    !isNonEmptyString(input.worker.id) ||
    !Array.isArray(input.capabilities) ||
    !hasArrayShape(input.capabilities) ||
    input.capabilities.length === 0 ||
    !isCanonicalUtc(input.now) ||
    !isCanonicalUtc(input.expiresAt) ||
    input.expiresAt <= input.now ||
    !isNonEmptyString(input.token)
  ) {
    return false;
  }

  const capabilities = input.capabilities as readonly unknown[];
  const seen = new Set<JobType>();
  for (let index = 0; index < capabilities.length; index += 1) {
    if (!hasOwn(capabilities, String(index))) {
      return false;
    }
    const capability = capabilities[index];
    if (capability !== "health_check" || seen.has(capability)) {
      return false;
    }
    seen.add(capability);
  }
  return true;
}

function invalidRequest(): Outcome<JobLease | null, JobQueueFailure> {
  return { ok: false, error: { code: "invalid_request" } };
}

function storageUnavailable(): Outcome<JobLease | null, JobQueueFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function storedQueueInvalid(): Outcome<JobLease | null, JobQueueFailure> {
  return { ok: false, error: { code: "stored_queue_invalid" } };
}

function rollbackBestEffort(database: SqliteDatabase): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Rollback is best effort after an engine failure.
  }
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

function leaseFromRow(row: SqliteRow, command: StoredLeaseCommand): JobLease {
  if (
    !isNonEmptyString(row.id) ||
    !isNonEmptyString(row.batch_id) ||
    row.type !== "health_check" ||
    row.target_kind !== "bookmark" ||
    !isNonEmptyString(row.bookmark_id) ||
    !isNonEmptyString(row.input_version) ||
    !isSafeInteger(row.attempt) ||
    row.attempt < 0
  ) {
    rejectStoredQueue();
  }
  const attempt = (row.attempt as number) + 1;
  if (!Number.isSafeInteger(attempt)) {
    rejectStoredQueue();
  }
  return {
    token: command.token,
    jobId: row.id as JobId,
    batchId: row.batch_id as JobBatchId,
    type: "health_check",
    target: {
      kind: "bookmark",
      bookmarkId: row.bookmark_id as BookmarkId,
      inputVersion: row.input_version as string,
    },
    attempt,
    leasedAt: command.now,
    expiresAt: command.expiresAt,
  };
}

function selectLeaseCandidate(
  database: SqliteDatabase,
  command: StoredLeaseCommand,
): SqliteRow | undefined {
  const placeholders = command.capabilities.map(() => "?").join(", ");
  return database
    .prepare(
      "SELECT jobs.id, jobs.batch_id, jobs.type, jobs.target_kind, " +
        "jobs.bookmark_id, jobs.input_version, jobs.attempt, jobs.state " +
        "FROM jobs JOIN job_batches ON job_batches.id = jobs.batch_id " +
        "WHERE job_batches.state = 'active' AND jobs.type IN (" +
        placeholders +
        ") AND ((jobs.state = 'pending' AND " +
        "(jobs.not_before IS NULL OR jobs.not_before <= ?)) OR " +
        "(jobs.state = 'retry_wait' AND jobs.retry_at <= ?)) " +
        "ORDER BY jobs.priority DESC, jobs.sequence ASC, " +
        "job_batches.created_at ASC, jobs.id ASC LIMIT 1",
    )
    .get(...command.capabilities, command.now, command.now);
}

function leaseSelectedCandidate(
  database: SqliteDatabase,
  command: StoredLeaseCommand,
  candidate: SqliteRow,
): JobLease {
  if (
    !isNonEmptyString(candidate.id) ||
    !isNonEmptyString(candidate.batch_id) ||
    (candidate.state !== "pending" && candidate.state !== "retry_wait") ||
    !Number.isSafeInteger(candidate.attempt)
  ) {
    rejectStoredQueue();
  }
  requireChangedExactlyOnce(
    database
      .prepare(
        "UPDATE jobs SET state = 'leased', attempt = attempt + 1, " +
          "lease_token = ?, worker_id = ?, leased_at = ?, " +
          "lease_expires_at = ?, retry_at = NULL " +
          "WHERE id = ? AND batch_id = ? AND state = ? AND attempt = ?",
      )
      .run(
        command.token,
        command.worker.id,
        command.now,
        command.expiresAt,
        candidate.id,
        candidate.batch_id,
        candidate.state,
        candidate.attempt,
      ),
  );
  return leaseFromRow(candidate, command);
}

function leaseNextJob(
  database: SqliteDatabase,
  command: StoredLeaseCommand,
): Outcome<JobLease | null, JobQueueFailure> {
  if (!validateCommand(command)) {
    return invalidRequest();
  }

  let transactionStarted = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;

    const tokenCollision = database
      .prepare("SELECT id FROM jobs WHERE lease_token = ?")
      .get(command.token);
    if (tokenCollision !== undefined) {
      rollbackBestEffort(database);
      transactionStarted = false;
      return invalidRequest();
    }

    recoverExpiredLeases(database, command.now);
    const candidate = selectLeaseCandidate(database, command);
    if (candidate === undefined) {
      database.exec("COMMIT");
      transactionStarted = false;
      return { ok: true, value: null };
    }

    const lease = leaseSelectedCandidate(database, command, candidate);
    database.exec("COMMIT");
    transactionStarted = false;
    return { ok: true, value: lease };
  } catch (error) {
    if (transactionStarted) {
      rollbackBestEffort(database);
    }
    return isStoredQueueInvalid(error)
      ? storedQueueInvalid()
      : storageUnavailable();
  }
}

declare const module: {
  exports: {
    leaseNextJob: typeof leaseNextJob;
  };
};

module.exports = { leaseNextJob };
