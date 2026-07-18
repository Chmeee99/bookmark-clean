import type {
  BookmarkId,
  JobBatchId,
  JobId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  JobProgress,
  JobQueueFailure,
} from "../../modules/jobs/public.js";
import type {
  JobsSqliteFixtureApi,
  SqliteDatabase,
} from "../helpers/jobs-sqlite-fixture.ts";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface PerformanceApi {
  now(): number;
}

interface ProcessApi {
  readonly stdout: { write(chunk: string): boolean };
}

interface ProgressApi {
  readJobsProgress(
    database: SqliteDatabase,
    batchId: JobBatchId,
    now: JobsSqliteFixtureApi["NOW"],
  ): Outcome<JobProgress, JobQueueFailure>;
}

declare const require: (specifier: string) => unknown;

const load = require as unknown as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const { performance } = load("node:perf_hooks") as {
  performance: PerformanceApi;
};
const processApi = load("node:process") as ProcessApi;
const fixture = load(
  "../helpers/jobs-sqlite-fixture.ts",
) as JobsSqliteFixtureApi;
const { readJobsProgress } = load(
  "../../adapters/sqlite/jobs-progress.ts",
) as ProgressApi;

const JOB_COUNT = 10_000;
const RESPONSIVENESS_BUDGET_MS = 250;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

test("[performance] reads validated progress for 10,000 jobs within budget", async () => {
  await fixture.withJobsDatabase((database) => {
    const batchId = "progress-performance-10k" as JobBatchId;
    const jobs = Array.from({ length: JOB_COUNT }, (_, sequence) =>
      fixture.makeJob({
        sequence,
        target: {
          kind: "bookmark",
          bookmarkId: `progress-performance-bookmark-${sequence}` as BookmarkId,
          inputVersion: "health_check_v1:performance",
        },
      }),
    );
    const jobIds = jobs.map(
      (_, sequence) => `progress-performance-job-${sequence}` as JobId,
    );
    fixture.enqueueJobs(
      database,
      fixture.makeEnqueueCommand({ batchId, jobs, jobIds }),
    );

    const startedAt = performance.now();
    const result = readJobsProgress(database, batchId, fixture.NOW);
    const elapsedMs = performance.now() - startedAt;

    assert(result.ok, "10,000-job progress read failed");
    assert(
      JSON.stringify(result.value) === JSON.stringify({
        batchId,
        batchState: "active",
        totalCount: JOB_COUNT,
        pendingCount: JOB_COUNT,
        leasedCount: 0,
        retryWaitCount: 0,
        succeededCount: 0,
        failedCount: 0,
        cancelledCount: 0,
      }),
      "10,000-job progress projection changed",
    );
    assert(
      elapsedMs <= RESPONSIVENESS_BUDGET_MS,
      `10,000-job progress took ${elapsedMs.toFixed(2)} ms; ` +
        `budget is ${RESPONSIVENESS_BUDGET_MS} ms`,
    );
    processApi.stdout.write(
      `[jobs-progress-10k] jobs=${JOB_COUNT} ` +
        `elapsedMs=${elapsedMs.toFixed(2)} ` +
        `budgetMs=${RESPONSIVENESS_BUDGET_MS}\n`,
    );
  });
});
