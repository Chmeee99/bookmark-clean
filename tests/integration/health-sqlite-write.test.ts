import type {
  BookmarkId,
  IsoDateTime,
  JobResultId,
} from "../../core/contracts/public.js";
import type {
  HealthObservation,
  HealthObservationRepository,
} from "../../modules/health/public.js";

interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }
interface SqliteRow { readonly [key: string]: unknown; }
interface SqliteStatement {
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
const { migrateHealthSchema } = load("../../adapters/sqlite/health-schema.ts") as {
  migrateHealthSchema(database: SqliteDatabase): { readonly ok: boolean };
};
const { createSqliteHealthObservationStore } = load(
  "../../adapters/sqlite/health-observation-store.ts",
) as {
  createSqliteHealthObservationStore(database: SqliteDatabase): HealthObservationRepository;
};

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

function observation(overrides: Partial<HealthObservation> = {}): HealthObservation {
  return {
    id: "observation:write" as JobResultId,
    bookmarkId: "bookmark:write" as BookmarkId,
    inputVersion: "input:v1",
    status: "healthy",
    checkedAt: "2026-07-15T09:00:00.000Z" as IsoDateTime,
    requestedUrl: "https://example.com",
    finalUrl: "https://example.com",
    method: "GET",
    httpStatus: 200,
    redirects: [],
    durationMs: 12,
    retryCount: 0,
    headers: [{ name: "etag", value: "fixed" }],
    ...overrides,
  };
}

test("store inserts and reads back one fresh validated observation", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      assert(migrateHealthSchema(database).ok, "Health migration failed");
      const store = createSqliteHealthObservationStore(database);
      const source = observation();
      const saved = await store.saveIfAbsent(source);
      assert(saved.ok, "Observation save failed");
      assertDeepEqual(saved.value, source, "Saved observation changed");
      assert(saved.value !== source, "Store returned the caller object");
      const loaded = await store.loadByInput(source.bookmarkId, source.inputVersion);
      assert(loaded.ok && loaded.value !== null, "Saved observation should load");
      assertDeepEqual(loaded.value, source, "Loaded observation changed");
      const row = database.prepare("SELECT COUNT(*) AS count FROM health_observations").get();
      assert(row?.count === 1, "Save inserted the wrong row count");
    } finally {
      database.close();
    }
  });
});

test("identical replay returns the stored row without inserting", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      assert(migrateHealthSchema(database).ok, "Health migration failed");
      const store = createSqliteHealthObservationStore(database);
      const source = observation();
      assert((await store.saveIfAbsent(source)).ok, "Initial save failed");
      const replay = await store.saveIfAbsent({ ...source, redirects: [], headers: [...source.headers] });
      assert(replay.ok, "Identical replay failed");
      assertDeepEqual(replay.value, source, "Replay changed the stored observation");
      const row = database.prepare("SELECT COUNT(*) AS count FROM health_observations").get();
      assert(row?.count === 1, "Replay inserted another row");
    } finally {
      database.close();
    }
  });
});

test("same input key with different facts conflicts and preserves the original", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      assert(migrateHealthSchema(database).ok, "Health migration failed");
      const store = createSqliteHealthObservationStore(database);
      const source = observation();
      assert((await store.saveIfAbsent(source)).ok, "Initial save failed");
      for (const conflicting of [
        observation({ id: "observation:other-url" as JobResultId, requestedUrl: "https://other.example" }),
        observation({ id: "observation:other-status" as JobResultId, status: "not_found", httpStatus: 404 }),
      ]) {
        assertDeepEqual(
          await store.saveIfAbsent(conflicting),
          { ok: false, error: { code: "observation_conflict" } },
          "Conflict outcome changed",
        );
      }
      assertDeepEqual(
        await store.loadByInput(source.bookmarkId, source.inputVersion),
        { ok: true, value: source },
        "Conflict changed the original",
      );
    } finally {
      database.close();
    }
  });
});

test("an observation ID collision on another input key is a storage failure", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      assert(migrateHealthSchema(database).ok, "Health migration failed");
      const store = createSqliteHealthObservationStore(database);
      const source = observation();
      assert((await store.saveIfAbsent(source)).ok, "Initial save failed");
      const collision = observation({
        bookmarkId: "bookmark:other" as BookmarkId,
        inputVersion: "input:v2",
      });
      assertDeepEqual(
        await store.saveIfAbsent(collision),
        { ok: false, error: { code: "storage_unavailable" } },
        "ID collision outcome changed",
      );
      const row = database.prepare("SELECT COUNT(*) AS count FROM health_observations").get();
      assert(row?.count === 1, "ID collision changed durable rows");
    } finally {
      database.close();
    }
  });
});

test("malformed candidates and engine aborts leave no row", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      assert(migrateHealthSchema(database).ok, "Health migration failed");
      const store = createSqliteHealthObservationStore(database);
      const malformed = observation({ requestedUrl: "" }) as HealthObservation;
      assertDeepEqual(
        await store.saveIfAbsent(malformed),
        { ok: false, error: { code: "storage_unavailable" } },
        "Malformed candidate outcome changed",
      );
      database.exec(`
        CREATE TRIGGER abort_health_observation
        BEFORE INSERT ON health_observations
        BEGIN
          SELECT RAISE(ABORT, 'fixed abort');
        END;
      `);
      assertDeepEqual(
        await store.saveIfAbsent(observation()),
        { ok: false, error: { code: "storage_unavailable" } },
        "Engine abort outcome changed",
      );
      const row = database.prepare("SELECT COUNT(*) AS count FROM health_observations").get();
      assert(row?.count === 0, "Failed saves left a row");
    } finally {
      database.close();
    }
  });
});

test("store preserves replay across reopen and reports closed storage", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const source = observation();
    const first = new DatabaseSync(databasePath);
    assert(migrateHealthSchema(first).ok, "Health migration failed");
    assert((await createSqliteHealthObservationStore(first).saveIfAbsent(source)).ok, "Initial save failed");
    first.close();

    const reopened = new DatabaseSync(databasePath);
    const store = createSqliteHealthObservationStore(reopened);
    assertDeepEqual(await store.saveIfAbsent(source), { ok: true, value: source }, "Reopened replay changed");
    reopened.close();
    assertDeepEqual(
      await store.loadByInput(source.bookmarkId, source.inputVersion),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed read changed",
    );
    assertDeepEqual(
      await store.saveIfAbsent(source),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed save changed",
    );
  });
});
