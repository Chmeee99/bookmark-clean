import type { Outcome } from "../../core/contracts/public.js";
import type {
  CatalogSnapshotStore,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type {
  CatalogDatabaseFailure,
  CatalogDatabaseSession,
} from "./public.js";

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
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface SqliteApi {
  DatabaseSync: new (location: string) => SqliteDatabase;
}

interface CatalogSchemaApi {
  migrateCatalogSchema(
    database: SqliteDatabase,
  ): Outcome<void, CatalogStorageFailure>;
}

interface CatalogStoreApi {
  createSqliteCatalogSnapshotStore(
    database: SqliteDatabase,
  ): CatalogSnapshotStore;
}

declare const require: (
  specifier:
    | "node:sqlite"
    | "./catalog-schema.ts"
    | "./catalog-snapshot-store.ts",
) => unknown;
declare const module: {
  exports: { openCatalogDatabase: typeof openCatalogDatabase };
};

const { DatabaseSync } = require("node:sqlite") as SqliteApi;
const { migrateCatalogSchema } = require(
  "./catalog-schema.ts",
) as CatalogSchemaApi;
const { createSqliteCatalogSnapshotStore } = require(
  "./catalog-snapshot-store.ts",
) as CatalogStoreApi;

function unavailable(): Outcome<never, CatalogDatabaseFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function closeBestEffort(database: SqliteDatabase | undefined): void {
  if (database?.isOpen !== true) return;
  try {
    database.close();
  } catch {
    // The original open or migration failure remains the public outcome.
  }
}

function openCatalogDatabase(
  databasePath: string,
): Outcome<CatalogDatabaseSession, CatalogDatabaseFailure> {
  let database: SqliteDatabase | undefined;
  try {
    database = new DatabaseSync(databasePath);
    const migrated = migrateCatalogSchema(database);
    if (!migrated.ok) {
      closeBestEffort(database);
      return unavailable();
    }

    const store = createSqliteCatalogSnapshotStore(database);
    let closed = false;
    return {
      ok: true,
      value: {
        store,
        close() {
          if (closed) return;
          database.close();
          closed = true;
        },
      },
    };
  } catch {
    closeBestEffort(database);
    return unavailable();
  }
}

module.exports = { openCatalogDatabase };
