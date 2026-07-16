import type { SnapshotId } from "../../core/contracts/public.js";
import type {
  BookmarkCatalog,
  CatalogIdFactory,
  CatalogInspection,
  CatalogInspectionFolder,
  CatalogInspector,
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
  createCatalogInspector(
    catalog: Pick<BookmarkCatalog, "getSnapshot">,
  ): CatalogInspector;
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

interface MutableInspectFolder {
  id: string;
  title: string;
  bookmarkCount: number;
  children: InspectFolder[];
}

interface FormatFrame {
  readonly source: CatalogInspectionFolder;
  readonly target: InspectFolder[];
}

declare const require: (specifier: string) => unknown;
declare const module: {
  exports: { runInspectCommand: RunInspectCommand };
};

const loadModule = require as unknown as (specifier: string) => unknown;
const {
  createBookmarkCatalog,
  createCatalogInspector,
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

function formatFolders(folders: readonly CatalogInspectionFolder[]): InspectFolder[] {
  const formatted: InspectFolder[] = [];
  const frames: FormatFrame[] = [];
  for (let index = folders.length - 1; index >= 0; index -= 1) {
    frames.push({ source: folders[index], target: formatted });
  }
  while (frames.length > 0) {
    const { source, target } = frames.pop() as FormatFrame;
    const children: InspectFolder[] = [];
    const folder: MutableInspectFolder = {
      id: source.id,
      title: source.title,
      bookmarkCount: source.bookmarkCount,
      children,
    };
    target.push(folder);
    for (let index = source.folders.length - 1; index >= 0; index -= 1) {
      frames.push({ source: source.folders[index], target: children });
    }
  }
  return formatted;
}

function success(inspection: CatalogInspection): InspectCommandResult {
  return {
    exitCode: 0,
    output: {
      ok: true,
      snapshotId: inspection.snapshotId,
      capturedAt: inspection.capturedAt,
      rootCount: inspection.rootCount,
      folderCount: inspection.folderCount,
      bookmarkCount: inspection.bookmarkCount,
      folders: formatFolders(inspection.folders),
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
    const inspector = createCatalogInspector(catalog);
    const loaded = await inspector.inspectSnapshot(options.snapshotId as SnapshotId);
    if (!loaded.ok) return catalogFailure(loaded.error);
    if (loaded.value === null) return failure(6, "snapshot_not_found");
    return success(loaded.value);
  } finally {
    opened.value.close();
  }
};

module.exports = { runInspectCommand };
