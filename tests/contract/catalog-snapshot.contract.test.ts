interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

interface CatalogFailure {
  readonly code: string;
  readonly path: readonly number[];
  readonly field?: string;
}

type ValidationResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: CatalogFailure };

interface CatalogValidatorApi {
  validateBookmarkSnapshotInput(input: unknown): ValidationResult;
}

declare const require: (
  specifier:
    | "node:test"
    | "../../modules/catalog/public.ts"
    | "../../modules/catalog/validate-snapshot.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const catalogPublic = require("../../modules/catalog/public.ts") as Record<string, unknown>;
const { validateBookmarkSnapshotInput } = require(
  "../../modules/catalog/validate-snapshot.ts",
) as CatalogValidatorApi;

const CAPTURED_AT = "2026-07-13T12:00:00.000Z";

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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function validSnapshot(): Record<string, unknown> {
  return {
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [
      {
        kind: "folder",
        sourceId: "html:0",
        title: "",
        dateAdded: "2026-07-13T12:00:01.000Z",
        dateModified: "2026-07-13T12:00:02.000Z",
        children: [
          {
            kind: "bookmark",
            sourceId: "html:0/0",
            title: "Web",
            url: "https://example.com/",
            dateLastUsed: "2026-07-13T12:00:03.000Z",
          },
          {
            kind: "bookmark",
            sourceId: "html:0/1",
            title: "File",
            url: "file:///Users/example/notes.html",
          },
          {
            kind: "bookmark",
            sourceId: "html:0/2",
            title: "Chrome",
            url: "chrome://bookmarks/",
          },
        ],
      },
    ],
  };
}

function expectFailure(
  input: unknown,
  code: string,
  path: readonly number[],
  field: string,
): void {
  const result = validateBookmarkSnapshotInput(input);
  assert(!result.ok, `Expected ${code} failure`);
  assertEqual(result.error.code, code, "Wrong failure code");
  assertDeepEqual(result.error.path, path, "Wrong failure path");
  assertEqual(result.error.field, field, "Wrong failure field");
}

test("catalog public contract exposes no runtime surface", () => {
  assertDeepEqual(Object.keys(catalogPublic), [], "Catalog public module has runtime exports");
});

test("valid snapshot returns the same reference without mutation", () => {
  const input = validSnapshot();
  const before = JSON.stringify(input);
  const result = validateBookmarkSnapshotInput(input);

  assert(result.ok, "Valid snapshot should pass");
  assertEqual(result.value, input, "Validator must retain the input reference");
  assertEqual(JSON.stringify(input), before, "Validator mutated valid input");
});

test("empty roots and empty titles are valid source facts", () => {
  const empty = { source: "chrome_api", capturedAt: CAPTURED_AT, roots: [] };
  const result = validateBookmarkSnapshotInput(empty);
  assert(result.ok, "Empty snapshot should pass");
  assertEqual(result.value, empty, "Empty snapshot reference changed");
});

test("top-level shape and source failures are invalid_node", () => {
  expectFailure(null, "invalid_node", [], "node");
  expectFailure({ source: "other", capturedAt: CAPTURED_AT, roots: [] }, "invalid_node", [], "node");
  expectFailure(
    { source: "chrome_html", capturedAt: CAPTURED_AT, roots: [], extra: true },
    "invalid_node",
    [],
    "node",
  );
});

test("capturedAt must be canonical UTC with milliseconds", () => {
  expectFailure(
    { source: "chrome_html", capturedAt: "2026-07-13T12:00:00Z", roots: [] },
    "invalid_captured_at",
    [],
    "capturedAt",
  );
});

test("node shape and discriminant failures are deterministic", () => {
  const wrongKind = validSnapshot();
  (wrongKind.roots as Record<string, unknown>[])[0] = {
    kind: "separator",
    sourceId: "bad",
    title: "Bad",
  };
  expectFailure(wrongKind, "invalid_node", [0], "node");

  const extraField = validSnapshot();
  ((extraField.roots as Record<string, unknown>[])[0] as Record<string, unknown>).extra = true;
  expectFailure(extraField, "invalid_node", [0], "node");

  const folderWithoutChildren = validSnapshot();
  delete ((folderWithoutChildren.roots as Record<string, unknown>[])[0] as Record<string, unknown>)
    .children;
  expectFailure(folderWithoutChildren, "invalid_node", [0], "node");

  const bookmarkWithChildren = validSnapshot();
  const root = (bookmarkWithChildren.roots as Record<string, unknown>[])[0];
  const bookmark = (root.children as Record<string, unknown>[])[0];
  bookmark.children = [];
  expectFailure(bookmarkWithChildren, "invalid_node", [0, 0], "node");
});

test("empty and duplicate source IDs report their node paths", () => {
  const emptyId = validSnapshot();
  const root = (emptyId.roots as Record<string, unknown>[])[0];
  (root.children as Record<string, unknown>[])[1].sourceId = "";
  expectFailure(emptyId, "empty_source_id", [0, 1], "sourceId");

  const duplicate = validSnapshot();
  const duplicateRoot = (duplicate.roots as Record<string, unknown>[])[0];
  (duplicateRoot.children as Record<string, unknown>[])[1].sourceId = "html:0/0";
  expectFailure(duplicate, "duplicate_source_id", [0, 1], "sourceId");
});

test("every optional date position requires canonical UTC", () => {
  for (const [field, path] of [
    ["dateAdded", [0]],
    ["dateModified", [0]],
    ["dateLastUsed", [0, 0]],
  ] as const) {
    const input = validSnapshot();
    let node = (input.roots as Record<string, unknown>[])[0];
    if (path.length === 2) {
      node = (node.children as Record<string, unknown>[])[0];
    }
    node[field] = "13 July 2026";
    expectFailure(input, "invalid_date", path, field);
  }
});

test("bookmark URL must be non-empty without scheme filtering", () => {
  const input = validSnapshot();
  const root = (input.roots as Record<string, unknown>[])[0];
  (root.children as Record<string, unknown>[])[2].url = "";
  expectFailure(input, "empty_url", [0, 2], "url");
});

test("active recursion cycles are rejected", () => {
  const root: Record<string, unknown> = {
    kind: "folder",
    sourceId: "cycle",
    title: "Cycle",
    children: [],
  };
  (root.children as unknown[]).push(root);
  expectFailure(
    { source: "chrome_html", capturedAt: CAPTURED_AT, roots: [root] },
    "cyclic_tree",
    [0, 0],
    "children",
  );
});

test("repeated object outside the active chain follows source-ID rules", () => {
  const bookmark = {
    kind: "bookmark",
    sourceId: "same",
    title: "Same",
    url: "https://example.com/",
  };
  const input = {
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [
      {
        kind: "folder",
        sourceId: "root",
        title: "Root",
        children: [bookmark, bookmark],
      },
    ],
  };
  expectFailure(input, "duplicate_source_id", [0, 1], "sourceId");
});

test("depth-first traversal returns the first failure only", () => {
  const input = validSnapshot();
  const root = (input.roots as Record<string, unknown>[])[0];
  const children = root.children as Record<string, unknown>[];
  children[0].sourceId = "";
  children[1].url = "";
  expectFailure(input, "empty_source_id", [0, 0], "sourceId");
});
