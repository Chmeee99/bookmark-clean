import type {
  BookmarkId,
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
  JobQueue,
  JobQueueConfig,
  JobQueueFailure,
  JobQueueStore,
  JobRetrySchedule,
  StoredCompletionCommand,
  StoredFailureCommand,
} from "../../modules/jobs/public.js";
import type {
  JobsSqliteFixtureApi,
  SqliteDatabase,
} from "../helpers/jobs-sqlite-fixture.ts";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface StoreApi {
  createSqliteJobQueueStore(database: SqliteDatabase): JobQueueStore;
}

interface SchemaApi {
  migrateJobsSchema(database: SqliteDatabase): Outcome<void, JobQueueFailure>;
}

interface SqliteApi {
  DatabaseSync: new (location: string) => SqliteDatabase;
}

interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: { readonly databasePath: string }) => T | PromiseLike<T>,
  ): Promise<T>;
}

interface JobQueueServiceApi {
  createJobQueue(dependencies: {
    readonly clock: JobClock;
    readonly retrySchedule: JobRetrySchedule;
    readonly idFactory: JobIdFactory;
    readonly store: JobQueueStore;
    readonly config: JobQueueConfig;
  }): JobQueue;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const fixture = loadModule(
  "../helpers/jobs-sqlite-fixture.ts",
) as JobsSqliteFixtureApi;
const {
  NOW,
  ONE_SECOND_LATER,
  TWO_SECONDS_LATER,
  enqueueJobs,
  makeEnqueueCommand,
  makeJob,
  makeLeaseCommand,
  withJobsDatabase,
} = fixture;
const { createSqliteJobQueueStore } = loadModule(
  "../../adapters/sqlite/job-queue-store.ts",
) as StoreApi;
const { migrateJobsSchema } = loadModule(
  "../../adapters/sqlite/jobs-schema.ts",
) as SchemaApi;
const { DatabaseSync } = loadModule("node:sqlite") as SqliteApi;
const { withTemporaryDatabase } = loadModule(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const { createJobQueue } = loadModule(
  "../../modules/jobs/job-queue-service.ts",
) as JobQueueServiceApi;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function assertSuccessLease(
  result: Outcome<JobLease | null, JobQueueFailure>,
  message: string,
): asserts result is { ok: true; value: JobLease } {
  assert(result.ok, `${message} should succeed`);
  assert(result.value !== null, `${message} should return a lease`);
}

function assertSuccessVoid(
  result: Outcome<void, JobQueueFailure>,
  message: string,
): void {
  assertDeepEqual(result, { ok: true, value: undefined }, message);
}

test("the facade delegates every JobQueueStore method through SQLite", async () => {
  await withJobsDatabase(async (database) => {
    const batchId = "facade-methods-batch" as JobBatchId;
    const jobIds = [
      "facade-methods-first",
      "facade-methods-second",
      "facade-methods-third",
    ] as JobId[];
    const command = makeEnqueueCommand({
      batchId,
      jobIds,
      jobs: jobIds.map((_, sequence) =>
        makeJob({
          sequence,
          target: {
            kind: "bookmark",
            bookmarkId: `facade-methods-bookmark-${sequence}` as BookmarkId,
            inputVersion: "version-1",
          },
        }),
      ),
    });
    const store = createSqliteJobQueueStore(database);

    assertDeepEqual(
      await store.enqueueBatch(command),
      {
        ok: true,
        value: {
          batchId,
          state: "active",
          totalCount: 3,
          createdAt: NOW,
        },
      },
      "Facade enqueue changed",
    );

    const firstLeaseResult = await store.leaseNext(
      makeLeaseCommand({ token: "facade-first-token" as JobLeaseToken }),
    );
    assertSuccessLease(firstLeaseResult, "Facade first lease");
    assertEqualLeaseJob(firstLeaseResult.value, jobIds[0], "Facade first lease job changed");
    const completion: StoredCompletionCommand = {
      token: firstLeaseResult.value.token,
      expectedAttempt: firstLeaseResult.value.attempt,
      result: { kind: "health_observation", id: "facade-observation-1" as JobResultId },
      completedAt: NOW,
    };
    assertSuccessVoid(
      await store.completeLease(completion),
      "Facade completion changed",
    );

    const secondLeaseResult = await store.leaseNext(
      makeLeaseCommand({ token: "facade-second-token" as JobLeaseToken }),
    );
    assertSuccessLease(secondLeaseResult, "Facade second lease");
    assertEqualLeaseJob(secondLeaseResult.value, jobIds[1], "Facade second lease job changed");
    const failure: StoredFailureCommand = {
      token: secondLeaseResult.value.token,
      expectedAttempt: secondLeaseResult.value.attempt,
      failure: {
        code: "facade-terminal",
        disposition: "terminal",
        diagnostic: "opaque diagnostic",
      },
      failedAt: NOW,
    };
    assertSuccessVoid(await store.failLease(failure), "Facade failure changed");

    assertSuccessVoid(
      await store.setBatchState(batchId, "pause", ONE_SECOND_LATER),
      "Facade pause changed",
    );
    assertSuccessVoid(
      await store.setBatchState(batchId, "resume", TWO_SECONDS_LATER),
      "Facade resume changed",
    );
    assertSuccessVoid(
      await store.setBatchState(batchId, "cancel", TWO_SECONDS_LATER),
      "Facade cancel changed",
    );
    assertDeepEqual(
      await store.readProgress(batchId, TWO_SECONDS_LATER),
      {
        ok: true,
        value: {
          batchId,
          batchState: "cancelled",
          totalCount: 3,
          pendingCount: 0,
          leasedCount: 0,
          retryWaitCount: 0,
          succeededCount: 1,
          failedCount: 1,
          cancelledCount: 1,
        },
      },
      "Facade progress changed",
    );
  });
});

function assertEqualLeaseJob(lease: JobLease, expectedJobId: JobId, message: string): void {
  if (lease.jobId !== expectedJobId) {
    throw new Error(`${message}. Expected ${expectedJobId}, received ${lease.jobId}`);
  }
}

test("recreates the facade after close and continues the service queue without duplication", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    let currentNow = NOW;
    let batchSequence = 0;
    let jobSequence = 0;
    let tokenSequence = 0;
    const idFactory: JobIdFactory = {
      nextBatchId: () => `service-batch-${++batchSequence}` as JobBatchId,
      nextJobId: () => `service-job-${++jobSequence}` as JobId,
      nextLeaseToken: () => `service-token-${++tokenSequence}` as JobLeaseToken,
    };
    const clock: JobClock = { now: () => currentNow };
    const retrySchedule: JobRetrySchedule = {
      nextRetryAt: (_attempt, failedAt) => failedAt,
    };
    const config: JobQueueConfig = { leaseDurationMs: 1_000 };
    const request: EnqueueBatchRequest = {
      idempotencyKey: "service-reopen-request",
      jobs: [
        makeJob({
          sequence: 0,
          target: { kind: "bookmark", bookmarkId: "service-bookmark-1" as BookmarkId, inputVersion: "version-1" },
        }),
        makeJob({
          sequence: 1,
          target: { kind: "bookmark", bookmarkId: "service-bookmark-2" as BookmarkId, inputVersion: "version-1" },
        }),
      ],
    };

    try {
      assert((migrateJobsSchema(database)).ok, "Initial reopen migration failed");
      const firstStore = createSqliteJobQueueStore(database);
      const firstQueue = createJobQueue({
        clock,
        retrySchedule,
        idFactory,
        store: firstStore,
        config,
      });
      const firstEnqueue = await firstQueue.enqueue(request);
      assert(firstEnqueue.ok, "Initial service enqueue failed");
      assertDeepEqual(
        firstEnqueue.value.batchId,
        "service-batch-1",
        "Initial service batch changed",
      );
      const firstLease = await firstQueue.lease(
        { id: "service-worker" as WorkerId },
        ["health_check"],
      );
      assertSuccessLease(firstLease, "Initial service lease");
      assertDeepEqual(
        await firstQueue.succeed(firstLease.value, {
          kind: "health_observation",
          id: "service-observation-1" as JobResultId,
        }),
        { ok: true, value: undefined },
        "Initial service completion changed",
      );
      database.close();

      const reopened = new DatabaseSync(databasePath);
      try {
        assert((migrateJobsSchema(reopened)).ok, "Reopen migration failed");
        const reopenedStore = createSqliteJobQueueStore(reopened);
        const reopenedQueue = createJobQueue({
          clock,
          retrySchedule,
          idFactory,
          store: reopenedStore,
          config,
        });
        const batchId = "service-batch-1" as JobBatchId;
        assertDeepEqual(
          await reopenedQueue.getProgress(batchId),
          {
            ok: true,
            value: {
              batchId,
              batchState: "active",
              totalCount: 2,
              pendingCount: 1,
              leasedCount: 0,
              retryWaitCount: 0,
              succeededCount: 1,
              failedCount: 0,
              cancelledCount: 0,
            },
          },
          "Reopened progress changed",
        );
        assertDeepEqual(
          await reopenedQueue.enqueue(request),
          {
            ok: true,
            value: {
              batchId,
              state: "active",
              totalCount: 2,
              createdAt: NOW,
            },
          },
          "Reopened idempotent enqueue changed",
        );
        assertDeepEqual(
          reopened.prepare("SELECT COUNT(*) AS count FROM jobs").get()?.count,
          2,
          "Reopened replay duplicated jobs",
        );

        const secondLease = await reopenedQueue.lease(
          { id: "service-worker" as WorkerId },
          ["health_check"],
        );
        assertSuccessLease(secondLease, "Reopened service lease");
        assertDeepEqual(
          await reopenedQueue.fail(secondLease.value, {
            code: "service-terminal",
            disposition: "terminal",
            diagnostic: "opaque service diagnostic",
          }),
          { ok: true, value: undefined },
          "Reopened service failure changed",
        );
        assertDeepEqual(
          await reopenedQueue.getProgress(batchId),
          {
            ok: true,
            value: {
              batchId,
              batchState: "active",
              totalCount: 2,
              pendingCount: 0,
              leasedCount: 0,
              retryWaitCount: 0,
              succeededCount: 1,
              failedCount: 1,
              cancelledCount: 0,
            },
          },
          "Reopened final progress changed",
        );
      } finally {
        if (reopened.isOpen) {
          reopened.close();
        }
      }
    } finally {
      if (database.isOpen) {
        database.close();
      }
    }
  });
});

test("does not migrate automatically and preserves storage failures for closed databases", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      const store = createSqliteJobQueueStore(database);
      assertDeepEqual(
        await store.enqueueBatch(makeEnqueueCommand({ batchId: "unmigrated-batch" as JobBatchId })),
        { ok: false, error: { code: "storage_unavailable" } },
        "Unmigrated enqueue changed",
      );
      assertDeepEqual(
        await store.readProgress("unmigrated-batch" as JobBatchId, NOW),
        { ok: false, error: { code: "storage_unavailable" } },
        "Unmigrated progress changed",
      );
    } finally {
      if (database.isOpen) {
        database.close();
      }
    }

    const closed = new DatabaseSync(databasePath);
    closed.close();
    const store = createSqliteJobQueueStore(closed);
    assertDeepEqual(
      await store.enqueueBatch(makeEnqueueCommand({ batchId: "closed-batch" as JobBatchId })),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed enqueue changed",
    );
    assertDeepEqual(
      await store.readProgress("closed-batch" as JobBatchId, NOW),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed progress changed",
    );
  });
});
