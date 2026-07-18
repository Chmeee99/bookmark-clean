import type { IsoDateTime } from "../../core/contracts/public.js";
import type { JobProgress } from "../../modules/jobs/public.js";

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface StoredQueueIntegrityApi {
  rejectStoredQueue(): never;
}

declare const require: (specifier: string) => unknown;

const { rejectStoredQueue } = (require as unknown as (
  specifier: string,
) => unknown)("./jobs-stored-queue-integrity.ts") as StoredQueueIntegrityApi;

type JobState =
  | "pending"
  | "leased"
  | "succeeded"
  | "retry_wait"
  | "failed"
  | "cancelled";
type BatchState = "active" | "paused" | "cancelled";

interface StoredBatch {
  readonly id: string;
  readonly state: BatchState;
  readonly totalCount: number;
}

interface StoredJob {
  readonly state: JobState;
  readonly notBefore: IsoDateTime | null;
  readonly retryAt: IsoDateTime | null;
  readonly leaseExpiresAt: IsoDateTime | null;
}

const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const JOB_STATES: readonly JobState[] = [
  "pending",
  "leased",
  "succeeded",
  "retry_wait",
  "failed",
  "cancelled",
];
const BATCH_STATES: readonly BatchState[] = ["active", "paused", "cancelled"];

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

function isSafeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isJobState(value: unknown): value is JobState {
  return typeof value === "string" && JOB_STATES.includes(value as JobState);
}

function isBatchState(value: unknown): value is BatchState {
  return typeof value === "string" && BATCH_STATES.includes(value as BatchState);
}

function readOptionalTimestamp(row: SqliteRow, key: string): IsoDateTime | null {
  if (!Object.prototype.hasOwnProperty.call(row, key)) {
    rejectStoredQueue();
  }
  if (row[key] === null) {
    return null;
  }
  if (!isCanonicalUtc(row[key])) {
    rejectStoredQueue();
  }
  return row[key] as IsoDateTime;
}

function readBatchRow(row: SqliteRow): StoredBatch {
  if (
    !isNonEmptyString(row.id) ||
    !isBatchState(row.state) ||
    !isSafeCount(row.total_count) ||
    !isCanonicalUtc(row.created_at) ||
    !isCanonicalUtc(row.changed_at)
  ) {
    rejectStoredQueue();
  }
  return {
    id: row.id as string,
    state: row.state as BatchState,
    totalCount: row.total_count as number,
  };
}

function readJobRow(row: SqliteRow): StoredJob {
  const notBefore = readOptionalTimestamp(row, "not_before");
  const retryAt = readOptionalTimestamp(row, "retry_at");
  const leaseExpiresAt = readOptionalTimestamp(row, "lease_expires_at");
  if (!isNonEmptyString(row.id) || !isJobState(row.state)) {
    rejectStoredQueue();
  }
  if ((row.state === "retry_wait") !== (retryAt !== null)) {
    rejectStoredQueue();
  }
  if ((row.state === "leased") !== (leaseExpiresAt !== null)) {
    rejectStoredQueue();
  }
  return {
    state: row.state as JobState,
    notBefore,
    retryAt,
    leaseExpiresAt,
  };
}

function addCandidate(
  current: IsoDateTime | undefined,
  candidate: IsoDateTime | null,
  now: IsoDateTime,
): IsoDateTime | undefined {
  if (candidate === null || candidate <= now) {
    return current;
  }
  return current === undefined || candidate < current ? candidate : current;
}

function buildProgress(
  batch: StoredBatch,
  jobs: readonly StoredJob[],
  now: IsoDateTime,
): JobProgress {
  const counts: Record<JobState, number> = {
    pending: 0,
    leased: 0,
    retry_wait: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  let nextEligibleAt: IsoDateTime | undefined;
  for (const job of jobs) {
    if (counts[job.state] >= Number.MAX_SAFE_INTEGER) {
      rejectStoredQueue();
    }
    counts[job.state] += 1;
    if (batch.state === "active" && job.state === "pending") {
      nextEligibleAt = addCandidate(nextEligibleAt, job.notBefore, now);
    }
    if (batch.state === "active" && job.state === "retry_wait") {
      nextEligibleAt = addCandidate(nextEligibleAt, job.retryAt, now);
    }
    if (job.state === "leased") {
      nextEligibleAt = addCandidate(nextEligibleAt, job.leaseExpiresAt, now);
    }
  }

  const countedTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (countedTotal !== batch.totalCount) {
    rejectStoredQueue();
  }
  return {
    batchId: batch.id as JobProgress["batchId"],
    batchState: batch.state,
    totalCount: batch.totalCount,
    pendingCount: counts.pending,
    leasedCount: counts.leased,
    retryWaitCount: counts.retry_wait,
    succeededCount: counts.succeeded,
    failedCount: counts.failed,
    cancelledCount: counts.cancelled,
    ...(nextEligibleAt === undefined ? {} : { nextEligibleAt }),
  };
}

interface ProgressValidationApi {
  readBatchRow: typeof readBatchRow;
  readJobRow: typeof readJobRow;
  buildProgress: typeof buildProgress;
}

declare const module: { exports: ProgressValidationApi };

module.exports = { readBatchRow, readJobRow, buildProgress };
