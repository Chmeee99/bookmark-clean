import type {
  BookmarkId,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";
import type { BookmarkCatalog } from "../catalog/public.js";

export type ProcessingProfileId = "health_check_v1";

export interface ProcessingPreviewRequest {
  readonly snapshotId: SnapshotId;
  readonly folderId: BookmarkId;
  readonly profileId: ProcessingProfileId;
}

export interface ProcessingWorkProfile {
  readonly id: "health_check_v1";
  readonly jobType: "health_check";
  readonly maximumJobAttempts: 1;
  readonly maximumNetworkRequestsPerJob: 6;
  readonly maximumModelCallsPerJob: 0;
}

export interface ProcessingPreview {
  readonly snapshotId: SnapshotId;
  readonly folderId: BookmarkId;
  readonly folderTitle: string;
  readonly profile: ProcessingWorkProfile;
  readonly bookmarkCount: number;
  readonly jobCount: number;
  readonly maximumNetworkRequests: number;
  readonly maximumModelCalls: number;
}

export type ProcessingPreviewFailureCode =
  | "invalid_request"
  | "snapshot_not_found"
  | "folder_not_found"
  | "catalog_unavailable"
  | "snapshot_invalid"
  | "estimate_overflow";

export interface ProcessingPreviewFailure {
  readonly code: ProcessingPreviewFailureCode;
}

export interface ProcessingPlanner {
  preview(
    request: ProcessingPreviewRequest,
  ): Promise<Outcome<ProcessingPreview, ProcessingPreviewFailure>>;
}

export declare function createProcessingPlanner(
  catalog: BookmarkCatalog,
): ProcessingPlanner;

interface ProcessingRuntime {
  createProcessingPlanner: typeof createProcessingPlanner;
}

declare const require: (specifier: "./processing-planner.ts") => unknown;
declare const module: {
  exports: { createProcessingPlanner: typeof createProcessingPlanner };
};

const { createProcessingPlanner: createProcessingPlannerRuntime } = require(
  "./processing-planner.ts",
) as ProcessingRuntime;

module.exports = { createProcessingPlanner: createProcessingPlannerRuntime };
