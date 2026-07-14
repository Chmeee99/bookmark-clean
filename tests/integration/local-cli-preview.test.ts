import type {
  PreviewCommandResult,
  RunPreviewCommand,
} from "../../apps/local-cli/preview-command.js";

interface NodeTestApi { test(name: string, callback: () => void): void }
interface ChildResult { readonly status: number | null; readonly stdout: string; readonly stderr: string }
interface ChildApi {
  spawnSync(command: string, args: readonly string[], options: {
    readonly cwd: string;
    readonly encoding: "utf8";
  }): ChildResult;
}
interface ProcessApi { readonly execPath: string; cwd(): string }
interface PathApi { join(...parts: string[]): string }
interface TempDatabase { readonly directory: string; readonly databasePath: string; cleanup(): void }
interface TempApi { createTemporaryDatabase(prefix?: string): TempDatabase }
interface PackageJson { readonly scripts: Record<string, string> }
interface SqliteStatement { run(...parameters: unknown[]): unknown }
interface SqliteDatabase { prepare(sql: string): SqliteStatement; close(): void }
interface SqliteApi { DatabaseSync: new (path: string) => SqliteDatabase }

declare const require: (specifier: string) => unknown;
const load = require as unknown as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const { spawnSync } = load("node:child_process") as ChildApi;
const processApi = load("node:process") as ProcessApi;
const { join } = load("node:path") as PathApi;
const packageJson = load("../../package.json") as PackageJson;
const { DatabaseSync } = load("node:sqlite") as SqliteApi;
const { createTemporaryDatabase } = load("../helpers/temporary-database.ts") as TempApi;

const REPOSITORY = processApi.cwd();
const ENTRY = "apps/local-cli/main.ts";
const FIXTURE = join(REPOSITORY, "tests/fixtures/chrome-bookmarks/edge-cases.html");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message}: ${String(actual)}`);
}

function run(args: readonly string[]): ChildResult {
  return spawnSync(processApi.execPath, [ENTRY, ...args], {
    cwd: REPOSITORY,
    encoding: "utf8",
  });
}

function runPreview(args: readonly string[]): ChildResult {
  return run(["preview", ...args]);
}

function expect(result: ChildResult, status: number, stdout: string, stderr: string): void {
  equal(result.status, status, "Wrong exit");
  equal(result.stdout, stdout, "Wrong stdout");
  equal(result.stderr, stderr, "Wrong stderr");
}

function importAndInspect(temporary: TempDatabase): {
  readonly snapshotId: string;
  readonly nestedFolderId: string;
} {
  const imported = run(["--input", FIXTURE, "--database", temporary.databasePath]);
  assert(imported.status === 0, `Import failed: ${imported.stderr}`);
  const snapshotId = (JSON.parse(imported.stdout) as { snapshotId: string }).snapshotId;
  const inspected = run([
    "inspect",
    "--database",
    temporary.databasePath,
    "--snapshot",
    snapshotId,
  ]);
  assert(inspected.status === 0, `Inspect failed: ${inspected.stderr}`);
  const folders = (JSON.parse(inspected.stdout) as {
    folders: readonly { children: readonly { id: string; title: string }[] }[];
  }).folders;
  const nested = folders[0]?.children.find((folder) => folder.title === "Projects & Notes");
  assert(nested !== undefined, "Inspect did not return the nested folder");
  return { snapshotId, nestedFolderId: nested.id };
}

test("package preview command uses a folder returned by inspect", () => {
  equal(packageJson.scripts.preview, "node apps/local-cli/main.ts preview", "Preview script changed");
  const temporary = createTemporaryDatabase("bookmark-clean-cli-preview-");
  try {
    const ids = importAndInspect(temporary);
    const result = runPreview([
      "--folder",
      ids.nestedFolderId,
      "--snapshot",
      ids.snapshotId,
      "--database",
      temporary.databasePath,
    ]);
    assert(result.status === 0, `Preview failed: ${result.stderr}`);
    const output = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(result, 0, `${JSON.stringify(output)}\n`, "");
    equal(output.snapshotId, ids.snapshotId, "Snapshot changed");
    equal(output.folderId, ids.nestedFolderId, "Folder changed");
    equal(output.folderTitle, "Projects & Notes", "Folder title changed");
    equal(output.bookmarkCount, 4, "Bookmark count changed");
    equal(output.jobCount, 4, "Job count changed");
    equal(output.maximumNetworkRequests, 24, "Network budget changed");
    equal(output.maximumModelCalls, 0, "Model budget changed");
    equal(
      JSON.stringify(output.profile),
      JSON.stringify({
        id: "health_check_v1",
        jobType: "health_check",
        maximumJobAttempts: 1,
        maximumNetworkRequestsPerJob: 6,
        maximumModelCallsPerJob: 0,
      }),
      "Profile changed",
    );
    const serialized = JSON.stringify(output);
    for (const forbidden of ["url", "sourceId", "Same Title", "https://", "diagnostic"]) {
      assert(!serialized.includes(forbidden), `Preview exposed ${forbidden}`);
    }
  } finally {
    temporary.cleanup();
  }
});

test("preview rejects invalid arguments", () => {
  for (const args of [
    [],
    ["--database", "db", "--snapshot", "snapshot:x"],
    ["--database", "db", "--snapshot", "snapshot:x", "--folder", ""],
    ["--database", "db", "--snapshot", "snapshot:x", "--database", "other"],
  ]) {
    expect(runPreview(args), 2, "", '{"ok":false,"code":"invalid_arguments"}\n');
  }
});

test("preview maps storage and missing targets", () => {
  const temporary = createTemporaryDatabase("bookmark-clean-cli-preview-failures-");
  try {
    expect(
      runPreview(["--database", temporary.directory, "--snapshot", "snapshot:x", "--folder", "bookmark:x"]),
      4, "", '{"ok":false,"code":"storage_unavailable"}\n',
    );
    expect(
      runPreview(["--database", temporary.databasePath, "--snapshot", "snapshot:x", "--folder", "bookmark:x"]),
      6, "", '{"ok":false,"code":"snapshot_not_found"}\n',
    );
    const ids = importAndInspect(temporary);
    expect(
      runPreview(["--database", temporary.databasePath, "--snapshot", ids.snapshotId, "--folder", "bookmark:missing"]),
      7, "", '{"ok":false,"code":"folder_not_found"}\n',
    );
  } finally {
    temporary.cleanup();
  }
});

test("preview maps invalid stored snapshots without diagnostics", () => {
  const temporary = createTemporaryDatabase("bookmark-clean-cli-preview-invalid-");
  try {
    const ids = importAndInspect(temporary);
    const database = new DatabaseSync(temporary.databasePath);
    try {
      database.prepare("UPDATE catalog_snapshots SET folder_count = folder_count + 1 WHERE id = ?").run(ids.snapshotId);
    } finally {
      database.close();
    }
    expect(
      runPreview(["--database", temporary.databasePath, "--snapshot", ids.snapshotId, "--folder", ids.nestedFolderId]),
      5, "", '{"ok":false,"code":"snapshot_invalid"}\n',
    );
  } finally {
    temporary.cleanup();
  }
});

void (null as unknown as PreviewCommandResult);
void (null as unknown as RunPreviewCommand);
