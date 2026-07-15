import type { Outcome } from "../../core/contracts/public.js";
import type { BookmarkCleanDatabaseFailure } from "../../adapters/sqlite/public.js";
import type { HealthCheckConfig } from "../../modules/health/public.js";
import type {
  JobQueueConfig,
  JobRetrySchedule,
  JobWorker,
  JobWorkerConfigurationFailure,
} from "../../modules/jobs/public.js";
import type {
  HealthWorkerSession,
  HealthWorkerSessionConfig,
  HealthWorkerSessionFailure,
} from "../../apps/local-cli/health-worker-session.js";
import { openHealthWorkerSession } from "../../apps/local-cli/health-worker-session.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type ConfigContract = Assert<Equal<HealthWorkerSessionConfig, {
  readonly health: HealthCheckConfig;
  readonly queue: JobQueueConfig;
  readonly retrySchedule: JobRetrySchedule;
}>>;
type SessionContract = Assert<Equal<HealthWorkerSession, {
  readonly worker: JobWorker;
  close(): void;
}>>;
type FailureContract = Assert<Equal<HealthWorkerSessionFailure,
  BookmarkCleanDatabaseFailure | JobWorkerConfigurationFailure
>>;
type FactoryContract = Assert<Equal<typeof openHealthWorkerSession,
  (
    databasePath: string,
    config: HealthWorkerSessionConfig,
  ) => Outcome<HealthWorkerSession, HealthWorkerSessionFailure>
>>;

void (null as unknown as ConfigContract);
void (null as unknown as SessionContract);
void (null as unknown as FailureContract);
void (null as unknown as FactoryContract);
