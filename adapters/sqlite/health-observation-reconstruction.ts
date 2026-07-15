import type {
  BookmarkId,
  ContentHash,
  IsoDateTime,
  JobResultId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  HealthObservation,
  HealthObservationErrorCode,
  HealthRepositoryFailure,
  HealthSelectedHeader,
  HealthSelectedHeaderName,
  HealthStatus,
  RedirectHop,
} from "../../modules/health/public.js";

interface SqliteRow { readonly [key: string]: unknown; }
interface UnknownRecord { readonly [key: string]: unknown; }

const STATUSES: readonly HealthStatus[] = [
  "healthy", "redirect_permanent", "redirect_temporary",
  "authentication_required", "forbidden", "rate_limited", "server_error",
  "dns_failure", "timeout", "tls_error", "not_found", "gone",
  "soft_404_suspected", "parked_domain_suspected", "unsupported_url", "uncertain",
];
const ERROR_CODES: readonly HealthObservationErrorCode[] = [
  "unsupported_url", "timeout", "dns_failure", "tls_error",
  "connection_failure", "malformed_response", "unknown_transport",
  "invalid_redirect", "redirect_limit",
];
const HEADER_NAMES: readonly HealthSelectedHeaderName[] = [
  "content-type", "location", "retry-after", "etag", "last-modified",
];
const REDIRECT_STATUSES = [301, 302, 303, 307, 308] as const;

function unavailable<T>(): Outcome<T, HealthRepositoryFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isHttpStatus(value: unknown): value is number {
  return isCount(value) && value >= 100 && value <= 599;
}

function isCanonicalUtc(value: unknown): value is IsoDateTime {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function parseJsonArray(value: unknown): readonly unknown[] | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseRedirect(value: unknown): RedirectHop | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["requestedUrl", "statusCode", "location", "nextUrl"]) ||
    !isNonEmptyString(value.requestedUrl) ||
    !REDIRECT_STATUSES.includes(value.statusCode as never) ||
    !isNonEmptyString(value.location) ||
    !isNonEmptyString(value.nextUrl)
  ) return undefined;
  return {
    requestedUrl: value.requestedUrl,
    statusCode: value.statusCode as RedirectHop["statusCode"],
    location: value.location,
    nextUrl: value.nextUrl,
  };
}

function parseHeader(value: unknown): HealthSelectedHeader | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["name", "value"]) ||
    !HEADER_NAMES.includes(value.name as never) ||
    typeof value.value !== "string"
  ) return undefined;
  return {
    name: value.name as HealthSelectedHeaderName,
    value: value.value,
  };
}

function parseCollection<T>(
  value: unknown,
  parse: (item: unknown) => T | undefined,
): readonly T[] | undefined {
  const array = parseJsonArray(value);
  if (array === undefined) return undefined;
  const parsed: T[] = [];
  for (const item of array) {
    const result = parse(item);
    if (result === undefined) return undefined;
    parsed.push(result);
  }
  return parsed;
}

function reconstructHealthObservation(
  row: SqliteRow,
): Outcome<HealthObservation, HealthRepositoryFailure> {
  const redirects = parseCollection(row.redirects_json, parseRedirect);
  const headers = parseCollection(row.headers_json, parseHeader);
  if (
    !isNonEmptyString(row.id) ||
    !isNonEmptyString(row.bookmark_id) ||
    !isNonEmptyString(row.input_version) ||
    !STATUSES.includes(row.status as never) ||
    !isCanonicalUtc(row.checked_at) ||
    !isNonEmptyString(row.requested_url) ||
    (row.final_url !== null && !isNonEmptyString(row.final_url)) ||
    row.method !== "GET" ||
    (row.http_status !== null && !isHttpStatus(row.http_status)) ||
    redirects === undefined ||
    !isCount(row.duration_ms) ||
    !isCount(row.retry_count) ||
    headers === undefined ||
    (row.error_code !== null && !ERROR_CODES.includes(row.error_code as never)) ||
    (row.body_fingerprint !== null && !isNonEmptyString(row.body_fingerprint))
  ) return unavailable();

  return {
    ok: true,
    value: {
      id: row.id as JobResultId,
      bookmarkId: row.bookmark_id as BookmarkId,
      inputVersion: row.input_version,
      status: row.status as HealthStatus,
      checkedAt: row.checked_at,
      requestedUrl: row.requested_url,
      ...(row.final_url === null ? {} : { finalUrl: row.final_url }),
      method: "GET",
      ...(row.http_status === null ? {} : { httpStatus: row.http_status }),
      redirects,
      durationMs: row.duration_ms,
      retryCount: row.retry_count,
      headers,
      ...(row.error_code === null
        ? {}
        : { errorCode: row.error_code as HealthObservationErrorCode }),
      ...(row.body_fingerprint === null
        ? {}
        : { bodyFingerprint: row.body_fingerprint as ContentHash }),
    },
  };
}

declare const module: {
  exports: { reconstructHealthObservation: typeof reconstructHealthObservation };
};

module.exports = { reconstructHealthObservation };
