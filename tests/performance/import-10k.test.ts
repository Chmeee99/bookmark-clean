import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";
import type {
  BookmarkCatalog,
  BookmarkRecord,
  BookmarkSnapshot,
  CatalogIdFactory,
  CatalogSnapshotStore,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type {
  LargeBookmarkExport,
  LargeBookmarkSample,
} from "../fixtures/generate-large-bookmark-export.js";
import type { ParseBookmarksHtml } from "../../adapters/chrome-html/parse-bookmarks-html.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface FileSystemApi {
  statSync(path: string): { readonly size: number };
}

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  all(...parameters: unknown[]): SqliteRow[];
  get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
  readonly isOpen: boolean;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteApi {
  DatabaseSync: new (location: string) => SqliteDatabase;
}

interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: { readonly databasePath: string }) => T | PromiseLike<T>,
  ): Promise<T>;
}

interface ParserApi {
  parseBookmarksHtml: ParseBookmarksHtml;
}

interface GeneratorApi {
  generateLargeBookmarkExport(): LargeBookmarkExport;
}

interface MigrationApi {
  migrateCatalogSchema(
    database: SqliteDatabase,
  ): Outcome<void, CatalogStorageFailure>;
}

interface StoreApi {
  createSqliteCatalogSnapshotStore(database: SqliteDatabase): CatalogSnapshotStore;
}

interface CatalogServiceApi {
  createBookmarkCatalog(dependencies: {
    readonly idFactory: CatalogIdFactory;
    readonly store: CatalogSnapshotStore;
  }): BookmarkCatalog;
}

interface IdFactoryApi {
  createCryptoCatalogIdFactory(): CatalogIdFactory;
}

interface PerformanceApi {
  now(): number;
}

interface ProcessApi {
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
  readonly stdout: { write(chunk: string): boolean };
  memoryUsage(): { rss: number };
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const { statSync } = loadModule("node:fs") as FileSystemApi;
const { DatabaseSync } = loadModule("node:sqlite") as SqliteApi;
const { performance } = loadModule("node:perf_hooks") as {
  performance: PerformanceApi;
};
const processApi = loadModule("node:process") as ProcessApi;
const { withTemporaryDatabase } = loadModule(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const { generateLargeBookmarkExport } = loadModule(
  "../fixtures/generate-large-bookmark-export.ts",
) as GeneratorApi;
const { parseBookmarksHtml } = loadModule(
  "../../adapters/chrome-html/parse-bookmarks-html.ts",
) as ParserApi;
const { migrateCatalogSchema } = loadModule(
  "../../adapters/sqlite/catalog-schema.ts",
) as MigrationApi;
const { createSqliteCatalogSnapshotStore } = loadModule(
  "../../adapters/sqlite/catalog-snapshot-store.ts",
) as StoreApi;
const { createBookmarkCatalog } = loadModule(
  "../../modules/catalog/catalog-service.ts",
) as CatalogServiceApi;
const { createCryptoCatalogIdFactory } = loadModule(
  "../../modules/catalog/crypto-id-factory.ts",
) as IdFactoryApi;

const CAPTURED_AT = "2026-07-13T12:00:00.000Z" as IsoDateTime;
const EXPECTED_ROOT_COUNT = 100;
const EXPECTED_FOLDER_COUNT = 100;
const EXPECTED_BOOKMARK_COUNT = 9_900;
const EXPECTED_NODE_COUNT = 10_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}`);
  }
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
    throw new Error(message);
  }
}

function assertSuccessful<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown },
  message: string,
): T {
  assert(result.ok, message);
  return result.value;
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function indexLabel(index: number): string {
  return String(index).padStart(3, "0");
}

function assertGeneratorContract(generated: LargeBookmarkExport): void {
  assertEqual(generated.rootCount, EXPECTED_ROOT_COUNT, "Generator root count changed");
  assertEqual(generated.folderCount, EXPECTED_FOLDER_COUNT, "Generator folder count changed");
  assertEqual(
    generated.bookmarkCount,
    EXPECTED_BOOKMARK_COUNT,
    "Generator bookmark count changed",
  );
  assertEqual(generated.nodeCount, EXPECTED_NODE_COUNT, "Generator node count changed");
  assertEqual(
    countOccurrences(generated.html, "<H3 "),
    EXPECTED_FOLDER_COUNT,
    "Generated folder elements changed",
  );
  assertEqual(
    countOccurrences(generated.html, '<A HREF="'),
    EXPECTED_BOOKMARK_COUNT,
    "Generated bookmark elements changed",
  );
  assert(
    generated.html.includes("https://example.com/"),
    "Generated URLs must use the reserved example domain",
  );
  assert(
    !generated.html.includes("/Users/") && !generated.html.includes("localhost"),
    "Generated export must not contain private or local data",
  );
}

function assertRecordStructure(snapshot: BookmarkSnapshot): void {
  assertEqual(snapshot.source, "chrome_html", "Loaded source changed");
  assertEqual(snapshot.capturedAt, CAPTURED_AT, "Loaded capture timestamp changed");
  assertEqual(snapshot.rootCount, EXPECTED_ROOT_COUNT, "Loaded root count changed");
  assertEqual(snapshot.folderCount, EXPECTED_FOLDER_COUNT, "Loaded folder count changed");
  assertEqual(
    snapshot.bookmarkCount,
    EXPECTED_BOOKMARK_COUNT,
    "Loaded bookmark count changed",
  );
  assertEqual(snapshot.roots.length, EXPECTED_ROOT_COUNT, "Loaded root array changed");

  for (let folderIndex = 0; folderIndex < EXPECTED_ROOT_COUNT; folderIndex += 1) {
    const folder = snapshot.roots[folderIndex];
    assert(folder?.kind === "folder", "Every root must be a folder");
    assertEqual(folder.sourceId, `html:${folderIndex}`, "Root source order changed");
    assertEqual(
      folder.title,
      `Folder ${indexLabel(folderIndex)}`,
      "Root title order changed",
    );
    assertEqual(folder.children.length, 99, "Folder child count changed");

    for (let bookmarkIndex = 0; bookmarkIndex < 99; bookmarkIndex += 1) {
      const bookmark = folder.children[bookmarkIndex];
      assert(bookmark?.kind === "bookmark", "Every folder child must be a bookmark");
      assertEqual(
        bookmark.sourceId,
        `html:${folderIndex}/${bookmarkIndex}`,
        "Bookmark source order changed",
      );
      assertEqual(
        bookmark.title,
        `Bookmark ${indexLabel(folderIndex)}-${indexLabel(bookmarkIndex)}`,
        "Bookmark title order changed",
      );
    }
  }
}

function sampleRecord(snapshot: BookmarkSnapshot, sample: LargeBookmarkSample): {
  readonly folder: Record<string, unknown>;
  readonly bookmark: Record<string, unknown>;
} {
  const folder = snapshot.roots[sample.folderIndex];
  assert(folder?.kind === "folder", "Sample root must be a folder");
  const bookmark = folder.children[sample.bookmarkIndex];
  assert(bookmark?.kind === "bookmark", "Sample child must be a bookmark");
  return {
    folder: {
      kind: folder.kind,
      sourceId: folder.sourceId,
      title: folder.title,
      dateAdded: folder.dateAdded,
      dateModified: folder.dateModified,
      childCount: folder.children.length,
    },
    bookmark: {
      kind: bookmark.kind,
      sourceId: bookmark.sourceId,
      title: bookmark.title,
      url: bookmark.url,
      dateAdded: bookmark.dateAdded,
      dateModified: bookmark.dateModified,
      dateLastUsed: bookmark.dateLastUsed,
    },
  };
}

function assertSamples(
  snapshot: BookmarkSnapshot,
  generated: LargeBookmarkExport,
): void {
  for (const sample of Object.values(generated.expectedSamples)) {
    assertDeepEqual(
      sampleRecord(snapshot, sample),
      { folder: sample.folder, bookmark: sample.bookmark },
      "Deterministic sample values changed",
    );
  }
}

function assertDatabaseCounts(
  database: SqliteDatabase,
  snapshotId: string,
): void {
  const snapshotRows = database
    .prepare("SELECT COUNT(*) AS count FROM catalog_snapshots")
    .get();
  assertEqual(snapshotRows?.count, 1, "Database snapshot row count changed");

  const nodeRows = database
    .prepare(
      "SELECT COUNT(*) AS count, COUNT(DISTINCT id) AS distinct_ids, " +
        "COUNT(DISTINCT source_id) AS distinct_source_ids " +
        "FROM catalog_nodes WHERE snapshot_id = ?",
    )
    .get(snapshotId);
  assertEqual(nodeRows?.count, EXPECTED_NODE_COUNT, "Database node row count changed");
  assertEqual(
    nodeRows?.distinct_ids,
    EXPECTED_NODE_COUNT,
    "Database local IDs are not unique",
  );
  assertEqual(
    nodeRows?.distinct_source_ids,
    EXPECTED_NODE_COUNT,
    "Database source IDs are not unique",
  );
}

function sqliteVersion(database: SqliteDatabase): string {
  const row = database.prepare("SELECT sqlite_version() AS version").get();
  assert(typeof row?.version === "string", "SQLite version was not reported");
  return row.version;
}

function maxRss(values: readonly number[]): number {
  return Math.max(...values);
}

test("[performance] import exactly 10,000 generated nodes end to end", async () => {
  const generated = generateLargeBookmarkExport();
  const repeated = generateLargeBookmarkExport();
  assertGeneratorContract(generated);
  assertEqual(repeated.html, generated.html, "Generator output is not deterministic");
  assertDeepEqual(
    repeated.expectedSamples,
    generated.expectedSamples,
    "Generator samples are not deterministic",
  );

  await withTemporaryDatabase(async ({ databasePath }) => {
    const rssBefore = processApi.memoryUsage().rss;
    const parseStartedAt = performance.now();
    const parsed = parseBookmarksHtml({ html: generated.html, capturedAt: CAPTURED_AT });
    const rssAfterParse = processApi.memoryUsage().rss;
    assert(parsed.ok, "Large generated export did not parse");

    const database = new DatabaseSync(databasePath);
    let elapsedMs = 0;
    let databaseBytes = 0;
    let sqliteVersionValue = "";
    try {
      const migration = migrateCatalogSchema(database);
      assertSuccessful(migration, "Catalog migration failed");
      const catalog = createBookmarkCatalog({
        idFactory: createCryptoCatalogIdFactory(),
        store: createSqliteCatalogSnapshotStore(database),
      });
      const summary = await catalog.importSnapshot(parsed.value);
      elapsedMs = performance.now() - parseStartedAt;
      const importSummary = assertSuccessful(summary, "Large Catalog import failed");
      assertDeepEqual(
        importSummary,
        {
          snapshotId: importSummary.snapshotId,
          rootCount: EXPECTED_ROOT_COUNT,
          folderCount: EXPECTED_FOLDER_COUNT,
          bookmarkCount: EXPECTED_BOOKMARK_COUNT,
        },
        "Import summary counts changed",
      );
      assertEqual(
        importSummary.folderCount + importSummary.bookmarkCount,
        EXPECTED_NODE_COUNT,
        "Import summary total node count changed",
      );
      const rssAfterImport = processApi.memoryUsage().rss;
      const loadedBeforeClose = assertSuccessful(
        await catalog.getSnapshot(importSummary.snapshotId),
        "Catalog load before close failed",
      );
      assert(loadedBeforeClose !== null, "Imported snapshot was missing before close");
      assertRecordStructure(loadedBeforeClose);
      assertSamples(loadedBeforeClose, generated);
      const rssAfterLoad = processApi.memoryUsage().rss;
      assertDatabaseCounts(database, importSummary.snapshotId);
      databaseBytes = statSync(databasePath).size;
      sqliteVersionValue = sqliteVersion(database);

      database.close();
      const reopenedDatabase = new DatabaseSync(databasePath);
      try {
        const reopenedCatalog = createBookmarkCatalog({
          idFactory: createCryptoCatalogIdFactory(),
          store: createSqliteCatalogSnapshotStore(reopenedDatabase),
        });
        const loadedAfterReopen = assertSuccessful(
          await reopenedCatalog.getSnapshot(importSummary.snapshotId),
          "Catalog load after reopen failed",
        );
        assert(loadedAfterReopen !== null, "Imported snapshot was missing after reopen");
        assertRecordStructure(loadedAfterReopen);
        assertSamples(loadedAfterReopen, generated);
        assertDeepEqual(
          loadedAfterReopen,
          loadedBeforeClose,
          "Close and reopen changed the imported snapshot",
        );
        assertDatabaseCounts(reopenedDatabase, importSummary.snapshotId);
      } finally {
        if (reopenedDatabase.isOpen) {
          reopenedDatabase.close();
        }
      }

      const rssPeak = maxRss([rssBefore, rssAfterParse, rssAfterImport, rssAfterLoad]);
      const rssDeltaBytes = rssPeak - rssBefore;
      assert(rssDeltaBytes >= 0, "RSS delta must be non-negative");
      processApi.stdout.write(
        `[import-10k] nodes=${EXPECTED_NODE_COUNT} folders=${EXPECTED_FOLDER_COUNT} ` +
          `bookmarks=${EXPECTED_BOOKMARK_COUNT} elapsedMs=${elapsedMs.toFixed(2)} ` +
          `rssBeforeBytes=${rssBefore} rssPeakBytes=${rssPeak} ` +
          `rssDeltaBytes=${rssDeltaBytes} databaseBytes=${databaseBytes} ` +
          `node=${processApi.version} sqlite=${sqliteVersionValue} ` +
          `platform=${processApi.platform} arch=${processApi.arch}\n`,
      );
    } finally {
      if (database.isOpen) {
        database.close();
      }
    }
  });
});
