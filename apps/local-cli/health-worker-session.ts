import type { Outcome } from "../../core/contracts/public.js";
import type {
  BookmarkCleanDatabaseFailure,
  BookmarkCleanDatabaseSession,
  openBookmarkCleanDatabase,
} from "../../adapters/sqlite/public.js";
import type {
  createNodeRuntimePorts,
  NodeRuntimePorts,
} from "../../adapters/node/public.js";
import type {
  BookmarkCatalog,
  CatalogIdFactory,
  createBookmarkCatalog,
  createCryptoCatalogIdFactory,
} from "../../modules/catalog/public.js";
import type {
  createJobQueue,
  createJobWorker,
  JobQueue,
  JobQueueConfig,
  JobRetrySchedule,
  JobWorker,
  JobWorkerConfigurationFailure,
} from "../../modules/jobs/public.js";
import type {
  createHealthChecker,
  createHealthCheckJobHandler,
  HealthCheckConfig,
  HealthChecker,
} from "../../modules/health/public.js";

export interface HealthWorkerSessionConfig {
  readonly health: HealthCheckConfig;
  readonly queue: JobQueueConfig;
  readonly retrySchedule: JobRetrySchedule;
}

export interface HealthWorkerSession {
  readonly worker: JobWorker;
  close(): void;
}

export type HealthWorkerSessionFailure =
  | BookmarkCleanDatabaseFailure
  | JobWorkerConfigurationFailure;

export declare function openHealthWorkerSession(
  databasePath: string,
  config: HealthWorkerSessionConfig,
): Outcome<HealthWorkerSession, HealthWorkerSessionFailure>;

interface SqliteRuntime {
  openBookmarkCleanDatabase: typeof openBookmarkCleanDatabase;
}
interface NodeRuntime {
  createNodeRuntimePorts: typeof createNodeRuntimePorts;
}
interface CatalogRuntime {
  createBookmarkCatalog: typeof createBookmarkCatalog;
  createCryptoCatalogIdFactory: typeof createCryptoCatalogIdFactory;
}
interface JobsRuntime {
  createJobQueue: typeof createJobQueue;
  createJobWorker: typeof createJobWorker;
}
interface HealthRuntime {
  createHealthChecker: typeof createHealthChecker;
  createHealthCheckJobHandler: typeof createHealthCheckJobHandler;
}

declare const require: (specifier: string) => unknown;
declare const module: {
  exports: { openHealthWorkerSession: typeof openHealthWorkerSession };
};
const load = require as (specifier: string) => unknown;
const { openBookmarkCleanDatabase: openDatabase } = load(
  "../../adapters/sqlite/public.ts",
) as SqliteRuntime;
const { createNodeRuntimePorts: createRuntimePorts } = load(
  "../../adapters/node/public.ts",
) as NodeRuntime;
const {
  createBookmarkCatalog: createCatalog,
  createCryptoCatalogIdFactory: createCatalogIdFactory,
} = load(
  "../../modules/catalog/public.ts",
) as CatalogRuntime;
const { createJobQueue: createQueue, createJobWorker: createWorker } = load(
  "../../modules/jobs/public.ts",
) as JobsRuntime;
const {
  createHealthChecker: createChecker,
  createHealthCheckJobHandler: createHealthHandler,
} = load(
  "../../modules/health/public.ts",
) as HealthRuntime;

function makeCatalog(
  database: BookmarkCleanDatabaseSession,
  idFactory: CatalogIdFactory,
): BookmarkCatalog {
  return createCatalog({ idFactory, store: database.catalogStore });
}

function makeQueue(
  database: BookmarkCleanDatabaseSession,
  runtime: NodeRuntimePorts,
  config: HealthWorkerSessionConfig,
): JobQueue {
  return createQueue({
    clock: runtime.clock,
    retrySchedule: config.retrySchedule,
    idFactory: runtime.jobIdFactory,
    store: database.jobQueueStore,
    config: config.queue,
  });
}

function makeChecker(
  database: BookmarkCleanDatabaseSession,
  runtime: NodeRuntimePorts,
  config: HealthCheckConfig,
): HealthChecker {
  return createChecker({
    config,
    clock: runtime.clock,
    idFactory: runtime.healthIdFactory,
    transport: runtime.healthTransport,
    fingerprinter: runtime.bodyFingerprinter,
    repository: database.healthRepository,
  });
}

function openHealthWorkerSessionRuntime(
  databasePath: string,
  config: HealthWorkerSessionConfig,
): Outcome<HealthWorkerSession, HealthWorkerSessionFailure> {
  const opened = openDatabase(databasePath);
  if (!opened.ok) return opened;

  const runtime = createRuntimePorts();
  const catalog = makeCatalog(opened.value, createCatalogIdFactory());
  const queue = makeQueue(opened.value, runtime, config);
  const checker = makeChecker(opened.value, runtime, config.health);
  const handler = createHealthHandler({ catalog, checker });
  const worker = createWorker(queue, [handler]);
  if (!worker.ok) {
    opened.value.close();
    return worker;
  }

  return {
    ok: true,
    value: {
      worker: worker.value,
      close: () => opened.value.close(),
    },
  };
}

module.exports = { openHealthWorkerSession: openHealthWorkerSessionRuntime };
