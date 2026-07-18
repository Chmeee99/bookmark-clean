import type {
  EnqueueBatchRequest,
  EnqueueJob,
  JobBatchSummary,
  JobQueueFailure,
  StoredEnqueueCommand,
} from "../../modules/jobs/public.js";
import type {
  BookmarkId,
  IsoDateTime,
  JobBatchId,
  JobId,
  Outcome,
} from "../../core/contracts/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  all(...parameters: unknown[]): SqliteRow[];
  get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
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
  migrateJobsSchema(database: SqliteDatabase): Outcome<void, JobQueueFailure>;
}

interface EnqueueApi {
  enqueueJobsBatch(
    database: SqliteDatabase,
    command: StoredEnqueueCommand,
  ): Outcome<JobBatchSummary, JobQueueFailure>;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const { DatabaseSync } = loadModule("node:sqlite") as SqliteApi;
const { withTemporaryDatabase } = loadModule(
  "../helpers/temporary-database.ts",
) as TemporaryDatabaseApi;
const { migrateJobsSchema } = loadModule(
  "../../adapters/sqlite/jobs-schema.ts",
) as SchemaApi;
const { enqueueJobsBatch } = loadModule(
  "../../adapters/sqlite/jobs-enqueue.ts",
) as EnqueueApi;

const NOW = "2026-07-13T12:00:00.000Z" as IsoDateTime;
const FUTURE = "2026-07-13T12:00:01.000Z" as IsoDateTime;
const BATCH_ID = "batch-fixed" as JobBatchId;
const SECOND_BATCH_ID = "batch-second" as JobBatchId;
const JOB_FIRST = "job-first" as JobId;
const JOB_SECOND = "job-second" as JobId;
const JOB_THIRD = "job-third" as JobId;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertFailure(
  result: Outcome<unknown, JobQueueFailure>,
  code: JobQueueFailure["code"],
  message: string,
): void {
  assert(!result.ok, `${message} should fail`);
  assertDeepEqual(result, { ok: false, error: { code } }, message);
}

function assertSuccess(
  result: Outcome<JobBatchSummary, JobQueueFailure>,
  message: string,
): asserts result is { ok: true; value: JobBatchSummary } {
  assert(result.ok, `${message} should succeed`);
}

async function withDatabase<T>(
  work: (database: SqliteDatabase) => T | PromiseLike<T>,
): Promise<T> {
  return withTemporaryDatabase(async ({ databasePath }) => {
    const database = new DatabaseSync(databasePath);
    try {
      return await work(database);
    } finally {
      if (database.isOpen) {
        database.close();
      }
    }
  });
}

function validJob(
  sequence: number,
  priority: number,
  bookmarkId: BookmarkId,
  notBefore?: IsoDateTime,
): EnqueueJob {
  return {
    type: "health_check",
    target: { kind: "bookmark", bookmarkId, inputVersion: "version-1" },
    priority,
    sequence,
    maxAttempts: 3,
    ...(notBefore === undefined ? {} : { notBefore }),
  };
}

function validRequest(): EnqueueBatchRequest {
  return {
    idempotencyKey: "request-1",
    jobs: [
      validJob(2, 10, "bookmark-1" as BookmarkId),
      validJob(1, -2, "bookmark-2" as BookmarkId, FUTURE),
    ],
  };
}

function validCommand(overrides: Record<string, unknown> = {}): StoredEnqueueCommand {
  return {
    request: validRequest(),
    requestFingerprint: "opaque-fingerprint-1",
    batchId: BATCH_ID,
    jobIds: [JOB_FIRST, JOB_SECOND],
    createdAt: NOW,
    ...overrides,
  } as unknown as StoredEnqueueCommand;
}

function migrate(database: SqliteDatabase): void {
  const result = migrateJobsSchema(database);
  assert(result.ok, "Jobs schema migration failed");
}

function rowCount(database: SqliteDatabase, table: "job_batches" | "jobs"): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return row?.count as number;
}

test("enqueue writes an active batch and exact request-order job rows", async () => {
  await withDatabase((database) => {
    migrate(database);
    const command = validCommand();
    const result = enqueueJobsBatch(database, command);
    assertSuccess(result, "Initial enqueue");
    assertDeepEqual(
      result,
      {
        ok: true,
        value: { batchId: BATCH_ID, state: "active", totalCount: 2, createdAt: NOW },
      },
      "Initial summary changed",
    );

    assertDeepEqual(
      database
        .prepare(
          "SELECT id, idempotency_key, request_fingerprint, state, total_count, created_at, changed_at FROM job_batches",
        )
        .all(),
      [{
        id: BATCH_ID,
        idempotency_key: "request-1",
        request_fingerprint: "opaque-fingerprint-1",
        state: "active",
        total_count: 2,
        created_at: NOW,
        changed_at: NOW,
      }],
      "Batch row changed",
    );
    assertDeepEqual(
      database
        .prepare(
          "SELECT id, batch_id, type, target_kind, bookmark_id, input_version, priority, sequence, max_attempts, not_before, state, attempt FROM jobs ORDER BY rowid",
        )
        .all(),
      [
        {
          id: JOB_FIRST,
          batch_id: BATCH_ID,
          type: "health_check",
          target_kind: "bookmark",
          bookmark_id: "bookmark-1",
          input_version: "version-1",
          priority: 10,
          sequence: 2,
          max_attempts: 3,
          not_before: null,
          state: "pending",
          attempt: 0,
        },
        {
          id: JOB_SECOND,
          batch_id: BATCH_ID,
          type: "health_check",
          target_kind: "bookmark",
          bookmark_id: "bookmark-2",
          input_version: "version-1",
          priority: -2,
          sequence: 1,
          max_attempts: 3,
          not_before: FUTURE,
          state: "pending",
          attempt: 0,
        },
      ],
      "Job rows changed",
    );
  });
});

test("same fingerprint replays the current summary without inserting rows", async () => {
  await withDatabase((database) => {
    migrate(database);
    const command = validCommand();
    assertSuccess(enqueueJobsBatch(database, command), "Initial enqueue");
    database
      .prepare("UPDATE job_batches SET state = 'paused', changed_at = ? WHERE id = ?")
      .run(FUTURE, BATCH_ID);
    const before = [rowCount(database, "job_batches"), rowCount(database, "jobs")];

    const replay = enqueueJobsBatch(database, command);
    assertDeepEqual(
      replay,
      {
        ok: true,
        value: { batchId: BATCH_ID, state: "paused", totalCount: 2, createdAt: NOW },
      },
      "Replay summary did not reflect current state",
    );
    assertDeepEqual(
      [rowCount(database, "job_batches"), rowCount(database, "jobs")],
      before,
      "Replay inserted rows",
    );
  });
});

test("replay rejects an invalid stored batch summary without repair", async () => {
  await withDatabase((database) => {
    migrate(database);
    assertSuccess(
      enqueueJobsBatch(database, validCommand()),
      "Initial enqueue for corrupt replay",
    );
    database
      .prepare("UPDATE job_batches SET created_at = ? WHERE id = ?")
      .run("not-a-time", BATCH_ID);

    assertFailure(
      enqueueJobsBatch(database, validCommand()),
      "stored_queue_invalid",
      "Corrupt replay summary",
    );
  });
});

test("conflicts and prequeried batch/job ID collisions do not write rows", async () => {
  await withDatabase((database) => {
    migrate(database);
    const original = validCommand();
    assertSuccess(enqueueJobsBatch(database, original), "Initial enqueue");
    const counts = () => [rowCount(database, "job_batches"), rowCount(database, "jobs")];
    const before = counts();

    assertFailure(
      enqueueJobsBatch(database, validCommand({ requestFingerprint: "different-fingerprint" })),
      "idempotency_conflict",
      "Fingerprint conflict",
    );
    assertDeepEqual(counts(), before, "Fingerprint conflict wrote rows");

    assertFailure(
      enqueueJobsBatch(
        database,
        validCommand({
          request: { ...validRequest(), idempotencyKey: "request-2" },
          requestFingerprint: "opaque-fingerprint-2",
          batchId: BATCH_ID,
          jobIds: ["job-new-a" as JobId, "job-new-b" as JobId],
        }),
      ),
      "invalid_request",
      "Batch ID collision",
    );
    assertDeepEqual(counts(), before, "Batch ID collision wrote rows");

    assertFailure(
      enqueueJobsBatch(
        database,
        validCommand({
          request: { ...validRequest(), idempotencyKey: "request-3" },
          requestFingerprint: "opaque-fingerprint-3",
          batchId: SECOND_BATCH_ID,
          jobIds: [JOB_FIRST, JOB_THIRD],
        }),
      ),
      "invalid_request",
      "Job ID collision",
    );
    assertDeepEqual(counts(), before, "Job ID collision wrote rows");
  });
});

test("malformed commands return invalid_request before durable writes", async () => {
  const base = validCommand();
  const baseRequest = validRequest();
  const baseJob = baseRequest.jobs[0];
  const sparseJobIds = [JOB_FIRST, JOB_SECOND];
  delete sparseJobIds[1];
  const cases: readonly { readonly name: string; readonly command: unknown }[] = [
    { name: "empty fingerprint", command: { ...base, requestFingerprint: "" } },
    { name: "empty batch ID", command: { ...base, batchId: "" } },
    { name: "empty job ID", command: { ...base, jobIds: ["", JOB_SECOND] } },
    { name: "mismatched ID length", command: { ...base, jobIds: [JOB_FIRST] } },
    { name: "empty request jobs", command: { ...base, request: { ...baseRequest, jobs: [] }, jobIds: [] } },
    { name: "sparse job IDs", command: { ...base, jobIds: sparseJobIds } },
    { name: "unknown command key", command: { ...base, extra: true } },
    { name: "unknown request key", command: { ...base, request: { ...baseRequest, extra: true } } },
    {
      name: "unknown job key",
      command: { ...base, request: { ...baseRequest, jobs: [{ ...baseJob, extra: true }, baseRequest.jobs[1]] } },
    },
    {
      name: "unknown target key",
      command: {
        ...base,
        request: {
          ...baseRequest,
          jobs: [{ ...baseJob, target: { ...baseJob.target, extra: true } }, baseRequest.jobs[1]],
        },
      },
    },
    {
      name: "invalid target value",
      command: {
        ...base,
        request: {
          ...baseRequest,
          jobs: [{ ...baseJob, target: { ...baseJob.target, inputVersion: "" } }, baseRequest.jobs[1]],
        },
      },
    },
    {
      name: "wrong job type",
      command: {
        ...base,
        request: {
          ...baseRequest,
          jobs: [{ ...baseJob, type: "other" }, baseRequest.jobs[1]],
        },
      },
    },
    {
      name: "wrong target kind",
      command: {
        ...base,
        request: {
          ...baseRequest,
          jobs: [{ ...baseJob, target: { ...baseJob.target, kind: "other" } }, baseRequest.jobs[1]],
        },
      },
    },
    {
      name: "invalid canonical time",
      command: {
        ...base,
        createdAt: "not-a-date",
      },
    },
    {
      name: "invalid notBefore",
      command: {
        ...base,
        request: {
          ...baseRequest,
          jobs: [{ ...baseJob, notBefore: "not-a-date" }, baseRequest.jobs[1]],
        },
      },
    },
    {
      name: "unsafe priority",
      command: {
        ...base,
        request: {
          ...baseRequest,
          jobs: [{ ...baseJob, priority: Number.MAX_SAFE_INTEGER + 1 }, baseRequest.jobs[1]],
        },
      },
    },
    {
      name: "negative sequence",
      command: {
        ...base,
        request: {
          ...baseRequest,
          jobs: [{ ...baseJob, sequence: -1 }, baseRequest.jobs[1]],
        },
      },
    },
    {
      name: "non-positive attempts",
      command: {
        ...base,
        request: {
          ...baseRequest,
          jobs: [{ ...baseJob, maxAttempts: 0 }, baseRequest.jobs[1]],
        },
      },
    },
    {
      name: "duplicate sequence",
      command: {
        ...base,
        request: {
          ...baseRequest,
          jobs: [{ ...baseJob, sequence: baseRequest.jobs[1].sequence }, baseRequest.jobs[1]],
        },
      },
    },
    {
      name: "duplicate IDs",
      command: { ...base, jobIds: [JOB_FIRST, JOB_FIRST] },
    },
    {
      name: "batch and job ID overlap",
      command: { ...base, batchId: JOB_FIRST },
    },
  ];

  for (const item of cases) {
    await withDatabase((database) => {
      migrate(database);
      assertFailure(
        enqueueJobsBatch(database, item.command as StoredEnqueueCommand),
        "invalid_request",
        item.name,
      );
      assertEqual(rowCount(database, "job_batches"), 0, `${item.name} wrote a batch`);
      assertEqual(rowCount(database, "jobs"), 0, `${item.name} wrote jobs`);
    });
  }
});

test("engine failure on the second job insert rolls back the complete enqueue", async () => {
  await withDatabase((database) => {
    migrate(database);
    database.exec(
      "CREATE TRIGGER abort_second_job_insert BEFORE INSERT ON jobs " +
        "WHEN NEW.sequence = 1 BEGIN SELECT RAISE(ABORT, 'test-only abort'); END",
    );
    const command = validCommand();

    assertFailure(
      enqueueJobsBatch(database, command),
      "storage_unavailable",
      "Aborted enqueue",
    );
    assertEqual(rowCount(database, "job_batches"), 0, "Aborted enqueue left a batch");
    assertEqual(rowCount(database, "jobs"), 0, "Aborted enqueue left jobs");

    database.exec("DROP TRIGGER abort_second_job_insert");
    assertSuccess(enqueueJobsBatch(database, command), "Retry after rollback");
    assertEqual(rowCount(database, "job_batches"), 1, "Retry did not insert a batch");
    assertEqual(rowCount(database, "jobs"), 2, "Retry did not insert both jobs");
  });
});

test("enqueue survives close and reopen, and closed databases return unavailable", async () => {
  await withTemporaryDatabase(async ({ databasePath }) => {
    const command = validCommand();
    const first = new DatabaseSync(databasePath);
    migrate(first);
    assertSuccess(enqueueJobsBatch(first, command), "Initial persistent enqueue");
    first.close();

    const reopened = new DatabaseSync(databasePath);
    try {
      migrate(reopened);
      assertDeepEqual(
        enqueueJobsBatch(reopened, command),
        {
          ok: true,
          value: { batchId: BATCH_ID, state: "active", totalCount: 2, createdAt: NOW },
        },
        "Reopen replay changed",
      );
      assertEqual(rowCount(reopened, "job_batches"), 1, "Reopen changed batch count");
      assertEqual(rowCount(reopened, "jobs"), 2, "Reopen changed job count");
      const persisted = reopened
        .prepare("SELECT id, state, sequence, not_before FROM jobs WHERE batch_id = ? ORDER BY rowid")
        .all(BATCH_ID);
      assertDeepEqual(
        persisted,
        [
          { id: JOB_FIRST, state: "pending", sequence: 2, not_before: null },
          { id: JOB_SECOND, state: "pending", sequence: 1, not_before: FUTURE },
        ],
        "Reopen rows changed",
      );
    } finally {
      if (reopened.isOpen) {
        reopened.close();
      }
    }

    const closed = new DatabaseSync(databasePath);
    closed.close();
    assertDeepEqual(
      enqueueJobsBatch(closed, command),
      { ok: false, error: { code: "storage_unavailable" } },
      "Closed enqueue failure changed",
    );
  });
});
