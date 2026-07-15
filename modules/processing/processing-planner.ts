import type {
  BookmarkCatalog,
  BookmarkFolderRecord,
  BookmarkRecord,
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

function findFolder(
  records: readonly BookmarkRecord[],
  folderId: string,
): BookmarkFolderRecord | undefined {
  for (const record of records) {
    if (record.kind === "folder") {
      if (record.id === folderId) return record;
      const nested = findFolder(record.children, folderId);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function collectBookmarkIds(
  records: readonly BookmarkRecord[],
  bookmarkIds: BookmarkId[] = [],
): readonly BookmarkId[] {
  for (const record of records) {
    if (record.kind === "bookmark") {
      bookmarkIds.push(record.id);
    } else {
      collectBookmarkIds(record.children, bookmarkIds);
    }
  }
  return bookmarkIds;
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
): Outcome<ResolvedSelection, ProcessingPreviewFailure> {
  const bookmarkIds = collectBookmarkIds(folder.children);
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

  const folder = findFolder(loaded.value.roots, request.folderId);
  if (folder === undefined) return previewFailure("folder_not_found");
  return buildSelection(request, folder);
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
