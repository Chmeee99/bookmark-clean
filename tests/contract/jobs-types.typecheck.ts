import type {
  BookmarkId,
  IsoDateTime,
  JobBatchId,
  JobId,
  JobLeaseToken,
  JobResultId,
  Outcome,
  WorkerId,
} from "../../core/contracts/public.js";
import type {
  BookmarkJobTarget,
  EnqueueBatchRequest,
  EnqueueJob,
  JobBatchState,
  JobBatchSummary,
  JobClock,
  JobIdFactory,
  JobLease,
  JobProgress,
  JobQueue,
  JobQueueConfig,
  JobQueueFailure,
  JobQueueFailureCode,
  JobQueueStore,
  JobResultReference,
  JobRetrySchedule,
  JobState,
  JobTarget,
  JobType,
  JobHandler,
  JobWorker,
  JobWorkerConfigurationFailure,
  JobWorkerFailure,
  JobWorkerOperation,
  JobWorkerStep,
  StoredCompletionCommand,
  StoredEnqueueCommand,
  StoredFailureCommand,
  StoredLeaseCommand,
  TypedJobFailure,
  WorkerIdentity,
} from "../../modules/jobs/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type States = Assert<
  Equal<
    JobState,
    "pending" | "leased" | "succeeded" | "retry_wait" | "failed" | "cancelled"
  >
>;
type BatchStates = Assert<Equal<JobBatchState, "active" | "paused" | "cancelled">>;
type JobTypes = Assert<Equal<JobType, "health_check">>;
type Failures = Assert<
  Equal<
    JobQueueFailureCode,
    | "empty_batch"
    | "invalid_request"
    | "idempotency_conflict"
    | "batch_not_found"
    | "stale_lease"
    | "invalid_transition"
    | "storage_unavailable"
  >
>;
type WorkerOperations = Assert<
  Equal<JobWorkerOperation, "lease" | "succeed" | "fail">
>;
type WorkerSteps = Assert<
  Equal<
    JobWorkerStep,
    | { readonly status: "idle" }
    | {
        readonly status: "succeeded";
        readonly lease: JobLease;
        readonly result: JobResultReference;
      }
    | {
        readonly status: "failure_reported";
        readonly lease: JobLease;
        readonly failure: TypedJobFailure;
      }
  >
>;
type WorkerFailures = Assert<
  Equal<
    JobWorkerFailure,
    | {
        readonly code: "queue_failure";
        readonly operation: JobWorkerOperation;
        readonly failure: JobQueueFailure;
      }
    | {
        readonly code: "queue_interrupted";
        readonly operation: JobWorkerOperation;
      }
    | { readonly code: "handler_interrupted" }
    | { readonly code: "invalid_handler_output" }
  >
>;
type WorkerConfigurationFailures = Assert<
  Equal<
    JobWorkerConfigurationFailure,
    { readonly code: "invalid_handler_registry" }
  >
>;
type HandlerMethod = Assert<
  Equal<
    JobHandler["handle"],
    (
      lease: JobLease,
    ) => Promise<Outcome<JobResultReference, TypedJobFailure>>
  >
>;
type WorkerMethod = Assert<
  Equal<
    JobWorker["runOne"],
    (
      worker: WorkerIdentity,
    ) => Promise<Outcome<JobWorkerStep, JobWorkerFailure>>
  >
>;

type EnqueueMethod = Assert<
  Equal<
    JobQueue["enqueue"],
    (request: EnqueueBatchRequest) => Promise<Outcome<JobBatchSummary, JobQueueFailure>>
  >
>;
type LeaseMethod = Assert<
  Equal<
    JobQueue["lease"],
    (
      worker: WorkerIdentity,
      capabilities: readonly JobType[],
    ) => Promise<Outcome<JobLease | null, JobQueueFailure>>
  >
>;
type SucceedMethod = Assert<
  Equal<
    JobQueue["succeed"],
    (
      lease: JobLease,
      result: JobResultReference,
    ) => Promise<Outcome<void, JobQueueFailure>>
  >
>;
type FailMethod = Assert<
  Equal<
    JobQueue["fail"],
    (
      lease: JobLease,
      failure: TypedJobFailure,
    ) => Promise<Outcome<void, JobQueueFailure>>
  >
>;
type PauseMethod = Assert<
  Equal<
    JobQueue["pause"],
    (batchId: JobBatchId) => Promise<Outcome<void, JobQueueFailure>>
  >
>;
type ResumeMethod = Assert<
  Equal<
    JobQueue["resume"],
    (batchId: JobBatchId) => Promise<Outcome<void, JobQueueFailure>>
  >
>;
type CancelMethod = Assert<
  Equal<
    JobQueue["cancel"],
    (batchId: JobBatchId) => Promise<Outcome<void, JobQueueFailure>>
  >
>;
type ProgressMethod = Assert<
  Equal<
    JobQueue["getProgress"],
    (batchId: JobBatchId) => Promise<Outcome<JobProgress, JobQueueFailure>>
  >
>;

type EnqueueStoreMethod = Assert<
  Equal<
    JobQueueStore["enqueueBatch"],
    (
      command: StoredEnqueueCommand,
    ) => Promise<Outcome<JobBatchSummary, JobQueueFailure>>
  >
>;
type LeaseStoreMethod = Assert<
  Equal<
    JobQueueStore["leaseNext"],
    (
      command: StoredLeaseCommand,
    ) => Promise<Outcome<JobLease | null, JobQueueFailure>>
  >
>;
type CompleteStoreMethod = Assert<
  Equal<
    JobQueueStore["completeLease"],
    (
      command: StoredCompletionCommand,
    ) => Promise<Outcome<void, JobQueueFailure>>
  >
>;
type FailStoreMethod = Assert<
  Equal<
    JobQueueStore["failLease"],
    (
      command: StoredFailureCommand,
    ) => Promise<Outcome<void, JobQueueFailure>>
  >
>;
type BatchStoreMethod = Assert<
  Equal<
    JobQueueStore["setBatchState"],
    (
      batchId: JobBatchId,
      action: "pause" | "resume" | "cancel",
      changedAt: IsoDateTime,
    ) => Promise<Outcome<void, JobQueueFailure>>
  >
>;
type ProgressStoreMethod = Assert<
  Equal<
    JobQueueStore["readProgress"],
    (
      batchId: JobBatchId,
      now: IsoDateTime,
    ) => Promise<Outcome<JobProgress, JobQueueFailure>>
  >
>;
type ClockMethod = Assert<Equal<JobClock["now"], () => IsoDateTime>>;
type RetryMethod = Assert<
  Equal<
    JobRetrySchedule["nextRetryAt"],
    (attempt: number, failedAt: IsoDateTime) => IsoDateTime
  >
>;
type BatchIdMethod = Assert<Equal<JobIdFactory["nextBatchId"], () => JobBatchId>>;
type JobIdMethod = Assert<Equal<JobIdFactory["nextJobId"], () => JobId>>;
type LeaseTokenMethod = Assert<
  Equal<JobIdFactory["nextLeaseToken"], () => JobLeaseToken>
>;

declare const bookmarkId: BookmarkId;
declare const batchId: JobBatchId;
declare const jobId: JobId;
declare const leaseToken: JobLeaseToken;
declare const resultId: JobResultId;
declare const workerId: WorkerId;
declare const now: IsoDateTime;

const target: BookmarkJobTarget = {
  kind: "bookmark",
  bookmarkId,
  inputVersion: "snapshot:v1",
};
const targetUnion: JobTarget = target;
const job: EnqueueJob = {
  type: "health_check",
  target,
  priority: 10,
  sequence: 0,
  maxAttempts: 3,
  notBefore: now,
};
const request: EnqueueBatchRequest = { idempotencyKey: "scope:v1", jobs: [job] };
const summary: JobBatchSummary = { batchId, state: "active", totalCount: 1, createdAt: now };
const worker: WorkerIdentity = { id: workerId };
const lease: JobLease = {
  token: leaseToken,
  jobId,
  batchId,
  type: "health_check",
  target,
  attempt: 1,
  leasedAt: now,
  expiresAt: now,
};
const result: JobResultReference = { kind: "health_observation", id: resultId };
const failure: TypedJobFailure = { code: "timeout", disposition: "retry" };
const progress: JobProgress = {
  batchId,
  batchState: "active",
  totalCount: 1,
  pendingCount: 0,
  leasedCount: 1,
  retryWaitCount: 0,
  succeededCount: 0,
  failedCount: 0,
  cancelledCount: 0,
  nextEligibleAt: now,
};
const queueFailure: JobQueueFailure = { code: "stale_lease" };
const idleStep: JobWorkerStep = { status: "idle" };
const succeededStep: JobWorkerStep = {
  status: "succeeded",
  lease,
  result,
};
const failureReportedStep: JobWorkerStep = {
  status: "failure_reported",
  lease,
  failure,
};
const workerQueueFailure: JobWorkerFailure = {
  code: "queue_failure",
  operation: "lease",
  failure: queueFailure,
};
const workerQueueInterrupted: JobWorkerFailure = {
  code: "queue_interrupted",
  operation: "succeed",
};
const handlerInterrupted: JobWorkerFailure = { code: "handler_interrupted" };
const invalidHandlerOutput: JobWorkerFailure = {
  code: "invalid_handler_output",
};
const workerConfigurationFailure: JobWorkerConfigurationFailure = {
  code: "invalid_handler_registry",
};
const handler: JobHandler = {
  type: "health_check",
  handle: async () => ({ ok: true, value: result }),
};
const jobWorker: JobWorker = {
  runOne: async () => ({ ok: true, value: idleStep }),
};
const clock: JobClock = { now: () => now };
const retry: JobRetrySchedule = { nextRetryAt: () => now };
const ids: JobIdFactory = {
  nextBatchId: () => batchId,
  nextJobId: () => jobId,
  nextLeaseToken: () => leaseToken,
};
const config: JobQueueConfig = { leaseDurationMs: 30_000 };
const storedEnqueue: StoredEnqueueCommand = {
  request,
  requestFingerprint: "canonical",
  batchId,
  jobIds: [jobId],
  createdAt: now,
};
const storedLease: StoredLeaseCommand = {
  worker,
  capabilities: ["health_check"],
  now,
  expiresAt: now,
  token: leaseToken,
};
const storedFailure: StoredFailureCommand = {
  token: leaseToken,
  expectedAttempt: 1,
  failure,
  failedAt: now,
  retryAt: now,
};
const storedCompletion: StoredCompletionCommand = {
  token: leaseToken,
  expectedAttempt: 1,
  result,
  completedAt: now,
};

// @ts-expect-error unknown job types require a contract change
const unknownType: JobType = "extract";
// @ts-expect-error targets cannot carry raw page bodies
target.pageBody = "untrusted";
// @ts-expect-error results are typed references only
result.rawResponse = "provider prose";
// @ts-expect-error batch controls use branded IDs
const wrongBatch: JobBatchId = jobId;
// @ts-expect-error worker operations are a closed union
const unknownWorkerOperation: JobWorkerOperation = "poll";
const diagnosedInterruption: JobWorkerFailure = {
  code: "handler_interrupted",
  // @ts-expect-error interruption failures cannot carry inferred diagnostics
  diagnostic: "do not parse exceptions",
};
// @ts-expect-error queue failures require their exact operation
const operationlessQueueFailure: JobWorkerFailure = {
  code: "queue_failure",
  failure: queueFailure,
};
const rawResultHandler: JobHandler = {
  type: "health_check",
  // @ts-expect-error handlers return typed result references rather than prose
  handle: async () => ({ ok: true, value: "raw provider prose" }),
};

void (null as unknown as States);
void (null as unknown as BatchStates);
void (null as unknown as JobTypes);
void (null as unknown as Failures);
void (null as unknown as WorkerOperations);
void (null as unknown as WorkerSteps);
void (null as unknown as WorkerFailures);
void (null as unknown as WorkerConfigurationFailures);
void (null as unknown as HandlerMethod);
void (null as unknown as WorkerMethod);
void (null as unknown as EnqueueMethod);
void (null as unknown as LeaseMethod);
void (null as unknown as SucceedMethod);
void (null as unknown as FailMethod);
void (null as unknown as PauseMethod);
void (null as unknown as ResumeMethod);
void (null as unknown as CancelMethod);
void (null as unknown as ProgressMethod);
void (null as unknown as EnqueueStoreMethod);
void (null as unknown as LeaseStoreMethod);
void (null as unknown as CompleteStoreMethod);
void (null as unknown as FailStoreMethod);
void (null as unknown as BatchStoreMethod);
void (null as unknown as ProgressStoreMethod);
void (null as unknown as ClockMethod);
void (null as unknown as RetryMethod);
void (null as unknown as BatchIdMethod);
void (null as unknown as JobIdMethod);
void (null as unknown as LeaseTokenMethod);
void targetUnion;
void summary;
void worker;
void lease;
void progress;
void queueFailure;
void idleStep;
void succeededStep;
void failureReportedStep;
void workerQueueFailure;
void workerQueueInterrupted;
void handlerInterrupted;
void invalidHandlerOutput;
void workerConfigurationFailure;
void handler;
void jobWorker;
void clock;
void retry;
void ids;
void config;
void storedEnqueue;
void storedLease;
void storedFailure;
void storedCompletion;
void unknownType;
void wrongBatch;
void unknownWorkerOperation;
void diagnosedInterruption;
void operationlessQueueFailure;
void rawResultHandler;
