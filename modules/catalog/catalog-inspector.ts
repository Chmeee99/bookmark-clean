import type {
  BookmarkCatalog,
  BookmarkRecord,
  CatalogInspectionFolder,
  CatalogInspector,
  CatalogResourceLimits,
  CatalogStorageFailure,
} from "./public.js";

interface ProjectedRecords {
  readonly folders: readonly CatalogInspectionFolder[];
}

interface MutableInspectionFolder {
  id: CatalogInspectionFolder["id"];
  title: string;
  bookmarkCount: number;
  folders: CatalogInspectionFolder[];
}

interface FolderAccumulator {
  readonly folder: MutableInspectionFolder;
  readonly parent?: FolderAccumulator;
}

interface ProjectEnterFrame {
  readonly kind: "enter";
  readonly record: BookmarkRecord;
  readonly target: CatalogInspectionFolder[];
  readonly parent?: FolderAccumulator;
  readonly depth: number;
}

interface ProjectExitFrame {
  readonly kind: "exit";
  readonly accumulator: FolderAccumulator;
}

type ProjectFrame = ProjectEnterFrame | ProjectExitFrame;

interface CatalogResourceLimitsRuntime {
  readonly CATALOG_RESOURCE_LIMITS: CatalogResourceLimits;
}

declare const require: (specifier: "./catalog-resource-limits.ts") => unknown;
declare const module: {
  exports: { createCatalogInspector: typeof createCatalogInspector };
};

const { CATALOG_RESOURCE_LIMITS } = require(
  "./catalog-resource-limits.ts",
) as CatalogResourceLimitsRuntime;

function invalidStoredSnapshot(): {
  readonly ok: false;
  readonly error: CatalogStorageFailure;
} {
  return { ok: false, error: { code: "stored_snapshot_invalid" } };
}

function projectRecords(records: readonly BookmarkRecord[]):
  | { readonly ok: true; readonly value: ProjectedRecords }
  | { readonly ok: false; readonly error: CatalogStorageFailure } {
  const folders: CatalogInspectionFolder[] = [];
  const frames: ProjectFrame[] = [];
  let nodeCount = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    frames.push({
      kind: "enter",
      record: records[index],
      target: folders,
      depth: 1,
    });
  }

  while (frames.length > 0) {
    const frame = frames.pop() as ProjectFrame;
    if (frame.kind === "exit") {
      if (frame.accumulator.parent !== undefined) {
        frame.accumulator.parent.folder.bookmarkCount +=
          frame.accumulator.folder.bookmarkCount;
      }
      continue;
    }

    if (frame.depth > CATALOG_RESOURCE_LIMITS.maximumDepth) {
      return invalidStoredSnapshot();
    }
    nodeCount += 1;
    if (nodeCount > CATALOG_RESOURCE_LIMITS.maximumNodes) {
      return invalidStoredSnapshot();
    }
    if (frame.record.kind === "bookmark") {
      if (frame.parent !== undefined) frame.parent.folder.bookmarkCount += 1;
      continue;
    }

    const folder: MutableInspectionFolder = {
      id: frame.record.id,
      title: frame.record.title,
      bookmarkCount: 0,
      folders: [],
    };
    frame.target.push(folder);
    const accumulator: FolderAccumulator = {
      folder,
      ...(frame.parent === undefined ? {} : { parent: frame.parent }),
    };
    frames.push({ kind: "exit", accumulator });
    for (let index = frame.record.children.length - 1; index >= 0; index -= 1) {
      frames.push({
        kind: "enter",
        record: frame.record.children[index],
        target: folder.folders,
        parent: accumulator,
        depth: frame.depth + 1,
      });
    }
  }

  return { ok: true, value: { folders } };
}

function createCatalogInspector(
  catalog: Pick<BookmarkCatalog, "getSnapshot">,
): CatalogInspector {
  return {
    async inspectSnapshot(id) {
      const loaded = await catalog.getSnapshot(id);
      if (!loaded.ok) return loaded;
      if (loaded.value === null) return { ok: true, value: null };
      const snapshot = loaded.value;
      const projected = projectRecords(snapshot.roots);
      if (!projected.ok) return projected;
      return { ok: true, value: {
        snapshotId: snapshot.id,
        capturedAt: snapshot.capturedAt,
        rootCount: snapshot.rootCount,
        folderCount: snapshot.folderCount,
        bookmarkCount: snapshot.bookmarkCount,
        folders: projected.value.folders,
      } };
    },
  };
}

module.exports = { createCatalogInspector };
