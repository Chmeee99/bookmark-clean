import type {
  BookmarkId,
  IsoDateTime,
  JobBatchId,
  JobId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  JobQueueFailure,
  StoredCompletionCommand,
} from "../../modules/jobs/public.js";
import type {
  JobsSqliteFixtureApi,
  SqliteDatabase,
} from "../helpers/jobs-sqlite-fixture.ts";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface ControlsApi {
  setJobsBatchState(
    database: SqliteDatabase,
    batchId: JobBatchId,
    action: "pause" | "resume" | "cancel",
    changedAt: IsoDateTime,
  ): Outcome<void, JobQueueFailure>;
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
  withClosedJobsDatabase,
  withJobsDatabase,
} = fixture;
const { setJobsBatchState } = loadModule(
  "../../adapters/sqlite/jobs-transitions.ts",
) as ControlsApi;

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

function assertSuccess(result: Outcome<void, JobQueueFailure>, message: string): void {
  assertDeepEqual(result, { ok: true, value: undefined }, message);
}

function readBatch(
  database: SqliteDatabase,
  batchId: JobBatchId,
): Record<string, unknown> | undefined {
  return database
    .prepare(
      "SELECT id, state, total_count, created_at, changed_at " +
        "FROM job_batches WHERE id = ?",
    )
    .get(batchId);
}

function readJob(
  database: SqliteDatabase,
  jobId: JobId,
): Record<string, unknown> | undefined {
  return database
    .prepare(
      "SELECT id, batch_id, state, attempt, not_before, retry_at, " +
        "lease_token, worker_id, leased_at, lease_expires_at, result_kind, " +
        "result_id, failure_code, failure_disposition, failure_diagnostic, " +
        "completed_at FROM jobs WHERE id = ?",
    )
    .get(jobId);
}

function enqueueControlBatch(
  database: SqliteDatabase,
  batchId: JobBatchId,
  jobIds: readonly JobId[],
): void {
  enqueueJobs(
    database,
    makeEnqueueCommand({
      batchId,
      jobIds,
      jobs: jobIds.map((_, sequence) =>
        makeJob({
          sequence,
          target: {
            kind: "bookmark",
            bookmarkId: `control-bookmark-${sequence}` as BookmarkId,
            inputVersion: "version-1",
          },
        }),
      ),
    }),
  );
}

test("pause and resume change state once and are idempotent", async () => {
  await withJobsDatabase((database) => {
    const batchId = "pause-resume-batch" as JobBatchId;
    const jobId = "pause-resume-job" as JobId;
    enqueueControlBatch(database, batchId, [jobId]);

    assertSuccess(
      setJobsBatchState(database, batchId, "pause", ONE_SECOND_LATER),
      "Pause",
    );
    assertDeepEqual(
      readBatch(database, batchId),
      {
        id: batchId,
        state: "paused",
        total_count: 1,
        created_at: NOW,
        changed_at: ONE_SECOND_LATER,
      },
      "Pause batch row changed",
    );
    const pausedJob = readJob(database, jobId);

    assertSuccess(
      setJobsBatchState(database, batchId, "pause", TWO_SECONDS_LATER),
      "Idempotent pause",
    );
    assertDeepEqual(readBatch(database, batchId)?.changed_at, ONE_SECOND_LATER, "Pause changed_at was rewritten");
    assertDeepEqual(readJob(database, jobId), pausedJob, "Idempotent pause changed a job");

    assertSuccess(
      setJobsBatchState(database, batchId, "resume", TWO_SECONDS_LATER),
      "Resume",
    );
    assertDeepEqual(readBatch(database, batchId)?.state, "active", "Resume did not activate batch");
    assertDeepEqual(readBatch(database, batchId)?.changed_at, TWO_SECONDS_LATER, "Resume changed_at changed incorrectly");

    assertSuccess(
      setJobsBatchState(database, batchId, "resume", "2026-07-13T12:00:03.000Z" as IsoDateTime),
      "Idempotent resume",
    );
    assertDeepEqual(readBatch(database, batchId)?.changed_at, TWO_SECONDS_LATER, "Resume changed_at was rewritten");
  });
});

test("cancel active batch updates changed_at and cancels its pending job", async () => {
  await withJobsDatabase((database) => {
    const batchId = "cancel-active-batch" as JobBatchId;
    const jobId = "cancel-active-pending-job" as JobId;
    enqueueControlBatch(database, batchId, [jobId]);

    assertSuccess(
      setJobsBatchState(database, batchId, "cancel", TWO_SECONDS_LATER),
      "Cancel active batch",
    );
    assertDeepEqual(
      readBatch(database, batchId),
      {
        id: batchId,
        state: "cancelled",
        total_count: 1,
        created_at: NOW,
        changed_at: TWO_SECONDS_LATER,
      },
      "Active cancel batch row changed",
    );
    assertDeepEqual(
      readJob(database, jobId),
      {
        id: jobId,
        batch_id: batchId,
        state: "cancelled",
        attempt: 0,
        not_before: null,
        retry_at: null,
        lease_token: null,
        worker_id: null,
        leased_at: null,
        lease_expires_at: null,
        result_kind: null,
        result_id: null,
        failure_code: null,
        failure_disposition: null,
        failure_diagnostic: null,
        completed_at: TWO_SECONDS_LATER,
      },
      "Active cancel pending job changed",
    );
  });
});

test("cancel atomically cancels pending and retry-wait jobs only", async () => {
  await withJobsDatabase((database) => {
    const batchId = "cancel-branches-batch" as JobBatchId;
    const pendingId = "cancel-pending-job" as JobId;
    const retryId = "cancel-retry-job" as JobId;
    const leasedId = "cancel-leased-job" as JobId;
    const failedId = "cancel-failed-job" as JobId;
    const succeededId = "cancel-succeeded-job" as JobId;
    const jobIds = [pendingId, retryId, leasedId, failedId, succeededId] as const;
    enqueueControlBatch(database, batchId, jobIds);
    database
      .prepare("UPDATE jobs SET state = 'retry_wait', retry_at = ? WHERE id = ?")
      .run(TWO_SECONDS_LATER, retryId);
    forceLease(database, {
      jobId: leasedId,
      attempt: 1,
      token: "cancel-leased-token",
      expiresAt: TWO_SECONDS_LATER,
    });
    database
      .prepare(
        "UPDATE jobs SET state = 'failed', failure_code = ?, " +
          "failure_disposition = 'terminal', failure_diagnostic = ?, completed_at = ? " +
          "WHERE id = ?",
      )
      .run("old-failure", "old failure diagnostic", NOW, failedId);
    database
      .prepare(
        "UPDATE jobs SET state = 'succeeded', result_kind = 'health_observation', " +
          "result_id = ?, completed_at = ? WHERE id = ?",
      )
      .run("old-observation", NOW, succeededId);
    assertSuccess(
      setJobsBatchState(database, batchId, "pause", NOW),
      "Pause before cancel",
    );
    const leasedBefore = readJob(database, leasedId);
    const failedBefore = readJob(database, failedId);
    const succeededBefore = readJob(database, succeededId);

    assertSuccess(
      setJobsBatchState(database, batchId, "cancel", ONE_SECOND_LATER),
      "Cancel paused batch",
    );
    assertDeepEqual(
      readBatch(database, batchId),
      {
        id: batchId,
        state: "cancelled",
        total_count: 5,
        created_at: NOW,
        changed_at: ONE_SECOND_LATER,
      },
      "Cancelled batch row changed",
    );
    assertDeepEqual(
      readJob(database, pendingId),
      {
        id: pendingId,
        batch_id: batchId,
        state: "cancelled",
        attempt: 0,
        not_before: null,
        retry_at: null,
        lease_token: null,
        worker_id: null,
        leased_at: null,
        lease_expires_at: null,
        result_kind: null,
        result_id: null,
        failure_code: null,
        failure_disposition: null,
        failure_diagnostic: null,
        completed_at: ONE_SECOND_LATER,
      },
      "Pending job was not cancelled exactly",
    );
    assertDeepEqual(
      readJob(database, retryId),
      {
        id: retryId,
        batch_id: batchId,
        state: "cancelled",
        attempt: 0,
        not_before: null,
        retry_at: null,
        lease_token: null,
        worker_id: null,
        leased_at: null,
        lease_expires_at: null,
        result_kind: null,
        result_id: null,
        failure_code: null,
        failure_disposition: null,
        failure_diagnostic: null,
        completed_at: ONE_SECOND_LATER,
      },
      "Retry-wait job was not cancelled exactly",
    );
    assertDeepEqual(readJob(database, leasedId), leasedBefore, "Leased job was changed by cancel");
    assertDeepEqual(readJob(database, failedId), failedBefore, "Failed job was changed by cancel");
    assertDeepEqual(readJob(database, succeededId), succeededBefore, "Succeeded job was changed by cancel");

    const cancelledBatchBefore = readBatch(database, batchId);
    const cancelledRowsBefore = jobIds.map((jobId) => readJob(database, jobId));
    assertSuccess(
      setJobsBatchState(database, batchId, "cancel", TWO_SECONDS_LATER),
      "Idempotent cancel",
    );
    assertDeepEqual(readBatch(database, batchId), cancelledBatchBefore, "Idempotent cancel changed batch");
    assertDeepEqual(
      jobIds.map((jobId) => readJob(database, jobId)),
      cancelledRowsBefore,
      "Idempotent cancel changed jobs",
    );

    const cancelledBatch = readBatch(database, batchId);
    const cancelledRows = jobIds.map((jobId) => readJob(database, jobId));
    assertFailure(
      setJobsBatchState(database, batchId, "pause", TWO_SECONDS_LATER),
      "invalid_transition",
      "Pause cancelled batch",
    );
    assertFailure(
      setJobsBatchState(database, batchId, "resume", TWO_SECONDS_LATER),
      "invalid_transition",
      "Resume cancelled batch",
    );
    assertDeepEqual(readBatch(database, batchId), cancelledBatch, "Invalid cancelled controls changed batch");
    assertDeepEqual(
      jobIds.map((jobId) => readJob(database, jobId)),
      cancelledRows,
      "Invalid cancelled controls changed jobs",
    );
  });
});

test("controls reject missing or malformed requests before writes", async () => {
  await withJobsDatabase((database) => {
    const batchId = "control-validation-batch" as JobBatchId;
    const jobId = "control-validation-job" as JobId;
    enqueueControlBatch(database, batchId, [jobId]);
    const beforeBatch = readBatch(database, batchId);
    const beforeJob = readJob(database, jobId);

    assertFailure(
      setJobsBatchState(database, "" as JobBatchId, "pause", NOW),
      "invalid_request",
      "Empty batch ID",
    );
    assertFailure(
      setJobsBatchState(database, batchId, "unknown" as "pause", NOW),
      "invalid_request",
      "Unknown action",
    );
    assertFailure(
      setJobsBatchState(database, batchId, "pause", "not-a-date" as IsoDateTime),
      "invalid_request",
      "Non-canonical changed time",
    );
    assertDeepEqual(readBatch(database, batchId), beforeBatch, "Malformed control changed batch");
    assertDeepEqual(readJob(database, jobId), beforeJob, "Malformed control changed job");

    assertFailure(
      setJobsBatchState(database, "missing-batch" as JobBatchId, "pause", NOW),
      "batch_not_found",
      "Missing batch",
    );
    assertDeepEqual(readBatch(database, batchId), beforeBatch, "Missing control changed existing batch");
  });
});

test("cancel rollback preserves the batch and all jobs after a child-update abort", async () => {
  await withJobsDatabase((database) => {
    const batchId = "rollback-cancel-batch" as JobBatchId;
    const pendingId = "rollback-cancel-pending" as JobId;
    const retryId = "rollback-cancel-retry" as JobId;
    enqueueControlBatch(database, batchId, [pendingId, retryId]);
    database
      .prepare("UPDATE jobs SET state = 'retry_wait', retry_at = ? WHERE id = ?")
      .run(ONE_SECOND_LATER, retryId);
    const beforeBatch = readBatch(database, batchId);
    const beforeRows = [readJob(database, pendingId), readJob(database, retryId)];
    database.exec(
      "CREATE TRIGGER abort_cancel_jobs BEFORE UPDATE OF state ON jobs " +
        "WHEN NEW.state = 'cancelled' " +
        "BEGIN SELECT RAISE(ABORT, 'test-only cancel abort'); END",
    );

    assertFailure(
      setJobsBatchState(database, batchId, "cancel", TWO_SECONDS_LATER),
      "storage_unavailable",
      "Aborted cancel",
    );
    assertDeepEqual(readBatch(database, batchId), beforeBatch, "Cancel rollback changed batch");
    assertDeepEqual(
      [readJob(database, pendingId), readJob(database, retryId)],
      beforeRows,
      "Cancel rollback changed jobs",
    );
    database.exec("DROP TRIGGER abort_cancel_jobs");
    assertSuccess(
      setJobsBatchState(database, batchId, "cancel", TWO_SECONDS_LATER),
      "Cancel after rollback",
    );
  });

  await withClosedJobsDatabase((database) => {
    assertDeepEqual(
      setJobsBatchState(database, "closed-batch" as JobBatchId, "cancel", NOW),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed control failure changed",
    );
  });
});
