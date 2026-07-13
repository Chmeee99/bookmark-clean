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
  StoredEnqueueCommand,
  StoredLeaseCommand,
} from "../../modules/jobs/public.js";
import type {
  JobsSqliteFixtureApi,
  SqliteDatabase,
} from "../helpers/jobs-sqlite-fixture.ts";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface LeaseApi {
  leaseNextJob(
    database: SqliteDatabase,
    command: StoredLeaseCommand,
  ): Outcome<JobLease | null, JobQueueFailure>;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const fixture = loadModule(
  "../helpers/jobs-sqlite-fixture.ts",
) as JobsSqliteFixtureApi;
const {
  EARLIER_CREATED_AT,
  LATER_CREATED_AT,
  NOW,
  ONE_SECOND_LATER,
  enqueueJobs,
  makeEnqueueCommand,
  makeJob,
  makeLeaseCommand,
  readJob,
  withClosedJobsDatabase,
  withJobsDatabase,
} = fixture;
const { leaseNextJob } = loadModule(
  "../../adapters/sqlite/jobs-lease.ts",
) as LeaseApi;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}. Expected ${String(expected)}, received ${String(actual)}`,
    );
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
  result: Outcome<JobLease | null, JobQueueFailure>,
  message: string,
): asserts result is { ok: true; value: JobLease | null } {
  assert(result.ok, `${message} should succeed`);
}

test("malformed lease commands return invalid_request before changing rows", async () => {
  const base = makeLeaseCommand();
  const cases: readonly { name: string; command: unknown }[] = [
    { name: "unknown command key", command: { ...base, extra: true } },
    {
      name: "unknown worker key",
      command: { ...base, worker: { id: "worker-fixed", extra: true } },
    },
    { name: "empty worker", command: { ...base, worker: { id: "" } } },
    { name: "empty token", command: { ...base, token: "" } },
    { name: "empty capabilities", command: { ...base, capabilities: [] } },
    {
      name: "unsupported capability",
      command: { ...base, capabilities: ["unknown"] },
    },
    {
      name: "duplicate capabilities",
      command: { ...base, capabilities: ["health_check", "health_check"] },
    },
    {
      name: "non-canonical now",
      command: { ...base, now: "2026-07-13T12:00:00Z" },
    },
    {
      name: "non-canonical expiry",
      command: { ...base, expiresAt: "2026-07-13T12:00:01Z" },
    },
    {
      name: "expiry equal to now",
      command: { ...base, expiresAt: NOW },
    },
    {
      name: "expiry before now",
      command: { ...base, expiresAt: "2026-07-13T11:59:59.999Z" },
    },
  ];

  for (const item of cases) {
    await withJobsDatabase((database) => {
      const command = makeEnqueueCommand({
        batchId: "validation-batch" as JobBatchId,
        jobIds: ["validation-job" as JobId],
        jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-validation" as BookmarkId, inputVersion: "version-1" } })],
      });
      enqueueJobs(database, command);
      const before = database.prepare("SELECT * FROM jobs").all();

      assertFailure(
        leaseNextJob(database, item.command as StoredLeaseCommand),
        "invalid_request",
        item.name,
      );
      assertDeepEqual(
        database.prepare("SELECT * FROM jobs").all(),
        before,
        `${item.name} changed rows`,
      );
    });
  }
});

test("leases candidates in priority, sequence, batch-created, then job-ID order", async () => {
  const cases: readonly {
    name: string;
    commands: readonly StoredEnqueueCommand[];
    expectedJobId: JobId;
  }[] = [
    {
      name: "priority",
      commands: [
        makeEnqueueCommand({
          batchId: "priority-batch" as JobBatchId,
          jobIds: ["priority-low", "priority-high"] as JobId[],
          jobs: [
            makeJob({ sequence: 0, priority: 1, target: { kind: "bookmark", bookmarkId: "bookmark-low" as BookmarkId, inputVersion: "version-1" } }),
            makeJob({ sequence: 1, priority: 2, target: { kind: "bookmark", bookmarkId: "bookmark-high" as BookmarkId, inputVersion: "version-1" } }),
          ],
        }),
      ],
      expectedJobId: "priority-high" as JobId,
    },
    {
      name: "sequence",
      commands: [
        makeEnqueueCommand({
          batchId: "sequence-batch" as JobBatchId,
          jobIds: ["sequence-late", "sequence-early"] as JobId[],
          jobs: [
            makeJob({ sequence: 2, priority: 1, target: { kind: "bookmark", bookmarkId: "bookmark-late" as BookmarkId, inputVersion: "version-1" } }),
            makeJob({ sequence: 1, priority: 1, target: { kind: "bookmark", bookmarkId: "bookmark-early" as BookmarkId, inputVersion: "version-1" } }),
          ],
        }),
      ],
      expectedJobId: "sequence-early" as JobId,
    },
    {
      name: "batch creation",
      commands: [
        makeEnqueueCommand({
          batchId: "created-late" as JobBatchId,
          jobIds: ["created-late-job" as JobId],
          createdAt: LATER_CREATED_AT,
          jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-late" as BookmarkId, inputVersion: "version-1" } })],
        }),
        makeEnqueueCommand({
          batchId: "created-early" as JobBatchId,
          jobIds: ["created-early-job" as JobId],
          createdAt: EARLIER_CREATED_AT,
          jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-early" as BookmarkId, inputVersion: "version-1" } })],
        }),
      ],
      expectedJobId: "created-early-job" as JobId,
    },
    {
      name: "job ID",
      commands: [
        makeEnqueueCommand({
          batchId: "job-id-z-batch" as JobBatchId,
          jobIds: ["job-z" as JobId],
          createdAt: EARLIER_CREATED_AT,
          jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-z" as BookmarkId, inputVersion: "version-1" } })],
        }),
        makeEnqueueCommand({
          batchId: "job-id-a-batch" as JobBatchId,
          jobIds: ["job-a" as JobId],
          createdAt: EARLIER_CREATED_AT,
          jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-a" as BookmarkId, inputVersion: "version-1" } })],
        }),
      ],
      expectedJobId: "job-a" as JobId,
    },
  ];

  for (const item of cases) {
    await withJobsDatabase((database) => {
      for (const command of item.commands) {
        enqueueJobs(database, command);
      }
      const result = leaseNextJob(
        database,
        makeLeaseCommand({ token: `${item.name}-token` as StoredLeaseCommand["token"] }),
      );
      assertSuccess(result, `${item.name} order`);
      assert(result.value !== null, `${item.name} did not lease a candidate`);
      assertEqual(result.value.jobId, item.expectedJobId, `${item.name} order changed`);
    });
  }
});

test("applies active, capability, not-before, retry-at, and due-state gates", async () => {
  await withJobsDatabase((database) => {
    const futureCommand = makeEnqueueCommand({
      batchId: "future-batch" as JobBatchId,
      jobIds: ["future-job" as JobId],
      jobs: [
        makeJob({
          notBefore: ONE_SECOND_LATER,
          target: { kind: "bookmark", bookmarkId: "bookmark-future" as BookmarkId, inputVersion: "version-1" },
        }),
      ],
    });
    enqueueJobs(database, futureCommand);
    const future = leaseNextJob(database, makeLeaseCommand({ token: "future-token" as StoredLeaseCommand["token"] }));
    assertSuccess(future, "Future not-before gate");
    assertEqual(future.value, null, "Future not-before job was leased");

    const retryCommand = makeEnqueueCommand({
      batchId: "retry-batch" as JobBatchId,
      jobIds: ["retry-job" as JobId],
      jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-retry" as BookmarkId, inputVersion: "version-1" } })],
    });
    enqueueJobs(database, retryCommand);
    database
      .prepare("UPDATE jobs SET state = 'retry_wait', retry_at = ? WHERE id = ?")
      .run(ONE_SECOND_LATER, "retry-job");

    const futureRetry = leaseNextJob(
      database,
      makeLeaseCommand({ token: "future-retry-token" as StoredLeaseCommand["token"] }),
    );
    assertSuccess(futureRetry, "Future retry-at gate");
    assertEqual(futureRetry.value, null, "Future retry-wait job was leased");

    database
      .prepare("UPDATE jobs SET retry_at = ? WHERE id = ?")
      .run(NOW, "retry-job");
    const dueRetry = leaseNextJob(
      database,
      makeLeaseCommand({ token: "due-retry-token" as StoredLeaseCommand["token"] }),
    );
    assertSuccess(dueRetry, "Due retry-wait job");
    assert(dueRetry.value !== null, "Due retry-wait job was not leased");
    assertEqual(dueRetry.value.jobId, "retry-job", "Wrong retry-wait job leased");
    assertEqual(readJob(database, "retry-job" as JobId)?.retry_at, null, "retry_at was not cleared");

    const pausedCommand = makeEnqueueCommand({
      batchId: "paused-batch" as JobBatchId,
      jobIds: ["paused-job" as JobId],
      jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-paused" as BookmarkId, inputVersion: "version-1" } })],
    });
    enqueueJobs(database, pausedCommand);
    database
      .prepare("UPDATE job_batches SET state = 'paused' WHERE id = ?")
      .run("paused-batch");
    const paused = leaseNextJob(
      database,
      makeLeaseCommand({ token: "paused-token" as StoredLeaseCommand["token"] }),
    );
    assertSuccess(paused, "Paused batch gate");
    assertEqual(paused.value, null, "Paused batch job was leased");
  });
});

test("increments attempt once and returns exact lease fields", async () => {
  await withJobsDatabase((database) => {
    const jobId = "attempt-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "attempt-batch" as JobBatchId,
        jobIds: [jobId],
        jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-attempt" as BookmarkId, inputVersion: "version-1" } })],
      }),
    );
    database.prepare("UPDATE jobs SET attempt = 1 WHERE id = ?").run(jobId);

    const result = leaseNextJob(
      database,
      makeLeaseCommand({
        worker: { id: "worker-exact" as StoredLeaseCommand["worker"]["id"] },
        token: "token-exact" as StoredLeaseCommand["token"],
      }),
    );
    assertSuccess(result, "Exact lease");
    assertDeepEqual(
      result,
      {
        ok: true,
        value: {
          token: "token-exact",
          jobId,
          batchId: "attempt-batch",
          type: "health_check",
          target: {
            kind: "bookmark",
            bookmarkId: "bookmark-attempt",
            inputVersion: "version-1",
          },
          attempt: 2,
          leasedAt: NOW,
          expiresAt: ONE_SECOND_LATER,
        },
      },
      "Lease result changed",
    );
    assertDeepEqual(
      readJob(database, jobId),
      {
        id: jobId,
        batch_id: "attempt-batch",
        state: "leased",
        attempt: 2,
        not_before: null,
        retry_at: null,
        lease_token: "token-exact",
        worker_id: "worker-exact",
        leased_at: NOW,
        lease_expires_at: ONE_SECOND_LATER,
        failure_code: null,
        failure_disposition: null,
        failure_diagnostic: null,
        completed_at: null,
      },
      "Stored lease row changed",
    );
  });
});

test("returns null when no candidate exists and rejects an existing token", async () => {
  await withJobsDatabase((database) => {
    const futureJob = "empty-future-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "empty-batch" as JobBatchId,
        jobIds: [futureJob],
        jobs: [makeJob({ notBefore: ONE_SECOND_LATER })],
      }),
    );
    const empty = leaseNextJob(database, makeLeaseCommand({ token: "empty-token" as StoredLeaseCommand["token"] }));
    assertSuccess(empty, "Empty candidate");
    assertEqual(empty.value, null, "Empty candidate returned a lease");

    const collisionJob = "collision-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "collision-batch" as JobBatchId,
        jobIds: [collisionJob],
      }),
    );
    database
      .prepare(
        "UPDATE jobs SET state = 'leased', attempt = 1, lease_token = ?, " +
          "worker_id = 'worker-old', leased_at = ?, lease_expires_at = ? WHERE id = ?",
      )
      .run("collision-token", NOW, "2026-07-13T11:59:59.000Z", collisionJob);
    const before = readJob(database, collisionJob);

    assertFailure(
      leaseNextJob(
        database,
        makeLeaseCommand({ token: "collision-token" as StoredLeaseCommand["token"] }),
      ),
      "invalid_request",
      "Token collision",
    );
    assertDeepEqual(readJob(database, collisionJob), before, "Token collision changed the row");
  });
});

test("closed database returns storage_unavailable", async () => {
  await withClosedJobsDatabase((database) => {
    assertDeepEqual(
      leaseNextJob(database, makeLeaseCommand()),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed lease failure changed",
    );
  });
});
