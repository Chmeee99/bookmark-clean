import type { Outcome } from "../../core/contracts/public.js";
import type { HealthRepositoryFailure } from "../../modules/health/public.js";

interface SqliteRow { readonly [key: string]: unknown; }
interface SqliteStatement {
  get(...parameters: unknown[]): SqliteRow | undefined;
  run(...parameters: unknown[]): unknown;
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

const MIGRATION_KEY = "003_health_observations";

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);`;

const HEALTH_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS health_observations (
  id TEXT PRIMARY KEY CHECK (length(id) > 0),
  bookmark_id TEXT NOT NULL CHECK (length(bookmark_id) > 0),
  input_version TEXT NOT NULL CHECK (length(input_version) > 0),
  status TEXT NOT NULL CHECK (status IN (
    'healthy', 'redirect_permanent', 'redirect_temporary',
    'authentication_required', 'forbidden', 'rate_limited', 'server_error',
    'dns_failure', 'timeout', 'tls_error', 'not_found', 'gone',
    'soft_404_suspected', 'parked_domain_suspected', 'unsupported_url', 'uncertain'
  )),
  checked_at TEXT NOT NULL,
  requested_url TEXT NOT NULL CHECK (length(requested_url) > 0),
  final_url TEXT CHECK (final_url IS NULL OR length(final_url) > 0),
  method TEXT NOT NULL CHECK (method = 'GET'),
  http_status INTEGER CHECK (
    http_status IS NULL OR (http_status >= 100 AND http_status <= 599)
  ),
  redirects_json TEXT NOT NULL CHECK (length(redirects_json) > 0),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  retry_count INTEGER NOT NULL CHECK (retry_count >= 0),
  headers_json TEXT NOT NULL CHECK (length(headers_json) > 0),
  error_code TEXT CHECK (error_code IS NULL OR error_code IN (
    'unsupported_url', 'timeout', 'dns_failure', 'tls_error',
    'connection_failure', 'malformed_response', 'unknown_transport',
    'invalid_redirect', 'redirect_limit'
  )),
  body_fingerprint TEXT CHECK (
    body_fingerprint IS NULL OR length(body_fingerprint) > 0
  ),
  UNIQUE (bookmark_id, input_version)
);

CREATE INDEX IF NOT EXISTS health_observations_bookmark
  ON health_observations(bookmark_id, checked_at, id);`;

function unavailable(): Outcome<void, HealthRepositoryFailure> {
  return { ok: false, error: { code: "storage_unavailable" } };
}

function rollbackBestEffort(database: SqliteDatabase): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The migration failure remains the public outcome.
  }
}

function migrateHealthSchema(
  database: SqliteDatabase,
): Outcome<void, HealthRepositoryFailure> {
  let transactionStarted = false;
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    database.exec(MIGRATIONS_TABLE_DDL);
    const existing = database
      .prepare("SELECT migration_key FROM schema_migrations WHERE migration_key = ?")
      .get(MIGRATION_KEY);
    if (existing === undefined) {
      database.exec(HEALTH_SCHEMA_DDL);
      database.prepare(
        "INSERT INTO schema_migrations(migration_key, applied_at) " +
          "VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
      ).run(MIGRATION_KEY);
    }
    database.exec("COMMIT");
    transactionStarted = false;
    return { ok: true, value: undefined };
  } catch {
    if (transactionStarted) rollbackBestEffort(database);
    return unavailable();
  }
}

declare const module: {
  exports: { migrateHealthSchema: typeof migrateHealthSchema };
};

module.exports = { migrateHealthSchema };
