import type {
  JobLease,
  JobResultReference,
  JobType,
  JobWorkerConfigurationFailure,
  TypedJobFailure,
} from "./public.js";
import type { Outcome } from "../../core/contracts/public.js";
import type { JobQueueFailure } from "./public.js";

interface UnknownRecord {
  readonly [key: string]: unknown;
}

export type HandlerCall = (
  lease: JobLease,
) => Promise<Outcome<JobResultReference, TypedJobFailure>>;

export interface HandlerRoute {
  readonly type: JobType;
  readonly handle: HandlerCall;
}

export interface ValidatedHandlerRegistry {
  readonly capabilities: readonly JobType[];
  readonly routes: Readonly<Record<JobType, HandlerRoute>>;
}

export type InvalidHandlerOutput = {
  readonly code: "invalid_handler_output";
};

export type ValidatedHandlerOutcome =
  | { readonly kind: "success"; readonly result: JobResultReference }
  | { readonly kind: "failure"; readonly failure: TypedJobFailure };

interface JobsValidationApi {
  validateJobResult(
    input: unknown,
  ): Outcome<JobResultReference, JobQueueFailure>;
  validateJobFailure(
    input: unknown,
  ): Outcome<TypedJobFailure, JobQueueFailure>;
}

declare const require: (specifier: "./job-queue-validation.ts") => unknown;
declare const module: { exports: Record<string, unknown> };

const { validateJobResult, validateJobFailure } = require(
  "./job-queue-validation.ts",
) as JobsValidationApi;

const HANDLER_TYPES: readonly JobType[] = ["health_check"];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasExactKeys(record: UnknownRecord, requiredKeys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(record);
  return (
    ownKeys.length === requiredKeys.length &&
    ownKeys.every(
      (key) => typeof key === "string" && requiredKeys.includes(key),
    ) &&
    requiredKeys.every((key) => ownKeys.includes(key))
  );
}

function isArrayIndexKey(key: PropertyKey, length: number): key is string {
  if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function isDenseExactArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) {
    return false;
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key !== "length" && !isArrayIndexKey(key, value.length)) {
      return false;
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!hasOwn(value, String(index))) {
      return false;
    }
  }
  return true;
}

function isSupportedJobType(value: unknown): value is JobType {
  return HANDLER_TYPES.includes(value as JobType);
}

function invalidRegistry(): {
  readonly ok: false;
  readonly error: JobWorkerConfigurationFailure;
} {
  return { ok: false, error: { code: "invalid_handler_registry" } };
}

function snapshotHandler(value: unknown): HandlerRoute | null {
  if (!isRecord(value)) {
    return null;
  }

  let type: unknown;
  let handle: unknown;
  try {
    type = value.type;
    handle = value.handle;
  } catch {
    return null;
  }
  if (!isSupportedJobType(type) || typeof handle !== "function") {
    return null;
  }

  try {
    const boundHandle = Function.prototype.bind.call(handle, value) as HandlerCall;
    return Object.freeze({
      type,
      handle: boundHandle,
    });
  } catch {
    return null;
  }
}

function validateHandlerRegistry(
  input: unknown,
): Outcome<ValidatedHandlerRegistry, JobWorkerConfigurationFailure> {
  try {
    if (!isDenseExactArray(input)) {
      return invalidRegistry();
    }

    const capabilities: JobType[] = [];
    const routes: Partial<Record<JobType, HandlerRoute>> = Object.create(null);
    for (let index = 0; index < input.length; index += 1) {
      const route = snapshotHandler(input[index]);
      if (route === null || routes[route.type] !== undefined) {
        return invalidRegistry();
      }
      routes[route.type] = route;
      capabilities.push(route.type);
    }

    const immutableCapabilities = Object.freeze(
      [...new Set(capabilities)].sort(),
    ) as readonly JobType[];
    const immutableRoutes = Object.freeze(
      routes,
    ) as Readonly<Record<JobType, HandlerRoute>>;
    return {
      ok: true,
      value: Object.freeze({
        capabilities: immutableCapabilities,
        routes: immutableRoutes,
      }),
    };
  } catch {
    return invalidRegistry();
  }
}

function invalidHandlerOutput(): {
  readonly ok: false;
  readonly error: InvalidHandlerOutput;
} {
  return { ok: false, error: { code: "invalid_handler_output" } };
}

function validateHandlerOutcome(
  input: unknown,
): Outcome<ValidatedHandlerOutcome, InvalidHandlerOutput> {
  if (!isRecord(input)) {
    return invalidHandlerOutput();
  }

  if (input.ok === true && hasExactKeys(input, ["ok", "value"])) {
    const result = validateJobResult(input.value);
    return result.ok
      ? { ok: true, value: { kind: "success", result: result.value } }
      : invalidHandlerOutput();
  }

  if (input.ok === false && hasExactKeys(input, ["ok", "error"])) {
    const failure = validateJobFailure(input.error);
    return failure.ok
      ? { ok: true, value: { kind: "failure", failure: failure.value } }
      : invalidHandlerOutput();
  }

  return invalidHandlerOutput();
}

module.exports = {
  validateHandlerRegistry,
  validateHandlerOutcome,
};
