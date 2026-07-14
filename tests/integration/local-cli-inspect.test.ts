import type {
  InspectCommandResult,
  RunInspectCommand,
} from "../../apps/local-cli/inspect-command.js";

interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void }

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

interface TemporaryDatabaseApi { createTemporaryDatabase(prefix?: string): TemporaryDatabase }

interface PackageJson { readonly scripts: Record<string, string> }

interface SqliteStatement { run(...parameters: unknown[]): unknown }

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteApi { DatabaseSync: new (path: string) => SqliteDatabase }

interface ImportSuccess { readonly ok: true; readonly snapshotId: string }

interface InspectFolder {
  readonly id: string;
  readonly title: string;
  readonly bookmarkCount: number;
  readonly children: readonly InspectFolder[];
}

interface InspectSuccess {
  readonly ok: true;
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
  readonly folders: readonly InspectFolder[];
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const { spawnSync } = loadModule("node:child_process") as ChildProcessApi;
const { join } = loadModule("node:path") as PathApi;
const processApi = loadModule("node:process") as ProcessApi;
const packageJson = loadModule("../../package.json") as PackageJson;
const { DatabaseSync } = loadModule("node:sqlite") as SqliteApi;
const { createTemporaryDatabase } = loadModule(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;

const REPOSITORY = processApi.cwd();
const ENTRY_POINT = "apps/local-cli/main.ts";
const EDGE_CASE_FIXTURE = join(
  REPOSITORY,
  "tests/fixtures/chrome-bookmarks/edge-cases.html",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message}: ${String(actual)}`);
}

function runCli(arguments_: readonly string[]): ChildProcessResult {
  return spawnSync(processApi.execPath, [ENTRY_POINT, ...arguments_], {
    cwd: REPOSITORY,
    encoding: "utf8",
  });
}

function runInspect(arguments_: readonly string[]): ChildProcessResult {
  return runCli(["inspect", ...arguments_]);
}

function assertProcessResult(
  result: ChildProcessResult,
  status: number,
  stdout: string,
  stderr: string,
): void {
  assertEqual(result.status, status, "Wrong exit code");
  assertEqual(result.stdout, stdout, "Unexpected stdout");
  assertEqual(result.stderr, stderr, "Unexpected stderr");
}

function importFixture(temporary: TemporaryDatabase): ImportSuccess {
  const result = runCli([
    "--input",
    EDGE_CASE_FIXTURE,
    "--database",
    temporary.databasePath,
  ]);
  assert(result.status === 0, `Fixture import failed: ${result.stderr}`);
  return JSON.parse(result.stdout) as ImportSuccess;
}

function parseInspectSuccess(result: ChildProcessResult): InspectSuccess {
  assert(result.status === 0, `Inspection failed: ${result.stderr}`);
  assert(result.stderr === "", "Successful inspection wrote to stderr");
  const output = JSON.parse(result.stdout) as InspectSuccess;
  assertProcessResult(result, 0, `${JSON.stringify(output)}\n`, "");
  return output;
}

function assertFolder(
  folder: InspectFolder,
  title: string,
  bookmarkCount: number,
  childTitles: readonly string[],
): void {
  assert(folder.id.startsWith("bookmark:"), `${title} has an invalid ID`);
  assertEqual(folder.title, title, "Wrong folder title");
  assertEqual(folder.bookmarkCount, bookmarkCount, `${title} count changed`);
  assertEqual(
    folder.children.map((child) => child.title).join("|"),
    childTitles.join("|"),
    `${title} child order changed`,
  );
  assertEqual(
    Object.keys(folder).join("|"),
    "id|title|bookmarkCount|children",
    `${title} exposed an extra field`,
  );
}

test("package inspect command returns the ordered folder-only hierarchy", () => {
  assertEqual(
    packageJson.scripts.inspect,
    "node apps/local-cli/main.ts inspect",
    "Package inspect script changed",
  );
  const temporary = createTemporaryDatabase("bookmark-clean-cli-inspect-");
  try {
    const imported = importFixture(temporary);
    const output = parseInspectSuccess(
      runInspect([
        "--snapshot",
        imported.snapshotId,
        "--database",
        temporary.databasePath,
      ]),
    );

    assertEqual(output.snapshotId, imported.snapshotId, "Snapshot ID changed");
    assert(typeof output.capturedAt === "string", "Capture time is missing");
    assertEqual(output.rootCount, 1, "Root count changed");
    assertEqual(output.folderCount, 5, "Folder count changed");
    assertEqual(output.bookmarkCount, 7, "Bookmark count changed");
    assertEqual(output.folders.length, 1, "Root folder was lost");
    assertEqual(
      Object.keys(output).join("|"),
      "ok|snapshotId|capturedAt|rootCount|folderCount|bookmarkCount|folders",
      "Success output shape changed",
    );

    const root = output.folders[0];
    assertFolder(root, "Bookmarks Bar", 7, ["Projects & Notes", "No Dates & Folder"]);
    const projects = root.children[0];
    assertFolder(projects, "Projects & Notes", 4, ["Empty Folder", "Special Links"]);
    assertFolder(projects.children[0], "Empty Folder", 0, []);
    assertFolder(projects.children[1], "Special Links", 3, []);
    assertFolder(root.children[1], "No Dates & Folder", 1, []);

    const serialized = JSON.stringify(output);
    for (const forbidden of [
      "url",
      "sourceId",
      "Same Title",
      "Shared Link",
      "https://",
      "file:///",
      "chrome://",
    ]) {
      assert(!serialized.includes(forbidden), `Inspection exposed ${forbidden}`);
    }
  } finally {
    temporary.cleanup();
  }
});

test("inspect rejects invalid argument shapes", () => {
  for (const arguments_ of [
    [],
    ["--database", "file.sqlite"],
    ["--database", "", "--snapshot", "snapshot:any"],
    ["--database", "file.sqlite", "--database", "other.sqlite"],
    ["--database", "file.sqlite", "--snapshot", "snapshot:any", "extra"],
  ]) {
    assertProcessResult(
      runInspect(arguments_),
      2,
      "",
      '{"ok":false,"code":"invalid_arguments"}\n',
    );
  }
});

test("inspect reports unavailable storage", () => {
  const temporary = createTemporaryDatabase("bookmark-clean-cli-inspect-storage-");
  try {
    assertProcessResult(
      runInspect(["--database", temporary.directory, "--snapshot", "snapshot:any"]),
      4,
      "",
      '{"ok":false,"code":"storage_unavailable"}\n',
    );
  } finally {
    temporary.cleanup();
  }
});

test("inspect reports a missing snapshot", () => {
  const temporary = createTemporaryDatabase("bookmark-clean-cli-inspect-missing-");
  try {
    assertProcessResult(
      runInspect([
        "--database",
        temporary.databasePath,
        "--snapshot",
        "snapshot:missing",
      ]),
      6,
      "",
      '{"ok":false,"code":"snapshot_not_found"}\n',
    );
  } finally {
    temporary.cleanup();
  }
});

test("inspect reports an invalid stored snapshot without diagnostics", () => {
  const temporary = createTemporaryDatabase("bookmark-clean-cli-inspect-invalid-");
  try {
    const imported = importFixture(temporary);
    const database = new DatabaseSync(temporary.databasePath);
    try {
      database
        .prepare("UPDATE catalog_snapshots SET folder_count = folder_count + 1 WHERE id = ?")
        .run(imported.snapshotId);
    } finally {
      database.close();
    }

    assertProcessResult(
      runInspect([
        "--database",
        temporary.databasePath,
        "--snapshot",
        imported.snapshotId,
      ]),
      5,
      "",
      '{"ok":false,"code":"snapshot_invalid"}\n',
    );
  } finally {
    temporary.cleanup();
  }
});

void (null as unknown as InspectCommandResult);
void (null as unknown as RunInspectCommand);
