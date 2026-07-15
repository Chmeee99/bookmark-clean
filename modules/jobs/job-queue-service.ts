import type {
  EnqueueBatchRequest,
  JobLease,
  JobEnqueuer,
  JobEnqueuerDependencies,
  JobQueue,
  JobQueueDependencies,
  JobQueueFailure,
  TypedJobFailure,
  WorkerIdentity,
} from "./public.js";
import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";

interface ValidatedEnqueue {
  readonly request: EnqueueBatchRequest;
  readonly requestFingerprint: string;
}

interface ValidatedLeaseInput {
  readonly worker: WorkerIdentity;
  readonly capabilities: readonly import("./public.js").JobType[];
}

interface ValidationApi {
  invalidRequest(): { readonly ok: false; readonly error: JobQueueFailure };
  isCanonicalUtc(value: unknown): value is IsoDateTime;
  isNonEmptyString(value: unknown): value is string;
  validateEnqueueRequest(
    input: unknown,
  ): Outcome<ValidatedEnqueue, JobQueueFailure>;
  validateLeaseInput(
    worker: unknown,
    capabilities: unknown,
  ): Outcome<ValidatedLeaseInput, JobQueueFailure>;
  validateJobLease(input: unknown): Outcome<JobLease, JobQueueFailure>;
  validateJobResult(
    input: unknown,
  ): Outcome<import("./public.js").JobResultReference, JobQueueFailure>;
  validateJobFailure(
    input: unknown,
  ): Outcome<TypedJobFailure, JobQueueFailure>;
  validateGeneratedIds(ids: readonly unknown[]): boolean;
  addLeaseDuration(now: IsoDateTime, durationMs: unknown): IsoDateTime | null;
}

declare const require: (specifier: "./job-queue-validation.ts") => unknown;
declare const module: {
  exports: {
    createJobEnqueuer: typeof createJobEnqueuer;
    createJobQueue: typeof createJobQueue;
  };
};

const {
  invalidRequest,
  isCanonicalUtc,
  isNonEmptyString,
  validateEnqueueRequest,
  validateLeaseInput,
  validateJobLease,
  validateJobResult,
  validateJobFailure,
  validateGeneratedIds,
  addLeaseDuration,
} = require("./job-queue-validation.ts") as ValidationApi;

function createJobEnqueuer({
  clock,
  idFactory,
  store,
}: JobEnqueuerDependencies): JobEnqueuer {
  async function enqueue(request: EnqueueBatchRequest) {
    const validation = validateEnqueueRequest(request);
    if (!validation.ok) {
      return validation;
    }

    const now = clock.now();
    if (!isCanonicalUtc(now)) {
      return invalidRequest();
    }

    const batchId = idFactory.nextBatchId();
    const jobIds = validation.value.request.jobs.map(() => idFactory.nextJobId());
    if (!validateGeneratedIds([batchId, ...jobIds])) {
      return invalidRequest();
    }
    return store.enqueueBatch({
      request: validation.value.request,
      requestFingerprint: validation.value.requestFingerprint,
      batchId,
      jobIds,
      createdAt: now,
    });
  }

  return { enqueue };
}

function createJobQueue({
  clock,
  retrySchedule,
  idFactory,
  store,
  config,
}: JobQueueDependencies): JobQueue {
  const { enqueue } = createJobEnqueuer({ clock, idFactory, store });

  async function lease(
    worker: WorkerIdentity,
    capabilities: readonly import("./public.js").JobType[],
  ) {
    const validation = validateLeaseInput(worker, capabilities);
    if (!validation.ok) {
      return validation;
    }
    if (validation.value.capabilities.length === 0) {
      return { ok: true as const, value: null };
    }

    const now = clock.now();
    if (!isCanonicalUtc(now)) {
      return invalidRequest();
    }
    const expiresAt = addLeaseDuration(now, config.leaseDurationMs);
    if (expiresAt === null) {
      return invalidRequest();
    }
    const token = idFactory.nextLeaseToken();
    if (!isNonEmptyString(token)) {
      return invalidRequest();
    }
    return store.leaseNext({
      worker: validation.value.worker,
      capabilities: validation.value.capabilities,
      now,
      expiresAt,
      token,
    });
  }

  async function succeed(
    leaseInput: JobLease,
    resultInput: import("./public.js").JobResultReference,
  ) {
    const leaseValidation = validateJobLease(leaseInput);
    if (!leaseValidation.ok) {
      return leaseValidation;
    }
    const resultValidation = validateJobResult(resultInput);
    if (!resultValidation.ok) {
      return resultValidation;
    }
    const completedAt = clock.now();
    if (!isCanonicalUtc(completedAt)) {
      return invalidRequest();
    }
    return store.completeLease({
      token: leaseValidation.value.token,
      expectedAttempt: leaseValidation.value.attempt,
      result: resultValidation.value,
      completedAt,
    });
  }

  async function fail(
    leaseInput: JobLease,
    failureInput: TypedJobFailure,
  ) {
    const leaseValidation = validateJobLease(leaseInput);
    if (!leaseValidation.ok) {
      return leaseValidation;
    }
    const failureValidation = validateJobFailure(failureInput);
    if (!failureValidation.ok) {
      return failureValidation;
    }
    const failedAt = clock.now();
    if (!isCanonicalUtc(failedAt)) {
      return invalidRequest();
    }

    if (failureValidation.value.disposition === "retry") {
      const retryAt = retrySchedule.nextRetryAt(
        leaseValidation.value.attempt,
        failedAt,
      );
      if (!isCanonicalUtc(retryAt) || retryAt < failedAt) {
        return invalidRequest();
      }
      return store.failLease({
        token: leaseValidation.value.token,
        expectedAttempt: leaseValidation.value.attempt,
        failure: failureValidation.value,
        failedAt,
        retryAt,
      });
    }

    return store.failLease({
      token: leaseValidation.value.token,
      expectedAttempt: leaseValidation.value.attempt,
      failure: failureValidation.value,
      failedAt,
    });
  }

  async function setBatchState(
    batchId: import("../../core/contracts/public.js").JobBatchId,
    action: "pause" | "resume" | "cancel",
  ) {
    if (!isNonEmptyString(batchId)) {
      return invalidRequest();
    }
    const changedAt = clock.now();
    if (!isCanonicalUtc(changedAt)) {
      return invalidRequest();
    }
    return store.setBatchState(batchId, action, changedAt);
  }

  async function getProgress(
    batchId: import("../../core/contracts/public.js").JobBatchId,
  ) {
    if (!isNonEmptyString(batchId)) {
      return invalidRequest();
    }
    const now = clock.now();
    if (!isCanonicalUtc(now)) {
      return invalidRequest();
    }
    return store.readProgress(batchId, now);
  }

  return {
    enqueue,
    lease,
    succeed,
    fail,
    pause: (batchId) => setBatchState(batchId, "pause"),
    resume: (batchId) => setBatchState(batchId, "resume"),
    cancel: (batchId) => setBatchState(batchId, "cancel"),
    getProgress,
  };
}

module.exports = { createJobEnqueuer, createJobQueue };
