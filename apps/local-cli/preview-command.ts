import type { BookmarkId, SnapshotId } from "../../core/contracts/public.js";
import type {
  BookmarkCatalog,
  CatalogIdFactory,
} from "../../modules/catalog/public.js";
import type {
  ProcessingPlanner,
  ProcessingPreview,
  ProcessingPreviewFailure,
} from "../../modules/processing/public.js";
import type {
  CatalogDatabaseFailure,
  CatalogDatabaseSession,
} from "../../adapters/sqlite/public.js";

export interface PreviewCommandSuccess extends ProcessingPreview {
  readonly ok: true;
}

export interface PreviewCommandFailure {
  readonly ok: false;
  readonly code:
    | "invalid_arguments"
    | "storage_unavailable"
    | "snapshot_invalid"
    | "snapshot_not_found"
    | "folder_not_found"
    | "estimate_overflow"
    | "unexpected_failure";
}

export type PreviewCommandResult =
  | { readonly exitCode: 0; readonly output: PreviewCommandSuccess }
  | {
      readonly exitCode: 1 | 2 | 4 | 5 | 6 | 7 | 8;
      readonly output: PreviewCommandFailure;
    };

export type RunPreviewCommand = (
  arguments_: readonly string[],
) => Promise<PreviewCommandResult>;

interface CatalogRuntime {
  createBookmarkCatalog(dependencies: {
    readonly idFactory: CatalogIdFactory;
    readonly store: CatalogDatabaseSession["store"];
  }): BookmarkCatalog;
  createCryptoCatalogIdFactory(): CatalogIdFactory;
}

interface ProcessingRuntime {
  createProcessingPlanner(catalog: BookmarkCatalog): ProcessingPlanner;
}

interface SqliteRuntime {
  openCatalogDatabase(databasePath: string):
    | { readonly ok: true; readonly value: CatalogDatabaseSession }
    | { readonly ok: false; readonly error: CatalogDatabaseFailure };
}

interface PreviewOptions {
  readonly databasePath: string;
  readonly snapshotId: string;
  readonly folderId: string;
}

declare const require: (specifier: string) => unknown;
declare const module: { exports: { runPreviewCommand: RunPreviewCommand } };

const load = require as unknown as (specifier: string) => unknown;
const { createBookmarkCatalog, createCryptoCatalogIdFactory } = load(
  "../../modules/catalog/public.ts",
) as CatalogRuntime;
const { createProcessingPlanner } = load(
  "../../modules/processing/public.ts",
) as ProcessingRuntime;
const { openCatalogDatabase } = load(
  "../../adapters/sqlite/public.ts",
) as SqliteRuntime;

function parseArguments(arguments_: readonly string[]): PreviewOptions | undefined {
  if (arguments_.length !== 6) return undefined;
  let databasePath: string | undefined;
  let snapshotId: string | undefined;
  let folderId: string | undefined;

  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (value.length === 0) return undefined;
    if (flag === "--database" && databasePath === undefined) {
      databasePath = value;
    } else if (flag === "--snapshot" && snapshotId === undefined) {
      snapshotId = value;
    } else if (flag === "--folder" && folderId === undefined) {
      folderId = value;
    } else {
      return undefined;
    }
  }

  if (databasePath === undefined || snapshotId === undefined || folderId === undefined) {
    return undefined;
  }
  return { databasePath, snapshotId, folderId };
}

function failure(
  exitCode: 1 | 2 | 4 | 5 | 6 | 7 | 8,
  code: PreviewCommandFailure["code"],
): PreviewCommandResult {
  return { exitCode, output: { ok: false, code } };
}

function processingFailure(error: ProcessingPreviewFailure): PreviewCommandResult {
  switch (error.code) {
    case "catalog_unavailable":
      return failure(4, "storage_unavailable");
    case "snapshot_invalid":
      return failure(5, "snapshot_invalid");
    case "snapshot_not_found":
      return failure(6, "snapshot_not_found");
    case "folder_not_found":
      return failure(7, "folder_not_found");
    case "estimate_overflow":
      return failure(8, "estimate_overflow");
    case "invalid_request":
      throw new Error("Processing rejected validated CLI arguments");
  }
}

function success(preview: ProcessingPreview): PreviewCommandResult {
  return { exitCode: 0, output: { ok: true, ...preview } };
}

const runPreviewCommand: RunPreviewCommand = async (arguments_) => {
  const options = parseArguments(arguments_);
  if (options === undefined) return failure(2, "invalid_arguments");

  const opened = openCatalogDatabase(options.databasePath);
  if (!opened.ok) return failure(4, "storage_unavailable");

  try {
    const catalog = createBookmarkCatalog({
      idFactory: createCryptoCatalogIdFactory(),
      store: opened.value.store,
    });
    const planner = createProcessingPlanner(catalog);
    const preview = await planner.preview({
      snapshotId: options.snapshotId as SnapshotId,
      folderId: options.folderId as BookmarkId,
      profileId: "health_check_v1",
    });
    return preview.ok ? success(preview.value) : processingFailure(preview.error);
  } finally {
    opened.value.close();
  }
};

module.exports = { runPreviewCommand };
