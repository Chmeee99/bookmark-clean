import type { WorkerId } from "../../core/contracts/public.js";
import type { HealthWorkerSessionConfig } from "../../apps/local-cli/health-worker-session.js";
import type {
  HealthWorkerSession,
  HealthWorkerSessionFailure,
} from "../../apps/local-cli/health-worker-session.js";
import type { Outcome } from "../../core/contracts/public.js";

interface NodeTestApi { test(name: string, callback: () => Promise<void>): void; }
interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
}
interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: TemporaryDatabase) => T | PromiseLike<T>,
  ): Promise<T>;
}
interface SessionRuntime {
  openHealthWorkerSession(
    databasePath: string,
    config: HealthWorkerSessionConfig,
  ): Outcome<HealthWorkerSession, HealthWorkerSessionFailure>;
}

declare const require: (specifier: string) => unknown;
const { test } = require("node:test") as NodeTestApi;
const { withTemporaryDatabase } = require(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const sessionRuntime = require(
  "../../apps/local-cli/health-worker-session.ts",
) as SessionRuntime & Record<string, unknown>;
const { openHealthWorkerSession } = sessionRuntime;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function config(onRetry: () => void): HealthWorkerSessionConfig {
  return {
    health: { timeoutMs: 1_000, maxRedirects: 5, maxBodyBytes: 64 * 1_024 },
    queue: { leaseDurationMs: 30_000 },
    retrySchedule: {
      nextRetryAt(_attempt, failedAt) {
        onRetry();
        return failedAt;
      },
    },
  };
}

test("composes one Health worker that is idle on a real empty queue", async () => {
  equal(Object.keys(sessionRuntime), ["openHealthWorkerSession"],
    "Local Health session runtime exports changed");
  await withTemporaryDatabase(async ({ databasePath }) => {
    let retryCalls = 0;
    const opened = openHealthWorkerSession(databasePath, config(() => { retryCalls += 1; }));
    assert(opened.ok, "Local Health worker session should open");
    const result = await opened.value.worker.runOne({
      id: "worker:local-health-test" as WorkerId,
    });
    equal(result, { ok: true, value: { status: "idle" } },
      "Empty real queue did not return idle");
    assert(retryCalls === 0, "Idle worker invoked the retry schedule");
    opened.value.close();
    opened.value.close();

    const reopened = openHealthWorkerSession(databasePath, config(() => {}));
    assert(reopened.ok, "Closed Local Health database did not reopen");
    reopened.value.close();
  });
});

test("returns the exact database failure for an unavailable path", async () => {
  await withTemporaryDatabase(async ({ directory }) => {
    equal(
      openHealthWorkerSession(directory, config(() => {})),
      { ok: false, error: { code: "storage_unavailable" } },
      "Unavailable database failure changed",
    );
  });
});
