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

interface TransitionApi {
  completeJobLease(
    database: SqliteDatabase,
    command: StoredCompletionCommand,
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
  enqueueJobs,
  forceLease,
  makeEnqueueCommand,
  makeJob,
  withClosedJobsDatabase,
  withJobsDatabase,
} = fixture;
const { completeJobLease } = loadModule(
  "../../adapters/sqlite/jobs-transitions.ts",
) as TransitionApi;

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

function assertSuccess(
  result: Outcome<void, JobQueueFailure>,
  message: string,
): void {
  assertDeepEqual(result, { ok: true, value: undefined }, message);
}

function readFullJob(
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

function completionCommand(
  token: string,
  expectedAttempt = 1,
  completedAt: IsoDateTime = NOW,
): StoredCompletionCommand {
  return {
    token: token as StoredCompletionCommand["token"],
    expectedAttempt,
    result: {
      kind: "health_observation",
      id: "observation-fixed" as StoredCompletionCommand["result"]["id"],
    },
    completedAt,
  };
}

test("completes current leases in active and cancelled batches", async () => {
  await withJobsDatabase((database) => {
    const jobId = "complete-active-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "complete-active-batch" as JobBatchId,
        jobIds: [jobId],
        jobs: [
          makeJob({
            target: {
              kind: "bookmark",
              bookmarkId: "complete-active-bookmark" as BookmarkId,
              inputVersion: "version-1",
            },
          }),
        ],
      }),
    );
    forceLease(database, {
      jobId,
      attempt: 1,
      token: "complete-active-token",
      expiresAt: ONE_SECOND_LATER,
      failureCode: "prior-code",
      failureDisposition: "retry",
      failureDiagnostic: "prior diagnostic remains opaque",
    });

    assertSuccess(
      completeJobLease(database, completionCommand("complete-active-token")),
      "Active completion",
    );
    assertDeepEqual(
      readFullJob(database, jobId),
      {
        id: jobId,
        batch_id: "complete-active-batch",
        state: "succeeded",
        attempt: 1,
        not_before: null,
        retry_at: null,
        lease_token: null,
        worker_id: null,
        leased_at: null,
        lease_expires_at: null,
        result_kind: "health_observation",
        result_id: "observation-fixed",
        failure_code: "prior-code",
        failure_disposition: "retry",
        failure_diagnostic: "prior diagnostic remains opaque",
        completed_at: NOW,
      },
      "Active completion row changed",
    );
  });

  await withJobsDatabase((database) => {
    const jobId = "complete-cancelled-job" as JobId;
    const batchId = "complete-cancelled-batch" as JobBatchId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId,
        jobIds: [jobId],
        jobs: [makeJob()],
      }),
    );
    forceLease(database, {
      jobId,
      attempt: 1,
      token: "complete-cancelled-token",
      expiresAt: ONE_SECOND_LATER,
    });
    database
      .prepare("UPDATE job_batches SET state = 'cancelled' WHERE id = ?")
      .run(batchId);

    assertSuccess(
      completeJobLease(database, completionCommand("complete-cancelled-token")),
      "Cancelled-batch completion",
    );
    assertDeepEqual(
      readFullJob(database, jobId),
      {
        id: jobId,
        batch_id: batchId,
        state: "succeeded",
        attempt: 1,
        not_before: null,
        retry_at: null,
        lease_token: null,
        worker_id: null,
        leased_at: null,
        lease_expires_at: null,
        result_kind: "health_observation",
        result_id: "observation-fixed",
        failure_code: null,
        failure_disposition: null,
        failure_diagnostic: null,
        completed_at: NOW,
      },
      "Cancelled-batch completion row changed",
    );
  });
});

test("completion rejects stale leases without mutation", async () => {
  const cases: readonly {
    readonly name: string;
    readonly storedToken: string;
    readonly command: StoredCompletionCommand;
    readonly expiresAt?: IsoDateTime;
  }[] = [
    {
      name: "unknown token",
      storedToken: "current-token",
      command: completionCommand("unknown-token"),
    },
    {
      name: "expiry boundary",
      storedToken: "boundary-token",
      command: completionCommand("boundary-token"),
      expiresAt: NOW,
    },
    {
      name: "attempt mismatch",
      storedToken: "attempt-token",
      command: completionCommand("attempt-token", 2),
    },
  ];

  for (const item of cases) {
    await withJobsDatabase((database) => {
      const jobId = `${item.name.replaceAll(" ", "-")}-job` as JobId;
      enqueueJobs(
        database,
        makeEnqueueCommand({
          batchId: `${item.name.replaceAll(" ", "-")}-batch` as JobBatchId,
          jobIds: [jobId],
          jobs: [makeJob()],
        }),
      );
      forceLease(database, {
        jobId,
        attempt: 1,
        token: item.storedToken,
        expiresAt: item.expiresAt ?? ONE_SECOND_LATER,
      });
      const before = readFullJob(database, jobId);

      assertFailure(
        completeJobLease(database, item.command),
        "stale_lease",
        item.name,
      );
      assertDeepEqual(readFullJob(database, jobId), before, `${item.name} mutated a row`);
    });
  }

  await withJobsDatabase((database) => {
    const jobId = "consumed-completion-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "consumed-completion-batch" as JobBatchId,
        jobIds: [jobId],
        jobs: [makeJob()],
      }),
    );
    forceLease(database, {
      jobId,
      attempt: 1,
      token: "consumed-completion-token",
      expiresAt: ONE_SECOND_LATER,
    });
    const command = completionCommand("consumed-completion-token");
    assertSuccess(completeJobLease(database, command), "Initial completion");
    const before = readFullJob(database, jobId);

    assertFailure(
      completeJobLease(database, command),
      "stale_lease",
      "Consumed completion",
    );
    assertDeepEqual(readFullJob(database, jobId), before, "Consumed completion mutated a row");
  });
});

test("malformed completion commands return invalid_request before writes", async () => {
  const base = completionCommand("validation-completion-token");
  const cases: readonly { readonly name: string; readonly command: unknown }[] = [
    { name: "unknown command key", command: { ...base, extra: true } },
    { name: "empty token", command: { ...base, token: "" } },
    { name: "zero attempt", command: { ...base, expectedAttempt: 0 } },
    {
      name: "unsafe attempt",
      command: { ...base, expectedAttempt: Number.MAX_SAFE_INTEGER + 1 },
    },
    { name: "invalid result kind", command: { ...base, result: { kind: "other", id: "id" } } },
    { name: "empty result ID", command: { ...base, result: { kind: "health_observation", id: "" } } },
    { name: "unknown result key", command: { ...base, result: { ...base.result, extra: true } } },
    { name: "non-canonical completion time", command: { ...base, completedAt: "not-a-date" } },
  ];

  for (const item of cases) {
    await withJobsDatabase((database) => {
      const jobId = "validation-completion-job" as JobId;
      enqueueJobs(
        database,
        makeEnqueueCommand({
          batchId: "validation-completion-batch" as JobBatchId,
          jobIds: [jobId],
          jobs: [makeJob()],
        }),
      );
      forceLease(database, {
        jobId,
        attempt: 1,
        token: "validation-completion-token",
        expiresAt: ONE_SECOND_LATER,
      });
      const before = readFullJob(database, jobId);

      assertFailure(
        completeJobLease(database, item.command as StoredCompletionCommand),
        "invalid_request",
        item.name,
      );
      assertDeepEqual(readFullJob(database, jobId), before, `${item.name} changed a row`);
    });
  }
});

test("completion rejects an invalid stored lease without repair", async () => {
  await withJobsDatabase((database) => {
    const jobId = "invalid-stored-completion-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "invalid-stored-completion-batch" as JobBatchId,
        jobIds: [jobId],
      }),
    );
    forceLease(database, {
      jobId,
      attempt: 1,
      token: "invalid-stored-completion-token",
      expiresAt: ONE_SECOND_LATER,
    });
    database
      .prepare("UPDATE jobs SET lease_expires_at = ? WHERE id = ?")
      .run("not-a-time", jobId);

    assertFailure(
      completeJobLease(
        database,
        completionCommand("invalid-stored-completion-token"),
      ),
      "stored_queue_invalid",
      "Invalid stored completion lease",
    );
  });
});

test("completion engine failures roll back and closed databases are unavailable", async () => {
  await withJobsDatabase((database) => {
    const jobId = "rollback-completion-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "rollback-completion-batch" as JobBatchId,
        jobIds: [jobId],
        jobs: [makeJob()],
      }),
    );
    forceLease(database, {
      jobId,
      attempt: 1,
      token: "rollback-completion-token",
      expiresAt: ONE_SECOND_LATER,
    });
    const before = readFullJob(database, jobId);
    database.exec(
      "CREATE TRIGGER abort_completion BEFORE UPDATE OF state ON jobs " +
        "WHEN OLD.state = 'leased' AND NEW.state = 'succeeded' " +
        "BEGIN SELECT RAISE(ABORT, 'test-only completion abort'); END",
    );

    assertFailure(
      completeJobLease(database, completionCommand("rollback-completion-token")),
      "storage_unavailable",
      "Aborted completion",
    );
    assertDeepEqual(readFullJob(database, jobId), before, "Completion rollback changed a row");
    database.exec("DROP TRIGGER abort_completion");
    assertSuccess(
      completeJobLease(database, completionCommand("rollback-completion-token")),
      "Completion after rollback",
    );
  });

  await withClosedJobsDatabase((database) => {
    assertDeepEqual(
      completeJobLease(database, completionCommand("closed-token")),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed completion failure changed",
    );
  });
});
