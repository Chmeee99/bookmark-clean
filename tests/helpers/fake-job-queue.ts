import type {
  EnqueueBatchRequest,
  EnqueueJob,
  JobBatchSummary,
  JobClock,
  JobIdFactory,
  JobLease,
  JobProgress,
  JobQueue,
  JobQueueConfig,
  JobQueueFailure,
  JobQueueStore,
  JobResultReference,
  JobRetrySchedule,
  StoredCompletionCommand,
  StoredEnqueueCommand,
  StoredFailureCommand,
  StoredLeaseCommand,
  TypedJobFailure,
  WorkerIdentity,
} from "../../modules/jobs/public.js";
import type {
  BookmarkId,
  IsoDateTime,
  JobBatchId,
  JobId,
  JobLeaseToken,
  JobResultId,
  Outcome,
  WorkerId,
} from "../../core/contracts/public.js";

interface JobQueueDependencies {
  readonly clock: JobClock;
  readonly retrySchedule: JobRetrySchedule;
  readonly idFactory: JobIdFactory;
  readonly store: JobQueueStore;
  readonly config: JobQueueConfig;
}

interface ServiceApi {
  createJobQueue(dependencies: JobQueueDependencies): JobQueue;
}

export type EnqueueOutcome = Outcome<JobBatchSummary, JobQueueFailure>;
export type LeaseOutcome = Outcome<JobLease | null, JobQueueFailure>;
export type VoidOutcome = Outcome<void, JobQueueFailure>;
export type ProgressOutcome = Outcome<JobProgress, JobQueueFailure>;

export interface RetryCall {
  readonly attempt: number;
  readonly failedAt: IsoDateTime;
}

export interface ControlCall {
  readonly batchId: JobBatchId;
  readonly action: "pause" | "resume" | "cancel";
  readonly changedAt: IsoDateTime;
}

export interface FakeOptions {
  readonly now?: IsoDateTime;
  readonly retryAt?: IsoDateTime;
  readonly leaseDurationMs?: number;
  readonly batchIds?: readonly string[];
  readonly jobIds?: readonly string[];
  readonly leaseTokens?: readonly string[];
  readonly enqueueOutcome?: EnqueueOutcome;
  readonly leaseOutcome?: LeaseOutcome;
  readonly completeOutcome?: VoidOutcome;
  readonly failOutcome?: VoidOutcome;
  readonly controlOutcome?: VoidOutcome;
  readonly progressOutcome?: ProgressOutcome;
  readonly enqueueException?: Error;
}

export interface FakeQueue {
  readonly queue: JobQueue;
  readonly events: string[];
  readonly enqueueCommands: StoredEnqueueCommand[];
  readonly leaseCommands: StoredLeaseCommand[];
  readonly completeCommands: StoredCompletionCommand[];
  readonly failCommands: StoredFailureCommand[];
  readonly controlCalls: ControlCall[];
  readonly progressCalls: { readonly batchId: JobBatchId; readonly now: IsoDateTime }[];
  readonly retryCalls: RetryCall[];
}

declare const require: (specifier: "../../modules/jobs/job-queue-service.ts") => unknown;

const { createJobQueue } = require("../../modules/jobs/job-queue-service.ts") as ServiceApi;

const NOW = "2026-07-13T12:00:00.000Z" as IsoDateTime;
const FUTURE = "2026-07-13T12:00:01.000Z" as IsoDateTime;
const RETRY_AT = "2026-07-13T12:00:05.000Z" as IsoDateTime;
const BEFORE_NOW = "2026-07-13T11:59:59.000Z" as IsoDateTime;
const BATCH_ID = "batch-1" as JobBatchId;
const WORKER_ID = "worker-1" as WorkerId;
const BOOKMARK_ID = "bookmark-1" as BookmarkId;
const JOB_ID = "job-1" as JobId;
const LEASE_TOKEN = "lease-1" as JobLeaseToken;
const RESULT_ID = "result-1" as JobResultId;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSame<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(canonicalize);
    }
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
      );
    }
    return value;
  };
  if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function assertFailureCode(
  result: Outcome<unknown, JobQueueFailure>,
  expected: JobQueueFailure["code"],
  message: string,
): void {
  assert(!result.ok, `${message}: expected a failure`);
  assertEqual(result.error.code, expected, message);
}

function validJob(
  sequence = 0,
  priority = 3,
  notBefore?: IsoDateTime,
): EnqueueJob {
  const job: EnqueueJob = {
    type: "health_check",
    target: {
      kind: "bookmark",
      bookmarkId: BOOKMARK_ID,
      inputVersion: "version-1",
    },
    priority,
    sequence,
    maxAttempts: 3,
  };
  return notBefore === undefined ? job : { ...job, notBefore };
}

function validRequest(): EnqueueBatchRequest {
  return { idempotencyKey: "request-1", jobs: [validJob()] };
}

function validLease(overrides: Record<string, unknown> = {}): JobLease {
  return {
    token: LEASE_TOKEN,
    jobId: JOB_ID,
    batchId: BATCH_ID,
    type: "health_check",
    target: {
      kind: "bookmark",
      bookmarkId: BOOKMARK_ID,
      inputVersion: "version-1",
    },
    attempt: 2,
    leasedAt: NOW,
    expiresAt: FUTURE,
    ...overrides,
  } as JobLease;
}

const RESULT: JobResultReference = { kind: "health_observation", id: RESULT_ID };

function makeQueue(options: FakeOptions = {}): FakeQueue {
  const events: string[] = [];
  const enqueueCommands: StoredEnqueueCommand[] = [];
  const leaseCommands: StoredLeaseCommand[] = [];
  const completeCommands: StoredCompletionCommand[] = [];
  const failCommands: StoredFailureCommand[] = [];
  const controlCalls: ControlCall[] = [];
  const progressCalls: { batchId: JobBatchId; now: IsoDateTime }[] = [];
  const retryCalls: RetryCall[] = [];
  let batchIndex = 0;
  let jobIndex = 0;
  let tokenIndex = 0;

  const clock: JobClock = {
    now(): IsoDateTime {
      events.push("clock");
      return options.now ?? NOW;
    },
  };
  const retrySchedule: JobRetrySchedule = {
    nextRetryAt(attempt, failedAt): IsoDateTime {
      events.push("retry");
      retryCalls.push({ attempt, failedAt });
      return options.retryAt ?? RETRY_AT;
    },
  };
  const idFactory: JobIdFactory = {
    nextBatchId(): JobBatchId {
      events.push("id:batch");
      const value = options.batchIds?.[batchIndex] ?? `batch-${batchIndex + 1}`;
      batchIndex += 1;
      return value as JobBatchId;
    },
    nextJobId(): JobId {
      events.push("id:job");
      const value = options.jobIds?.[jobIndex] ?? `job-${jobIndex + 1}`;
      jobIndex += 1;
      return value as JobId;
    },
    nextLeaseToken(): JobLeaseToken {
      events.push("id:token");
      const value = options.leaseTokens?.[tokenIndex] ?? `lease-${tokenIndex + 1}`;
      tokenIndex += 1;
      return value as JobLeaseToken;
    },
  };

  const defaultSummary: JobBatchSummary = {
    batchId: BATCH_ID,
    state: "active",
    totalCount: 1,
    createdAt: NOW,
  };
  const defaultProgress: JobProgress = {
    batchId: BATCH_ID,
    batchState: "active",
    totalCount: 1,
    pendingCount: 1,
    leasedCount: 0,
    retryWaitCount: 0,
    succeededCount: 0,
    failedCount: 0,
    cancelledCount: 0,
  };
  const success: VoidOutcome = { ok: true, value: undefined };
  const store: JobQueueStore = {
    async enqueueBatch(command): Promise<EnqueueOutcome> {
      events.push("store:enqueue");
      enqueueCommands.push(command);
      if (options.enqueueException !== undefined) {
        throw options.enqueueException;
      }
      return options.enqueueOutcome ?? { ok: true, value: defaultSummary };
    },
    async leaseNext(command): Promise<LeaseOutcome> {
      events.push("store:lease");
      leaseCommands.push(command);
      return options.leaseOutcome ?? { ok: true, value: null };
    },
    async completeLease(command): Promise<VoidOutcome> {
      events.push("store:complete");
      completeCommands.push(command);
      return options.completeOutcome ?? success;
    },
    async failLease(command): Promise<VoidOutcome> {
      events.push("store:fail");
      failCommands.push(command);
      return options.failOutcome ?? success;
    },
    async setBatchState(batchId, action, changedAt): Promise<VoidOutcome> {
      events.push("store:control");
      controlCalls.push({ batchId, action, changedAt });
      return options.controlOutcome ?? success;
    },
    async readProgress(batchId, now): Promise<ProgressOutcome> {
      events.push("store:progress");
      progressCalls.push({ batchId, now });
      return options.progressOutcome ?? { ok: true, value: defaultProgress };
    },
  };

  return {
    queue: createJobQueue({
      clock,
      retrySchedule,
      idFactory,
      store,
      config: { leaseDurationMs: options.leaseDurationMs ?? 1_500 },
    }),
    events,
    enqueueCommands,
    leaseCommands,
    completeCommands,
    failCommands,
    controlCalls,
    progressCalls,
    retryCalls,
  };
}

declare const module: { exports: Record<string, unknown> };

module.exports = {
  NOW,
  FUTURE,
  RETRY_AT,
  BEFORE_NOW,
  BATCH_ID,
  WORKER_ID,
  BOOKMARK_ID,
  JOB_ID,
  LEASE_TOKEN,
  RESULT_ID,
  RESULT,
  assert,
  assertSame,
  assertEqual,
  assertDeepEqual,
  assertFailureCode,
  validJob,
  validRequest,
  validLease,
  makeQueue,
};
