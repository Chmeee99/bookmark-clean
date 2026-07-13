# ADR 0007: Persist the Jobs queue with atomic SQLite state transitions

Status: accepted for durable-processing implementation  
Date: 2026-07-13

## Context

The Jobs service now validates requests, creates canonical idempotency fingerprints, allocates IDs, reads the clock, calculates lease expiry and retry time, and emits module-owned `JobQueueStore` commands. The SQLite adapter must implement those commands atomically without taking ownership of retry meaning, handler results, clock policy, or diagnostic interpretation.

Node 26's built-in SQLite has already passed transaction, rollback, reopen, and cleanup probes. Catalog migration `001_catalog_snapshots` uses the shared `schema_migrations` table.

## Decision

Add migration key `002_jobs` using `DatabaseSync`. The caller owns database open/close and invokes migration before creating the store. The migration independently creates `schema_migrations` when Catalog has not run.

```sql
CREATE TABLE IF NOT EXISTS job_batches (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'cancelled')),
  total_count INTEGER NOT NULL CHECK (total_count > 0),
  created_at TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES job_batches(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type = 'health_check'),
  target_kind TEXT NOT NULL CHECK (target_kind = 'bookmark'),
  bookmark_id TEXT NOT NULL,
  input_version TEXT NOT NULL,
  priority INTEGER NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  not_before TEXT,
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'leased', 'succeeded', 'retry_wait', 'failed', 'cancelled')
  ),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  lease_token TEXT UNIQUE,
  worker_id TEXT,
  leased_at TEXT,
  lease_expires_at TEXT,
  retry_at TEXT,
  result_kind TEXT,
  result_id TEXT,
  failure_code TEXT,
  failure_disposition TEXT,
  failure_diagnostic TEXT,
  completed_at TEXT,
  UNIQUE (batch_id, sequence),
  CHECK (
    (state = 'leased' AND lease_token IS NOT NULL AND worker_id IS NOT NULL
      AND leased_at IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (state <> 'leased' AND lease_token IS NULL AND worker_id IS NULL
      AND leased_at IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (state = 'retry_wait' AND retry_at IS NOT NULL)
    OR (state <> 'retry_wait' AND retry_at IS NULL)
  ),
  CHECK (
    (state = 'succeeded' AND result_kind = 'health_observation'
      AND result_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (state <> 'succeeded' AND result_kind IS NULL AND result_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS jobs_batch_state
  ON jobs(batch_id, state);

CREATE INDEX IF NOT EXISTS jobs_lease_expiry
  ON jobs(state, lease_expires_at)
  WHERE state = 'leased';

CREATE INDEX IF NOT EXISTS jobs_eligibility
  ON jobs(state, type, priority DESC, sequence ASC, not_before, retry_at);
```

Migration runs under `BEGIN IMMEDIATE`, records `002_jobs` with SQLite UTC time only after all DDL succeeds, and is an exact no-op when the key exists. Engine failures roll back best-effort and return `storage_unavailable` without parsing exception text.

## Common transaction rules

- Every mutating store method uses `BEGIN IMMEDIATE`, one commit, and best-effort rollback on failure.
- Input shape checks use declared command fields only. Malformed commands return `invalid_request` before writes.
- Missing batches return `batch_not_found`. Unknown, expired, consumed, replaced, or attempt-mismatched leases return `stale_lease`.
- Expected engine failures return `storage_unavailable`; SQLite messages never control branching.
- Canonical UTC strings compare lexicographically because every accepted timestamp has the same fixed format.
- Rows contain typed references only. No page body, model prose, handler result body, or domain failure meaning is stored.

## `enqueueBatch`

1. Validate non-empty IDs/key/fingerprint, equal non-zero request/job-ID lengths, unique IDs, and request-to-ID array alignment.
2. Begin the transaction and query `job_batches` by `idempotency_key`.
3. If found with the same fingerprint, return its current `JobBatchSummary` and create nothing. If the fingerprint differs, roll back and return `idempotency_conflict`.
4. Ensure the new batch ID and all job IDs are unused. Insert one active batch and one pending job per request array position. Preserve future `not_before` unchanged.
5. Commit and return the new summary.

An ID collision not explained by the idempotency replay returns `invalid_request`; it is not retried or translated from an exception message.

## Expired-lease recovery

`leaseNext` and `readProgress` run recovery first in the same transaction. A lease is expired when `lease_expires_at <= now`.

- Cancelled batch: job becomes `cancelled`, lease fields clear, `completed_at = now`.
- Attempts exhausted: job becomes `failed`, lease fields clear, `failure_code = 'lease_expired'`, `failure_disposition = 'terminal'`, `completed_at = now`.
- Attempts remain in active or paused batch: job becomes `pending`; lease fields clear. Existing source `not_before` remains unchanged and no retry time is invented.

Recovery updates only rows still in `leased` with the observed token/attempt, so concurrent stale transitions cannot overwrite a newer lease.

## `leaseNext`

1. Validate non-empty worker/token, canonical `now < expiresAt`, and a deduplicated non-empty supported capability set.
2. Begin, recover expired leases, then select one eligible job joined to an active batch:
   - `pending` with `not_before IS NULL OR not_before <= now`; or
   - `retry_wait` with `retry_at <= now`;
   - type is in capabilities.
3. Order by priority descending, sequence ascending, batch creation ascending, then job ID ascending.
4. Compare-and-set the selected state to `leased`, increment attempt once, store token/worker/times, clear retry time, and require exactly one changed row.
5. Return the lease using the incremented attempt. No candidate returns success with null.

## `completeLease`

Within one transaction, select by token and require state `leased`, matching attempt, and `lease_expires_at > completedAt`. Set `succeeded`, store the typed result and completion time, and clear all lease fields. Batch state is intentionally ignored: already-started bounded work may succeed after cancellation. Any failed predicate returns `stale_lease` with no mutation.

## `failLease`

Select the same current unexpired lease predicates using `failedAt`.

- Cancelled batch: set `cancelled` and completion time.
- Terminal disposition: set `failed` and completion time.
- Retry disposition with `attempt < max_attempts`: require canonical `retryAt >= failedAt`, set `retry_wait`, and store retry time.
- Retry disposition at the attempt limit: set `failed` and completion time.

Every branch stores failure code, disposition, and optional diagnostic unchanged, clears lease fields, and changes exactly one row. The adapter never interprets failure strings.

## `setBatchState`

- Pause: active to paused; paused is idempotent; cancelled returns `invalid_transition`.
- Resume: paused to active; active is idempotent; cancelled returns `invalid_transition`.
- Cancel: active or paused to cancelled; cancelled is idempotent. In the same transaction, pending and retry-wait jobs become cancelled with `completed_at = changedAt`; leased and terminal jobs remain unchanged.

Missing batch returns `batch_not_found`. Unknown actions return `invalid_request`.

## `readProgress`

Begin, recover expired leases, then load the batch and grouped state counts. Return all six counts with missing states set to zero, and prove their sum equals `total_count`; otherwise return `storage_unavailable` as an invariant/storage failure.

`nextEligibleAt` is the earliest timestamp strictly after `now` among:

- future `not_before` for pending jobs in an active batch;
- future `retry_at` for retry-wait jobs in an active batch;
- unexpired lease expiry in any batch, because recovery may change progress.

Omit it when no future timestamp exists. Commit the recovery transaction before returning.

## Boundaries and consequences

The Jobs service remains the owner of request validation, fingerprint creation, ID allocation, clock reads, lease duration, and retry scheduling. SQLite owns durable state, ordering, and compare-and-set transitions only.

The current public contract has no separate stored-queue-corruption failure. Impossible row shapes or progress-count mismatches therefore return `storage_unavailable` as a storage invariant failure, never `invalid_request` and never a repaired value. Add a distinct code later only through a public-contract slice if operational evidence shows the distinction is useful.

Worker execution, handler idempotency storage, health observations, concurrency, polling, and UI projections remain outside this adapter.
