import type {
  ContentHash,
  IsoDateTime,
  JobResultId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  HealthBodyFingerprinter,
  HealthCheckConfig,
  HealthChecker,
  HealthCheckerDependencies,
  HealthClock,
  HealthIdFactory,
  HealthObservationRepository,
  HealthSelectedHeader,
  HealthTransport,
  HealthTransportFailure,
  HealthTransportFailureCode,
  HealthTransportRequest,
  HealthTransportResponse,
  createHealthChecker,
} from "../../modules/health/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;

type ConfigContract = Assert<Equal<HealthCheckConfig, {
  readonly timeoutMs: number;
  readonly maxRedirects: 5;
  readonly maxBodyBytes: number;
}>>;
type ClockContract = Assert<Equal<HealthClock, { now(): IsoDateTime }>>;
type IdFactoryContract = Assert<Equal<HealthIdFactory, {
  nextObservationId(): JobResultId;
}>>;
type RequestContract = Assert<Equal<HealthTransportRequest, {
  readonly url: string;
  readonly method: "GET";
  readonly redirect: "manual";
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
}>>;
type ResponseContract = Assert<Equal<HealthTransportResponse, {
  readonly url: string;
  readonly statusCode: number;
  readonly headers: readonly HealthSelectedHeader[];
  readonly body?: Uint8Array;
  readonly durationMs: number;
}>>;
type FailureContract = Assert<Equal<HealthTransportFailure, {
  readonly code: HealthTransportFailureCode;
  readonly durationMs: number;
}>>;
type TransportContract = Assert<Equal<HealthTransport, {
  request(
    request: HealthTransportRequest,
  ): Promise<Outcome<HealthTransportResponse, HealthTransportFailure>>;
}>>;
type FingerprinterContract = Assert<Equal<HealthBodyFingerprinter, {
  fingerprint(body: Uint8Array): ContentHash;
}>>;
type DependenciesContract = Assert<Equal<HealthCheckerDependencies, {
  readonly config: HealthCheckConfig;
  readonly clock: HealthClock;
  readonly idFactory: HealthIdFactory;
  readonly transport: HealthTransport;
  readonly fingerprinter: HealthBodyFingerprinter;
  readonly repository: HealthObservationRepository;
}>>;
type FactoryContract = Assert<Equal<
  typeof createHealthChecker,
  (dependencies: HealthCheckerDependencies) => HealthChecker
>>;

const sixthRedirect: HealthCheckConfig = {
  timeoutMs: 1,
  // @ts-expect-error the profile permits exactly five redirects
  maxRedirects: 6,
  maxBodyBytes: 1,
};
const retryConfiguration: HealthCheckConfig = {
  timeoutMs: 1,
  maxRedirects: 5,
  maxBodyBytes: 1,
  // @ts-expect-error retry configuration is outside health_check_v1
  maxAttempts: 2,
};
const wrongRequest: HealthTransportRequest = {
  url: "https://example.com",
  // @ts-expect-error transport accepts GET only
  method: "POST",
  // @ts-expect-error transport redirects are always manual
  redirect: "follow",
  timeoutMs: 1,
  maxBodyBytes: 1,
};
const wrongHeaders: readonly HealthSelectedHeader[] = [{
  // @ts-expect-error selected header names are closed
  name: "server",
  value: "hidden",
}];
// @ts-expect-error IDs require the shared brand
const unbrandedId: JobResultId = "observation-id";
// @ts-expect-error hashes require the shared brand
const unbrandedHash: ContentHash = "hash";

void (null as unknown as ConfigContract);
void (null as unknown as ClockContract);
void (null as unknown as IdFactoryContract);
void (null as unknown as RequestContract);
void (null as unknown as ResponseContract);
void (null as unknown as FailureContract);
void (null as unknown as TransportContract);
void (null as unknown as FingerprinterContract);
void (null as unknown as DependenciesContract);
void (null as unknown as FactoryContract);
void sixthRedirect;
void retryConfiguration;
void wrongRequest;
void wrongHeaders;
void unbrandedId;
void unbrandedHash;
