import type {
  BookmarkCatalog,
  BookmarkFolderRecord,
  BookmarkLinkRecord,
  BookmarkSnapshot,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type {
  ProcessingPlanner,
  ProcessingPreview,
  ProcessingPreviewFailure,
  ProcessingPreviewRequest,
} from "../../modules/processing/public.js";
import type {
  BookmarkId,
  IsoDateTime,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface ProcessingRuntime {
  createProcessingPlanner(catalog: BookmarkCatalog): ProcessingPlanner;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const publicRuntime = loadModule(
  "../../modules/processing/public.ts",
) as ProcessingRuntime;
const { createProcessingPlanner } = publicRuntime;

const SNAPSHOT_ID = "snapshot:processing" as SnapshotId;
const CAPTURED_AT = "2026-07-14T00:00:00.000Z" as IsoDateTime;

function bookmark(id: string): BookmarkLinkRecord {
  return {
    kind: "bookmark",
    id: id as BookmarkId,
    get sourceId(): string {
      throw new Error("Processing read bookmark sourceId");
    },
    get title(): string {
      throw new Error("Processing read bookmark title");
    },
    get url(): string {
      throw new Error("Processing read bookmark URL");
    },
  };
}

function folder(
  id: string,
  title: string,
  children: readonly (BookmarkFolderRecord | BookmarkLinkRecord)[],
): BookmarkFolderRecord {
  return {
    kind: "folder",
    id: id as BookmarkId,
    sourceId: `source:${id}`,
    title,
    children,
  };
}

function snapshot(): BookmarkSnapshot {
  return {
    id: SNAPSHOT_ID,
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [
      folder("bookmark:root", "Root", [
        bookmark("bookmark:direct"),
        folder("bookmark:nested", "Nested", [
          bookmark("bookmark:nested-one"),
          folder("bookmark:empty", "Empty", []),
          bookmark("bookmark:nested-two"),
        ]),
      ]),
    ],
    rootCount: 1,
    folderCount: 3,
    bookmarkCount: 3,
  };
}

function request(folderId = "bookmark:root"): ProcessingPreviewRequest {
  return {
    snapshotId: SNAPSHOT_ID,
    folderId: folderId as BookmarkId,
    profileId: "health_check_v1",
  };
}

function catalogReturning(
  outcome: Outcome<BookmarkSnapshot | null, CatalogStorageFailure>,
  onRead: () => void = () => undefined,
): BookmarkCatalog {
  return {
    async importSnapshot() {
      throw new Error("Import must not run during preview");
    },
    async getSnapshot() {
      onRead();
      return outcome;
    },
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message}: ${String(actual)}`);
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string): void {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

async function preview(
  planner: ProcessingPlanner,
  input: ProcessingPreviewRequest = request(),
): Promise<Outcome<ProcessingPreview, ProcessingPreviewFailure>> {
  return planner.preview(input);
}

test("public Processing runtime exposes only its planner factory", () => {
  assertJsonEqual(Object.keys(publicRuntime), ["createProcessingPlanner"], "Runtime exports changed");
});

test("root and nested previews return exact bounded health work", async () => {
  const source = snapshot();
  const roots = source.roots;
  const rootFolder = roots[0] as BookmarkFolderRecord;
  const rootChildren = rootFolder.children;
  const planner = createProcessingPlanner(
    catalogReturning({ ok: true, value: source }),
  );

  const root = await preview(planner);
  assert(root.ok, "Root preview failed");
  assertJsonEqual(root.value, {
    snapshotId: SNAPSHOT_ID,
    folderId: "bookmark:root",
    folderTitle: "Root",
    profile: {
      id: "health_check_v1",
      jobType: "health_check",
      maximumJobAttempts: 1,
      maximumNetworkRequestsPerJob: 6,
      maximumModelCallsPerJob: 0,
    },
    bookmarkCount: 3,
    jobCount: 3,
    maximumNetworkRequests: 18,
    maximumModelCalls: 0,
  }, "Root preview changed");

  const nested = await preview(planner, request("bookmark:nested"));
  assert(nested.ok, "Nested preview failed");
  assertEqual(nested.value.bookmarkCount, 2, "Nested count changed");
  assertEqual(nested.value.maximumNetworkRequests, 12, "Nested budget changed");

  const empty = await preview(planner, request("bookmark:empty"));
  assert(empty.ok, "Empty preview failed");
  assertEqual(empty.value.jobCount, 0, "Empty folder created work");
  assertEqual(empty.value.maximumNetworkRequests, 0, "Empty budget changed");
  assert(source.roots === roots, "Preview replaced snapshot roots");
  assert(rootFolder.children === rootChildren, "Preview replaced folder children");
  assertEqual(rootFolder.title, "Root", "Preview changed the folder title");
});

test("invalid requests stop before Catalog", async () => {
  let reads = 0;
  const planner = createProcessingPlanner(
    catalogReturning({ ok: true, value: snapshot() }, () => { reads += 1; }),
  );
  for (const input of [
    { ...request(), snapshotId: "" as SnapshotId },
    { ...request(), folderId: "" as BookmarkId },
    { ...request(), profileId: "unknown" as never },
  ]) {
    const result = await preview(planner, input);
    assert(!result.ok, "Invalid request passed");
    assertEqual(result.error.code, "invalid_request", "Wrong invalid failure");
  }
  assertEqual(reads, 0, "Invalid request reached Catalog");
});

test("missing snapshots folders and bookmark IDs stay distinct", async () => {
  const missingSnapshot = await preview(
    createProcessingPlanner(catalogReturning({ ok: true, value: null })),
  );
  assert(!missingSnapshot.ok, "Missing snapshot passed");
  assertEqual(missingSnapshot.error.code, "snapshot_not_found", "Wrong snapshot failure");

  const planner = createProcessingPlanner(
    catalogReturning({ ok: true, value: snapshot() }),
  );
  for (const id of ["bookmark:missing", "bookmark:direct"]) {
    const result = await preview(planner, request(id));
    assert(!result.ok, `${id} selected a folder`);
    assertEqual(result.error.code, "folder_not_found", "Wrong folder failure");
  }
});

test("typed Catalog read failures map without diagnostics", async () => {
  for (const [failure, expected] of [
    [{ code: "storage_unavailable", diagnostic: "private" }, "catalog_unavailable"],
    [{ code: "stored_snapshot_invalid", diagnostic: "private" }, "snapshot_invalid"],
  ] as const) {
    const result = await preview(
      createProcessingPlanner(catalogReturning({ ok: false, error: failure })),
    );
    assert(!result.ok, "Catalog failure passed");
    assertJsonEqual(result.error, { code: expected }, "Catalog failure leaked fields");
  }
});

void (null as unknown as ProcessingPreviewRequest);
