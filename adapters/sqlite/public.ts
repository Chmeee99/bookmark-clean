import type { Outcome } from "../../core/contracts/public.js";
import type { CatalogSnapshotStore } from "../../modules/catalog/public.js";

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

interface CatalogDatabaseRuntime {
  openCatalogDatabase: typeof openCatalogDatabase;
}

declare const require: (specifier: "./catalog-database.ts") => unknown;
declare const module: {
  exports: { openCatalogDatabase: typeof openCatalogDatabase };
};

const { openCatalogDatabase: openCatalogDatabaseRuntime } = require(
  "./catalog-database.ts",
) as CatalogDatabaseRuntime;

module.exports = { openCatalogDatabase: openCatalogDatabaseRuntime };
