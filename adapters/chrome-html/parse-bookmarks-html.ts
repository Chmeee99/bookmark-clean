import type { DefaultTreeAdapterMap } from "parse5";
import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";
import type {
  BookmarkSnapshotInput,
  SourceBookmarkFolder,
  SourceBookmarkNode,
} from "../../modules/catalog/public.js";
import type {
  ChromeHtmlImportFailure,
  ChromeHtmlImportFailureCode,
  ChromeHtmlImportFailureField,
  ChromeHtmlImportRequest,
} from "./public.js";

declare const require: (specifier: "parse5") => unknown;
declare const module: {
  exports: { readonly parseBookmarksHtml: typeof parseBookmarksHtml };
};

const { parse } = require("parse5") as Pick<typeof import("parse5"), "parse">;

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];
type HtmlTextNode = DefaultTreeAdapterMap["textNode"];
type ParseFailure = Outcome<never, ChromeHtmlImportFailure>;
type TimestampField = "dateAdded" | "dateModified" | "dateLastUsed";
type TimestampFields = Partial<Record<TimestampField, IsoDateTime>>;

interface TimestampSpec {
  readonly attribute: string;
  readonly field: TimestampField;
  readonly failureField: Extract<
    ChromeHtmlImportFailureField,
    "add_date" | "last_modified" | "last_visit"
  >;
}

const FOLDER_TIMESTAMP_SPECS: readonly TimestampSpec[] = [
  { attribute: "add_date", field: "dateAdded", failureField: "add_date" },
  { attribute: "last_modified", field: "dateModified", failureField: "last_modified" },
];

const BOOKMARK_TIMESTAMP_SPECS: readonly TimestampSpec[] = [
  ...FOLDER_TIMESTAMP_SPECS,
  { attribute: "last_visit", field: "dateLastUsed", failureField: "last_visit" },
];

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node && typeof node.tagName === "string";
}

function isTextNode(node: HtmlNode): node is HtmlTextNode {
  return node.nodeName === "#text";
}

function hasChildren(
  node: HtmlNode,
): node is DefaultTreeAdapterMap["parentNode"] {
  return "childNodes" in node;
}

function childNodes(node: HtmlNode): readonly HtmlNode[] {
  return hasChildren(node) ? node.childNodes : [];
}

function tagIs(node: HtmlNode, tagName: string): node is HtmlElement {
  return isElement(node) && node.tagName === tagName;
}

function failure(
  code: ChromeHtmlImportFailureCode,
  path: readonly number[],
  field: ChromeHtmlImportFailureField,
): ParseFailure {
  return { ok: false, error: { code, path: [...path], field } };
}

function findRootList(node: HtmlNode, nestedInList = false): HtmlElement | undefined {
  if (tagIs(node, "dl")) {
    if (!nestedInList) {
      return node;
    }
    nestedInList = true;
  }

  for (const child of childNodes(node)) {
    const root = findRootList(child, nestedInList);
    if (root !== undefined) {
      return root;
    }
  }
  return undefined;
}

function textContent(node: HtmlNode): string {
  const parts: string[] = [];
  function collect(current: HtmlNode): void {
    if (isTextNode(current)) {
      parts.push(current.value);
      return;
    }
    for (const child of childNodes(current)) {
      collect(child);
    }
  }
  collect(node);
  return parts.join("");
}

function attributeValue(element: HtmlElement, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  return element.attrs.find((attribute) => attribute.name.toLowerCase() === lowerName)?.value;
}

function timestampValue(
  element: HtmlElement,
  spec: TimestampSpec,
  path: readonly number[],
): Outcome<IsoDateTime | undefined, ChromeHtmlImportFailure> {
  const raw = attributeValue(element, spec.attribute);
  if (raw === undefined) {
    return { ok: true, value: undefined };
  }
  if (!/^\d+$/.test(raw)) {
    return failure("invalid_timestamp", path, spec.failureField);
  }

  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    return failure("invalid_timestamp", path, spec.failureField);
  }

  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) {
    return failure("invalid_timestamp", path, spec.failureField);
  }
  return { ok: true, value: date.toISOString() as IsoDateTime };
}

function timestampFields(
  element: HtmlElement,
  path: readonly number[],
  specs: readonly TimestampSpec[],
): Outcome<TimestampFields, ChromeHtmlImportFailure> {
  const fields: TimestampFields = {};
  for (const spec of specs) {
    const parsed = timestampValue(element, spec, path);
    if (!parsed.ok) {
      return parsed;
    }
    if (parsed.value !== undefined) {
      fields[spec.field] = parsed.value;
    }
  }
  return { ok: true, value: fields };
}

function directSemanticLeads(entry: HtmlElement): readonly HtmlElement[] {
  return childNodes(entry).filter(
    (node): node is HtmlElement => tagIs(node, "h3") || tagIs(node, "a"),
  );
}

function folderChildList(
  list: HtmlElement,
  entry: HtmlElement,
): HtmlElement | undefined {
  const nestedList = childNodes(entry).find((node): node is HtmlElement => tagIs(node, "dl"));
  if (nestedList !== undefined) {
    return nestedList;
  }

  const siblings = childNodes(list);
  const entryIndex = siblings.indexOf(entry);
  for (let index = entryIndex + 1; index < siblings.length; index += 1) {
    const sibling = siblings[index];
    if (tagIs(sibling, "dt")) {
      break;
    }
    if (tagIs(sibling, "dl")) {
      return sibling;
    }
  }
  return undefined;
}

function parseList(
  list: HtmlElement,
  pathPrefix: readonly number[],
): Outcome<SourceBookmarkNode[], ChromeHtmlImportFailure> {
  const entries = childNodes(list).filter(
    (node): node is HtmlElement => tagIs(node, "dt"),
  );
  const nodes: SourceBookmarkNode[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const path = [...pathPrefix, index];
    const parsed = parseEntry(list, entries[index], path);
    if (!parsed.ok) {
      return parsed;
    }
    nodes.push(parsed.value);
  }
  return { ok: true, value: nodes };
}

function parseEntry(
  list: HtmlElement,
  entry: HtmlElement,
  path: readonly number[],
): Outcome<SourceBookmarkNode, ChromeHtmlImportFailure> {
  const leads = directSemanticLeads(entry);
  if (leads.length !== 1) {
    return failure("invalid_entry", path, "entry");
  }

  const lead = leads[0];
  const base = {
    sourceId: `html:${path.join("/")}`,
    title: textContent(lead),
  };

  if (lead.tagName === "h3") {
    const nestedList = folderChildList(list, entry);
    if (nestedList === undefined) {
      return failure("invalid_entry", path, "entry");
    }
    const dates = timestampFields(lead, path, FOLDER_TIMESTAMP_SPECS);
    if (!dates.ok) {
      return dates;
    }
    const children = parseList(nestedList, path);
    if (!children.ok) {
      return children;
    }
    const folder: SourceBookmarkFolder = {
      ...base,
      kind: "folder",
      ...dates.value,
      children: children.value,
    };
    return { ok: true, value: folder };
  }

  const href = attributeValue(lead, "href");
  if (href === undefined || href.length === 0) {
    return failure("invalid_entry", path, "entry");
  }
  const dates = timestampFields(lead, path, BOOKMARK_TIMESTAMP_SPECS);
  if (!dates.ok) {
    return dates;
  }
  const bookmark: SourceBookmarkNode = {
    ...base,
    kind: "bookmark",
    ...dates.value,
    url: href,
  };
  return { ok: true, value: bookmark };
}

function parseBookmarksHtml(
  request: ChromeHtmlImportRequest,
): Outcome<BookmarkSnapshotInput, ChromeHtmlImportFailure> {
  if (request.html.trim().length === 0) {
    return failure("empty_input", [], "html");
  }

  const document = parse(request.html, { sourceCodeLocationInfo: false });
  const rootList = findRootList(document);
  if (rootList === undefined) {
    return failure("missing_root_list", [], "html");
  }

  const roots = parseList(rootList, []);
  if (!roots.ok) {
    return roots;
  }
  return {
    ok: true,
    value: {
      source: "chrome_html",
      capturedAt: request.capturedAt,
      roots: roots.value,
    },
  };
}

export type ParseBookmarksHtml = typeof parseBookmarksHtml;

module.exports = { parseBookmarksHtml };
