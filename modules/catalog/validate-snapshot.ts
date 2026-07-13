import type { Outcome } from "../../core/contracts/public.js";
import type {
  BookmarkSnapshotInput,
  CatalogImportFailure,
  CatalogImportFailureCode,
  CatalogImportFailureField,
} from "./public.js";

interface UnknownRecord {
  readonly [key: string]: unknown;
}

declare const module: {
  exports: {
    validateBookmarkSnapshotInput: typeof validateBookmarkSnapshotInput;
  };
};

const TOP_LEVEL_KEYS = ["source", "capturedAt", "roots"] as const;
const FOLDER_KEYS = [
  "kind",
  "sourceId",
  "title",
  "dateAdded",
  "dateModified",
  "children",
] as const;
const BOOKMARK_KEYS = [
  "kind",
  "sourceId",
  "title",
  "dateAdded",
  "dateModified",
  "url",
  "dateLastUsed",
] as const;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  record: UnknownRecord,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}

function isCanonicalUtc(value: unknown): boolean {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function failure(
  code: CatalogImportFailureCode,
  path: readonly number[],
  field: CatalogImportFailureField,
): { readonly ok: false; readonly error: CatalogImportFailure } {
  return { ok: false, error: { code, path: [...path], field } };
}

function validateDate(
  record: UnknownRecord,
  field: "dateAdded" | "dateModified" | "dateLastUsed",
  path: readonly number[],
): { readonly ok: true } | { readonly ok: false; readonly error: CatalogImportFailure } {
  if (record[field] === undefined || isCanonicalUtc(record[field])) {
    return { ok: true };
  }
  return failure("invalid_date", path, field);
}

function validateNode(
  value: unknown,
  path: readonly number[],
  sourceIds: Set<string>,
  active: WeakSet<object>,
): { readonly ok: true } | { readonly ok: false; readonly error: CatalogImportFailure } {
  if (!isRecord(value)) {
    return failure("invalid_node", path, "node");
  }
  if (active.has(value)) {
    return failure("cyclic_tree", path, "children");
  }

  const isFolder = value.kind === "folder";
  const isBookmark = value.kind === "bookmark";
  const allowedKeys = isFolder ? FOLDER_KEYS : isBookmark ? BOOKMARK_KEYS : undefined;
  if (
    allowedKeys === undefined ||
    !hasExactKeys(value, allowedKeys) ||
    typeof value.sourceId !== "string" ||
    typeof value.title !== "string"
  ) {
    return failure("invalid_node", path, "node");
  }
  if (value.sourceId.length === 0) {
    return failure("empty_source_id", path, "sourceId");
  }
  if (sourceIds.has(value.sourceId)) {
    return failure("duplicate_source_id", path, "sourceId");
  }
  sourceIds.add(value.sourceId);

  const dateAdded = validateDate(value, "dateAdded", path);
  if (!dateAdded.ok) {
    return dateAdded;
  }
  const dateModified = validateDate(value, "dateModified", path);
  if (!dateModified.ok) {
    return dateModified;
  }

  if (isBookmark) {
    const dateLastUsed = validateDate(value, "dateLastUsed", path);
    if (!dateLastUsed.ok) {
      return dateLastUsed;
    }
    if (typeof value.url !== "string") {
      return failure("invalid_node", path, "node");
    }
    if (value.url.length === 0) {
      return failure("empty_url", path, "url");
    }
    return { ok: true };
  }

  if (!Array.isArray(value.children)) {
    return failure("invalid_node", path, "node");
  }
  active.add(value);
  try {
    for (let index = 0; index < value.children.length; index += 1) {
      const child = validateNode(
        value.children[index],
        [...path, index],
        sourceIds,
        active,
      );
      if (!child.ok) {
        return child;
      }
    }
  } finally {
    active.delete(value);
  }
  return { ok: true };
}

function validateBookmarkSnapshotInput(
  input: unknown,
): Outcome<BookmarkSnapshotInput, CatalogImportFailure> {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, TOP_LEVEL_KEYS) ||
    (input.source !== "chrome_api" && input.source !== "chrome_html") ||
    !Array.isArray(input.roots)
  ) {
    return failure("invalid_node", [], "node");
  }
  if (!isCanonicalUtc(input.capturedAt)) {
    return failure("invalid_captured_at", [], "capturedAt");
  }

  const sourceIds = new Set<string>();
  const active = new WeakSet<object>();
  for (let index = 0; index < input.roots.length; index += 1) {
    const node = validateNode(input.roots[index], [index], sourceIds, active);
    if (!node.ok) {
      return node;
    }
  }

  return { ok: true, value: input as unknown as BookmarkSnapshotInput };
}

module.exports = { validateBookmarkSnapshotInput };
