import type {
  BookmarkId,
  ContentHash,
  IsoDateTime,
  JobResultId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  CommittedHealthObservation,
  HealthCheckFailure,
  HealthCheckFailureCode,
  HealthCheckRequest,
  HealthCheckJobHandlerDependencies,
  HealthChecker,
  HealthObservation,
  HealthObservationErrorCode,
  HealthObservationRepository,
  HealthRepositoryFailure,
  HealthRepositoryFailureCode,
  HealthSelectedHeader,
  HealthSelectedHeaderName,
  HealthStatus,
  HealthTransportFailureCode,
  RedirectHop,
  createHealthCheckJobHandler,
} from "../../modules/health/public.js";
import type { BookmarkCatalog } from "../../modules/catalog/public.js";
import type { JobHandler } from "../../modules/jobs/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type FailureCodes = Assert<Equal<HealthCheckFailureCode,
  | "invalid_request"
  | "input_conflict"
  | "invalid_configuration"
  | "id_unavailable"
  | "clock_unavailable"
  | "transport_unavailable"
  | "storage_unavailable"
>>;
type Statuses = Assert<Equal<HealthStatus,
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
  | "uncertain"
>>;
type TransportFailures = Assert<Equal<HealthTransportFailureCode,
  | "unsupported_url"
  | "timeout"
  | "dns_failure"
  | "tls_error"
  | "connection_failure"
  | "malformed_response"
  | "unknown_transport"
>>;
type ObservationErrors = Assert<Equal<HealthObservationErrorCode,
  HealthTransportFailureCode | "invalid_redirect" | "redirect_limit"
>>;
type SelectedHeaderNames = Assert<Equal<HealthSelectedHeaderName,
  "content-type" | "location" | "retry-after" | "etag" | "last-modified"
>>;
type SelectedHeaderContract = Assert<Equal<HealthSelectedHeader, {
  readonly name: HealthSelectedHeaderName;
  readonly value: string;
}>>;
type RedirectContract = Assert<Equal<RedirectHop, {
  readonly requestedUrl: string;
  readonly statusCode: 301 | 302 | 303 | 307 | 308;
  readonly location: string;
  readonly nextUrl: string;
}>>;
type ObservationContract = Assert<Equal<HealthObservation, {
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
}>>;
type RepositoryFailureCodes = Assert<Equal<HealthRepositoryFailureCode,
  "observation_conflict" | "storage_unavailable"
>>;
type RepositoryFailureContract = Assert<Equal<HealthRepositoryFailure, {
  readonly code: HealthRepositoryFailureCode;
  readonly diagnostic?: string;
}>>;
type RepositoryContract = Assert<Equal<HealthObservationRepository, {
  loadByInput(
    bookmarkId: BookmarkId,
    inputVersion: string,
  ): Promise<Outcome<HealthObservation | null, HealthRepositoryFailure>>;
  saveIfAbsent(
    observation: HealthObservation,
  ): Promise<Outcome<HealthObservation, HealthRepositoryFailure>>;
}>>;
type RequestContract = Assert<Equal<HealthCheckRequest, {
  readonly bookmarkId: BookmarkId;
  readonly inputVersion: string;
  readonly url: string;
}>>;
type ResultContract = Assert<Equal<CommittedHealthObservation, {
  readonly id: JobResultId;
}>>;
type FailureContract = Assert<Equal<HealthCheckFailure, {
  readonly code:
    | "invalid_request"
    | "input_conflict"
    | "invalid_configuration"
    | "id_unavailable";
  readonly disposition: "terminal";
  readonly diagnostic?: string;
} | {
  readonly code:
    | "clock_unavailable"
    | "transport_unavailable"
    | "storage_unavailable";
  readonly disposition: "retry";
  readonly diagnostic?: string;
}>>;
type CheckerContract = Assert<Equal<HealthChecker, {
  check(request: HealthCheckRequest): Promise<Outcome<CommittedHealthObservation, HealthCheckFailure>>;
}>>;
type HandlerDependenciesContract = Assert<Equal<HealthCheckJobHandlerDependencies, {
  readonly catalog: Pick<BookmarkCatalog, "getBookmark">;
  readonly checker: HealthChecker;
}>>;
type HandlerFactoryContract = Assert<Equal<
  typeof createHealthCheckJobHandler,
  (dependencies: HealthCheckJobHandlerDependencies) => JobHandler
>>;
declare const bookmarkId: BookmarkId;
declare const resultId: JobResultId;
// @ts-expect-error observation IDs are not bookmark IDs
const wrongResultId: JobResultId = bookmarkId;
// @ts-expect-error failure codes are closed
const inventedFailure: HealthCheckFailureCode = "provider_sounded_uncertain";
// @ts-expect-error observation statuses are closed
const inventedStatus: HealthStatus = "probably_dead";
// @ts-expect-error selected headers are closed
const inventedHeader: HealthSelectedHeaderName = "server";
// @ts-expect-error transport failures are retryable
const wrongDisposition: HealthCheckFailure = {
  code: "transport_unavailable",
  disposition: "terminal",
};
const request: HealthCheckRequest = {
  bookmarkId,
  inputVersion: "version-1",
  url: "https://example.com",
};
const observation: CommittedHealthObservation = { id: resultId };
declare const storedObservation: HealthObservation;
// @ts-expect-error observations are immutable
storedObservation.status = "healthy";
// @ts-expect-error observation collections are readonly
storedObservation.redirects.push({});

void (null as unknown as FailureCodes);
void (null as unknown as Statuses);
void (null as unknown as TransportFailures);
void (null as unknown as ObservationErrors);
void (null as unknown as SelectedHeaderNames);
void (null as unknown as SelectedHeaderContract);
void (null as unknown as RedirectContract);
void (null as unknown as ObservationContract);
void (null as unknown as RepositoryFailureCodes);
void (null as unknown as RepositoryFailureContract);
void (null as unknown as RepositoryContract);
void (null as unknown as RequestContract);
void (null as unknown as ResultContract);
void (null as unknown as FailureContract);
void (null as unknown as CheckerContract);
void (null as unknown as HandlerDependenciesContract);
void (null as unknown as HandlerFactoryContract);
void wrongResultId;
void inventedFailure;
void inventedStatus;
void inventedHeader;
void wrongDisposition;
void request;
void observation;
void storedObservation;
