import type {
  BookmarkRecord,
  BookmarkSnapshot,
  CatalogSnapshotStore,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type { BookmarkId, IsoDateTime, Outcome, SnapshotId } from "../../core/contracts/public.js";

interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }

interface SqliteRow { readonly [key: string]: unknown; }

interface SqliteStatement {
  all(...parameters: unknown[]): SqliteRow[]; get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
  readonly isOpen: boolean; exec(sql: string): void; close(): void;
  prepare(sql: string): SqliteStatement;
}

interface SqliteApi { DatabaseSync: new (location: string) => SqliteDatabase; }

type DatabaseWork<T> = (database: { readonly databasePath: string }) => T | PromiseLike<T>;

interface TemporaryDatabaseApi { withTemporaryDatabase<T>(work: DatabaseWork<T>): Promise<T>; }

interface CatalogSchemaApi {
  migrateCatalogSchema(database: SqliteDatabase): Outcome<void, CatalogStorageFailure>;
}

interface CatalogStoreApi {
  createSqliteCatalogSnapshotStore(database: SqliteDatabase): CatalogSnapshotStore;
}

declare const require: (
  specifier:
    | "node:test"
    | "node:sqlite"
    | "../helpers/temporary-database.ts"
    | "../../adapters/sqlite/catalog-schema.ts"
    | "../../adapters/sqlite/catalog-snapshot-store.ts",
) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const { DatabaseSync } = loadModule("node:sqlite") as SqliteApi;
const { withTemporaryDatabase } = loadModule(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const { migrateCatalogSchema } = loadModule(
  "../../adapters/sqlite/catalog-schema.ts",
) as CatalogSchemaApi;
const { createSqliteCatalogSnapshotStore } = loadModule(
  "../../adapters/sqlite/catalog-snapshot-store.ts",
) as CatalogStoreApi;

const CAPTURED_AT = "2026-07-13T12:00:00.000Z" as IsoDateTime;
type Bookmark = Extract<BookmarkRecord, { readonly kind: "bookmark" }>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(
    actual === expected,
    `${message}. Expected ${String(expected)}, received ${String(actual)}`,
  );
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(canonicalize);
    }
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
      );
    }
    return value;
  };

  if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function assertStorageFailure(
  result: Outcome<unknown, CatalogStorageFailure>,
  code: CatalogStorageFailure["code"],
  message: string,
): void {
  assert(!result.ok, `${message} should fail`);
  assertDeepEqual(result, { ok: false, error: { code } }, message);
}

async function withDatabase<T>(
  work: (database: SqliteDatabase) => T | PromiseLike<T>,
): Promise<T> {
  return withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      return await work(database);
    } finally {
      if (database.isOpen) database.close();
    }
  });
}

function migrate(database: SqliteDatabase): void {
  const result = migrateCatalogSchema(database);
  assert(result.ok, "Catalog schema migration should succeed");
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

function bookmark(id: string, sourceId: string, title: string, url: string): Bookmark {
  return { id: id as never, kind: "bookmark", sourceId, title, url };
}

function oneBookmarkSnapshot(snapshotId: string, bookmarkId: string, title: string): BookmarkSnapshot {
  return {
    ...emptySnapshot(snapshotId),
    roots: [bookmark(bookmarkId, "shared-source-id", title, `https://example.com/${title}`)],
    rootCount: 1,
    bookmarkCount: 1,
  };
}

function nestedSnapshot(id = "snapshot:nested"): BookmarkSnapshot {
  return {
    id: id as SnapshotId,
    source: "chrome_api",
    capturedAt: CAPTURED_AT,
    roots: [
      {
        id: "bookmark:root-folder" as never,
        kind: "folder",
        sourceId: "root-folder",
        title: "Root folder",
        dateAdded: "2026-07-13T12:00:01.000Z" as IsoDateTime,
        children: [
          {
            ...bookmark("bookmark:first", "first", "First", "file:///notes.html"),
            dateLastUsed: "2026-07-13T12:00:02.000Z" as IsoDateTime,
          },
        ],
      },
      {
        ...bookmark("bookmark:second", "second", "Second", "mailto:user@example.com"),
        dateModified: "2026-07-13T12:00:03.000Z" as IsoDateTime,
      },
    ],
    rootCount: 2,
    folderCount: 1,
    bookmarkCount: 2,
  };
}

function flatSnapshot(id: string, nodeCount: number): BookmarkSnapshot {
  return {
    ...emptySnapshot(id),
    roots: Array.from({ length: nodeCount }, (_, index) =>
      bookmark(
        `bookmark:${id}:${index}`,
        `source:${index}`,
        `Bookmark ${index}`,
        `https://example.com/${index}`,
      )),
    rootCount: nodeCount,
    bookmarkCount: nodeCount,
  };
}

function deepSnapshot(id: string, depth: number): BookmarkSnapshot {
  let node: BookmarkRecord | undefined;
  for (let level = depth; level >= 1; level -= 1) {
    node = {
      id: `bookmark:${id}:${level}` as never,
      kind: "folder",
      sourceId: `source:${level}`,
      title: `Folder ${level}`,
      children: node === undefined ? [] : [node],
    };
  }
  assert(node !== undefined, "Expected a non-empty deep snapshot");
  return {
    ...emptySnapshot(id),
    roots: [node],
    rootCount: 1,
    folderCount: depth,
  };
}

function loadedDepth(snapshot: BookmarkSnapshot): number {
  let depth = 0;
  let node = snapshot.roots[0];
  while (node?.kind === "folder") {
    depth += 1;
    node = node.children[0];
  }
  return depth;
}

test("fresh and repeated migrations create the exact catalog schema once", async () => {
  await withDatabase(async (database) => {
    const beforeMigration = createSqliteCatalogSnapshotStore(database);
    const beforeLoad = await beforeMigration.load("missing" as SnapshotId);
    assertStorageFailure(beforeLoad, "storage_unavailable", "unmigrated store load");

    const first = migrateCatalogSchema(database);
    assert(first.ok, "First migration should succeed");
    const second = migrateCatalogSchema(database);
    assert(second.ok, "Repeated migration should be an exact no-op");

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?) ORDER BY name")
      .all("schema_migrations", "catalog_snapshots", "catalog_nodes")
      .map((row) => row.name);
    assertDeepEqual(
      tables,
      ["catalog_nodes", "catalog_snapshots", "schema_migrations"],
      "Migration tables changed",
    );

    const indexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?) ORDER BY name")
      .all("catalog_root_order", "catalog_child_order")
      .map((row) => row.name);
    assertDeepEqual(indexes, ["catalog_child_order", "catalog_root_order"], "Migration indexes changed");

    const foreignKeys = database.prepare("PRAGMA foreign_keys").get();
    assertEqual(foreignKeys?.foreign_keys, 1, "Foreign keys should be enabled");

    const migrations = database.prepare("SELECT migration_key, applied_at FROM schema_migrations").all();
    assertEqual(migrations.length, 1, "Migration key should be recorded once");
    assertEqual(migrations[0]?.migration_key, "001_catalog_snapshots", "Wrong migration key");
    assert(
      typeof migrations[0]?.applied_at === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(migrations[0].applied_at),
      "Migration time should be SQLite UTC with milliseconds",
    );
  });
});

test("save and load preserve an exact nested snapshot and fresh record containers", async () => {
  await withDatabase(async (database) => {
    migrate(database);
    const store = createSqliteCatalogSnapshotStore(database);
    const snapshot = nestedSnapshot();

    const saved = await store.save(snapshot);
    assertDeepEqual(saved, { ok: true, value: undefined }, "Snapshot save changed");

    const loaded = await store.load(snapshot.id);
    assert(loaded.ok && loaded.value !== null, "Saved snapshot should load");
    assertDeepEqual(loaded.value, snapshot, "Nested snapshot round-trip changed data");
    assert(loaded.value !== snapshot, "Load should return a fresh snapshot");
    assert(loaded.value.roots !== snapshot.roots, "Load should return fresh roots");
    const loadedRoot = loaded.value.roots[0];
    assert(loadedRoot !== snapshot.roots[0], "Load should return a fresh root record");
    if (loadedRoot === undefined || loadedRoot.kind !== "folder") {
      throw new Error("Expected a loaded root folder");
    }
    const sourceRoot = snapshot.roots[0];
    if (sourceRoot === undefined || sourceRoot.kind !== "folder") {
      throw new Error("Expected a source root folder");
    }
    assert(loadedRoot.children !== sourceRoot.children, "Load should return fresh child arrays");
  });
});

test("bookmark lookup returns exact links and null for folders or missing IDs", async () => {
  await withDatabase(async (database) => {
    migrate(database);
    const store = createSqliteCatalogSnapshotStore(database);
    const snapshot = nestedSnapshot("snapshot:bookmark-lookup");
    assert((await store.save(snapshot)).ok, "Bookmark lookup fixture should save");

    const loaded = await store.loadBookmark("bookmark:first" as BookmarkId);
    assert(loaded.ok, "Stored bookmark should load");
    assertDeepEqual(loaded.value, snapshot.roots[0]?.kind === "folder"
      ? snapshot.roots[0].children[0]
      : undefined, "Bookmark lookup changed fields");
    assertDeepEqual(
      await store.loadBookmark("bookmark:root-folder" as BookmarkId),
      { ok: true, value: null },
      "Folder lookup should be null",
    );
    assertDeepEqual(
      await store.loadBookmark("bookmark:missing" as BookmarkId),
      { ok: true, value: null },
      "Missing bookmark lookup should be null",
    );
  });
});

test("bookmark lookup rejects a malformed stored bookmark without repair", async () => {
  await withDatabase(async (database) => {
    migrate(database);
    const store = createSqliteCatalogSnapshotStore(database);
    const snapshot = nestedSnapshot("snapshot:bookmark-corrupt");
    assert((await store.save(snapshot)).ok, "Bookmark corruption fixture should save");
    database
      .prepare("UPDATE catalog_nodes SET date_modified = ? WHERE id = ?")
      .run("not-a-date", "bookmark:second");

    const loaded = await store.loadBookmark("bookmark:second" as BookmarkId);
    assertStorageFailure(loaded, "stored_snapshot_invalid", "Malformed bookmark lookup");
    const row = database.prepare("SELECT date_modified FROM catalog_nodes WHERE id = ?")
      .get("bookmark:second");
    assertEqual(row?.date_modified, "not-a-date", "Malformed bookmark was repaired");
  });
});

test("missing snapshots return success with null and file reopen preserves data", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const firstDatabase = new DatabaseSync(databasePath);
    const snapshot = nestedSnapshot("snapshot:reopen");

    try {
      migrate(firstDatabase);
      const firstStore = createSqliteCatalogSnapshotStore(firstDatabase);
      const missing = await firstStore.load("snapshot:missing" as SnapshotId);
      assertDeepEqual(missing, { ok: true, value: null }, "Missing snapshot outcome changed");
      const saved = await firstStore.save(snapshot);
      assert(saved.ok, "Reopen fixture should save");
    } finally {
      if (firstDatabase.isOpen) firstDatabase.close();
    }

    const reopened = new DatabaseSync(databasePath);
    try {
      const reopenedStore = createSqliteCatalogSnapshotStore(reopened);
      const loaded = await reopenedStore.load(snapshot.id);
      assert(loaded.ok, "Reopened snapshot should load");
      assertDeepEqual(loaded.value, snapshot, "Reopened snapshot changed data");
      const bookmark = await reopenedStore.loadBookmark("bookmark:first" as BookmarkId);
      assert(bookmark.ok && bookmark.value !== null, "Reopened bookmark should load");
      assertEqual(bookmark.value.url, "file:///notes.html", "Reopened bookmark URL changed");
    } finally {
      if (reopened.isOpen) reopened.close();
    }
  });
});

test("duplicate snapshot IDs return snapshot_exists and preserve the original", async () => {
  await withDatabase(async (database) => {
    migrate(database);
    const store = createSqliteCatalogSnapshotStore(database);
    const original = nestedSnapshot("snapshot:duplicate");
    const conflicting = emptySnapshot("snapshot:duplicate");

    const first = await store.save(original);
    assert(first.ok, "Original snapshot should save");
    const second = await store.save(conflicting);
    assertStorageFailure(second, "snapshot_exists", "Duplicate snapshot save");

    const loaded = await store.load(original.id);
    assert(loaded.ok, "Original snapshot should remain loadable");
    assertDeepEqual(loaded.value, original, "Duplicate save changed the original");
  });
});

test("separate snapshots may reuse source IDs while local IDs remain distinct", async () => {
  await withDatabase(async (database) => {
    migrate(database);
    const store = createSqliteCatalogSnapshotStore(database);
    const firstSnapshot = oneBookmarkSnapshot("snapshot:first", "bookmark:first", "First");
    const secondSnapshot = oneBookmarkSnapshot("snapshot:second", "bookmark:second", "Second");

    assert((await store.save(firstSnapshot)).ok, "First source-ID snapshot should save");
    assert((await store.save(secondSnapshot)).ok, "Second source-ID snapshot should save");

    const loadedFirst = await store.load(firstSnapshot.id);
    const loadedSecond = await store.load(secondSnapshot.id);
    assert(loadedFirst.ok && loadedFirst.value !== null, "First source-ID snapshot should load");
    assert(loadedSecond.ok && loadedSecond.value !== null, "Second source-ID snapshot should load");
    assertDeepEqual(loadedFirst.value, firstSnapshot, "First source-ID snapshot changed");
    assertDeepEqual(loadedSecond.value, secondSnapshot, "Second source-ID snapshot changed");
    assertEqual(
      loadedFirst.value.roots[0]?.sourceId,
      loadedSecond.value.roots[0]?.sourceId,
      "Source IDs should be reusable across snapshots",
    );
    assert(
      loadedFirst.value.roots[0]?.id !== loadedSecond.value.roots[0]?.id,
      "Local record IDs should remain distinct",
    );
  });
});

test("a mid-save constraint failure rolls back the snapshot and every node", async () => {
  await withDatabase(async (database) => {
    migrate(database);
    const store = createSqliteCatalogSnapshotStore(database);
    const malformed = {
      ...nestedSnapshot("snapshot:rollback"),
      roots: [
        {
          id: "bookmark:rollback-root" as never,
          kind: "folder" as const,
          sourceId: "rollback-root",
          title: "Rollback root",
          children: [
            bookmark("bookmark:valid-child", "valid-child", "Valid child", "https://example.com"),
            bookmark("bookmark:invalid-child", "invalid-child", "Invalid child", ""),
          ],
        },
      ],
      rootCount: 1,
      folderCount: 1,
      bookmarkCount: 2,
    } as unknown as BookmarkSnapshot;

    const saved = await store.save(malformed);
    assertStorageFailure(saved, "storage_unavailable", "Malformed mid-save");

    const snapshotRows = database
      .prepare("SELECT COUNT(*) AS count FROM catalog_snapshots WHERE id = ?")
      .get(malformed.id);
    const nodeRows = database
      .prepare("SELECT COUNT(*) AS count FROM catalog_nodes WHERE snapshot_id = ?")
      .get(malformed.id);
    assertEqual(snapshotRows?.count, 0, "Failed save left a snapshot row");
    assertEqual(nodeRows?.count, 0, "Failed save left node rows");
  });
});

test("corrupt stored counts are rejected without repair", async () => {
  await withDatabase(async (database) => {
    migrate(database);
    const store = createSqliteCatalogSnapshotStore(database);
    const snapshot = nestedSnapshot("snapshot:corrupt-counts");
    const saved = await store.save(snapshot);
    assert(saved.ok, "Corruption fixture should save");

    database
      .prepare("UPDATE catalog_snapshots SET folder_count = folder_count + 1 WHERE id = ?")
      .run(snapshot.id);
    const loaded = await store.load(snapshot.id);
    assertStorageFailure(loaded, "stored_snapshot_invalid", "Corrupt counts");

    const row = database.prepare("SELECT folder_count FROM catalog_snapshots WHERE id = ?").get(snapshot.id);
    assertEqual(row?.folder_count, snapshot.folderCount + 1, "Corrupt count was repaired");
  });
});

test("Catalog storage round-trips the inclusive node and depth boundaries", async () => {
  await withDatabase(async (database) => {
    migrate(database);
    const store = createSqliteCatalogSnapshotStore(database);

    const maximumDepth = deepSnapshot("snapshot:max-depth", 256);
    assert((await store.save(maximumDepth)).ok, "Maximum-depth snapshot should save");
    const loadedDepthSnapshot = await store.load(maximumDepth.id);
    assert(
      loadedDepthSnapshot.ok && loadedDepthSnapshot.value !== null,
      "Maximum-depth snapshot should load",
    );
    assertEqual(loadedDepth(loadedDepthSnapshot.value), 256, "Stored depth changed");

    const maximumNodes = flatSnapshot("snapshot:max-nodes", 20_000);
    assert((await store.save(maximumNodes)).ok, "Maximum-node snapshot should save");
    const loadedNodes = await store.load(maximumNodes.id);
    assert(
      loadedNodes.ok && loadedNodes.value !== null,
      "Maximum-node snapshot should load",
    );
    assertEqual(loadedNodes.value.roots.length, 20_000, "Stored node count changed");
  });
});

test("Catalog storage rejects limit-plus-one stored graphs without repair", async () => {
  await withDatabase(async (database) => {
    migrate(database);
    const store = createSqliteCatalogSnapshotStore(database);

    const tooDeep = deepSnapshot("snapshot:too-deep", 257);
    assert((await store.save(tooDeep)).ok, "Direct over-depth fixture should save");
    assertStorageFailure(
      await store.load(tooDeep.id),
      "stored_snapshot_invalid",
      "Over-depth stored snapshot",
    );

    const tooManyNodes = flatSnapshot("snapshot:too-many-nodes", 20_001);
    assert((await store.save(tooManyNodes)).ok, "Direct over-node fixture should save");
    assertStorageFailure(
      await store.load(tooManyNodes.id),
      "stored_snapshot_invalid",
      "Over-node stored snapshot",
    );
  });
});

test("closed databases return storage_unavailable for migration, save, and loads", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    database.close();

    const migration = migrateCatalogSchema(database);
    assertStorageFailure(migration, "storage_unavailable", "Closed database migration");

    const store = createSqliteCatalogSnapshotStore(database);
    const save = await store.save(emptySnapshot("snapshot:closed"));
    const load = await store.load("snapshot:closed" as SnapshotId);
    const loadBookmark = await store.loadBookmark("bookmark:closed" as BookmarkId);
    assertStorageFailure(save, "storage_unavailable", "Closed database save");
    assertStorageFailure(load, "storage_unavailable", "Closed database load");
    assertStorageFailure(loadBookmark, "storage_unavailable", "Closed database bookmark load");
  });
});
