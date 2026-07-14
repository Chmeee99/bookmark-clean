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
  ProcessingWorkProfile,
} from "./public.js";
import type { Outcome } from "../../core/contracts/public.js";

const HEALTH_CHECK_V1: ProcessingWorkProfile = Object.freeze({
  id: "health_check_v1",
  jobType: "health_check",
  maximumJobAttempts: 1,
  maximumNetworkRequestsPerJob: 6,
  maximumModelCallsPerJob: 0,
});

declare const module: {
  exports: { createProcessingPlanner: typeof createProcessingPlanner };
};

function failure(
  code: ProcessingPreviewFailure["code"],
): Outcome<ProcessingPreview, ProcessingPreviewFailure> {
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

function countBookmarks(records: readonly BookmarkRecord[]): number {
  let count = 0;
  for (const record of records) {
    const increment = record.kind === "bookmark"
      ? 1
      : countBookmarks(record.children);
    count += increment;
    if (!Number.isSafeInteger(count)) return Number.NaN;
  }
  return count;
}

function catalogFailure(
  error: CatalogStorageFailure,
): Outcome<ProcessingPreview, ProcessingPreviewFailure> {
  switch (error.code) {
    case "storage_unavailable":
      return failure("catalog_unavailable");
    case "stored_snapshot_invalid":
      return failure("snapshot_invalid");
    case "snapshot_exists":
      throw new Error("Catalog returned an invalid read failure code");
  }
}

function buildPreview(
  request: ProcessingPreviewRequest,
  folder: BookmarkFolderRecord,
): Outcome<ProcessingPreview, ProcessingPreviewFailure> {
  const bookmarkCount = countBookmarks(folder.children);
  const maximumNetworkRequests =
    bookmarkCount * HEALTH_CHECK_V1.maximumNetworkRequestsPerJob;
  if (
    !Number.isSafeInteger(bookmarkCount) ||
    !Number.isSafeInteger(maximumNetworkRequests)
  ) {
    return failure("estimate_overflow");
  }

  return {
    ok: true,
    value: {
      snapshotId: request.snapshotId,
      folderId: request.folderId,
      folderTitle: folder.title,
      profile: HEALTH_CHECK_V1,
      bookmarkCount,
      jobCount: bookmarkCount,
      maximumNetworkRequests,
      maximumModelCalls: 0,
    },
  };
}

function createProcessingPlanner(catalog: BookmarkCatalog): ProcessingPlanner {
  return {
    async preview(request) {
      if (!validRequest(request)) return failure("invalid_request");

      const loaded = await catalog.getSnapshot(request.snapshotId);
      if (!loaded.ok) return catalogFailure(loaded.error);
      if (loaded.value === null) return failure("snapshot_not_found");

      const folder = findFolder(loaded.value.roots, request.folderId);
      if (folder === undefined) return failure("folder_not_found");
      return buildPreview(request, folder);
    },
  };
}

module.exports = { createProcessingPlanner };
