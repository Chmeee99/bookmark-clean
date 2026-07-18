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

export type JobState =
  | "pending"
  | "leased"
  | "succeeded"
  | "retry_wait"
  | "failed"
  | "cancelled";

export type JobBatchState = "active" | "paused" | "cancelled";
export type JobType = "health_check";

export interface BookmarkJobTarget {
  readonly kind: "bookmark";
  readonly bookmarkId: BookmarkId;
  readonly inputVersion: string;
}

export type JobTarget = BookmarkJobTarget;

export interface EnqueueJob {
  readonly type: JobType;
  readonly target: JobTarget;
  readonly priority: number;
  readonly sequence: number;
  readonly maxAttempts: number;
  readonly notBefore?: IsoDateTime;
}

export interface EnqueueBatchRequest {
  readonly idempotencyKey: string;
  readonly jobs: readonly EnqueueJob[];
}

export interface JobBatchSummary {
  readonly batchId: JobBatchId;
  readonly state: JobBatchState;
  readonly totalCount: number;
  readonly createdAt: IsoDateTime;
}

export interface WorkerIdentity {
  readonly id: WorkerId;
}

export interface JobLease {
  readonly token: JobLeaseToken;
  readonly jobId: JobId;
  readonly batchId: JobBatchId;
  readonly type: JobType;
  readonly target: JobTarget;
  readonly attempt: number;
  readonly leasedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

export interface JobResultReference {
  readonly kind: "health_observation";
  readonly id: JobResultId;
}

export interface TypedJobFailure {
  readonly code: string;
  readonly disposition: "retry" | "terminal";
  readonly diagnostic?: string;
}

export interface JobProgress {
  readonly batchId: JobBatchId;
  readonly batchState: JobBatchState;
  readonly totalCount: number;
  readonly pendingCount: number;
  readonly leasedCount: number;
  readonly retryWaitCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly nextEligibleAt?: IsoDateTime;
}

export type JobQueueFailureCode =
  | "empty_batch"
  | "invalid_request"
  | "idempotency_conflict"
  | "batch_not_found"
  | "stale_lease"
  | "invalid_transition"
  | "stored_queue_invalid"
  | "storage_unavailable";

export interface JobQueueFailure {
  readonly code: JobQueueFailureCode;
  readonly diagnostic?: string;
}

export interface JobEnqueuer {
  enqueue(
    request: EnqueueBatchRequest,
  ): Promise<Outcome<JobBatchSummary, JobQueueFailure>>;
}

export interface JobQueue extends JobEnqueuer {
  lease(
    worker: WorkerIdentity,
    capabilities: readonly JobType[],
  ): Promise<Outcome<JobLease | null, JobQueueFailure>>;
  succeed(
    lease: JobLease,
    result: JobResultReference,
  ): Promise<Outcome<void, JobQueueFailure>>;
  fail(
    lease: JobLease,
    failure: TypedJobFailure,
  ): Promise<Outcome<void, JobQueueFailure>>;
  pause(batchId: JobBatchId): Promise<Outcome<void, JobQueueFailure>>;
  resume(batchId: JobBatchId): Promise<Outcome<void, JobQueueFailure>>;
  cancel(batchId: JobBatchId): Promise<Outcome<void, JobQueueFailure>>;
  getProgress(
    batchId: JobBatchId,
  ): Promise<Outcome<JobProgress, JobQueueFailure>>;
}

export interface JobClock {
  now(): IsoDateTime;
}

export interface JobRetrySchedule {
  nextRetryAt(attempt: number, failedAt: IsoDateTime): IsoDateTime;
}

export interface JobEnqueueIdFactory {
  nextBatchId(): JobBatchId;
  nextJobId(): JobId;
}

export interface JobIdFactory extends JobEnqueueIdFactory {
  nextLeaseToken(): JobLeaseToken;
}

export interface JobQueueConfig {
  readonly leaseDurationMs: number;
}

export interface JobEnqueuerDependencies {
  readonly clock: JobClock;
  readonly idFactory: JobEnqueueIdFactory;
  readonly store: JobQueueStore;
}

export interface JobQueueDependencies {
  readonly clock: JobClock;
  readonly retrySchedule: JobRetrySchedule;
  readonly idFactory: JobIdFactory;
  readonly store: JobQueueStore;
  readonly config: JobQueueConfig;
}

export interface StoredEnqueueCommand {
  readonly request: EnqueueBatchRequest;
  readonly requestFingerprint: string;
  readonly batchId: JobBatchId;
  readonly jobIds: readonly JobId[];
  readonly createdAt: IsoDateTime;
}

export interface StoredLeaseCommand {
  readonly worker: WorkerIdentity;
  readonly capabilities: readonly JobType[];
  readonly now: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly token: JobLeaseToken;
}

export interface StoredFailureCommand {
  readonly token: JobLeaseToken;
  readonly expectedAttempt: number;
  readonly failure: TypedJobFailure;
  readonly failedAt: IsoDateTime;
  readonly retryAt?: IsoDateTime;
}

export interface StoredCompletionCommand {
  readonly token: JobLeaseToken;
  readonly expectedAttempt: number;
  readonly result: JobResultReference;
  readonly completedAt: IsoDateTime;
}

export interface JobQueueStore {
  enqueueBatch(
    command: StoredEnqueueCommand,
  ): Promise<Outcome<JobBatchSummary, JobQueueFailure>>;
  leaseNext(
    command: StoredLeaseCommand,
  ): Promise<Outcome<JobLease | null, JobQueueFailure>>;
  completeLease(
    command: StoredCompletionCommand,
  ): Promise<Outcome<void, JobQueueFailure>>;
  failLease(
    command: StoredFailureCommand,
  ): Promise<Outcome<void, JobQueueFailure>>;
  setBatchState(
    batchId: JobBatchId,
    action: "pause" | "resume" | "cancel",
    changedAt: IsoDateTime,
  ): Promise<Outcome<void, JobQueueFailure>>;
  readProgress(
    batchId: JobBatchId,
    now: IsoDateTime,
  ): Promise<Outcome<JobProgress, JobQueueFailure>>;
}

export type JobWorkerOperation = "lease" | "succeed" | "fail";

export type JobWorkerStep =
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
    };

export type JobWorkerFailure =
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
  | { readonly code: "invalid_handler_output" };

export interface JobWorkerConfigurationFailure {
  readonly code: "invalid_handler_registry";
}

export interface JobHandler {
  readonly type: JobType;
  handle(
    lease: JobLease,
  ): Promise<Outcome<JobResultReference, TypedJobFailure>>;
}

export interface JobWorker {
  runOne(
    worker: WorkerIdentity,
  ): Promise<Outcome<JobWorkerStep, JobWorkerFailure>>;
}

export declare function createJobEnqueuer(
  dependencies: JobEnqueuerDependencies,
): JobEnqueuer;

export declare function createJobQueue(
  dependencies: JobQueueDependencies,
): JobQueue;

export declare function createJobWorker(
  queue: JobQueue,
  handlers: readonly JobHandler[],
): Outcome<JobWorker, JobWorkerConfigurationFailure>;

interface JobQueueRuntime {
  createJobEnqueuer: typeof createJobEnqueuer;
  createJobQueue: typeof createJobQueue;
}

interface JobWorkerRuntime {
  createJobWorker: typeof createJobWorker;
}

declare const require: (
  specifier: "./job-queue-service.ts" | "./job-worker-service.ts",
) => unknown;
declare const module: {
  exports: {
    createJobEnqueuer: typeof createJobEnqueuer;
    createJobQueue: typeof createJobQueue;
    createJobWorker: typeof createJobWorker;
  };
};

const {
  createJobEnqueuer: createJobEnqueuerRuntime,
  createJobQueue: createJobQueueRuntime,
} = require("./job-queue-service.ts") as JobQueueRuntime;
const { createJobWorker: createJobWorkerRuntime } = require(
  "./job-worker-service.ts",
) as JobWorkerRuntime;

module.exports = {
  createJobEnqueuer: createJobEnqueuerRuntime,
  createJobQueue: createJobQueueRuntime,
  createJobWorker: createJobWorkerRuntime,
};
