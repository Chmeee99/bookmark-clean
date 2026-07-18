import type { IsoDateTime } from "../../core/contracts/public.js";
import type {
  StoredCompletionCommand,
  StoredFailureCommand,
} from "../../modules/jobs/public.js";

interface UnknownRecord {
  readonly [key: string]: unknown;
}

const COMPLETION_COMMAND_KEYS = [
  "token",
  "expectedAttempt",
  "result",
  "completedAt",
] as const;
const FAILURE_COMMAND_KEYS = [
  "token",
  "expectedAttempt",
  "failure",
  "failedAt",
] as const;
const RESULT_KEYS = ["kind", "id"] as const;
const FAILURE_KEYS = ["code", "disposition"] as const;
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(record);
  const allowed = [...required, ...optional];
  return (
    keys.length >= required.length &&
    keys.length <= allowed.length &&
    keys.every((key) => typeof key === "string" && allowed.includes(key)) &&
    required.every((key) => keys.includes(key))
  );
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
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

function validateCompletionCommand(
  input: unknown,
): input is StoredCompletionCommand {
  return (
    isRecord(input) &&
    hasExactKeys(input, COMPLETION_COMMAND_KEYS) &&
    isNonEmptyString(input.token) &&
    isSafeInteger(input.expectedAttempt) &&
    input.expectedAttempt > 0 &&
    isCanonicalUtc(input.completedAt) &&
    isRecord(input.result) &&
    hasExactKeys(input.result, RESULT_KEYS) &&
    input.result.kind === "health_observation" &&
    isNonEmptyString(input.result.id)
  );
}

function validateFailureCommand(input: unknown): input is StoredFailureCommand {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, FAILURE_COMMAND_KEYS, ["retryAt"]) ||
    !isNonEmptyString(input.token) ||
    !isSafeInteger(input.expectedAttempt) ||
    input.expectedAttempt <= 0 ||
    !isCanonicalUtc(input.failedAt) ||
    !isRecord(input.failure) ||
    !hasExactKeys(input.failure, FAILURE_KEYS, ["diagnostic"]) ||
    !isNonEmptyString(input.failure.code) ||
    (input.failure.disposition !== "retry" &&
      input.failure.disposition !== "terminal") ||
    (hasOwn(input.failure, "diagnostic") &&
      typeof input.failure.diagnostic !== "string")
  ) {
    return false;
  }
  if (input.failure.disposition === "retry") {
    return (
      hasOwn(input, "retryAt") &&
      isCanonicalUtc(input.retryAt) &&
      input.retryAt >= input.failedAt
    );
  }
  return !hasOwn(input, "retryAt");
}

function validateBatchStateInput(
  batchId: unknown,
  action: unknown,
  changedAt: unknown,
): boolean {
  return (
    isNonEmptyString(batchId) &&
    (action === "pause" || action === "resume" || action === "cancel") &&
    isCanonicalUtc(changedAt)
  );
}

interface TransitionInputValidationApi {
  validateCompletionCommand: typeof validateCompletionCommand;
  validateFailureCommand: typeof validateFailureCommand;
  validateBatchStateInput: typeof validateBatchStateInput;
}

declare const module: { exports: TransitionInputValidationApi };

module.exports = {
  validateCompletionCommand,
  validateFailureCommand,
  validateBatchStateInput,
};
