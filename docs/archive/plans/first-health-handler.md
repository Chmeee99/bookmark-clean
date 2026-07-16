# First Health handler

Status: C1–C14 complete; increment closed
Created: 2026-07-14
Queue refresh: 2026-07-15 after C12 controlled HTTPS evidence

## Outcome

The Health checker, SQLite observation repository, safe target resolver, one-request Node transport, and Local Health worker session are implemented. The Health handler is registered privately in the one-step worker. Enqueue and a user-facing worker command remain outside this increment.

Completed slices:

- H1–H3 added Catalog bookmark lookup, the caller-sized checker contract, and the unregistered Jobs handler.
- C1–C3 added immutable observations plus validated, atomic SQLite read/write with exact replay and conflict behavior.
- C4 added the fixed `health_check_v1` execution ports: one request chain, five redirects, and no retry or delay ports.
- C5 added the pure typed HTTP and transport classifier. Body text, diagnostics, messages, and traces cannot select status.
- C6 activated `createHealthChecker`, including receiving-boundary validation, idempotent replay, bounded redirect walking, body fingerprinting, and commit-before-success.
- C7 recorded controlled Node evidence for timeout, DNS, connection, parser, TLS, redirect, Host, body-cap, and cleanup behavior.
- C8 added the socket-free request-target resolver. It validates every DNS answer, rejects unsafe or mixed sets, and pins one deterministic address.
- C9 added the Node HTTP/HTTPS transport. It performs one pinned GET, preserves Host and TLS identity, leaves redirects manual, bounds retained bytes, and maps only structured evidence.
- C10 added one opaque SQLite application session with real Catalog, Jobs, and Health persistence ports on a shared migrated connection.
- C11 added one zero-argument Node runtime bundle with a shared clock, cryptographic IDs, exact SHA-256 fingerprinting, and the private default-safe transport.
- C12 proved certificate-validated HTTPS through the unchanged production transport with a controlled CA, pinned loopback socket, and preserved Host and SNI identity.
- C13 promoted the existing queue and one-step worker factories through the exact Jobs public contract without changing service behavior.
- C14 composed the real public SQLite, Node, Catalog, Jobs, and Health seams into a Local CLI-owned session with one private Health handler.

Current verification: strict typecheck and all 174 tests pass. The Node transport tests use controlled loopback and require listener permission inside the Codex sandbox.

## Delivered evidence

- Production checker code committed an observation through the real SQLite repository, read it back, and replayed it without another ID or transport call.
- Production resolver and transport code exercised controlled local HTTP/TCP/TLS listeners. Tests proved exact selected headers, pinned Host, manual redirects, timeout, body-cap behavior, parser/connection/TLS mappings, and cleanup.
- No live DNS, public internet, model call, runtime handler registration, CLI execution path, or Chrome mutation was used or claimed.
- Successful HTTPS is proved only against the controlled `health.test` certificate fixture. No live DNS, public internet, or production trust override was used or claimed.
- The composed production worker opened a real empty SQLite queue, returned idle without retry work, closed idempotently, and reopened the database.

## Boundaries

- Jobs targets contain bookmark ID and input version only. Catalog owns URLs.
- Health owns observation assembly, classification, redirect walking, and conflict meaning.
- SQLite validates and persists typed records. It does not repair or classify them.
- The Node resolver owns URL admission, complete DNS-set validation, unsafe-range rejection, and address pinning.
- The Node transport owns one request through an approved target. It does not follow redirects, classify bodies, retry, or parse diagnostic prose.
- `health_check_v1` permits one queue attempt, one initial request, five redirects, and zero model calls.

## Current planning state

Brownfield plan: `docs/plans/active/first-health-handler.md` only. The 2026-07-15 module-map decision keeps the Local CLI as composition root. SQLite now exposes module-owned stores through one opaque session. The Node adapter will expose typed runtime ports, and Jobs will promote its existing factories. The handler array stays private. No generic container is planned.

This increment is closed. There is no active Slice Packet in this plan. Selected-folder enqueue needs its own architecture pass; a one-job CLI command can follow once enqueue exists or a controlled fixture seeds work.

## Rolling queue

No active slices. C14 closed the composition increment; the next capability begins with a fresh architecture and rolling-plan pass.

## Rough backlog

- Selected-folder durable enqueue: requires an architecture pass for Processing-to-Jobs request ownership and idempotency keys after C14.
- One-job CLI command: one `runOne`, stable JSON/exit codes, explicit worker identity, and an operational proof protocol. No loop.
- Health history and versioned staleness: add history only with the policy contract that consumes it.
- Rendered browsing, page classification, model calls, deletion, Chrome writes, and continuous workers stay deferred.

## Sequencing risks

- C11 and C13 remained separate public contract slices.
- C12 passed without widening the production API.
- C14 accepts only the single-attempt Health profile. A multi-attempt profile needs an explicit retry-policy decision.
- Refresh before enqueue work; Processing currently returns counts, not bookmark job inputs.

## Next executable Slice Packet

None. The C1–C14 increment is complete. Start the next capability with a fresh architecture review and rolling Slice Packet.
