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
  HealthIdFactory,
  HealthTransport,
} from "../../modules/health/public.js";
import type { JobIdFactory } from "../../modules/jobs/public.js";
import type { NodeRuntimeClock, NodeRuntimePorts } from "./public.js";

interface Hash {
  update(data: Uint8Array): this;
  digest(encoding: "hex"): string;
}

interface CryptoApi {
  createHash(algorithm: "sha256"): Hash;
  randomUUID(): string;
}

interface HealthTransportApi {
  createNodeHealthTransport(): HealthTransport;
}

declare const require: (
  specifier: "node:crypto" | "./health-transport.ts",
) => unknown;
declare const module: {
  exports: { createNodeRuntimePorts: typeof createNodeRuntimePorts };
};

const { createHash, randomUUID } = require("node:crypto") as CryptoApi;
const { createNodeHealthTransport } = require(
  "./health-transport.ts",
) as HealthTransportApi;

function createClock(): NodeRuntimeClock {
  return {
    now() {
      return new Date().toISOString() as IsoDateTime;
    },
  };
}

function createHealthIdFactory(): HealthIdFactory {
  return {
    nextObservationId() {
      return `observation:${randomUUID()}` as JobResultId;
    },
  };
}

function createJobIdFactory(): JobIdFactory {
  return {
    nextBatchId() {
      return `batch:${randomUUID()}` as JobBatchId;
    },
    nextJobId() {
      return `job:${randomUUID()}` as JobId;
    },
    nextLeaseToken() {
      return `lease:${randomUUID()}` as JobLeaseToken;
    },
  };
}

function createBodyFingerprinter(): HealthBodyFingerprinter {
  return {
    fingerprint(body) {
      const digest = createHash("sha256").update(body).digest("hex");
      return `sha256:${digest}` as ContentHash;
    },
  };
}

function createNodeRuntimePorts(): NodeRuntimePorts {
  return {
    clock: createClock(),
    healthIdFactory: createHealthIdFactory(),
    jobIdFactory: createJobIdFactory(),
    bodyFingerprinter: createBodyFingerprinter(),
    healthTransport: createNodeHealthTransport(),
  };
}

module.exports = { createNodeRuntimePorts };
