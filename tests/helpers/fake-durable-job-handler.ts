import type { JobResultId, Outcome } from "../../core/contracts/public.js";
import type {
  JobHandler,
  JobLease,
  JobResultReference,
  JobTarget,
  JobType,
  TypedJobFailure,
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

export interface StableJobInput {
  readonly type: JobType;
  readonly target: JobTarget;
}

export interface FakeDurableResultRow {
  readonly stableInputKey: string;
  readonly resultId: JobResultId;
}

export interface FakeResultIdFactory {
  readonly generatedIds: readonly JobResultId[];
  nextResultId(): JobResultId;
}

export interface FakeDurableResultRepository {
  commitOrLoad(input: StableJobInput): JobResultReference;
  count(): number;
  rows(): readonly FakeDurableResultRow[];
}

export type FakeDurableHandlerMode =
  | "normal"
  | "interrupt_after_commit_once";

export interface FakeDurableJobHandler {
  readonly handler: JobHandler;
  readonly calls: readonly JobLease[];
}

const RESULT_TABLE = "test_fake_health_results";
const FIXED_INTERRUPTION = "test interruption after durable result commit";

function makeStableInputKey(input: StableJobInput): string {
  return JSON.stringify([
    input.type,
    input.target.kind,
    input.target.bookmarkId,
    input.target.inputVersion,
  ]);
}

function rollbackBestEffort(database: SqliteDatabase): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Rollback is best effort after a test-database failure.
  }
}

function readResultRow(row: SqliteRow): FakeDurableResultRow {
  if (
    typeof row.stable_input_key !== "string" ||
    row.stable_input_key.length === 0 ||
    typeof row.result_id !== "string" ||
    row.result_id.length === 0
  ) {
    throw new Error("Test durable result row is invalid");
  }
  return {
    stableInputKey: row.stable_input_key,
    resultId: row.result_id as JobResultId,
  };
}

function migrateFakeDurableResultSchema(database: SqliteDatabase): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${RESULT_TABLE} (
      stable_input_key TEXT PRIMARY KEY,
      result_id TEXT NOT NULL UNIQUE
    )`,
  );
}

function createFakeResultIdFactory(prefix = "fake-result"): FakeResultIdFactory {
  let sequence = 0;
  const generatedIds: JobResultId[] = [];

  return {
    generatedIds,
    nextResultId(): JobResultId {
      sequence += 1;
      const resultId = `${prefix}-${sequence}` as JobResultId;
      generatedIds.push(resultId);
      return resultId;
    },
  };
}

function createFakeDurableResultRepository(
  database: SqliteDatabase,
  resultIdFactory: FakeResultIdFactory,
): FakeDurableResultRepository {
  function commitOrLoad(input: StableJobInput): JobResultReference {
    const stableInputKey = makeStableInputKey(input);
    let transactionStarted = false;

    try {
      database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      const existing = database
        .prepare(
          `SELECT stable_input_key, result_id FROM ${RESULT_TABLE} ` +
            "WHERE stable_input_key = ?",
        )
        .get(stableInputKey);

      if (existing !== undefined) {
        const row = readResultRow(existing);
        database.exec("COMMIT");
        transactionStarted = false;
        return { kind: "health_observation", id: row.resultId };
      }

      const resultId = resultIdFactory.nextResultId();
      if (resultId.length === 0) {
        throw new Error("Test durable result ID is empty");
      }
      database
        .prepare(
          `INSERT INTO ${RESULT_TABLE}(stable_input_key, result_id) ` +
            "VALUES (?, ?)",
        )
        .run(stableInputKey, resultId);
      database.exec("COMMIT");
      transactionStarted = false;
      return { kind: "health_observation", id: resultId };
    } catch (error) {
      if (transactionStarted) {
        rollbackBestEffort(database);
      }
      throw error;
    }
  }

  function rows(): readonly FakeDurableResultRow[] {
    return database
      .prepare(
        `SELECT stable_input_key, result_id FROM ${RESULT_TABLE} ` +
          "ORDER BY result_id ASC",
      )
      .all()
      .map(readResultRow);
  }

  function count(): number {
    const row = database
      .prepare(`SELECT COUNT(*) AS count FROM ${RESULT_TABLE}`)
      .get();
    if (
      row === undefined ||
      typeof row.count !== "number" ||
      !Number.isSafeInteger(row.count)
    ) {
      throw new Error("Test durable result count is invalid");
    }
    return row.count;
  }

  return { commitOrLoad, count, rows };
}

function createFakeDurableJobHandler(
  repository: FakeDurableResultRepository,
  mode: FakeDurableHandlerMode,
): FakeDurableJobHandler {
  const calls: JobLease[] = [];
  let interrupted = false;
  const handler: JobHandler = {
    type: "health_check",
    async handle(
      lease,
    ): Promise<Outcome<JobResultReference, TypedJobFailure>> {
      calls.push(lease);
      const result = repository.commitOrLoad({
        type: lease.type,
        target: lease.target,
      });
      if (mode === "interrupt_after_commit_once" && !interrupted) {
        interrupted = true;
        throw new Error(FIXED_INTERRUPTION);
      }
      return { ok: true, value: result };
    },
  };
  return { handler, calls };
}

declare const module: {
  exports: {
    makeStableInputKey: typeof makeStableInputKey;
    migrateFakeDurableResultSchema: typeof migrateFakeDurableResultSchema;
    createFakeResultIdFactory: typeof createFakeResultIdFactory;
    createFakeDurableResultRepository: typeof createFakeDurableResultRepository;
    createFakeDurableJobHandler: typeof createFakeDurableJobHandler;
  };
};

module.exports = {
  makeStableInputKey,
  migrateFakeDurableResultSchema,
  createFakeResultIdFactory,
  createFakeDurableResultRepository,
  createFakeDurableJobHandler,
};
