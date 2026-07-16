import type { DefaultTreeAdapterMap } from "parse5";
import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";
import type {
  BookmarkSnapshotInput,
  CatalogResourceLimits,
  SourceBookmarkFolder,
  SourceBookmarkNode,
} from "../../modules/catalog/public.js";
import type {
  ChromeHtmlImportFailure,
  ChromeHtmlImportFailureCode,
  ChromeHtmlImportFailureField,
  ChromeHtmlImportRequest,
} from "./public.js";

interface CatalogRuntime {
  readonly CATALOG_RESOURCE_LIMITS: CatalogResourceLimits;
}

interface ChromeHtmlResourceLimitsRuntime {
  readonly CHROME_HTML_MAX_INPUT_BYTES: 16_777_216;
}

interface BufferRuntime {
  readonly Buffer: {
    byteLength(value: string, encoding: "utf8"): number;
  };
}

interface ParseEntryFrame {
  readonly list: HtmlElement;
  readonly entry: HtmlElement;
  readonly path: readonly number[];
  readonly depth: number;
  readonly target: SourceBookmarkNode[];
}

declare const require: (
  specifier:
    | "node:buffer"
    | "parse5"
    | "../../modules/catalog/public.ts"
    | "./chrome-html-resource-limits.ts",
) => unknown;
declare const module: {
  exports: { readonly parseBookmarksHtml: typeof parseBookmarksHtml };
};

const { Buffer } = require("node:buffer") as BufferRuntime;
const { parse } = require("parse5") as Pick<typeof import("parse5"), "parse">;
const { CATALOG_RESOURCE_LIMITS } = require(
  "../../modules/catalog/public.ts",
) as CatalogRuntime;
const { CHROME_HTML_MAX_INPUT_BYTES } = require(
  "./chrome-html-resource-limits.ts",
) as ChromeHtmlResourceLimitsRuntime;

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

function findRootList(node: HtmlNode): HtmlElement | undefined {
  const pending: HtmlNode[] = [node];
  while (pending.length > 0) {
    const current = pending.pop() as HtmlNode;
    if (tagIs(current, "dl")) return current;
    const children = childNodes(current);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return undefined;
}

function textContent(node: HtmlNode): string {
  const parts: string[] = [];
  const pending: HtmlNode[] = [node];
  while (pending.length > 0) {
    const current = pending.pop() as HtmlNode;
    if (isTextNode(current)) {
      parts.push(current.value);
      continue;
    }
    const children = childNodes(current);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
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

function semanticEntries(
  list: HtmlElement,
): readonly HtmlElement[] {
  return childNodes(list).filter(
    (node): node is HtmlElement => tagIs(node, "dt"),
  );
}

function pushEntryFrames(
  list: HtmlElement,
  pathPrefix: readonly number[],
  depth: number,
  target: SourceBookmarkNode[],
  frames: ParseEntryFrame[],
): void {
  const entries = semanticEntries(list);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    frames.push({
      list,
      entry: entries[index],
      path: [...pathPrefix, index],
      depth,
      target,
    });
  }
}

function parseSemanticTree(
  rootList: HtmlElement,
): Outcome<SourceBookmarkNode[], ChromeHtmlImportFailure> {
  const roots: SourceBookmarkNode[] = [];
  const frames: ParseEntryFrame[] = [];
  let nodeCount = 0;
  pushEntryFrames(rootList, [], 1, roots, frames);

  while (frames.length > 0) {
    const { list, entry, path, depth, target } = frames.pop() as ParseEntryFrame;
    const leads = directSemanticLeads(entry);
    if (leads.length !== 1) return failure("invalid_entry", path, "entry");

    const lead = leads[0];
    const nestedList = lead.tagName === "h3"
      ? folderChildList(list, entry)
      : undefined;
    if (lead.tagName === "h3" && nestedList === undefined) {
      return failure("invalid_entry", path, "entry");
    }
    if (depth > CATALOG_RESOURCE_LIMITS.maximumDepth) {
      return failure("depth_limit_exceeded", path, "entry");
    }
    nodeCount += 1;
    if (nodeCount > CATALOG_RESOURCE_LIMITS.maximumNodes) {
      return failure("node_limit_exceeded", path, "entry");
    }

    const base = {
      sourceId: `html:${path.join("/")}`,
      title: textContent(lead),
    };

    if (lead.tagName === "h3") {
      const children: SourceBookmarkNode[] = [];
      const dates = timestampFields(lead, path, FOLDER_TIMESTAMP_SPECS);
      if (!dates.ok) return dates;
      const folder: SourceBookmarkFolder = {
        ...base,
        kind: "folder",
        ...dates.value,
        children,
      };
      target.push(folder);
      pushEntryFrames(
        nestedList as HtmlElement,
        path,
        depth + 1,
        children,
        frames,
      );
      continue;
    }

    const href = attributeValue(lead, "href");
    if (href === undefined || href.length === 0) {
      return failure("invalid_entry", path, "entry");
    }
    const dates = timestampFields(lead, path, BOOKMARK_TIMESTAMP_SPECS);
    if (!dates.ok) return dates;
    target.push({
      ...base,
      kind: "bookmark",
      ...dates.value,
      url: href,
    });
  }

  return { ok: true, value: roots };
}

function parseBookmarksHtml(
  request: ChromeHtmlImportRequest,
): Outcome<BookmarkSnapshotInput, ChromeHtmlImportFailure> {
  if (Buffer.byteLength(request.html, "utf8") > CHROME_HTML_MAX_INPUT_BYTES) {
    return failure("input_too_large", [], "html");
  }
  if (request.html.trim().length === 0) {
    return failure("empty_input", [], "html");
  }

  const document = parse(request.html, { sourceCodeLocationInfo: false });
  const rootList = findRootList(document);
  if (rootList === undefined) {
    return failure("missing_root_list", [], "html");
  }

  const roots = parseSemanticTree(rootList);
  if (!roots.ok) return roots;
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
