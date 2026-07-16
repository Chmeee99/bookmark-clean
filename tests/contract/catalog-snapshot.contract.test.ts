interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

interface CatalogFailure {
  readonly code: string;
  readonly path: readonly number[];
  readonly field?: string;
}

interface CatalogValidatorApi {
  validateBookmarkSnapshotInput(input: unknown):
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: CatalogFailure };
}

declare const require: (specifier: string) => unknown;

const { test } = require("node:test") as NodeTestApi;
const catalogPublic = require("../../modules/catalog/public.ts") as Record<string, unknown>;
const { validateBookmarkSnapshotInput } = require(
  "../../modules/catalog/validate-snapshot.ts",
) as CatalogValidatorApi;
const CAPTURED_AT = "2026-07-13T12:00:00.000Z";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function validSnapshot(): Record<string, unknown> {
  return {
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [{
      kind: "folder",
      sourceId: "root",
      title: "",
      dateAdded: "2026-07-13T12:00:01.000Z",
      dateModified: "2026-07-13T12:00:02.000Z",
      children: [
        { kind: "bookmark", sourceId: "web", title: "Web", url: "https://example.com/", dateLastUsed: "2026-07-13T12:00:03.000Z" },
        { kind: "bookmark", sourceId: "file", title: "File", url: "file:///Users/example/notes.html" },
        { kind: "bookmark", sourceId: "chrome", title: "Chrome", url: "chrome://bookmarks/" },
      ],
    }],
  };
}

function bookmarkNode(index: number): Record<string, unknown> {
  return {
    kind: "bookmark",
    sourceId: `bookmark-${index}`,
    title: `Bookmark ${index}`,
    url: `https://example.com/${index}`,
  };
}

function flatSnapshot(nodeCount: number): Record<string, unknown> {
  return {
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: Array.from({ length: nodeCount }, (_, index) => bookmarkNode(index)),
  };
}

function nestedFolder(depth: number, sourceIdOffset = 0): Record<string, unknown> {
  let node: Record<string, unknown> | undefined;
  for (let level = depth; level >= 1; level -= 1) {
    node = {
      kind: "folder",
      sourceId: `folder-${sourceIdOffset + level}`,
      title: `Folder ${level}`,
      children: node === undefined ? [] : [node],
    };
  }
  assert(node !== undefined, "Expected a non-empty folder chain");
  return node;
}

function rootOf(input: Record<string, unknown>): Record<string, unknown> {
  return (input.roots as Record<string, unknown>[])[0];
}

function expectFailure(
  input: unknown,
  code: string,
  path: readonly number[],
  field: string,
): void {
  const result = validateBookmarkSnapshotInput(input);
  assert(!result.ok, `Expected ${code}`);
  assertDeepEqual(result.error, { code, path, field }, "Failure changed");
}

test("Catalog public contract exposes only its runtime factories", () => {
  assertDeepEqual(
    Object.keys(catalogPublic).sort(),
    [
      "CATALOG_RESOURCE_LIMITS",
      "createBookmarkCatalog",
      "createCatalogInspector",
      "createCryptoCatalogIdFactory",
    ],
    "Catalog public runtime exports changed",
  );
  assert(
    JSON.stringify(catalogPublic.CATALOG_RESOURCE_LIMITS) ===
      '{"maximumNodes":20000,"maximumDepth":256}' &&
    typeof catalogPublic.createBookmarkCatalog === "function" &&
      typeof catalogPublic.createCatalogInspector === "function" &&
      typeof catalogPublic.createCryptoCatalogIdFactory === "function",
    "Catalog runtime exports changed",
  );
});

test("valid and empty snapshots retain their references without mutation", () => {
  for (const input of [
    validSnapshot(),
    { source: "chrome_api", capturedAt: CAPTURED_AT, roots: [] },
  ]) {
    const before = JSON.stringify(input);
    const result = validateBookmarkSnapshotInput(input);
    assert(result.ok, "Valid snapshot failed");
    assert(result.value === input, "Validator replaced the input");
    assert(JSON.stringify(input) === before, "Validator mutated the input");
  }
});

test("top-level and node shapes fail deterministically", () => {
  const wrongKind = validSnapshot();
  (wrongKind.roots as unknown[])[0] = { kind: "separator", sourceId: "bad", title: "Bad" };
  const extraNode = validSnapshot();
  rootOf(extraNode).extra = true;
  const missingChildren = validSnapshot();
  delete rootOf(missingChildren).children;
  const bookmarkChildren = validSnapshot();
  ((rootOf(bookmarkChildren).children as Record<string, unknown>[])[0]).children = [];
  const cases = [
    [null, "invalid_node", [], "node"],
    [{ source: "other", capturedAt: CAPTURED_AT, roots: [] }, "invalid_node", [], "node"],
    [{ source: "chrome_html", capturedAt: CAPTURED_AT, roots: [], extra: true }, "invalid_node", [], "node"],
    [{ source: "chrome_html", capturedAt: "2026-07-13T12:00:00Z", roots: [] }, "invalid_captured_at", [], "capturedAt"],
    [wrongKind, "invalid_node", [0], "node"],
    [extraNode, "invalid_node", [0], "node"],
    [missingChildren, "invalid_node", [0], "node"],
    [bookmarkChildren, "invalid_node", [0, 0], "node"],
  ] as const;
  for (const [input, code, path, field] of cases) expectFailure(input, code, path, field);
});

test("IDs dates and URLs report exact locations", () => {
  const emptyId = validSnapshot();
  (rootOf(emptyId).children as Record<string, unknown>[])[1].sourceId = "";
  expectFailure(emptyId, "empty_source_id", [0, 1], "sourceId");

  const duplicate = validSnapshot();
  (rootOf(duplicate).children as Record<string, unknown>[])[1].sourceId = "web";
  expectFailure(duplicate, "duplicate_source_id", [0, 1], "sourceId");

  for (const [field, path] of [["dateAdded", [0]], ["dateModified", [0]], ["dateLastUsed", [0, 0]]] as const) {
    const input = validSnapshot();
    const node = path.length === 1
      ? rootOf(input)
      : (rootOf(input).children as Record<string, unknown>[])[0];
    node[field] = "13 July 2026";
    expectFailure(input, "invalid_date", path, field);
  }

  const emptyUrl = validSnapshot();
  (rootOf(emptyUrl).children as Record<string, unknown>[])[2].url = "";
  expectFailure(emptyUrl, "empty_url", [0, 2], "url");
});

test("active cycles and repeated objects remain distinct", () => {
  const cyclic: Record<string, unknown> = { kind: "folder", sourceId: "cycle", title: "Cycle", children: [] };
  (cyclic.children as unknown[]).push(cyclic);
  expectFailure(
    { source: "chrome_html", capturedAt: CAPTURED_AT, roots: [cyclic] },
    "cyclic_tree", [0, 0], "children",
  );

  const bookmark = { kind: "bookmark", sourceId: "same", title: "Same", url: "https://example.com/" };
  expectFailure(
    { source: "chrome_html", capturedAt: CAPTURED_AT, roots: [{ kind: "folder", sourceId: "root", title: "Root", children: [bookmark, bookmark] }] },
    "duplicate_source_id", [0, 1], "sourceId",
  );
});

test("depth-first traversal returns only the first failure", () => {
  const input = validSnapshot();
  const children = rootOf(input).children as Record<string, unknown>[];
  children[0].sourceId = "";
  children[1].url = "";
  expectFailure(input, "empty_source_id", [0, 0], "sourceId");
});

test("Catalog structural limits are inclusive and report exact first paths", () => {
  const maximumNodes = flatSnapshot(20_000);
  const maximumDepth = {
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [nestedFolder(256)],
  };
  assert(validateBookmarkSnapshotInput(maximumNodes).ok, "20,000 nodes should be accepted");
  assert(validateBookmarkSnapshotInput(maximumDepth).ok, "Depth 256 should be accepted");

  const tooManyNodes = validateBookmarkSnapshotInput(flatSnapshot(20_001));
  assert(!tooManyNodes.ok, "20,001 nodes should fail");
  assertDeepEqual(
    tooManyNodes.error,
    { code: "node_limit_exceeded", path: [20_000] },
    "Node limit failure changed",
  );

  const tooDeep = validateBookmarkSnapshotInput({
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [nestedFolder(257)],
  });
  assert(!tooDeep.ok, "Depth 257 should fail");
  assertDeepEqual(
    tooDeep.error,
    { code: "depth_limit_exceeded", path: Array.from({ length: 257 }, () => 0) },
    "Depth limit failure changed",
  );
});

test("depth wins when the first over-depth node also exceeds the node limit", () => {
  const precedingNodes = Array.from(
    { length: 19_744 },
    (_, index) => bookmarkNode(index),
  );
  const result = validateBookmarkSnapshotInput({
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [...precedingNodes, nestedFolder(257, 20_000)],
  });
  assert(!result.ok, "Competing structural limits should fail");
  assertDeepEqual(
    result.error,
    {
      code: "depth_limit_exceeded",
      path: [19_744, ...Array.from({ length: 256 }, () => 0)],
    },
    "Structural limit precedence changed",
  );
});
