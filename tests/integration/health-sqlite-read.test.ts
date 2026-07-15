import type {
  BookmarkId,
  ContentHash,
  IsoDateTime,
  JobResultId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  HealthObservation,
  HealthRepositoryFailure,
} from "../../modules/health/public.js";

interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }
interface SqliteRow { readonly [key: string]: unknown; }
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
interface SqliteApi { DatabaseSync: new (location: string) => SqliteDatabase; }
interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (input: { readonly databasePath: string }) => T | PromiseLike<T>,
  ): Promise<T>;
}

declare const require: (specifier: string) => unknown;
const load = require as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const { DatabaseSync } = load("node:sqlite") as SqliteApi;
const { withTemporaryDatabase } = load("../helpers/temporary-database.ts") as TemporaryDatabaseApi;
const { migrateCatalogSchema } = load("../../adapters/sqlite/catalog-schema.ts") as {
  migrateCatalogSchema(database: SqliteDatabase): Outcome<void, { readonly code: string }>;
};
const { migrateJobsSchema } = load("../../adapters/sqlite/jobs-schema.ts") as {
  migrateJobsSchema(database: SqliteDatabase): Outcome<void, { readonly code: string }>;
};
const { migrateHealthSchema } = load("../../adapters/sqlite/health-schema.ts") as {
  migrateHealthSchema(database: SqliteDatabase): Outcome<void, HealthRepositoryFailure>;
};
const { loadHealthObservationByInput } = load(
  "../../adapters/sqlite/health-observation-read.ts",
) as {
  loadHealthObservationByInput(
    database: SqliteDatabase,
    bookmarkId: BookmarkId,
    inputVersion: string,
  ): Outcome<HealthObservation | null, HealthRepositoryFailure>;
};

const BOOKMARK_ID = "bookmark:health-read" as BookmarkId;
const CHECKED_AT = "2026-07-15T08:00:00.000Z" as IsoDateTime;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value !== "object" || value === null) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonical(record[key])]),
    );
  };
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) {
    throw new Error(`${message}: ${JSON.stringify(actual)}`);
  }
}

function observation(): HealthObservation {
  return {
    id: "observation:health-read" as JobResultId,
    bookmarkId: BOOKMARK_ID,
    inputVersion: "input:v1",
    status: "redirect_permanent",
    checkedAt: CHECKED_AT,
    requestedUrl: "https://example.com/start",
    finalUrl: "https://example.com/final",
    method: "GET",
    httpStatus: 204,
    redirects: [{
      requestedUrl: "https://example.com/start",
      statusCode: 301,
      location: "/final",
      nextUrl: "https://example.com/final",
    }],
    durationMs: 42,
    retryCount: 0,
    headers: [{ name: "content-type", value: "text/html" }],
    bodyFingerprint: "sha256:fixed" as ContentHash,
  };
}

function insertObservation(database: SqliteDatabase, value = observation()): void {
  database.prepare(
    "INSERT INTO health_observations(" +
      "id, bookmark_id, input_version, status, checked_at, requested_url, final_url, " +
      "method, http_status, redirects_json, duration_ms, retry_count, headers_json, " +
      "error_code, body_fingerprint" +
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    value.id,
    value.bookmarkId,
    value.inputVersion,
    value.status,
    value.checkedAt,
    value.requestedUrl,
    value.finalUrl ?? null,
    value.method,
    value.httpStatus ?? null,
    JSON.stringify(value.redirects),
    value.durationMs,
    value.retryCount,
    JSON.stringify(value.headers),
    value.errorCode ?? null,
    value.bodyFingerprint ?? null,
  );
}

test("health migration is repeatable and coexists with Catalog and Jobs", async () => {
  await withTemporaryDatabase(({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      const before = loadHealthObservationByInput(database, BOOKMARK_ID, "input:v1");
      assertDeepEqual(before, { ok: false, error: { code: "storage_unavailable" } }, "Unmigrated read changed");
      assert(migrateCatalogSchema(database).ok, "Catalog migration failed");
      assert(migrateJobsSchema(database).ok, "Jobs migration failed");
      assert(migrateHealthSchema(database).ok, "Health migration failed");
      assert(migrateHealthSchema(database).ok, "Repeated Health migration failed");
      const keys = database.prepare(
        "SELECT migration_key FROM schema_migrations ORDER BY migration_key",
      ).all().map((row) => row.migration_key);
      assertDeepEqual(keys, ["001_catalog_snapshots", "002_jobs", "003_health_observations"], "Migration keys changed");
    } finally {
      database.close();
    }
  });
});

test("reader returns an exact fresh observation and null for a missing key", async () => {
  await withTemporaryDatabase(({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      assert(migrateHealthSchema(database).ok, "Health migration failed");
      const expected = observation();
      insertObservation(database, expected);
      const first = loadHealthObservationByInput(database, BOOKMARK_ID, "input:v1");
      const second = loadHealthObservationByInput(database, BOOKMARK_ID, "input:v1");
      assert(first.ok && first.value !== null, "Stored observation should load");
      assert(second.ok && second.value !== null, "Stored observation should reload");
      assertDeepEqual(first.value, expected, "Stored observation changed");
      assert(first.value !== second.value, "Reader reused the observation object");
      assert(first.value.redirects !== second.value.redirects, "Reader reused redirects");
      assert(first.value.headers !== second.value.headers, "Reader reused headers");
      assertDeepEqual(
        loadHealthObservationByInput(database, BOOKMARK_ID, "input:missing"),
        { ok: true, value: null },
        "Missing observation changed",
      );
    } finally {
      database.close();
    }
  });
});

test("reader rejects malformed stored JSON and dates without repair", async () => {
  await withTemporaryDatabase(({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      assert(migrateHealthSchema(database).ok, "Health migration failed");
      insertObservation(database);
      for (const [column, value] of [
        ["redirects_json", "not-json"],
        ["headers_json", JSON.stringify([{ name: "server", value: "hidden" }])],
        ["checked_at", "not-a-date"],
      ] as const) {
        database.prepare(`UPDATE health_observations SET ${column} = ?`).run(value);
        const loaded = loadHealthObservationByInput(database, BOOKMARK_ID, "input:v1");
        assertDeepEqual(loaded, { ok: false, error: { code: "storage_unavailable" } }, `Malformed ${column} read changed`);
        const row = database.prepare(`SELECT ${column} AS value FROM health_observations`).get();
        assert(row?.value === value, `Malformed ${column} was repaired`);
        database.exec("DELETE FROM health_observations");
        insertObservation(database);
      }
    } finally {
      database.close();
    }
  });
});

test("reader survives reopen and closed databases are unavailable", async () => {
  await withTemporaryDatabase(({ databasePath }) => {
    const first = new DatabaseSync(databasePath);
    assert(migrateHealthSchema(first).ok, "Health migration failed");
    insertObservation(first);
    first.close();

    const reopened = new DatabaseSync(databasePath);
    const loaded = loadHealthObservationByInput(reopened, BOOKMARK_ID, "input:v1");
    assert(loaded.ok && loaded.value?.id === "observation:health-read", "Reopened observation changed");
    reopened.close();
    assertDeepEqual(
      loadHealthObservationByInput(reopened, BOOKMARK_ID, "input:v1"),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed reader changed",
    );
    assertDeepEqual(
      migrateHealthSchema(reopened),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed migration changed",
    );
  });
});
