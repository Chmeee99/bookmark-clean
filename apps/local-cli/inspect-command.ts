import type { SnapshotId } from "../../core/contracts/public.js";
import type {
  BookmarkCatalog,
  BookmarkFolderRecord,
  BookmarkRecord,
  BookmarkSnapshot,
  CatalogIdFactory,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type {
  CatalogDatabaseFailure,
  CatalogDatabaseSession,
} from "../../adapters/sqlite/public.js";

export interface InspectFolder {
  readonly id: string;
  readonly title: string;
  readonly bookmarkCount: number;
  readonly children: readonly InspectFolder[];
}

export interface InspectCommandSuccess {
  readonly ok: true;
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
  readonly folders: readonly InspectFolder[];
}

export interface InspectCommandFailure {
  readonly ok: false;
  readonly code:
    | "invalid_arguments"
    | "storage_unavailable"
    | "snapshot_not_found"
    | "snapshot_invalid"
    | "unexpected_failure";
}

export type InspectCommandResult =
  | { readonly exitCode: 0; readonly output: InspectCommandSuccess }
  | {
      readonly exitCode: 1 | 2 | 4 | 5 | 6;
      readonly output: InspectCommandFailure;
    };

export type RunInspectCommand = (
  arguments_: readonly string[],
) => Promise<InspectCommandResult>;

interface CatalogRuntime {
  createBookmarkCatalog(dependencies: {
    readonly idFactory: CatalogIdFactory;
    readonly store: CatalogDatabaseSession["store"];
  }): BookmarkCatalog;
  createCryptoCatalogIdFactory(): CatalogIdFactory;
}

interface SqliteRuntime {
  openCatalogDatabase(databasePath: string):
    | { readonly ok: true; readonly value: CatalogDatabaseSession }
    | { readonly ok: false; readonly error: CatalogDatabaseFailure };
}

interface InspectOptions {
  readonly databasePath: string;
  readonly snapshotId: string;
}

interface ProjectedRecords {
  readonly folders: readonly InspectFolder[];
  readonly bookmarkCount: number;
}

declare const require: (specifier: string) => unknown;
declare const module: {
  exports: { runInspectCommand: RunInspectCommand };
};

const loadModule = require as unknown as (specifier: string) => unknown;
const {
  createBookmarkCatalog,
  createCryptoCatalogIdFactory,
} = loadModule("../../modules/catalog/public.ts") as CatalogRuntime;
const { openCatalogDatabase } = loadModule(
  "../../adapters/sqlite/public.ts",
) as SqliteRuntime;

function parseArguments(arguments_: readonly string[]): InspectOptions | undefined {
  if (arguments_.length !== 4) return undefined;

  let databasePath: string | undefined;
  let snapshotId: string | undefined;
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (value.length === 0) return undefined;
    if (flag === "--database" && databasePath === undefined) {
      databasePath = value;
    } else if (flag === "--snapshot" && snapshotId === undefined) {
      snapshotId = value;
    } else {
      return undefined;
    }
  }

  if (databasePath === undefined || snapshotId === undefined) return undefined;
  return { databasePath, snapshotId };
}

function failure(
  exitCode: 1 | 2 | 4 | 5 | 6,
  code: InspectCommandFailure["code"],
): InspectCommandResult {
  return { exitCode, output: { ok: false, code } };
}

function projectRecords(records: readonly BookmarkRecord[]): ProjectedRecords {
  const folders: InspectFolder[] = [];
  let bookmarkCount = 0;

  for (const record of records) {
    if (record.kind === "bookmark") {
      bookmarkCount += 1;
      continue;
    }

    const projected = projectFolder(record);
    bookmarkCount += projected.bookmarkCount;
    folders.push(projected);
  }

  return { folders, bookmarkCount };
}

function projectFolder(folder: BookmarkFolderRecord): InspectFolder {
  const children = projectRecords(folder.children);
  return {
    id: folder.id,
    title: folder.title,
    bookmarkCount: children.bookmarkCount,
    children: children.folders,
  };
}

function success(snapshot: BookmarkSnapshot): InspectCommandResult {
  return {
    exitCode: 0,
    output: {
      ok: true,
      snapshotId: snapshot.id,
      capturedAt: snapshot.capturedAt,
      rootCount: snapshot.rootCount,
      folderCount: snapshot.folderCount,
      bookmarkCount: snapshot.bookmarkCount,
      folders: projectRecords(snapshot.roots).folders,
    },
  };
}

function catalogFailure(error: CatalogStorageFailure): InspectCommandResult {
  switch (error.code) {
    case "storage_unavailable":
      return failure(4, "storage_unavailable");
    case "stored_snapshot_invalid":
      return failure(5, "snapshot_invalid");
    case "snapshot_exists":
      throw new Error("Catalog returned an invalid read failure code");
  }
}

const runInspectCommand: RunInspectCommand = async (arguments_) => {
  const options = parseArguments(arguments_);
  if (options === undefined) return failure(2, "invalid_arguments");

  const opened = openCatalogDatabase(options.databasePath);
  if (!opened.ok) return failure(4, "storage_unavailable");

  try {
    const catalog = createBookmarkCatalog({
      idFactory: createCryptoCatalogIdFactory(),
      store: opened.value.store,
    });
    const loaded = await catalog.getSnapshot(options.snapshotId as SnapshotId);
    if (!loaded.ok) return catalogFailure(loaded.error);
    if (loaded.value === null) return failure(6, "snapshot_not_found");
    return success(loaded.value);
  } finally {
    opened.value.close();
  }
};

module.exports = { runInspectCommand };
