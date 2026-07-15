import type {
  BookmarkId,
  JobBatchId,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";
import type { BookmarkCatalog } from "../../modules/catalog/public.js";
import type {
  JobBatchSummary,
  JobEnqueuer,
} from "../../modules/jobs/public.js";
import type {
  ProcessingPreview,
  ProcessingPreviewFailure,
  ProcessingRunId,
  ProcessingStart,
  ProcessingStartFailure,
  ProcessingStarter,
  ProcessingStarterDependencies,
  ProcessingStartRequest,
} from "../../modules/processing/public.js";
import { createProcessingStarter } from "../../modules/processing/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type RunIdContract = Assert<Equal<ProcessingRunId,
  string & { readonly __brand: "ProcessingRunId" }
>>;
type StartRequestContract = Assert<Equal<ProcessingStartRequest, {
  readonly snapshotId: SnapshotId;
  readonly folderId: BookmarkId;
  readonly profileId: "health_check_v1";
  readonly runId: ProcessingRunId;
}>>;
type StartContract = Assert<Equal<ProcessingStart, {
  readonly preview: ProcessingPreview;
  readonly batch: JobBatchSummary;
}>>;
type StartFailureContract = Assert<Equal<ProcessingStartFailure,
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
    }
>>;
type StarterDependenciesContract = Assert<Equal<ProcessingStarterDependencies, {
  readonly catalog: Pick<BookmarkCatalog, "getSnapshot">;
  readonly jobs: JobEnqueuer;
}>>;
type StarterContract = Assert<Equal<ProcessingStarter, {
  start(
    request: ProcessingStartRequest,
  ): Promise<Outcome<ProcessingStart, ProcessingStartFailure>>;
}>>;
type StarterFactoryContract = Assert<Equal<typeof createProcessingStarter,
  (dependencies: ProcessingStarterDependencies) => ProcessingStarter
>>;

declare const starter: ProcessingStarter;
declare const batchId: JobBatchId;
// @ts-expect-error run identity is branded
const unbrandedRunId: ProcessingRunId = "run-1";
// @ts-expect-error a batch identity is not a Processing run identity
const batchAsRunId: ProcessingRunId = batchId;
// @ts-expect-error start requires runId
void starter.start({
  snapshotId: "snapshot-1" as SnapshotId,
  folderId: "folder-1" as BookmarkId,
  profileId: "health_check_v1",
});

void (null as unknown as RunIdContract);
void (null as unknown as StartRequestContract);
void (null as unknown as StartContract);
void (null as unknown as StartFailureContract);
void (null as unknown as StarterDependenciesContract);
void (null as unknown as StarterContract);
void (null as unknown as StarterFactoryContract);
void unbrandedRunId;
void batchAsRunId;
