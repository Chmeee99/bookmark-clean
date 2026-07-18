# ADR 0010: Distinguish invalid stored Jobs state

Status: accepted
Date: 2026-07-16

## Context

The SQLite Jobs adapter validates stored rows before returning public queue
values. Until now, malformed rows, count mismatches, closed databases, and engine
failures all returned `storage_unavailable`.

That collapse is operationally misleading. Retrying can resolve transient
storage availability but cannot repair a corrupt queue. Workers and future UI
consumers need a closed, author-owned distinction without reading SQLite
messages or exception prose.

## Decision

Add `stored_queue_invalid` to `JobQueueFailureCode`.

The SQLite adapter returns it only when adapter-owned structured validation
rejects stored queue state: malformed rows, invalid state projections, unsafe
stored counts or attempts, or contradictions between batch totals and job rows.
Caller command validation remains `invalid_request`. Compare-and-set anomalies,
SQLite errors, transaction failures, and closed database handles remain
`storage_unavailable`.

Adapter code carries this meaning through one private typed integrity signal.
Catch blocks may branch on that signal's type, never on its message, stack, or
SQLite diagnostic.

## Consequences

The public change is additive and lands before any producer. Existing workers
continue to wrap exact queue failures, and current CLIs may retain their redacted
top-level unavailable result. Future operator surfaces can present corruption as
a repair/restore action rather than a retry action.
