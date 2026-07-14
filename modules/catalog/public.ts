import type {
  BookmarkId,
  IsoDateTime,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";

export interface BookmarkCatalog {
  importSnapshot(
    input: BookmarkSnapshotInput,
  ): Promise<Outcome<ImportSummary, CatalogFailure>>;
  getSnapshot(
    id: SnapshotId,
  ): Promise<Outcome<BookmarkSnapshot | null, CatalogStorageFailure>>;
}

export type BookmarkSource = "chrome_api" | "chrome_html";

export interface BookmarkSnapshotInput {
  readonly source: BookmarkSource;
  readonly capturedAt: IsoDateTime;
  readonly roots: readonly SourceBookmarkNode[];
}

export interface SourceBookmarkNodeBase {
  readonly sourceId: string;
  readonly title: string;
  readonly dateAdded?: IsoDateTime;
  readonly dateModified?: IsoDateTime;
}

export interface SourceBookmarkFolder extends SourceBookmarkNodeBase {
  readonly kind: "folder";
  readonly children: readonly SourceBookmarkNode[];
}

export interface SourceBookmark extends SourceBookmarkNodeBase {
  readonly kind: "bookmark";
  readonly url: string;
  readonly dateLastUsed?: IsoDateTime;
}

export type SourceBookmarkNode = SourceBookmarkFolder | SourceBookmark;

export interface BookmarkRecordBase {
  readonly id: BookmarkId;
  readonly sourceId: string;
  readonly title: string;
  readonly dateAdded?: IsoDateTime;
  readonly dateModified?: IsoDateTime;
}

export interface BookmarkFolderRecord extends BookmarkRecordBase {
  readonly kind: "folder";
  readonly children: readonly BookmarkRecord[];
}

export interface BookmarkLinkRecord extends BookmarkRecordBase {
  readonly kind: "bookmark";
  readonly url: string;
  readonly dateLastUsed?: IsoDateTime;
}

export type BookmarkRecord = BookmarkFolderRecord | BookmarkLinkRecord;

export interface BookmarkSnapshot {
  readonly id: SnapshotId;
  readonly source: BookmarkSource;
  readonly capturedAt: IsoDateTime;
  readonly roots: readonly BookmarkRecord[];
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
}

export interface ImportSummary {
  readonly snapshotId: SnapshotId;
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
}

export type CatalogImportFailureCode =
  | "invalid_captured_at"
  | "invalid_node"
  | "empty_source_id"
  | "duplicate_source_id"
  | "invalid_date"
  | "empty_url"
  | "cyclic_tree";

export type CatalogImportFailureField =
  | "capturedAt"
  | "sourceId"
  | "dateAdded"
  | "dateModified"
  | "dateLastUsed"
  | "url"
  | "children"
  | "node";

export interface CatalogImportFailure {
  readonly code: CatalogImportFailureCode;
  readonly path: readonly number[];
  readonly field?: CatalogImportFailureField;
  readonly diagnostic?: string;
}

export type CatalogStorageFailureCode =
  | "snapshot_exists"
  | "storage_unavailable"
  | "stored_snapshot_invalid";

export interface CatalogStorageFailure {
  readonly code: CatalogStorageFailureCode;
  readonly diagnostic?: string;
}

export type CatalogFailure = CatalogImportFailure | CatalogStorageFailure;

export interface CatalogSnapshotStore {
  save(
    snapshot: BookmarkSnapshot,
  ): Promise<Outcome<void, CatalogStorageFailure>>;
  load(
    id: SnapshotId,
  ): Promise<Outcome<BookmarkSnapshot | null, CatalogStorageFailure>>;
}

export interface CatalogIdFactory {
  nextSnapshotId(): SnapshotId;
  nextBookmarkId(): BookmarkId;
}

export interface CatalogServiceDependencies {
  readonly idFactory: CatalogIdFactory;
  readonly store: CatalogSnapshotStore;
}

export declare function createBookmarkCatalog(
  dependencies: CatalogServiceDependencies,
): BookmarkCatalog;

export declare function createCryptoCatalogIdFactory(): CatalogIdFactory;

interface CatalogServiceRuntime {
  createBookmarkCatalog: typeof createBookmarkCatalog;
}

interface CatalogIdFactoryRuntime {
  createCryptoCatalogIdFactory: typeof createCryptoCatalogIdFactory;
}

declare const require: (
  specifier: "./catalog-service.ts" | "./crypto-id-factory.ts",
) => unknown;
declare const module: {
  exports: {
    createBookmarkCatalog: typeof createBookmarkCatalog;
    createCryptoCatalogIdFactory: typeof createCryptoCatalogIdFactory;
  };
};

const { createBookmarkCatalog: createBookmarkCatalogRuntime } = require(
  "./catalog-service.ts",
) as CatalogServiceRuntime;
const { createCryptoCatalogIdFactory: createCryptoCatalogIdFactoryRuntime } = require(
  "./crypto-id-factory.ts",
) as CatalogIdFactoryRuntime;

module.exports = {
  createBookmarkCatalog: createBookmarkCatalogRuntime,
  createCryptoCatalogIdFactory: createCryptoCatalogIdFactoryRuntime,
};
