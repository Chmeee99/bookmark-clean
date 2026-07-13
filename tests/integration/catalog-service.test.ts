import type {
  BookmarkCatalog,
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

interface CatalogServiceApi {
  createBookmarkCatalog(dependencies: {
    readonly idFactory: CatalogIdFactory;
    readonly store: CatalogSnapshotStore;
  }): BookmarkCatalog;
}

declare const require: (
  specifier: "node:test" | "../../modules/catalog/catalog-service.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const { createBookmarkCatalog } = require(
  "../../modules/catalog/catalog-service.ts",
) as CatalogServiceApi;

const CAPTURED_AT = "2026-07-13T12:00:00.000Z" as IsoDateTime;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(canonicalize);
    }
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
      );
    }
    return value;
  };
  if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

interface FakePorts {
  readonly catalog: BookmarkCatalog;
  readonly events: string[];
  readonly saved: BookmarkSnapshot[];
  readonly loadCalls: { readonly id: SnapshotId }[];
}

function makePorts(
  saveResult: Outcome<void, CatalogStorageFailure> = { ok: true, value: undefined },
  loadResult: Outcome<BookmarkSnapshot | null, CatalogStorageFailure> = {
    ok: true,
    value: null,
  },
): FakePorts {
  const events: string[] = [];
  const saved: BookmarkSnapshot[] = [];
  const loadCalls: { id: SnapshotId }[] = [];
  let snapshotSequence = 0;
  let bookmarkSequence = 0;

  const idFactory: CatalogIdFactory = {
    nextSnapshotId(): SnapshotId {
      snapshotSequence += 1;
      const id = `snapshot-${snapshotSequence}` as SnapshotId;
      events.push(`snapshot:${id}`);
      return id;
    },
    nextBookmarkId(): BookmarkId {
      bookmarkSequence += 1;
      const id = `bookmark-${bookmarkSequence}` as BookmarkId;
      events.push(`bookmark:${id}`);
      return id;
    },
  };

  const store: CatalogSnapshotStore = {
    async save(snapshot): Promise<Outcome<void, CatalogStorageFailure>> {
      events.push("save");
      saved.push(snapshot);
      return saveResult;
    },
    async load(id): Promise<Outcome<BookmarkSnapshot | null, CatalogStorageFailure>> {
      events.push("load");
      loadCalls.push({ id });
      return loadResult;
    },
  };

  return {
    catalog: createBookmarkCatalog({ idFactory, store }),
    events,
    saved,
    loadCalls,
  };
}

function nestedInput(): BookmarkSnapshotInput {
  return {
    source: "chrome_api",
    capturedAt: CAPTURED_AT,
    roots: [
      {
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
            children: [
              {
                kind: "bookmark",
                sourceId: "second",
                title: "Second",
                url: "file:///Users/example/notes.html",
              },
            ],
          },
        ],
      },
      {
        kind: "bookmark",
        sourceId: "third",
        title: "Third",
        url: "chrome://bookmarks/",
      },
    ],
  };
}

function emptyInput(): BookmarkSnapshotInput {
  return { source: "chrome_html", capturedAt: CAPTURED_AT, roots: [] };
}

test("invalid input returns the validator failure before touching dependencies", async () => {
  const ports = makePorts();
  const result = await ports.catalog.importSnapshot({
    source: "chrome_html",
    capturedAt: "not-a-date" as IsoDateTime,
    roots: [],
  });

  assertDeepEqual(
    result,
    {
      ok: false,
      error: { code: "invalid_captured_at", path: [], field: "capturedAt" },
    },
    "Validator failure changed",
  );
  assertDeepEqual(ports.events, [], "Invalid input touched a dependency");
  assertEqual(ports.saved.length, 0, "Invalid input called save");
  assertEqual(ports.loadCalls.length, 0, "Invalid input called load");
});

test("empty input allocates only a snapshot ID and saves exact zero counts", async () => {
  const ports = makePorts();
  const result = await ports.catalog.importSnapshot(emptyInput());

  assert(result.ok, "Empty input should import successfully");
  assertDeepEqual(
    result.value,
    { snapshotId: "snapshot-1", rootCount: 0, folderCount: 0, bookmarkCount: 0 },
    "Empty import summary changed",
  );
  assertDeepEqual(ports.events, ["snapshot:snapshot-1", "save"], "Wrong empty call order");
  assertEqual(ports.saved.length, 1, "Empty input was not saved once");
  assertDeepEqual(
    ports.saved[0],
    {
      id: "snapshot-1",
      source: "chrome_html",
      capturedAt: CAPTURED_AT,
      roots: [],
      rootCount: 0,
      folderCount: 0,
      bookmarkCount: 0,
    },
    "Empty snapshot changed",
  );
});

test("nested input allocates and maps records in depth-first order", async () => {
  const input = nestedInput();
  const before = JSON.stringify(input);
  const ports = makePorts();
  const result = await ports.catalog.importSnapshot(input);
  const stored = ports.saved[0];

  assert(result.ok, "Nested input should import successfully");
  assertDeepEqual(
    ports.events,
    [
      "snapshot:snapshot-1",
      "bookmark:bookmark-1",
      "bookmark:bookmark-2",
      "bookmark:bookmark-3",
      "bookmark:bookmark-4",
      "bookmark:bookmark-5",
      "save",
    ],
    "IDs or save were requested in the wrong order",
  );
  assertDeepEqual(
    stored,
    {
      id: "snapshot-1",
      source: "chrome_api",
      capturedAt: CAPTURED_AT,
      roots: [
        {
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
              children: [
                {
                  id: "bookmark-4",
                  kind: "bookmark",
                  sourceId: "second",
                  title: "Second",
                  url: "file:///Users/example/notes.html",
                },
              ],
            },
          ],
        },
        {
          id: "bookmark-5",
          kind: "bookmark",
          sourceId: "third",
          title: "Third",
          url: "chrome://bookmarks/",
        },
      ],
      rootCount: 2,
      folderCount: 2,
      bookmarkCount: 3,
    },
    "Stored snapshot mapping changed",
  );
  assertDeepEqual(result.value, {
    snapshotId: "snapshot-1",
    rootCount: 2,
    folderCount: 2,
    bookmarkCount: 3,
  }, "Nested import summary changed");
  assertEqual(JSON.stringify(input), before, "Import mutated caller input");
  assert(stored !== undefined, "Nested import did not save a snapshot");
  const sourceRoot = input.roots[0];
  const storedRoot = stored.roots[0];
  assert(sourceRoot.kind === "folder", "Expected a source root folder");
  assert(storedRoot.kind === "folder", "Expected a stored root folder");
  assert(storedRoot !== sourceRoot, "Stored root reused a source node");
  assert(stored.roots !== input.roots, "Stored roots reused the source array");
  assert(
    storedRoot.children !== sourceRoot.children,
    "Stored children reused a source array",
  );
  assert(
    storedRoot.children[0] !== sourceRoot.children[0],
    "Stored child reused a source node",
  );
  const sourceNested = sourceRoot.children[1];
  const storedNested = storedRoot.children[1];
  assert(sourceNested.kind === "folder", "Expected a source nested folder");
  assert(storedNested.kind === "folder", "Expected a stored nested folder");
  assert(
    storedNested.children !== sourceNested.children,
    "Stored nested children reused a source array",
  );
  assert(
    storedNested.children[0] !== sourceNested.children[0],
    "Stored nested child reused a source node",
  );
});

test("save failures propagate exactly without an import summary", async () => {
  const failures: CatalogStorageFailure[] = [
    { code: "snapshot_exists", diagnostic: "fixed conflict" },
    { code: "storage_unavailable", diagnostic: "fixed outage" },
    { code: "stored_snapshot_invalid", diagnostic: "fixed record" },
  ];

  for (const failure of failures) {
    const outcome: Outcome<void, CatalogStorageFailure> = { ok: false, error: failure };
    const ports = makePorts(outcome);
    const result = await ports.catalog.importSnapshot(emptyInput());

    assertEqual(result, outcome, "Save outcome reference changed");
    assertEqual(result.ok, false, "Failed save returned a summary");
    assertEqual(ports.saved.length, 1, "Failed save call count changed");
    assertDeepEqual(ports.events, ["snapshot:snapshot-1", "save"], "Failed save order changed");
  }
});

test("getSnapshot preserves load success, missing, and failure outcomes", async () => {
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

    assertEqual(result, outcome, "Load outcome reference changed");
    assertEqual(ports.loadCalls.length, 1, "Load call count changed");
    assertEqual(ports.loadCalls[0].id, "snapshot-requested" as SnapshotId, "Wrong load ID");
    assertDeepEqual(ports.events, ["load"], "Load touched another dependency");
  }
});

test("separate imports allocate fresh IDs and preserve the first snapshot", async () => {
  const input = nestedInput();
  const ports = makePorts();
  const first = await ports.catalog.importSnapshot(input);
  const firstStored = ports.saved[0];
  const firstBefore = JSON.stringify(firstStored);
  const second = await ports.catalog.importSnapshot(input);

  assert(first.ok && second.ok, "Repeated valid imports should succeed");
  assertDeepEqual(
    ports.events,
    [
      "snapshot:snapshot-1",
      "bookmark:bookmark-1",
      "bookmark:bookmark-2",
      "bookmark:bookmark-3",
      "bookmark:bookmark-4",
      "bookmark:bookmark-5",
      "save",
      "snapshot:snapshot-2",
      "bookmark:bookmark-6",
      "bookmark:bookmark-7",
      "bookmark:bookmark-8",
      "bookmark:bookmark-9",
      "bookmark:bookmark-10",
      "save",
    ],
    "Repeated import allocation order changed",
  );
  assertEqual(first.value.snapshotId, "snapshot-1", "First snapshot ID changed");
  assertEqual(second.value.snapshotId, "snapshot-2", "Second snapshot ID was reused");
  assertEqual(JSON.stringify(firstStored), firstBefore, "Second import mutated first snapshot");
  assert(ports.saved[1] !== firstStored, "Second import reused the first snapshot object");
  assert(ports.saved[1].roots !== firstStored.roots, "Second import reused first roots");
});
