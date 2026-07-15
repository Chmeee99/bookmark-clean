import type { Outcome } from "../../core/contracts/public.js";
import type {
  HealthObservation,
  HealthObservationRepository,
  HealthRepositoryFailure,
  HealthSelectedHeader,
  RedirectHop,
} from "../../modules/health/public.js";

interface SqliteRow { readonly [key: string]: unknown; }
interface SqliteStatement { run(...parameters: unknown[]): unknown; }
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}
interface ReadApi {
  loadHealthObservationByInput(
    database: SqliteDatabase,
    bookmarkId: HealthObservation["bookmarkId"],
    inputVersion: string,
  ): Outcome<HealthObservation | null, HealthRepositoryFailure>;
}
interface ReconstructionApi {
  reconstructHealthObservation(
    row: SqliteRow,
  ): Outcome<HealthObservation, HealthRepositoryFailure>;
}

declare const require: (
  specifier:
    | "./health-observation-read.ts"
    | "./health-observation-reconstruction.ts",
) => unknown;
declare const module: {
  exports: {
    createSqliteHealthObservationStore: typeof createSqliteHealthObservationStore;
  };
};

const { loadHealthObservationByInput } = require(
  "./health-observation-read.ts",
) as ReadApi;
const { reconstructHealthObservation } = require(
  "./health-observation-reconstruction.ts",
) as ReconstructionApi;

const OBSERVATION_INSERT =
  "INSERT INTO health_observations(" +
  "id, bookmark_id, input_version, status, checked_at, requested_url, final_url, " +
  "method, http_status, redirects_json, duration_ms, retry_count, headers_json, " +
  "error_code, body_fingerprint" +
  ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

function unavailable<T>(): Outcome<T, HealthRepositoryFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function rollbackBestEffort(database: SqliteDatabase): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The storage failure remains the public outcome.
  }
}

function redirectEqual(left: RedirectHop, right: RedirectHop): boolean {
  return (
    left.requestedUrl === right.requestedUrl &&
    left.statusCode === right.statusCode &&
    left.location === right.location &&
    left.nextUrl === right.nextUrl
  );
}

function headerEqual(
  left: HealthSelectedHeader,
  right: HealthSelectedHeader,
): boolean {
  return left.name === right.name && left.value === right.value;
}

function arraysEqual<T>(
  left: readonly T[],
  right: readonly T[],
  itemEqual: (left: T, right: T) => boolean,
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => itemEqual(item, right[index]))
  );
}

function observationsEqual(
  left: HealthObservation,
  right: HealthObservation,
): boolean {
  return (
    left.id === right.id &&
    left.bookmarkId === right.bookmarkId &&
    left.inputVersion === right.inputVersion &&
    left.status === right.status &&
    left.checkedAt === right.checkedAt &&
    left.requestedUrl === right.requestedUrl &&
    left.finalUrl === right.finalUrl &&
    left.method === right.method &&
    left.httpStatus === right.httpStatus &&
    arraysEqual(left.redirects, right.redirects, redirectEqual) &&
    left.durationMs === right.durationMs &&
    left.retryCount === right.retryCount &&
    arraysEqual(left.headers, right.headers, headerEqual) &&
    left.errorCode === right.errorCode &&
    left.bodyFingerprint === right.bodyFingerprint
  );
}

function candidateRow(observation: HealthObservation): SqliteRow {
  return {
    id: observation.id,
    bookmark_id: observation.bookmarkId,
    input_version: observation.inputVersion,
    status: observation.status,
    checked_at: observation.checkedAt,
    requested_url: observation.requestedUrl,
    final_url: observation.finalUrl ?? null,
    method: observation.method,
    http_status: observation.httpStatus ?? null,
    redirects_json: JSON.stringify(observation.redirects),
    duration_ms: observation.durationMs,
    retry_count: observation.retryCount,
    headers_json: JSON.stringify(observation.headers),
    error_code: observation.errorCode ?? null,
    body_fingerprint: observation.bodyFingerprint ?? null,
  };
}

function insertObservation(
  database: SqliteDatabase,
  observation: HealthObservation,
): void {
  database.prepare(OBSERVATION_INSERT).run(
    observation.id,
    observation.bookmarkId,
    observation.inputVersion,
    observation.status,
    observation.checkedAt,
    observation.requestedUrl,
    observation.finalUrl ?? null,
    observation.method,
    observation.httpStatus ?? null,
    JSON.stringify(observation.redirects),
    observation.durationMs,
    observation.retryCount,
    JSON.stringify(observation.headers),
    observation.errorCode ?? null,
    observation.bodyFingerprint ?? null,
  );
}

function createSqliteHealthObservationStore(
  database: SqliteDatabase,
): HealthObservationRepository {
  return {
    async loadByInput(bookmarkId, inputVersion) {
      return loadHealthObservationByInput(database, bookmarkId, inputVersion);
    },
    async saveIfAbsent(observation) {
      let candidate: Outcome<HealthObservation, HealthRepositoryFailure>;
      try {
        candidate = reconstructHealthObservation(candidateRow(observation));
      } catch {
        return unavailable();
      }
      if (!candidate.ok) return candidate;

      let transactionStarted = false;
      try {
        database.exec("BEGIN IMMEDIATE");
        transactionStarted = true;
        const existing = loadHealthObservationByInput(
          database,
          candidate.value.bookmarkId,
          candidate.value.inputVersion,
        );
        if (!existing.ok) {
          rollbackBestEffort(database);
          transactionStarted = false;
          return existing;
        }
        if (existing.value !== null) {
          database.exec("COMMIT");
          transactionStarted = false;
          return observationsEqual(existing.value, candidate.value)
            ? existing
            : { ok: false, error: { code: "observation_conflict" } };
        }

        insertObservation(database, candidate.value);
        const stored = loadHealthObservationByInput(
          database,
          candidate.value.bookmarkId,
          candidate.value.inputVersion,
        );
        if (!stored.ok || stored.value === null) {
          rollbackBestEffort(database);
          transactionStarted = false;
          return unavailable();
        }
        database.exec("COMMIT");
        transactionStarted = false;
        return stored;
      } catch {
        if (transactionStarted) rollbackBestEffort(database);
        return unavailable();
      }
    },
  };
}

module.exports = { createSqliteHealthObservationStore };
