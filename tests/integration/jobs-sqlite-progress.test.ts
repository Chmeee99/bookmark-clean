import type {
  BookmarkId,
  IsoDateTime,
  JobBatchId,
  JobId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  JobProgress,
  JobQueueFailure,
  StoredLeaseCommand,
} from "../../modules/jobs/public.js";
import type {
  JobsSqliteFixtureApi,
  SqliteDatabase,
} from "../helpers/jobs-sqlite-fixture.ts";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface ProgressApi {
  readJobsProgress(
    database: SqliteDatabase,
    batchId: JobBatchId,
    now: IsoDateTime,
  ): Outcome<JobProgress, JobQueueFailure>;
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
  forceLease,
  makeEnqueueCommand,
  makeJob,
  readJob,
  withClosedJobsDatabase,
  withJobsDatabase,
} = fixture;
const { readJobsProgress } = loadModule(
  "../../adapters/sqlite/jobs-progress.ts",
) as ProgressApi;

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

function assertFailure(
  result: Outcome<unknown, JobQueueFailure>,
  code: JobQueueFailure["code"],
  message: string,
): void {
  assert(!result.ok, `${message} should fail`);
  assertDeepEqual(result, { ok: false, error: { code } }, message);
}

function assertProgress(
  result: Outcome<JobProgress, JobQueueFailure>,
  expected: JobProgress,
  message: string,
): void {
  assertDeepEqual(result, { ok: true, value: expected }, message);
}

const THREE_SECONDS_LATER = "2026-07-13T12:00:03.000Z" as IsoDateTime;
const FOUR_SECONDS_LATER = "2026-07-13T12:00:04.000Z" as IsoDateTime;
const PAST = "2026-07-13T11:59:59.000Z" as IsoDateTime;

test("reads zero-filled six-state progress and the earliest requested-batch time", async () => {
  await withJobsDatabase((database) => {
    const batchId = "progress-mixed-batch" as JobBatchId;
    const jobIds = [
      "progress-pending",
      "progress-retry",
      "progress-leased",
      "progress-succeeded",
      "progress-failed",
      "progress-cancelled",
    ] as JobId[];
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId,
        jobIds,
        jobs: jobIds.map((_, sequence) =>
          makeJob({
            sequence,
            ...(sequence === 0 ? { notBefore: ONE_SECOND_LATER } : {}),
            target: {
              kind: "bookmark",
              bookmarkId: `progress-bookmark-${sequence}` as BookmarkId,
              inputVersion: "version-1",
            },
          }),
        ),
      }),
    );
    database
      .prepare("UPDATE jobs SET state = 'retry_wait', retry_at = ? WHERE id = ?")
      .run(TWO_SECONDS_LATER, jobIds[1]);
    forceLease(database, {
      jobId: jobIds[2],
      attempt: 1,
      token: "progress-live-token",
      expiresAt: THREE_SECONDS_LATER,
    });
    database
      .prepare(
        "UPDATE jobs SET state = 'succeeded', result_kind = 'health_observation', " +
          "result_id = ?, completed_at = ? WHERE id = ?",
      )
      .run("progress-observation", NOW, jobIds[3]);
    database
      .prepare(
        "UPDATE jobs SET state = 'failed', failure_code = ?, " +
          "failure_disposition = 'terminal', completed_at = ? WHERE id = ?",
      )
      .run("progress-failed", NOW, jobIds[4]);
    database
      .prepare("UPDATE jobs SET state = 'cancelled', completed_at = ? WHERE id = ?")
      .run(NOW, jobIds[5]);

    assertProgress(
      readJobsProgress(database, batchId, NOW),
      {
        batchId,
        batchState: "active",
        totalCount: 6,
        pendingCount: 1,
        leasedCount: 1,
        retryWaitCount: 1,
        succeededCount: 1,
        failedCount: 1,
        cancelledCount: 1,
        nextEligibleAt: ONE_SECOND_LATER,
      },
      "Mixed progress changed",
    );
  });
});

test("scopes eligibility to the requested batch and applies active-state gates", async () => {
  await withJobsDatabase((database) => {
    const requestedBatch = "progress-requested-batch" as JobBatchId;
    const otherBatch = "progress-other-batch" as JobBatchId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: requestedBatch,
        jobIds: ["requested-pending", "requested-retry", "requested-leased"] as JobId[],
        jobs: [
          makeJob({
            sequence: 0,
            notBefore: FOUR_SECONDS_LATER,
            target: { kind: "bookmark", bookmarkId: "requested-pending-bookmark" as BookmarkId, inputVersion: "version-1" },
          }),
          makeJob({
            sequence: 1,
            target: { kind: "bookmark", bookmarkId: "requested-retry-bookmark" as BookmarkId, inputVersion: "version-1" },
          }),
          makeJob({
            sequence: 2,
            target: { kind: "bookmark", bookmarkId: "requested-leased-bookmark" as BookmarkId, inputVersion: "version-1" },
          }),
        ],
      }),
    );
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: otherBatch,
        jobIds: ["other-pending"] as JobId[],
        jobs: [makeJob({ notBefore: ONE_SECOND_LATER })],
      }),
    );
    database
      .prepare("UPDATE jobs SET state = 'retry_wait', retry_at = ? WHERE id = ?")
      .run(TWO_SECONDS_LATER, "requested-retry");
    forceLease(database, {
      jobId: "requested-leased" as JobId,
      attempt: 1,
      token: "requested-live-token",
      expiresAt: THREE_SECONDS_LATER,
    });

    assertProgress(
      readJobsProgress(database, requestedBatch, NOW),
      {
        batchId: requestedBatch,
        batchState: "active",
        totalCount: 3,
        pendingCount: 1,
        leasedCount: 1,
        retryWaitCount: 1,
        succeededCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        nextEligibleAt: TWO_SECONDS_LATER,
      },
      "Requested-batch eligibility changed",
    );

    database
      .prepare("UPDATE job_batches SET state = 'paused' WHERE id = ?")
      .run(requestedBatch);
    assertProgress(
      readJobsProgress(database, requestedBatch, NOW),
      {
        batchId: requestedBatch,
        batchState: "paused",
        totalCount: 3,
        pendingCount: 1,
        leasedCount: 1,
        retryWaitCount: 1,
        succeededCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        nextEligibleAt: THREE_SECONDS_LATER,
      },
      "Paused eligibility changed",
    );

    database
      .prepare("UPDATE job_batches SET state = 'cancelled' WHERE id = ?")
      .run(requestedBatch);
    assertProgress(
      readJobsProgress(database, requestedBatch, NOW),
      {
        batchId: requestedBatch,
        batchState: "cancelled",
        totalCount: 3,
        pendingCount: 1,
        leasedCount: 1,
        retryWaitCount: 1,
        succeededCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        nextEligibleAt: THREE_SECONDS_LATER,
      },
      "Cancelled eligibility changed",
    );
  });
});

test("recovers expired leases before counting and commits the projection", async () => {
  await withJobsDatabase((database) => {
    const activeBatch = "progress-recovery-active" as JobBatchId;
    const pausedBatch = "progress-recovery-paused" as JobBatchId;
    const cancelledBatch = "progress-recovery-cancelled" as JobBatchId;
    const exhaustedBatch = "progress-recovery-exhausted" as JobBatchId;
    const activeJob = "progress-recovery-active-job" as JobId;
    const pausedJob = "progress-recovery-paused-job" as JobId;
    const cancelledJob = "progress-recovery-cancelled-job" as JobId;
    const exhaustedJob = "progress-recovery-exhausted-job" as JobId;
    const batches = [
      [activeBatch, activeJob],
      [pausedBatch, pausedJob],
      [cancelledBatch, cancelledJob],
      [exhaustedBatch, exhaustedJob],
    ] as const;
    for (const [batchId, jobId] of batches) {
      enqueueJobs(
        database,
        makeEnqueueCommand({
          batchId,
          jobIds: [jobId],
          jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: `${jobId}-bookmark` as BookmarkId, inputVersion: "version-1" } })],
        }),
      );
    }
    database.prepare("UPDATE job_batches SET state = 'paused' WHERE id = ?").run(pausedBatch);
    database.prepare("UPDATE job_batches SET state = 'cancelled' WHERE id = ?").run(cancelledBatch);
    forceLease(database, { jobId: activeJob, attempt: 1, token: "progress-active-expired" });
    forceLease(database, { jobId: pausedJob, attempt: 1, token: "progress-paused-expired" });
    forceLease(database, { jobId: cancelledJob, attempt: 1, token: "progress-cancelled-expired" });
    forceLease(database, { jobId: exhaustedJob, attempt: 3, token: "progress-exhausted-expired" });

    assertProgress(
      readJobsProgress(database, activeBatch, NOW),
      {
        batchId: activeBatch,
        batchState: "active",
        totalCount: 1,
        pendingCount: 1,
        leasedCount: 0,
        retryWaitCount: 0,
        succeededCount: 0,
        failedCount: 0,
        cancelledCount: 0,
      },
      "Recovered active progress changed",
    );
    assert(readJob(database, activeJob)?.state === "pending", "Active recovery did not commit");
    assert(readJob(database, pausedJob)?.state === "pending", "Paused recovery did not commit");
    assert(readJob(database, cancelledJob)?.state === "cancelled", "Cancelled recovery did not commit");
    assert(readJob(database, exhaustedJob)?.state === "failed", "Exhausted recovery did not commit");
  });
});

test("commits global recovery before returning batch_not_found", async () => {
  await withJobsDatabase((database) => {
    const jobId = "progress-missing-recovery-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "progress-missing-recovery-batch" as JobBatchId,
        jobIds: [jobId],
      }),
    );
    forceLease(database, { jobId, attempt: 1, token: "progress-missing-expired" });

    assertFailure(
      readJobsProgress(database, "missing-progress-batch" as JobBatchId, NOW),
      "batch_not_found",
      "Missing progress batch",
    );
    assert(readJob(database, jobId)?.state === "pending", "Missing-batch recovery was rolled back");
  });
});

test("rolls back recovery on count invariants, malformed input, and an abort trigger", async () => {
  await withJobsDatabase((database) => {
    const batchId = "progress-rollback-batch" as JobBatchId;
    const jobId = "progress-rollback-job" as JobId;
    enqueueJobs(database, makeEnqueueCommand({ batchId, jobIds: [jobId] }));
    database.prepare("UPDATE job_batches SET total_count = 2 WHERE id = ?").run(batchId);
    forceLease(database, { jobId, attempt: 1, token: "progress-count-expired" });

    assertFailure(
      readJobsProgress(database, batchId, NOW),
      "stored_queue_invalid",
      "Corrupt progress count",
    );
    assert(readJob(database, jobId)?.state === "leased", "Count invariant did not roll back recovery");

    database.prepare("UPDATE job_batches SET total_count = 1 WHERE id = ?").run(batchId);
    database.exec(
      "CREATE TRIGGER abort_progress_recovery BEFORE UPDATE OF state ON jobs " +
        "WHEN OLD.state = 'leased' AND NEW.state = 'pending' " +
        "BEGIN SELECT RAISE(ABORT, 'test-only progress abort'); END",
    );
    assertFailure(
      readJobsProgress(database, batchId, NOW),
      "storage_unavailable",
      "Aborted progress recovery",
    );
    assert(readJob(database, jobId)?.state === "leased", "Abort trigger did not roll back recovery");
    database.exec("DROP TRIGGER abort_progress_recovery");

    assertProgress(
      readJobsProgress(database, batchId, NOW),
      {
        batchId,
        batchState: "active",
        totalCount: 1,
        pendingCount: 1,
        leasedCount: 0,
        retryWaitCount: 0,
        succeededCount: 0,
        failedCount: 0,
        cancelledCount: 0,
      },
      "Progress after rollback changed",
    );
  });

  await withJobsDatabase((database) => {
    const batchId = "progress-validation-batch" as JobBatchId;
    enqueueJobs(database, makeEnqueueCommand({ batchId }));
    assertFailure(
      readJobsProgress(database, "" as JobBatchId, NOW),
      "invalid_request",
      "Empty progress batch ID",
    );
    assertFailure(
      readJobsProgress(database, batchId, "not-a-time" as IsoDateTime),
      "invalid_request",
      "Malformed progress time",
    );
    assert(
      readJob(database, "progress-validation-batch-job-0" as JobId)?.state === "pending",
      "Invalid input changed rows",
    );
  });
});

test("rejects malformed stored timestamps and rolls back recovery", async () => {
  await withJobsDatabase((database) => {
    const batchId = "progress-malformed-row-batch" as JobBatchId;
    const jobId = "progress-malformed-row-job" as JobId;
    enqueueJobs(database, makeEnqueueCommand({ batchId, jobIds: [jobId] }));
    database
      .prepare("UPDATE jobs SET not_before = ? WHERE id = ?")
      .run("not-a-time", jobId);
    forceLease(database, { jobId, attempt: 1, token: "progress-malformed-expired" });

    assertFailure(
      readJobsProgress(database, batchId, NOW),
      "stored_queue_invalid",
      "Malformed stored progress timestamp",
    );
    assert(readJob(database, jobId)?.state === "leased", "Malformed timestamp changed recovery state");
  });
});

test("closed databases return storage_unavailable", async () => {
  await withClosedJobsDatabase((database) => {
    assertDeepEqual(
      readJobsProgress(database, "closed-progress-batch" as JobBatchId, NOW),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed progress failure changed",
    );
  });
});
