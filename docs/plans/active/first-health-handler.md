# First Health handler

Status: active
Created: 2026-07-14
Refresh: after H2 or any contract finding

## Overview

Connect the existing `health_check` Jobs route to a caller-driven Health checker. The handler will resolve bookmark IDs through Catalog and return only a committed observation reference. This plan stops before production network execution or runtime registration.

## Current state

- `health_check_v1` is live as a dry-run profile: one attempt, six maximum network requests per bookmark, zero model calls.
- Jobs already has a one-step worker and `JobHandler` plugin contract.
- Health executable code is absent.
- Jobs targets contain bookmark ID and input version. URLs remain in Catalog.
- The module map approves `BookmarkCatalog.getBookmark` and the Health handler boundary.
- Selected plan: `docs/plans/active/first-health-handler.md`.

## Rolling queue

### H1 — Catalog bookmark lookup migration

Goal: add `getBookmark` and `loadBookmark` with exact link-or-null outcomes and migrate every existing structural implementor in one Catalog-owned slice.

Behavior: typed consumers can request a globally unique local bookmark ID without loading or scanning snapshots.

Evidence: Catalog public contract; SQLite `catalog_nodes.id` primary key; first-handler capability brief.

Files: Catalog public contract and service; SQLite Catalog store; Catalog contract/service/SQLite tests; structural Catalog/store fakes in Processing, Orchestrator, and performance tests. No Jobs, Health, CLI, schema, or dependency changes.

Boundary: Catalog owns record identity and lookup. Folder IDs and missing IDs both return null; storage diagnostics remain opaque.

Tests: exact public types, service forwarding, link lookup, folder/missing null, reopen, closed storage, exact dates/URL, unchanged runtime exports.

Red/green: focused contract/service/SQLite tests fail before lookup exists and pass after every current implementor migrates.

Acceptance: public types match the module map, SQLite uses the indexed node ID, no schema changes, and the repository returns to green within this atomic contract slice.

Complexity: L. Executor: planner-grade because this changes a public contract and its structural implementors; the handler remains outside the slice.

### H2 — minimal Health checker contract

Goal: restore only the executable Health types required by the first handler.

Behavior: a `HealthChecker` accepts bookmark ID, input version, and URL and returns a committed observation reference or a typed failure with retry disposition.

Evidence: first-handler capability brief; deleted Health target in the module map; Jobs result/failure contracts.

Files: new `modules/health/public.ts`, Health contract/type tests. No checker implementation, transport, repository, handler, or Jobs changes.

Boundary: a successful checker result guarantees durable commit. The contract carries typed fields and never derives meaning from diagnostics.

Tests: exact request/result/failure shapes, negative assignments, zero runtime exports until an implementation exists.

Red/green: typecheck fails while Health types are absent and passes after the caller-sized contract lands.

Acceptance: the surface contains only fields required by the handler and future durable checker.

Complexity: S. Executor: planner-grade because this restores a public contract.

### H3 — first real `health_check` handler

Goal: implement a Jobs handler that resolves one bookmark through Catalog, calls `HealthChecker`, and returns the committed observation ID.

Behavior: `handle` passes the lease bookmark ID and input version unchanged, obtains the URL only through `getBookmark`, calls the checker once, and returns `{kind: "health_observation", id}`. Missing bookmarks are terminal. Storage and retry Health failures remain retry failures.

Evidence: H1–H2 contracts; `modules/jobs/public.ts`; `modules/jobs/job-worker-service.ts`; `health_check_v1` budget.

Files likely to touch: new `modules/health/health-check-job-handler.ts`, Health public runtime export, focused handler tests. No Jobs, Catalog, SQLite, transport, repository, schema, CLI, or Processing changes.

Boundary: Health owns the adapter. Catalog owns URLs. Jobs owns leases and terminal reporting. The handler may pass typed diagnostics through unchanged but may not parse them.

Invariants: exact lease target reaches Health; checker success already means durable commit; one handler call performs at most one lookup and one check; no retry loop; no URL enters Jobs.

Tests: success, missing bookmark, Catalog storage failure, checker retry/terminal failure, thrown dependencies, exact ID/inputVersion/URL forwarding, wrong lease type rejection, no diagnostic parsing.

Red/green: tests fail before the handler factory and pass after one bounded adapter lands.

Acceptance: the existing Jobs worker routes the handler in a fake integration test; no production network claim or runtime registration.

Complexity: M. Executor: standard after H1–H2 are complete.

## Rough backlog

- Bounded deterministic Health checker and safe transport, using one attempt and five redirects to match `health_check_v1`.
- Durable Health repository and SQLite storage before runtime handler registration.
- Start-processing command after the registered handler can execute one real job.

## Sequencing risks

- Keep H1 and H2 as isolated public contract slices.
- Do not add snapshot IDs or URLs to Jobs targets.
- Do not register H3 until checker limits and durable repository match the preview profile.
- A fake checker proves handler wiring only. It is enabling evidence.

## Next executable Slice Packet

Slice Packet: H1 — Catalog bookmark lookup migration

Goal:
Add the narrow Catalog bookmark-ID lookup required by the first Health handler and migrate all current structural implementors atomically.

Behavior change:
`BookmarkCatalog.getBookmark` and `CatalogSnapshotStore.loadBookmark` return one `BookmarkLinkRecord` or null through the existing typed storage outcome.

Source evidence:
- `docs/architecture/module-map.md` Catalog and first-handler capability briefs.
- `modules/catalog/public.ts` current Catalog/store contracts.
- `adapters/sqlite/catalog-schema.ts` globally unique `catalog_nodes.id` primary key.
- `modules/jobs/public.ts` bookmark job target.

Relevant instruction files:
- User-provided `AGENTS.md`.
- `docs/architecture/module-map.md`.
- `docs/plans/active/first-health-handler.md`.

Project constraints activated:
- Public contract changes own their slice.
- Catalog retains identity and URL ownership.
- The contract slice includes required service store and fake migrations so the repository returns to green.

Files likely to touch:
- `modules/catalog/public.ts`
- `modules/catalog/catalog-service.ts`
- `adapters/sqlite/catalog-snapshot-store.ts`
- `tests/contract/catalog-types.typecheck.ts`
- `tests/integration/catalog-service.test.ts`
- `tests/integration/catalog-sqlite.test.ts`
- Structural Catalog/store fakes identified by `rg` in Processing Orchestrator and performance tests

Files likely not to touch:
- Jobs Health CLI schemas dependencies private export

Contract/boundary affected:
- Additive Catalog reader and store-port methods already approved in the module map; all current implementors migrate in this slice.

Owning module:
- Catalog.

Executor tier:
- planner-grade — public contract migration consumed by later service and handler slices.

Ownership and domain-rule analysis:

- Ownership boundary involved:
  - Catalog owns local bookmark identity and stored URL records.
- Structured contract or source of truth involved:
  - `BookmarkLinkRecord`, `BookmarkId`, and `CatalogStorageFailure`.
- Local behavior allowed:
  - Define exact link-or-null signatures, forward through Catalog, query the indexed node ID in SQLite, and update structural fakes.
- Local behavior explicitly forbidden:
  - Expose SQL, scan snapshots in consumers, reinterpret storage diagnostics, change identity rules, or begin Health work.

Invariants:
- Existing import and snapshot reads remain behavior-compatible.
- Runtime factory exports stay unchanged.
- A folder or missing ID is represented by null at this narrow reader.

Tests:
- Add exact positive and negative contract assignments.
- Prove service forwarding and SQLite link folder missing reopen and closed-storage behavior.
- Update every structural fake with a deliberate lookup implementation.
- Run focused Catalog tests strict typecheck and the full suite.

Red/green expectation:
- Old focused tests fail because lookup methods are absent.
- New tests pass after contract service SQLite and current fakes migrate together.

Telemetry/evidence:
- Focused Catalog contract/service/SQLite output plus typecheck.

Non-goals:
- Health handler schema changes or runtime wiring.

Acceptance criteria:
- Signatures and runtime behavior match the module map exactly.
- Lookup uses `catalog_nodes.id` and does not reconstruct or scan snapshots.
- Focused tests typecheck full suite and diff checks pass.

Risks:
- Structural interface migration touches several fakes; keep edits mechanical and do not expand their behavior.

Estimated complexity:
L

Dependencies:
- Preview complete and first-handler architecture contract approved.
