import type {
  BookmarkCatalog,
  BookmarkSnapshot,
  CatalogInspector,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type {
  BookmarkId,
  IsoDateTime,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";

interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }
declare const require: (specifier: string) => unknown;
const { test } = require("node:test") as NodeTestApi;
const { createCatalogInspector } = require("../../modules/catalog/public.ts") as {
  createCatalogInspector(catalog: Pick<BookmarkCatalog, "getSnapshot">): CatalogInspector;
};

const SNAPSHOT_ID = "snapshot:inspection" as SnapshotId;
const CAPTURED_AT = "2026-07-16T10:00:00.000Z" as IsoDateTime;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)}`);
  }
}

function snapshot(): BookmarkSnapshot {
  return {
    id: SNAPSHOT_ID,
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    rootCount: 2,
    folderCount: 3,
    bookmarkCount: 4,
    roots: [
      {
        id: "bookmark:root-link" as BookmarkId,
        kind: "bookmark",
        sourceId: "source-root-link",
        title: "Private root bookmark title",
        url: "https://private.example/root",
      },
      {
        id: "bookmark:root-folder" as BookmarkId,
        kind: "folder",
        sourceId: "source-root-folder",
        title: "Root Folder",
        children: [
          {
            id: "bookmark:direct-link" as BookmarkId,
            kind: "bookmark",
            sourceId: "source-direct-link",
            title: "Private direct bookmark title",
            url: "https://private.example/direct",
          },
          {
            id: "bookmark:nested-folder" as BookmarkId,
            kind: "folder",
            sourceId: "source-nested-folder",
            title: "Nested Folder",
            children: [
              {
                id: "bookmark:nested-one" as BookmarkId,
                kind: "bookmark",
                sourceId: "source-nested-one",
                title: "Private nested bookmark one",
                url: "file:///private/one",
              },
              {
                id: "bookmark:nested-two" as BookmarkId,
                kind: "bookmark",
                sourceId: "source-nested-two",
                title: "Private nested bookmark two",
                url: "chrome://private/two",
              },
            ],
          },
          {
            id: "bookmark:empty-folder" as BookmarkId,
            kind: "folder",
            sourceId: "source-empty-folder",
            title: "Empty Folder",
            children: [],
          },
        ],
      },
    ],
  };
}

function deepFolderSnapshot(depth: number): BookmarkSnapshot {
  let node: BookmarkSnapshot["roots"][number] | undefined;
  for (let level = depth; level >= 1; level -= 1) {
    node = {
      id: `bookmark:deep:${level}` as BookmarkId,
      kind: "folder",
      sourceId: `source:deep:${level}`,
      title: `Folder ${level}`,
      children: node === undefined ? [] : [node],
    };
  }
  assert(node !== undefined, "Expected a non-empty deep snapshot");
  return {
    id: SNAPSHOT_ID,
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [node],
    rootCount: 1,
    folderCount: depth,
    bookmarkCount: 0,
  };
}

function flatBookmarkSnapshot(nodeCount: number): BookmarkSnapshot {
  return {
    id: SNAPSHOT_ID,
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: Array.from({ length: nodeCount }, (_, index) => ({
      id: `bookmark:flat:${index}` as BookmarkId,
      kind: "bookmark" as const,
      sourceId: `source:flat:${index}`,
      title: `Private ${index}`,
      url: `https://private.example/${index}`,
    })),
    rootCount: nodeCount,
    folderCount: 0,
    bookmarkCount: nodeCount,
  };
}

function inspector(
  outcome: Outcome<BookmarkSnapshot | null, CatalogStorageFailure>,
): { readonly value: CatalogInspector; readonly calls: SnapshotId[] } {
  const calls: SnapshotId[] = [];
  return {
    calls,
    value: createCatalogInspector({
      async getSnapshot(id) { calls.push(id); return outcome; },
    }),
  };
}

test("projects ordered folders with descendant bookmark counts and no bookmark facts", async () => {
  const source = snapshot();
  const before = JSON.stringify(source);
  const input = inspector({ ok: true, value: source });
  const result = await input.value.inspectSnapshot(SNAPSHOT_ID);
  equal(result, { ok: true, value: {
    snapshotId: SNAPSHOT_ID,
    capturedAt: CAPTURED_AT,
    rootCount: 2,
    folderCount: 3,
    bookmarkCount: 4,
    folders: [{
      id: "bookmark:root-folder",
      title: "Root Folder",
      bookmarkCount: 3,
      folders: [
        {
          id: "bookmark:nested-folder",
          title: "Nested Folder",
          bookmarkCount: 2,
          folders: [],
        },
        {
          id: "bookmark:empty-folder",
          title: "Empty Folder",
          bookmarkCount: 0,
          folders: [],
        },
      ],
    }],
  } }, "Inspection projection changed");
  equal(input.calls, [SNAPSHOT_ID], "Catalog read count changed");
  assert(JSON.stringify(source) === before, "Inspection mutated the snapshot");
  const serialized = JSON.stringify(result);
  for (const forbidden of ["sourceId", "url", "Private", "https://", "file:///", "chrome://"]) {
    assert(!serialized.includes(forbidden), `Inspection exposed ${forbidden}`);
  }
});

test("preserves empty missing and storage-failure outcomes", async () => {
  const empty = inspector({ ok: true, value: {
    ...snapshot(), rootCount: 0, folderCount: 0, bookmarkCount: 0, roots: [],
  } });
  equal(await empty.value.inspectSnapshot(SNAPSHOT_ID), { ok: true, value: {
    snapshotId: SNAPSHOT_ID, capturedAt: CAPTURED_AT,
    rootCount: 0, folderCount: 0, bookmarkCount: 0, folders: [],
  } }, "Empty projection changed");

  const missing = inspector({ ok: true, value: null });
  equal(await missing.value.inspectSnapshot(SNAPSHOT_ID), { ok: true, value: null },
    "Missing snapshot changed");

  const failure = { code: "storage_unavailable", diagnostic: "opaque" } as const;
  const unavailable = inspector({ ok: false, error: failure });
  const result = await unavailable.value.inspectSnapshot(SNAPSHOT_ID);
  assert(!result.ok && result.error === failure, "Storage failure was replaced");
});

test("inspection accepts maximum depth without recursive projection", async () => {
  const input = inspector({ ok: true, value: deepFolderSnapshot(256) });
  const result = await input.value.inspectSnapshot(SNAPSHOT_ID);
  assert(result.ok && result.value !== null, "Maximum-depth inspection failed");
  let depth = 0;
  let folder = result.value.folders[0];
  while (folder !== undefined) {
    depth += 1;
    folder = folder.folders[0];
  }
  assert(depth === 256, "Maximum-depth inspection changed hierarchy");
});

test("inspection rejects faulty over-budget Catalog dependencies", async () => {
  for (const source of [
    deepFolderSnapshot(4_000),
    flatBookmarkSnapshot(20_001),
  ]) {
    const input = inspector({ ok: true, value: source });
    const result = await input.value.inspectSnapshot(SNAPSHOT_ID);
    equal(
      result,
      { ok: false, error: { code: "stored_snapshot_invalid" } },
      "Over-budget inspection result changed",
    );
  }
});
