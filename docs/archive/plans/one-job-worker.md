# One-job Health worker

Status: complete on 2026-07-15.

## Outcome

The Local CLI can run at most one eligible `health_check_v1` job, report a
small typed result, and close. Jobs retains lease and transition behavior.
Health retains URL-checking and observation meaning. The Node adapter retains
request safety and timeout behavior.

The package command is:

```sh
npm run --silent worker:once -- --database <bookmarks.sqlite>
```

Completed steps return `idle`, `succeeded`, or `failure_reported` on stdout and
exit `0`. Command failures use the fixed stderr codes and exits documented in
`docs/architecture/module-map.md`.

## Fixed operating profile

- Worker ID: `worker:local-once`.
- Per-hop transport deadline: 10,000 ms across resolution and socket exchange.
- Redirect limit: five.
- Body cap: 65,536 bytes.
- Lease duration: 300,000 ms.
- Queue attempts: one, with the failure time returned unchanged by the retry schedule.

## Delivered slices

- F1: one deadline covers target resolution and socket exchange; late resolution cannot start a request.
- F2: exact type-only Local CLI result and command contract.
- F3: direct command validation, fixed profile, one-step execution, redacted projection, and guaranteed session closure.
- F4: real SQLite proof from one imported and enqueued bookmark to a succeeded job, reopened progress, and idle replay.
- F5: package routing, operator documentation, subprocess acceptance, regression coverage, and test enrollment.

## Verification

- Strict typecheck passes.
- The full repository script passes all 194 tests.
- Existing import, inspect, preview, and enqueue subprocess behavior remains green.
- The documented package path completes one queued job and returns idle on replay.
- Controlled loopback proofs receive zero requests under default production safety.
- The completed-slice audit found no contract, ownership, test, or documentation drift.

## Deferred work

These remain separate workstreams:

- Batch progress output through the existing Jobs progress contract.
- A repeated worker loop after stop, backoff, concurrency, and shutdown policy are explicit.
- Public-network acceptance with an approved target and evidence protocol.
- Completed-plan directory cleanup as documentation maintenance.
