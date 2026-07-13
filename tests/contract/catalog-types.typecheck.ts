import type {
  BookmarkCatalog,
  BookmarkFolderRecord,
  BookmarkLinkRecord,
  BookmarkRecord,
  BookmarkRecordBase,
  BookmarkSnapshot,
  BookmarkSnapshotInput,
  BookmarkSource,
  CatalogFailure,
  CatalogIdFactory,
  CatalogImportFailure,
  CatalogImportFailureCode,
  CatalogImportFailureField,
  CatalogSnapshotStore,
  CatalogStorageFailure,
  CatalogStorageFailureCode,
  ImportSummary,
  SourceBookmark,
  SourceBookmarkFolder,
  SourceBookmarkNode,
  SourceBookmarkNodeBase,
} from "../../modules/catalog/public.js";
import type {
  BookmarkId,
  IsoDateTime,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type SourceShape = Assert<Equal<BookmarkSource, "chrome_api" | "chrome_html">>;
type FailureCodes = Assert<
  Equal<
    CatalogImportFailureCode,
    | "invalid_captured_at"
    | "invalid_node"
    | "empty_source_id"
    | "duplicate_source_id"
    | "invalid_date"
    | "empty_url"
    | "cyclic_tree"
  >
>;
type FailureFields = Assert<
  Equal<
    CatalogImportFailureField,
    | "capturedAt"
    | "sourceId"
    | "dateAdded"
    | "dateModified"
    | "dateLastUsed"
    | "url"
    | "children"
    | "node"
  >
>;
type StorageFailureCodes = Assert<
  Equal<
    CatalogStorageFailureCode,
    "snapshot_exists" | "storage_unavailable" | "stored_snapshot_invalid"
  >
>;
type FailureUnion = Assert<
  Equal<CatalogFailure, CatalogImportFailure | CatalogStorageFailure>
>;
type ImportMethod = Assert<
  Equal<
    BookmarkCatalog["importSnapshot"],
    (
      input: BookmarkSnapshotInput,
    ) => Promise<Outcome<ImportSummary, CatalogFailure>>
  >
>;
type GetMethod = Assert<
  Equal<
    BookmarkCatalog["getSnapshot"],
    (
      id: SnapshotId,
    ) => Promise<Outcome<BookmarkSnapshot | null, CatalogStorageFailure>>
  >
>;
type SaveMethod = Assert<
  Equal<
    CatalogSnapshotStore["save"],
    (
      snapshot: BookmarkSnapshot,
    ) => Promise<Outcome<void, CatalogStorageFailure>>
  >
>;
type LoadMethod = Assert<
  Equal<
    CatalogSnapshotStore["load"],
    (
      id: SnapshotId,
    ) => Promise<Outcome<BookmarkSnapshot | null, CatalogStorageFailure>>
  >
>;
type NextSnapshotIdMethod = Assert<
  Equal<CatalogIdFactory["nextSnapshotId"], () => SnapshotId>
>;
type NextBookmarkIdMethod = Assert<
  Equal<CatalogIdFactory["nextBookmarkId"], () => BookmarkId>
>;

declare const bookmarkId: BookmarkId;
declare const snapshotId: SnapshotId;
declare const capturedAt: IsoDateTime;

const folder: SourceBookmarkFolder = {
  kind: "folder",
  sourceId: "root",
  title: "Root",
  children: [],
};
const bookmark: SourceBookmark = {
  kind: "bookmark",
  sourceId: "bookmark",
  title: "Bookmark",
  url: "chrome://bookmarks/",
};
const sourceBase: SourceBookmarkNodeBase = bookmark;
const sourceNode: SourceBookmarkNode = Math.random() > 0.5 ? folder : bookmark;
const input: BookmarkSnapshotInput = {
  source: "chrome_html",
  capturedAt,
  roots: [sourceNode],
};

const recordFolder: BookmarkFolderRecord = {
  id: bookmarkId,
  kind: "folder",
  sourceId: "root",
  title: "Root",
  children: [],
};
const recordBase: BookmarkRecordBase = recordFolder;
const recordLink: BookmarkLinkRecord = {
  id: bookmarkId,
  kind: "bookmark",
  sourceId: "bookmark",
  title: "Bookmark",
  url: "https://example.com/",
};
const record: BookmarkRecord = recordFolder;
const snapshot: BookmarkSnapshot = {
  id: snapshotId,
  source: "chrome_html",
  capturedAt,
  roots: [record],
  rootCount: 1,
  folderCount: 1,
  bookmarkCount: 0,
};

// @ts-expect-error folders do not have URLs
folder.url = "https://example.com/";
// @ts-expect-error bookmarks do not have children
bookmark.children = [];
// @ts-expect-error recursive trees do not expose parent IDs
folder.parentSourceId = "parent";
// @ts-expect-error recursive trees do not expose sibling indexes
bookmark.index = 0;
// @ts-expect-error source is a fixed enum
const invalidSource: BookmarkSource = "firefox_html";

void (null as unknown as SourceShape);
void (null as unknown as FailureCodes);
void (null as unknown as FailureFields);
void (null as unknown as StorageFailureCodes);
void (null as unknown as FailureUnion);
void (null as unknown as ImportMethod);
void (null as unknown as GetMethod);
void (null as unknown as SaveMethod);
void (null as unknown as LoadMethod);
void (null as unknown as NextSnapshotIdMethod);
void (null as unknown as NextBookmarkIdMethod);
void input;
void sourceBase;
void recordBase;
void recordLink;
void snapshot;
void invalidSource;
