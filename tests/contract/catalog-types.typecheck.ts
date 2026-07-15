import type {
  BookmarkId,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";
import type {
  BookmarkCatalog,
  BookmarkLinkRecord,
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
} from "../../modules/catalog/public.js";
import {
  createBookmarkCatalog,
  createCryptoCatalogIdFactory,
  type CatalogServiceDependencies,
} from "../../modules/catalog/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type Sources = Assert<Equal<BookmarkSource, "chrome_api" | "chrome_html">>;
type ImportFailures = Assert<Equal<CatalogImportFailureCode,
  | "invalid_captured_at"
  | "invalid_node"
  | "empty_source_id"
  | "duplicate_source_id"
  | "invalid_date"
  | "empty_url"
  | "cyclic_tree"
>>;
type FailureFields = Assert<Equal<CatalogImportFailureField,
  | "capturedAt"
  | "sourceId"
  | "dateAdded"
  | "dateModified"
  | "dateLastUsed"
  | "url"
  | "children"
  | "node"
>>;
type StorageFailures = Assert<Equal<CatalogStorageFailureCode,
  "snapshot_exists" | "storage_unavailable" | "stored_snapshot_invalid"
>>;
type Failures = Assert<Equal<CatalogFailure,
  CatalogImportFailure | CatalogStorageFailure
>>;
type SourceNodes = Assert<Equal<SourceBookmarkNode,
  SourceBookmarkFolder | SourceBookmark
>>;

type CatalogContract = Assert<Equal<BookmarkCatalog, {
  importSnapshot(input: BookmarkSnapshotInput): Promise<Outcome<ImportSummary, CatalogFailure>>;
  getSnapshot(id: SnapshotId): Promise<Outcome<BookmarkSnapshot | null, CatalogStorageFailure>>;
  getBookmark(id: BookmarkId): Promise<Outcome<BookmarkLinkRecord | null, CatalogStorageFailure>>;
}>>;
type StoreContract = Assert<Equal<CatalogSnapshotStore, {
  save(snapshot: BookmarkSnapshot): Promise<Outcome<void, CatalogStorageFailure>>;
  load(id: SnapshotId): Promise<Outcome<BookmarkSnapshot | null, CatalogStorageFailure>>;
  loadBookmark(id: BookmarkId): Promise<Outcome<BookmarkLinkRecord | null, CatalogStorageFailure>>;
}>>;
type IdFactoryContract = Assert<Equal<CatalogIdFactory, {
  nextSnapshotId(): SnapshotId;
  nextBookmarkId(): BookmarkId;
}>>;
type CatalogFactoryContract = Assert<Equal<
  typeof createBookmarkCatalog,
  (dependencies: CatalogServiceDependencies) => BookmarkCatalog
>>;
type IdFactoryCreatorContract = Assert<Equal<
  typeof createCryptoCatalogIdFactory,
  () => CatalogIdFactory
>>;

declare const folder: SourceBookmarkFolder;
declare const bookmark: SourceBookmark;
declare const bookmarkId: BookmarkId;
// @ts-expect-error folders do not have URLs
folder.url = "https://example.com/";
// @ts-expect-error bookmarks do not have children
bookmark.children = [];
// @ts-expect-error source nodes expose no parent metadata
folder.parentSourceId = "parent";
// @ts-expect-error source nodes expose no sibling indexes
bookmark.index = 0;
// @ts-expect-error sources are closed
const invalidSource: BookmarkSource = "firefox_html";
// @ts-expect-error Catalog identities use distinct brands
const wrongSnapshotId: SnapshotId = bookmarkId;

void (null as unknown as Sources);
void (null as unknown as ImportFailures);
void (null as unknown as FailureFields);
void (null as unknown as StorageFailures);
void (null as unknown as Failures);
void (null as unknown as SourceNodes);
void (null as unknown as CatalogContract);
void (null as unknown as StoreContract);
void (null as unknown as IdFactoryContract);
void (null as unknown as CatalogFactoryContract);
void (null as unknown as IdFactoryCreatorContract);
void invalidSource;
void wrongSnapshotId;
