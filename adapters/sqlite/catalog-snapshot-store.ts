import type {
  BookmarkRecord,
  BookmarkLinkRecord,
  BookmarkSnapshot,
  CatalogSnapshotStore,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type { BookmarkId, IsoDateTime, Outcome, SnapshotId } from "../../core/contracts/public.js";

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  all(...parameters: unknown[]): SqliteRow[];
  get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface ReconstructionApi {
  reconstructCatalogBookmark(
    row: SqliteRow,
    bookmarkId: BookmarkId,
  ): Outcome<BookmarkLinkRecord, CatalogStorageFailure>;
  reconstructCatalogSnapshot(
    snapshotRow: SqliteRow,
    nodeRows: readonly SqliteRow[],
    snapshotId: SnapshotId,
  ): Outcome<BookmarkSnapshot, CatalogStorageFailure>;
}

declare const require: (specifier: "./catalog-snapshot-reconstruction.ts") => unknown;
declare const module: {
  exports: {
    createSqliteCatalogSnapshotStore: typeof createSqliteCatalogSnapshotStore;
  };
};

const { reconstructCatalogBookmark, reconstructCatalogSnapshot } = require(
  "./catalog-snapshot-reconstruction.ts",
) as ReconstructionApi;

const SNAPSHOT_SELECT =
  "SELECT id, source, captured_at, root_count, folder_count, bookmark_count " +
  "FROM catalog_snapshots WHERE id = ?";
const NODE_SELECT =
  "SELECT id, snapshot_id, source_id, parent_id, sibling_index, kind, title, " +
  "url, date_added, date_modified, date_last_used " +
  "FROM catalog_nodes WHERE snapshot_id = ? ORDER BY id";
const BOOKMARK_SELECT =
  "SELECT id, snapshot_id, source_id, parent_id, sibling_index, kind, title, " +
  "url, date_added, date_modified, date_last_used " +
  "FROM catalog_nodes WHERE id = ? AND kind = 'bookmark'";
const SNAPSHOT_INSERT =
  "INSERT INTO catalog_snapshots(" +
  "id, source, captured_at, root_count, folder_count, bookmark_count" +
  ") VALUES (?, ?, ?, ?, ?, ?)";
const NODE_INSERT =
  "INSERT INTO catalog_nodes(" +
  "id, snapshot_id, source_id, parent_id, sibling_index, kind, title, url, " +
  "date_added, date_modified, date_last_used" +
  ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

function storageUnavailable<T>(): Outcome<T, CatalogStorageFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function snapshotExists(): Outcome<void, CatalogStorageFailure> {
  return { ok: false, error: { code: "snapshot_exists" } };
}

function rollbackBestEffort(database: SqliteDatabase): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Rollback is best effort after an engine failure.
  }
}

function optionalSqlValue(value: IsoDateTime | undefined): string | null {
  return value === undefined ? null : value;
}

function insertNode(
  statement: SqliteStatement,
  snapshotId: SnapshotId,
  node: BookmarkRecord,
  parentId: string | null,
  siblingIndex: number,
): void {
  const isFolder = node.kind === "folder";
  statement.run(
    node.id,
    snapshotId,
    node.sourceId,
    parentId,
    siblingIndex,
    node.kind,
    node.title,
    isFolder ? null : node.url,
    optionalSqlValue(node.dateAdded),
    optionalSqlValue(node.dateModified),
    isFolder ? null : optionalSqlValue(node.dateLastUsed),
  );

  if (isFolder) {
    for (let index = 0; index < node.children.length; index += 1) {
      insertNode(statement, snapshotId, node.children[index], node.id, index);
    }
  }
}

function saveSnapshot(
  database: SqliteDatabase,
  snapshot: BookmarkSnapshot,
): Outcome<void, CatalogStorageFailure> {
  let transactionStarted = false;

  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;

    const existing = database
      .prepare("SELECT id FROM catalog_snapshots WHERE id = ?")
      .get(snapshot.id);
    if (existing !== undefined) {
      rollbackBestEffort(database);
      transactionStarted = false;
      return snapshotExists();
    }

    database
      .prepare(SNAPSHOT_INSERT)
      .run(
        snapshot.id,
        snapshot.source,
        snapshot.capturedAt,
        snapshot.rootCount,
        snapshot.folderCount,
        snapshot.bookmarkCount,
      );

    const nodeStatement = database.prepare(NODE_INSERT);
    for (let index = 0; index < snapshot.roots.length; index += 1) {
      insertNode(nodeStatement, snapshot.id, snapshot.roots[index], null, index);
    }

    database.exec("COMMIT");
    transactionStarted = false;
    return { ok: true, value: undefined };
  } catch {
    if (transactionStarted) {
      rollbackBestEffort(database);
    }
    return storageUnavailable();
  }
}

function createSqliteCatalogSnapshotStore(
  database: SqliteDatabase,
): CatalogSnapshotStore {
  return {
    async save(snapshot) {
      return saveSnapshot(database, snapshot);
    },
    async load(id) {
      try {
        const snapshotRow = database.prepare(SNAPSHOT_SELECT).get(id);
        if (snapshotRow === undefined) {
          return { ok: true, value: null };
        }
        const nodeRows = database.prepare(NODE_SELECT).all(id);
        return reconstructCatalogSnapshot(snapshotRow, nodeRows, id);
      } catch {
        return storageUnavailable();
      }
    },
    async loadBookmark(id) {
      try {
        const row = database.prepare(BOOKMARK_SELECT).get(id);
        if (row === undefined) {
          return { ok: true, value: null };
        }
        return reconstructCatalogBookmark(row, id);
      } catch {
        return storageUnavailable();
      }
    },
  };
}

module.exports = { createSqliteCatalogSnapshotStore };
