import type { Outcome } from "../../core/contracts/public.js";
import type { CatalogSnapshotStore } from "../../modules/catalog/public.js";
import type { HealthObservationRepository } from "../../modules/health/public.js";
import type { JobQueueStore } from "../../modules/jobs/public.js";

export interface CatalogDatabaseFailure {
  readonly code: "storage_unavailable";
}

export interface CatalogDatabaseSession {
  readonly store: CatalogSnapshotStore;
  close(): void;
}

export declare function openCatalogDatabase(
  databasePath: string,
): Outcome<CatalogDatabaseSession, CatalogDatabaseFailure>;

export interface BookmarkCleanDatabaseFailure {
  readonly code: "storage_unavailable";
}

export interface BookmarkCleanDatabaseSession {
  readonly catalogStore: CatalogSnapshotStore;
  readonly jobQueueStore: JobQueueStore;
  readonly healthRepository: HealthObservationRepository;
  close(): void;
}

export declare function openBookmarkCleanDatabase(
  databasePath: string,
): Outcome<BookmarkCleanDatabaseSession, BookmarkCleanDatabaseFailure>;

interface CatalogDatabaseRuntime {
  openCatalogDatabase: typeof openCatalogDatabase;
}

interface BookmarkCleanDatabaseRuntime {
  openBookmarkCleanDatabase: typeof openBookmarkCleanDatabase;
}

declare const require: (
  specifier: "./catalog-database.ts" | "./bookmark-clean-database.ts",
) => unknown;
declare const module: {
  exports: {
    openCatalogDatabase: typeof openCatalogDatabase;
    openBookmarkCleanDatabase: typeof openBookmarkCleanDatabase;
  };
};

const { openCatalogDatabase: openCatalogDatabaseRuntime } = require(
  "./catalog-database.ts",
) as CatalogDatabaseRuntime;
const { openBookmarkCleanDatabase: openBookmarkCleanDatabaseRuntime } = require(
  "./bookmark-clean-database.ts",
) as BookmarkCleanDatabaseRuntime;

module.exports = {
  openCatalogDatabase: openCatalogDatabaseRuntime,
  openBookmarkCleanDatabase: openBookmarkCleanDatabaseRuntime,
};
