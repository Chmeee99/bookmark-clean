import type {
  JobHandler,
  JobLease,
  JobProgress,
  JobQueue,
  JobQueueFailure,
  JobResultReference,
  JobType,
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

export type LeaseOutcome = Outcome<JobLease | null, JobQueueFailure>;
export type VoidOutcome = Outcome<void, JobQueueFailure>;

export interface FakeQueueOptions {
  readonly leaseOutcome?: LeaseOutcome;
  readonly leaseException?: unknown;
  readonly succeedOutcome?: VoidOutcome;
  readonly succeedException?: unknown;
  readonly failOutcome?: VoidOutcome;
  readonly failException?: unknown;
}

export interface FakeJobQueue {
  readonly queue: JobQueue;
  readonly events: string[];
  readonly leaseCalls: {
    readonly worker: WorkerIdentity;
    readonly capabilities: readonly JobType[];
  }[];
  readonly succeedCalls: {
    readonly lease: JobLease;
    readonly result: JobResultReference;
  }[];
  readonly failCalls: {
    readonly lease: JobLease;
    readonly failure: TypedJobFailure;
  }[];
}

export interface FakeHandler {
  readonly handler: JobHandler;
  readonly calls: JobLease[];
}

const WORKER_ID = "worker-1" as WorkerId;
const BOOKMARK_ID = "bookmark-1" as BookmarkId;
const JOB_ID = "job-1" as JobId;
const BATCH_ID = "batch-1" as JobBatchId;
const LEASE_TOKEN = "lease-1" as JobLeaseToken;
const RESULT_ID = "result-1" as JobResultId;
const NOW = "2026-07-13T12:00:00.000Z" as IsoDateTime;
const FUTURE = "2026-07-13T12:00:01.000Z" as IsoDateTime;

const RESULT: JobResultReference = {
  kind: "health_observation",
  id: RESULT_ID,
};

const FAILURE: TypedJobFailure = {
  code: "typed_failure",
  disposition: "terminal",
  diagnostic: "evidence only",
};

function validLease(overrides: Partial<JobLease> = {}): JobLease {
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
    attempt: 1,
    leasedAt: NOW,
    expiresAt: FUTURE,
    ...overrides,
  };
}

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

function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(canonicalize);
    }
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, canonicalize(record[key])]),
      );
    }
    return value;
  };
  if (
    JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))
  ) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function makeQueue(options: FakeQueueOptions = {}): FakeJobQueue {
  const events: string[] = [];
  const leaseCalls: FakeJobQueue["leaseCalls"] = [];
  const succeedCalls: FakeJobQueue["succeedCalls"] = [];
  const failCalls: FakeJobQueue["failCalls"] = [];
  const success: VoidOutcome = { ok: true, value: undefined };

  const queue: JobQueue = {
    async enqueue() {
      events.push("enqueue");
      throw new Error("unexpected enqueue call");
    },
    async lease(worker, capabilities) {
      events.push("lease");
      leaseCalls.push({ worker, capabilities });
      if (Object.prototype.hasOwnProperty.call(options, "leaseException")) {
        throw options.leaseException;
      }
      return options.leaseOutcome ?? { ok: true, value: null };
    },
    async succeed(lease, result) {
      events.push("succeed");
      succeedCalls.push({ lease, result });
      if (Object.prototype.hasOwnProperty.call(options, "succeedException")) {
        throw options.succeedException;
      }
      return options.succeedOutcome ?? success;
    },
    async fail(lease, failure) {
      events.push("fail");
      failCalls.push({ lease, failure });
      if (Object.prototype.hasOwnProperty.call(options, "failException")) {
        throw options.failException;
      }
      return options.failOutcome ?? success;
    },
    async pause() {
      events.push("pause");
      throw new Error("unexpected pause call");
    },
    async resume() {
      events.push("resume");
      throw new Error("unexpected resume call");
    },
    async cancel() {
      events.push("cancel");
      throw new Error("unexpected cancel call");
    },
    async getProgress(): Promise<Outcome<JobProgress, JobQueueFailure>> {
      events.push("progress");
      throw new Error("unexpected progress call");
    },
  };

  return { queue, events, leaseCalls, succeedCalls, failCalls };
}

function makeHandler(outcome: unknown, type: JobType = "health_check"): FakeHandler {
  const calls: JobLease[] = [];
  const handler = {
    type,
    handle(lease: JobLease): Promise<unknown> {
      calls.push(lease);
      return Promise.resolve(outcome);
    },
  } as unknown as JobHandler;
  return { handler, calls };
}

function invalidRegistry(): { readonly code: "invalid_handler_registry" } {
  return { code: "invalid_handler_registry" };
}

declare const module: { exports: Record<string, unknown> };

module.exports = {
  WORKER_ID,
  BOOKMARK_ID,
  JOB_ID,
  BATCH_ID,
  LEASE_TOKEN,
  RESULT_ID,
  NOW,
  FUTURE,
  RESULT,
  FAILURE,
  validLease,
  assert,
  assertSame,
  assertDeepEqual,
  makeQueue,
  makeHandler,
  invalidRegistry,
};
