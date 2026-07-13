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
import type {
  EnqueueBatchRequest,
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
  JobWorker,
  JobWorkerConfigurationFailure,
  WorkerIdentity,
} from "../../modules/jobs/public.js";
import type {
  FakeDurableHandlerMode,
  FakeDurableJobHandler,
  FakeDurableResultRepository,
  FakeResultIdFactory,
  StableJobInput,
} from "./fake-durable-job-handler.ts";
import type {
  SqliteDatabase,
  SqliteRow,
} from "./jobs-sqlite-fixture.ts";

interface SqliteApi {
  DatabaseSync: new (location: string) => SqliteDatabase;
}

interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: { readonly databasePath: string }) => T | PromiseLike<T>,
  ): Promise<T>;
}

interface SchemaApi {
  migrateJobsSchema(database: SqliteDatabase): Outcome<void, JobQueueFailure>;
}

interface StoreApi {
  createSqliteJobQueueStore(database: SqliteDatabase): JobQueueStore;
}

interface QueueServiceApi {
  createJobQueue(dependencies: {
    readonly clock: JobClock;
    readonly retrySchedule: JobRetrySchedule;
    readonly idFactory: JobIdFactory;
    readonly store: JobQueueStore;
    readonly config: JobQueueConfig;
  }): JobQueue;
}

interface WorkerServiceApi {
  createJobWorker(
    queue: JobQueue,
    handlers: readonly import("../../modules/jobs/public.js").JobHandler[],
  ): Outcome<JobWorker, JobWorkerConfigurationFailure>;
}

interface HandlerHelperApi {
  makeStableInputKey(input: StableJobInput): string;
  migrateFakeDurableResultSchema(database: SqliteDatabase): void;
  createFakeResultIdFactory(prefix?: string): FakeResultIdFactory;
  createFakeDurableResultRepository(
    database: SqliteDatabase,
    resultIdFactory: FakeResultIdFactory,
  ): FakeDurableResultRepository;
  createFakeDurableJobHandler(
    repository: FakeDurableResultRepository,
    mode: FakeDurableHandlerMode,
  ): FakeDurableJobHandler;
}

export interface ResumeClockState {
  value: IsoDateTime;
}

export interface ResumeRuntime {
  readonly queue: JobQueue;
  readonly worker: JobWorker;
  readonly handler: FakeDurableJobHandler;
  readonly repository: FakeDurableResultRepository;
}

export interface JobWorkerResumeFixtureApi {
  readonly DatabaseSync: SqliteApi["DatabaseSync"];
  readonly withTemporaryDatabase: TemporaryDatabaseApi["withTemporaryDatabase"];
  readonly migrateJobsSchema: SchemaApi["migrateJobsSchema"];
  readonly migrateFakeDurableResultSchema: HandlerHelperApi["migrateFakeDurableResultSchema"];
  readonly NOW: IsoDateTime;
  readonly LEASE_EXPIRES_AT: IsoDateTime;
  readonly RESUMED_LEASE_EXPIRES_AT: IsoDateTime;
  readonly BATCH_ID: JobBatchId;
  readonly FIRST_RESULT: JobResultReference;
  readonly SECOND_RESULT: JobResultReference;
  readonly FIRST_TARGET: {
    readonly kind: "bookmark";
    readonly bookmarkId: BookmarkId;
    readonly inputVersion: string;
  };
  readonly SECOND_TARGET: {
    readonly kind: "bookmark";
    readonly bookmarkId: BookmarkId;
    readonly inputVersion: string;
  };
  readonly REQUEST: EnqueueBatchRequest;
  readonly FIRST_WORKER: WorkerIdentity;
  readonly RESUMED_WORKER: WorkerIdentity;
  readonly createFakeResultIdFactory: HandlerHelperApi["createFakeResultIdFactory"];
  readonly createDeterministicIdFactory: () => JobIdFactory;
  readonly createRuntime: (
    database: SqliteDatabase,
    clockState: ResumeClockState,
    idFactory: JobIdFactory,
    resultIdFactory: FakeResultIdFactory,
    handlerMode: FakeDurableHandlerMode,
  ) => ResumeRuntime;
  readonly makeStableInputKey: HandlerHelperApi["makeStableInputKey"];
  readonly readJobRows: (database: SqliteDatabase) => readonly SqliteRow[];
  readonly expectedJobRow: (
    id: JobId,
    sequence: number,
    state: string,
    attempt: number,
    leaseToken: string | null,
    workerId: string | null,
    leasedAt: IsoDateTime | null,
    leaseExpiresAt: IsoDateTime | null,
    resultId: JobResultId | null,
    completedAt: IsoDateTime | null,
  ) => Record<string, unknown>;
  readonly expectedResultRows: () => readonly Record<string, string>[];
  readonly FIRST_PROGRESS: JobProgress;
  readonly FINAL_PROGRESS: JobProgress;
  readonly assert: (condition: unknown, message: string) => asserts condition;
  readonly assertSame: <T>(actual: T, expected: T, message: string) => void;
  readonly assertDeepEqual: (
    actual: unknown,
    expected: unknown,
    message: string,
  ) => void;
  readonly requireSuccess: <T, E extends { code: string }>(
    result: Outcome<T, E>,
    message: string,
  ) => T;
}

declare const require: (specifier: string) => unknown;
declare const module: { exports: JobWorkerResumeFixtureApi };

const loadModule = require as unknown as (specifier: string) => unknown;
const { DatabaseSync } = loadModule("node:sqlite") as SqliteApi;
const { withTemporaryDatabase } = loadModule(
  "./temporary-database.ts",
) as TemporaryDatabaseApi;
const { migrateJobsSchema } = loadModule(
  "../../adapters/sqlite/jobs-schema.ts",
) as SchemaApi;
const { createSqliteJobQueueStore } = loadModule(
  "../../adapters/sqlite/job-queue-store.ts",
) as StoreApi;
const { createJobQueue } = loadModule(
  "../../modules/jobs/job-queue-service.ts",
) as QueueServiceApi;
const { createJobWorker } = loadModule(
  "../../modules/jobs/job-worker-service.ts",
) as WorkerServiceApi;
const handlerHelper = loadModule(
  "./fake-durable-job-handler.ts",
) as HandlerHelperApi;
const {
  makeStableInputKey,
  migrateFakeDurableResultSchema,
  createFakeResultIdFactory,
  createFakeDurableResultRepository,
  createFakeDurableJobHandler,
} = handlerHelper;

const NOW = "2026-07-13T12:00:00.000Z" as IsoDateTime;
const LEASE_EXPIRES_AT = "2026-07-13T12:00:01.000Z" as IsoDateTime;
const RESUMED_LEASE_EXPIRES_AT = "2026-07-13T12:00:02.000Z" as IsoDateTime;
const BATCH_ID = "batch-1" as JobBatchId;
const FIRST_RESULT: JobResultReference = {
  kind: "health_observation",
  id: "fake-result-1" as JobResultId,
};
const SECOND_RESULT: JobResultReference = {
  kind: "health_observation",
  id: "fake-result-2" as JobResultId,
};
const FIRST_TARGET = {
  kind: "bookmark" as const,
  bookmarkId: "bookmark-1" as BookmarkId,
  inputVersion: "input-v1",
};
const SECOND_TARGET = {
  kind: "bookmark" as const,
  bookmarkId: "bookmark-2" as BookmarkId,
  inputVersion: "input-v1",
};
const REQUEST: EnqueueBatchRequest = {
  idempotencyKey: "selected-scope-health-v1",
  jobs: [
    {
      type: "health_check",
      target: FIRST_TARGET,
      priority: 0,
      sequence: 0,
      maxAttempts: 3,
    },
    {
      type: "health_check",
      target: SECOND_TARGET,
      priority: 0,
      sequence: 1,
      maxAttempts: 3,
    },
  ],
};
const FIRST_WORKER: WorkerIdentity = {
  id: "worker-before-reopen" as WorkerId,
};
const RESUMED_WORKER: WorkerIdentity = {
  id: "worker-after-reopen" as WorkerId,
};
const QUEUE_CONFIG: JobQueueConfig = { leaseDurationMs: 1_000 };
const RETRY_SCHEDULE: JobRetrySchedule = {
  nextRetryAt: (_attempt, failedAt) => failedAt,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSame<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function canonicalize(value: unknown): unknown {
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
}

function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function requireSuccess<T, E extends { code: string }>(
  result: Outcome<T, E>,
  message: string,
): T {
  assert(result.ok, message);
  return result.value;
}

function createDeterministicIdFactory(): JobIdFactory {
  let batchSequence = 0;
  let jobSequence = 0;
  let tokenSequence = 0;
  return {
    nextBatchId: () => `batch-${++batchSequence}` as JobBatchId,
    nextJobId: () => `job-${++jobSequence}` as JobId,
    nextLeaseToken: () => `lease-${++tokenSequence}` as JobLeaseToken,
  };
}

function createRuntime(
  database: SqliteDatabase,
  clockState: ResumeClockState,
  idFactory: JobIdFactory,
  resultIdFactory: FakeResultIdFactory,
  handlerMode: FakeDurableHandlerMode,
): ResumeRuntime {
  const repository = createFakeDurableResultRepository(
    database,
    resultIdFactory,
  );
  const handler = createFakeDurableJobHandler(repository, handlerMode);
  const queue = createJobQueue({
    clock: { now: () => clockState.value },
    retrySchedule: RETRY_SCHEDULE,
    idFactory,
    store: createSqliteJobQueueStore(database),
    config: QUEUE_CONFIG,
  });
  const workerResult = createJobWorker(queue, [handler.handler]);
  assert(workerResult.ok, "Resume test handler registry was rejected");
  return {
    queue,
    worker: workerResult.value,
    handler,
    repository,
  };
}

function readJobRows(database: SqliteDatabase): readonly SqliteRow[] {
  return database
    .prepare(
      "SELECT id, batch_id, sequence, state, attempt, lease_token, " +
        "worker_id, leased_at, lease_expires_at, result_kind, result_id, " +
        "failure_code, failure_disposition, failure_diagnostic, completed_at " +
        "FROM jobs ORDER BY sequence ASC",
    )
    .all();
}

function expectedJobRow(
  id: JobId,
  sequence: number,
  state: string,
  attempt: number,
  leaseToken: string | null,
  workerId: string | null,
  leasedAt: IsoDateTime | null,
  leaseExpiresAt: IsoDateTime | null,
  resultId: JobResultId | null,
  completedAt: IsoDateTime | null,
): Record<string, unknown> {
  return {
    id,
    batch_id: BATCH_ID,
    sequence,
    state,
    attempt,
    lease_token: leaseToken,
    worker_id: workerId,
    leased_at: leasedAt,
    lease_expires_at: leaseExpiresAt,
    result_kind: resultId === null ? null : "health_observation",
    result_id: resultId,
    failure_code: null,
    failure_disposition: null,
    failure_diagnostic: null,
    completed_at: completedAt,
  };
}

function expectedResultRows(): readonly Record<string, string>[] {
  return [
    {
      stableInputKey: makeStableInputKey({
        type: "health_check",
        target: FIRST_TARGET,
      }),
      resultId: "fake-result-1",
    },
    {
      stableInputKey: makeStableInputKey({
        type: "health_check",
        target: SECOND_TARGET,
      }),
      resultId: "fake-result-2",
    },
  ];
}

const FIRST_PROGRESS: JobProgress = {
  batchId: BATCH_ID,
  batchState: "active",
  totalCount: 2,
  pendingCount: 1,
  leasedCount: 1,
  retryWaitCount: 0,
  succeededCount: 0,
  failedCount: 0,
  cancelledCount: 0,
  nextEligibleAt: LEASE_EXPIRES_AT,
};
const FINAL_PROGRESS: JobProgress = {
  batchId: BATCH_ID,
  batchState: "active",
  totalCount: 2,
  pendingCount: 0,
  leasedCount: 0,
  retryWaitCount: 0,
  succeededCount: 2,
  failedCount: 0,
  cancelledCount: 0,
};

module.exports = {
  DatabaseSync,
  withTemporaryDatabase,
  migrateJobsSchema,
  migrateFakeDurableResultSchema,
  NOW,
  LEASE_EXPIRES_AT,
  RESUMED_LEASE_EXPIRES_AT,
  BATCH_ID,
  FIRST_RESULT,
  SECOND_RESULT,
  FIRST_TARGET,
  SECOND_TARGET,
  REQUEST,
  FIRST_WORKER,
  RESUMED_WORKER,
  createFakeResultIdFactory,
  createDeterministicIdFactory,
  createRuntime,
  makeStableInputKey,
  readJobRows,
  expectedJobRow,
  expectedResultRows,
  FIRST_PROGRESS,
  FINAL_PROGRESS,
  assert,
  assertSame,
  assertDeepEqual,
  requireSuccess,
};
