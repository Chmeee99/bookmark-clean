import type { RunOneCommand } from "../../apps/local-cli/run-one-command.js";
import type {
  BookmarkCleanDatabaseFailure,
  BookmarkCleanDatabaseSession,
} from "../../adapters/sqlite/public.js";
import type { Outcome } from "../../core/contracts/public.js";

interface NodeTestApi { test(name: string, callback: () => Promise<void>): void; }
interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
}
interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: TemporaryDatabase) => T | PromiseLike<T>,
  ): Promise<T>;
}
interface RunOneRuntime {
  runOneCommand: RunOneCommand;
}
interface SqliteRuntime {
  openBookmarkCleanDatabase(databasePath: string): Outcome<
    BookmarkCleanDatabaseSession,
    BookmarkCleanDatabaseFailure
  >;
}

declare const require: (specifier: string) => unknown;
const { test } = require("node:test") as NodeTestApi;
const { withTemporaryDatabase } = require(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const runOneRuntime = require(
  "../../apps/local-cli/run-one-command.ts",
) as RunOneRuntime & Record<string, unknown>;
const { openBookmarkCleanDatabase } = require(
  "../../adapters/sqlite/public.ts",
) as SqliteRuntime;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

test("rejects every malformed direct invocation", async () => {
  equal(Object.keys(runOneRuntime), ["runOneCommand"],
    "Run-one runtime exports changed");

  for (const arguments_ of [
    [],
    ["--database"],
    ["--database", ""],
    ["--unknown", "source.sqlite"],
    ["--database", "a.sqlite", "--database", "b.sqlite"],
    ["--database", "source.sqlite", "extra"],
  ]) {
    equal(
      await runOneRuntime.runOneCommand(arguments_),
      { exitCode: 2, output: { ok: false, code: "invalid_arguments" } },
      `Malformed arguments were accepted: ${JSON.stringify(arguments_)}`,
    );
  }
});

test("maps an unavailable database without opening a worker", async () => {
  await withTemporaryDatabase(async ({ directory }) => {
    equal(
      await runOneRuntime.runOneCommand(["--database", directory]),
      { exitCode: 4, output: { ok: false, code: "storage_unavailable" } },
      "Unavailable storage mapping changed",
    );
  });
});

test("runs one idle step and closes the real SQLite session", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    equal(
      await runOneRuntime.runOneCommand(["--database", databasePath]),
      { exitCode: 0, output: { ok: true, status: "idle" } },
      "Empty real queue did not return idle",
    );

    const reopened = openBookmarkCleanDatabase(databasePath);
    assert(reopened.ok, "Command did not leave the database reopenable");
    reopened.value.close();
  });
});
