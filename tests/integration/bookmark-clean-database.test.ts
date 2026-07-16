import type {
  BookmarkId,
  IsoDateTime,
  JobBatchId,
  JobId,
  JobResultId,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";
import type { BookmarkSnapshot } from "../../modules/catalog/public.js";
import type { HealthObservation } from "../../modules/health/public.js";
import type {
  StoredEnqueueCommand,
} from "../../modules/jobs/public.js";
import type {
  BookmarkCleanDatabaseFailure,
  BookmarkCleanDatabaseSession,
} from "../../adapters/sqlite/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
}

interface SqliteApi {
  DatabaseSync: new (location: string) => SqliteDatabase;
}

interface FileSystemApi {
  chmodSync(path: string, mode: number): void;
  statSync(path: string): { readonly mode: number };
}

interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
}

interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: TemporaryDatabase) => T | PromiseLike<T>,
  ): Promise<T>;
}

interface DatabaseRuntime {
  openBookmarkCleanDatabase(
    databasePath: string,
  ): Outcome<BookmarkCleanDatabaseSession, BookmarkCleanDatabaseFailure>;
}

declare const require: (specifier: string) => unknown;
declare const process: { readonly platform: string };

const load = require as unknown as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const { DatabaseSync } = load("node:sqlite") as SqliteApi;
const fileSystem = load("node:fs") as FileSystemApi;
const { withTemporaryDatabase } = load(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const sqlitePublic = load(
  "../../adapters/sqlite/public.ts",
) as DatabaseRuntime & Record<string, unknown>;
const { openBookmarkCleanDatabase } = sqlitePublic;

const NOW = "2026-07-15T12:00:00.000Z" as IsoDateTime;
const SNAPSHOT_ID = "snapshot:application-session" as SnapshotId;
const BOOKMARK_ID = "bookmark:application-session" as BookmarkId;
const BATCH_ID = "batch:application-session" as JobBatchId;
const OBSERVATION_ID = "observation:application-session" as JobResultId;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function snapshot(): BookmarkSnapshot {
  return {
    id: SNAPSHOT_ID,
    source: "chrome_html",
    capturedAt: NOW,
    roots: [],
    rootCount: 0,
    folderCount: 0,
    bookmarkCount: 0,
  };
}

function enqueueCommand(): StoredEnqueueCommand {
  return {
    request: {
      idempotencyKey: "application-session",
      jobs: [{
        type: "health_check",
        target: {
          kind: "bookmark",
          bookmarkId: BOOKMARK_ID,
          inputVersion: "health_check_v1:application-session",
        },
        priority: 0,
        sequence: 0,
        maxAttempts: 1,
      }],
    },
    requestFingerprint: "application-session-fingerprint",
    batchId: BATCH_ID,
    jobIds: ["job:application-session" as JobId],
    createdAt: NOW,
  };
}

function observation(): HealthObservation {
  return {
    id: OBSERVATION_ID,
    bookmarkId: BOOKMARK_ID,
    inputVersion: "health_check_v1:application-session",
    status: "healthy",
    checkedAt: NOW,
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    method: "GET",
    httpStatus: 200,
    redirects: [],
    durationMs: 12,
    retryCount: 0,
    headers: [],
  };
}

function assertUnavailable(
  result: Outcome<unknown, { readonly code: string }>,
  message: string,
): void {
  assertDeepEqual(
    result,
    { ok: false, error: { code: "storage_unavailable" } },
    message,
  );
}

function assertOwnerOnly(databasePath: string, message: string): void {
  if (process.platform === "win32") return;
  const mode = fileSystem.statSync(databasePath).mode & 0o777;
  assert(mode === 0o600, `${message}: mode ${mode.toString(8)}`);
}

test("application session migrates real ports closes and reopens", async () => {
  assertDeepEqual(
    Object.keys(sqlitePublic),
    ["openCatalogDatabase", "openBookmarkCleanDatabase"],
    "SQLite public runtime exports changed",
  );

  await withTemporaryDatabase(async ({ databasePath }) => {
    const opened = openBookmarkCleanDatabase(databasePath);
    assert(opened.ok, "Application database should open");
    assertOwnerOnly(databasePath, "New application database was not owner-only");

    const savedSnapshot = snapshot();
    const savedObservation = observation();
    assert(
      (await opened.value.catalogStore.save(savedSnapshot)).ok,
      "Catalog port should save",
    );
    assert(
      (await opened.value.jobQueueStore.enqueueBatch(enqueueCommand())).ok,
      "Jobs port should enqueue",
    );
    assert(
      (await opened.value.healthRepository.saveIfAbsent(savedObservation)).ok,
      "Health port should save",
    );

    opened.value.close();
    opened.value.close();
    assertUnavailable(
      await opened.value.catalogStore.load(SNAPSHOT_ID),
      "Closed Catalog port should be unavailable",
    );
    assertUnavailable(
      await opened.value.jobQueueStore.readProgress(BATCH_ID, NOW),
      "Closed Jobs port should be unavailable",
    );
    assertUnavailable(
      await opened.value.healthRepository.loadByInput(
        BOOKMARK_ID,
        savedObservation.inputVersion,
      ),
      "Closed Health port should be unavailable",
    );

    if (process.platform !== "win32") {
      fileSystem.chmodSync(databasePath, 0o644);
    }

    const reopened = openBookmarkCleanDatabase(databasePath);
    assert(reopened.ok, "Application database should reopen");
    assertOwnerOnly(databasePath, "Existing application database was not tightened");
    const loadedSnapshot = await reopened.value.catalogStore.load(SNAPSHOT_ID);
    const loadedProgress = await reopened.value.jobQueueStore.readProgress(
      BATCH_ID,
      NOW,
    );
    const loadedObservation = await reopened.value.healthRepository.loadByInput(
      BOOKMARK_ID,
      savedObservation.inputVersion,
    );
    assert(loadedSnapshot.ok, "Catalog port should read after reopen");
    assert(loadedProgress.ok, "Jobs port should read after reopen");
    assert(loadedObservation.ok, "Health port should read after reopen");
    assertDeepEqual(loadedSnapshot.value, savedSnapshot, "Snapshot changed");
    assert(loadedProgress.value.totalCount === 1, "Job count changed");
    assertDeepEqual(
      loadedObservation.value,
      savedObservation,
      "Observation changed",
    );
    reopened.value.close();
  });
});

test("application session returns one fixed failure and leaves files reusable", async () => {
  await withTemporaryDatabase(async ({ directory, databasePath }) => {
    assertUnavailable(
      openBookmarkCleanDatabase(directory),
      "A directory should not open as a database file",
    );

    const incompatible = new DatabaseSync(databasePath);
    incompatible.exec(
      "CREATE TABLE schema_migrations (migration_key TEXT PRIMARY KEY)",
    );
    incompatible.close();
    assertUnavailable(
      openBookmarkCleanDatabase(databasePath),
      "An incompatible migration table should fail",
    );

    const repair = new DatabaseSync(databasePath);
    repair.exec("DROP TABLE schema_migrations");
    repair.close();
    const recovered = openBookmarkCleanDatabase(databasePath);
    assert(recovered.ok, "Failed migration should leave the file reusable");
    recovered.value.close();
  });
});
