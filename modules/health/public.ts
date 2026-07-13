import type {
  BookmarkId,
  ContentHash,
  IsoDateTime,
  JobResultId,
  Outcome,
} from "../../core/contracts/public.js";

export type HealthStatus =
  | "healthy"
  | "redirect_permanent"
  | "redirect_temporary"
  | "authentication_required"
  | "forbidden"
  | "rate_limited"
  | "server_error"
  | "dns_failure"
  | "timeout"
  | "tls_error"
  | "not_found"
  | "gone"
  | "soft_404_suspected"
  | "parked_domain_suspected"
  | "unsupported_url"
  | "uncertain";

export type HealthTransportFailureCode =
  | "unsupported_url"
  | "timeout"
  | "dns_failure"
  | "tls_error"
  | "connection_failure"
  | "malformed_response"
  | "unknown_transport";

export type HealthObservationErrorCode =
  | HealthTransportFailureCode
  | "invalid_redirect"
  | "redirect_limit";

export type HealthSelectedHeaderName =
  | "content-type"
  | "location"
  | "retry-after"
  | "etag"
  | "last-modified";

export interface HealthSelectedHeader {
  readonly name: HealthSelectedHeaderName;
  readonly value: string;
}

export interface HealthCheckRequest {
  readonly bookmarkId: BookmarkId;
  readonly inputVersion: string;
  readonly url: string;
}

export interface RedirectHop {
  readonly requestedUrl: string;
  readonly statusCode: 301 | 302 | 303 | 307 | 308;
  readonly location: string;
  readonly nextUrl: string;
}

export interface HealthObservation {
  readonly id: JobResultId;
  readonly bookmarkId: BookmarkId;
  readonly inputVersion: string;
  readonly status: HealthStatus;
  readonly checkedAt: IsoDateTime;
  readonly requestedUrl: string;
  readonly finalUrl?: string;
  readonly method: "GET";
  readonly httpStatus?: number;
  readonly redirects: readonly RedirectHop[];
  readonly durationMs: number;
  readonly retryCount: number;
  readonly headers: readonly HealthSelectedHeader[];
  readonly errorCode?: HealthObservationErrorCode;
  readonly bodyFingerprint?: ContentHash;
}

export type HealthFailureCode =
  | "invalid_request"
  | "input_conflict"
  | "invalid_configuration"
  | "clock_unavailable"
  | "id_unavailable"
  | "transport_unavailable"
  | "storage_unavailable";

export interface HealthFailure {
  readonly code: HealthFailureCode;
  readonly disposition: "retry" | "terminal";
  readonly diagnostic?: string;
}

export interface HealthChecker {
  check(
    request: HealthCheckRequest,
  ): Promise<Outcome<HealthObservation, HealthFailure>>;
}

export interface StalenessPolicy {
  assessStaleness(input: StalenessInput): StalenessAssessment;
}

export interface HealthService extends HealthChecker, StalenessPolicy {}

export interface HealthClock {
  now(): IsoDateTime;
}

export interface HealthIdFactory {
  nextObservationId(): JobResultId;
}

export interface HealthCheckConfig {
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly maxBodyBytes: number;
  readonly maxAttempts: number;
}

export interface HealthTransportRequest {
  readonly url: string;
  readonly method: "GET";
  readonly redirect: "manual";
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
}

export interface HealthTransportResponse {
  readonly url: string;
  readonly statusCode: number;
  readonly headers: readonly HealthSelectedHeader[];
  readonly body?: Uint8Array;
  readonly durationMs: number;
}

export interface HealthTransportFailure {
  readonly code: HealthTransportFailureCode;
  readonly durationMs: number;
}

export interface HealthTransport {
  request(
    request: HealthTransportRequest,
  ): Promise<Outcome<HealthTransportResponse, HealthTransportFailure>>;
}

export type HealthTransportFact =
  | { readonly kind: "response"; readonly value: HealthTransportResponse }
  | { readonly kind: "failure"; readonly value: HealthTransportFailure };

export type HealthRetryDecision =
  | { readonly retry: false }
  | { readonly retry: true; readonly delayMs: number };

export interface HealthRetryPolicy {
  decide(attempt: number, fact: HealthTransportFact): HealthRetryDecision;
}

export interface HealthDelay {
  wait(delayMs: number): Promise<void>;
}

export interface HealthBodyFingerprinter {
  fingerprint(body: Uint8Array): ContentHash;
}

export type HealthRepositoryFailureCode =
  | "observation_conflict"
  | "storage_unavailable";

export interface HealthRepositoryFailure {
  readonly code: HealthRepositoryFailureCode;
  readonly diagnostic?: string;
}

export interface HealthObservationRepository {
  loadByInput(
    bookmarkId: BookmarkId,
    inputVersion: string,
  ): Promise<Outcome<HealthObservation | null, HealthRepositoryFailure>>;
  saveIfAbsent(
    observation: HealthObservation,
  ): Promise<Outcome<HealthObservation, HealthRepositoryFailure>>;
  listForBookmark(
    bookmarkId: BookmarkId,
  ): Promise<Outcome<readonly HealthObservation[], HealthRepositoryFailure>>;
}

export type StalenessDisposition = "no_warning" | "retry" | "review";

export type StalenessReasonCode =
  | "no_observations"
  | "recent_reachable_observation"
  | "user_exception"
  | "single_failure_needs_confirmation"
  | "transient_or_access_failure"
  | "repeated_not_found_or_gone"
  | "repeated_typed_page_suspicion";

export interface StalenessInput {
  readonly bookmarkId: BookmarkId;
  readonly observations: readonly HealthObservation[];
  readonly assessedAt: IsoDateTime;
  readonly userException: boolean;
}

export interface StalenessAssessment {
  readonly disposition: StalenessDisposition;
  readonly confidence: number;
  readonly reasonCodes: readonly StalenessReasonCode[];
  readonly observationIds: readonly JobResultId[];
  readonly policyVersion: string;
}
