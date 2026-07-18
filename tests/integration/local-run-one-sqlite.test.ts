// test-capability: loopback-listener
import type { RunImportCommand } from "../../apps/local-cli/import-command.js";
import type {
  InspectFolder,
  RunInspectCommand,
} from "../../apps/local-cli/inspect-command.js";
import type { RunEnqueueCommand } from "../../apps/local-cli/enqueue-command.js";
import type { RunOneCommand } from "../../apps/local-cli/run-one-command.js";
import type {
  BookmarkCleanDatabaseFailure,
  BookmarkCleanDatabaseSession,
} from "../../adapters/sqlite/public.js";
import type { NodeRuntimePorts } from "../../adapters/node/public.js";
import type { Outcome } from "../../core/contracts/public.js";
import type { JobProgress } from "../../modules/jobs/public.js";

interface NodeTestApi { test(name: string, callback: () => Promise<void>): void; }
interface FileSystemApi {
  writeFileSync(path: string, contents: string, encoding: "utf8"): void;
}
interface PathApi { join(...parts: string[]): string; }
interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
}
interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: TemporaryDatabase) => T | PromiseLike<T>,
  ): Promise<T>;
}
interface FixtureRequest { readonly url?: string; }
interface FixtureResponse { writeHead(statusCode: number): void; end(body?: string): void; }
interface ListenerFixture { readonly port: number; close(): Promise<void>; }
interface FixtureApi {
  startHttpFixture(
    handler: (request: FixtureRequest, response: FixtureResponse) => void,
  ): Promise<ListenerFixture>;
}
interface SqliteRuntime {
  openBookmarkCleanDatabase(databasePath: string): Outcome<
    BookmarkCleanDatabaseSession,
    BookmarkCleanDatabaseFailure
  >;
}
interface NodeRuntime { createNodeRuntimePorts(): NodeRuntimePorts; }

declare const require: (specifier: string) => unknown;
const load = require as unknown as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const { writeFileSync } = load("node:fs") as FileSystemApi;
const { join } = load("node:path") as PathApi;
const { withTemporaryDatabase } = load(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const { startHttpFixture } = load(
  "../helpers/health-transport-fixture.ts",
) as FixtureApi;
const { runImportCommand } = load(
  "../../apps/local-cli/import-command.ts",
) as { runImportCommand: RunImportCommand };
const { runInspectCommand } = load(
  "../../apps/local-cli/inspect-command.ts",
) as { runInspectCommand: RunInspectCommand };
const { runEnqueueCommand } = load(
  "../../apps/local-cli/enqueue-command.ts",
) as { runEnqueueCommand: RunEnqueueCommand };
const { runOneCommand } = load(
  "../../apps/local-cli/run-one-command.ts",
) as { runOneCommand: RunOneCommand };
const { openBookmarkCleanDatabase } = load(
  "../../adapters/sqlite/public.ts",
) as SqliteRuntime;
const { createNodeRuntimePorts } = load(
  "../../adapters/node/public.ts",
) as NodeRuntime;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function bookmarksHtml(port: number): string {
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<DL><p>
  <DT><H3 ADD_DATE="1700000000">Worker proof</H3>
  <DL><p>
    <DT><A HREF="http://127.0.0.1:${port}/must-not-run" ADD_DATE="1700000001">Blocked target</A>
  </DL><p>
</DL><p>`;
}

function enqueueArguments(
  databasePath: string,
  snapshotId: string,
  folder: InspectFolder,
): readonly string[] {
  return [
    "--database", databasePath,
    "--snapshot", snapshotId,
    "--folder", folder.id,
    "--run", "run:one-job-sqlite-proof",
  ];
}

function expectedProgress(batchId: string): JobProgress {
  return {
    batchId: batchId as JobProgress["batchId"],
    batchState: "active",
    totalCount: 1,
    pendingCount: 0,
    leasedCount: 0,
    retryWaitCount: 0,
    succeededCount: 1,
    failedCount: 0,
    cancelledCount: 0,
  };
}

test("one real queued bookmark completes and the next worker step is idle", async () => {
  let requests = 0;
  const listener = await startHttpFixture((_request, response) => {
    requests += 1;
    response.writeHead(200);
    response.end("request safety failed");
  });
  try {
    await withTemporaryDatabase(async ({ directory, databasePath }) => {
      const inputPath = join(directory, "one-bookmark.html");
      writeFileSync(inputPath, bookmarksHtml(listener.port), "utf8");

      const imported = await runImportCommand([
        "--input", inputPath,
        "--database", databasePath,
      ]);
      assert(imported.exitCode === 0 && imported.output.ok,
        "Production import command failed");
      equal(
        {
          rootCount: imported.output.rootCount,
          folderCount: imported.output.folderCount,
          bookmarkCount: imported.output.bookmarkCount,
        },
        { rootCount: 1, folderCount: 1, bookmarkCount: 1 },
        "Minimal Chrome fixture counts changed",
      );

      const inspected = await runInspectCommand([
        "--database", databasePath,
        "--snapshot", imported.output.snapshotId,
      ]);
      assert(inspected.exitCode === 0 && inspected.output.ok,
        "Production inspect command failed");
      const folder = inspected.output.folders[0];
      assert(folder !== undefined && folder.bookmarkCount === 1,
        "Imported folder was not selectable");

      const enqueued = await runEnqueueCommand(enqueueArguments(
        databasePath,
        imported.output.snapshotId,
        folder,
      ));
      assert(enqueued.exitCode === 0 && enqueued.output.ok,
        "Production enqueue command failed");
      assert(enqueued.output.batch.totalCount === 1,
        "One bookmark did not produce one queued job");

      const first = await runOneCommand(["--database", databasePath]);
      assert(first.exitCode === 0 && first.output.ok,
        "First worker step did not complete");
      assert(first.output.status === "succeeded",
        "Queued Health job did not succeed");
      assert(first.output.batchId === enqueued.output.batch.batchId,
        "Worker reported a different batch");
      assert(first.output.result.kind === "health_observation",
        "Worker did not return the committed Health reference");
      const serialized = JSON.stringify(first.output);
      assert(!serialized.includes("127.0.0.1"), "Worker output leaked the URL");
      assert(!serialized.includes("lease"), "Worker output leaked lease data");
      assert(requests === 0, "Default request safety reached the listener");

      const reopened = openBookmarkCleanDatabase(databasePath);
      assert(reopened.ok, "Completed command left SQLite unavailable");
      try {
        const progress = await reopened.value.jobQueueStore.readProgress(
          enqueued.output.batch.batchId,
          createNodeRuntimePorts().clock.now(),
        );
        assert(progress.ok, "Public progress read failed after reopen");
        equal(
          progress.value,
          expectedProgress(enqueued.output.batch.batchId),
          "Reopened progress did not prove one succeeded job",
        );
      } finally {
        reopened.value.close();
      }

      equal(
        await runOneCommand(["--database", databasePath]),
        { exitCode: 0, output: { ok: true, status: "idle" } },
        "Second worker step was not idle",
      );
      assert(requests === 0, "Replay unexpectedly reached the listener");
    });
  } finally {
    await listener.close();
  }
});
