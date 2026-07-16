import type { Outcome } from "../../core/contracts/public.js";
import type {
  BookmarkSnapshotInput,
  CatalogImportFailure,
  CatalogImportFailureCode,
  CatalogImportFailureField,
  CatalogResourceLimits,
} from "./public.js";

interface UnknownRecord {
  readonly [key: string]: unknown;
}

interface CatalogResourceLimitsRuntime {
  readonly CATALOG_RESOURCE_LIMITS: CatalogResourceLimits;
}

interface EnterFrame {
  readonly kind: "enter";
  readonly value: unknown;
  readonly path: readonly number[];
  readonly depth: number;
}

interface ExitFrame {
  readonly kind: "exit";
  readonly value: object;
}

type ValidationFrame = EnterFrame | ExitFrame;

declare const require: (specifier: "./catalog-resource-limits.ts") => unknown;
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
const { CATALOG_RESOURCE_LIMITS } = require(
  "./catalog-resource-limits.ts",
) as CatalogResourceLimitsRuntime;

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
  field?: CatalogImportFailureField,
): { readonly ok: false; readonly error: CatalogImportFailure } {
  const error: CatalogImportFailure = field === undefined
    ? { code, path: [...path] }
    : { code, path: [...path], field };
  return { ok: false, error };
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

function validationFrames(roots: readonly unknown[]): ValidationFrame[] {
  const frames: ValidationFrame[] = [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    frames.push({ kind: "enter", value: roots[index], path: [index], depth: 1 });
  }
  return frames;
}

function validateNodes(
  roots: readonly unknown[],
): { readonly ok: true } | { readonly ok: false; readonly error: CatalogImportFailure } {
  const sourceIds = new Set<string>();
  const active = new WeakSet<object>();
  const frames = validationFrames(roots);
  let nodeCount = 0;

  while (frames.length > 0) {
    const frame = frames.pop() as ValidationFrame;
    if (frame.kind === "exit") {
      active.delete(frame.value);
      continue;
    }

    const { value, path, depth } = frame;
    if (!isRecord(value)) return failure("invalid_node", path, "node");
    if (active.has(value)) return failure("cyclic_tree", path, "children");

    const isFolder = value.kind === "folder";
    const isBookmark = value.kind === "bookmark";
    const allowedKeys = isFolder ? FOLDER_KEYS : isBookmark ? BOOKMARK_KEYS : undefined;
    if (
      allowedKeys === undefined ||
      !hasExactKeys(value, allowedKeys) ||
      typeof value.sourceId !== "string" ||
      typeof value.title !== "string" ||
      (isFolder && !Array.isArray(value.children)) ||
      (isBookmark && typeof value.url !== "string")
    ) {
      return failure("invalid_node", path, "node");
    }
    if (depth > CATALOG_RESOURCE_LIMITS.maximumDepth) {
      return failure("depth_limit_exceeded", path);
    }
    nodeCount += 1;
    if (nodeCount > CATALOG_RESOURCE_LIMITS.maximumNodes) {
      return failure("node_limit_exceeded", path);
    }
    if (value.sourceId.length === 0) {
      return failure("empty_source_id", path, "sourceId");
    }
    if (sourceIds.has(value.sourceId)) {
      return failure("duplicate_source_id", path, "sourceId");
    }
    sourceIds.add(value.sourceId);

    const dateAdded = validateDate(value, "dateAdded", path);
    if (!dateAdded.ok) return dateAdded;
    const dateModified = validateDate(value, "dateModified", path);
    if (!dateModified.ok) return dateModified;

    if (isBookmark) {
      const dateLastUsed = validateDate(value, "dateLastUsed", path);
      if (!dateLastUsed.ok) return dateLastUsed;
      if ((value.url as string).length === 0) {
        return failure("empty_url", path, "url");
      }
      continue;
    }

    const children = value.children as readonly unknown[];
    active.add(value);
    frames.push({ kind: "exit", value });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      frames.push({
        kind: "enter",
        value: children[index],
        path: [...path, index],
        depth: depth + 1,
      });
    }
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

  const nodes = validateNodes(input.roots);
  if (!nodes.ok) return nodes;

  return { ok: true, value: input as unknown as BookmarkSnapshotInput };
}

module.exports = { validateBookmarkSnapshotInput };
