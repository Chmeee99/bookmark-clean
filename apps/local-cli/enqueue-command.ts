import type {
  BookmarkId,
  SnapshotId,
} from "../../core/contracts/public.js";
import type {
  BookmarkCatalog,
  CatalogIdFactory,
} from "../../modules/catalog/public.js";
import type {
  JobEnqueuer,
  JobEnqueuerDependencies,
} from "../../modules/jobs/public.js";
import type {
  ProcessingRunId,
  ProcessingStart,
  ProcessingStartFailure,
  ProcessingStarter,
} from "../../modules/processing/public.js";
import type { NodeRuntimePorts } from "../../adapters/node/public.js";
import type {
  BookmarkCleanDatabaseFailure,
  BookmarkCleanDatabaseSession,
} from "../../adapters/sqlite/public.js";

export interface EnqueueCommandSuccess extends ProcessingStart {
  readonly ok: true;
  readonly runId: ProcessingRunId;
}

export interface EnqueueCommandFailure {
  readonly ok: false;
  readonly code:
    | "invalid_arguments"
    | "storage_unavailable"
    | "snapshot_invalid"
    | "snapshot_not_found"
    | "folder_not_found"
    | "estimate_overflow"
    | "empty_selection"
    | "run_conflict"
    | "enqueue_rejected"
    | "unexpected_failure";
}

type FailureExitCode = 1 | 2 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type EnqueueCommandResult =
  | { readonly exitCode: 0; readonly output: EnqueueCommandSuccess }
  | { readonly exitCode: FailureExitCode; readonly output: EnqueueCommandFailure };

export type RunEnqueueCommand = (
  arguments_: readonly string[],
) => Promise<EnqueueCommandResult>;

interface CatalogRuntime {
  createBookmarkCatalog(dependencies: {
    readonly idFactory: CatalogIdFactory;
    readonly store: BookmarkCleanDatabaseSession["catalogStore"];
  }): BookmarkCatalog;
  createCryptoCatalogIdFactory(): CatalogIdFactory;
}

interface JobsRuntime {
  createJobEnqueuer(dependencies: JobEnqueuerDependencies): JobEnqueuer;
}

interface ProcessingRuntime {
  createProcessingStarter(dependencies: {
    readonly catalog: BookmarkCatalog;
    readonly jobs: JobEnqueuer;
  }): ProcessingStarter;
}

interface NodeRuntime {
  createNodeRuntimePorts(): NodeRuntimePorts;
}

interface SqliteRuntime {
  openBookmarkCleanDatabase(databasePath: string):
    | { readonly ok: true; readonly value: BookmarkCleanDatabaseSession }
    | { readonly ok: false; readonly error: BookmarkCleanDatabaseFailure };
}

interface EnqueueOptions {
  readonly databasePath: string;
  readonly snapshotId: string;
  readonly folderId: string;
  readonly runId: string;
}

declare const require: (specifier: string) => unknown;
declare const module: { exports: { runEnqueueCommand: RunEnqueueCommand } };

const load = require as unknown as (specifier: string) => unknown;
const { createBookmarkCatalog, createCryptoCatalogIdFactory } = load(
  "../../modules/catalog/public.ts",
) as CatalogRuntime;
const { createJobEnqueuer } = load(
  "../../modules/jobs/public.ts",
) as JobsRuntime;
const { createProcessingStarter } = load(
  "../../modules/processing/public.ts",
) as ProcessingRuntime;
const { createNodeRuntimePorts } = load(
  "../../adapters/node/public.ts",
) as NodeRuntime;
const { openBookmarkCleanDatabase } = load(
  "../../adapters/sqlite/public.ts",
) as SqliteRuntime;

function parseArguments(arguments_: readonly string[]): EnqueueOptions | undefined {
  if (arguments_.length !== 8) return undefined;
  const values = new Map<string, string>();

  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (
      value.length === 0
      || values.has(flag)
      || !["--database", "--snapshot", "--folder", "--run"].includes(flag)
    ) {
      return undefined;
    }
    values.set(flag, value);
  }

  const databasePath = values.get("--database");
  const snapshotId = values.get("--snapshot");
  const folderId = values.get("--folder");
  const runId = values.get("--run");
  if (
    databasePath === undefined
    || snapshotId === undefined
    || folderId === undefined
    || runId === undefined
  ) {
    return undefined;
  }
  return { databasePath, snapshotId, folderId, runId };
}

function failure(
  exitCode: FailureExitCode,
  code: EnqueueCommandFailure["code"],
): EnqueueCommandResult {
  return { exitCode, output: { ok: false, code } };
}

function processingFailure(error: ProcessingStartFailure): EnqueueCommandResult {
  switch (error.code) {
    case "catalog_unavailable":
    case "queue_unavailable":
      return failure(4, "storage_unavailable");
    case "snapshot_invalid":
      return failure(5, "snapshot_invalid");
    case "snapshot_not_found":
      return failure(6, "snapshot_not_found");
    case "folder_not_found":
      return failure(7, "folder_not_found");
    case "estimate_overflow":
      return failure(8, "estimate_overflow");
    case "empty_selection":
      return failure(9, "empty_selection");
    case "run_conflict":
      return failure(10, "run_conflict");
    case "enqueue_rejected":
      return failure(11, "enqueue_rejected");
    case "invalid_request":
      throw new Error("Processing rejected validated CLI arguments");
  }
}

function success(runId: ProcessingRunId, started: ProcessingStart): EnqueueCommandResult {
  return {
    exitCode: 0,
    output: {
      ok: true,
      runId,
      preview: started.preview,
      batch: started.batch,
    },
  };
}

const runEnqueueCommand: RunEnqueueCommand = async (arguments_) => {
  const options = parseArguments(arguments_);
  if (options === undefined) return failure(2, "invalid_arguments");

  const opened = openBookmarkCleanDatabase(options.databasePath);
  if (!opened.ok) return failure(4, "storage_unavailable");

  try {
    const runtime = createNodeRuntimePorts();
    const catalog = createBookmarkCatalog({
      idFactory: createCryptoCatalogIdFactory(),
      store: opened.value.catalogStore,
    });
    const jobs = createJobEnqueuer({
      clock: runtime.clock,
      idFactory: runtime.jobIdFactory,
      store: opened.value.jobQueueStore,
    });
    const starter = createProcessingStarter({ catalog, jobs });
    const runId = options.runId as ProcessingRunId;
    const started = await starter.start({
      snapshotId: options.snapshotId as SnapshotId,
      folderId: options.folderId as BookmarkId,
      profileId: "health_check_v1",
      runId,
    });
    return started.ok ? success(runId, started.value) : processingFailure(started.error);
  } finally {
    opened.value.close();
  }
};

module.exports = { runEnqueueCommand };
