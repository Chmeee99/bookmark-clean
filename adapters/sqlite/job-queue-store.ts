import type {
  IsoDateTime,
  JobBatchId,
} from "../../core/contracts/public.js";
import type {
  JobQueueStore,
  StoredCompletionCommand,
  StoredEnqueueCommand,
  StoredFailureCommand,
  StoredLeaseCommand,
} from "../../modules/jobs/public.js";

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  all(...parameters: unknown[]): SqliteRow[];
  get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface EnqueueApi {
  enqueueJobsBatch(
    database: SqliteDatabase,
    command: StoredEnqueueCommand,
  ): ReturnType<JobQueueStore["enqueueBatch"]> extends Promise<infer T>
    ? T
    : never;
}

interface LeaseApi {
  leaseNextJob(
    database: SqliteDatabase,
    command: StoredLeaseCommand,
  ): ReturnType<JobQueueStore["leaseNext"]> extends Promise<infer T>
    ? T
    : never;
}

interface TransitionApi {
  completeJobLease(
    database: SqliteDatabase,
    command: StoredCompletionCommand,
  ): ReturnType<JobQueueStore["completeLease"]> extends Promise<infer T>
    ? T
    : never;
  failJobLease(
    database: SqliteDatabase,
    command: StoredFailureCommand,
  ): ReturnType<JobQueueStore["failLease"]> extends Promise<infer T>
    ? T
    : never;
  setJobsBatchState(
    database: SqliteDatabase,
    batchId: JobBatchId,
    action: "pause" | "resume" | "cancel",
    changedAt: IsoDateTime,
  ): ReturnType<JobQueueStore["setBatchState"]> extends Promise<infer T>
    ? T
    : never;
}

interface ProgressApi {
  readJobsProgress(
    database: SqliteDatabase,
    batchId: JobBatchId,
    now: IsoDateTime,
  ): ReturnType<JobQueueStore["readProgress"]> extends Promise<infer T>
    ? T
    : never;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { enqueueJobsBatch } = loadModule(
  "./jobs-enqueue.ts",
) as EnqueueApi;
const { leaseNextJob } = loadModule("./jobs-lease.ts") as LeaseApi;
const { completeJobLease, failJobLease, setJobsBatchState } = loadModule(
  "./jobs-transitions.ts",
) as TransitionApi;
const { readJobsProgress } = loadModule(
  "./jobs-progress.ts",
) as ProgressApi;

function createSqliteJobQueueStore(database: SqliteDatabase): JobQueueStore {
  return {
    async enqueueBatch(command) {
      return enqueueJobsBatch(database, command);
    },
    async leaseNext(command) {
      return leaseNextJob(database, command);
    },
    async completeLease(command) {
      return completeJobLease(database, command);
    },
    async failLease(command) {
      return failJobLease(database, command);
    },
    async setBatchState(batchId, action, changedAt) {
      return setJobsBatchState(database, batchId, action, changedAt);
    },
    async readProgress(batchId, now) {
      return readJobsProgress(database, batchId, now);
    },
  };
}

declare const module: {
  exports: {
    createSqliteJobQueueStore: typeof createSqliteJobQueueStore;
  };
};

module.exports = { createSqliteJobQueueStore };
