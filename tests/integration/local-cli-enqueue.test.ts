import type { EnqueueCommandSuccess } from "../../apps/local-cli/enqueue-command.js";

interface NodeTestApi {
  test(name: string, callback: () => void): void;
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

interface PathApi {
  join(...parts: string[]): string;
}

interface ProcessApi {
  readonly execPath: string;
  cwd(): string;
}

interface TemporaryDatabase {
  readonly databasePath: string;
  cleanup(): void;
}

interface TemporaryDatabaseApi {
  createTemporaryDatabase(prefix?: string): TemporaryDatabase;
}

interface PackageJson {
  readonly scripts: Record<string, string>;
}

interface ImportSuccess {
  readonly snapshotId: string;
}

interface InspectFolder {
  readonly id: string;
  readonly title: string;
  readonly children: readonly InspectFolder[];
}

interface InspectSuccess {
  readonly folders: readonly InspectFolder[];
}

declare const require: (specifier: string) => unknown;

const load = require as unknown as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const { spawnSync } = load("node:child_process") as ChildProcessApi;
const { join } = load("node:path") as PathApi;
const processApi = load("node:process") as ProcessApi;
const packageJson = load("../../package.json") as PackageJson;
const { createTemporaryDatabase } = load(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;

const REPOSITORY = processApi.cwd();
const ENTRY_POINT = "apps/local-cli/main.ts";
const FIXTURE = join(
  REPOSITORY,
  "tests/fixtures/chrome-bookmarks/edge-cases.html",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message}: ${String(actual)}`);
}

function run(arguments_: readonly string[]): ChildProcessResult {
  return spawnSync(processApi.execPath, [ENTRY_POINT, ...arguments_], {
    cwd: REPOSITORY,
    encoding: "utf8",
  });
}

function importAndInspect(databasePath: string): {
  readonly snapshotId: string;
  readonly folderId: string;
} {
  const imported = run(["--input", FIXTURE, "--database", databasePath]);
  assert(imported.status === 0, `Fixture import failed: ${imported.stderr}`);
  const snapshotId = (JSON.parse(imported.stdout) as ImportSuccess).snapshotId;
  const inspected = run(["inspect", "--database", databasePath, "--snapshot", snapshotId]);
  assert(inspected.status === 0, `Fixture inspection failed: ${inspected.stderr}`);
  const root = (JSON.parse(inspected.stdout) as InspectSuccess).folders[0];
  const folder = root?.children.find((candidate) => candidate.title === "Projects & Notes");
  assert(folder !== undefined, "Fixture inspection omitted the selected folder");
  return { snapshotId, folderId: folder.id };
}

function enqueueArguments(
  databasePath: string,
  snapshotId: string,
  folderId: string,
): readonly string[] {
  return [
    "enqueue",
    "--folder", folderId,
    "--run", "run:package-command",
    "--snapshot", snapshotId,
    "--database", databasePath,
  ];
}

test("package enqueue command persists and exactly replays one selected batch", () => {
  equal(
    packageJson.scripts.enqueue,
    "node apps/local-cli/main.ts enqueue",
    "Package enqueue script changed",
  );
  const temporary = createTemporaryDatabase("bookmark-clean-cli-enqueue-");
  try {
    const selected = importAndInspect(temporary.databasePath);
    const arguments_ = enqueueArguments(
      temporary.databasePath,
      selected.snapshotId,
      selected.folderId,
    );

    const first = run(arguments_);
    equal(first.status, 0, "Initial enqueue exit changed");
    equal(first.stderr, "", "Initial enqueue wrote to stderr");
    const output = JSON.parse(first.stdout) as EnqueueCommandSuccess;
    equal(first.stdout, `${JSON.stringify(output)}\n`, "Initial enqueue output changed");
    equal(output.ok, true, "Initial enqueue did not report success");
    equal(output.runId, "run:package-command", "Run ID changed");
    equal(output.preview.snapshotId, selected.snapshotId, "Snapshot ID changed");
    equal(output.preview.folderId, selected.folderId, "Folder ID changed");
    equal(output.preview.bookmarkCount, 4, "Preview bookmark count changed");
    equal(output.preview.jobCount, 4, "Preview job count changed");
    equal(output.batch.state, "active", "Batch state changed");
    equal(output.batch.totalCount, 4, "Batch total changed");
    equal(
      Object.keys(output).join("|"),
      "ok|runId|preview|batch",
      "Success output shape changed",
    );
    const serialized = JSON.stringify(output);
    for (const forbidden of ["https://", "sourceId", "Same Title", "diagnostic"]) {
      assert(!serialized.includes(forbidden), `Enqueue output exposed ${forbidden}`);
    }

    const replayed = run(arguments_);
    equal(replayed.status, 0, "Replay exit changed");
    equal(replayed.stdout, first.stdout, "Replay output changed");
    equal(replayed.stderr, "", "Replay wrote to stderr");
  } finally {
    temporary.cleanup();
  }
});

test("package enqueue command writes invalid arguments only to stderr", () => {
  const result = run(["enqueue", "--database", "db"]);
  equal(result.status, 2, "Invalid enqueue exit changed");
  equal(result.stdout, "", "Invalid enqueue wrote to stdout");
  equal(
    result.stderr,
    '{"ok":false,"code":"invalid_arguments"}\n',
    "Invalid enqueue failure changed",
  );
});
