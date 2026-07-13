import type {
  BookmarkId,
  ContentHash,
  IsoDateTime,
  JobBatchId,
  JobId,
  JobLeaseToken,
  JobResultId,
  ModelProfileId,
  Outcome,
  ReviewItemId,
  SnapshotId,
  WorkerId,
} from "../../core/contracts/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type BookmarkIdShape = Assert<
  Equal<BookmarkId, string & { readonly __brand: "BookmarkId" }>
>;
type SnapshotIdShape = Assert<
  Equal<SnapshotId, string & { readonly __brand: "SnapshotId" }>
>;
type JobIdShape = Assert<Equal<JobId, string & { readonly __brand: "JobId" }>>;
type JobBatchIdShape = Assert<
  Equal<JobBatchId, string & { readonly __brand: "JobBatchId" }>
>;
type WorkerIdShape = Assert<
  Equal<WorkerId, string & { readonly __brand: "WorkerId" }>
>;
type JobLeaseTokenShape = Assert<
  Equal<JobLeaseToken, string & { readonly __brand: "JobLeaseToken" }>
>;
type JobResultIdShape = Assert<
  Equal<JobResultId, string & { readonly __brand: "JobResultId" }>
>;
type ReviewItemIdShape = Assert<
  Equal<ReviewItemId, string & { readonly __brand: "ReviewItemId" }>
>;
type ContentHashShape = Assert<
  Equal<ContentHash, string & { readonly __brand: "ContentHash" }>
>;
type ModelProfileIdShape = Assert<
  Equal<ModelProfileId, string & { readonly __brand: "ModelProfileId" }>
>;
type IsoDateTimeShape = Assert<
  Equal<IsoDateTime, string & { readonly __brand: "IsoDateTime" }>
>;

declare const bookmarkId: BookmarkId;
declare const snapshotId: SnapshotId;
declare const jobId: JobId;
declare const jobBatchId: JobBatchId;
declare const workerId: WorkerId;
declare const jobLeaseToken: JobLeaseToken;
declare const jobResultId: JobResultId;
declare const reviewItemId: ReviewItemId;
declare const contentHash: ContentHash;
declare const modelProfileId: ModelProfileId;
declare const isoDateTime: IsoDateTime;

const brandedValuesAreStrings: readonly string[] = [
  bookmarkId,
  snapshotId,
  jobId,
  jobBatchId,
  workerId,
  jobLeaseToken,
  jobResultId,
  reviewItemId,
  contentHash,
  modelProfileId,
  isoDateTime,
];

// @ts-expect-error plain strings are not bookmark IDs
const plainBookmarkId: BookmarkId = "bookmark";
// @ts-expect-error plain strings are not snapshot IDs
const plainSnapshotId: SnapshotId = "snapshot";
// @ts-expect-error plain strings are not job IDs
const plainJobId: JobId = "job";
// @ts-expect-error plain strings are not job batch IDs
const plainJobBatchId: JobBatchId = "batch";
// @ts-expect-error plain strings are not worker IDs
const plainWorkerId: WorkerId = "worker";
// @ts-expect-error plain strings are not lease tokens
const plainJobLeaseToken: JobLeaseToken = "lease";
// @ts-expect-error plain strings are not job result IDs
const plainJobResultId: JobResultId = "result";
// @ts-expect-error plain strings are not review item IDs
const plainReviewItemId: ReviewItemId = "review";
// @ts-expect-error plain strings are not content hashes
const plainContentHash: ContentHash = "hash";
// @ts-expect-error plain strings are not model profile IDs
const plainModelProfileId: ModelProfileId = "model";
// @ts-expect-error plain strings are not ISO date-time values
const plainIsoDateTime: IsoDateTime = "2026-07-13T00:00:00Z";
// @ts-expect-error one branded identity cannot replace another
const bookmarkFromSnapshot: BookmarkId = snapshotId;
// @ts-expect-error job IDs cannot replace batch IDs
const batchFromJob: JobBatchId = jobId;
// @ts-expect-error worker IDs cannot replace lease tokens
const leaseFromWorker: JobLeaseToken = workerId;
// @ts-expect-error result IDs cannot replace bookmark IDs
const bookmarkFromResult: BookmarkId = jobResultId;

interface ExampleError {
  readonly code: "example_failure";
  readonly detail: number;
}

function readOutcome(outcome: Outcome<string, ExampleError>): string | number {
  if (outcome.ok) {
    return outcome.value;
  }
  return outcome.error.detail;
}

const success: Outcome<string, ExampleError> = { ok: true, value: "value" };
const failure: Outcome<string, ExampleError> = {
  ok: false,
  error: { code: "example_failure", detail: 7 },
};

interface ErrorWithoutCode {
  readonly detail: number;
}

// @ts-expect-error Outcome errors must expose code as a string
type InvalidOutcome = Outcome<string, ErrorWithoutCode>;

void (null as unknown as BookmarkIdShape);
void (null as unknown as SnapshotIdShape);
void (null as unknown as JobIdShape);
void (null as unknown as JobBatchIdShape);
void (null as unknown as WorkerIdShape);
void (null as unknown as JobLeaseTokenShape);
void (null as unknown as JobResultIdShape);
void (null as unknown as ReviewItemIdShape);
void (null as unknown as ContentHashShape);
void (null as unknown as ModelProfileIdShape);
void (null as unknown as IsoDateTimeShape);
void brandedValuesAreStrings;
void plainBookmarkId;
void plainSnapshotId;
void plainJobId;
void plainJobBatchId;
void plainWorkerId;
void plainJobLeaseToken;
void plainJobResultId;
void plainReviewItemId;
void plainContentHash;
void plainModelProfileId;
void plainIsoDateTime;
void bookmarkFromSnapshot;
void batchFromJob;
void leaseFromWorker;
void bookmarkFromResult;
void readOutcome(success);
void readOutcome(failure);
void (null as unknown as InvalidOutcome);
