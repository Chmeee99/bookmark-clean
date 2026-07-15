import type { Outcome } from "../../core/contracts/public.js";
import type { CatalogSnapshotStore } from "../../modules/catalog/public.js";
import type { HealthObservationRepository } from "../../modules/health/public.js";
import type { JobQueueStore } from "../../modules/jobs/public.js";
import type {
  BookmarkCleanDatabaseFailure,
  BookmarkCleanDatabaseSession,
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

interface SchemaApi {
  migrate(database: SqliteDatabase): Outcome<void, { readonly code: string }>;
}

interface CatalogStoreApi {
  createSqliteCatalogSnapshotStore(
    database: SqliteDatabase,
  ): CatalogSnapshotStore;
}

interface JobsStoreApi {
  createSqliteJobQueueStore(database: SqliteDatabase): JobQueueStore;
}

interface HealthStoreApi {
  createSqliteHealthObservationStore(
    database: SqliteDatabase,
  ): HealthObservationRepository;
}

declare const require: (specifier: string) => unknown;
declare const module: {
  exports: { openBookmarkCleanDatabase: typeof openBookmarkCleanDatabase };
};

const load = require as unknown as (specifier: string) => unknown;
const { DatabaseSync } = load("node:sqlite") as SqliteApi;
const { migrateCatalogSchema } = load("./catalog-schema.ts") as {
  migrateCatalogSchema: SchemaApi["migrate"];
};
const { migrateJobsSchema } = load("./jobs-schema.ts") as {
  migrateJobsSchema: SchemaApi["migrate"];
};
const { migrateHealthSchema } = load("./health-schema.ts") as {
  migrateHealthSchema: SchemaApi["migrate"];
};
const { createSqliteCatalogSnapshotStore } = load(
  "./catalog-snapshot-store.ts",
) as CatalogStoreApi;
const { createSqliteJobQueueStore } = load(
  "./job-queue-store.ts",
) as JobsStoreApi;
const { createSqliteHealthObservationStore } = load(
  "./health-observation-store.ts",
) as HealthStoreApi;

function unavailable(): Outcome<never, BookmarkCleanDatabaseFailure> {
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

function migrationsSucceeded(database: SqliteDatabase): boolean {
  for (const migrate of [
    migrateCatalogSchema,
    migrateJobsSchema,
    migrateHealthSchema,
  ]) {
    if (!migrate(database).ok) return false;
  }
  return true;
}

function openBookmarkCleanDatabase(
  databasePath: string,
): Outcome<BookmarkCleanDatabaseSession, BookmarkCleanDatabaseFailure> {
  let database: SqliteDatabase | undefined;
  try {
    database = new DatabaseSync(databasePath);
    if (!migrationsSucceeded(database)) {
      closeBestEffort(database);
      return unavailable();
    }

    const catalogStore = createSqliteCatalogSnapshotStore(database);
    const jobQueueStore = createSqliteJobQueueStore(database);
    const healthRepository = createSqliteHealthObservationStore(database);
    let closed = false;
    return {
      ok: true,
      value: {
        catalogStore,
        jobQueueStore,
        healthRepository,
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

module.exports = { openBookmarkCleanDatabase };
