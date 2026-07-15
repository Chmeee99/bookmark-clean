import type {
  BookmarkCatalog,
  BookmarkFolderRecord,
  BookmarkSnapshotInput,
  CatalogServiceDependencies,
} from "../../modules/catalog/public.js";
import type {
  EnqueueCommandResult,
  RunEnqueueCommand,
} from "../../apps/local-cli/enqueue-command.js";
import type {
  BookmarkCleanDatabaseFailure,
  BookmarkCleanDatabaseSession,
} from "../../adapters/sqlite/public.js";
import type {
  IsoDateTime,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface TemporaryDatabase {
  readonly directory: string;
  readonly databasePath: string;
}

interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: TemporaryDatabase) => T | PromiseLike<T>,
  ): Promise<T>;
}

interface CatalogRuntime {
  createBookmarkCatalog(dependencies: CatalogServiceDependencies): BookmarkCatalog;
  createCryptoCatalogIdFactory(): CatalogServiceDependencies["idFactory"];
}

interface SqliteRuntime {
  openBookmarkCleanDatabase(
    databasePath: string,
  ): Outcome<BookmarkCleanDatabaseSession, BookmarkCleanDatabaseFailure>;
}

interface EnqueueRuntime {
  runEnqueueCommand: RunEnqueueCommand;
}

declare const require: (specifier: string) => unknown;

const load = require as unknown as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const { withTemporaryDatabase } = load(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const {
  createBookmarkCatalog,
  createCryptoCatalogIdFactory,
} = load("../../modules/catalog/public.ts") as CatalogRuntime;
const { openBookmarkCleanDatabase } = load(
  "../../adapters/sqlite/public.ts",
) as SqliteRuntime;
const { runEnqueueCommand } = load(
  "../../apps/local-cli/enqueue-command.ts",
) as EnqueueRuntime;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function commandArguments(
  databasePath: string,
  snapshotId: string,
  folderId: string,
  runId = "run:local-command",
): readonly string[] {
  return [
    "--run", runId,
    "--folder", folderId,
    "--database", databasePath,
    "--snapshot", snapshotId,
  ];
}

function snapshot(children: BookmarkSnapshotInput["roots"]): BookmarkSnapshotInput {
  return {
    source: "chrome_html",
    capturedAt: "2026-07-15T13:00:00.000Z" as IsoDateTime,
    roots: [{ kind: "folder", sourceId: "root", title: "Root", children }],
  };
}

async function seed(
  databasePath: string,
  children: BookmarkSnapshotInput["roots"],
): Promise<{ readonly snapshotId: SnapshotId; readonly folderId: string }> {
  const opened = openBookmarkCleanDatabase(databasePath);
  assert(opened.ok, "Seed database did not open");
  try {
    const catalog = createBookmarkCatalog({
      idFactory: createCryptoCatalogIdFactory(),
      store: opened.value.catalogStore,
    });
    const imported = await catalog.importSnapshot(snapshot(children));
    assert(imported.ok, "Seed snapshot did not import");
    const loaded = await catalog.getSnapshot(imported.value.snapshotId);
    assert(loaded.ok && loaded.value !== null, "Seed snapshot did not load");
    const root = loaded.value.roots[0];
    assert(root?.kind === "folder", "Seed root was not a folder");
    return {
      snapshotId: imported.value.snapshotId,
      folderId: (root as BookmarkFolderRecord).id,
    };
  } finally {
    opened.value.close();
  }
}

function assertReopens(databasePath: string): void {
  const reopened = openBookmarkCleanDatabase(databasePath);
  assert(reopened.ok, "Command left the application database open");
  reopened.value.close();
}

test("direct enqueue command persists one batch and replays the exact result", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const selected = await seed(databasePath, [
      {
        kind: "bookmark",
        sourceId: "first",
        title: "Private first title",
        url: "https://example.com/private-first",
      },
      {
        kind: "bookmark",
        sourceId: "second",
        title: "Private second title",
        url: "https://example.com/private-second",
      },
    ]);
    const arguments_ = commandArguments(
      databasePath,
      selected.snapshotId,
      selected.folderId,
    );

    const first = await runEnqueueCommand(arguments_);
    assert(first.exitCode === 0, "Initial command did not succeed");
    assert(first.output.ok, "Initial command returned a failure payload");
    assert(first.output.runId === "run:local-command", "Run ID changed");
    assert(first.output.preview.bookmarkCount === 2, "Preview count changed");
    assert(first.output.batch.totalCount === 2, "Batch total changed");
    const serialized = JSON.stringify(first.output);
    assert(!serialized.includes("https://"), "Success leaked a bookmark URL");
    assert(!serialized.includes("Private"), "Success leaked a bookmark title");
    assertReopens(databasePath);

    const replayed = await runEnqueueCommand(arguments_);
    assertJsonEqual(replayed, first, "Replay did not return the exact original result");
    assertReopens(databasePath);
  });
});

test("direct enqueue command rejects malformed flags before opening storage", async () => {
  await withTemporaryDatabase(async ({ directory }) => {
    const invalidArguments = [
      [],
      ["--database", directory, "--snapshot", "snapshot", "--folder", "folder"],
      ["--database", directory, "--snapshot", "snapshot", "--folder", "folder", "--run", ""],
      ["--database", directory, "--snapshot", "snapshot", "--folder", "folder", "--folder", "other"],
      ["--database", directory, "--snapshot", "snapshot", "--folder", "folder", "--unknown", "run"],
    ];

    for (const arguments_ of invalidArguments) {
      const result = await runEnqueueCommand(arguments_);
      assertJsonEqual(
        result,
        { exitCode: 2, output: { ok: false, code: "invalid_arguments" } },
        "Malformed arguments did not return the fixed failure",
      );
    }
  });
});

test("direct enqueue command maps real storage and selection failures", async () => {
  await withTemporaryDatabase(async ({ directory, databasePath }) => {
    const storageFailure = await runEnqueueCommand(
      commandArguments(directory, "snapshot", "folder"),
    );
    assertJsonEqual(
      storageFailure,
      { exitCode: 4, output: { ok: false, code: "storage_unavailable" } },
      "Unavailable storage mapping changed",
    );

    const missingSnapshot = await runEnqueueCommand(
      commandArguments(databasePath, "missing", "folder"),
    );
    assertJsonEqual(
      missingSnapshot,
      { exitCode: 6, output: { ok: false, code: "snapshot_not_found" } },
      "Missing snapshot mapping changed",
    );
    assertReopens(databasePath);

    const populated = await seed(databasePath, [{
      kind: "bookmark",
      sourceId: "bookmark",
      title: "Bookmark",
      url: "https://example.com/bookmark",
    }]);
    const missingFolder = await runEnqueueCommand(
      commandArguments(databasePath, populated.snapshotId, "missing"),
    );
    assertJsonEqual(
      missingFolder,
      { exitCode: 7, output: { ok: false, code: "folder_not_found" } },
      "Missing folder mapping changed",
    );
    assertReopens(databasePath);

    const empty = await seed(databasePath, []);
    const emptySelection = await runEnqueueCommand(
      commandArguments(databasePath, empty.snapshotId, empty.folderId),
    );
    assertJsonEqual(
      emptySelection,
      { exitCode: 9, output: { ok: false, code: "empty_selection" } },
      "Empty selection mapping changed",
    );
    assertReopens(databasePath);
  });
});

const resultContract: EnqueueCommandResult | undefined = undefined;
void resultContract;
