import type {
  IsoDateTime,
  JobBatchId,
  JobId,
  JobResultId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  EnqueueBatchRequest,
  JobBatchState,
  JobBatchSummary,
  JobClock,
  JobEnqueueIdFactory,
  JobEnqueuer,
  JobEnqueuerDependencies,
  JobHandler,
  JobIdFactory,
  JobLease,
  JobProgress,
  JobQueue,
  JobQueueConfig,
  JobQueueDependencies,
  JobQueueFailure,
  JobQueueStore,
  JobResultReference,
  JobRetrySchedule,
  JobState,
  JobType,
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
import {
  createJobEnqueuer,
  createJobQueue,
  createJobWorker,
} from "../../modules/jobs/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type States = Assert<Equal<JobState,
  "pending" | "leased" | "succeeded" | "retry_wait" | "failed" | "cancelled"
>>;
type BatchStates = Assert<Equal<JobBatchState, "active" | "paused" | "cancelled">>;
type JobTypes = Assert<Equal<JobType, "health_check">>;
type ResultReferences = Assert<Equal<JobResultReference, {
  readonly kind: "health_observation";
  readonly id: JobResultId;
}>>;
type WorkerOperations = Assert<Equal<JobWorkerOperation, "lease" | "succeed" | "fail">>;

type QueueContract = Assert<Equal<JobQueue, {
  enqueue(request: EnqueueBatchRequest): Promise<Outcome<JobBatchSummary, JobQueueFailure>>;
  lease(worker: WorkerIdentity, capabilities: readonly JobType[]): Promise<Outcome<JobLease | null, JobQueueFailure>>;
  succeed(lease: JobLease, result: JobResultReference): Promise<Outcome<void, JobQueueFailure>>;
  fail(lease: JobLease, failure: TypedJobFailure): Promise<Outcome<void, JobQueueFailure>>;
  pause(batchId: JobBatchId): Promise<Outcome<void, JobQueueFailure>>;
  resume(batchId: JobBatchId): Promise<Outcome<void, JobQueueFailure>>;
  cancel(batchId: JobBatchId): Promise<Outcome<void, JobQueueFailure>>;
  getProgress(batchId: JobBatchId): Promise<Outcome<JobProgress, JobQueueFailure>>;
}>>;
type EnqueuerContract = Assert<Equal<JobEnqueuer, {
  enqueue(request: EnqueueBatchRequest): Promise<Outcome<JobBatchSummary, JobQueueFailure>>;
}>>;
type EnqueueIdFactoryContract = Assert<Equal<JobEnqueueIdFactory, {
  nextBatchId(): JobBatchId;
  nextJobId(): JobId;
}>>;
type QueueExtendsEnqueuer = Assert<JobQueue extends JobEnqueuer ? true : false>;
type IdFactoryExtendsEnqueueFactory = Assert<
  JobIdFactory extends JobEnqueueIdFactory ? true : false
>;

type StoreContract = Assert<Equal<JobQueueStore, {
  enqueueBatch(command: StoredEnqueueCommand): Promise<Outcome<JobBatchSummary, JobQueueFailure>>;
  leaseNext(command: StoredLeaseCommand): Promise<Outcome<JobLease | null, JobQueueFailure>>;
  completeLease(command: StoredCompletionCommand): Promise<Outcome<void, JobQueueFailure>>;
  failLease(command: StoredFailureCommand): Promise<Outcome<void, JobQueueFailure>>;
  setBatchState(batchId: JobBatchId, action: "pause" | "resume" | "cancel", changedAt: IsoDateTime): Promise<Outcome<void, JobQueueFailure>>;
  readProgress(batchId: JobBatchId, now: IsoDateTime): Promise<Outcome<JobProgress, JobQueueFailure>>;
}>>;

type HandlerContract = Assert<Equal<JobHandler, {
  readonly type: JobType;
  handle(lease: JobLease): Promise<Outcome<JobResultReference, TypedJobFailure>>;
}>>;
type WorkerContract = Assert<Equal<JobWorker, {
  runOne(worker: WorkerIdentity): Promise<Outcome<JobWorkerStep, JobWorkerFailure>>;
}>>;
type QueueDependencies = Assert<Equal<JobQueueDependencies, {
  readonly clock: JobClock;
  readonly retrySchedule: JobRetrySchedule;
  readonly idFactory: JobIdFactory;
  readonly store: JobQueueStore;
  readonly config: JobQueueConfig;
}>>;
type EnqueuerDependencies = Assert<Equal<JobEnqueuerDependencies, {
  readonly clock: JobClock;
  readonly idFactory: JobEnqueueIdFactory;
  readonly store: JobQueueStore;
}>>;
type QueueDependenciesExtendEnqueuerDependencies = Assert<
  JobQueueDependencies extends JobEnqueuerDependencies ? true : false
>;
type EnqueuerFactory = Assert<Equal<typeof createJobEnqueuer,
  (dependencies: JobEnqueuerDependencies) => JobEnqueuer
>>;
type QueueFactory = Assert<Equal<typeof createJobQueue,
  (dependencies: JobQueueDependencies) => JobQueue
>>;
type WorkerFactory = Assert<Equal<typeof createJobWorker,
  (
    queue: JobQueue,
    handlers: readonly JobHandler[],
  ) => Outcome<JobWorker, JobWorkerConfigurationFailure>
>>;

// @ts-expect-error job states are closed
const invalidState: JobState = "dead";
declare const jobId: JobId;
// @ts-expect-error batch and job identities are distinct brands
const wrongBatch: JobBatchId = jobId;
// @ts-expect-error worker operations are closed
const unsupportedOperation: JobWorkerOperation = "poll";
const untypedResultHandler: JobHandler = {
  type: "health_check",
  // @ts-expect-error handlers must return a typed durable result reference
  handle: async () => ({ ok: true, value: "raw provider prose" }),
};

void (null as unknown as States);
void (null as unknown as BatchStates);
void (null as unknown as JobTypes);
void (null as unknown as ResultReferences);
void (null as unknown as WorkerOperations);
void (null as unknown as QueueContract);
void (null as unknown as EnqueuerContract);
void (null as unknown as EnqueueIdFactoryContract);
void (null as unknown as QueueExtendsEnqueuer);
void (null as unknown as IdFactoryExtendsEnqueueFactory);
void (null as unknown as StoreContract);
void (null as unknown as HandlerContract);
void (null as unknown as WorkerContract);
void (null as unknown as QueueDependencies);
void (null as unknown as EnqueuerDependencies);
void (null as unknown as QueueDependenciesExtendEnqueuerDependencies);
void (null as unknown as EnqueuerFactory);
void (null as unknown as QueueFactory);
void (null as unknown as WorkerFactory);
void invalidState;
void wrongBatch;
void unsupportedOperation;
void untypedResultHandler;
