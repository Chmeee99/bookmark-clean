import type {
  ContentHash,
  IsoDateTime,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  HealthCheckFailure,
  HealthChecker,
  HealthCheckerDependencies,
  HealthObservation,
  HealthObservationErrorCode,
  HealthSelectedHeader,
  HealthStatus,
  HealthTransportFailure,
  HealthTransportFailureCode,
  HealthTransportRequest,
  HealthTransportResponse,
  RedirectHop,
} from "./public.js";

interface ClassifierApi {
  classifyHealthFact(fact:
    | { readonly kind: "response"; readonly statusCode: number; readonly redirects: readonly RedirectHop[] }
    | { readonly kind: "failure"; readonly code: HealthTransportFailureCode }
  ): { readonly status: HealthStatus; readonly errorCode?: HealthObservationErrorCode };
}
interface ExecutionEvidence {
  readonly status: HealthStatus;
  readonly errorCode?: HealthObservationErrorCode;
  readonly finalUrl?: string;
  readonly httpStatus?: number;
  readonly redirects: readonly RedirectHop[];
  readonly durationMs: number;
  readonly headers: readonly HealthSelectedHeader[];
  readonly body?: Uint8Array;
}

declare const require: (specifier: "./health-fact-classifier.ts") => unknown;
declare const module: { exports: { createHealthChecker: typeof createHealthChecker } };
const { classifyHealthFact } = require("./health-fact-classifier.ts") as ClassifierApi;

const TRANSPORT_CODES: readonly HealthTransportFailureCode[] = [
  "unsupported_url", "timeout", "dns_failure", "tls_error",
  "connection_failure", "malformed_response", "unknown_transport",
];
const HEADER_NAMES = [
  "content-type", "location", "retry-after", "etag", "last-modified",
] as const;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308] as const;

function failure(
  code: HealthCheckFailure["code"],
  disposition: HealthCheckFailure["disposition"],
): Outcome<never, HealthCheckFailure> {
  return { ok: false, error: { code, disposition } as HealthCheckFailure };
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
function validConfig(value: unknown): value is HealthCheckerDependencies["config"] {
  if (typeof value !== "object" || value === null) return false;
  const { timeoutMs, maxRedirects, maxBodyBytes } = value as Record<string, unknown>;
  return isCount(timeoutMs) && timeoutMs > 0 && maxRedirects === 5 &&
    isCount(maxBodyBytes) && maxBodyBytes > 0;
}
function validRequest(request: unknown): request is Parameters<HealthChecker["check"]>[0] {
  if (typeof request !== "object" || request === null) return false;
  const value = request as Record<string, unknown>;
  return isNonEmptyString(value.bookmarkId) && isNonEmptyString(value.inputVersion) &&
    isNonEmptyString(value.url);
}
function matchesInput(
  value: unknown,
  request: Parameters<HealthChecker["check"]>[0],
): value is HealthObservation {
  if (typeof value !== "object" || value === null) return false;
  const observation = value as Record<string, unknown>;
  return isNonEmptyString(observation.id) &&
    observation.bookmarkId === request.bookmarkId &&
    observation.inputVersion === request.inputVersion &&
    isNonEmptyString(observation.requestedUrl);
}

function validHeaders(value: unknown): value is readonly HealthSelectedHeader[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const header of value) {
    if (typeof header !== "object" || header === null) return false;
    const { name, value: headerValue } = header as Record<string, unknown>;
    if (!HEADER_NAMES.includes(name as never) || typeof headerValue !== "string" || seen.has(name as string)) {
      return false;
    }
    seen.add(name as string);
  }
  return true;
}

function validResponse(
  value: unknown,
  request: HealthTransportRequest,
): value is HealthTransportResponse {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  return response.url === request.url && isCount(response.statusCode) &&
    (response.statusCode as number) >= 100 && (response.statusCode as number) <= 599 &&
    validHeaders(response.headers) && isCount(response.durationMs) &&
    (response.body === undefined ||
      (response.body instanceof Uint8Array && response.body.byteLength <= request.maxBodyBytes));
}
function validTransportFailure(value: unknown): value is HealthTransportFailure {
  if (typeof value !== "object" || value === null) return false;
  const fact = value as Record<string, unknown>;
  return TRANSPORT_CODES.includes(fact.code as never) && isCount(fact.durationMs);
}

async function requestOnce(
  dependencies: HealthCheckerDependencies,
  request: HealthTransportRequest,
): Promise<Outcome<HealthTransportResponse, HealthTransportFailure> | null> {
  try {
    const result = await dependencies.transport.request(request);
    if (typeof result !== "object" || result === null || typeof result.ok !== "boolean") return null;
    if (result.ok) return validResponse(result.value, request) ? result : null;
    return validTransportFailure(result.error) ? result : null;
  } catch {
    return null;
  }
}

function addDuration(total: number, next: number): number | undefined {
  const sum = total + next;
  return Number.isSafeInteger(sum) ? sum : undefined;
}
function redirectLocation(headers: readonly HealthSelectedHeader[]): string | undefined {
  const locations = headers.filter(({ name }) => name === "location");
  return locations.length === 1 && locations[0].value.length > 0
    ? locations[0].value
    : undefined;
}
function resolvedRedirect(location: string, currentUrl: string): string | undefined {
  try { return new URL(location, currentUrl).href; } catch { return undefined; }
}

function responseEvidence(
  response: HealthTransportResponse,
  redirects: readonly RedirectHop[],
  durationMs: number,
  forcedError?: "invalid_redirect" | "redirect_limit",
): ExecutionEvidence {
  const classification = forcedError === undefined
    ? classifyHealthFact({ kind: "response", statusCode: response.statusCode, redirects })
    : { status: "uncertain" as const, errorCode: forcedError };
  return {
    ...classification,
    finalUrl: response.url,
    httpStatus: response.statusCode,
    redirects: [...redirects],
    durationMs,
    headers: response.headers.map((header) => ({ ...header })),
    ...(response.body === undefined ? {} : { body: response.body.slice() }),
  };
}

async function execute(
  dependencies: HealthCheckerDependencies,
  requestedUrl: string,
): Promise<Outcome<ExecutionEvidence, HealthCheckFailure>> {
  let currentUrl = requestedUrl;
  let durationMs = 0;
  const redirects: RedirectHop[] = [];
  for (;;) {
    const request: HealthTransportRequest = {
      url: currentUrl, method: "GET", redirect: "manual",
      timeoutMs: dependencies.config.timeoutMs,
      maxBodyBytes: dependencies.config.maxBodyBytes,
    };
    const fact = await requestOnce(dependencies, request);
    if (fact === null) return failure("transport_unavailable", "retry");
    const nextDuration = addDuration(durationMs, fact.ok ? fact.value.durationMs : fact.error.durationMs);
    if (nextDuration === undefined) return failure("transport_unavailable", "retry");
    durationMs = nextDuration;
    if (!fact.ok) {
      return { ok: true, value: {
        ...classifyHealthFact({ kind: "failure", code: fact.error.code }),
        redirects: [...redirects], durationMs, headers: [],
      } };
    }
    if (!REDIRECT_STATUSES.includes(fact.value.statusCode as never)) {
      return { ok: true, value: responseEvidence(fact.value, redirects, durationMs) };
    }
    const location = redirectLocation(fact.value.headers);
    if (location === undefined) {
      return { ok: true, value: responseEvidence(fact.value, redirects, durationMs, "invalid_redirect") };
    }
    if (redirects.length === dependencies.config.maxRedirects) {
      return { ok: true, value: responseEvidence(fact.value, redirects, durationMs, "redirect_limit") };
    }
    const nextUrl = resolvedRedirect(location, currentUrl);
    if (nextUrl === undefined) {
      return { ok: true, value: responseEvidence(fact.value, redirects, durationMs, "invalid_redirect") };
    }
    redirects.push({ requestedUrl: currentUrl, statusCode: fact.value.statusCode as RedirectHop["statusCode"], location, nextUrl });
    currentUrl = nextUrl;
  }
}

function fingerprint(
  dependencies: HealthCheckerDependencies,
  body: Uint8Array | undefined,
): ContentHash | undefined | null {
  if (body === undefined) return undefined;
  try {
    const value = dependencies.fingerprinter.fingerprint(body);
    return isNonEmptyString(value) ? value : null;
  } catch { return null; }
}
function completionTime(dependencies: HealthCheckerDependencies): IsoDateTime | undefined {
  try {
    const value = dependencies.clock.now();
    return isCanonicalUtc(value) ? value : undefined;
  } catch { return undefined; }
}

function createHealthChecker(dependencies: HealthCheckerDependencies): HealthChecker {
  return {
    async check(request) {
      if (!validRequest(request)) return failure("invalid_request", "terminal");
      if (!validConfig(dependencies.config)) return failure("invalid_configuration", "terminal");
      let loaded;
      try { loaded = await dependencies.repository.loadByInput(request.bookmarkId, request.inputVersion); }
      catch { return failure("storage_unavailable", "retry"); }
      if (!loaded || typeof loaded.ok !== "boolean") return failure("storage_unavailable", "retry");
      if (!loaded.ok) return loaded.error?.code === "observation_conflict"
        ? failure("input_conflict", "terminal") : failure("storage_unavailable", "retry");
      if (loaded.value !== null) {
        if (!matchesInput(loaded.value, request)) return failure("storage_unavailable", "retry");
        return loaded.value.requestedUrl === request.url
          ? { ok: true, value: { id: loaded.value.id } }
          : failure("input_conflict", "terminal");
      }
      let id;
      try { id = dependencies.idFactory.nextObservationId(); } catch { return failure("id_unavailable", "terminal"); }
      if (!isNonEmptyString(id)) return failure("id_unavailable", "terminal");
      const executed = await execute(dependencies, request.url);
      if (!executed.ok) return executed;
      const bodyFingerprint = fingerprint(dependencies, executed.value.body);
      if (bodyFingerprint === null) return failure("transport_unavailable", "retry");
      const checkedAt = completionTime(dependencies);
      if (checkedAt === undefined) return failure("clock_unavailable", "retry");
      const observation: HealthObservation = {
        id, bookmarkId: request.bookmarkId, inputVersion: request.inputVersion,
        status: executed.value.status, checkedAt, requestedUrl: request.url,
        ...(executed.value.finalUrl === undefined ? {} : { finalUrl: executed.value.finalUrl }),
        method: "GET",
        ...(executed.value.httpStatus === undefined ? {} : { httpStatus: executed.value.httpStatus }),
        redirects: executed.value.redirects, durationMs: executed.value.durationMs,
        retryCount: 0, headers: executed.value.headers,
        ...(executed.value.errorCode === undefined ? {} : { errorCode: executed.value.errorCode }),
        ...(bodyFingerprint === undefined ? {} : { bodyFingerprint }),
      };
      let saved;
      try { saved = await dependencies.repository.saveIfAbsent(observation); }
      catch { return failure("storage_unavailable", "retry"); }
      if (!saved || typeof saved.ok !== "boolean") return failure("storage_unavailable", "retry");
      if (!saved.ok) return saved.error?.code === "observation_conflict"
        ? failure("input_conflict", "terminal") : failure("storage_unavailable", "retry");
      return matchesInput(saved.value, request)
        ? { ok: true, value: { id: saved.value.id } }
        : failure("storage_unavailable", "retry");
    },
  };
}

module.exports = { createHealthChecker };
