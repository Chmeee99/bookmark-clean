import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";
import type {
  BookmarkSnapshotInput,
  SourceBookmarkNode,
} from "../../modules/catalog/public.js";
import type { ChromeHtmlImportFailure } from "../../adapters/chrome-html/public.js";
import type { ParseBookmarksHtml } from "../../adapters/chrome-html/parse-bookmarks-html.js";

interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

type ExpectedNode =
  | {
      readonly kind: "folder";
      readonly title: string;
      readonly addDateRaw?: string;
      readonly lastModifiedRaw?: string;
      readonly children: readonly ExpectedNode[];
    }
  | {
      readonly kind: "bookmark";
      readonly title: string;
      readonly url: string;
      readonly addDateRaw?: string;
      readonly lastModifiedRaw?: string;
      readonly lastVisitRaw?: string;
    };

declare const require: (specifier: string) => unknown;

const { test } = require("node:test") as NodeTestApi;
const { readFileSync } = require("node:fs") as {
  readFileSync(path: string, encoding: "utf8"): string;
};
const { parseBookmarksHtml } = require(
  "../../adapters/chrome-html/parse-bookmarks-html.ts",
) as { parseBookmarksHtml: ParseBookmarksHtml };
const { validateBookmarkSnapshotInput } = require(
  "../../modules/catalog/validate-snapshot.ts",
) as {
  validateBookmarkSnapshotInput(input: unknown): { readonly ok: boolean };
};

const CAPTURED_AT = "2026-07-13T12:00:00.000Z" as IsoDateTime;
const FIXTURES = [
  "tests/fixtures/chrome-bookmarks/minimal.html",
  "tests/fixtures/chrome-bookmarks/edge-cases.html",
] as const;
const EXPECTED_TREE = "tests/fixtures/chrome-bookmarks/expected-tree.json";

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

function epoch(raw: string): IsoDateTime {
  return new Date(Number(raw) * 1000).toISOString() as IsoDateTime;
}

function mapExpected(node: ExpectedNode, path: readonly number[]): SourceBookmarkNode {
  const dates = {
    ...(node.addDateRaw === undefined ? {} : { dateAdded: epoch(node.addDateRaw) }),
    ...(node.lastModifiedRaw === undefined
      ? {}
      : { dateModified: epoch(node.lastModifiedRaw) }),
  };
  const base = { sourceId: `html:${path.join("/")}`, title: node.title, ...dates };
  if (node.kind === "bookmark") {
    return {
      ...base,
      kind: "bookmark",
      url: node.url,
      ...(node.lastVisitRaw === undefined
        ? {}
        : { dateLastUsed: epoch(node.lastVisitRaw) }),
    };
  }
  return {
    ...base,
    kind: "folder",
    children: node.children.map((child, index) => mapExpected(child, [...path, index])),
  };
}

function expectedSnapshot(index: number): BookmarkSnapshotInput {
  const expected = JSON.parse(readFileSync(EXPECTED_TREE, "utf8")) as readonly ExpectedNode[];
  return {
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [mapExpected(expected[index], [0])],
  };
}

function assertValid(result: Outcome<BookmarkSnapshotInput, ChromeHtmlImportFailure>):
  asserts result is { readonly ok: true; readonly value: BookmarkSnapshotInput } {
  assert(result.ok, "Expected successful import");
  const before = JSON.stringify(result.value);
  assert(validateBookmarkSnapshotInput(result.value).ok, "Result failed Catalog validation");
  assert(JSON.stringify(result.value) === before, "Catalog validation mutated the result");
}

function expectFailure(
  html: string,
  code: ChromeHtmlImportFailure["code"],
  path: readonly number[],
  field: ChromeHtmlImportFailure["field"],
): void {
  const result = parseBookmarksHtml({ html, capturedAt: CAPTURED_AT });
  assert(!result.ok, `Expected ${code}`);
  assertDeepEqual(
    { code: result.error.code, path: result.error.path, field: result.error.field },
    { code, path, field },
    "Typed parse failure changed",
  );
}

test("fixtures map exactly and deterministically to valid Catalog input", () => {
  FIXTURES.forEach((path, index) => {
    const request = { html: readFileSync(path, "utf8"), capturedAt: CAPTURED_AT };
    const first = parseBookmarksHtml(request);
    const second = parseBookmarksHtml(request);
    assertValid(first);
    assertValid(second);
    assertDeepEqual(first.value, expectedSnapshot(index), `${path} mapping changed`);
    assertDeepEqual(second.value, first.value, `${path} became nondeterministic`);
  });
});

test("root input boundaries remain exact", () => {
  expectFailure(" \n\t ", "empty_input", [], "html");
  expectFailure("<html><body><p>No bookmarks</p></body></html>", "missing_root_list", [], "html");
  const empty = parseBookmarksHtml({ html: "<DL></DL>", capturedAt: CAPTURED_AT });
  assertValid(empty);
  assertDeepEqual(
    empty,
    { ok: true, value: { source: "chrome_html", capturedAt: CAPTURED_AT, roots: [] } },
    "Empty root changed",
  );
});

test("a following direct DL supplies only its folder children", () => {
  const result = parseBookmarksHtml({
    html: "<DL><DT><H3>Folder</H3></DT><DL><DT><A HREF=\"https://example.com/\">Child</A></DL><DT><A HREF=\"https://example.org/\">Next</A></DT></DL>",
    capturedAt: CAPTURED_AT,
  });
  assertValid(result);
  assertDeepEqual(result.value.roots, [
    {
      kind: "folder",
      sourceId: "html:0",
      title: "Folder",
      children: [{ kind: "bookmark", sourceId: "html:0/0", title: "Child", url: "https://example.com/" }],
    },
    { kind: "bookmark", sourceId: "html:1", title: "Next", url: "https://example.org/" },
  ], "Following sibling hierarchy changed");
});

test("ambiguous or incomplete semantic entries fail exactly", () => {
  const cases = [
    "<DL><DT><SPAN>Loose entry</SPAN></DT></DL>",
    "<DL><DT><A HREF=\"https://example.com/\">One</A><H3>Two</H3></DT></DL>",
    "<DL><DT><H3>Folder</H3></DT></DL>",
    "<DL><DT><A>Missing href</A></DT></DL>",
    "<DL><DT><A HREF=\"\">Empty href</A></DT></DL>",
  ];
  for (const html of cases) expectFailure(html, "invalid_entry", [0], "entry");
});

test("every supported invalid timestamp reports its field", () => {
  for (const [element, attribute, field] of [
    ["H3", "ADD_DATE", "add_date"],
    ["H3", "LAST_MODIFIED", "last_modified"],
    ["A", "ADD_DATE", "add_date"],
    ["A", "LAST_MODIFIED", "last_modified"],
    ["A", "LAST_VISIT", "last_visit"],
  ] as const) {
    const html = element === "H3"
      ? `<DL><DT><H3 ${attribute}=\"bad\">Folder</H3><DL></DL></DT></DL>`
      : `<DL><DT><A HREF=\"https://example.com/\" ${attribute}=\"-1\">Bookmark</A></DT></DL>`;
    expectFailure(html, "invalid_timestamp", [0], field);
  }
});

test("unclosed unambiguous lists recover without invented values", () => {
  const result = parseBookmarksHtml({
    html: "<DL><DT><A HREF=\"https://example.com/\">Recovered</A>",
    capturedAt: CAPTURED_AT,
  });
  assertValid(result);
  assertDeepEqual(result.value.roots[0], {
    kind: "bookmark",
    sourceId: "html:0",
    title: "Recovered",
    url: "https://example.com/",
  }, "Recovered values changed");
});
