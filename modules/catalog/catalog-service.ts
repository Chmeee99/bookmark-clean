import type {
  BookmarkCatalog,
  BookmarkRecord,
  BookmarkSnapshot,
  BookmarkSnapshotInput,
  CatalogIdFactory,
  CatalogImportFailure,
  CatalogSnapshotStore,
  SourceBookmarkNode,
  SourceBookmarkNodeBase,
} from "./public.js";
import type {
  BookmarkId,
  IsoDateTime,
  Outcome,
} from "../../core/contracts/public.js";

interface ValidatorApi {
  validateBookmarkSnapshotInput(
    input: unknown,
  ): Outcome<BookmarkSnapshotInput, CatalogImportFailure>;
}

interface CatalogServiceDependencies {
  readonly idFactory: CatalogIdFactory;
  readonly store: CatalogSnapshotStore;
}

interface Counts {
  folderCount: number;
  bookmarkCount: number;
}

interface MutableRecordBase {
  id: BookmarkId;
  sourceId: string;
  title: string;
  dateAdded?: IsoDateTime;
  dateModified?: IsoDateTime;
}

interface MutableFolderRecord extends MutableRecordBase {
  kind: "folder";
  children: BookmarkRecord[];
}

interface MutableBookmarkRecord extends MutableRecordBase {
  kind: "bookmark";
  url: string;
  dateLastUsed?: IsoDateTime;
}

declare const require: (specifier: "./validate-snapshot.ts") => unknown;
declare const module: {
  exports: {
    createBookmarkCatalog: typeof createBookmarkCatalog;
  };
};

const { validateBookmarkSnapshotInput } = require(
  "./validate-snapshot.ts",
) as ValidatorApi;

function copyBase(
  source: SourceBookmarkNodeBase,
  id: BookmarkId,
): MutableRecordBase {
  const record: MutableRecordBase = {
    id,
    sourceId: source.sourceId,
    title: source.title,
  };
  if (source.dateAdded !== undefined) {
    record.dateAdded = source.dateAdded;
  }
  if (source.dateModified !== undefined) {
    record.dateModified = source.dateModified;
  }
  return record;
}

function buildRecord(
  source: SourceBookmarkNode,
  idFactory: CatalogIdFactory,
  counts: Counts,
): BookmarkRecord {
  const id = idFactory.nextBookmarkId();
  if (source.kind === "folder") {
    counts.folderCount += 1;
    const children = source.children.map((child) =>
      buildRecord(child, idFactory, counts),
    );
    const record: MutableFolderRecord = {
      ...copyBase(source, id),
      kind: "folder",
      children,
    };
    return record;
  }

  counts.bookmarkCount += 1;
  const record: MutableBookmarkRecord = {
    ...copyBase(source, id),
    kind: "bookmark",
    url: source.url,
  };
  if (source.dateLastUsed !== undefined) {
    record.dateLastUsed = source.dateLastUsed;
  }
  return record;
}

function buildSnapshot(
  input: BookmarkSnapshotInput,
  idFactory: CatalogIdFactory,
): BookmarkSnapshot {
  const id = idFactory.nextSnapshotId();
  const counts: Counts = { folderCount: 0, bookmarkCount: 0 };
  const roots = input.roots.map((root) => buildRecord(root, idFactory, counts));
  return {
    id,
    source: input.source,
    capturedAt: input.capturedAt,
    roots,
    rootCount: input.roots.length,
    folderCount: counts.folderCount,
    bookmarkCount: counts.bookmarkCount,
  };
}

function createBookmarkCatalog({
  idFactory,
  store,
}: CatalogServiceDependencies): BookmarkCatalog {
  return {
    async importSnapshot(input) {
      const validation = validateBookmarkSnapshotInput(input);
      if (!validation.ok) {
        return validation;
      }

      const snapshot = buildSnapshot(validation.value, idFactory);
      const saved = await store.save(snapshot);
      if (!saved.ok) {
        return saved;
      }
      return {
        ok: true,
        value: {
          snapshotId: snapshot.id,
          rootCount: snapshot.rootCount,
          folderCount: snapshot.folderCount,
          bookmarkCount: snapshot.bookmarkCount,
        },
      };
    },
    getSnapshot(id) {
      return store.load(id);
    },
    getBookmark(id) {
      return store.loadBookmark(id);
    },
  };
}

module.exports = { createBookmarkCatalog };
