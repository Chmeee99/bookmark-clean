import type {
  BookmarkCatalog,
  BookmarkFolderRecord,
  BookmarkRecord,
  CatalogResourceLimits,
  CatalogStorageFailure,
} from "../catalog/public.js";
import type {
  ProcessingPlanner,
  ProcessingPreview,
  ProcessingPreviewFailure,
  ProcessingPreviewRequest,
  ProcessingStart,
  ProcessingStartFailure,
  ProcessingStarter,
  ProcessingStarterDependencies,
  ProcessingStartRequest,
  ProcessingWorkProfile,
} from "./public.js";
import type {
  EnqueueBatchRequest,
  JobQueueFailure,
} from "../jobs/public.js";
import type { BookmarkId, Outcome } from "../../core/contracts/public.js";

const HEALTH_CHECK_V1: ProcessingWorkProfile = Object.freeze({
  id: "health_check_v1",
  jobType: "health_check",
  maximumJobAttempts: 1,
  maximumNetworkRequestsPerJob: 6,
  maximumModelCallsPerJob: 0,
});

declare const module: {
  exports: {
    createProcessingPlanner: typeof createProcessingPlanner;
    createProcessingStarter: typeof createProcessingStarter;
  };
};

interface ResolvedSelection {
  readonly preview: ProcessingPreview;
  readonly bookmarkIds: readonly BookmarkId[];
}

interface TraversedSelection {
  readonly folder?: BookmarkFolderRecord;
  readonly bookmarkIds: readonly BookmarkId[];
}

interface TraversalFrame {
  readonly record: BookmarkRecord;
  readonly depth: number;
  readonly insideSelection: boolean;
}

interface CatalogRuntime {
  readonly CATALOG_RESOURCE_LIMITS: CatalogResourceLimits;
}

declare const require: (specifier: "../catalog/public.ts") => unknown;
const { CATALOG_RESOURCE_LIMITS } = require(
  "../catalog/public.ts",
) as CatalogRuntime;

function previewFailure<Value>(
  code: ProcessingPreviewFailure["code"],
): Outcome<Value, ProcessingPreviewFailure> {
  return { ok: false, error: { code } };
}

function startFailure(
  code:
    | ProcessingPreviewFailure["code"]
    | "empty_selection"
    | "run_conflict"
    | "queue_unavailable",
): Outcome<never, ProcessingStartFailure> {
  return { ok: false, error: { code } };
}

function validRequest(request: ProcessingPreviewRequest): boolean {
  return (
    typeof request.snapshotId === "string" &&
    request.snapshotId.length > 0 &&
    typeof request.folderId === "string" &&
    request.folderId.length > 0 &&
    request.profileId === "health_check_v1"
  );
}

function validStartRequest(request: ProcessingStartRequest): boolean {
  return (
    validRequest(request) &&
    typeof request.runId === "string" &&
    request.runId.length > 0
  );
}

function traverseSelection(
  records: readonly BookmarkRecord[],
  folderId: string,
): Outcome<TraversedSelection, ProcessingPreviewFailure> {
  const frames: TraversalFrame[] = [];
  const bookmarkIds: BookmarkId[] = [];
  let folder: BookmarkFolderRecord | undefined;
  let nodeCount = 0;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    frames.push({
      record: records[index],
      depth: 1,
      insideSelection: false,
    });
  }

  while (frames.length > 0) {
    const frame = frames.pop() as TraversalFrame;
    if (frame.depth > CATALOG_RESOURCE_LIMITS.maximumDepth) {
      return previewFailure("snapshot_invalid");
    }
    nodeCount += 1;
    if (nodeCount > CATALOG_RESOURCE_LIMITS.maximumNodes) {
      return previewFailure("snapshot_invalid");
    }

    if (frame.record.kind === "bookmark") {
      if (frame.insideSelection) bookmarkIds.push(frame.record.id);
      continue;
    }

    const selectedHere = folder === undefined && frame.record.id === folderId;
    if (selectedHere) folder = frame.record;
    const insideSelection = frame.insideSelection || selectedHere;
    for (let index = frame.record.children.length - 1; index >= 0; index -= 1) {
      frames.push({
        record: frame.record.children[index],
        depth: frame.depth + 1,
        insideSelection,
      });
    }
  }

  return {
    ok: true,
    value: {
      ...(folder === undefined ? {} : { folder }),
      bookmarkIds,
    },
  };
}

function catalogFailure<Value>(
  error: CatalogStorageFailure,
): Outcome<Value, ProcessingPreviewFailure> {
  switch (error.code) {
    case "storage_unavailable":
      return previewFailure("catalog_unavailable");
    case "stored_snapshot_invalid":
      return previewFailure("snapshot_invalid");
    case "snapshot_exists":
      throw new Error("Catalog returned an invalid read failure code");
  }
}

function buildSelection(
  request: ProcessingPreviewRequest,
  folder: BookmarkFolderRecord,
  bookmarkIds: readonly BookmarkId[],
): Outcome<ResolvedSelection, ProcessingPreviewFailure> {
  const bookmarkCount = bookmarkIds.length;
  const maximumNetworkRequests =
    bookmarkCount * HEALTH_CHECK_V1.maximumNetworkRequestsPerJob;
  if (
    !Number.isSafeInteger(bookmarkCount) ||
    !Number.isSafeInteger(maximumNetworkRequests)
  ) {
    return previewFailure("estimate_overflow");
  }

  return {
    ok: true,
    value: {
      preview: {
        snapshotId: request.snapshotId,
        folderId: request.folderId,
        folderTitle: folder.title,
        profile: HEALTH_CHECK_V1,
        bookmarkCount,
        jobCount: bookmarkCount,
        maximumNetworkRequests,
        maximumModelCalls: 0,
      },
      bookmarkIds,
    },
  };
}

async function resolveSelection(
  catalog: Pick<BookmarkCatalog, "getSnapshot">,
  request: ProcessingPreviewRequest,
): Promise<Outcome<ResolvedSelection, ProcessingPreviewFailure>> {
  if (!validRequest(request)) return previewFailure("invalid_request");

  const loaded = await catalog.getSnapshot(request.snapshotId);
  if (!loaded.ok) return catalogFailure(loaded.error);
  if (loaded.value === null) return previewFailure("snapshot_not_found");

  const traversed = traverseSelection(loaded.value.roots, request.folderId);
  if (!traversed.ok) return traversed;
  if (traversed.value.folder === undefined) {
    return previewFailure("folder_not_found");
  }
  return buildSelection(
    request,
    traversed.value.folder,
    traversed.value.bookmarkIds,
  );
}

function encodeTuple(parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

function inputVersion(request: ProcessingStartRequest): string {
  return `processing-input-v1|${encodeTuple([
    request.profileId,
    request.snapshotId,
    request.runId,
  ])}`;
}

function batchKey(request: ProcessingStartRequest): string {
  return `processing-batch-v1|${encodeTuple([
    request.snapshotId,
    request.folderId,
    request.profileId,
    request.runId,
  ])}`;
}

function queueFailure(
  error: JobQueueFailure,
): Outcome<never, ProcessingStartFailure> {
  switch (error.code) {
    case "empty_batch":
      return startFailure("empty_selection");
    case "idempotency_conflict":
      return startFailure("run_conflict");
    case "storage_unavailable":
      return startFailure("queue_unavailable");
    case "invalid_request":
    case "batch_not_found":
    case "stale_lease":
    case "invalid_transition":
      return {
        ok: false,
        error: { code: "enqueue_rejected", queueCode: error.code },
      };
  }
}

function createProcessingPlanner(catalog: BookmarkCatalog): ProcessingPlanner {
  return {
    async preview(request) {
      const resolved = await resolveSelection(catalog, request);
      if (!resolved.ok) return resolved;
      return { ok: true, value: resolved.value.preview };
    },
  };
}

function createProcessingStarter({
  catalog,
  jobs,
}: ProcessingStarterDependencies): ProcessingStarter {
  return {
    async start(request): Promise<Outcome<ProcessingStart, ProcessingStartFailure>> {
      if (!validStartRequest(request)) return startFailure("invalid_request");

      const resolved = await resolveSelection(catalog, request);
      if (!resolved.ok) return resolved;
      if (resolved.value.bookmarkIds.length === 0) {
        return startFailure("empty_selection");
      }

      const version = inputVersion(request);
      const enqueueRequest: EnqueueBatchRequest = {
        idempotencyKey: batchKey(request),
        jobs: resolved.value.bookmarkIds.map((bookmarkId, sequence) => ({
          type: HEALTH_CHECK_V1.jobType,
          target: { kind: "bookmark", bookmarkId, inputVersion: version },
          priority: 0,
          sequence,
          maxAttempts: HEALTH_CHECK_V1.maximumJobAttempts,
        })),
      };
      const queued = await jobs.enqueue(enqueueRequest);
      if (!queued.ok) return queueFailure(queued.error);
      return {
        ok: true,
        value: { preview: resolved.value.preview, batch: queued.value },
      };
    },
  };
}

module.exports = { createProcessingPlanner, createProcessingStarter };
