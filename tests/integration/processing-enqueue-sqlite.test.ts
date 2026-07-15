import type {
  BookmarkCatalog,
  BookmarkFolderRecord,
  BookmarkSnapshotInput,
  CatalogServiceDependencies,
} from "../../modules/catalog/public.js";
import type {
  JobEnqueuer,
  JobEnqueuerDependencies,
  JobProgress,
} from "../../modules/jobs/public.js";
import type {
  ProcessingRunId,
  ProcessingStart,
  ProcessingStarter,
  ProcessingStarterDependencies,
  ProcessingStartRequest,
} from "../../modules/processing/public.js";
import type {
  BookmarkCleanDatabaseFailure,
  BookmarkCleanDatabaseSession,
} from "../../adapters/sqlite/public.js";
import type { NodeRuntimePorts } from "../../adapters/node/public.js";
import type {
  IsoDateTime,
  Outcome,
} from "../../core/contracts/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: { readonly databasePath: string }) => T | PromiseLike<T>,
  ): Promise<T>;
}

interface CatalogRuntime {
  createBookmarkCatalog(dependencies: CatalogServiceDependencies): BookmarkCatalog;
  createCryptoCatalogIdFactory(): CatalogServiceDependencies["idFactory"];
}

interface JobsRuntime {
  createJobEnqueuer(dependencies: JobEnqueuerDependencies): JobEnqueuer;
}

interface ProcessingRuntime {
  createProcessingStarter(dependencies: ProcessingStarterDependencies): ProcessingStarter;
}

interface NodeRuntime {
  createNodeRuntimePorts(): NodeRuntimePorts;
}

interface SqliteRuntime {
  openBookmarkCleanDatabase(
    databasePath: string,
  ): Outcome<BookmarkCleanDatabaseSession, BookmarkCleanDatabaseFailure>;
}

interface Composition {
  readonly session: BookmarkCleanDatabaseSession;
  readonly catalog: BookmarkCatalog;
  readonly starter: ProcessingStarter;
  readonly runtime: NodeRuntimePorts;
}

declare const require: (specifier: string) => unknown;

const load = require as unknown as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const { withTemporaryDatabase } = load(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const {
  createBookmarkCatalog,
  createCryptoCatalogIdFactory,
} = load("../../modules/catalog/public.ts") as CatalogRuntime;
const { createJobEnqueuer } = load(
  "../../modules/jobs/public.ts",
) as JobsRuntime;
const { createProcessingStarter } = load(
  "../../modules/processing/public.ts",
) as ProcessingRuntime;
const { createNodeRuntimePorts } = load(
  "../../adapters/node/public.ts",
) as NodeRuntime;
const { openBookmarkCleanDatabase } = load(
  "../../adapters/sqlite/public.ts",
) as SqliteRuntime;

const CAPTURED_AT = "2026-07-15T12:00:00.000Z" as IsoDateTime;
const RUN_ID = "run:sqlite-replay" as ProcessingRunId;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message);
  }
}

function input(): BookmarkSnapshotInput {
  return {
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [{
      kind: "folder",
      sourceId: "root",
      title: "Root",
      children: [
        {
          kind: "bookmark",
          sourceId: "first",
          title: "First",
          url: "https://example.com/first",
        },
        {
          kind: "folder",
          sourceId: "nested",
          title: "Nested",
          children: [{
            kind: "bookmark",
            sourceId: "second",
            title: "Second",
            url: "https://example.com/second",
          }],
        },
      ],
    }],
  };
}

function openComposition(databasePath: string): Composition {
  const opened = openBookmarkCleanDatabase(databasePath);
  assert(opened.ok, "Application database did not open");
  const runtime = createNodeRuntimePorts();
  const catalog = createBookmarkCatalog({
    idFactory: createCryptoCatalogIdFactory(),
    store: opened.value.catalogStore,
  });
  const jobs = createJobEnqueuer({
    clock: runtime.clock,
    idFactory: runtime.jobIdFactory,
    store: opened.value.jobQueueStore,
  });
  return {
    session: opened.value,
    catalog,
    starter: createProcessingStarter({ catalog, jobs }),
    runtime,
  };
}

function expectedProgress(started: ProcessingStart): JobProgress {
  return {
    batchId: started.batch.batchId,
    batchState: "active",
    totalCount: 2,
    pendingCount: 2,
    leasedCount: 0,
    retryWaitCount: 0,
    succeededCount: 0,
    failedCount: 0,
    cancelledCount: 0,
  };
}

test("selected-folder batch persists and replays after reopen", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    let original: ProcessingStart | undefined;
    let request: ProcessingStartRequest | undefined;
    const first = openComposition(databasePath);
    try {
      const imported = await first.catalog.importSnapshot(input());
      assert(imported.ok, "Representative Catalog import failed");
      const loaded = await first.catalog.getSnapshot(imported.value.snapshotId);
      assert(loaded.ok && loaded.value !== null, "Imported snapshot did not load");
      const root = loaded.value.roots[0];
      assert(root?.kind === "folder", "Imported root was not a folder");
      request = {
        snapshotId: imported.value.snapshotId,
        folderId: (root as BookmarkFolderRecord).id,
        profileId: "health_check_v1",
        runId: RUN_ID,
      };

      const started = await first.starter.start(request);
      assert(started.ok, "Initial Processing start failed");
      original = started.value;
      assert(started.value.batch.totalCount === 2, "Initial batch total changed");
      assert(started.value.preview.jobCount === 2, "Preview total changed");
      const progress = await first.session.jobQueueStore.readProgress(
        started.value.batch.batchId,
        first.runtime.clock.now(),
      );
      assert(progress.ok, "Initial progress read failed");
      assertJsonEqual(progress.value, expectedProgress(started.value), "Initial progress changed");
    } finally {
      first.session.close();
    }

    assert(original !== undefined && request !== undefined, "Initial evidence was incomplete");
    const reopened = openComposition(databasePath);
    try {
      const replayed = await reopened.starter.start(request);
      assert(replayed.ok, "Replayed Processing start failed");
      assertJsonEqual(replayed.value, original, "Replay did not return the original start");
      const progress = await reopened.session.jobQueueStore.readProgress(
        replayed.value.batch.batchId,
        reopened.runtime.clock.now(),
      );
      assert(progress.ok, "Reopened progress read failed");
      assertJsonEqual(progress.value, expectedProgress(original), "Replay changed progress");
    } finally {
      reopened.session.close();
    }
  });
});
