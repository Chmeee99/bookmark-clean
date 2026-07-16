import type { IsoDateTime } from "../../core/contracts/public.js";
import type {
  HealthCheckRequest,
  HealthObservation,
  HealthObservationErrorCode,
  HealthSelectedHeaderName,
  HealthStatus,
  HealthTransportFailureCode,
  RedirectHop,
} from "./public.js";

type UnknownRecord = Record<string, unknown>;
interface ClassifierApi {
  classifyHealthFact(fact:
    | {
        readonly kind: "response";
        readonly statusCode: number;
        readonly redirects: readonly RedirectHop[];
      }
    | {
        readonly kind: "failure";
        readonly code: HealthTransportFailureCode;
      }
  ): {
    readonly status: HealthStatus;
    readonly errorCode?: HealthObservationErrorCode;
  };
}

declare const require: (specifier: "./health-fact-classifier.ts") => unknown;
declare const module: {
  exports: {
    isCanonicalUtc: typeof isCanonicalUtc;
    isHealthObservationForInput: typeof isHealthObservationForInput;
  };
};
const { classifyHealthFact } = require("./health-fact-classifier.ts") as ClassifierApi;

const REQUIRED_KEYS = [
  "id", "bookmarkId", "inputVersion", "status", "checkedAt", "requestedUrl",
  "method", "redirects", "durationMs", "retryCount", "headers",
] as const;
const OPTIONAL_KEYS = ["finalUrl", "httpStatus", "errorCode", "bodyFingerprint"] as const;
const STATUSES: readonly HealthStatus[] = [
  "healthy", "redirect_permanent", "redirect_temporary", "authentication_required",
  "forbidden", "rate_limited", "server_error", "dns_failure", "timeout", "tls_error",
  "not_found", "gone", "soft_404_suspected", "parked_domain_suspected",
  "unsupported_url", "uncertain",
];
const ERROR_CODES: readonly HealthObservationErrorCode[] = [
  "unsupported_url", "timeout", "dns_failure", "tls_error", "connection_failure",
  "malformed_response", "unknown_transport", "invalid_redirect", "redirect_limit",
];
const HEADER_NAMES: readonly HealthSelectedHeaderName[] = [
  "content-type", "location", "retry-after", "etag", "last-modified",
];
const REDIRECT_STATUSES = [301, 302, 303, 307, 308] as const;
const TRANSPORT_ERROR_CODES: readonly HealthTransportFailureCode[] = [
  "unsupported_url", "timeout", "dns_failure", "tls_error", "connection_failure",
  "malformed_response", "unknown_transport",
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasExactKeys(
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(value);
  const allowed = [...required, ...optional];
  return required.every((key) => hasOwn(value, key)) &&
    keys.every((key) => typeof key === "string" && allowed.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalUtc(value: unknown): value is IsoDateTime {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function validRedirects(
  value: unknown,
  requestedUrl: string,
): value is readonly RedirectHop[] {
  if (!Array.isArray(value) || value.length > 5) return false;
  let expectedRequestedUrl = requestedUrl;
  for (const item of value) {
    if (!isRecord(item) ||
      !hasExactKeys(item, ["requestedUrl", "statusCode", "location", "nextUrl"]) ||
      item.requestedUrl !== expectedRequestedUrl ||
      !REDIRECT_STATUSES.includes(item.statusCode as never) ||
      !isNonEmptyString(item.location) ||
      !isNonEmptyString(item.nextUrl)) return false;
    try {
      if (new URL(item.location, item.requestedUrl).href !== item.nextUrl) return false;
    } catch {
      return false;
    }
    expectedRequestedUrl = item.nextUrl;
  }
  return true;
}

function validHeaders(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const names = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || !hasExactKeys(item, ["name", "value"]) ||
      !HEADER_NAMES.includes(item.name as never) || typeof item.value !== "string" ||
      names.has(item.name as string)) return false;
    names.add(item.name as string);
  }
  return true;
}

function validOptionalFields(value: UnknownRecord): boolean {
  return (!hasOwn(value, "finalUrl") || value.finalUrl === undefined ||
      isNonEmptyString(value.finalUrl)) &&
    (!hasOwn(value, "httpStatus") || value.httpStatus === undefined ||
      (isCount(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599)) &&
    (!hasOwn(value, "errorCode") || value.errorCode === undefined ||
      ERROR_CODES.includes(value.errorCode as never)) &&
    (!hasOwn(value, "bodyFingerprint") || value.bodyFingerprint === undefined ||
      isNonEmptyString(value.bodyFingerprint));
}

function finalRequestUrl(
  requestedUrl: string,
  redirects: readonly RedirectHop[],
): string {
  return redirects.length === 0
    ? requestedUrl
    : redirects[redirects.length - 1].nextUrl;
}

function coherentTransportFailure(
  value: UnknownRecord,
  errorCode: HealthTransportFailureCode,
): boolean {
  const classification = classifyHealthFact({ kind: "failure", code: errorCode });
  return value.status === classification.status &&
    value.errorCode === classification.errorCode &&
    value.finalUrl === undefined &&
    value.httpStatus === undefined &&
    value.bodyFingerprint === undefined &&
    Array.isArray(value.headers) &&
    value.headers.length === 0;
}

function coherentRedirectFailure(
  value: UnknownRecord,
  redirects: readonly RedirectHop[],
  errorCode: "invalid_redirect" | "redirect_limit",
): boolean {
  if (value.status !== "uncertain" ||
    value.finalUrl !== finalRequestUrl(value.requestedUrl as string, redirects) ||
    !REDIRECT_STATUSES.includes(value.httpStatus as never)) return false;
  const location = (value.headers as readonly UnknownRecord[])
    .find((header) => header.name === "location")?.value;
  if (errorCode === "redirect_limit") {
    return redirects.length === 5 &&
      typeof location === "string" &&
      location.length > 0;
  }
  if (typeof location !== "string" || location.length === 0) return true;
  try {
    new URL(location, value.finalUrl as string);
    return false;
  } catch {
    return true;
  }
}

function coherentResponse(
  value: UnknownRecord,
  redirects: readonly RedirectHop[],
): boolean {
  if (!isNonEmptyString(value.finalUrl) ||
    value.finalUrl !== finalRequestUrl(value.requestedUrl as string, redirects) ||
    !isCount(value.httpStatus) ||
    REDIRECT_STATUSES.includes(value.httpStatus as never)) return false;
  if (value.status === "soft_404_suspected" ||
    value.status === "parked_domain_suspected") {
    return false;
  }
  return value.status === classifyHealthFact({
    kind: "response",
    statusCode: value.httpStatus,
    redirects,
  }).status;
}

function hasCoherentFacts(
  value: UnknownRecord,
  redirects: readonly RedirectHop[],
): boolean {
  if (value.retryCount !== 0) return false;
  if (TRANSPORT_ERROR_CODES.includes(value.errorCode as never)) {
    return coherentTransportFailure(
      value,
      value.errorCode as HealthTransportFailureCode,
    );
  }
  if (value.errorCode === "invalid_redirect" ||
    value.errorCode === "redirect_limit") {
    return coherentRedirectFailure(value, redirects, value.errorCode);
  }
  return value.errorCode === undefined && coherentResponse(value, redirects);
}

function isHealthObservationForInput(
  value: unknown,
  input: Pick<HealthCheckRequest, "bookmarkId" | "inputVersion">,
): value is HealthObservation {
  if (!isRecord(value) || !hasExactKeys(value, REQUIRED_KEYS, OPTIONAL_KEYS)) return false;
  if (!isNonEmptyString(value.requestedUrl) ||
    !validRedirects(value.redirects, value.requestedUrl)) return false;
  return isNonEmptyString(value.id) &&
    value.bookmarkId === input.bookmarkId &&
    value.inputVersion === input.inputVersion &&
    STATUSES.includes(value.status as never) &&
    isCanonicalUtc(value.checkedAt) &&
    value.method === "GET" &&
    isCount(value.durationMs) && isCount(value.retryCount) &&
    validHeaders(value.headers) && validOptionalFields(value) &&
    hasCoherentFacts(value, value.redirects);
}

module.exports = { isCanonicalUtc, isHealthObservationForInput };
