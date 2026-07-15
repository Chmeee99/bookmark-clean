import type {
  BookmarkCatalog,
  BookmarkLinkRecord,
  BookmarkSnapshot,
  BookmarkSnapshotInput,
  CatalogIdFactory,
  CatalogSnapshotStore,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type {
  BookmarkId,
  IsoDateTime,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface FakePorts {
  readonly catalog: BookmarkCatalog;
  readonly events: string[];
  readonly saved: BookmarkSnapshot[];
  readonly loadCalls: SnapshotId[];
  readonly bookmarkLoadCalls: BookmarkId[];
}

declare const require: (specifier: string) => unknown;

const { test } = require("node:test") as NodeTestApi;
const { createBookmarkCatalog } = require(
  "../../modules/catalog/catalog-service.ts",
) as {
  createBookmarkCatalog(dependencies: {
    readonly idFactory: CatalogIdFactory;
    readonly store: CatalogSnapshotStore;
  }): BookmarkCatalog;
};
const CAPTURED_AT = "2026-07-13T12:00:00.000Z" as IsoDateTime;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
  );
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error(message);
  }
}

function makePorts(
  saveResult: Outcome<void, CatalogStorageFailure> = { ok: true, value: undefined },
  loadResult: Outcome<BookmarkSnapshot | null, CatalogStorageFailure> = {
    ok: true,
    value: null,
  },
  bookmarkLoadResult: Outcome<BookmarkLinkRecord | null, CatalogStorageFailure> = {
    ok: true,
    value: null,
  },
): FakePorts {
  const events: string[] = [];
  const saved: BookmarkSnapshot[] = [];
  const loadCalls: SnapshotId[] = [];
  const bookmarkLoadCalls: BookmarkId[] = [];
  let snapshotSequence = 0;
  let bookmarkSequence = 0;
  const idFactory: CatalogIdFactory = {
    nextSnapshotId: () => {
      const id = `snapshot-${++snapshotSequence}` as SnapshotId;
      events.push(`snapshot:${id}`);
      return id;
    },
    nextBookmarkId: () => {
      const id = `bookmark-${++bookmarkSequence}` as BookmarkId;
      events.push(`bookmark:${id}`);
      return id;
    },
  };
  const store: CatalogSnapshotStore = {
    save: async (snapshot) => {
      events.push("save");
      saved.push(snapshot);
      return saveResult;
    },
    load: async (id) => {
      events.push("load");
      loadCalls.push(id);
      return loadResult;
    },
    loadBookmark: async (id) => {
      events.push("loadBookmark");
      bookmarkLoadCalls.push(id);
      return bookmarkLoadResult;
    },
  };
  return {
    catalog: createBookmarkCatalog({ idFactory, store }),
    events,
    saved,
    loadCalls,
    bookmarkLoadCalls,
  };
}

function emptyInput(): BookmarkSnapshotInput {
  return { source: "chrome_html", capturedAt: CAPTURED_AT, roots: [] };
}

function nestedInput(): BookmarkSnapshotInput {
  return {
    source: "chrome_api",
    capturedAt: CAPTURED_AT,
    roots: [{
      kind: "folder",
      sourceId: "root",
      title: "Root",
      dateAdded: "2026-07-13T12:00:01.000Z" as IsoDateTime,
      children: [
        {
          kind: "bookmark",
          sourceId: "first",
          title: "First",
          url: "https://example.com/first",
          dateLastUsed: "2026-07-13T12:00:02.000Z" as IsoDateTime,
        },
        {
          kind: "folder",
          sourceId: "nested",
          title: "Nested",
          dateModified: "2026-07-13T12:00:03.000Z" as IsoDateTime,
          children: [{
            kind: "bookmark",
            sourceId: "second",
            title: "Second",
            url: "file:///Users/example/notes.html",
          }],
        },
      ],
    }],
  };
}

test("invalid input returns the validator failure before dependencies", async () => {
  const ports = makePorts();
  const result = await ports.catalog.importSnapshot({
    source: "chrome_html",
    capturedAt: "not-a-date" as IsoDateTime,
    roots: [],
  });
  assertDeepEqual(
    result,
    { ok: false, error: { code: "invalid_captured_at", path: [], field: "capturedAt" } },
    "Validator failure changed",
  );
  assertDeepEqual(ports.events, [], "Invalid input touched a dependency");
});

test("empty input allocates one snapshot ID and saves exact zero counts", async () => {
  const ports = makePorts();
  const result = await ports.catalog.importSnapshot(emptyInput());
  assertDeepEqual(
    result,
    { ok: true, value: { snapshotId: "snapshot-1", rootCount: 0, folderCount: 0, bookmarkCount: 0 } },
    "Empty summary changed",
  );
  assertDeepEqual(ports.events, ["snapshot:snapshot-1", "save"], "Empty call order changed");
  assertDeepEqual(ports.saved, [{
    id: "snapshot-1",
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [],
    rootCount: 0,
    folderCount: 0,
    bookmarkCount: 0,
  }], "Empty snapshot changed");
});

test("nested input maps fresh records in depth-first ID order", async () => {
  const input = nestedInput();
  const before = JSON.stringify(input);
  const ports = makePorts();
  const result = await ports.catalog.importSnapshot(input);
  assertDeepEqual(
    ports.events,
    ["snapshot:snapshot-1", "bookmark:bookmark-1", "bookmark:bookmark-2", "bookmark:bookmark-3", "bookmark:bookmark-4", "save"],
    "Depth-first order changed",
  );
  assertDeepEqual(ports.saved[0], {
    id: "snapshot-1",
    source: "chrome_api",
    capturedAt: CAPTURED_AT,
    roots: [{
      id: "bookmark-1",
      kind: "folder",
      sourceId: "root",
      title: "Root",
      dateAdded: "2026-07-13T12:00:01.000Z",
      children: [
        {
          id: "bookmark-2",
          kind: "bookmark",
          sourceId: "first",
          title: "First",
          url: "https://example.com/first",
          dateLastUsed: "2026-07-13T12:00:02.000Z",
        },
        {
          id: "bookmark-3",
          kind: "folder",
          sourceId: "nested",
          title: "Nested",
          dateModified: "2026-07-13T12:00:03.000Z",
          children: [{
            id: "bookmark-4",
            kind: "bookmark",
            sourceId: "second",
            title: "Second",
            url: "file:///Users/example/notes.html",
          }],
        },
      ],
    }],
    rootCount: 1,
    folderCount: 2,
    bookmarkCount: 2,
  }, "Stored mapping changed");
  assertDeepEqual(
    result,
    { ok: true, value: { snapshotId: "snapshot-1", rootCount: 1, folderCount: 2, bookmarkCount: 2 } },
    "Nested summary changed",
  );
  assert(JSON.stringify(input) === before, "Import mutated caller input");
  const storedRoot = ports.saved[0].roots[0];
  const sourceRoot = input.roots[0];
  assert(storedRoot.kind === "folder" && sourceRoot.kind === "folder", "Expected folders");
  assert(storedRoot !== sourceRoot && ports.saved[0].roots !== input.roots, "Root containers were reused");
  assert(storedRoot.children !== sourceRoot.children, "Child array was reused");
  assert(storedRoot.children[0] !== sourceRoot.children[0], "Child record was reused");
  const storedNested = storedRoot.children[1];
  const sourceNested = sourceRoot.children[1];
  assert(storedNested.kind === "folder" && sourceNested.kind === "folder", "Expected nested folders");
  assert(storedNested.children !== sourceNested.children, "Nested array was reused");
  assert(storedNested.children[0] !== sourceNested.children[0], "Nested record was reused");
});

test("save failures pass through by reference without summaries", async () => {
  for (const failure of [
    { code: "snapshot_exists", diagnostic: "fixed conflict" },
    { code: "storage_unavailable", diagnostic: "fixed outage" },
    { code: "stored_snapshot_invalid", diagnostic: "fixed record" },
  ] as const) {
    const outcome: Outcome<void, CatalogStorageFailure> = { ok: false, error: failure };
    const ports = makePorts(outcome);
    const result = await ports.catalog.importSnapshot(emptyInput());
    assert(result === outcome, "Save outcome reference changed");
    assertDeepEqual(ports.events, ["snapshot:snapshot-1", "save"], "Save order changed");
  }
});

test("getSnapshot forwards loaded missing and failure outcomes", async () => {
  const snapshot: BookmarkSnapshot = {
    id: "snapshot-existing" as SnapshotId,
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [],
    rootCount: 0,
    folderCount: 0,
    bookmarkCount: 0,
  };
  const outcomes: Outcome<BookmarkSnapshot | null, CatalogStorageFailure>[] = [
    { ok: true, value: snapshot },
    { ok: true, value: null },
    { ok: false, error: { code: "storage_unavailable", diagnostic: "fixed outage" } },
  ];
  for (const outcome of outcomes) {
    const ports = makePorts(undefined, outcome);
    const result = await ports.catalog.getSnapshot("snapshot-requested" as SnapshotId);
    assert(result === outcome, "Load outcome reference changed");
    assertDeepEqual(ports.loadCalls, ["snapshot-requested"], "Load ID changed");
    assertDeepEqual(ports.events, ["load"], "Load touched another dependency");
  }
});

test("getBookmark forwards loaded missing and failure outcomes", async () => {
  const bookmark: BookmarkLinkRecord = {
    id: "bookmark-existing" as BookmarkId,
    sourceId: "source-existing",
    kind: "bookmark",
    title: "Existing",
    url: "https://example.com/existing",
  };
  const outcomes: Outcome<BookmarkLinkRecord | null, CatalogStorageFailure>[] = [
    { ok: true, value: bookmark },
    { ok: true, value: null },
    { ok: false, error: { code: "storage_unavailable", diagnostic: "fixed outage" } },
  ];
  for (const outcome of outcomes) {
    const ports = makePorts(undefined, undefined, outcome);
    const result = await ports.catalog.getBookmark("bookmark-requested" as BookmarkId);
    assert(result === outcome, "Bookmark load outcome reference changed");
    assertDeepEqual(
      ports.bookmarkLoadCalls,
      ["bookmark-requested"],
      "Bookmark load ID changed",
    );
    assertDeepEqual(
      ports.events,
      ["loadBookmark"],
      "Bookmark load touched another dependency",
    );
  }
});
