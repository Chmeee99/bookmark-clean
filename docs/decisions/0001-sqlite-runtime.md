# ADR 0001: Use Node's built-in SQLite for the first persistence path

Status: accepted for the current foundation horizon
Date: 2026-07-13

## Context

The first release needs SQLite persistence, SQLite FTS5 lexical search, transaction rollback, embedding-vector BLOB storage, and database backup. The product and module map require these capabilities. Persistence contract and schema work waits until the runtime is proven. The repository has no `@types/node` dependency, so the capability spike uses only local declarations for the small built-in API surface it exercises.

## Decision

Continue with Node 26's built-in `node:sqlite` API for the foundation and first import work. Do not add `better-sqlite3`, a vector extension, or another database dependency based on this spike.

This records runtime feasibility. The future SQLite adapter will hide `DatabaseSync`, statement operations, temporary paths, BLOB encoding, and backup details behind the `DatabaseRuntime` boundary in the module map.

## Evidence

Runtime observed on 2026-07-13:

- Node.js: `v26.4.0`.
- npm: `11.17.0`.
- SQLite reported by `SELECT sqlite_version()`: `3.53.3`.
- `node:sqlite` exports `DatabaseSync` and a top-level asynchronous `backup(source, destination)` function. Backup is not a `DatabaseSync` instance method in this runtime.

The spike exercised:

- `DatabaseSync` file-backed databases, `exec`, `prepare`, `StatementSync.run`, `all`, and `get`.
- An FTS5 virtual table with insert and `MATCH` query behavior.
- An explicit `BEGIN TRANSACTION`, insert, and `ROLLBACK`, with a zero-row assertion afterward.
- A known `Float32Array` serialized as a `Uint8Array` BLOB and reconstructed within `1e-6` per element.
- Top-level `backup`, a destination handle, close of both handles, and a fresh reopen/query of the copied database.
- Temporary directories created below the operating-system temp directory and removed after both successful and rejected callbacks.

## Commands and results

| Command | Result |
| --- | --- |
| `node --version` | `v26.4.0` |
| `npm --version` | `11.17.0` |
| `node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); console.log(db.prepare('select sqlite_version() AS version').get()); db.close();"` | SQLite `3.53.3` |
| `node --test tests/spikes/sqlite-capabilities.test.ts` | Pass: all five capability/cleanup tests |
| `npm test` | Pass: smoke test plus all five capability/cleanup tests |
| `npm run typecheck` | Pass: strict no-emit TypeScript check |
| `git diff --check` | Pass: no whitespace errors |

## Unsupported behavior

No required capability was unsupported on this runtime. If a future supported runtime fails one of the spike assertions, the failure is evidence to return to planner-grade dependency selection; this slice adds no fallback implementation.

## Consequences

The next persistence slices may design the SQLite adapter and its migrations against this proven runtime. They still need schema, migration, backup, and performance tests. This spike makes no claim about production throughput, 10,000-node import cost, search ranking, or long-term SQLite compatibility across Node versions.
