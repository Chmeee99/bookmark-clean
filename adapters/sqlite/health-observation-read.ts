import type { BookmarkId, Outcome } from "../../core/contracts/public.js";
import type {
  HealthObservation,
  HealthRepositoryFailure,
} from "../../modules/health/public.js";

interface SqliteRow { readonly [key: string]: unknown; }
interface SqliteStatement { get(...parameters: unknown[]): SqliteRow | undefined; }
interface SqliteDatabase { prepare(sql: string): SqliteStatement; }
interface ReconstructionApi {
  reconstructHealthObservation(
    row: SqliteRow,
  ): Outcome<HealthObservation, HealthRepositoryFailure>;
}

declare const require: (specifier: "./health-observation-reconstruction.ts") => unknown;
declare const module: {
  exports: { loadHealthObservationByInput: typeof loadHealthObservationByInput };
};

const { reconstructHealthObservation } = require(
  "./health-observation-reconstruction.ts",
) as ReconstructionApi;

const OBSERVATION_SELECT =
  "SELECT id, bookmark_id, input_version, status, checked_at, requested_url, " +
  "final_url, method, http_status, redirects_json, duration_ms, retry_count, " +
  "headers_json, error_code, body_fingerprint FROM health_observations " +
  "WHERE bookmark_id = ? AND input_version = ?";

function loadHealthObservationByInput(
  database: SqliteDatabase,
  bookmarkId: BookmarkId,
  inputVersion: string,
): Outcome<HealthObservation | null, HealthRepositoryFailure> {
  try {
    const row = database.prepare(OBSERVATION_SELECT).get(bookmarkId, inputVersion);
    return row === undefined
      ? { ok: true, value: null }
      : reconstructHealthObservation(row);
  } catch {
    return { ok: false, error: { code: "storage_unavailable" } };
  }
}

module.exports = { loadHealthObservationByInput };
