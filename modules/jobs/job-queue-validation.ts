import type {
  EnqueueBatchRequest,
  EnqueueJob,
  JobLease,
  JobQueueFailure,
  JobResultReference,
  JobType,
  TypedJobFailure,
  WorkerIdentity,
} from "./public.js";
import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";

interface UnknownRecord {
  readonly [key: string]: unknown;
}

interface ValidatedEnqueue {
  readonly request: EnqueueBatchRequest;
  readonly requestFingerprint: string;
}

interface ValidatedLeaseInput {
  readonly worker: WorkerIdentity;
  readonly capabilities: readonly JobType[];
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
  ): Outcome<JobResultReference, JobQueueFailure>;
  validateJobFailure(
    input: unknown,
  ): Outcome<TypedJobFailure, JobQueueFailure>;
  validateGeneratedIds(ids: readonly unknown[]): boolean;
  addLeaseDuration(now: IsoDateTime, durationMs: unknown): IsoDateTime | null;
}

declare const module: { exports: ValidationApi };

const REQUEST_KEYS = ["idempotencyKey", "jobs"] as const;
const ENQUEUE_JOB_KEYS = [
  "type",
  "target",
  "priority",
  "sequence",
  "maxAttempts",
  "notBefore",
] as const;
const ENQUEUE_JOB_REQUIRED_KEYS = ENQUEUE_JOB_KEYS.slice(0, 5);
const TARGET_KEYS = ["kind", "bookmarkId", "inputVersion"] as const;
const LEASE_KEYS = [
  "token",
  "jobId",
  "batchId",
  "type",
  "target",
  "attempt",
  "leasedAt",
  "expiresAt",
] as const;
const RESULT_KEYS = ["kind", "id"] as const;
const FAILURE_KEYS = ["code", "disposition", "diagnostic"] as const;
const FAILURE_REQUIRED_KEYS = FAILURE_KEYS.slice(0, 2);
const WORKER_KEYS = ["id"] as const;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  record: UnknownRecord,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean {
  const ownKeys = Reflect.ownKeys(record);
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  return (
    ownKeys.length >= requiredKeys.length &&
    ownKeys.length <= allowedKeys.length &&
    ownKeys.every(
      (key) => typeof key === "string" && allowedKeys.includes(key),
    ) &&
    requiredKeys.every((key) => ownKeys.includes(key))
  );
}

function hasArrayShape(value: readonly unknown[]): boolean {
  return Reflect.ownKeys(value).every((key) => {
    if (key === "length") {
      return true;
    }
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
      return false;
    }
    const index = Number(key);
    return Number.isSafeInteger(index) && index < value.length;
  });
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function invalidRequest(): { readonly ok: false; readonly error: JobQueueFailure } {
  return { ok: false, error: { code: "invalid_request" } };
}

function isCanonicalUtc(value: unknown): value is IsoDateTime {
  if (typeof value !== "string" || !CANONICAL_UTC.test(value)) {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateTarget(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, TARGET_KEYS)) {
    return false;
  }
  return (
    value.kind === "bookmark" &&
    isNonEmptyString(value.bookmarkId) &&
    isNonEmptyString(value.inputVersion)
  );
}

function validateEnqueueJob(
  value: unknown,
  sequences: Set<number>,
): EnqueueJob | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ENQUEUE_JOB_REQUIRED_KEYS, ["notBefore"]) ||
    value.type !== "health_check" ||
    !validateTarget(value.target) ||
    !Number.isSafeInteger(value.priority) ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    sequences.has(value.sequence) ||
    !Number.isSafeInteger(value.maxAttempts) ||
    value.maxAttempts <= 0
  ) {
    return null;
  }
  if (hasOwn(value, "notBefore") && !isCanonicalUtc(value.notBefore)) {
    return null;
  }
  sequences.add(value.sequence);
  return value as unknown as EnqueueJob;
}

function canonicalizeJob(job: EnqueueJob): Record<string, unknown> {
  const target = {
    kind: job.target.kind,
    bookmarkId: job.target.bookmarkId,
    inputVersion: job.target.inputVersion,
  };
  const canonical: Record<string, unknown> = {
    type: job.type,
    target,
    priority: job.priority,
    sequence: job.sequence,
    maxAttempts: job.maxAttempts,
  };
  if (job.notBefore !== undefined) {
    canonical.notBefore = job.notBefore;
  }
  return canonical;
}

function validateEnqueueRequest(
  input: unknown,
): Outcome<ValidatedEnqueue, JobQueueFailure> {
  if (!isRecord(input) || !hasExactKeys(input, REQUEST_KEYS)) {
    return invalidRequest();
  }
  if (!isNonEmptyString(input.idempotencyKey) || !Array.isArray(input.jobs)) {
    return invalidRequest();
  }
  if (input.jobs.length === 0) {
    return { ok: false, error: { code: "empty_batch" } };
  }
  if (!hasArrayShape(input.jobs)) {
    return invalidRequest();
  }

  const sequences = new Set<number>();
  const canonicalJobs: Record<string, unknown>[] = [];
  for (let index = 0; index < input.jobs.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(input.jobs, index)) {
      return invalidRequest();
    }
    const job = validateEnqueueJob(input.jobs[index], sequences);
    if (job === null) {
      return invalidRequest();
    }
    canonicalJobs.push(canonicalizeJob(job));
  }

  const requestFingerprint = JSON.stringify({
    idempotencyKey: input.idempotencyKey,
    jobs: canonicalJobs,
  });
  return {
    ok: true,
    value: {
      request: input as unknown as EnqueueBatchRequest,
      requestFingerprint,
    },
  };
}

function validateLeaseInput(
  worker: unknown,
  capabilities: unknown,
): Outcome<ValidatedLeaseInput, JobQueueFailure> {
  if (
    !isRecord(worker) ||
    !hasExactKeys(worker, WORKER_KEYS) ||
    !isNonEmptyString(worker.id) ||
    !Array.isArray(capabilities) ||
    !hasArrayShape(capabilities)
  ) {
    return invalidRequest();
  }
  const values: JobType[] = [];
  for (let index = 0; index < capabilities.length; index += 1) {
    if (
      !Object.prototype.hasOwnProperty.call(capabilities, index) ||
      capabilities[index] !== "health_check"
    ) {
      return invalidRequest();
    }
    values.push(capabilities[index] as JobType);
  }
  const normalizedCapabilities = [...new Set(values)].sort() as JobType[];
  return {
    ok: true,
    value: {
      worker: worker as unknown as WorkerIdentity,
      capabilities: normalizedCapabilities,
    },
  };
}

function validateJobLease(
  input: unknown,
): Outcome<JobLease, JobQueueFailure> {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, LEASE_KEYS) ||
    !isNonEmptyString(input.token) ||
    !isNonEmptyString(input.jobId) ||
    !isNonEmptyString(input.batchId) ||
    input.type !== "health_check" ||
    !validateTarget(input.target) ||
    !Number.isSafeInteger(input.attempt) ||
    input.attempt <= 0 ||
    !isCanonicalUtc(input.leasedAt) ||
    !isCanonicalUtc(input.expiresAt)
  ) {
    return invalidRequest();
  }
  return { ok: true, value: input as unknown as JobLease };
}

function validateJobResult(
  input: unknown,
): Outcome<JobResultReference, JobQueueFailure> {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, RESULT_KEYS) ||
    input.kind !== "health_observation" ||
    !isNonEmptyString(input.id)
  ) {
    return invalidRequest();
  }
  return { ok: true, value: input as unknown as JobResultReference };
}

function validateJobFailure(
  input: unknown,
): Outcome<TypedJobFailure, JobQueueFailure> {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, FAILURE_REQUIRED_KEYS, ["diagnostic"]) ||
    !isNonEmptyString(input.code) ||
    (input.disposition !== "retry" && input.disposition !== "terminal") ||
    (hasOwn(input, "diagnostic") && typeof input.diagnostic !== "string")
  ) {
    return invalidRequest();
  }
  return { ok: true, value: input as unknown as TypedJobFailure };
}

function validateGeneratedIds(ids: readonly unknown[]): boolean {
  const values = ids.filter(isNonEmptyString);
  return values.length === ids.length && new Set(values).size === values.length;
}

function addLeaseDuration(
  now: IsoDateTime,
  durationMs: unknown,
): IsoDateTime | null {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    return null;
  }
  const startMs = Date.parse(now);
  if (!Number.isSafeInteger(startMs)) {
    return null;
  }
  const expiresMs = startMs + durationMs;
  if (!Number.isSafeInteger(expiresMs)) {
    return null;
  }
  try {
    const expiresAt = new Date(expiresMs).toISOString();
    return isCanonicalUtc(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

module.exports = {
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
};
