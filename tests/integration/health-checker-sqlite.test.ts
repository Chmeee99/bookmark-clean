import type {
  BookmarkId,
  ContentHash,
  IsoDateTime,
  JobResultId,
} from "../../core/contracts/public.js";
import type {
  HealthChecker,
  HealthCheckerDependencies,
  HealthObservationRepository,
} from "../../modules/health/public.js";

interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }
interface SqliteDatabase { close(): void; exec(sql: string): void; prepare(sql: string): unknown; }
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
const { createHealthChecker } = load("../../modules/health/public.ts") as {
  createHealthChecker(dependencies: HealthCheckerDependencies): HealthChecker;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

test("checker commits through SQLite and durable replay avoids transport", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      assert(migrateHealthSchema(database).ok, "Health migration failed");
      const repository = createSqliteHealthObservationStore(database);
      let transportCalls = 0;
      let idCalls = 0;
      const checker = createHealthChecker({
        config: { timeoutMs: 100, maxRedirects: 5, maxBodyBytes: 16 },
        clock: { now: () => "2026-07-15T13:00:00.000Z" as IsoDateTime },
        idFactory: {
          nextObservationId() {
            idCalls += 1;
            return "observation:sqlite-checker" as JobResultId;
          },
        },
        transport: {
          async request(request) {
            transportCalls += 1;
            return {
              ok: true,
              value: {
                url: request.url,
                statusCode: 200,
                headers: [{ name: "content-type", value: "text/plain" }],
                body: new Uint8Array([1, 2, 3]),
                durationMs: 4,
              },
            };
          },
        },
        fingerprinter: {
          fingerprint: () => "sha256:sqlite" as ContentHash,
        },
        repository,
      });
      const request = {
        bookmarkId: "bookmark:sqlite-checker" as BookmarkId,
        inputVersion: "input:v1",
        url: "https://example.com/sqlite",
      };
      const first = await checker.check(request);
      assert(first.ok && first.value.id === "observation:sqlite-checker", "Checker did not commit");
      const loaded = await repository.loadByInput(request.bookmarkId, request.inputVersion);
      assert(loaded.ok && loaded.value !== null, "Committed observation did not load");
      assert(loaded.value.status === "healthy", "Stored status changed");
      assert(loaded.value.bodyFingerprint === "sha256:sqlite", "Stored fingerprint changed");
      assert(loaded.value.durationMs === 4, "Stored duration changed");

      const replay = await checker.check(request);
      assert(replay.ok && replay.value.id === first.value.id, "Durable replay changed");
      assert(transportCalls === 1 && idCalls === 1, "Replay repeated checker side effects");
    } finally {
      database.close();
    }
  });
});
