import type {
  BookmarkSnapshot,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type {
  IsoDateTime,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";
import type {
  CatalogDatabaseFailure,
  CatalogDatabaseSession,
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

interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
}

interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: TemporaryDatabase) => T | PromiseLike<T>,
  ): Promise<T>;
}

interface CatalogDatabaseApi {
  openCatalogDatabase(
    databasePath: string,
  ): Outcome<CatalogDatabaseSession, CatalogDatabaseFailure>;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const { DatabaseSync } = loadModule("node:sqlite") as SqliteApi;
const { withTemporaryDatabase } = loadModule(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const sqlitePublic = loadModule(
  "../../adapters/sqlite/public.ts",
) as CatalogDatabaseApi & Record<string, unknown>;
const { openCatalogDatabase } = sqlitePublic;

const CAPTURED_AT = "2026-07-14T12:00:00.000Z" as IsoDateTime;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message);
  }
}

function emptySnapshot(id: string): BookmarkSnapshot {
  return {
    id: id as SnapshotId,
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [],
    rootCount: 0,
    folderCount: 0,
    bookmarkCount: 0,
  };
}

function assertUnavailable(
  result: Outcome<unknown, CatalogDatabaseFailure | CatalogStorageFailure>,
  message: string,
): void {
  assertDeepEqual(
    result,
    { ok: false, error: { code: "storage_unavailable" } },
    message,
  );
}

test("public session migrates stores closes and reopens without exposing SQLite", async () => {
  assertDeepEqual(
    Object.keys(sqlitePublic),
    ["openCatalogDatabase"],
    "SQLite public runtime exports changed",
  );

  await withTemporaryDatabase(async ({ databasePath }) => {
    const opened = openCatalogDatabase(databasePath);
    assert(opened.ok, "Catalog database should open");
    const snapshot = emptySnapshot("snapshot:session");
    assert((await opened.value.store.save(snapshot)).ok, "Snapshot should save");
    opened.value.close();
    opened.value.close();
    assertUnavailable(
      await opened.value.store.load(snapshot.id),
      "Closed session store should be unavailable",
    );

    const reopened = openCatalogDatabase(databasePath);
    assert(reopened.ok, "Catalog database should reopen");
    const loaded = await reopened.value.store.load(snapshot.id);
    assert(loaded.ok, "Snapshot should load after reopen");
    assertDeepEqual(loaded.value, snapshot, "Reopened snapshot changed");
    reopened.value.close();
  });
});

test("unavailable paths and failed migrations return the fixed failure", async () => {
  await withTemporaryDatabase(async ({ directory, databasePath }) => {
    assertUnavailable(
      openCatalogDatabase(directory),
      "A directory should not open as a database file",
    );

    const incompatible = new DatabaseSync(databasePath);
    incompatible.exec(
      "CREATE TABLE schema_migrations (migration_key TEXT PRIMARY KEY)",
    );
    incompatible.close();
    assertUnavailable(
      openCatalogDatabase(databasePath),
      "An incompatible migration table should fail",
    );

    const repair = new DatabaseSync(databasePath);
    repair.exec("DROP TABLE schema_migrations");
    repair.close();
    const recovered = openCatalogDatabase(databasePath);
    assert(recovered.ok, "Migration failure should leave the file reusable");
    recovered.value.close();
  });
});
