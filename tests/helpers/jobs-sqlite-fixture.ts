import type {
  BookmarkId,
  IsoDateTime,
  JobBatchId,
  JobId,
  JobLeaseToken,
  WorkerId,
} from "../../core/contracts/public.js";
import type {
  EnqueueJob,
  StoredEnqueueCommand,
  StoredLeaseCommand,
} from "../../modules/jobs/public.js";

export interface SqliteRow {
  readonly [key: string]: unknown;
}

export interface SqliteStatement {
  all(...parameters: unknown[]): SqliteRow[];
  get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): unknown;
}

export interface SqliteDatabase {
  readonly isOpen: boolean;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteApi {
  DatabaseSync: new (location: string) => SqliteDatabase;
}

interface TemporaryDatabaseApi {
  withTemporaryDatabase<T>(
    work: (database: { readonly databasePath: string }) => T | PromiseLike<T>,
  ): Promise<T>;
}

interface SchemaApi {
  migrateJobsSchema(database: SqliteDatabase): { readonly ok: boolean };
}

interface EnqueueApi {
  enqueueJobsBatch(
    database: SqliteDatabase,
    command: StoredEnqueueCommand,
  ): { readonly ok: boolean; readonly value?: unknown };
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { DatabaseSync } = loadModule("node:sqlite") as SqliteApi;
const { withTemporaryDatabase } = loadModule(
  "./temporary-database.ts",
) as TemporaryDatabaseApi;
const { migrateJobsSchema } = loadModule(
  "../../adapters/sqlite/jobs-schema.ts",
) as SchemaApi;
const { enqueueJobsBatch } = loadModule(
  "../../adapters/sqlite/jobs-enqueue.ts",
) as EnqueueApi;

const NOW = "2026-07-13T12:00:00.000Z" as IsoDateTime;
const ONE_SECOND_LATER = "2026-07-13T12:00:01.000Z" as IsoDateTime;
const TWO_SECONDS_LATER = "2026-07-13T12:00:02.000Z" as IsoDateTime;
const EXPIRED_AT = "2026-07-13T11:59:59.000Z" as IsoDateTime;
const EARLIER_CREATED_AT = "2026-07-13T11:00:00.000Z" as IsoDateTime;
const LATER_CREATED_AT = "2026-07-13T11:00:01.000Z" as IsoDateTime;

function makeJob(overrides: Partial<EnqueueJob> = {}): EnqueueJob {
  return {
    type: "health_check",
    target: {
      kind: "bookmark",
      bookmarkId: "bookmark-fixed" as BookmarkId,
      inputVersion: "version-1",
    },
    priority: 0,
    sequence: 0,
    maxAttempts: 3,
    ...overrides,
  };
}

export interface EnqueueCommandOptions {
  readonly batchId?: JobBatchId;
  readonly idempotencyKey?: string;
  readonly requestFingerprint?: string;
  readonly createdAt?: IsoDateTime;
  readonly jobs?: readonly EnqueueJob[];
  readonly jobIds?: readonly JobId[];
}

function makeEnqueueCommand(
  options: EnqueueCommandOptions = {},
): StoredEnqueueCommand {
  const batchId = options.batchId ?? ("batch-fixed" as JobBatchId);
  const jobs = options.jobs ?? [makeJob()];
  const jobIds =
    options.jobIds ??
    jobs.map((_, index) => `${batchId}-job-${index}` as JobId);
  const idempotencyKey = options.idempotencyKey ?? `${batchId}-request`;

  return {
    request: { idempotencyKey, jobs },
    requestFingerprint:
      options.requestFingerprint ?? `${idempotencyKey}-fingerprint`,
    batchId,
    jobIds,
    createdAt: options.createdAt ?? NOW,
  };
}

function makeLeaseCommand(
  overrides: Partial<StoredLeaseCommand> = {},
): StoredLeaseCommand {
  return {
    worker: { id: "worker-fixed" as WorkerId },
    capabilities: ["health_check"],
    now: NOW,
    expiresAt: ONE_SECOND_LATER,
    token: "token-fixed" as JobLeaseToken,
    ...overrides,
  };
}

function enqueueJobs(
  database: SqliteDatabase,
  command: StoredEnqueueCommand,
): void {
  const result = enqueueJobsBatch(database, command);
  if (!result.ok) {
    throw new Error("Fixture enqueue failed");
  }
}

function forceLease(
  database: SqliteDatabase,
  options: {
    readonly jobId: JobId;
    readonly attempt: number;
    readonly token: string;
    readonly expiresAt?: IsoDateTime;
    readonly workerId?: string;
    readonly failureCode?: string;
    readonly failureDisposition?: "retry" | "terminal";
    readonly failureDiagnostic?: string;
  },
): void {
  database
    .prepare(
      "UPDATE jobs SET state = 'leased', attempt = ?, lease_token = ?, " +
        "worker_id = ?, leased_at = ?, lease_expires_at = ?, retry_at = NULL, " +
        "failure_code = ?, failure_disposition = ?, failure_diagnostic = ? " +
        "WHERE id = ?",
    )
    .run(
      options.attempt,
      options.token,
      options.workerId ?? "worker-crashed",
      NOW,
      options.expiresAt ?? EXPIRED_AT,
      options.failureCode ?? null,
      options.failureDisposition ?? null,
      options.failureDiagnostic ?? null,
      options.jobId,
    );
}

function readJob(
  database: SqliteDatabase,
  jobId: JobId,
): SqliteRow | undefined {
  return database
    .prepare(
      "SELECT id, batch_id, state, attempt, not_before, retry_at, " +
        "lease_token, worker_id, leased_at, lease_expires_at, failure_code, " +
        "failure_disposition, failure_diagnostic, completed_at " +
        "FROM jobs WHERE id = ?",
    )
    .get(jobId);
}

async function withJobsDatabase<T>(
  work: (database: SqliteDatabase) => T | PromiseLike<T>,
): Promise<T> {
  return withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      const migration = migrateJobsSchema(database);
      if (!migration.ok) {
        throw new Error("Fixture migration failed");
      }
      return await work(database);
    } finally {
      if (database.isOpen) {
        database.close();
      }
    }
  });
}

async function withClosedJobsDatabase<T>(
  work: (database: SqliteDatabase) => T | PromiseLike<T>,
): Promise<T> {
  return withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    database.close();
    return work(database);
  });
}

export interface JobsSqliteFixtureApi {
  readonly NOW: IsoDateTime;
  readonly ONE_SECOND_LATER: IsoDateTime;
  readonly TWO_SECONDS_LATER: IsoDateTime;
  readonly EXPIRED_AT: IsoDateTime;
  readonly EARLIER_CREATED_AT: IsoDateTime;
  readonly LATER_CREATED_AT: IsoDateTime;
  readonly makeJob: typeof makeJob;
  readonly makeEnqueueCommand: typeof makeEnqueueCommand;
  readonly makeLeaseCommand: typeof makeLeaseCommand;
  readonly enqueueJobs: typeof enqueueJobs;
  readonly forceLease: typeof forceLease;
  readonly readJob: typeof readJob;
  readonly withJobsDatabase: typeof withJobsDatabase;
  readonly withClosedJobsDatabase: typeof withClosedJobsDatabase;
}

declare const module: { exports: JobsSqliteFixtureApi };

module.exports = {
  NOW,
  ONE_SECOND_LATER,
  TWO_SECONDS_LATER,
  EXPIRED_AT,
  EARLIER_CREATED_AT,
  LATER_CREATED_AT,
  makeJob,
  makeEnqueueCommand,
  makeLeaseCommand,
  enqueueJobs,
  forceLease,
  readJob,
  withJobsDatabase,
  withClosedJobsDatabase,
};
