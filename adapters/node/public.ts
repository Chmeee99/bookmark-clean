import type { IsoDateTime } from "../../core/contracts/public.js";
import type {
  HealthBodyFingerprinter,
  HealthClock,
  HealthIdFactory,
  HealthTransport,
} from "../../modules/health/public.js";
import type { JobClock, JobIdFactory } from "../../modules/jobs/public.js";

export interface NodeRuntimeClock extends HealthClock, JobClock {
  now(): IsoDateTime;
}

export interface NodeRuntimePorts {
  readonly clock: NodeRuntimeClock;
  readonly healthIdFactory: HealthIdFactory;
  readonly jobIdFactory: JobIdFactory;
  readonly bodyFingerprinter: HealthBodyFingerprinter;
  readonly healthTransport: HealthTransport;
}

export declare function createNodeRuntimePorts(): NodeRuntimePorts;

interface NodeRuntime {
  createNodeRuntimePorts: typeof createNodeRuntimePorts;
}

declare const require: (specifier: "./node-runtime-ports.ts") => unknown;
declare const module: {
  exports: { createNodeRuntimePorts: typeof createNodeRuntimePorts };
};

const { createNodeRuntimePorts: createNodeRuntimePortsRuntime } = require(
  "./node-runtime-ports.ts",
) as NodeRuntime;

module.exports = { createNodeRuntimePorts: createNodeRuntimePortsRuntime };
