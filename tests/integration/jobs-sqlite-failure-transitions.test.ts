import type {
  IsoDateTime,
  JobBatchId,
  JobId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  JobQueueFailure,
  StoredFailureCommand,
  TypedJobFailure,
} from "../../modules/jobs/public.js";
import type {
  JobsSqliteFixtureApi,
  SqliteDatabase,
} from "../helpers/jobs-sqlite-fixture.ts";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface FailureTransitionApi {
  failJobLease(
    database: SqliteDatabase,
    command: StoredFailureCommand,
  ): Outcome<void, JobQueueFailure>;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const fixture = loadModule(
  "../helpers/jobs-sqlite-fixture.ts",
) as JobsSqliteFixtureApi;
const {
  EXPIRED_AT,
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
const { failJobLease } = loadModule(
  "../../adapters/sqlite/jobs-transitions.ts",
) as FailureTransitionApi;

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

function failureCommand(
  token: string,
  failure: TypedJobFailure,
  expectedAttempt = 1,
  retryAt?: IsoDateTime,
): StoredFailureCommand {
  return {
    token: token as StoredFailureCommand["token"],
    expectedAttempt,
    failure,
    failedAt: NOW,
    ...(retryAt === undefined ? {} : { retryAt }),
  };
}

test("failure transitions store opaque evidence across retry and terminal branches", async () => {
  const cases: readonly {
    readonly name: string;
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly batchState?: "cancelled";
    readonly failure: TypedJobFailure;
    readonly retryAt?: IsoDateTime;
    readonly expectedState: string;
    readonly expectedCompletedAt: IsoDateTime | null;
    readonly expectedRetryAt: IsoDateTime | null;
  }[] = [
    {
      name: "retry with attempts remaining",
      attempt: 1,
      maxAttempts: 3,
      failure: {
        code: "terminal-looking-code",
        disposition: "retry",
        diagnostic: "retry diagnostic is opaque",
      },
      retryAt: TWO_SECONDS_LATER,
      expectedState: "retry_wait",
      expectedCompletedAt: null,
      expectedRetryAt: TWO_SECONDS_LATER,
    },
    {
      name: "terminal disposition",
      attempt: 1,
      maxAttempts: 3,
      failure: {
        code: "retry-looking-code",
        disposition: "terminal",
        diagnostic: "terminal diagnostic is opaque",
      },
      expectedState: "failed",
      expectedCompletedAt: NOW,
      expectedRetryAt: null,
    },
    {
      name: "retry at attempt limit",
      attempt: 3,
      maxAttempts: 3,
      failure: { code: "limit-code", disposition: "retry", diagnostic: "limit diagnostic" },
      retryAt: TWO_SECONDS_LATER,
      expectedState: "failed",
      expectedCompletedAt: NOW,
      expectedRetryAt: null,
    },
    {
      name: "cancelled batch",
      attempt: 1,
      maxAttempts: 3,
      batchState: "cancelled",
      failure: { code: "cancelled-code", disposition: "retry", diagnostic: "cancelled diagnostic" },
      retryAt: TWO_SECONDS_LATER,
      expectedState: "cancelled",
      expectedCompletedAt: NOW,
      expectedRetryAt: null,
    },
  ];

  for (const item of cases) {
    await withJobsDatabase((database) => {
      const prefix = item.name.replaceAll(" ", "-");
      const jobId = `${prefix}-job` as JobId;
      const batchId = `${prefix}-batch` as JobBatchId;
      enqueueJobs(
        database,
        makeEnqueueCommand({
          batchId,
          jobIds: [jobId],
          jobs: [makeJob({ maxAttempts: item.maxAttempts })],
        }),
      );
      forceLease(database, {
        jobId,
        attempt: item.attempt,
        token: `${prefix}-token`,
        expiresAt: ONE_SECOND_LATER,
      });
      if (item.batchState === "cancelled") {
        database
          .prepare("UPDATE job_batches SET state = 'cancelled' WHERE id = ?")
          .run(batchId);
      }

      assertSuccess(
        failJobLease(
          database,
          failureCommand(`${prefix}-token`, item.failure, item.attempt, item.retryAt),
        ),
        item.name,
      );
      assertDeepEqual(
        readFullJob(database, jobId),
        {
          id: jobId,
          batch_id: batchId,
          state: item.expectedState,
          attempt: item.attempt,
          not_before: null,
          retry_at: item.expectedRetryAt,
          lease_token: null,
          worker_id: null,
          leased_at: null,
          lease_expires_at: null,
          result_kind: null,
          result_id: null,
          failure_code: item.failure.code,
          failure_disposition: item.failure.disposition,
          failure_diagnostic: item.failure.diagnostic,
          completed_at: item.expectedCompletedAt,
        },
        `${item.name} row changed`,
      );
    });
  }
});

test("failure rejects stale leases without mutation", async () => {
  const failure: TypedJobFailure = {
    code: "opaque-failure-code",
    disposition: "retry",
    diagnostic: "opaque failure diagnostic",
  };
  const cases: readonly {
    readonly name: string;
    readonly storedToken: string;
    readonly command: StoredFailureCommand;
    readonly expiresAt?: IsoDateTime;
  }[] = [
    {
      name: "unknown failure token",
      storedToken: "current-failure-token",
      command: failureCommand("unknown-failure-token", failure, 1, TWO_SECONDS_LATER),
    },
    {
      name: "failure expiry boundary",
      storedToken: "boundary-failure-token",
      command: failureCommand("boundary-failure-token", failure, 1, TWO_SECONDS_LATER),
      expiresAt: NOW,
    },
    {
      name: "failure attempt mismatch",
      storedToken: "attempt-failure-token",
      command: failureCommand("attempt-failure-token", failure, 2, TWO_SECONDS_LATER),
    },
  ];

  for (const item of cases) {
    await withJobsDatabase((database) => {
      const prefix = item.name.replaceAll(" ", "-");
      const jobId = `${prefix}-job` as JobId;
      enqueueJobs(
        database,
        makeEnqueueCommand({
          batchId: `${prefix}-batch` as JobBatchId,
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
        failJobLease(database, item.command),
        "stale_lease",
        item.name,
      );
      assertDeepEqual(readFullJob(database, jobId), before, `${item.name} mutated a row`);
    });
  }

  await withJobsDatabase((database) => {
    const jobId = "consumed-failure-job" as JobId;
    const batchId = "consumed-failure-batch" as JobBatchId;
    enqueueJobs(
      database,
      makeEnqueueCommand({ batchId, jobIds: [jobId], jobs: [makeJob()] }),
    );
    forceLease(database, {
      jobId,
      attempt: 1,
      token: "consumed-failure-token",
      expiresAt: ONE_SECOND_LATER,
    });
    const command = failureCommand(
      "consumed-failure-token",
      { code: "first", disposition: "terminal" },
    );
    assertSuccess(failJobLease(database, command), "Initial failure");
    const before = readFullJob(database, jobId);

    assertFailure(failJobLease(database, command), "stale_lease", "Consumed failure");
    assertDeepEqual(readFullJob(database, jobId), before, "Consumed failure mutated a row");
  });
});

test("malformed failure commands return invalid_request before writes", async () => {
  const baseFailure: TypedJobFailure = {
    code: "failure-code",
    disposition: "retry",
    diagnostic: "diagnostic evidence",
  };
  const base = failureCommand(
    "validation-failure-token",
    baseFailure,
    1,
    TWO_SECONDS_LATER,
  );
  const cases: readonly { readonly name: string; readonly command: unknown }[] = [
    { name: "unknown command key", command: { ...base, extra: true } },
    { name: "empty token", command: { ...base, token: "" } },
    { name: "zero attempt", command: { ...base, expectedAttempt: 0 } },
    { name: "empty failure code", command: { ...base, failure: { ...baseFailure, code: "" } } },
    { name: "unknown failure key", command: { ...base, failure: { ...baseFailure, extra: true } } },
    { name: "unsupported disposition", command: { ...base, failure: { ...baseFailure, disposition: "other" } } },
    { name: "invalid diagnostic", command: { ...base, failure: { ...baseFailure, diagnostic: 42 } } },
    { name: "missing retry time", command: { ...base, retryAt: undefined } },
    { name: "retry before failure", command: { ...base, retryAt: EXPIRED_AT } },
    { name: "non-canonical retry time", command: { ...base, retryAt: "not-a-date" } },
    {
      name: "terminal retry time",
      command: {
        token: base.token,
        expectedAttempt: 1,
        failure: { code: "terminal", disposition: "terminal" },
        failedAt: NOW,
        retryAt: TWO_SECONDS_LATER,
      },
    },
    { name: "non-canonical failure time", command: { ...base, failedAt: "not-a-date" } },
  ];

  for (const item of cases) {
    await withJobsDatabase((database) => {
      const jobId = "validation-failure-job" as JobId;
      enqueueJobs(
        database,
        makeEnqueueCommand({
          batchId: "validation-failure-batch" as JobBatchId,
          jobIds: [jobId],
          jobs: [makeJob()],
        }),
      );
      forceLease(database, {
        jobId,
        attempt: 1,
        token: "validation-failure-token",
        expiresAt: ONE_SECOND_LATER,
      });
      const before = readFullJob(database, jobId);

      assertFailure(
        failJobLease(database, item.command as StoredFailureCommand),
        "invalid_request",
        item.name,
      );
      assertDeepEqual(readFullJob(database, jobId), before, `${item.name} changed a row`);
    });
  }
});

test("closed databases return storage_unavailable for failure transitions", async () => {
  await withClosedJobsDatabase((database) => {
    assertDeepEqual(
      failJobLease(
        database,
        failureCommand("closed-token", { code: "closed", disposition: "terminal" }),
      ),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed failure failure changed",
    );
  });
});
