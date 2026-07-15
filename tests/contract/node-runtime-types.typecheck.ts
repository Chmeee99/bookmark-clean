import type {
  ContentHash,
  IsoDateTime,
  JobBatchId,
  JobId,
  JobLeaseToken,
  JobResultId,
} from "../../core/contracts/public.js";
import type {
  HealthBodyFingerprinter,
  HealthClock,
  HealthIdFactory,
  HealthTransport,
} from "../../modules/health/public.js";
import type { JobClock, JobIdFactory } from "../../modules/jobs/public.js";
import {
  createNodeRuntimePorts,
  type NodeRuntimeClock,
  type NodeRuntimePorts,
} from "../../adapters/node/public.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Condition extends true> = Condition;

type ClockContract = Assert<Equal<NodeRuntimeClock, {
  now(): IsoDateTime;
}>>;
type PortsContract = Assert<Equal<NodeRuntimePorts, {
  readonly clock: NodeRuntimeClock;
  readonly healthIdFactory: HealthIdFactory;
  readonly jobIdFactory: JobIdFactory;
  readonly bodyFingerprinter: HealthBodyFingerprinter;
  readonly healthTransport: HealthTransport;
}>>;
type FactoryContract = Assert<Equal<
  typeof createNodeRuntimePorts,
  () => NodeRuntimePorts
>>;

declare const ports: NodeRuntimePorts;
const healthClock: HealthClock = ports.clock;
const jobClock: JobClock = ports.clock;
const observationId: JobResultId = ports.healthIdFactory.nextObservationId();
const batchId: JobBatchId = ports.jobIdFactory.nextBatchId();
const jobId: JobId = ports.jobIdFactory.nextJobId();
const leaseToken: JobLeaseToken = ports.jobIdFactory.nextLeaseToken();
const fingerprint: ContentHash = ports.bodyFingerprinter.fingerprint(
  new Uint8Array(),
);
// @ts-expect-error the public factory accepts no safety options
createNodeRuntimePorts({ allowLoopback: true });
// @ts-expect-error the resolver stays private
ports.resolver;

void (null as unknown as ClockContract);
void (null as unknown as PortsContract);
void (null as unknown as FactoryContract);
void healthClock;
void jobClock;
void observationId;
void batchId;
void jobId;
void leaseToken;
void fingerprint;
