import type { JobId, JobResultId } from "../../core/contracts/public.js";
import type {
  JobWorkerResumeFixtureApi,
  ResumeClockState,
} from "../helpers/job-worker-resume-fixture.ts";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const fixture = loadModule("../helpers/job-worker-resume-fixture.ts") as JobWorkerResumeFixtureApi;
const {
  DatabaseSync, withTemporaryDatabase, migrateJobsSchema,
  migrateFakeDurableResultSchema, NOW, LEASE_EXPIRES_AT,
  RESUMED_LEASE_EXPIRES_AT, BATCH_ID, FIRST_RESULT, SECOND_RESULT,
  FIRST_TARGET, SECOND_TARGET, REQUEST, FIRST_WORKER, RESUMED_WORKER,
  createFakeResultIdFactory, createDeterministicIdFactory, createRuntime,
  makeStableInputKey, readJobRows, expectedJobRow, expectedResultRows,
  FIRST_PROGRESS, FINAL_PROGRESS, assertSame, assertDeepEqual, requireSuccess,
} = fixture;
const assert: JobWorkerResumeFixtureApi["assert"] = fixture.assert;

test("interrupts after a durable result commit and resumes after database reopen", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const clockState: ResumeClockState = { value: NOW };
    const idFactory = createDeterministicIdFactory();
    const resultIdFactory = createFakeResultIdFactory();
    const database = new DatabaseSync(databasePath);

    try {
      requireSuccess(migrateJobsSchema(database), "Initial Jobs migration failed");
      migrateFakeDurableResultSchema(database);
      const first = createRuntime(
        database,
        clockState,
        idFactory,
        resultIdFactory,
        "interrupt_after_commit_once",
      );

      assertDeepEqual(
        await first.queue.enqueue(REQUEST),
        {
          ok: true,
          value: {
            batchId: BATCH_ID,
            state: "active",
            totalCount: 2,
            createdAt: NOW,
          },
        },
        "Selected-scope enqueue changed",
      );

      assertDeepEqual(
        await first.worker.runOne(FIRST_WORKER),
        { ok: false, error: { code: "handler_interrupted" } },
        "First interruption shape changed or synthesized queue evidence",
      );
      assertSame(first.handler.calls.length, 1, "First handler execution count changed");
      const originalLease = first.handler.calls[0];
      assert(originalLease !== undefined, "First handler did not receive a lease");
      assertDeepEqual(
        originalLease,
        {
          token: "lease-1",
          jobId: "job-1",
          batchId: BATCH_ID,
          type: "health_check",
          target: FIRST_TARGET,
          attempt: 1,
          leasedAt: NOW,
          expiresAt: LEASE_EXPIRES_AT,
        },
        "Initial lease changed",
      );
      assertDeepEqual(
        first.repository.count(),
        1,
        "The interrupted handler did not commit exactly one result",
      );
      assertDeepEqual(
        first.repository.rows(),
        [
          {
            stableInputKey: makeStableInputKey({
              type: "health_check",
              target: FIRST_TARGET,
            }),
            resultId: "fake-result-1",
          },
        ],
        "Initial durable result rows changed",
      );
      assertDeepEqual(
        await first.queue.getProgress(BATCH_ID),
        { ok: true, value: FIRST_PROGRESS },
        "Progress after interruption changed",
      );
      assertDeepEqual(
        readJobRows(database),
        [
          expectedJobRow(
            "job-1" as JobId,
            0,
            "leased",
            1,
            "lease-1",
            FIRST_WORKER.id,
            NOW,
            LEASE_EXPIRES_AT,
            null,
            null,
          ),
          expectedJobRow(
            "job-2" as JobId,
            1,
            "pending",
            0,
            null,
            null,
            null,
            null,
            null,
            null,
          ),
        ],
        "Interrupted queue rows changed",
      );

      database.close();
      clockState.value = LEASE_EXPIRES_AT;

      const reopened = new DatabaseSync(databasePath);
      try {
        requireSuccess(migrateJobsSchema(reopened), "Reopen Jobs migration failed");
        migrateFakeDurableResultSchema(reopened);
        const resumed = createRuntime(
          reopened,
          clockState,
          idFactory,
          resultIdFactory,
          "normal",
        );

        const resumedFirst = await resumed.worker.runOne(RESUMED_WORKER);
        assertDeepEqual(
          resumedFirst,
          {
            ok: true,
            value: {
              status: "succeeded",
              lease: {
                token: "lease-2",
                jobId: "job-1",
                batchId: BATCH_ID,
                type: "health_check",
                target: FIRST_TARGET,
                attempt: 2,
                leasedAt: LEASE_EXPIRES_AT,
                expiresAt: RESUMED_LEASE_EXPIRES_AT,
              },
              result: FIRST_RESULT,
            },
          },
          "Resumed first worker step changed",
        );
        assertSame(resumed.handler.calls.length, 1, "Resumed first handler count changed");
        assertSame(
          resumed.handler.calls[0]?.attempt,
          2,
          "Resumed first handler attempt changed",
        );
        assertDeepEqual(
          resumed.repository.count(),
          1,
          "Resumed first execution duplicated the durable result",
        );
        assertDeepEqual(
          resultIdFactory.generatedIds,
          ["fake-result-1"],
          "Idempotent result load generated a new result ID",
        );
        assertDeepEqual(
          resumed.repository.rows(),
          [
            {
              stableInputKey: makeStableInputKey({
                type: "health_check",
                target: FIRST_TARGET,
              }),
              resultId: "fake-result-1",
            },
          ],
          "Resumed first durable rows changed",
        );
        assertDeepEqual(
          readJobRows(reopened),
          [
            expectedJobRow(
              "job-1" as JobId,
              0,
              "succeeded",
              2,
              null,
              null,
              null,
              null,
              "fake-result-1" as JobResultId,
              LEASE_EXPIRES_AT,
            ),
            expectedJobRow(
              "job-2" as JobId,
              1,
              "pending",
              0,
              null,
              null,
              null,
              null,
              null,
              null,
            ),
          ],
          "Resumed first queue rows changed",
        );

        const resumedSecond = await resumed.worker.runOne(RESUMED_WORKER);
        assertDeepEqual(
          resumedSecond,
          {
            ok: true,
            value: {
              status: "succeeded",
              lease: {
                token: "lease-3",
                jobId: "job-2",
                batchId: BATCH_ID,
                type: "health_check",
                target: SECOND_TARGET,
                attempt: 1,
                leasedAt: LEASE_EXPIRES_AT,
                expiresAt: RESUMED_LEASE_EXPIRES_AT,
              },
              result: SECOND_RESULT,
            },
          },
          "Resumed second worker step changed",
        );
        assertSame(resumed.handler.calls.length, 2, "Second handler execution count changed");
        assertDeepEqual(
          resultIdFactory.generatedIds,
          ["fake-result-1", "fake-result-2"],
          "Durable result ID generation count changed",
        );

        assertDeepEqual(
          await resumed.worker.runOne(RESUMED_WORKER),
          { ok: true, value: { status: "idle" } },
          "Idle worker step changed",
        );
        assertSame(resumed.handler.calls.length, 2, "Idle run invoked the handler");
        assertDeepEqual(
          resumed.repository.rows(),
          expectedResultRows(),
          "Completed durable result rows changed",
        );
        assertDeepEqual(
          resumed.repository.count(),
          2,
          "Completed durable result count changed",
        );
        assertDeepEqual(
          readJobRows(reopened),
          [
            expectedJobRow(
              "job-1" as JobId,
              0,
              "succeeded",
              2,
              null,
              null,
              null,
              null,
              "fake-result-1" as JobResultId,
              LEASE_EXPIRES_AT,
            ),
            expectedJobRow(
              "job-2" as JobId,
              1,
              "succeeded",
              1,
              null,
              null,
              null,
              null,
              "fake-result-2" as JobResultId,
              LEASE_EXPIRES_AT,
            ),
          ],
          "Final queue rows changed before stale completion",
        );
        assertDeepEqual(
          await resumed.queue.getProgress(BATCH_ID),
          { ok: true, value: FINAL_PROGRESS },
          "Final progress changed before stale completion",
        );

        const rowsBeforeStale = readJobRows(reopened);
        const resultsBeforeStale = resumed.repository.rows();
        const progressBeforeStale = await resumed.queue.getProgress(BATCH_ID);
        assertDeepEqual(
          await resumed.queue.succeed(originalLease, FIRST_RESULT),
          { ok: false, error: { code: "stale_lease" } },
          "Original stale completion was accepted",
        );
        assertDeepEqual(
          readJobRows(reopened),
          rowsBeforeStale,
          "Stale completion changed queue rows",
        );
        assertDeepEqual(
          resumed.repository.rows(),
          resultsBeforeStale,
          "Stale completion changed durable results",
        );
        assertDeepEqual(
          await resumed.queue.getProgress(BATCH_ID),
          progressBeforeStale,
          "Stale completion changed final progress",
        );

        reopened.close();
      } finally {
        if (reopened.isOpen) {
          reopened.close();
        }
      }

      const finalDatabase = new DatabaseSync(databasePath);
      try {
        requireSuccess(
          migrateJobsSchema(finalDatabase),
          "Second reopen Jobs migration failed",
        );
        migrateFakeDurableResultSchema(finalDatabase);
        const finalRuntime = createRuntime(
          finalDatabase,
          clockState,
          idFactory,
          resultIdFactory,
          "normal",
        );
        assertDeepEqual(
          await finalRuntime.queue.getProgress(BATCH_ID),
          { ok: true, value: FINAL_PROGRESS },
          "Persisted final progress changed",
        );
        assertDeepEqual(
          finalRuntime.repository.rows(),
          expectedResultRows(),
          "Persisted final durable rows changed",
        );
        assertDeepEqual(
          finalRuntime.repository.count(),
          2,
          "Persisted final durable result count changed",
        );
        assertDeepEqual(
          resultIdFactory.generatedIds,
          ["fake-result-1", "fake-result-2"],
          "Second reopen generated another result ID",
        );
      } finally {
        if (finalDatabase.isOpen) {
          finalDatabase.close();
        }
      }
    } finally {
      if (database.isOpen) {
        database.close();
      }
    }
  });
});
