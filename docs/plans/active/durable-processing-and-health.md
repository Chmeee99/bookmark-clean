# Durable processing and health rolling plan

Status: active  
Created: 2026-07-13  
Refresh: after Slice 26 or sooner when executable evidence changes the queue

## Short overview

This horizon builds a durable resumable Jobs capability before adding deterministic URL-health processing. Queue semantics are defined once so health, extraction, enrichment, and embedding workers share pause, retry, cancellation, lease recovery, and progress behavior.

## Current planning state

- Brownfield: Slices 1–17 provide strict Chrome HTML import, Catalog service, crypto IDs, normalized SQLite persistence, and a verified 10,000-node reopen path.
- Selected plan: `docs/plans/active/durable-processing-and-health.md`.
- Scope lock: shared Jobs identifiers, executable Jobs contracts, queue service, SQLite design and store, crash/resume harness, then health fixtures and contracts.
- Architecture source: `docs/architecture/module-map.md`, completed Jobs capability brief and state machine.
- Verification baseline: 66 tests, strict TypeScript no-emit check, dependency inspection, ledger validation, and whitespace checks.
- Major uncertainties: SQLite compare-and-set details, retry schedule parameters, health SSRF policy, and real network error mapping. These remain behind their own planner or fixture gates.

## Rolling queue

### Slice 18: Complete the durable Jobs architecture contract — completed 2026-07-13

Goal: define shared identifiers, public queue/store ports, validation, idempotency, state transitions, lease recovery, retry, batch controls, progress, and migration order.

Evidence: PRD processing workflow; prior SQLite transaction/reopen proof; placeholder Jobs section in the module map.

Behavior change: architecture consumers can proceed without inventing policy. No executable code changed.

Boundary: Jobs owns scheduling; handlers own durable domain results; SQLite owns compare-and-set mechanics only.

Invariants: current tokens only; no prose-driven retry; pause does not revoke; cancellation preserves successful bounded work; terminal states never transition.

Verification: module-map contract review, existing tests/typecheck, ledger validation, and diff checks.

Non-goals: runtime types, SQL, workers, health, or UI.

Complexity/tier: M, planner-grade.

### Slice 19: Implement shared Jobs identifiers — completed 2026-07-13

Goal: add `JobBatchId`, `WorkerId`, `JobLeaseToken`, and `JobResultId` to the shared type-only contract.

Evidence: module-map shared primitives and Jobs signatures.

Behavior change: later Jobs types compile against distinct branded identities.

Files likely: `core/contracts/public.ts`, `tests/contract/shared-types.typecheck.ts`.

Files excluded: Jobs module, runtime behavior, package files, adapters, docs except ledgers/plan.

Boundary: shared identity only; no Jobs semantics.

Invariants/tests: exact brands, cross-brand assignment failures, string compatibility, zero runtime exports, red/green typecheck, full tests.

Telemetry: focused typecheck and export-surface evidence.

Risks: accidentally combining Jobs public types; stop before doing so.

Non-goals: ID generation, queue types, SQL.

Acceptance: exact parity with module map and no runtime export.

Complexity/tier/dependency: XS, planner-grade because public contract code changes; depends on Slice 18.

### Slice 20: Implement executable Jobs public types — completed 2026-07-13

Goal: create type-only `modules/jobs/public.ts` matching the complete Jobs contract and store port.

Evidence: Slice 18 module map and Slice 19 shared IDs.

Behavior change: queue service and SQLite adapter can compile independently against one contract.

Files likely: `modules/jobs/public.ts`, `tests/contract/jobs-types.typecheck.ts`, `tests/contract/jobs.contract.test.ts`, `package.json`.

Files excluded: runtime queue, SQL, other modules, dependencies.

Boundary: executable public contract only.

Invariants/tests: exact unions/methods/commands, no parser or SQL types, zero runtime exports, exact negative type cases.

Telemetry: type parity and full verification.

Risks: contract drift during transcription; compare every public name and signature.

Non-goals: validation, fingerprinting, scheduling, persistence.

Acceptance: complete exact type surface under 300 cohesive lines; all tests green.

Complexity/tier/dependency: M, planner-grade; depends on Slice 19.

### Slice 21: Implement the Jobs service against a fake store — completed 2026-07-13

Goal: implement validation, canonical request fingerprints, ID/clock/config coordination, retry-time calculation, and delegation to atomic store commands.

Evidence: executable Slice 20 contract and Jobs capability brief.

Behavior change: `JobQueue` behavior is proven without SQL.

Files likely: `modules/jobs/job-queue-service.ts`, `tests/integration/job-queue-service.test.ts`, `package.json`.

Files excluded: public types, SQLite, handlers, health.

Boundary: Jobs policy; fake store records atomic commands but does not emulate SQL.

Invariants/tests: reject invalid requests before dependencies; deterministic canonical fingerprint; exact IDs/order; lease expiry calculation; retry schedule uses returned attempt; outcomes unchanged; diagnostics ignored.

Telemetry: fake dependency call trace with fixed identifiers only.

Risks: fingerprint ambiguity; packet must fix canonical field order before delegation.

Non-goals: state persistence or worker execution.

Acceptance: focused fake-port tests and all verification pass with no public change.

Complexity/tier/dependency: M, standard Luna max after polish; depends on Slice 20.

### Slice 22: Define the SQLite Jobs schema and atomic algorithms — completed 2026-07-13

Goal: record exact tables, indexes, migrations, atomic enqueue/lease/reclaim/transition/progress queries, and failure mappings in an ADR.

Evidence: Jobs store commands and proven Node SQLite transactions.

Behavior change: no runtime behavior; executor SQL judgment is removed.

Files likely: `docs/decisions/0007-jobs-sqlite-schema.md`.

Files excluded: code, tests, dependencies, other schemas.

Boundary: SQLite mechanics implement Jobs-owned commands.

Invariants/tests: CAS current token and attempt, deterministic lease order, atomic expiry recovery, idempotent enqueue and controls, no error-message parsing.

Telemetry: DDL/query review and existing verification.

Risks: race behavior and nullable timestamps; settle explicitly.

Non-goals: service or worker code.

Acceptance: every store method maps to one documented transaction.

Complexity/tier/dependency: M, planner-grade; depends on Slice 21 evidence.

### Slice 23: Implement Jobs migration and idempotent enqueue — completed 2026-07-13

Goal: implement ADR 0007 migration plus the `enqueueBatch` transaction as private SQLite functions.

Evidence: ADR 0007, `StoredEnqueueCommand`, and Slice 21 canonical command tests.

Behavior change: job batches persist atomically and identical enqueue requests replay without duplication.

Files likely: `adapters/sqlite/jobs-schema.ts`, `adapters/sqlite/jobs-enqueue.ts`, one focused integration test, package script.

Files excluded: public contracts, Jobs service, lease/transition/progress implementations, health, dependencies.

Boundary: SQLite validates port-command structure and owns DDL/transactions only.

Invariants/tests: fresh/repeated migration, Catalog-independent migration, new batch rows, future not-before persistence, replay returns current summary, fingerprint conflict, ID collision, rollback, reopen.

Red/green: missing private migration/enqueue functions fail first; exact SQL behavior passes afterward.

Telemetry: fixed IDs and row counts only.

Risks: migration must coexist with Catalog's shared migration table; tests cover both orders.

Non-goals: leasing, controls, facade, worker, network.

Acceptance: ADR DDL and enqueue transaction pass with no public/dependency change.

Complexity/tier/dependency: M, standard Luna max after polish; depends on Slice 22.

### Slice 24: Implement expired-lease recovery and leasing — completed 2026-07-13

Goal: implement private atomic recovery plus `leaseNext` selection/CAS using migrated Jobs tables.

Evidence: ADR 0007 ordering and expiry rules; Slice 23 schema.

Behavior change: eligible work leases deterministically and crashed leases recover by batch/attempt state.

Files likely: `adapters/sqlite/jobs-lease.ts`, optional private recovery helper, one integration test, package script.

Files excluded: public contracts/service, controls/progress/facade, health.

Boundary: SQLite mechanics only; no clock or retry policy calculation.

Invariants/tests: capability filtering, priority/sequence/batch/ID order, future not-before, retry eligibility, attempt increment, no candidate, active/paused/cancelled expiry recovery, attempt exhaustion, rollback.

Red/green: missing private lease function fails; exact transactional rows and returned lease pass.

Telemetry: fixed state traces.

Risks: recovery and selection must share one transaction.

Non-goals: completion/failure, progress, worker.

Acceptance: every recovery branch and deterministic order are covered.

Complexity/tier/dependency: M, standard Luna max; depends on Slice 23.

### Slice 25: Implement lease transitions and batch controls — completed 2026-07-13

Goal: implement private complete/fail and pause/resume/cancel transactions.

Evidence: ADR 0007 and working lease rows from Slice 24.

Behavior change: current leases transition once; stale tokens cannot mutate; controls are idempotent under fixed rules.

Files likely: `adapters/sqlite/jobs-transitions.ts`, one integration test, package script.

Files excluded: public/service contracts, migration/enqueue/lease behavior, progress/facade, health.

Boundary: store executes typed disposition and timestamps without interpreting strings.

Invariants/tests: token/attempt CAS, cancelled-batch success, retry/terminal/attempt-limit/cancel branches, stale token/expiry, pause/resume/cancel idempotency and invalid transitions, leased preservation, rollback.

Red/green: missing functions fail first; exact state rows pass.

Telemetry: states and fixed opaque evidence only.

Risks: clearing lease fields must satisfy DDL checks in every branch.

Non-goals: progress, facade, worker, health.

Acceptance: all legal and illegal transitions match architecture and ADR.

Complexity/tier/dependency: M, standard Luna max; depends on Slice 24.

### Slice 26: Implement progress and the Jobs store facade — completed 2026-07-13

Goal: add progress-with-recovery and compose private SQLite functions behind `JobQueueStore`.

Evidence: Slices 23–25 and public store interface.

Behavior change: the Jobs service can use one durable store that survives close/reopen.

Files likely: `adapters/sqlite/jobs-progress.ts`, `adapters/sqlite/job-queue-store.ts`, one full integration/reopen test, package script.

Files excluded: public contracts, Jobs policy, worker, health, dependencies.

Boundary: facade delegates; progress counts and invariant checks remain storage mechanics.

Invariants/tests: recovery before counts, six-state sum, next eligible time, missing batch, closed DB, method mapping, complete queue path after reopen.

Red/green: absent progress/facade fails; full service-store composition passes.

Telemetry: batch counts and fixed times.

Risks: no corruption code; invariant failure remains `storage_unavailable` per ADR.

Non-goals: polling or handlers.

Acceptance: complete `JobQueueStore` implementation and full verification pass.

Complexity/tier/dependency: M, standard Luna max; depends on Slice 25.

### Slice 27: Define worker execution and durable-result ownership — completed 2026-07-13

Goal: add the one-step worker, handler-plugin, interruption, and result-before-success contract to the Jobs module map before runtime code.

Evidence: complete queue/store, PRD acceptance criterion 2, and the missing handler/result boundary found at the Slice 26 refresh.

Behavior change: none at runtime; worker ownership and failure semantics are closed.

Files: `docs/architecture/module-map.md`, active plan, and ops records only.

Boundary: worker routes typed queue/handler outcomes; handlers own durable idempotent domain results; composition owns repetition and stopping.

Invariants: one lease plus at most one report per step, no compensating mutation after interruption, strict handler output, no exception-text interpretation.

Acceptance: executable type and worker slices can proceed without inventing stop, retry, or result-repository policy.

Complexity/tier/dependency: M, planner-grade; depends on Slice 26.

### Slice 28: Implement executable worker and handler types — completed 2026-07-13

Goal: migrate the exact architecture-owned worker types into the type-only Jobs contract.

Evidence: completed Slice 27 module-map contract.

Behavior change: worker consumers can compile against closed handler, step, configuration, and failure unions.

Files likely: `modules/jobs/public.ts`, Jobs contract/typecheck tests, package script only if needed.

Files excluded: runtime worker, queue service/store, SQL, handlers, health.

Boundary: exact type migration only; no runtime exports.

Invariants/tests: parity with module map, discriminated failures, strict operation/status unions, negative assignments, zero runtime surface.

Acceptance: exact executable type surface and all tests green with no runtime behavior.

Complexity/tier/dependency: S, planner-grade public-contract slice; depends on Slice 27.

### Slice 29: Implement the one-step worker against fakes — completed 2026-07-13

Goal: implement `createJobWorker` and `runOne` over fake queues and handlers.

Evidence: Slice 28 executable types and module-map worker rules.

Behavior change: one bounded worker step leases, routes, and reports typed success/failure safely.

Files likely: worker service/validation modules, focused fake helpers and tests, package script.

Files excluded: SQL, real handlers/results, polling, health, public changes.

Boundary: worker validates/routes contracts; it never owns domain result persistence or retry meaning.

Invariants/tests: registry validation, idle, success, reported failure, queue typed failures/rejections by operation, handler interruption/malformed output, no second mutation.

Acceptance: every worker branch is deterministic against fakes and interruption leaves the lease unreported.

Complexity/tier/dependency: M, standard Luna max; depends on Slice 28.

### Slice 30: Prove interruption and resume after reopen — completed 2026-07-13

Goal: demonstrate result-before-success, lease expiry, database reopen, and idempotent retry with the real Jobs service/store and a fake durable domain repository.

Evidence: complete one-step worker and PRD acceptance criterion 2.

Behavior change: crash recovery and resume are proven end to end without duplicate domain results.

Files likely: fake idempotent result repository/handler, deterministic integration harness, package script.

Files excluded: public contracts, production SQL changes, UI, network, Health implementation.

Boundary: fake handler owns stable target/input-version idempotency; worker and queue only coordinate references.

Invariants/tests: first handler commit then interruption, untouched lease, close/reopen, fake-clock expiry, attempt increment, same result reference, one durable result, final succeeded progress, stale old completion rejected.

Acceptance: deterministic restart trace passes after database reopen and records learning evidence.

Complexity/tier/dependency: M, standard Luna max; depends on Slice 29.

### Slice 31: Characterize deterministic health inputs — completed 2026-07-13

Goal: create a loopback fixture server for healthy, redirect, missing, access, timeout, server-error, and malformed response evidence.

Evidence: PRD statuses and completed worker harness.

Behavior change: repeatable local HTTP facts exist; no Health meaning is implemented.

Files likely: fixture server, discovery test, ADR.

Files excluded: Health public types, production fetcher, Jobs contracts.

Boundary: external-adapter evidence only; no staleness inference.

Invariants/tests: loopback only, deterministic routes, bounded timeout, cleanup, no external network.

Telemetry: transport facts without content logs.

Risks: Node fetch error shapes vary; capture rather than normalize.

Non-goals: SSRF or health policy.

Acceptance: every required scenario is deterministic and documented.

Complexity/tier/dependency: M, standard Luna max; follows Slice 30.

### Slice 32: Complete Health architecture contract — completed 2026-07-13

Goal: use fixture evidence to define Health observations, fetch/clock/repository ports, and separate staleness policy, then split executable migration as required.

Evidence: Slice 31 transport facts and PRD health rules.

Behavior change: Health implementation receives a closed evidence contract and SSRF boundary.

Files: architecture and plan only.

Files excluded: production fetcher, Jobs changes, UI.

Boundary: Health owns classification; fetch adapter owns transport facts; models cannot replace observations.

Invariants/tests: distinct access/transient/dead outcomes, no one-failure staleness, fixed evidence IDs/reasons, no diagnostic parsing.

Telemetry: contract parity and fixture coverage.

Risks: must split architecture and executable types.

Non-goals: live internet or model classification.

Acceptance: executable Health contract migration can proceed without inventing status or safety policy.

Complexity/tier/dependency: L planner-grade; depends on Slice 31.

### Slice 33: Implement executable Health contract types — completed 2026-07-13

Goal: migrate the approved Health contract into type-only code and exact contract tests.

Evidence: Slice 32 architecture contract and deterministic fixture observations.

Boundary: type migration only; no fetch or staleness implementation.

Acceptance: exact parity and zero runtime exports.

Complexity/tier/dependency: S, planner-grade public-contract slice; depends on Slice 32.

### Slice 34: Implement pure Health fact classification — completed 2026-07-13

Goal: validate typed transport facts and build deterministic observation fields without I/O.

Evidence: Slice 33 types and fixed mapping rules in the module map.

Boundary: pure Health-owned classification only; no fetch repository retry or staleness.

Acceptance: every HTTP transport redirect and error mapping has exact unit tests.

Complexity/tier/dependency: M, standard Luna max; depends on Slice 33.

### Slice 35: Separate Health checking from staleness ownership — completed 2026-07-13

Goal: correct the Health contract so observation execution and history policy can migrate independently.

Boundary: architecture only; `HealthService` composes `HealthChecker` and `StalenessPolicy`.

Acceptance: checker runtime no longer requires a stub future policy.

Complexity/tier/dependency: S planner-grade; follows Slice 34 gate evidence.

### Slice 36: Implement executable Health ownership split — completed 2026-07-13

Goal: add exact `HealthChecker` and `StalenessPolicy` interfaces and make `HealthService` extend both.

Boundary: type-only public correction; no runtime behavior.

Acceptance: exact parity and existing Health fixtures remain green.

Complexity/tier/dependency: XS planner-grade public-contract slice; depends on Slice 35.

### Slice 37: Implement bounded Health check execution against fakes

Goal: compose manual redirects, bounded typed retries, delay, and terminal classification over fake transport without persistence or observation identity.

Boundary: private execution mechanics only; no clock ID hashing repository or staleness.

Acceptance: every redirect retry limit expected-failure and interrupted-dependency branch returns exact execution evidence or Health failure.

Complexity/tier/dependency: M, standard Luna max; depends on Slice 36.

### Slice 38: Implement idempotent Health checker against fakes

Goal: wrap the execution module with load-before-work, completion clock/ID, body fingerprinting, and save-if-absent observation persistence.

Boundary: checker orchestrates declared ports; transport safety and SQL remain outside.

Acceptance: success and every dependency failure preserve fixed disposition and idempotency rules.

Complexity/tier/dependency: M, standard Luna max; depends on Slice 37.

### Slice 39: Design safe Node transport and typed cause fixtures

Goal: prove structured DNS/TLS/socket cause mappings and choose an address-pinning implementation before production network code.

Boundary: planner-grade security/adapter design; no live internet or message parsing.

Acceptance: safe-request implementation packet has typed evidence for every supported cause and redirect target check.

Complexity/tier/dependency: L planner-grade discovery/design; depends on Slice 38.

### Slice 40: Implement SQLite Health observation repository

Goal: persist immutable observations and atomic input-version idempotency behind the Health-owned repository port.

Boundary: SQL mechanics only; no classification or staleness.

Acceptance: save/load/list conflict rollback and reopen tests pass.

Complexity/tier/dependency: M, standard Luna max; depends on Slice 38.

### Slice 41: Implement the Health job handler

Goal: connect `health_check` leases to the Health service and return committed observation references or exact typed failures.

Boundary: handler maps declared request input and Health failures only; no retry inference or prose parsing.

Acceptance: worker plus Health service/store completes an idempotent health job.

Complexity/tier/dependency: M, standard Luna max; depends on Slices 38 and 40.

### Slice 42: Fix and implement staleness policy thresholds

Goal: select versioned repetition/spacing thresholds and implement the pure assessment rules over observation history.

Boundary: planner fixes product thresholds before executor code; no deletion or review mutation.

Acceptance: one transient failure never reaches review and every assessment cites exact observation IDs/reasons.

Complexity/tier/dependency: M split planner then Luna; depends on stored observation evidence.

## Rough backlog notes

- Health architecture and executable contracts follow fixture evidence; SSRF/local-network policy is the planner gate.
- Health fetch implementation then runs through `health_check` jobs and stores observations separately from staleness policy.
- Extraction, LM Studio enrichment/evaluation, embeddings, retrieval, and UI remain later horizons; model risk RISK-001 stays open.
- A sanitized real Chrome export is still required before broad HTML compatibility claims.

## Sequencing risks

- Shared IDs and Jobs public types are separate public-contract slices.
- The Jobs service precedes SQLite so policy is testable without SQL.
- SQLite schema follows service command evidence and cannot reinterpret diagnostics.
- Crash recovery precedes network work; otherwise HTTP handlers would become the accidental queue test harness.
- Health observations and staleness policy remain separate contracts.

## Refresh trigger

Refresh after Slice 38, when the fake-port Health checker provides executable evidence, or sooner if the contract proves insufficient.

## Completed Slice Packet: Slice 19

Slice Packet: Implement shared Jobs identifiers

Goal:
Add the four opaque Jobs identities approved in the module map to the shared type-only contract, with exact negative type tests, before any Jobs module type is created.

Behavior change:
`JobBatchId`, `WorkerId`, `JobLeaseToken`, and `JobResultId` become distinct compile-time identities and remain erased at runtime.

Source evidence:
- Shared contract section and Jobs signatures in `docs/architecture/module-map.md`.
- Existing `JobId` brand and shared type-parity tests.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md`.
- This active plan.

Project constraints activated:
- Public contract changes are isolated planner-grade slices.
- Shared primitives contain identity only, not Jobs behavior.
- Red/green type tests precede production types.

Files likely to touch:
- `core/contracts/public.ts`
- `tests/contract/shared-types.typecheck.ts`
- `docs/ops/*.csv`
- this plan

Files likely not to touch:
- `modules/jobs/**`, runtime code, package files, adapters, dependencies, fixtures, PRD, or module map

Contract/boundary affected:
- Additive shared opaque identity contract used by the future Jobs public module.

Owning module:
- Core shared contracts own identity brands only; Jobs owns their meaning and use.

Executor tier:
- planner-grade — additive public contract code and exact brand isolation.

Ownership and domain-rule analysis:
- Ownership boundary involved: shared primitives versus Jobs semantics.
- Structured source of truth: module-map shared type declarations.
- Local behavior allowed: exact type aliases and compile-time parity cases.
- Local behavior forbidden: constructors, generators, validators, queue methods, or runtime exports.

Invariants:
- Every new type is a string intersection with its exact readonly brand.
- Plain strings and every other identity brand are not assignable.
- Branded values remain assignable to string.
- `Outcome` and all existing types remain unchanged.

Tests:
- Red: extend `shared-types.typecheck.ts` first; typecheck fails because exports are absent.
- Green: exact shapes compile, plain strings and cross-brand assignments remain expected errors.
- Runtime shared-contract test still reports zero exports.
- Run focused typecheck, full tests, file-size/export checks, ledger validation, and `git diff --check`.

Red/green expectation:
- Old behavior fails because four approved exports do not exist.
- New behavior passes because exact additive brands exist with no runtime surface.

Telemetry/evidence:
- Record red and green typecheck commands, full test count, and export-surface result.

Non-goals:
- Jobs module types, ID generation, validation, service logic, SQL, or package changes.

Acceptance criteria:
- All four aliases exactly match the module map.
- Negative cross-brand tests cover each new identity and at least one existing identity.
- Public module still exports zero runtime values.
- Existing tests/typecheck and diff checks pass.

Risks:
- Combining this with Slice 20 would violate the public-contract migration sequence.

Estimated complexity:
XS

Dependencies:
- Slice 18 architecture contract.

## Completed Slice Packet: Slice 20

Slice Packet: Implement executable Jobs public types

Goal:
Create the type-only Jobs public entry point with exact parity to the accepted module-map state machine and atomic store ports.

Behavior change:
Jobs service and SQLite implementations can compile independently against complete queue, lease, batch, progress, configuration, dependency, and store-command types.

Source evidence:
- Jobs public contract and capability brief in `docs/architecture/module-map.md`.
- Shared identity exports completed in Slice 19.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md`.
- This active plan.

Project constraints activated:
- Public contract code is planner-grade and isolated from behavior.
- Jobs owns scheduling semantics and store ports; SQL and handlers stay outside.
- Public module must expose no runtime values.

Files likely to touch:
- `modules/jobs/public.ts`
- `tests/contract/jobs-types.typecheck.ts`
- `tests/contract/jobs.contract.test.ts`
- `package.json`
- `docs/ops/*.csv`
- this plan

Files likely not to touch:
- Runtime Jobs service, SQLite, other modules, dependencies/lockfile, fixtures, PRD, or module map

Contract/boundary affected:
- New executable Jobs public contract exactly matching the architecture artifact.

Owning module:
- Jobs owns all exported queue behavior and persistence-port shapes.

Executor tier:
- planner-grade — new ownership-sensitive public contract code.

Ownership and domain-rule analysis:
- Structured source of truth: module-map Jobs code block and rules.
- Local behavior allowed: exact type/interface transcription and negative compile tests.
- Local behavior forbidden: validation, canonicalization, scheduling, SQL, error parsing, or runtime factories.

Invariants:
- Every architecture type and method exists exactly once.
- Fixed unions remain closed and diagnostics remain optional non-semantic strings.
- Store command types carry only declared structured fields.
- No SQL, fetch, model, Chrome, timer implementation, or page content type crosses the boundary.

Tests:
- Red first: type-parity and zero-runtime tests fail because `modules/jobs/public.ts` is absent.
- Assert every union and every `JobQueue`, dependency, config, and `JobQueueStore` method signature exactly.
- Assert bookmark-only target and health-only result references; reject raw page data and unknown job types.
- Runtime test proves zero exports.
- Run focused runtime test, strict typecheck, full tests, export/file-size checks, ledger validation, and diff check.

Red/green expectation:
- Old behavior fails because no Jobs executable contract exists.
- New behavior passes because the type-only surface exactly matches the module map.

Telemetry/evidence:
- Record red and green checks, type export list, full test count, and runtime-surface result.

Non-goals:
- Jobs service, ID generation, validation, fingerprinting, retry calculation, SQL, worker, or health implementation.

Acceptance criteria:
- Exact public names and signatures match the module map.
- Public module exposes zero runtime values.
- Type tests cover all methods and fixed unions plus forbidden raw payloads.
- Production contract remains cohesive and preferably below 300 lines.
- All verification passes without dependency changes.

Risks:
- A transcription convenience could weaken a closed union or omit a store CAS field; compare line by line before acceptance.

Estimated complexity:
M

Dependencies:
- Slice 19.

## Completed Slice Packet: Slice 21

Slice Packet: Implement the Jobs service against a fake store

Goal:
Implement `JobQueue` policy over the fixed clock, retry schedule, ID factory, configuration, and atomic store port without SQL or worker execution.

Behavior change:
Validated requests become deterministic store commands; lease, completion, failure, batch controls, and progress delegate with exact clock and retry semantics.

Source evidence:
- `modules/jobs/public.ts`.
- Jobs validation, idempotency, service/store, and transition rules in `docs/architecture/module-map.md`.
- Batch audit for Slices 18–20 requiring exact canonicalization and dependency ordering.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md`.
- This active plan.

Project constraints activated:
- Implement fixed contracts only; no public changes.
- Jobs policy remains independent of SQL and handlers.
- Diagnostics and failure codes are stored evidence, never parsed for retry meaning.
- Red/green TDD and cohesive files under size guidance.

Files allowed to touch:
- `modules/jobs/job-queue-service.ts`
- At most one private validation/fingerprint helper under `modules/jobs/`
- `tests/integration/job-queue-service.test.ts`
- `package.json`

Files forbidden to touch:
- `modules/jobs/public.ts`, shared contracts, SQLite, other modules, dependencies/lockfile, fixtures, docs, and ops ledgers

Exact factory and validation:
- Export private `createJobQueue({ clock, retrySchedule, idFactory, store, config }): JobQueue` for tests.
- Caller supplies valid positive safe-integer `leaseDurationMs`; no alternate configuration or fallback exists.
- Strictly validate request and nested object keys. Batch key and target input version are non-empty; jobs non-empty; type/kind are fixed; priority is a safe integer; sequence is unique non-negative safe integer; attempts are positive safe integer; optional dates are canonical UTC. Empty jobs returns `empty_batch`; all other shape failures return `invalid_request` before any dependency call.
- Canonical fingerprint is `JSON.stringify` of a newly built object with fields in this order: `idempotencyKey`, then `jobs`; each job uses `type`, `target` (`kind`, `bookmarkId`, `inputVersion`), `priority`, `sequence`, `maxAttempts`, and optional `notBefore`. Unknown fields are rejected, not fingerprinted.

Exact dependency order and commands:
- Enqueue: validate and fingerprint; read clock once and validate it; allocate batch ID then one job ID per request order; validate all emitted IDs are non-empty and unique; call `store.enqueueBatch` once and return its outcome unchanged.
- Lease: require a non-empty worker ID; deduplicate and lexically sort capabilities; reject unknown capabilities; empty capabilities returns success-null with zero dependencies. Read/validate clock once, add `leaseDurationMs` safely, allocate/validate one token, call `store.leaseNext` once, return unchanged.
- Succeed: validate exact lease/result shapes, positive attempt, canonical lease times, and non-empty IDs before dependencies. Read/validate clock once; call `completeLease` with token, expected attempt, result, and completion time; return unchanged.
- Fail: validate exact lease/failure shapes and non-empty failure code. Read/validate clock once. For `retry`, call `nextRetryAt(lease.attempt, failedAt)` once and require canonical time not before failure. For `terminal`, never call retry schedule and omit `retryAt`. Call `failLease` once and return unchanged.
- Pause/resume/cancel: require a non-empty batch ID before dependencies; read/validate clock once, call `setBatchState` once with exact action, return unchanged.
- Progress: require a non-empty batch ID before dependencies; read/validate clock once, call `readProgress` once, return unchanged.
- Never catch dependency exceptions, parse diagnostics, retry store calls, mutate inputs, or log job targets.

Tests:
- Red first because private factory is absent.
- Invalid enqueue cases prove exact code and zero clock/ID/store calls; empty batch is distinct.
- Canonical fingerprint exact string, allocation order, and unchanged enqueue outcome.
- Capability dedupe/sort, empty capabilities, safe expiry arithmetic, and exact lease command.
- Succeed command; retry and terminal fail commands; invalid retry time stops before store.
- Every batch control and progress command uses one clock value and returns same outcome reference.
- Dependency failures/outcomes propagate unchanged; diagnostics never affect branching.
- Input objects remain unchanged.
- Run focused tests, full tests, strict typecheck, dependency/file-size checks, and diff check.

Red/green expectation:
- Old behavior fails because no private service factory exists.
- New behavior passes because fake-port traces prove all local policy and command boundaries.

Telemetry/evidence:
- Tests record only method names, fixed IDs, times, and outcomes; no target content logs.

Non-goals:
- SQL, state transitions inside the store, real clock/retry/ID implementations, worker loops, health, or UI.

Acceptance criteria:
- Exact validation and canonical fingerprint behavior are deterministic.
- Every public method delegates at most once with the fixed command shape and dependency order.
- No public/dependency change and all verification passes.

Risks and stop conditions:
- Stop before changing any public type or inventing exception semantics.
- Stop if the fixed contract cannot represent a required command; return to planner rather than adding fields.

Estimated complexity:
M

Dependencies:
- Slice 20.

## Completed Slice Packet: Slice 22

Slice Packet: Define the SQLite Jobs schema and atomic algorithms

Outcome:
ADR 0007 fixes DDL, migration coexistence, command validation, idempotent enqueue, expired-lease recovery, deterministic leasing, lease transitions, batch controls, progress, and failure mappings. The previously broad store implementation was split into four reviewable adapter slices.

## Completed Slice Packet: Slice 23

Slice Packet: Implement Jobs migration and idempotent enqueue

Goal:
Implement ADR 0007's `002_jobs` migration and `enqueueBatch` transaction as private SQLite functions, proving coexistence with Catalog migrations and atomic idempotent writes before leasing code exists.

Behavior change:
A migrated local database can persist a typed Jobs batch exactly once, replay the same fingerprint without duplication, reject a conflicting fingerprint, and survive close/reopen.

Source evidence:
- `docs/decisions/0007-jobs-sqlite-schema.md`.
- `modules/jobs/public.ts`, especially `StoredEnqueueCommand`.
- Existing Catalog migration and temporary-database patterns.
- Slice 21 exact canonical enqueue command tests.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md`.
- This active plan.

Project constraints activated:
- Implement ADR exactly; no schema or public-contract changes.
- SQLite owns transaction mechanics only and cannot reinterpret fingerprints or target meaning.
- Error branching uses prequeries and typed fields, never SQLite message text.
- Red/green TDD and production files under size guidance.

Files allowed to touch:
- `adapters/sqlite/jobs-schema.ts`
- `adapters/sqlite/jobs-enqueue.ts`
- At most one private enqueue-command validation helper under `adapters/sqlite/`
- `tests/integration/jobs-schema.test.ts`
- `tests/integration/jobs-sqlite-enqueue.test.ts`
- `package.json`

Files forbidden to touch:
- Public/shared/Jobs service contracts, existing Catalog SQLite files, lease/transition/progress code, dependencies/lockfile, fixtures/helpers, docs, and ops ledgers

Exact private APIs:
- `migrateJobsSchema(database): Outcome<void, JobQueueFailure>`.
- `enqueueJobsBatch(database, command): Outcome<JobBatchSummary, JobQueueFailure>`.
- Use structural private SQLite interfaces as existing adapters do; caller owns open/close.

Migration rules:
- Enable foreign keys and use shared `schema_migrations` with key `002_jobs` and SQLite UTC applied time.
- Run ADR DDL under `BEGIN IMMEDIATE`; repeated key is an exact no-op; rollback best-effort on failure.
- Work when no Catalog migration exists, after Catalog migration, and before Catalog migration. Never alter Catalog tables or key.
- Closed/unavailable database returns `storage_unavailable` without diagnostics or message parsing.

Enqueue rules:
- Strictly validate command, request, nested jobs/targets, canonical times, non-empty fingerprint/IDs/key, safe integer fields, unique sequences and IDs, and equal non-zero job/request lengths. Malformed input returns `invalid_request` before transaction writes.
- Begin `IMMEDIATE`; query idempotency key. Same fingerprint returns current stored batch summary with zero inserts. Different fingerprint rolls back with `idempotency_conflict`.
- Prequery batch/job ID collisions; unexplained collisions return `invalid_request` without relying on constraint text.
- Insert one active batch and pending jobs in request order. Preserve future `notBefore` exactly and store no page body or prose.
- Commit once; unexpected engine failure rolls back and returns `storage_unavailable`.

Tests:
- Red first because both private modules are absent.
- Fresh/repeated migration and exact tables/indexes/key.
- Migration coexistence in both Catalog/Jobs orders.
- Exact two-job rows including future not-before, priorities, sequence, attempts, and bookmark target references.
- Replay after directly pausing the batch returns the existing paused summary and leaves row counts unchanged.
- Same idempotency key/different fingerprint returns conflict; batch/job ID collision returns invalid request.
- Malformed command cases touch no durable rows.
- Install a test-only abort trigger on the second job insert; assert storage failure and total rollback.
- Close/reopen and inspect exact persisted rows; closed DB migration/enqueue returns unavailable.
- Run focused tests, full tests, strict typecheck, dependency/file-size/cleanup checks, and diff check.

Red/green expectation:
- Old behavior fails because migration and enqueue functions do not exist.
- New behavior passes because exact DDL and one atomic idempotent transaction are covered independently.

Telemetry/evidence:
- Tests report migration keys, row counts, fixed IDs, and states only.

Non-goals:
- Lease recovery/selection, completion/failure, batch controls, progress, facade, worker, health, or new dependencies.

Acceptance criteria:
- ADR migration and enqueue algorithm are implemented exactly with no public/dependency change.
- Replay, conflict, collision, rollback, migration order, and reopen evidence all pass.
- Files remain cohesive and verification is green.

Risks and stop conditions:
- Stop before changing ADR DDL or public command types.
- Stop if Node SQLite cannot support the documented transaction/API; return evidence to the planner.

Estimated complexity:
M

Dependencies:
- Slice 22.

## Completed Slice Packet: Slice 24

Slice Packet: Implement expired-lease recovery and leasing

Goal:
Implement ADR 0007's expired-lease recovery and deterministic `leaseNext` transaction over the Slice 23 Jobs schema, without adding completion, control, progress, or facade behavior.

Behavior change:
The SQLite queue can atomically recover crashed leases, select one eligible job in fixed order, increment its attempt, and return a typed lease or success-null.

Source evidence:
- `docs/decisions/0007-jobs-sqlite-schema.md`, recovery and `leaseNext` sections.
- `adapters/sqlite/jobs-schema.ts` and `jobs-enqueue.ts`.
- `StoredLeaseCommand` and `JobLease` in `modules/jobs/public.ts`.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md`.
- This active plan.

Project constraints activated:
- Recovery and selection share one `BEGIN IMMEDIATE` transaction.
- SQLite executes typed times/capabilities and does not calculate policy or parse errors.
- No public/schema changes and no transition/progress scope creep.

Files allowed to touch:
- `adapters/sqlite/jobs-lease.ts`
- At most one private expired-lease helper under `adapters/sqlite/`
- `tests/integration/jobs-sqlite-lease.test.ts`
- `tests/integration/jobs-sqlite-recovery.test.ts`
- At most one shared Jobs SQLite fixture helper under `tests/helpers/`
- `package.json`

Files forbidden to touch:
- Jobs/public/service contracts, schema/enqueue behavior, Catalog files, completion/failure/control/progress/facade code, dependencies/lockfile, fixtures/helpers, docs, and ops ledgers

Exact private API and validation:
- Export test-visible `leaseNextJob(database, command): Outcome<JobLease | null, JobQueueFailure>`.
- Strictly validate exact command/worker keys, non-empty worker/token, supported deduplicated capabilities, canonical `now` and `expiresAt` with `expiresAt > now`. Malformed command returns `invalid_request` before writes.
- Prequery lease-token collision and return `invalid_request`; do not branch on constraint messages.

Exact transaction:
- Begin `IMMEDIATE` and recover every row still `leased` with `lease_expires_at <= now` before selection.
- Cancelled batch recovery: `cancelled`, completed at now, clear lease fields.
- Attempts exhausted: `failed`, fixed `lease_expired` terminal evidence, completed at now, clear lease fields.
- Attempts remain in active or paused batch: `pending`, preserve not-before and prior evidence, clear lease fields.
- Select only active-batch supported jobs that are pending and due by not-before or retry-wait and due by retry-at.
- Order priority descending, sequence ascending, batch creation ascending, job ID ascending.
- Compare-and-set selected row from its observed eligible state to leased; increment attempt once; set token/worker/now/expiry; clear retry-at; require one changed row.
- Return exact lease using incremented attempt and reconstructed bookmark target. No candidate commits recovery and returns success-null.
- Any engine/CAS invariant failure rolls back and returns `storage_unavailable`; never parse exception text.

Tests:
- Red first because lease module is absent.
- Invalid worker/capability/time/token command cases leave rows unchanged.
- Priority, sequence, batch-created, and job-ID tie ordering.
- Future not-before and retry-at gating; due retry-wait selection.
- Attempt increments once and exact row/lease fields match.
- Empty candidate returns null; token collision returns invalid request.
- Expired active lease with attempts remaining recovers and can lease; paused recovers to pending but does not lease; cancelled becomes cancelled; exhausted becomes failed with fixed evidence.
- Test-only abort trigger during lease update proves rollback includes recovery.
- Closed database returns unavailable.
- Run focused tests, full tests, typecheck, dependency/file-size/cleanup checks, and diff check.

Red/green expectation:
- Old behavior fails because no private lease function exists.
- New behavior passes because recovery and deterministic lease CAS are proven in one transaction.

Telemetry/evidence:
- Fixed job IDs, states, attempts, tokens, and times only.

Non-goals:
- Complete/fail, batch controls, progress, facade, worker, health, or schema changes.

Acceptance criteria:
- Every ADR recovery branch and ordering tie is tested.
- Lease mutation is atomic and returns exact typed data.
- No public/dependency change and all verification passes.

Risks and stop conditions:
- Stop before changing ADR/schema/public types.
- Stop if recovery and selection cannot remain one transaction.

Estimated complexity:
M

Dependencies:
- Slice 23.

## Completed Slice Packet: Slice 25

Slice Packet: Implement lease transitions and batch controls

Goal:
Implement ADR 0007's atomic complete/fail lease transitions and pause/resume/cancel batch controls over the existing Jobs schema and leased rows, without progress or store-facade work.

Behavior change:
Current unexpired leases can succeed or fail exactly once, stale leases cannot mutate state, and batch controls enforce idempotent pause/resume/cancel rules.

Source evidence:
- ADR 0007 completion, failure, and batch-control sections.
- Existing Jobs schema, enqueue, lease, and test fixture helper.
- `StoredCompletionCommand`, `StoredFailureCommand`, and store control signature.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md`.
- This active plan.

Project constraints activated:
- Typed disposition/attempt/time fields control transitions; strings remain evidence only.
- Every method is one immediate transaction with CAS and best-effort rollback.
- No public/schema/progress/facade changes.

Files allowed to touch:
- `adapters/sqlite/jobs-transitions.ts`
- At most one private transition validation/helper file under `adapters/sqlite/`
- `tests/helpers/jobs-sqlite-fixture.ts` only for reusable leased-row setup
- `tests/integration/jobs-sqlite-transitions.test.ts`
- `tests/integration/jobs-sqlite-failure-transitions.test.ts`
- `tests/integration/jobs-sqlite-controls.test.ts`
- `package.json`

Files forbidden to touch:
- Public/service contracts, schema/enqueue/lease behavior, Catalog, progress/facade/worker/health code, dependencies/lockfile, other fixtures, docs, and ops ledgers

Exact private APIs:
- `completeJobLease(database, command): Outcome<void, JobQueueFailure>`.
- `failJobLease(database, command): Outcome<void, JobQueueFailure>`.
- `setJobsBatchState(database, batchId, action, changedAt): Outcome<void, JobQueueFailure>`.

Exact validation and CAS:
- Strict exact command/result/failure keys; non-empty IDs/code; supported result/disposition; positive safe attempt; canonical times. Retry requires canonical `retryAt >= failedAt`; terminal forbids `retryAt`. Malformed input returns `invalid_request` before writes.
- Complete/fail begin immediate, select by token, and require leased state, expected attempt, and stored expiry strictly after command time. Any missing/expired/consumed/replaced/mismatched lease returns `stale_lease` with no mutation.
- Completion sets succeeded, stores health result/completion time, clears lease fields, and preserves prior failure evidence. Batch state does not block success.
- Failure stores code/disposition/diagnostic unchanged and clears lease fields. Cancelled batch goes cancelled; terminal goes failed; retry with attempts remaining goes retry-wait; retry at limit goes failed. Completion time exists only for terminal/cancelled outcomes; retry-wait stores retry-at and no completion time.
- Require exactly one CAS update; unexpected engine/CAS invariant failures roll back as `storage_unavailable` without parsing messages.

Batch-control rules:
- Validate non-empty batch ID, supported action, and canonical changed time.
- Pause active to paused; paused is no-op success; cancelled invalid transition.
- Resume paused to active; active is no-op success; cancelled invalid transition.
- Cancel active/paused to cancelled; cancelled no-op success. In the same transaction cancel pending/retry-wait jobs, clear retry-at, set completion time; leased and terminal jobs stay unchanged.
- Missing batch returns `batch_not_found`; changed-at updates only when state actually changes.

Tests:
- Red first because transition module is absent.
- Exact completion in active and cancelled batches; result and prior failure evidence behavior.
- Complete/fail unknown token, expired-at-boundary, attempt mismatch, and consumed token all stale/no mutation.
- Retry, terminal, attempt-limit, and cancelled-batch failure branches with exact rows and opaque evidence.
- Invalid retry time and malformed commands touch no rows.
- Pause/resume/cancel changes, idempotent no-ops, cancelled invalid transitions, missing batch, pending/retry cancellation, and leased/terminal preservation.
- Test-only abort triggers prove rollback for one lease transition and cancel multi-row update.
- Closed database returns unavailable.
- Run focused tests, full tests, typecheck, dependency/file-size/cleanup checks, and diff check.

Red/green expectation:
- Old behavior fails because private transitions do not exist.
- New behavior passes because all legal/illegal lease and batch transitions match ADR rows exactly.

Telemetry/evidence:
- Fixed IDs, states, times, result references, and opaque failure fields only.

Non-goals:
- Expiry recovery/lease selection changes, progress, facade, worker, health, or schema changes.

Acceptance criteria:
- Every architecture/ADR transition is tested with exact typed outcomes and row state.
- CAS and cancellation are atomic; stale operations make no changes.
- No public/dependency change and all verification passes.

Risks and stop conditions:
- Stop before changing DDL or public failure/state unions.
- Stop if any branch cannot satisfy current schema checks; return to planner rather than weakening DDL.

Estimated complexity:
M

Dependencies:
- Slice 24.

## Completed Slice Packet: Slice 26

Slice Packet: Implement progress and the SQLite Jobs store facade

Goal:
Implement ADR 0007's atomic progress read with expired-lease recovery, then compose every existing private Jobs SQLite operation behind one `JobQueueStore` adapter without changing queue policy or public contracts.

Behavior change:
The Jobs service can use the complete durable SQLite store, read exact six-state progress after recovery, and continue a queue after the database is closed and reopened.

Source evidence:
- `docs/decisions/0007-jobs-sqlite-schema.md`, especially `readProgress` and common transaction rules.
- `modules/jobs/public.ts` `JobProgress` and `JobQueueStore` contracts.
- `modules/jobs/job-queue-service.ts` store call sites.
- Existing private schema, enqueue, lease, recovery, transition, and control adapters from Slices 23–25.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md` Jobs ownership and state rules.
- This active plan.

Project constraints activated:
- Progress is a storage projection over typed states and canonical timestamps; it never interprets failure/result prose.
- Recovery and progress counting share one `BEGIN IMMEDIATE` transaction.
- The facade only delegates existing contracts and does not migrate automatically, calculate clock/retry policy, or translate outcomes.

Files allowed to touch:
- `adapters/sqlite/jobs-progress.ts`
- At most one private progress validation/reconstruction helper under `adapters/sqlite/`
- `adapters/sqlite/job-queue-store.ts`
- `tests/helpers/jobs-sqlite-fixture.ts` only for reusable progress/reopen setup
- `tests/integration/jobs-sqlite-progress.test.ts`
- `tests/integration/job-queue-sqlite-store.test.ts`
- `package.json`

Files forbidden to touch:
- Public/service contracts or behavior, schema/enqueue/lease/recovery/transition/control behavior, Catalog, worker/health code, dependencies/lockfile, unrelated fixtures, docs, and ops ledgers

Exact private APIs and facade:
- Export test-visible `readJobsProgress(database, batchId, now): Outcome<JobProgress, JobQueueFailure>`.
- Export `createSqliteJobQueueStore(database): JobQueueStore`.
- The facade's six methods are async wrappers that delegate unchanged to `enqueueJobsBatch`, `leaseNextJob`, `completeJobLease`, `failJobLease`, `setJobsBatchState`, and `readJobsProgress` using the captured database.
- Store construction performs no migration and no I/O. An unmigrated or closed database returns existing typed storage failures when a method is called.

Exact progress transaction:
- Strictly validate a non-empty batch ID and canonical `now` before beginning; malformed input returns `invalid_request` with no writes.
- Begin `IMMEDIATE`, call existing `recoverExpiredLeases(database, now)`, then load the requested batch and grouped counts in the same transaction.
- If the requested batch is absent, commit any valid global recovery and return `batch_not_found`.
- Return all six counts (`pending`, `leased`, `retry_wait`, `succeeded`, `failed`, `cancelled`) with absent groups as zero; every count and stored total is a non-negative safe integer and their sum must equal `total_count` exactly.
- `nextEligibleAt` is scoped to the requested batch. It is the minimum canonical timestamp strictly after `now` among pending `not_before` and retry-wait `retry_at` only when that batch is active, plus unexpired leased-job expiry regardless of that requested batch's active/paused/cancelled state.
- Omit `nextEligibleAt` when no qualifying future timestamp exists. Reject malformed stored states/times/counts as `storage_unavailable`; never repair them.
- Commit successful progress and missing-batch recovery. Any engine or stored-invariant failure rolls back recovery best-effort and returns `storage_unavailable` without parsing SQLite messages.

Tests:
- Red first because progress and facade modules are absent.
- Exact zero-filled six-state counts and batch metadata for representative mixed rows.
- Earliest next time across future pending, retry-wait, and leased candidates; ignore due/past timestamps, suppress pending/retry times when paused or cancelled, but retain a future lease expiry.
- Recover active, paused, cancelled, and exhausted expired leases before counting; prove recovery commits with the returned projection.
- Missing batch returns `batch_not_found` while valid global recovery commits.
- Corrupt total/count or malformed stored projection evidence returns `storage_unavailable` and rolls back recovery; a test-only abort trigger also proves rollback.
- Facade delegates every method through real SQLite behavior and preserves exact outcomes.
- End-to-end service/store proof: migrate, enqueue, lease, succeed or fail, close, reopen, recreate the facade, and read exact progress without duplication or data loss.
- Unmigrated and closed databases return `storage_unavailable` through the facade.
- Run focused tests, full tests, typecheck, dependency/file-size/cleanup checks, ledger validation, and diff check.

Red/green expectation:
- Old behavior fails because `readJobsProgress` and `createSqliteJobQueueStore` do not exist.
- New behavior passes because progress/recovery rows and a complete service-to-SQLite path match the fixed contracts exactly.

Telemetry/evidence:
- Fixed batch IDs, six state counts, canonical eligibility times, and deterministic service/store traces only.

Non-goals:
- Migration automation, polling, worker loops, handlers, health requests, concurrency tuning, schema changes, or new failure codes.

Acceptance criteria:
- Progress recovery, counting, invariant rejection, and next-time rules match ADR 0007 exactly.
- The facade implements every `JobQueueStore` method with no policy or semantic interpretation.
- Close/reopen service composition passes with no public/dependency change and all verification is green.

Risks and stop conditions:
- Stop before changing public contracts, DDL, or existing private operation behavior.
- Stop if a facade method cannot satisfy the current `JobQueueStore` contract without translation; return to the planner rather than adding policy.
- Stop if progress cannot roll back recovered rows after an invariant/engine failure.

Estimated complexity:
M

Dependencies:
- Slice 25.

## Completed Slice Packet: Slice 28

Slice Packet: Implement executable worker and handler types

Goal:
Migrate the exact Slice 27 one-step worker and handler-plugin contract from the module map into the executable type-only Jobs public contract, without adding runtime worker behavior.

Behavior change:
Future worker and handler implementations can compile against closed step, operation, failure, configuration, and plugin interfaces while the Jobs public module remains runtime-empty.

Source evidence:
- `docs/architecture/module-map.md` Jobs public contract and worker/handler boundary rules.
- Existing `modules/jobs/public.ts` and `tests/contract/jobs-types.typecheck.ts` parity pattern.
- `tests/contract/jobs.contract.test.ts` zero-runtime-surface guard.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md`.
- This active plan.

Project constraints activated:
- Public contract change is isolated from worker implementation.
- Handler outputs are typed result references or typed failures only; no prose/error interpretation enters the contract.
- This slice adds no runtime exports and changes no existing queue/store type.

Files allowed to touch:
- `modules/jobs/public.ts`
- `tests/contract/jobs-types.typecheck.ts`
- `tests/contract/jobs.contract.test.ts` only if the runtime-empty assertion needs a clearer message
- `package.json` only if a focused contract script is needed

Files forbidden to touch:
- Worker/service runtime, queue validation/service, SQLite adapters/schema, core shared types, Catalog, Health, fixtures, dependencies/lockfile, docs, and ops ledgers

Exact additive type surface:
- `JobWorkerOperation = "lease" | "succeed" | "fail"`.
- `JobWorkerStep` is exactly the `idle`, `succeeded` with `lease` plus `result`, and `failure_reported` with `lease` plus `failure` union from the module map.
- `JobWorkerFailure` is exactly the four-way `queue_failure`, `queue_interrupted`, `handler_interrupted`, and `invalid_handler_output` discriminated union. `queue_failure` carries exact operation plus `JobQueueFailure`; `queue_interrupted` carries only operation; interruption/output branches carry only code.
- `JobWorkerConfigurationFailure` has only `code: "invalid_handler_registry"`.
- `JobHandler` exposes readonly `type: JobType` and `handle(lease): Promise<Outcome<JobResultReference, TypedJobFailure>>`.
- `JobWorker` exposes `runOne(worker): Promise<Outcome<JobWorkerStep, JobWorkerFailure>>`.
- Do not export a runtime `createJobWorker` in this slice; its implementation and exact factory signature belong to Slice 29.

Tests:
- Red first with type imports/parity assertions before adding production declarations.
- Exact `Equal` assertions for operation, step, each failure branch, configuration failure, handler signature, and worker signature.
- Positive assignment fixtures for idle, succeeded, failure-reported, typed queue failure, queue interruption, handler interruption, invalid output, handler, and worker.
- Negative compile cases reject unknown operation/status/code, missing operation/failure, diagnostics on interruption branches, raw handler prose/results, and mismatched handler return types.
- Existing queue/store parity assertions remain unchanged and green.
- Runtime contract test proves `modules/jobs/public.ts` still exports zero values.
- Run the Jobs contract test, typecheck, full tests, file-size/cleanup checks, ledger validation, and diff check.

Red/green expectation:
- Old behavior fails because worker types are absent.
- New behavior passes because the executable type surface exactly matches the architecture contract with no runtime export.

Telemetry/evidence:
- Compile-time parity and fixed synthetic type fixtures only.

Non-goals:
- `createJobWorker`, validation, handler routing, queue calls, interruption execution, result repositories, SQL, polling, or Health.

Acceptance criteria:
- Every additive type exactly matches the module map and no existing public type changes.
- Negative assignments prove the discriminants and semantic boundary stay closed.
- Runtime public surface remains empty and all verification passes.

Risks and stop conditions:
- Stop before changing shared IDs, existing queue/store unions, or adding runtime values.
- Stop if the module-map contract cannot be represented without modifying an existing public type; return to architecture rather than broadening this slice.

Estimated complexity:
S

Dependencies:
- Slice 27.

## Completed Slice Packet: Slice 29

Slice Packet: Implement the one-step worker against fakes

Goal:
Implement the architecture-approved `createJobWorker` factory and one bounded `runOne` step over the existing `JobQueue` and typed handler plugins, with no SQL, polling, or domain-result implementation.

Behavior change:
A validated handler registry can lease one job, route it to the exact handler, and report one typed success or failure; queue/handler interruptions are returned without compensating mutations.

Source evidence:
- `docs/architecture/module-map.md` worker and handler boundaries.
- Slice 28 types in `modules/jobs/public.ts`.
- Existing strict validation patterns in `modules/jobs/job-queue-validation.ts` and fake-port test style.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md`.
- This active plan.
- `single-slice-executor` skill.

Project constraints activated:
- The worker coordinates typed contracts only; domain handlers own result persistence and retry disposition.
- Malformed handler output is rejected, never repaired. Exception messages and diagnostics never control branching.
- One call performs at most one lease and one matching `succeed` or `fail` report.

Files allowed to touch:
- `modules/jobs/job-worker-service.ts`
- At most one private validation helper, `modules/jobs/job-worker-validation.ts`
- `tests/helpers/fake-job-worker.ts`
- `tests/integration/job-worker-service.test.ts`
- `tests/integration/job-worker-failures.test.ts`
- `package.json`

Files forbidden to touch:
- Public/shared contracts, queue service/validation behavior, SQLite adapters/schema, Catalog, Health, real result repositories/handlers, worker polling/composition, dependencies/lockfile, unrelated fixtures, docs, and ops ledgers

Exact factory and registry rules:
- Export runtime `createJobWorker(queue, handlers): Outcome<JobWorker, JobWorkerConfigurationFailure>` from `job-worker-service.ts`; do not re-export it from the type-only public module.
- Validate before constructing: handlers is a dense exact array with no extra/symbol properties; every entry is a non-null object whose declared `type` is supported and whose `handle` resolves to a function; types are unique. Handler implementations may have private fields, extra internals, or prototype methods—do not make concrete object shape part of the plugin contract. Any malformed/duplicate registry returns exactly `{ ok: false, error: { code: "invalid_handler_registry" } }` without queue/handler calls.
- Empty registry is valid. Snapshot each declared type and callable (binding its receiver when needed) into private immutable routing state; later caller array mutation or replacement of a handler's `type`/`handle` property must not change capabilities or routing.
- Capabilities are the lexical list of configured unique handler types. The current closed union therefore produces `[]` or `["health_check"]`.

Exact `runOne` behavior:
- Call `queue.lease(worker, capabilities)` once. A typed queue failure returns `queue_failure` with operation `lease` and the exact failure. A thrown/rejected call returns `queue_interrupted` with operation `lease`, no diagnostic, and no handler/report call.
- Success-null returns exact `{ status: "idle" }`.
- Route a returned typed lease to its registered handler and pass the same lease reference once. The configured capability contract means a valid queue cannot return an unregistered type; stop rather than adding fallback routing if current types cannot preserve this invariant.
- Strictly validate handler outcome top-level keys and discriminant. Success must contain the exact typed result-reference shape; failure must contain the exact typed failure shape. Reuse Jobs-owned result/failure validation where practical, but translate malformed handler contract values only to `invalid_handler_output` and make no queue report.
- Handler throw/rejection returns `handler_interrupted`, discards exception text, and makes no queue report.
- Valid handler success calls `queue.succeed(lease, result)` once. Valid handler failure calls `queue.fail(lease, failure)` once. Pass the same lease and handler value references unchanged.
- A typed report failure returns `queue_failure` with operation `succeed` or `fail` and exact queue failure. A thrown/rejected report returns `queue_interrupted` with the exact operation. Never issue a second or compensating queue mutation.
- Accepted success returns exact `succeeded` step with lease/result; accepted failure report returns exact `failure_reported` step with lease/failure.

Tests:
- Red first because worker runtime modules are absent.
- Registry: empty success, object-literal and class/prototype-handler success, non-array/sparse/array-extra-key/symbol/unknown/non-function/duplicate rejection, zero dependency calls, and post-construction mutation isolation.
- Lease: exact worker/capabilities call, idle, typed lease failure, and thrown/rejected lease.
- Routing: exact handler/lease reference and only matching handler called.
- Success and typed failure: exact queue calls, exact returned steps, same value references, and no opposite report.
- Handler throw/reject and malformed top-level/result/failure shapes return exact worker failures and make no report.
- Typed and thrown/rejected `succeed`/`fail` outcomes carry the exact operation and never trigger a second mutation.
- Run focused worker tests, full tests, typecheck, dependency/file-size/cleanup checks, ledger validation, and diff check.

Red/green expectation:
- Old behavior fails because the worker factory does not exist.
- New behavior passes because every bounded routing and interruption branch matches the fixed worker contract against fakes.

Telemetry/evidence:
- Fixed synthetic leases, operation names, call counts, and typed result/failure references only.

Non-goals:
- SQLite/reopen proof, durable result repository, fake clock, polling loop, process signals, concurrency, Health behavior, or public-contract changes.

Acceptance criteria:
- Registry and every `runOne` branch are exact and independently tested.
- Interrupted/malformed paths leave the leased job unreported by construction.
- No public/dependency change and all verification passes.

Risks and stop conditions:
- Stop before adding a new public worker failure or changing queue contracts.
- Stop if a valid queue lease cannot be routed from the validated capability registry; return to architecture rather than inventing fallback semantics.
- Stop if strict handler validation would require parsing diagnostic or exception prose.

Estimated complexity:
M

Dependencies:
- Slice 28.

## Completed Slice Packet: Slice 30

Slice Packet: Prove interruption and resume after database reopen

Goal:
Demonstrate PRD acceptance criterion 2 with the real Jobs service, one-step worker, SQLite store, and a test-only durable idempotent handler repository: interrupt after the first result commit but before queue success, reopen after lease expiry, resume the selected two-job batch, and finish without duplicate domain results.

Behavior change:
No production behavior changes. A deterministic integration trace proves the implemented contracts survive process-style interruption and database reopen.

Source evidence:
- PRD acceptance criterion 2 and learning-agenda queue trace.
- Jobs worker result-before-success and interruption rules in `docs/architecture/module-map.md`.
- Existing Jobs service, SQLite facade/migration, one-step worker, and temporary-database test helpers.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md`.
- This active plan.
- `single-slice-executor` skill.

Project constraints activated:
- The fake handler owns durable result idempotency; Jobs stores only typed references.
- Stable idempotency derives only from job type, target kind/bookmark ID, and input version—not job ID, lease token, worker, or attempt.
- Interruption after commit must leave the queue lease untouched; recovery happens only through normal expiry on the next lease/read.

Files allowed to touch:
- `tests/helpers/fake-durable-job-handler.ts`
- `tests/integration/job-worker-resume.test.ts`
- `package.json`

Files forbidden to touch:
- All production/public modules, SQLite production schema/adapters, existing tests/helpers, Catalog, Health, UI/network, dependencies/lockfile, docs, and ops ledgers

Exact test-only durable repository:
- Use a test-only SQLite table in the same temporary database, created outside production migrations, with one unique stable-input key and one generated result ID per committed fake health result.
- Repository `commitOrLoad` is transactional/idempotent: the same type/target/input-version key always returns the same `JobResultReference`; a new key inserts exactly one row. It never keys on attempt/token/job ID and never stores prose.
- Reconstruct the repository and handler from the reopened database rather than retaining the pre-close object.
- Handler mode `interrupt_after_commit_once` commits/loads the result and then rejects/throws a fixed test interruption before returning an outcome. Normal mode returns the committed/loaded typed result reference.

Exact deterministic trace:
- Migrate Jobs and the test-only result table; create a mutable canonical fake clock, deterministic ID factory/token sequence, real SQLite facade, real Jobs service, and one-step worker.
- Enqueue one selected-scope batch with two ordered `health_check` bookmark jobs and stable input versions.
- First `runOne` leases sequence 0 at attempt 1. Its handler commits result row 1, then interrupts. Assert exact `handler_interrupted`, one durable result, job still leased with no queue result reference, job 2 pending, and progress showing one leased/one pending.
- Close the database to represent service loss. Advance the fake clock to the exact lease-expiry boundary or later. Reopen the file, rerun migrations idempotently, recreate store/service/repository/handler/worker objects, and retain only deterministic clock/ID-sequence state required by the harness.
- First resumed `runOne` triggers ordinary expired-lease recovery, re-leases sequence 0 at attempt 2, loads the same durable result ID, and succeeds. Assert no second result row.
- Second resumed `runOne` leases sequence 1 at attempt 1, commits result row 2, and succeeds. Third call returns idle.
- Calling `succeed` with the original attempt-1 lease/result after recovery/finalization returns exact `stale_lease` and changes nothing.
- Final progress is active with total 2, succeeded 2, every other count zero; durable result count is exactly 2 and sequence-0 has one result ID despite two handler executions.
- Close/reopen once more and prove final queue progress and fake result rows persist exactly.

Tests and evidence:
- Red first because the fake durable handler/helper and resume test do not exist.
- Assert the exact worker-step/failure shapes, lease attempts/tokens, job rows, progress snapshots, stable input keys, result IDs, result-row counts, and idle termination.
- Assert no queue failure/failure evidence is synthesized from the interruption.
- Keep the trace deterministic and loopback-free; no sleeps, external network, model, or Chrome access.
- Run the focused resume test, full tests, typecheck, dependency/file-size/cleanup checks, ledger validation, and diff check.

Red/green expectation:
- Old behavior lacks the deterministic durable-result restart trace.
- New behavior passes because the current contracts recover the lease and reuse the committed result without production changes.

Telemetry/evidence:
- Fixed synthetic IDs, canonical times, state/attempt transitions, and row counts only.

Non-goals:
- Production result repository, Health semantics, polling/process manager, signals, concurrent workers, retry-policy changes, schema changes, or UI.

Acceptance criteria:
- The two-job trace proves stop/reopen/resume, result-before-success, lease recovery, attempt progression, stale old lease rejection, idempotency, final completion, and persistence.
- No production/public/dependency change and all verification passes.

Risks and stop conditions:
- Stop before changing production SQL or contracts to make the harness pass.
- Stop if the fake repository cannot express idempotency using only stable declared input; return to architecture rather than using lease/job runtime identity.
- Stop if interruption requires a queue mutation; the expected behavior is an untouched lease.

Estimated complexity:
M

Dependencies:
- Slice 29.

## Completed Slice Packet: Slice 31

Slice Packet: Characterize deterministic Health transport inputs

Goal:
Build a loopback-only fixture and discovery tests that capture stable Node 26 `fetch` transport facts for the first Health architecture contract, without assigning Health statuses or implementing production network policy.

Behavior change:
No production behavior changes. Repeatable local evidence exists for successful responses, redirects, HTTP failures, timeout, connection loss, and malformed HTTP.

Source evidence:
- PRD URL-health statuses, evidence fields, bounded redirects/timeouts, and separation of observation from staleness.
- Provisional Health module in `docs/architecture/module-map.md`.
- Node 26 runtime already selected for built-in SQLite and standard-library-first implementation.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md` Health boundary.
- This active plan.
- `single-slice-executor` skill.

Project constraints activated:
- This slice records transport facts only. Health classification, retry meaning, staleness, SSRF policy, and diagnostics remain planner-owned follow-up work.
- Tests may inspect typed/status/name/header fields. They must not branch on exception messages or free-form socket diagnostics.
- Every listener binds only to `127.0.0.1` on an ephemeral port and is closed deterministically.

Files allowed to touch:
- `tests/helpers/health-loopback-fixture.ts`
- `tests/spikes/health-transport-fixtures.test.ts`
- `docs/decisions/0008-health-transport-fixtures.md`
- `package.json`

Files forbidden to touch:
- Health public/runtime modules, Jobs/Catalog/shared contracts, production fetch/network code, SQLite, UI, dependencies/lockfile, unrelated fixtures, other docs, and ops ledgers

Exact fixture routes and mechanics:
- Standard HTTP fixture routes: `200` healthy HTML with deterministic selected headers; `301` permanent redirect; `302` temporary redirect; `401`; `403`; `404`; `410`; `429` with deterministic `Retry-After`; `503`; one connection-close route; and one timeout route that leaves the response pending until client abort/cleanup.
- Redirect locations point only to the fixture's own healthy route. Tests use `redirect: "manual"` to preserve each hop and separately prove default-follow final URL behavior.
- Add a test-only raw TCP listener for one malformed HTTP response that built-in `fetch` rejects. It also binds to loopback/port zero and shares deterministic cleanup.
- Track opened sockets and destroy remaining sockets during cleanup so timeout/connection tests cannot hang the suite.
- Expose only fixture URLs and request counters needed by tests; no Health status labels in the helper API.

Discovery tests:
- Exact status, `ok`, URL, selected header, and small deterministic body facts for 200.
- Exact 301/302 status and `Location` under manual redirects; default-follow reaches the healthy final URL without pretending to preserve a redirect chain.
- Exact status/header facts for 401/403/404/410/429/503. HTTP responses remain successful `fetch` promises even when `response.ok` is false.
- Abort the timeout through an explicit `AbortController` and bounded timer. Assert the stable error name produced by this deliberate abort; do not assert its message.
- Connection close and malformed HTTP reject. Record only stable top-level error type/name observed on the selected runtime; do not inspect messages or infer DNS/TLS meaning.
- Assert every observed request stays on loopback and fixture cleanup completes. No external network, DNS dependency, TLS certificate, model, browser, or Chrome access.

Decision record:
- ADR 0008 records runtime versions, exact observed facts, which fields are stable enough for a future fetch-port contract, why redirects must be walked manually, and which DNS/TLS/socket distinctions still require injected adapter fixtures.
- The ADR explicitly forbids mapping these facts to `HealthStatus` in this slice and forbids exception-message parsing in later code.

Red/green expectation:
- Old behavior lacks the loopback fixture and transport characterization.
- New behavior passes because every declared route/error is deterministic, bounded, and captured without production semantics.

Telemetry/evidence:
- Status codes, URLs, selected headers, bounded body literals, request counts, runtime versions, and stable error names only.

Non-goals:
- Health types/classification, retries/jitter, redirect policy limits, SSRF/local-network policy, DNS/TLS simulation, concurrency, persistence, Jobs handler, live internet, or staleness.

Acceptance criteria:
- All required local transport scenarios run deterministically and clean up without leaked listeners/sockets.
- ADR 0008 gives the Health architecture slice enough concrete provider evidence to define fetch/clock/repository ports without inventing Node behavior.
- No production/public/dependency change and all verification passes.

Risks and stop conditions:
- Stop if a claimed distinction depends on error-message text; record the limitation instead.
- Stop before assigning Health meaning to status/error facts.
- Stop if cleanup cannot bound the timeout or malformed-response test reliably.

Estimated complexity:
M

Dependencies:
- Slice 30.

## Completed Slice Packet: Slice 33

Slice Packet: Implement executable Health contract types

Goal:
Migrate the exact Slice 32 Health public contract into one type-only module with compile-time parity and zero runtime exports, before any classifier, service, transport, repository, handler, or staleness code.

Behavior change:
Health producers and consumers can compile against closed observation, transport, retry, repository, failure, and staleness contracts without gaining runtime behavior.

Source evidence:
- `docs/architecture/module-map.md`, complete Health module public contract and boundary rules.
- ADR 0008 transport facts.
- Existing Catalog/Jobs type-only public modules and contract-test patterns.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md`.
- This active plan.

Project constraints activated:
- Public contract migration is isolated and planner-owned.
- Semantic interpretation remains typed: no exception prose, body prose, or model prose appears in an outcome discriminator.
- Observation uses `JobResultId` directly so a committed Health result satisfies the existing Jobs result reference without shared-contract changes.

Files allowed to touch:
- `modules/health/public.ts`
- `tests/contract/health-types.typecheck.ts`
- `tests/contract/health.contract.test.ts`
- `package.json` only to register the runtime-empty contract test

Files forbidden to touch:
- Core/shared and Jobs/Catalog public contracts, any runtime module/adapter/SQL, fixtures/spikes, PRD/architecture/ADRs, dependencies/lockfile, other tests, docs, and ops ledgers

Exact type surface:
- Transcribe every type and interface in the Health public-contract code block exactly: statuses, transport/observation error codes, selected headers, check request, redirect hop, observation, service failure, service, clock/ID/config ports, transport request/response/failure/port/fact, retry decision/policy, delay, fingerprinter, repository failure/port, and staleness disposition/reasons/input/assessment.
- Use readonly fields and arrays exactly as declared. Preserve the exact method signatures and `Outcome` error types.
- Import shared identity/value types from `core/contracts/public.ts`; do not redeclare brands.
- Keep `modules/health/public.ts` type-only. It exports no factory, constants, schemas, validators, status tables, or runtime values.

Tests:
- Red first by importing the absent Health types and adding parity assertions before production declarations.
- Exact `Equal` assertions for every closed union and every method signature.
- Positive fixtures cover one 200-style observation, one transport failure fact, retry/no-retry decisions, repository methods, typed service failure, and staleness assessment.
- Negative compile cases reject unknown statuses/failure codes/header names, redirect status outside the closed set, automatic redirect mode, raw body/prose on observations, string observation IDs, delete disposition, arbitrary reason codes, and missing failure disposition.
- Runtime contract test imports `modules/health/public.ts` and proves `Object.keys(...)` is empty.
- Existing shared/Jobs/Catalog contracts remain unchanged and green.
- Run focused Health contract test, typecheck, full tests with loopback permission, file-size/dependency/cleanup checks, ledger validation, and diff check.

Red/green expectation:
- Old behavior fails because the Health public module and types are absent.
- New behavior passes because the executable type surface matches the architecture line for line with no runtime export.

Telemetry/evidence:
- Compile-time parity and fixed synthetic type fixtures only.

Non-goals:
- Runtime schema validation, classification maps, service orchestration, transport, URL safety, retry implementation, hashing, repository/SQL, Jobs handler, or staleness thresholds.

Acceptance criteria:
- Every architecture-owned Health type is represented exactly and no other public type/value is added.
- Negative assignments close the semantic and safety boundaries.
- Public runtime surface is empty and all verification passes.

Risks and stop conditions:
- Stop before changing the architecture contract or existing shared/Jobs types.
- Stop if the public file would exceed 300 lines; split the architecture-owned surface by a planner-approved public module boundary before continuing.
- Stop if exact parity requires inventing a runtime schema or policy value.

Estimated complexity:
S

Dependencies:
- Slice 32.

## Completed Slice Packet: Slice 34

Slice Packet: Implement pure Health fact classification

Goal:
Implement strict, side-effect-free validation and classification for terminal typed transport facts plus pure redirect-hop resolution, before Health service orchestration or network code.

Behavior change:
Validated HTTP responses and transport failures map deterministically to Health observation fields; redirect responses produce validated hops or typed private failures without I/O.

Source evidence:
- Slice 33 executable Health types.
- Exact redirect and classification tables in `docs/architecture/module-map.md`.
- ADR 0008 typed transport evidence and message-parsing prohibition.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md` Health rules.
- This active plan.
- `single-slice-executor` skill.

Project constraints activated:
- Classification uses status/failure/header/redirect discriminants only. Body bytes, header values, diagnostics, and exception prose never choose meaning.
- This slice is pure Health-domain logic with no transport, clock, IDs, retries, persistence, Jobs, or staleness.

Files allowed to touch:
- `modules/health/health-fact-classification.ts`
- At most one strict private validator, `modules/health/health-fact-validation.ts`
- `tests/unit/health-fact-classification.test.ts`
- `tests/unit/health-redirect-resolution.test.ts`
- `package.json`

Files forbidden to touch:
- Health public types, any service/transport/repository/handler/staleness runtime, Jobs/Catalog/core, adapters/SQL, fixtures/spikes, dependencies/lockfile, docs, and ops ledgers

Exact private APIs:
- `classifyTerminalHealthFact(fact, redirects): Outcome<HealthClassification, HealthClassificationFailure>`.
- `resolveHealthRedirect(currentUrl, response): Outcome<RedirectHop, HealthClassificationFailure>`.
- Private `HealthClassification` contains readonly `status`, optional `finalUrl`, optional `httpStatus`, readonly selected `headers`, and optional `errorCode` only.
- Private failure code is exactly `invalid_fact`, `redirect_required`, or `invalid_redirect`; it carries no diagnostic.

Strict validation:
- Validate exact top-level/nested keys, closed discriminants/unions, canonical dense arrays, safe integer status/duration, non-empty URLs/header values, unique selected header names, `Uint8Array` body when present, and exact redirect-hop shapes. Reject malformed facts/redirects as `invalid_fact` without mutation.
- Response status is an integer from 100 through 599. Duration is a non-negative safe integer. Transport failure duration follows the same rule.
- Redirect history contains only 301/302/303/307/308 hops, exact non-empty URL/location fields, and no unknown keys.

Terminal classification:
- Any response status 301/302/303/307/308 returns private `redirect_required`; redirect walking belongs to the service.
- Final 2xx: `healthy` with no hops; `redirect_permanent` when every hop is 301/308; `redirect_temporary` when any hop is 302/303/307.
- Final 401/403/404/410/429 map exactly to authentication/forbidden/not-found/gone/rate-limited. Final 500–599 maps `server_error`. Every other non-redirect HTTP status maps `uncertain`.
- Response classification returns response URL as `finalUrl`, exact status as `httpStatus`, exact validated header array, and no error code.
- Failure codes `unsupported_url`, `timeout`, `dns_failure`, and `tls_error` map to matching statuses. `connection_failure`, `malformed_response`, and `unknown_transport` map to `uncertain`. Every failure preserves its code as `errorCode`, omits final URL/HTTP status, and returns an empty header array.

Redirect resolution:
- Accept only a validated redirect response with exactly one non-empty `location` header and a non-empty absolute current URL.
- Resolve relative or absolute `Location` with the standard URL parser against current URL. Return exact hop with requested URL, status, original location, and resolved absolute next URL.
- Missing/duplicate/empty/unparseable location, non-redirect response, or invalid current URL returns `invalid_redirect`. Do not apply request-safety/SSRF policy here; the future transport validates the resolved target before execution.

Tests:
- Red first because classification modules are absent.
- Table-test every final HTTP mapping, all five redirect-history combinations, and all seven transport failures.
- Prove status/error/header/final URL fields exactly and preserve validated array/value references where the contract permits.
- Relative and absolute redirect resolution for all five statuses; missing/duplicate/empty/bad location and malformed facts.
- Strict malformed matrix: unknown/extra/symbol keys, sparse arrays, duplicate headers, bad status/duration, wrong body type, malformed hop, unsupported discriminant.
- Prove body bytes and header values cannot change classification.
- Run focused unit tests, full tests with listener permission, typecheck, file-size/dependency/cleanup checks, ledger validation, and diff check.

Red/green expectation:
- Old behavior lacks pure Health classification.
- New behavior passes because every typed fact and redirect branch matches the architecture table exactly.

Telemetry/evidence:
- Fixed statuses, failure codes, URLs, selected headers, and classification records only.

Non-goals:
- Observation IDs/timestamps/duration totals, retries, redirect limits, safe network execution, body fingerprinting, service idempotency, repository, handler, staleness, model evidence, or live internet.

Acceptance criteria:
- Every declared mapping and malformed boundary is exact and independently tested.
- No semantic branch reads body/header prose or diagnostics.
- No public/dependency change and all verification passes.

Risks and stop conditions:
- Stop before changing the public contract or architecture mapping table.
- Stop if redirect safety would require network resolution; leave it for the transport design slice.
- Stop if a classification distinction would require parsing free-form evidence.

Estimated complexity:
M

Dependencies:
- Slice 33.

## Next executable Slice Packet

Slice Packet: Implement bounded Health check execution against fakes

Goal:
Implement the private async execution loop that combines one safe transport port, typed retry decisions/delay, manual redirect walking, and the pure classifier into terminal Health execution evidence, without clock, IDs, hashing, repository, or public changes.

Behavior change:
Given a URL and fake ports, Health can execute a bounded sequence of typed requests and return deterministic classified evidence or one fixed service failure.

Source evidence:
- Health execution/retry/redirect rules in `docs/architecture/module-map.md`.
- Slice 34 classifier and redirect resolver.
- Slice 33/36 Health transport, retry, config, and failure types.

Relevant instruction files:
- User-provided Global Coding Agent Rules in task context.
- `docs/architecture/module-map.md` Health rules.
- This active plan.
- `single-slice-executor` skill.

Project constraints activated:
- The loop executes typed facts and policy decisions only. It never interprets body bytes, header values, diagnostics, thrown errors, or page text.
- Network safety remains guaranteed by `HealthTransport`; this slice uses fakes and performs no network/DNS work.
- All loops are bounded by validated attempts and redirects; no polling or recursion without a fixed limit.

Files allowed to touch:
- `modules/health/health-check-execution.ts`
- At most one private helper, `modules/health/health-check-execution-validation.ts`
- `tests/helpers/fake-health-check-execution.ts`
- `tests/integration/health-check-execution.test.ts`
- `tests/integration/health-check-execution-failures.test.ts`
- `package.json`

Files forbidden to touch:
- Health public contract/classifier behavior, checker service, transport adapters/fixtures, clock/ID/fingerprint/repository/SQL, Jobs/Catalog/core, staleness, dependencies/lockfile, docs, and ops ledgers

Exact private API and output:
- Export `executeHealthCheck(url, dependencies): Promise<Outcome<HealthExecutionEvidence, HealthFailure>>`.
- Dependencies are exactly `transport`, `retryPolicy`, `delay`, and `config` from the public contract.
- Private `HealthExecutionEvidence` contains readonly `status`, optional `finalUrl`, optional `httpStatus`, readonly `redirects`, `durationMs`, `retryCount`, readonly `headers`, optional `errorCode`, and optional bounded `body: Uint8Array`.
- Return references from validated classifier/transport fields where safe; never mutate inputs.

Validation and fixed failures:
- Before dependencies, require non-empty URL; positive safe `timeoutMs`, `maxBodyBytes`, `maxAttempts`; non-negative safe `maxRedirects`; and an exact dependency-container key set. Port implementations may have private fields/prototype methods; validate only their declared callable methods. Invalid inputs return terminal `{ code: "invalid_request" | "invalid_configuration", disposition: "terminal" }` as appropriate.
- Transport throw/rejection and delay throw/rejection return retry `transport_unavailable`, with no diagnostic and no further call.
- Malformed transport outcome/fact, classifier invariant failure, retry-policy throw, or malformed retry decision returns terminal `invalid_configuration`; no downstream repair or second call.
- Retry delay is a non-negative safe integer. Duration accumulation (transport durations plus completed delays) and retry counters must remain safe integers; overflow is terminal `invalid_configuration`.

Exact loop:
- For each current URL, attempts are one-based and reset after a followed redirect. Call transport once per attempt with exact GET/manual/config fields.
- Validate/classify the returned fact before giving it to `retryPolicy.decide(attempt, fact)`. Call the policy once for every valid fact.
- If decision is retry and `attempt < maxAttempts`, await the exact delay, add delay/duration safely, increment total `retryCount`, increment attempt, and request the same URL again.
- If retry is requested at the attempt limit, perform no delay/request and use the current fact.
- For a valid redirect response after retries: when `redirects.length >= maxRedirects`, return successful `uncertain` evidence with current response URL/status/headers, existing hops, `redirect_limit`, accumulated duration/retries, and no followed hop.
- Otherwise resolve one hop through `resolveHealthRedirect`. `invalid_redirect` becomes successful `uncertain` evidence with current response URL/status/headers and `invalid_redirect`. An `invalid_fact` resolver result is terminal `invalid_configuration`.
- Append a valid hop, set current URL to `nextUrl`, reset attempt to 1, and continue. Redirect requests do not increment `retryCount`.
- A terminal classifier success returns exact classification plus accumulated redirects/duration/retry count and the final response body when present. Expected transport failures therefore return successful evidence.

Tests:
- Red first because the execution module is absent.
- Single terminal 200 and each expected transport failure with exact transport command/evidence.
- Permanent-only, temporary, and mixed multi-hop redirects; relative URL resolution; per-hop attempt reset; exact call order.
- Zero/max redirect limits and missing/duplicate/bad `Location` produce successful uncertain evidence with exact error codes.
- Retry then response, retry then failure, multiple retries, zero delay, retry at limit, and total retry/duration accounting.
- Invalid URL/config/dependency shapes touch nothing. Transport/retry/delay throws and malformed outcomes/decisions stop at the exact call.
- Overflow, sparse/extra-key structures, body/header prose non-interference, reference/non-mutation checks.
- Run focused execution tests, full listener-enabled tests, typecheck, dependency/file-size/cleanup checks, ledger validation, and diff check.

Red/green expectation:
- Old behavior lacks the execution loop.
- New behavior passes because every bounded redirect/retry/failure path composes the existing typed contracts exactly.

Telemetry/evidence:
- Fixed URLs, attempts, delays, statuses, error codes, call order, and durations only.

Non-goals:
- Observation identity/time, idempotency load/save, body hashing, real transport or request safety, SQL, Jobs handler, staleness, concurrency, or live network.

Acceptance criteria:
- Every loop branch is bounded, deterministic, and independently tested.
- Expected network failures are successful evidence; only fixed dependency/configuration faults fail execution.
- No public/dependency change and all verification passes.

Risks and stop conditions:
- Stop before changing classifier/public contracts or adding a new Health failure code.
- Stop if malformed provider output cannot map to existing `invalid_configuration`; return to architecture rather than inventing repair.
- Stop if redirect target safety would require network work; that belongs to the transport design slice.

Estimated complexity:
M

Dependencies:
- Slice 36 and Slice 34.
