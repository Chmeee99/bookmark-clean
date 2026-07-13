import type { CatalogStorageFailure } from "../../modules/catalog/public.js";
import type { Outcome } from "../../core/contracts/public.js";

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

const MIGRATION_KEY = "001_catalog_snapshots";

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);`;

const CATALOG_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS catalog_snapshots (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('chrome_api', 'chrome_html')),
  captured_at TEXT NOT NULL,
  root_count INTEGER NOT NULL CHECK (root_count >= 0),
  folder_count INTEGER NOT NULL CHECK (folder_count >= 0),
  bookmark_count INTEGER NOT NULL CHECK (bookmark_count >= 0)
);

CREATE TABLE IF NOT EXISTS catalog_nodes (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  parent_id TEXT REFERENCES catalog_nodes(id),
  sibling_index INTEGER NOT NULL CHECK (sibling_index >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('folder', 'bookmark')),
  title TEXT NOT NULL,
  url TEXT,
  date_added TEXT,
  date_modified TEXT,
  date_last_used TEXT,
  UNIQUE (snapshot_id, source_id),
  CHECK (
    (kind = 'folder' AND url IS NULL AND date_last_used IS NULL) OR
    (kind = 'bookmark' AND url IS NOT NULL AND length(url) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_root_order
  ON catalog_nodes(snapshot_id, sibling_index)
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_child_order
  ON catalog_nodes(snapshot_id, parent_id, sibling_index)
  WHERE parent_id IS NOT NULL;`;

function storageUnavailable(): Outcome<void, CatalogStorageFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function rollbackBestEffort(database: SqliteDatabase): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Rollback is best effort after an engine failure.
  }
}

function migrateCatalogSchema(
  database: SqliteDatabase,
): Outcome<void, CatalogStorageFailure> {
  let transactionStarted = false;

  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    database.exec(MIGRATIONS_TABLE_DDL);

    const existing = database
      .prepare("SELECT migration_key FROM schema_migrations WHERE migration_key = ?")
      .get(MIGRATION_KEY);
    if (existing !== undefined) {
      database.exec("COMMIT");
      transactionStarted = false;
      return { ok: true, value: undefined };
    }

    database.exec(CATALOG_SCHEMA_DDL);
    database
      .prepare(
        "INSERT INTO schema_migrations(migration_key, applied_at) " +
          "VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
      )
      .run(MIGRATION_KEY);
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

declare const module: {
  exports: {
    migrateCatalogSchema: typeof migrateCatalogSchema;
  };
};

module.exports = { migrateCatalogSchema };
