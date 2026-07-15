import type {
  BookmarkId,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";
import type { BookmarkCatalog } from "../catalog/public.js";
import type {
  JobBatchSummary,
  JobEnqueuer,
} from "../jobs/public.js";

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

export type ProcessingRunId = string & {
  readonly __brand: "ProcessingRunId";
};

export interface ProcessingStartRequest extends ProcessingPreviewRequest {
  readonly runId: ProcessingRunId;
}

export interface ProcessingStart {
  readonly preview: ProcessingPreview;
  readonly batch: JobBatchSummary;
}

export type ProcessingStartFailure =
  | ProcessingPreviewFailure
  | { readonly code: "empty_selection" }
  | { readonly code: "run_conflict" }
  | { readonly code: "queue_unavailable" }
  | {
      readonly code: "enqueue_rejected";
      readonly queueCode:
        | "invalid_request"
        | "batch_not_found"
        | "stale_lease"
        | "invalid_transition";
    };

export interface ProcessingStarterDependencies {
  readonly catalog: Pick<BookmarkCatalog, "getSnapshot">;
  readonly jobs: JobEnqueuer;
}

export interface ProcessingStarter {
  start(
    request: ProcessingStartRequest,
  ): Promise<Outcome<ProcessingStart, ProcessingStartFailure>>;
}

export declare function createProcessingStarter(
  dependencies: ProcessingStarterDependencies,
): ProcessingStarter;

export declare function createProcessingPlanner(
  catalog: BookmarkCatalog,
): ProcessingPlanner;

interface ProcessingRuntime {
  createProcessingPlanner: typeof createProcessingPlanner;
  createProcessingStarter: typeof createProcessingStarter;
}

declare const require: (specifier: "./processing-planner.ts") => unknown;
declare const module: {
  exports: {
    createProcessingPlanner: typeof createProcessingPlanner;
    createProcessingStarter: typeof createProcessingStarter;
  };
};

const {
  createProcessingPlanner: createProcessingPlannerRuntime,
  createProcessingStarter: createProcessingStarterRuntime,
} = require("./processing-planner.ts") as ProcessingRuntime;

module.exports = {
  createProcessingPlanner: createProcessingPlannerRuntime,
  createProcessingStarter: createProcessingStarterRuntime,
};
