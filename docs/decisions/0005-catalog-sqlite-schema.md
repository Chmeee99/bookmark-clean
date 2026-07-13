# ADR 0005: Persist immutable Catalog snapshots in normalized SQLite tables

Status: accepted for first-import implementation  
Date: 2026-07-13

## Context

`CatalogSnapshotStore` must atomically save and exactly reload immutable snapshot trees. Node 26's built-in SQLite already passed transaction rollback, reopen, backup, and cleanup probes. The adapter must preserve hierarchy and sibling order without owning Catalog identity or interpreting SQL error prose.

## Decision

Use `node:sqlite` `DatabaseSync`, supplied by the composition caller. The adapter enables foreign keys and applies migration key `001_catalog_snapshots` idempotently.

The migration creates:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_snapshots (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('chrome_api', 'chrome_html')),
  captured_at TEXT NOT NULL,
  root_count INTEGER NOT NULL CHECK (root_count >= 0),
  folder_count INTEGER NOT NULL CHECK (folder_count >= 0),
  bookmark_count INTEGER NOT NULL CHECK (bookmark_count >= 0)
);

CREATE TABLE IF NOT EXISTS catalog_nodes (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  parent_id TEXT REFERENCES catalog_nodes(id),
  sibling_index INTEGER NOT NULL CHECK (sibling_index >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('folder', 'bookmark')),
  title TEXT NOT NULL,
  url TEXT,
  date_added TEXT,
  date_modified TEXT,
  date_last_used TEXT,
  UNIQUE (snapshot_id, source_id),
  CHECK (
    (kind = 'folder' AND url IS NULL AND date_last_used IS NULL) OR
    (kind = 'bookmark' AND url IS NOT NULL AND length(url) > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_root_order
  ON catalog_nodes(snapshot_id, sibling_index)
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_child_order
  ON catalog_nodes(snapshot_id, parent_id, sibling_index)
  WHERE parent_id IS NOT NULL;
```

The migration runs inside `BEGIN IMMEDIATE` and records its key only after all DDL succeeds. A present key is a no-op. The migration and store do not open or close the caller's database.

## Save algorithm

1. Start `BEGIN IMMEDIATE`.
2. Query `catalog_snapshots` by ID. If present, roll back and return `snapshot_exists`.
3. Insert the snapshot row.
4. Insert nodes depth-first pre-order. Roots use `parent_id = NULL`; children use the allocated parent bookmark ID. `sibling_index` is the zero-based array position. Optional source dates remain SQL `NULL` when absent.
5. Commit once.

Any expected SQLite failure other than the explicit existing-ID branch rolls back and returns `storage_unavailable` without parsing the exception message. A rollback attempt after an engine failure is best-effort. No diagnostic is required.

## Load algorithm

Query the snapshot row first. No row returns `{ ok: true, value: null }`. Query all nodes for the snapshot ordered by insertion-independent keys sufficient for deterministic assembly. Build an ID map, attach each node at its declared sibling index, and reject rather than repair:

- duplicate or missing positions;
- missing parents or parents from another snapshot;
- a bookmark used as a parent;
- invalid kind-specific nullable fields;
- non-canonical dates or unknown source values;
- duplicate IDs or source IDs;
- cycles, disconnected nodes, or count mismatches.

These stored-data shape failures return `stored_snapshot_invalid`. SQLite execution failures return `storage_unavailable`. Successful reconstruction returns fresh objects and arrays matching `BookmarkSnapshot` exactly.

## Boundaries

- SQL, rows, statements, and exception text remain private.
- The adapter does not normalize URLs, allocate IDs, validate source input, reconcile snapshots, retry, or log bookmark contents.
- Snapshot IDs and bookmark IDs are globally unique in this first implementation. Source IDs are unique only within a snapshot.
- FTS5, content, jobs, health, and model tables are outside this migration.

## Consequences

Normalized rows make hierarchy checks and future scoped queries straightforward. Reconstruction needs an explicit private validator, but corrupted storage cannot silently become Catalog truth. A generated 10,000-node benchmark will measure whether the recursive save and assembly strategy is adequate before optimization.
