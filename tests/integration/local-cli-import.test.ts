import type { SnapshotId } from "../../core/contracts/public.js";
import type { CatalogDatabaseSession } from "../../adapters/sqlite/public.js";
import type {
  ImportCommandResult,
  RunImportCommand,
} from "../../apps/local-cli/import-command.js";
import type { LocalCliMain } from "../../apps/local-cli/main.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface ChildProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface ChildProcessApi {
  spawnSync(
    command: string,
    arguments_: readonly string[],
    options: { readonly cwd: string; readonly encoding: "utf8" },
  ): ChildProcessResult;
}

interface FileSystemApi {
  writeFileSync(path: string, contents: string, encoding: "utf8"): void;
}

interface PathApi {
  join(...parts: string[]): string;
}

interface ProcessApi {
  readonly execPath: string;
  cwd(): string;
}

interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
  cleanup(): void;
}

interface TemporaryDatabaseApi {
  createTemporaryDatabase(prefix?: string): TemporaryDatabase;
}

interface SqlitePublicApi {
  openCatalogDatabase(databasePath: string):
    | { readonly ok: true; readonly value: CatalogDatabaseSession }
    | { readonly ok: false; readonly error: { readonly code: "storage_unavailable" } };
}

interface PackageJson {
  readonly scripts: Record<string, string>;
}

interface SuccessOutput {
  readonly ok: true;
  readonly snapshotId: string;
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const { spawnSync } = loadModule("node:child_process") as ChildProcessApi;
const { writeFileSync } = loadModule("node:fs") as FileSystemApi;
const { join } = loadModule("node:path") as PathApi;
const processApi = loadModule("node:process") as ProcessApi;
const packageJson = loadModule("../../package.json") as PackageJson;
const { createTemporaryDatabase } = loadModule(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const { openCatalogDatabase } = loadModule(
  "../../adapters/sqlite/public.ts",
) as SqlitePublicApi;

const REPOSITORY = processApi.cwd();
const ENTRY_POINT = "apps/local-cli/main.ts";
const FIXTURE = join(
  REPOSITORY,
  "tests/fixtures/chrome-bookmarks/minimal.html",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function runCli(arguments_: readonly string[]): ChildProcessResult {
  return spawnSync(processApi.execPath, [ENTRY_POINT, ...arguments_], {
    cwd: REPOSITORY,
    encoding: "utf8",
  });
}

function assertProcessResult(
  result: ChildProcessResult,
  status: number,
  stdout: string,
  stderr: string,
): void {
  assert(result.status === status, `Expected exit ${status}; got ${result.status}`);
  assert(result.stdout === stdout, `Unexpected stdout: ${result.stdout}`);
  assert(result.stderr === stderr, `Unexpected stderr: ${result.stderr}`);
}

function parseSuccess(stdout: string): SuccessOutput {
  const value = JSON.parse(stdout) as Partial<SuccessOutput>;
  assert(value.ok === true, "Success output must set ok");
  assert(typeof value.snapshotId === "string", "Success output needs snapshotId");
  assert(typeof value.rootCount === "number", "Success output needs rootCount");
  assert(typeof value.folderCount === "number", "Success output needs folderCount");
  assert(typeof value.bookmarkCount === "number", "Success output needs bookmarkCount");
  return value as SuccessOutput;
}

test("package command imports the fixture and persists the reported snapshot", async () => {
  assert(
    packageJson.scripts.import === "node apps/local-cli/main.ts",
    "Package import script changed",
  );
  const temporary = createTemporaryDatabase("bookmark-clean-cli-success-");
  try {
    const processResult = runCli([
      "--input",
      FIXTURE,
      "--database",
      temporary.databasePath,
    ]);
    assert(processResult.status === 0, `Import failed: ${processResult.stderr}`);
    assert(processResult.stderr === "", "Success wrote to stderr");
    const output = parseSuccess(processResult.stdout);
    assertProcessResult(
      processResult,
      0,
      `${JSON.stringify(output)}\n`,
      "",
    );
    assert(output.rootCount === 1, "Wrong root count");
    assert(output.folderCount === 1, "Wrong folder count");
    assert(output.bookmarkCount === 1, "Wrong bookmark count");

    const opened = openCatalogDatabase(temporary.databasePath);
    assert(opened.ok, "Persisted database did not reopen");
    try {
      const loaded = await opened.value.store.load(
        output.snapshotId as SnapshotId,
      );
      assert(loaded.ok, "Persisted snapshot did not load");
      assert(loaded.value !== null, "Reported snapshot was not persisted");
      assert(loaded.value.rootCount === 1, "Persisted root count changed");
      assert(loaded.value.folderCount === 1, "Persisted folder count changed");
      assert(loaded.value.bookmarkCount === 1, "Persisted bookmark count changed");
    } finally {
      opened.value.close();
    }
  } finally {
    temporary.cleanup();
  }
});

test("invalid argument shapes return only invalid_arguments", () => {
  for (const arguments_ of [
    [],
    ["--input", FIXTURE],
    ["--input", "", "--database", "file.sqlite"],
    ["--input", FIXTURE, "--input", FIXTURE],
    ["--input", FIXTURE, "--database", "file.sqlite", "extra"],
  ]) {
    assertProcessResult(
      runCli(arguments_),
      2,
      "",
      '{"ok":false,"code":"invalid_arguments"}\n',
    );
  }
});

test("an unreadable input returns only input_unavailable", () => {
  const temporary = createTemporaryDatabase("bookmark-clean-cli-input-");
  try {
    assertProcessResult(
      runCli([
        "--input",
        join(temporary.directory, "missing.html"),
        "--database",
        temporary.databasePath,
      ]),
      3,
      "",
      '{"ok":false,"code":"input_unavailable"}\n',
    );
  } finally {
    temporary.cleanup();
  }
});

test("an unavailable database returns only storage_unavailable", () => {
  const temporary = createTemporaryDatabase("bookmark-clean-cli-storage-");
  try {
    assertProcessResult(
      runCli([
        "--input",
        FIXTURE,
        "--database",
        temporary.directory,
      ]),
      4,
      "",
      '{"ok":false,"code":"storage_unavailable"}\n',
    );
  } finally {
    temporary.cleanup();
  }
});

test("typed parser rejection preserves structured fields without diagnostics", () => {
  const temporary = createTemporaryDatabase("bookmark-clean-cli-parser-");
  try {
    const emptyInput = join(temporary.directory, "empty.html");
    writeFileSync(emptyInput, " \n\t ", "utf8");
    assertProcessResult(
      runCli([
        "--database",
        temporary.databasePath,
        "--input",
        emptyInput,
      ]),
      5,
      "",
      '{"ok":false,"code":"import_failed","stage":"source","failureCode":"empty_input","path":[],"field":"html"}\n',
    );
  } finally {
    temporary.cleanup();
  }
});

void (null as unknown as ImportCommandResult);
void (null as unknown as RunImportCommand);
void (null as unknown as LocalCliMain);
