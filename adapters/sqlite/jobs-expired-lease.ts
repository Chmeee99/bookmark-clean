import type { IsoDateTime } from "../../core/contracts/public.js";

interface SqliteRow {
  readonly [key: string]: unknown;
}

interface SqliteStatement {
  all(...parameters: unknown[]): SqliteRow[];
  run(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

interface ExpiredLease {
  readonly id: string;
  readonly attempt: number;
  readonly leaseToken: string;
  readonly maxAttempts: number;
  readonly batchState: "active" | "paused" | "cancelled";
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function changedExactlyOnce(result: unknown): boolean {
  if (!isRecord(result)) {
    return false;
  }
  return result.changes === 1 || result.changes === 1n;
}

function requireChangedExactlyOnce(result: unknown): void {
  if (!changedExactlyOnce(result)) {
    throw new Error("SQLite recovery changed an unexpected number of rows");
  }
}

function readExpiredLease(row: SqliteRow): ExpiredLease {
  if (
    !isNonEmptyString(row.id) ||
    !Number.isSafeInteger(row.attempt) ||
    !isNonEmptyString(row.lease_token) ||
    !Number.isSafeInteger(row.max_attempts) ||
    (row.batch_state !== "active" &&
      row.batch_state !== "paused" &&
      row.batch_state !== "cancelled")
  ) {
    throw new Error("Stored expired lease row is invalid");
  }
  return {
    id: row.id,
    attempt: row.attempt,
    leaseToken: row.lease_token,
    maxAttempts: row.max_attempts,
    batchState: row.batch_state,
  };
}

function recoverExpiredLeases(
  database: SqliteDatabase,
  now: IsoDateTime,
): void {
  const expiredRows = database
    .prepare(
      "SELECT jobs.id, jobs.attempt, jobs.lease_token, jobs.max_attempts, " +
        "job_batches.state AS batch_state " +
        "FROM jobs JOIN job_batches ON job_batches.id = jobs.batch_id " +
        "WHERE jobs.state = 'leased' AND jobs.lease_expires_at <= ? " +
        "ORDER BY jobs.id ASC",
    )
    .all(now)
    .map(readExpiredLease);

  for (const expired of expiredRows) {
    if (expired.batchState === "cancelled") {
      requireChangedExactlyOnce(
        database
          .prepare(
            "UPDATE jobs SET state = 'cancelled', lease_token = NULL, " +
              "worker_id = NULL, leased_at = NULL, lease_expires_at = NULL, " +
              "completed_at = ? WHERE id = ? AND state = 'leased' " +
              "AND lease_token = ? AND attempt = ?",
          )
          .run(now, expired.id, expired.leaseToken, expired.attempt),
      );
      continue;
    }

    if (expired.attempt >= expired.maxAttempts) {
      requireChangedExactlyOnce(
        database
          .prepare(
            "UPDATE jobs SET state = 'failed', lease_token = NULL, " +
              "worker_id = NULL, leased_at = NULL, lease_expires_at = NULL, " +
              "failure_code = 'lease_expired', failure_disposition = 'terminal', " +
              "failure_diagnostic = NULL, completed_at = ? " +
              "WHERE id = ? AND state = 'leased' AND lease_token = ? " +
              "AND attempt = ?",
          )
          .run(now, expired.id, expired.leaseToken, expired.attempt),
      );
      continue;
    }

    if (expired.batchState !== "active" && expired.batchState !== "paused") {
      throw new Error("Stored batch state is invalid");
    }
    requireChangedExactlyOnce(
      database
        .prepare(
          "UPDATE jobs SET state = 'pending', lease_token = NULL, " +
            "worker_id = NULL, leased_at = NULL, lease_expires_at = NULL " +
            "WHERE id = ? AND state = 'leased' AND lease_token = ? " +
            "AND attempt = ?",
        )
        .run(expired.id, expired.leaseToken, expired.attempt),
    );
  }
}

declare const module: {
  exports: {
    recoverExpiredLeases: typeof recoverExpiredLeases;
  };
};

module.exports = { recoverExpiredLeases };
