import type { RunOneCommandSuccess } from "../../apps/local-cli/run-one-command.js";

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
interface PathApi { join(...parts: string[]): string; }
interface ProcessApi { readonly execPath: string; cwd(): string; }
interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
  cleanup(): void;
}
interface TemporaryDatabaseApi {
  createTemporaryDatabase(prefix?: string): TemporaryDatabase;
}
interface FixtureRequest { readonly url?: string; }
interface FixtureResponse { writeHead(statusCode: number): void; end(body?: string): void; }
interface ListenerFixture { readonly port: number; close(): Promise<void>; }
interface FixtureApi {
  startHttpFixture(
    handler: (request: FixtureRequest, response: FixtureResponse) => void,
  ): Promise<ListenerFixture>;
}
interface PackageJson { readonly scripts: Record<string, string>; }
interface ImportSuccess { readonly ok: true; readonly snapshotId: string; }
interface InspectFolder { readonly id: string; readonly children: readonly InspectFolder[]; }
interface InspectSuccess { readonly ok: true; readonly folders: readonly InspectFolder[]; }
interface EnqueueSuccess { readonly ok: true; readonly batch: { readonly batchId: string }; }

declare const require: (specifier: string) => unknown;
const load = require as unknown as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const { spawnSync } = load("node:child_process") as ChildProcessApi;
const { writeFileSync } = load("node:fs") as FileSystemApi;
const { join } = load("node:path") as PathApi;
const processApi = load("node:process") as ProcessApi;
const packageJson = load("../../package.json") as PackageJson;
const { createTemporaryDatabase } = load(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const { startHttpFixture } = load(
  "../helpers/health-transport-fixture.ts",
) as FixtureApi;

const REPOSITORY = processApi.cwd();
const ENTRY_POINT = "apps/local-cli/main.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function runCli(arguments_: readonly string[]): ChildProcessResult {
  return spawnSync(processApi.execPath, [ENTRY_POINT, ...arguments_], {
    cwd: REPOSITORY,
    encoding: "utf8",
  });
}

function runWorker(arguments_: readonly string[]): ChildProcessResult {
  return spawnSync("npm", ["run", "--silent", "worker:once", "--", ...arguments_], {
    cwd: REPOSITORY,
    encoding: "utf8",
  });
}

function parseSuccess<Success>(result: ChildProcessResult, label: string): Success {
  assert(result.status === 0, `${label} failed: ${result.stderr}`);
  assert(result.stderr === "", `${label} wrote to stderr`);
  const output = JSON.parse(result.stdout) as Success;
  assert(result.stdout === `${JSON.stringify(output)}\n`, `${label} output was not one JSON line`);
  return output;
}

function bookmarksHtml(port: number): string {
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<DL><p>
  <DT><H3 ADD_DATE="1700000000">Package worker proof</H3>
  <DL><p>
    <DT><A HREF="http://127.0.0.1:${port}/must-not-run" ADD_DATE="1700000001">Blocked target</A>
  </DL><p>
</DL><p>`;
}

function waitForListenerCallbacks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

test("package worker command rejects malformed arguments on stderr", () => {
  equal(
    packageJson.scripts["worker:once"],
    "node apps/local-cli/main.ts worker:once",
    "Package worker script changed",
  );
  const result = runWorker(["--database", ""]);
  equal(result.status, 2, "Malformed worker exit changed");
  equal(result.stdout, "", "Malformed worker invocation wrote to stdout");
  equal(
    result.stderr,
    '{"ok":false,"code":"invalid_arguments"}\n',
    "Malformed worker failure changed",
  );
});

test("package workflow completes one queued bookmark and then returns idle", async () => {
  let requests = 0;
  const listener = await startHttpFixture((_request, response) => {
    requests += 1;
    response.writeHead(200);
    response.end("request safety failed");
  });
  const temporary = createTemporaryDatabase("bookmark-clean-cli-worker-");
  try {
    const inputPath = join(temporary.directory, "one-bookmark.html");
    writeFileSync(inputPath, bookmarksHtml(listener.port), "utf8");

    const imported = parseSuccess<ImportSuccess>(runCli([
      "--input", inputPath,
      "--database", temporary.databasePath,
    ]), "Import");
    const inspected = parseSuccess<InspectSuccess>(runCli([
      "inspect",
      "--database", temporary.databasePath,
      "--snapshot", imported.snapshotId,
    ]), "Inspect");
    const folder = inspected.folders[0];
    assert(folder !== undefined, "Inspection returned no selectable folder");
    const enqueued = parseSuccess<EnqueueSuccess>(runCli([
      "enqueue",
      "--database", temporary.databasePath,
      "--snapshot", imported.snapshotId,
      "--folder", folder.id,
      "--run", "run:package-worker-proof",
    ]), "Enqueue");

    const firstProcess = runWorker(["--database", temporary.databasePath]);
    const first = parseSuccess<RunOneCommandSuccess>(firstProcess, "First worker");
    assert(first.status === "succeeded", "First worker did not succeed");
    assert(first.batchId === enqueued.batch.batchId, "Worker batch changed");
    assert(first.result.kind === "health_observation", "Health reference changed");
    equal(
      Object.keys(first),
      ["ok", "status", "jobId", "batchId", "result"],
      "Worker success exposed extra fields",
    );

    const secondProcess = runWorker(["--database", temporary.databasePath]);
    equal(secondProcess.status, 0, "Idle worker exit changed");
    equal(secondProcess.stderr, "", "Idle worker wrote to stderr");
    equal(
      secondProcess.stdout,
      '{"ok":true,"status":"idle"}\n',
      "Idle worker output changed",
    );

    await waitForListenerCallbacks();
    assert(requests === 0, "Package workflow reached the loopback listener");
  } finally {
    temporary.cleanup();
    await listener.close();
  }
});
