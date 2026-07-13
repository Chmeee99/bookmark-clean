import type {
  IsoDateTime,
  JobBatchId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  JobQueueFailure,
  StoredCompletionCommand,
  StoredFailureCommand,
} from "../../modules/jobs/public.js";

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface TransitionValidationApi {
  readonly isCanonicalUtc: (value: unknown) => value is IsoDateTime;
  readonly isNonEmptyString: (value: unknown) => value is string;
  readonly validateCompletionCommand: (
    input: unknown,
  ) => input is StoredCompletionCommand;
  readonly validateFailureCommand: (
    input: unknown,
  ) => input is StoredFailureCommand;
  readonly validateBatchStateInput: (
    batchId: unknown,
    action: unknown,
    changedAt: unknown,
  ) => boolean;
  readonly isBatchState: (value: unknown) => value is BatchState;
  readonly readLeaseRow: (
    database: SqliteDatabase,
    token: string,
    includeBatchState: boolean,
  ) => LeaseRow | undefined;
  readonly isCurrentLease: (
    lease: LeaseRow,
    expectedAttempt: number,
    commandTime: IsoDateTime,
  ) => boolean;
  readonly requireChangedExactlyOnce: (result: unknown) => void;
  readonly rollbackBestEffort: (database: SqliteDatabase) => void;
  readonly storageUnavailable: () => Outcome<void, JobQueueFailure>;
  readonly invalidRequest: () => Outcome<void, JobQueueFailure>;
  readonly staleLease: () => Outcome<void, JobQueueFailure>;
  readonly batchNotFound: () => Outcome<void, JobQueueFailure>;
  readonly invalidTransition: () => Outcome<void, JobQueueFailure>;
  readonly success: () => Outcome<void, JobQueueFailure>;
}

declare const require: (specifier: string) => unknown;

const {
  isCanonicalUtc,
  isNonEmptyString,
  isBatchState,
  readLeaseRow,
  isCurrentLease,
  requireChangedExactlyOnce,
  rollbackBestEffort,
  storageUnavailable,
  invalidRequest,
  staleLease,
  batchNotFound,
  invalidTransition,
  success,
  validateBatchStateInput,
  validateCompletionCommand,
  validateFailureCommand,
} = (require as unknown as (specifier: string) => unknown)(
  "./jobs-transition-validation.ts",
) as TransitionValidationApi;

type JobState =
  | "pending"
  | "leased"
  | "succeeded"
  | "retry_wait"
  | "failed"
  | "cancelled";
type BatchState = "active" | "paused" | "cancelled";

interface LeaseRow {
  readonly id: string;
  readonly state: JobState;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: IsoDateTime;
  readonly batchState?: BatchState;
}

function completeJobLease(
  database: SqliteDatabase,
  command: StoredCompletionCommand,
): Outcome<void, JobQueueFailure> {
  if (!validateCompletionCommand(command)) {
    return invalidRequest();
  }

  let transactionStarted = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const lease = readLeaseRow(database, command.token, false);
    if (lease === undefined || !isCurrentLease(lease, command.expectedAttempt, command.completedAt)) {
      rollbackBestEffort(database);
      transactionStarted = false;
      return staleLease();
    }

    requireChangedExactlyOnce(
      database
        .prepare(
          "UPDATE jobs SET state = 'succeeded', result_kind = ?, result_id = ?, " +
            "completed_at = ?, lease_token = NULL, worker_id = NULL, " +
            "leased_at = NULL, lease_expires_at = NULL, retry_at = NULL " +
            "WHERE id = ? AND state = 'leased' AND lease_token = ? " +
            "AND attempt = ? AND lease_expires_at > ?",
        )
        .run(
          command.result.kind,
          command.result.id,
          command.completedAt,
          lease.id,
          lease.leaseToken,
          command.expectedAttempt,
          command.completedAt,
        ),
    );
    database.exec("COMMIT");
    transactionStarted = false;
    return success();
  } catch {
    if (transactionStarted) {
      rollbackBestEffort(database);
    }
    return storageUnavailable();
  }
}

function failJobLease(
  database: SqliteDatabase,
  command: StoredFailureCommand,
): Outcome<void, JobQueueFailure> {
  if (!validateFailureCommand(command)) {
    return invalidRequest();
  }

  let transactionStarted = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const lease = readLeaseRow(database, command.token, true);
    if (lease === undefined || !isCurrentLease(lease, command.expectedAttempt, command.failedAt)) {
      rollbackBestEffort(database);
      transactionStarted = false;
      return staleLease();
    }

    const cancelled = lease.batchState === "cancelled";
    const retrying =
      !cancelled &&
      command.failure.disposition === "retry" &&
      lease.attempt < lease.maxAttempts;
    if (retrying && command.retryAt === undefined) {
      throw new Error("Validated retry failure has no retry time");
    }
    const state = cancelled ? "cancelled" : retrying ? "retry_wait" : "failed";
    const retryAt = retrying ? command.retryAt : null;
    const completedAt = retrying ? null : command.failedAt;
    const diagnostic = command.failure.diagnostic ?? null;

    requireChangedExactlyOnce(
      database
        .prepare(
          "UPDATE jobs SET state = ?, retry_at = ?, failure_code = ?, " +
            "failure_disposition = ?, failure_diagnostic = ?, completed_at = ?, " +
            "lease_token = NULL, worker_id = NULL, leased_at = NULL, " +
            "lease_expires_at = NULL " +
            "WHERE id = ? AND state = 'leased' AND lease_token = ? " +
            "AND attempt = ? AND lease_expires_at > ?",
        )
        .run(
          state,
          retryAt,
          command.failure.code,
          command.failure.disposition,
          diagnostic,
          completedAt,
          lease.id,
          lease.leaseToken,
          command.expectedAttempt,
          command.failedAt,
        ),
    );
    database.exec("COMMIT");
    transactionStarted = false;
    return success();
  } catch {
    if (transactionStarted) {
      rollbackBestEffort(database);
    }
    return storageUnavailable();
  }
}

function setJobsBatchState(
  database: SqliteDatabase,
  batchId: JobBatchId,
  action: "pause" | "resume" | "cancel",
  changedAt: IsoDateTime,
): Outcome<void, JobQueueFailure> {
  if (!validateBatchStateInput(batchId, action, changedAt)) {
    return invalidRequest();
  }

  let transactionStarted = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const batch = database
      .prepare("SELECT id, state, changed_at FROM job_batches WHERE id = ?")
      .get(batchId);
    if (batch === undefined) {
      rollbackBestEffort(database);
      transactionStarted = false;
      return batchNotFound();
    }
    if (
      !isNonEmptyString(batch.id) ||
      !isBatchState(batch.state) ||
      !isCanonicalUtc(batch.changed_at)
    ) {
      throw new Error("Stored batch row is invalid");
    }

    let nextState: BatchState | null = null;
    if (action === "pause") {
      if (batch.state === "cancelled") {
        rollbackBestEffort(database);
        transactionStarted = false;
        return invalidTransition();
      }
      nextState = batch.state === "active" ? "paused" : null;
    } else if (action === "resume") {
      if (batch.state === "cancelled") {
        rollbackBestEffort(database);
        transactionStarted = false;
        return invalidTransition();
      }
      nextState = batch.state === "paused" ? "active" : null;
    } else {
      nextState = batch.state === "cancelled" ? null : "cancelled";
    }

    if (nextState === null) {
      database.exec("COMMIT");
      transactionStarted = false;
      return success();
    }

    requireChangedExactlyOnce(
      database
        .prepare(
          "UPDATE job_batches SET state = ?, changed_at = ? " +
            "WHERE id = ? AND state = ?",
        )
        .run(nextState, changedAt, batch.id, batch.state),
    );

    if (action === "cancel") {
      database
        .prepare(
          "UPDATE jobs SET state = 'cancelled', retry_at = NULL, " +
            "completed_at = ? WHERE batch_id = ? " +
            "AND state IN ('pending', 'retry_wait')",
        )
        .run(changedAt, batch.id);
    }

    database.exec("COMMIT");
    transactionStarted = false;
    return success();
  } catch {
    if (transactionStarted) {
      rollbackBestEffort(database);
    }
    return storageUnavailable();
  }
}

declare const module: {
  exports: {
    completeJobLease: typeof completeJobLease;
    failJobLease: typeof failJobLease;
    setJobsBatchState: typeof setJobsBatchState;
  };
};

module.exports = {
  completeJobLease,
  failJobLease,
  setJobsBatchState,
};
