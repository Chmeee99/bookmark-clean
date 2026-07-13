import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";
import type {
  BookmarkSnapshotInput,
  SourceBookmarkNode,
} from "../../modules/catalog/public.js";
import type {
  ChromeHtmlImportFailure,
  ChromeHtmlImportRequest,
} from "../../adapters/chrome-html/public.js";
import type { ParseBookmarksHtml } from "../../adapters/chrome-html/parse-bookmarks-html.js";

interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

interface FileSystemApi {
  readFileSync(path: string, encoding: "utf8"): string;
}

interface ParserApi {
  parseBookmarksHtml: ParseBookmarksHtml;
}

interface CatalogValidatorApi {
  validateBookmarkSnapshotInput(input: unknown):
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: { readonly code: string } };
}

declare const require: (
  specifier:
    | "node:test"
    | "node:fs"
    | "../../adapters/chrome-html/parse-bookmarks-html.ts"
    | "../../modules/catalog/validate-snapshot.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const { readFileSync } = require("node:fs") as FileSystemApi;
const { parseBookmarksHtml } = require(
  "../../adapters/chrome-html/parse-bookmarks-html.ts",
) as ParserApi;
const { validateBookmarkSnapshotInput } = require(
  "../../modules/catalog/validate-snapshot.ts",
) as CatalogValidatorApi;

const CAPTURED_AT = "2026-07-13T12:00:00.000Z" as IsoDateTime;
const MINIMAL_PATH = "tests/fixtures/chrome-bookmarks/minimal.html";
const EDGE_CASES_PATH = "tests/fixtures/chrome-bookmarks/edge-cases.html";
const EXPECTED_TREE_PATH = "tests/fixtures/chrome-bookmarks/expected-tree.json";

interface ExpectedFolder {
  readonly kind: "folder";
  readonly title: string;
  readonly addDateRaw?: string;
  readonly lastModifiedRaw?: string;
  readonly children: readonly ExpectedNode[];
}

interface ExpectedBookmark {
  readonly kind: "bookmark";
  readonly title: string;
  readonly url: string;
  readonly addDateRaw?: string;
  readonly lastModifiedRaw?: string;
  readonly lastVisitRaw?: string;
}

type ExpectedNode = ExpectedFolder | ExpectedBookmark;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
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
    throw new Error(message);
  }
}

function readFixture(path: string): string {
  return readFileSync(path, "utf8");
}

function epochToIso(raw: string): IsoDateTime {
  return new Date(Number(raw) * 1000).toISOString() as IsoDateTime;
}

function mapExpectedNode(node: ExpectedNode, path: readonly number[]): SourceBookmarkNode {
  const base = {
    sourceId: `html:${path.join("/")}`,
    title: node.title,
  };

  if (node.kind === "bookmark") {
    const bookmark: {
      kind: "bookmark";
      sourceId: string;
      title: string;
      url: string;
      dateAdded?: IsoDateTime;
      dateModified?: IsoDateTime;
      dateLastUsed?: IsoDateTime;
    } = { ...base, kind: "bookmark", url: node.url };
    if (node.addDateRaw !== undefined) {
      bookmark.dateAdded = epochToIso(node.addDateRaw);
    }
    if (node.lastModifiedRaw !== undefined) {
      bookmark.dateModified = epochToIso(node.lastModifiedRaw);
    }
    if (node.lastVisitRaw !== undefined) {
      bookmark.dateLastUsed = epochToIso(node.lastVisitRaw);
    }
    return bookmark;
  }

  const folder: {
    kind: "folder";
    sourceId: string;
    title: string;
    children: SourceBookmarkNode[];
    dateAdded?: IsoDateTime;
    dateModified?: IsoDateTime;
  } = {
    ...base,
    kind: "folder",
    children: node.children.map((child, index) => mapExpectedNode(child, [...path, index])),
  };
  if (node.addDateRaw !== undefined) {
    folder.dateAdded = epochToIso(node.addDateRaw);
  }
  if (node.lastModifiedRaw !== undefined) {
    folder.dateModified = epochToIso(node.lastModifiedRaw);
  }
  return folder;
}

function expectedSnapshot(fixtureIndex: number): BookmarkSnapshotInput {
  const expected = JSON.parse(readFixture(EXPECTED_TREE_PATH)) as readonly ExpectedNode[];
  return {
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [mapExpectedNode(expected[fixtureIndex], [0])],
  };
}

function assertValidCatalogInput(result: Outcome<BookmarkSnapshotInput, ChromeHtmlImportFailure>):
  asserts result is { readonly ok: true; readonly value: BookmarkSnapshotInput } {
  assert(result.ok, "Expected a successful Chrome HTML import");
  const before = JSON.stringify(result.value);
  const validation = validateBookmarkSnapshotInput(result.value);
  assert(validation.ok, "Successful import must pass Catalog validation");
  assertDeepEqual(JSON.stringify(result.value), before, "Catalog validation mutated imported data");
}

function expectFailure(
  html: string,
  code: ChromeHtmlImportFailure["code"],
  path: readonly number[],
  field: ChromeHtmlImportFailure["field"],
  name: string,
): void {
  const result = parseBookmarksHtml({ html, capturedAt: CAPTURED_AT });
  assert(!result.ok, `${name}: expected a typed parse failure`);
  assertDeepEqual(
    { code: result.error.code, path: result.error.path, field: result.error.field },
    { code, path, field },
    `${name}: wrong typed parse failure`,
  );
}

test("minimal Chrome HTML fixture maps exactly to Catalog input", () => {
  const result = parseBookmarksHtml({
    html: readFixture(MINIMAL_PATH),
    capturedAt: CAPTURED_AT,
  });
  assertValidCatalogInput(result);
  assertDeepEqual(result.value, {
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [
      {
        kind: "folder",
        sourceId: "html:0",
        title: "Bookmarks Bar",
        dateAdded: "2023-11-14T22:13:20.000Z",
        dateModified: "2023-11-14T22:13:21.000Z",
        children: [
          {
            kind: "bookmark",
            sourceId: "html:0/0",
            title: "Example & Reference",
            url: "https://example.com/reference?a=1&b=2",
            dateAdded: "2023-11-14T22:13:22.000Z",
          },
        ],
      },
    ],
  }, "Minimal fixture mapping changed");
});

test("edge-case Chrome HTML fixture maps exactly to Catalog input", () => {
  const result = parseBookmarksHtml({
    html: readFixture(EDGE_CASES_PATH),
    capturedAt: CAPTURED_AT,
  });
  assertValidCatalogInput(result);
  assertDeepEqual(result.value, expectedSnapshot(1), "Edge-case fixture mapping changed");
});

test("the same request produces deterministic source IDs and values", () => {
  const request = { html: readFixture(EDGE_CASES_PATH), capturedAt: CAPTURED_AT };
  const first = parseBookmarksHtml(request);
  const second = parseBookmarksHtml(request);
  assert(first.ok && second.ok, "Determinism check requires successful imports");
  assertDeepEqual(first.value, second.value, "Repeated parse changed the imported tree");
});

test("whitespace-only input is rejected", () => {
  expectFailure(" \n\t ", "empty_input", [], "html", "whitespace input");
});

test("a document without a root list is rejected", () => {
  expectFailure("<html><body><p>No bookmarks</p></body></html>", "missing_root_list", [], "html", "missing root");
});

test("an empty root list is valid", () => {
  const result = parseBookmarksHtml({ html: "<DL></DL>", capturedAt: CAPTURED_AT });
  assertValidCatalogInput(result);
  assertDeepEqual(
    result,
    { ok: true, value: { source: "chrome_html", capturedAt: CAPTURED_AT, roots: [] } },
    "Empty root list did not produce an empty snapshot",
  );
});

test("a following direct DL sibling can supply a folder child list", () => {
  const result = parseBookmarksHtml({
    html: [
      "<DL>",
      "<DT><H3>Folder</H3></DT>",
      "<DL><DT><A HREF=\"https://example.com/\">Child</A></DL>",
      "<DT><A HREF=\"https://example.org/\">Next</A></DT>",
      "</DL>",
    ].join(""),
    capturedAt: CAPTURED_AT,
  });
  assertValidCatalogInput(result);
  assert(result.ok, "Sibling-list mapping requires a successful import");
  assertDeepEqual(result.value.roots, [
    {
      kind: "folder",
      sourceId: "html:0",
      title: "Folder",
      children: [
        {
          kind: "bookmark",
          sourceId: "html:0/0",
          title: "Child",
          url: "https://example.com/",
        },
      ],
    },
    {
      kind: "bookmark",
      sourceId: "html:1",
      title: "Next",
      url: "https://example.org/",
    },
  ], "Sibling child-list mapping changed");
});

test("a DT without exactly one direct semantic lead is rejected", () => {
  expectFailure(
    "<DL><DT><SPAN>Loose entry</SPAN></DT></DL>",
    "invalid_entry",
    [0],
    "entry",
    "missing semantic lead",
  );
  expectFailure(
    "<DL><DT><A HREF=\"https://example.com/\">One</A><H3>Two</H3></DT></DL>",
    "invalid_entry",
    [0],
    "entry",
    "multiple semantic leads",
  );
});

test("a folder without a direct or following child list is rejected", () => {
  expectFailure(
    "<DL><DT><H3>Folder</H3></DT></DL>",
    "invalid_entry",
    [0],
    "entry",
    "missing folder list",
  );
});

test("bookmarks require a non-empty decoded href", () => {
  expectFailure(
    "<DL><DT><A>Missing href</A></DT></DL>",
    "invalid_entry",
    [0],
    "entry",
    "missing href",
  );
  expectFailure(
    "<DL><DT><A HREF=\"\">Empty href</A></DT></DL>",
    "invalid_entry",
    [0],
    "entry",
    "empty href",
  );
});

test("each supported invalid timestamp reports its declared field", () => {
  const cases = [
    ["ADD_DATE", "add_date", [0]],
    ["LAST_MODIFIED", "last_modified", [0]],
  ] as const;
  for (const [attribute, field, path] of cases) {
    expectFailure(
      `<DL><DT><H3 ${attribute}=\"not-an-epoch\">Folder</H3><DL></DL></DT></DL>`,
      "invalid_timestamp",
      path,
      field,
      `invalid folder ${field}`,
    );
  }

  const bookmarkCases = [
    ["ADD_DATE", "add_date"],
    ["LAST_MODIFIED", "last_modified"],
    ["LAST_VISIT", "last_visit"],
  ] as const;
  for (const [attribute, field] of bookmarkCases) {
    expectFailure(
      `<DL><DT><A HREF=\"https://example.com/\" ${attribute}=\"-1\">Bookmark</A></DT></DL>`,
      "invalid_timestamp",
      [0],
      field,
      `invalid bookmark ${field}`,
    );
  }
});

test("an unclosed but unambiguous list may be recovered by the HTML parser", () => {
  const result = parseBookmarksHtml({
    html: "<DL><DT><A HREF=\"https://example.com/\">Recovered</A>",
    capturedAt: CAPTURED_AT,
  });
  assertValidCatalogInput(result);
  assert(result.ok, "Recovered list should remain successful");
  assertDeepEqual(result.value.roots[0], {
    kind: "bookmark",
    sourceId: "html:0",
    title: "Recovered",
    url: "https://example.com/",
  }, "Unclosed unambiguous list changed its source values");
});
