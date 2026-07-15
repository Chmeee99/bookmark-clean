import type {
  BookmarkId,
  ContentHash,
  IsoDateTime,
  JobResultId,
  Outcome,
} from "../../core/contracts/public.js";
import type { BookmarkCatalog } from "../catalog/public.js";
import type { JobHandler } from "../jobs/public.js";

export interface HealthCheckRequest {
  readonly bookmarkId: BookmarkId;
  readonly inputVersion: string;
  readonly url: string;
}

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
}

export interface CommittedHealthObservation {
  readonly id: JobResultId;
}

export interface HealthClock {
  now(): IsoDateTime;
}

export interface HealthIdFactory {
  nextObservationId(): JobResultId;
}

export interface HealthCheckConfig {
  readonly timeoutMs: number;
  readonly maxRedirects: 5;
  readonly maxBodyBytes: number;
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

export interface HealthBodyFingerprinter {
  fingerprint(body: Uint8Array): ContentHash;
}

export type HealthCheckFailureCode =
  | "invalid_request"
  | "input_conflict"
  | "invalid_configuration"
  | "id_unavailable"
  | "clock_unavailable"
  | "transport_unavailable"
  | "storage_unavailable";

export type HealthCheckFailure =
  | {
      readonly code:
        | "invalid_request"
        | "input_conflict"
        | "invalid_configuration"
        | "id_unavailable";
      readonly disposition: "terminal";
      readonly diagnostic?: string;
    }
  | {
      readonly code:
        | "clock_unavailable"
        | "transport_unavailable"
        | "storage_unavailable";
      readonly disposition: "retry";
      readonly diagnostic?: string;
    };

export interface HealthChecker {
  check(
    request: HealthCheckRequest,
  ): Promise<Outcome<CommittedHealthObservation, HealthCheckFailure>>;
}

export interface HealthCheckerDependencies {
  readonly config: HealthCheckConfig;
  readonly clock: HealthClock;
  readonly idFactory: HealthIdFactory;
  readonly transport: HealthTransport;
  readonly fingerprinter: HealthBodyFingerprinter;
  readonly repository: HealthObservationRepository;
}

export declare function createHealthChecker(
  dependencies: HealthCheckerDependencies,
): HealthChecker;

export interface HealthCheckJobHandlerDependencies {
  readonly catalog: Pick<BookmarkCatalog, "getBookmark">;
  readonly checker: HealthChecker;
}

export declare function createHealthCheckJobHandler(
  dependencies: HealthCheckJobHandlerDependencies,
): JobHandler;

interface HealthCheckJobHandlerRuntime {
  createHealthCheckJobHandler: typeof createHealthCheckJobHandler;
}

interface HealthCheckerRuntime {
  createHealthChecker: typeof createHealthChecker;
}

declare const require: (
  specifier: "./health-check-job-handler.ts" | "./health-checker.ts",
) => unknown;
declare const module: {
  exports: {
    createHealthCheckJobHandler: typeof createHealthCheckJobHandler;
    createHealthChecker: typeof createHealthChecker;
  };
};

const { createHealthCheckJobHandler: createHealthCheckJobHandlerRuntime } = require(
  "./health-check-job-handler.ts",
) as HealthCheckJobHandlerRuntime;
const { createHealthChecker: createHealthCheckerRuntime } = require(
  "./health-checker.ts",
) as HealthCheckerRuntime;

module.exports = {
  createHealthCheckJobHandler: createHealthCheckJobHandlerRuntime,
  createHealthChecker: createHealthCheckerRuntime,
};
