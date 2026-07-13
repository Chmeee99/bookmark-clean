import type {
  BookmarkFolderRecord,
  BookmarkLinkRecord,
  BookmarkRecord,
  BookmarkSnapshot,
  BookmarkSource,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type {
  BookmarkId,
  IsoDateTime,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";

interface CatalogSqliteRow {
  readonly [key: string]: unknown;
}

interface StoredSnapshot {
  readonly source: BookmarkSource;
  readonly capturedAt: IsoDateTime;
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
}

interface StoredNode {
  readonly id: string;
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly parentId: string | null;
  readonly siblingIndex: number;
  readonly kind: "folder" | "bookmark";
  readonly title: string;
  readonly url: string | null;
  readonly dateAdded: IsoDateTime | null;
  readonly dateModified: IsoDateTime | null;
  readonly dateLastUsed: IsoDateTime | null;
}

interface MutableRecordBase {
  id: BookmarkId;
  sourceId: string;
  title: string;
  dateAdded?: IsoDateTime;
  dateModified?: IsoDateTime;
}
function storedSnapshotInvalid(): Outcome<BookmarkSnapshot, CatalogStorageFailure> {
  return { ok: false, error: { code: "stored_snapshot_invalid" } };
}
function isCanonicalUtc(value: unknown): value is IsoDateTime {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}
function isNullableCanonicalUtc(value: unknown): value is IsoDateTime | null {
  return value === null || isCanonicalUtc(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isBookmarkSource(value: unknown): value is BookmarkSource {
  return value === "chrome_api" || value === "chrome_html";
}
function parseSnapshotRow(
  row: CatalogSqliteRow,
  snapshotId: SnapshotId,
): StoredSnapshot | undefined {
  if (
    row.id !== snapshotId ||
    !isNonEmptyString(row.id) ||
    !isBookmarkSource(row.source) ||
    !isCanonicalUtc(row.captured_at) ||
    !isCount(row.root_count) ||
    !isCount(row.folder_count) ||
    !isCount(row.bookmark_count)
  ) {
    return undefined;
  }
  return {
    source: row.source,
    capturedAt: row.captured_at,
    rootCount: row.root_count,
    folderCount: row.folder_count,
    bookmarkCount: row.bookmark_count,
  };
}
function parseNodeRow(
  row: CatalogSqliteRow,
  snapshotId: SnapshotId,
): StoredNode | undefined {
  const parentId = row.parent_id;
  if (
    !isNonEmptyString(row.id) ||
    row.snapshot_id !== snapshotId ||
    !isNonEmptyString(row.snapshot_id) ||
    !isNonEmptyString(row.source_id) ||
    (parentId !== null && !isNonEmptyString(parentId)) ||
    !isCount(row.sibling_index) ||
    !isNonEmptyString(row.kind) ||
    typeof row.title !== "string" ||
    !isNullableCanonicalUtc(row.date_added) ||
    !isNullableCanonicalUtc(row.date_modified) ||
    !isNullableCanonicalUtc(row.date_last_used)
  ) {
    return undefined;
  }
  if (row.kind === "folder") {
    if (row.url !== null || row.date_last_used !== null) {
      return undefined;
    }
  } else if (
    row.kind !== "bookmark" ||
    typeof row.url !== "string" ||
    row.url.length === 0
  ) {
    return undefined;
  }
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    sourceId: row.source_id,
    parentId,
    siblingIndex: row.sibling_index,
    kind: row.kind,
    title: row.title,
    url: row.url,
    dateAdded: row.date_added,
    dateModified: row.date_modified,
    dateLastUsed: row.date_last_used,
  };
}
function hasContiguousSiblingIndexes(groups: Map<string | null, StoredNode[]>): boolean {
  for (const siblings of groups.values()) {
    siblings.sort(
      (left, right) => left.siblingIndex - right.siblingIndex,
    );
    for (let index = 0; index < siblings.length; index += 1) {
      if (siblings[index]?.siblingIndex !== index) {
        return false;
      }
    }
  }
  return true;
}
function baseRecord(node: StoredNode): MutableRecordBase {
  const record: MutableRecordBase = {
    id: node.id as BookmarkId,
    sourceId: node.sourceId,
    title: node.title,
  };
  if (node.dateAdded !== null) {
    record.dateAdded = node.dateAdded;
  }
  if (node.dateModified !== null) {
    record.dateModified = node.dateModified;
  }
  return record;
}
function assembleRecord(
  node: StoredNode,
  childrenByParent: Map<string | null, StoredNode[]>,
  visited: Set<string>,
  active: Set<string>,
): BookmarkRecord | undefined {
  if (active.has(node.id) || visited.has(node.id)) {
    return undefined;
  }
  active.add(node.id);
  visited.add(node.id);

  try {
    if (node.kind === "bookmark") {
      const record: BookmarkLinkRecord = {
        ...baseRecord(node),
        kind: "bookmark",
        url: node.url as string,
        ...(node.dateLastUsed === null
          ? {}
          : { dateLastUsed: node.dateLastUsed }),
      };
      return record;
    }

    const children: BookmarkRecord[] = [];
    for (const child of childrenByParent.get(node.id) ?? []) {
      const assembled = assembleRecord(child, childrenByParent, visited, active);
      if (assembled === undefined) {
        return undefined;
      }
      children.push(assembled);
    }
    const record: BookmarkFolderRecord = {
      ...baseRecord(node),
      kind: "folder",
      children,
    };
    return record;
  } finally {
    active.delete(node.id);
  }
}
function reconstructCatalogSnapshot(
  snapshotRow: CatalogSqliteRow,
  nodeRows: readonly CatalogSqliteRow[],
  snapshotId: SnapshotId,
): Outcome<BookmarkSnapshot, CatalogStorageFailure> {
  const snapshot = parseSnapshotRow(snapshotRow, snapshotId);
  if (snapshot === undefined) {
    return storedSnapshotInvalid();
  }
  const nodes: StoredNode[] = [];
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  for (const row of nodeRows) {
    const node = parseNodeRow(row, snapshotId);
    if (
      node === undefined ||
      ids.has(node.id) ||
      sourceIds.has(node.sourceId)
    ) {
      return storedSnapshotInvalid();
    }
    ids.add(node.id);
    sourceIds.add(node.sourceId);
    nodes.push(node);
  }
  const nodesById = new Map<string, StoredNode>();
  for (const node of nodes) {
    nodesById.set(node.id, node);
  }
  const childrenByParent = new Map<string | null, StoredNode[]>();
  for (const node of nodes) {
    if (node.parentId !== null) {
      const parent = nodesById.get(node.parentId);
      if (parent === undefined || parent.kind !== "folder") {
        return storedSnapshotInvalid();
      }
    }
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }
  if (!hasContiguousSiblingIndexes(childrenByParent)) {
    return storedSnapshotInvalid();
  }
  const roots = childrenByParent.get(null) ?? [];
  const folderCount = nodes.filter((node) => node.kind === "folder").length;
  const bookmarkCount = nodes.length - folderCount;
  if (
    snapshot.rootCount !== roots.length ||
    snapshot.folderCount !== folderCount ||
    snapshot.bookmarkCount !== bookmarkCount
  ) {
    return storedSnapshotInvalid();
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const assembledRoots: BookmarkRecord[] = [];
  for (const root of roots) {
    const assembled = assembleRecord(root, childrenByParent, visited, active);
    if (assembled === undefined) {
      return storedSnapshotInvalid();
    }
    assembledRoots.push(assembled);
  }
  if (visited.size !== nodes.length) {
    return storedSnapshotInvalid();
  }
  return {
    ok: true,
    value: {
      id: snapshotId,
      source: snapshot.source,
      capturedAt: snapshot.capturedAt,
      roots: assembledRoots,
      rootCount: snapshot.rootCount,
      folderCount: snapshot.folderCount,
      bookmarkCount: snapshot.bookmarkCount,
    },
  };
}
declare const module: {
  exports: {
    reconstructCatalogSnapshot: typeof reconstructCatalogSnapshot;
  };
};
module.exports = { reconstructCatalogSnapshot };
