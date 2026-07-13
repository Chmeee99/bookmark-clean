import type { JobQueueFailure } from "../../modules/jobs/public.js";
import type { Outcome } from "../../core/contracts/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
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

interface SchemaApi {
  migrateJobsSchema(database: SqliteDatabase): Outcome<void, JobQueueFailure>;
}

interface CatalogSchemaApi {
  migrateCatalogSchema(database: SqliteDatabase): Outcome<void, { readonly code: string }>;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const { DatabaseSync } = loadModule("node:sqlite") as SqliteApi;
const { withTemporaryDatabase } = loadModule(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const { migrateJobsSchema } = loadModule(
  "../../adapters/sqlite/jobs-schema.ts",
) as SchemaApi;
const { migrateCatalogSchema } = loadModule(
  "../../adapters/sqlite/catalog-schema.ts",
) as CatalogSchemaApi;

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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertSuccess(
  result: Outcome<void, JobQueueFailure>,
  message: string,
): asserts result is { ok: true; value: undefined } {
  assert(result.ok, `${message} should succeed`);
}

async function withDatabase<T>(
  work: (database: SqliteDatabase) => T | PromiseLike<T>,
): Promise<T> {
  return withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      return await work(database);
    } finally {
      if (database.isOpen) {
        database.close();
      }
    }
  });
}

function migrate(database: SqliteDatabase): void {
  assertSuccess(migrateJobsSchema(database), "Jobs migration");
}

test("fresh and repeated Jobs migrations create the exact tables, indexes, and key", async () => {
  await withDatabase((database) => {
    migrate(database);
    migrate(database);

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?) ORDER BY name",
      )
      .all("job_batches", "jobs", "schema_migrations")
      .map((row) => row.name);
    assertDeepEqual(
      tables,
      ["job_batches", "jobs", "schema_migrations"],
      "Jobs migration tables changed",
    );

    const indexes = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (?, ?, ?) ORDER BY name",
      )
      .all("jobs_batch_state", "jobs_lease_expiry", "jobs_eligibility")
      .map((row) => row.name);
    assertDeepEqual(
      indexes,
      ["jobs_batch_state", "jobs_eligibility", "jobs_lease_expiry"],
      "Jobs migration indexes changed",
    );

    assertEqual(
      database.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
      1,
      "Jobs migration did not enable foreign keys",
    );
    const migrations = database
      .prepare("SELECT migration_key, applied_at FROM schema_migrations")
      .all();
    assertDeepEqual(
      migrations.map((row) => row.migration_key),
      ["002_jobs"],
      "Jobs migration key changed",
    );
    assert(
      typeof migrations[0]?.applied_at === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(migrations[0].applied_at),
      "Jobs migration applied_at is not SQLite UTC",
    );

    const jobsSql = database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'")
      .get()?.sql;
    assert(
      typeof jobsSql === "string" &&
        jobsSql.includes("state IN ('pending', 'leased', 'succeeded', 'retry_wait', 'failed', 'cancelled')") &&
        jobsSql.includes("REFERENCES job_batches(id) ON DELETE CASCADE"),
      "Jobs table constraints do not match ADR 0007",
    );
  });
});

test("Jobs migration coexists with Catalog migration in either order", async () => {
  for (const order of ["jobs-first", "catalog-first"] as const) {
    await withDatabase((database) => {
      if (order === "jobs-first") {
        assertSuccess(migrateJobsSchema(database), "Jobs-first migration");
        assert(migrateCatalogSchema(database).ok, "Catalog-after-Jobs migration failed");
      } else {
        assert(migrateCatalogSchema(database).ok, "Catalog-first migration failed");
        assertSuccess(migrateJobsSchema(database), "Jobs-after-Catalog migration");
      }

      const migrations = database
        .prepare("SELECT migration_key FROM schema_migrations ORDER BY migration_key")
        .all()
        .map((row) => row.migration_key);
      assertDeepEqual(
        migrations,
        ["001_catalog_snapshots", "002_jobs"],
        `${order} migration keys changed`,
      );
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?) ORDER BY name",
        )
        .all("catalog_nodes", "catalog_snapshots", "job_batches", "jobs")
        .map((row) => row.name);
      assertDeepEqual(
        tables,
        ["catalog_nodes", "catalog_snapshots", "job_batches", "jobs"],
        `${order} migration tables changed`,
      );
    });
  }
});

test("closed database migration returns storage_unavailable without diagnostics", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    database.close();

    const result = migrateJobsSchema(database);
    assertDeepEqual(
      result,
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed Jobs migration failure changed",
    );
  });
});
