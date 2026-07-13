import type {
  BookmarkId,
  JobBatchId,
  JobId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  JobLease,
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
  EXPIRED_AT,
  NOW,
  ONE_SECOND_LATER,
  enqueueJobs,
  forceLease,
  makeEnqueueCommand,
  makeJob,
  makeLeaseCommand,
  readJob,
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

function assertSuccess(
  result: Outcome<JobLease | null, JobQueueFailure>,
  message: string,
): asserts result is { ok: true; value: JobLease | null } {
  assert(result.ok, `${message} should succeed`);
}

test("recovers every expired branch before selecting the active candidate", async () => {
  await withJobsDatabase((database) => {
    const activeJob = "recovery-active-job" as JobId;
    const pausedJob = "recovery-paused-job" as JobId;
    const cancelledJob = "recovery-cancelled-job" as JobId;
    const exhaustedJob = "recovery-exhausted-job" as JobId;

    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "recovery-active-batch" as JobBatchId,
        jobIds: [activeJob],
        jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-active" as BookmarkId, inputVersion: "version-1" } })],
      }),
    );
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "recovery-paused-batch" as JobBatchId,
        jobIds: [pausedJob],
        jobs: [makeJob({ notBefore: ONE_SECOND_LATER })],
      }),
    );
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "recovery-cancelled-batch" as JobBatchId,
        jobIds: [cancelledJob],
        jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-cancelled" as BookmarkId, inputVersion: "version-1" } })],
      }),
    );
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "recovery-exhausted-batch" as JobBatchId,
        jobIds: [exhaustedJob],
        jobs: [makeJob({ maxAttempts: 2, target: { kind: "bookmark", bookmarkId: "bookmark-exhausted" as BookmarkId, inputVersion: "version-1" } })],
      }),
    );
    database
      .prepare("UPDATE job_batches SET state = 'paused' WHERE id = ?")
      .run("recovery-paused-batch");
    database
      .prepare("UPDATE job_batches SET state = 'cancelled' WHERE id = ?")
      .run("recovery-cancelled-batch");

    forceLease(database, {
      jobId: activeJob,
      attempt: 1,
      token: "expired-active-token",
      failureCode: "prior_code",
      failureDisposition: "retry",
      failureDiagnostic: "prior diagnostic",
    });
    forceLease(database, {
      jobId: pausedJob,
      attempt: 1,
      token: "expired-paused-token",
      failureCode: "paused_prior",
      failureDisposition: "retry",
      failureDiagnostic: "paused diagnostic",
    });
    forceLease(database, {
      jobId: cancelledJob,
      attempt: 1,
      token: "expired-cancelled-token",
    });
    forceLease(database, {
      jobId: exhaustedJob,
      attempt: 2,
      token: "expired-exhausted-token",
      failureCode: "old_code",
      failureDisposition: "retry",
      failureDiagnostic: "old diagnostic",
    });

    const result = leaseNextJob(
      database,
      makeLeaseCommand({ token: "replacement-token" as StoredLeaseCommand["token"] }),
    );
    assertSuccess(result, "Recovery and selection");
    assert(result.value !== null, "Recovered active job was not leased");
    assertEqual(result.value.jobId, activeJob, "Wrong recovered candidate selected");
    assertEqual(result.value.attempt, 2, "Recovered attempt changed incorrectly");

    assertDeepEqual(
      readJob(database, activeJob),
      {
        id: activeJob,
        batch_id: "recovery-active-batch",
        state: "leased",
        attempt: 2,
        not_before: null,
        retry_at: null,
        lease_token: "replacement-token",
        worker_id: "worker-fixed",
        leased_at: NOW,
        lease_expires_at: ONE_SECOND_LATER,
        failure_code: "prior_code",
        failure_disposition: "retry",
        failure_diagnostic: "prior diagnostic",
        completed_at: null,
      },
      "Active recovery row changed",
    );
    assertDeepEqual(
      readJob(database, pausedJob),
      {
        id: pausedJob,
        batch_id: "recovery-paused-batch",
        state: "pending",
        attempt: 1,
        not_before: ONE_SECOND_LATER,
        retry_at: null,
        lease_token: null,
        worker_id: null,
        leased_at: null,
        lease_expires_at: null,
        failure_code: "paused_prior",
        failure_disposition: "retry",
        failure_diagnostic: "paused diagnostic",
        completed_at: null,
      },
      "Paused recovery row changed",
    );
    assertDeepEqual(
      readJob(database, cancelledJob),
      {
        id: cancelledJob,
        batch_id: "recovery-cancelled-batch",
        state: "cancelled",
        attempt: 1,
        not_before: null,
        retry_at: null,
        lease_token: null,
        worker_id: null,
        leased_at: null,
        lease_expires_at: null,
        failure_code: null,
        failure_disposition: null,
        failure_diagnostic: null,
        completed_at: NOW,
      },
      "Cancelled recovery row changed",
    );
    assertDeepEqual(
      readJob(database, exhaustedJob),
      {
        id: exhaustedJob,
        batch_id: "recovery-exhausted-batch",
        state: "failed",
        attempt: 2,
        not_before: null,
        retry_at: null,
        lease_token: null,
        worker_id: null,
        leased_at: null,
        lease_expires_at: null,
        failure_code: "lease_expired",
        failure_disposition: "terminal",
        failure_diagnostic: null,
        completed_at: NOW,
      },
      "Exhausted recovery row changed",
    );
  });
});

test("commits recovery even when there is no eligible candidate", async () => {
  await withJobsDatabase((database) => {
    const jobId = "null-recovery-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "null-recovery-batch" as JobBatchId,
        jobIds: [jobId],
        jobs: [makeJob({ notBefore: ONE_SECOND_LATER })],
      }),
    );
    forceLease(database, {
      jobId,
      attempt: 1,
      token: "null-expired-token",
      failureCode: "prior_code",
      failureDisposition: "retry",
      failureDiagnostic: "prior diagnostic",
    });

    const result = leaseNextJob(
      database,
      makeLeaseCommand({ token: "null-candidate-token" as StoredLeaseCommand["token"] }),
    );
    assertSuccess(result, "Null candidate");
    assertEqual(result.value, null, "Null candidate returned a lease");
    assertDeepEqual(
      readJob(database, jobId),
      {
        id: jobId,
        batch_id: "null-recovery-batch",
        state: "pending",
        attempt: 1,
        not_before: ONE_SECOND_LATER,
        retry_at: null,
        lease_token: null,
        worker_id: null,
        leased_at: null,
        lease_expires_at: null,
        failure_code: "prior_code",
        failure_disposition: "retry",
        failure_diagnostic: "prior diagnostic",
        completed_at: null,
      },
      "Null-candidate recovery did not commit",
    );
  });
});

test("rolls back recovery when the lease CAS fails", async () => {
  await withJobsDatabase((database) => {
    const jobId = "rollback-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "rollback-batch" as JobBatchId,
        jobIds: [jobId],
        jobs: [makeJob({ target: { kind: "bookmark", bookmarkId: "bookmark-rollback" as BookmarkId, inputVersion: "version-1" } })],
      }),
    );
    forceLease(database, {
      jobId,
      attempt: 1,
      token: "rollback-expired-token",
    });
    database.exec(
      "CREATE TRIGGER abort_lease_cas BEFORE UPDATE OF state ON jobs " +
        "WHEN OLD.state = 'pending' AND NEW.state = 'leased' " +
        "BEGIN SELECT RAISE(ABORT, 'test-only lease abort'); END",
    );

    assertDeepEqual(
      leaseNextJob(
        database,
        makeLeaseCommand({ token: "rollback-replacement-token" as StoredLeaseCommand["token"] }),
      ),
      { ok: false, error: { code: "storage_unavailable" } },
      "Lease CAS abort changed",
    );
    assertDeepEqual(
      readJob(database, jobId),
      {
        id: jobId,
        batch_id: "rollback-batch",
        state: "leased",
        attempt: 1,
        not_before: null,
        retry_at: null,
        lease_token: "rollback-expired-token",
        worker_id: "worker-crashed",
        leased_at: NOW,
        lease_expires_at: EXPIRED_AT,
        failure_code: null,
        failure_disposition: null,
        failure_diagnostic: null,
        completed_at: null,
      },
      "Recovery was not rolled back",
    );

    database.exec("DROP TRIGGER abort_lease_cas");
    const retry = leaseNextJob(
      database,
      makeLeaseCommand({ token: "rollback-retry-token" as StoredLeaseCommand["token"] }),
    );
    assertSuccess(retry, "Retry after rollback");
    assert(retry.value !== null, "Retry after rollback did not lease");
    assertEqual(retry.value.attempt, 2, "Retry after rollback incremented incorrectly");
  });
});

test("recovers expired leases at the exact expiry boundary", async () => {
  await withJobsDatabase((database) => {
    const jobId = "boundary-job" as JobId;
    enqueueJobs(
      database,
      makeEnqueueCommand({
        batchId: "boundary-batch" as JobBatchId,
        createdAt: EARLIER_CREATED_AT,
        jobIds: [jobId],
        jobs: [makeJob()],
      }),
    );
    forceLease(database, {
      jobId,
      attempt: 1,
      token: "boundary-token",
      expiresAt: NOW,
    });

    const result = leaseNextJob(
      database,
      makeLeaseCommand({ token: "boundary-replacement-token" as StoredLeaseCommand["token"] }),
    );
    assertSuccess(result, "Boundary recovery");
    assert(result.value !== null, "Boundary lease was not recovered");
    assertEqual(result.value.jobId, jobId, "Boundary selected wrong job");
    assertEqual(result.value.attempt, 2, "Boundary attempt changed incorrectly");
  });
});
