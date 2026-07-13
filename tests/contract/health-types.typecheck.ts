import type {
  BookmarkId,
  ContentHash,
  IsoDateTime,
  JobResultId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  HealthBodyFingerprinter,
  HealthCheckConfig,
  HealthCheckRequest,
  HealthChecker,
  HealthClock,
  HealthDelay,
  HealthFailure,
  HealthFailureCode,
  HealthIdFactory,
  HealthObservation,
  HealthObservationErrorCode,
  HealthObservationRepository,
  HealthRepositoryFailure,
  HealthRepositoryFailureCode,
  HealthRetryDecision,
  HealthRetryPolicy,
  HealthSelectedHeader,
  HealthSelectedHeaderName,
  HealthService,
  HealthStatus,
  HealthTransport,
  HealthTransportFact,
  HealthTransportFailure,
  HealthTransportFailureCode,
  HealthTransportRequest,
  HealthTransportResponse,
  RedirectHop,
  StalenessAssessment,
  StalenessDisposition,
  StalenessInput,
  StalenessPolicy,
  StalenessReasonCode,
} from "../../modules/health/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type Statuses = Assert<
  Equal<
    HealthStatus,
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
  >
>;
type TransportFailures = Assert<
  Equal<
    HealthTransportFailureCode,
    | "unsupported_url"
    | "timeout"
    | "dns_failure"
    | "tls_error"
    | "connection_failure"
    | "malformed_response"
    | "unknown_transport"
  >
>;
type ObservationErrors = Assert<
  Equal<
    HealthObservationErrorCode,
    HealthTransportFailureCode | "invalid_redirect" | "redirect_limit"
  >
>;
type SelectedHeaders = Assert<
  Equal<
    HealthSelectedHeaderName,
    "content-type" | "location" | "retry-after" | "etag" | "last-modified"
  >
>;
type ServiceFailures = Assert<
  Equal<
    HealthFailureCode,
    | "invalid_request"
    | "input_conflict"
    | "invalid_configuration"
    | "clock_unavailable"
    | "id_unavailable"
    | "transport_unavailable"
    | "storage_unavailable"
  >
>;
type RepositoryFailures = Assert<
  Equal<
    HealthRepositoryFailureCode,
    "observation_conflict" | "storage_unavailable"
  >
>;
type StalenessDispositions = Assert<
  Equal<StalenessDisposition, "no_warning" | "retry" | "review">
>;
type StalenessReasons = Assert<
  Equal<
    StalenessReasonCode,
    | "no_observations"
    | "recent_reachable_observation"
    | "user_exception"
    | "single_failure_needs_confirmation"
    | "transient_or_access_failure"
    | "repeated_not_found_or_gone"
    | "repeated_typed_page_suspicion"
  >
>;
type RetryDecisions = Assert<
  Equal<
    HealthRetryDecision,
    | { readonly retry: false }
    | { readonly retry: true; readonly delayMs: number }
  >
>;

type CheckMethod = Assert<
  Equal<
    HealthChecker["check"],
    (
      request: HealthCheckRequest,
    ) => Promise<Outcome<HealthObservation, HealthFailure>>
  >
>;
type AssessMethod = Assert<
  Equal<
    StalenessPolicy["assessStaleness"],
    (input: StalenessInput) => StalenessAssessment
  >
>;
type ComposedCheckMethod = Assert<
  Equal<HealthService["check"], HealthChecker["check"]>
>;
type ComposedAssessMethod = Assert<
  Equal<HealthService["assessStaleness"], StalenessPolicy["assessStaleness"]>
>;
type TransportMethod = Assert<
  Equal<
    HealthTransport["request"],
    (
      request: HealthTransportRequest,
    ) => Promise<Outcome<HealthTransportResponse, HealthTransportFailure>>
  >
>;
type RepositoryLoadMethod = Assert<
  Equal<
    HealthObservationRepository["loadByInput"],
    (
      bookmarkId: BookmarkId,
      inputVersion: string,
    ) => Promise<Outcome<HealthObservation | null, HealthRepositoryFailure>>
  >
>;
type RepositorySaveMethod = Assert<
  Equal<
    HealthObservationRepository["saveIfAbsent"],
    (
      observation: HealthObservation,
    ) => Promise<Outcome<HealthObservation, HealthRepositoryFailure>>
  >
>;
type RepositoryListMethod = Assert<
  Equal<
    HealthObservationRepository["listForBookmark"],
    (
      bookmarkId: BookmarkId,
    ) => Promise<Outcome<readonly HealthObservation[], HealthRepositoryFailure>>
  >
>;

declare const bookmarkId: BookmarkId;
declare const observationId: JobResultId;
declare const now: IsoDateTime;
declare const hash: ContentHash;

const header: HealthSelectedHeader = {
  name: "content-type",
  value: "text/html",
};
const hop: RedirectHop = {
  requestedUrl: "https://example.test/old",
  statusCode: 301,
  location: "/new",
  nextUrl: "https://example.test/new",
};
const request: HealthCheckRequest = {
  bookmarkId,
  inputVersion: "snapshot:v1",
  url: "https://example.test/old",
};
const observation: HealthObservation = {
  id: observationId,
  bookmarkId,
  inputVersion: request.inputVersion,
  status: "redirect_permanent",
  checkedAt: now,
  requestedUrl: request.url,
  finalUrl: "https://example.test/new",
  method: "GET",
  httpStatus: 200,
  redirects: [hop],
  durationMs: 20,
  retryCount: 0,
  headers: [header],
  bodyFingerprint: hash,
};
const serviceFailure: HealthFailure = {
  code: "storage_unavailable",
  disposition: "retry",
};
const transportRequest: HealthTransportRequest = {
  url: request.url,
  method: "GET",
  redirect: "manual",
  timeoutMs: 1_000,
  maxBodyBytes: 64_000,
};
const transportResponse: HealthTransportResponse = {
  url: request.url,
  statusCode: 200,
  headers: [header],
  body: new Uint8Array(),
  durationMs: 10,
};
const transportFailure: HealthTransportFailure = {
  code: "timeout",
  durationMs: 1_000,
};
const responseFact: HealthTransportFact = {
  kind: "response",
  value: transportResponse,
};
const failureFact: HealthTransportFact = {
  kind: "failure",
  value: transportFailure,
};
const retryDecision: HealthRetryDecision = { retry: true, delayMs: 50 };
const noRetryDecision: HealthRetryDecision = { retry: false };
const repositoryFailure: HealthRepositoryFailure = {
  code: "observation_conflict",
};
const stalenessInput: StalenessInput = {
  bookmarkId,
  observations: [observation],
  assessedAt: now,
  userException: false,
};
const assessment: StalenessAssessment = {
  disposition: "no_warning",
  confidence: 1,
  reasonCodes: ["recent_reachable_observation"],
  observationIds: [observationId],
  policyVersion: "staleness:v1",
};
const clock: HealthClock = { now: () => now };
const ids: HealthIdFactory = { nextObservationId: () => observationId };
const config: HealthCheckConfig = {
  timeoutMs: 1_000,
  maxRedirects: 5,
  maxBodyBytes: 64_000,
  maxAttempts: 2,
};
const retryPolicy: HealthRetryPolicy = {
  decide: () => noRetryDecision,
};
const delay: HealthDelay = { wait: async () => undefined };
const fingerprinter: HealthBodyFingerprinter = {
  fingerprint: () => hash,
};
const checker: HealthChecker = {
  check: async () => ({ ok: true, value: observation }),
};
const stalenessPolicy: StalenessPolicy = {
  assessStaleness: () => assessment,
};
const healthService: HealthService = {
  ...checker,
  ...stalenessPolicy,
};

// @ts-expect-error Health status changes require an architecture contract
const unknownStatus: HealthStatus = "dead";
// @ts-expect-error redirect status is a closed HTTP set
const invalidHop: RedirectHop = { ...hop, statusCode: 306 };
const automaticRedirect: HealthTransportRequest = {
  ...transportRequest,
  // @ts-expect-error production transport must preserve manual redirect handling
  redirect: "follow",
};
// @ts-expect-error observations store fingerprints rather than raw bodies
observation.body = "untrusted page prose";
// @ts-expect-error staleness never authorizes deletion
const deleteDisposition: StalenessDisposition = "delete";
// @ts-expect-error reason codes are architecture-owned
const arbitraryReason: StalenessReasonCode = "looks_dead";
// @ts-expect-error service failures always declare retry or terminal disposition
const dispositionlessFailure: HealthFailure = { code: "storage_unavailable" };
// @ts-expect-error observation identity uses the shared JobResultId brand
const stringObservationId: HealthObservation["id"] = "observation-1";

void (null as unknown as Statuses);
void (null as unknown as TransportFailures);
void (null as unknown as ObservationErrors);
void (null as unknown as SelectedHeaders);
void (null as unknown as ServiceFailures);
void (null as unknown as RepositoryFailures);
void (null as unknown as StalenessDispositions);
void (null as unknown as StalenessReasons);
void (null as unknown as RetryDecisions);
void (null as unknown as CheckMethod);
void (null as unknown as AssessMethod);
void (null as unknown as ComposedCheckMethod);
void (null as unknown as ComposedAssessMethod);
void (null as unknown as TransportMethod);
void (null as unknown as RepositoryLoadMethod);
void (null as unknown as RepositorySaveMethod);
void (null as unknown as RepositoryListMethod);
void responseFact;
void failureFact;
void retryDecision;
void repositoryFailure;
void stalenessInput;
void assessment;
void clock;
void ids;
void config;
void retryPolicy;
void delay;
void fingerprinter;
void checker;
void stalenessPolicy;
void healthService;
void unknownStatus;
void invalidHop;
void automaticRedirect;
void deleteDisposition;
void arbitraryReason;
void dispositionlessFailure;
void stringObservationId;
