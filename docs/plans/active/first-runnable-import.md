# First runnable import

Status: active
Created: 2026-07-14
Refresh: handed off after S4; refresh next after S5 or new evidence

## Overview

Deliver one supported local command that imports a Chrome HTML export into SQLite and prints a stable JSON summary. This plan turns the already-tested parser–Catalog–SQLite path into a real application without adding another product capability.

## Current planning state

- Brownfield repository with working Chrome HTML, Catalog, SQLite, and 10,000-node test implementations.
- Selected active plan: `docs/plans/active/first-runnable-import.md`.
- Scope lock: this plan alone owns the first runnable command. Completed recovery plans remain unchanged.
- Current baseline: 102 tests and strict typecheck pass; Catalog and Chrome HTML expose exact runtime entries; SQLite exposes an opaque migrated Catalog session; the Orchestrator exposes the tested parse-then-import application; `package.json` has no runtime command or composition root.
- Architecture source: `docs/architecture/module-map.md`, capability brief dated 2026-07-14.
- Command contract: `npm run import -- --input <bookmarks.html> --database <bookmarks.sqlite>`.
- Major uncertainty: all application boundaries are proven independently. The remaining risk is composing file, database, clock, output, and close behavior into one deterministic subprocess contract.

## Completed

- S1 exposed exactly `createBookmarkCatalog` and `createCryptoCatalogIdFactory` through Catalog `public.ts`; focused tests, strict typecheck, and all 97 tests passed.
- S2 exposed exactly `parseBookmarksHtml` through Chrome HTML `public.ts`; parser semantics remained unchanged and all 97 tests passed.
- S3 added `openCatalogDatabase`; real-file tests proved migrate/save/load/double-close/reopen and fixed unavailable outcomes, with all 99 tests passing.
- S4 added `createBookmarkCleanApp`; fake-based tests proved parse short-circuiting, order, staged failure ownership, and exact snapshot/failure/summary references, with all 102 tests passing.

## Rolling queue

### S5 — ship the local import command

Goal: compose the public runtime surfaces into the first supported process command.

Source evidence: S1–S4; package has no runtime script; module-map CLI contract; retained minimal Chrome fixture and 10,000-node proof.

Behavior change: the documented npm command imports a file into a persistent database, prints one JSON summary, closes storage, and returns fixed exit codes for bounded failures.

Relevant instruction files: user-provided `AGENTS.md`; module map; refreshed plan.

Project constraints activated: CLI is composition only; stable structured output; no exception/diagnostic prose; documentation changes with behavior.

Files likely to touch: new `apps/local-cli/main.ts`, new `apps/local-cli/import-command.ts`, new `tests/integration/local-cli-import.test.ts`, `package.json`, `README.md`.

Files likely not to touch: module/adapters internals, Jobs, PRD, existing performance fixture/generator.

Contract/boundary affected: consumes existing public contracts; adds the user-visible CLI contract only.

Owning module: Local CLI app.

Ownership and domain-rule analysis:

- Ownership boundary involved: CLI owns files/process; orchestrator owns sequencing; adapters/modules own meaning and persistence.
- Structured contract or source of truth involved: module-map command/output/exit-code contract.
- Local behavior allowed: validate arguments, read text, create capture time, wire dependencies, serialize fixed output, close in `finally`.
- Local behavior explicitly forbidden: parse HTML, execute SQL, infer failure meaning, print bookmark content/exception prose, start Jobs, or mutate Chrome.

Invariants: stdout has only success JSON; stderr has only failure JSON; opened session always closes; existing database persists; no output depends on diagnostic text.

Tests: subprocess success with existing fixture; invalid arguments; missing input; invalid database path; typed parser failure; persistent database reopen; exact streams and exit codes; typecheck, 10,000-node proof, full suite.

Red/green expectation: subprocess tests fail because no command exists and pass after composition and package script land.

Telemetry/evidence: command exit code, JSON output, database persistence, focused/full verification recorded in ops ledger.

Risks: subprocess tests become platform-dependent or the CLI leaks unexpected errors.

Non-goals: HTTP service, interactive prompts, progress bars, configuration files, packaging, Chrome API, Jobs, Health, enrichment, search, UI.

Acceptance criteria: README command works from a clean checkout with Node 26 and installed dependencies; all bounded outcomes match the contract; full verification passes.

Estimated complexity: M.

Dependencies: S1–S4.

Executor tier: standard — multi-boundary composition with fixed contracts and end-to-end tests.

## Rough backlog notes

- Real Chrome export acceptance: add a sanitized representative fixture before claiming broad Chrome compatibility; trigger after the synthetic CLI path works.
- Local HTTP service: reuse Orchestrator and SQLite session after the CLI proves lifecycle and failure contracts; transport/auth design remains open.
- Chrome API connector: slice only after a local service boundary exists; native messaging versus paired loopback remains provisional.
- Selected-folder Jobs execution: slice when Catalog exposes an explicit scoped read/reconciliation contract and a real handler exists.
- Enrichment/search/UI: remain outside the horizon until the import command gives the repository a runnable base.

## Sequencing risks

- Runtime exports must not turn `public.ts` into a path that exposes internals or creates cycles. S1 establishes the pattern before S2.
- SQLite lifecycle must be opaque before the CLI exists; otherwise composition will normalize direct raw-database access.
- Staged Orchestrator failures preserve semantic ownership. Flattening them would invite downstream interpretation.
- The manually enumerated `npm test` command must include every new executable test.
- The queue intentionally combines each new contract with its provider because there are no existing consumers to migrate. The CLI remains a later consumer-only slice.
- S5 is the sole remaining delivery slice; refresh after its subprocess evidence or any contract mismatch.

## Refresh trigger

Refresh after S5 or when implementation evidence invalidates the command contract. Remove the completed packet when the plan closes.

## Next executable Slice Packet

Slice Packet: S5 — ship the local import command

Goal:
Compose the four proven public runtime boundaries into the first supported process command.

Behavior change:
`npm run import -- --input <bookmarks.html> --database <bookmarks.sqlite>` reads one export, imports it into persistent SQLite, emits one stable JSON line, closes storage, and exits with the documented code.

Source evidence:
- `modules/catalog/public.ts`, `adapters/chrome-html/public.ts`, `adapters/sqlite/public.ts`, and `core/orchestrator/public.ts` expose the complete runtime composition surface.
- `tests/fixtures/chrome-bookmarks/minimal.html` is the retained deterministic acceptance fixture.
- `tests/performance/import-10k.test.ts` proves the same provider path at scale.
- `docs/architecture/module-map.md` defines exact command, stream, output-field, and exit-code ownership.

Relevant instruction files:
- User-provided `AGENTS.md` rules in the task context.
- `docs/architecture/module-map.md`.
- `docs/plans/active/first-runnable-import.md`.

Project constraints activated:
- The CLI is the sole composition root and owns only process/filesystem/clock concerns.
- Every semantic and persistence action goes through a public runtime entry point.
- Stable structured output must not depend on exception or diagnostic prose.

Files likely to touch:
- New `apps/local-cli/main.ts`
- New `apps/local-cli/import-command.ts`
- New `tests/integration/local-cli-import.test.ts`
- `package.json`
- `README.md`

Files likely not to touch:
- Catalog, Chrome HTML, SQLite, Orchestrator, Jobs, fixtures, dependencies, and unrelated tests

Contract/boundary affected:
- New user-visible local CLI contract; all production dependencies are existing public contracts.

Owning module (from the module map, if the project has one):
- Local CLI app.

Executor tier:
- Standard — fixed multi-boundary composition with subprocess acceptance tests.

Ownership and domain-rule analysis:

- Ownership boundary involved:
  - CLI owns arguments, file reads, timestamp capture, wiring, streams, lifecycle, and exit code; other modules retain all domain meaning.
- Structured contract or source of truth involved:
  - Module-map command/output/exit-code contract and the four implemented public runtime surfaces.
- Local behavior allowed:
  - Validate exact arguments, read UTF-8 text, capture one ISO time, open the Catalog session, build injected services, call the application once, serialize fixed fields, and close in `finally`.
- Local behavior explicitly forbidden:
  - Parse HTML, validate or repair snapshots, allocate IDs outside the public factory, execute SQL, inspect diagnostics or exception messages, print bookmark content, start Jobs, or mutate Chrome.

Invariants:
- Stdout contains exactly one success JSON line and no other text.
- Stderr contains exactly one failure JSON line and no other text.
- Exit codes remain `0` success, `2` invalid arguments, `3` input unavailable, `4` storage unavailable, `5` typed import rejection, and `1` unexpected failure.
- Every opened database session closes once through `finally`, including typed and unexpected failures.
- Reusing a database path preserves the imported snapshot.
- Output fields come only from typed contracts; diagnostics and exception prose never escape.

Tests:
- Add subprocess red/green cases for success, invalid arguments, missing input, unavailable database, and typed parser rejection.
- Assert exact stdout, stderr, and exit codes; reopen the database through the public session to prove persistence.
- Use the existing fixture and temporary-file helper; avoid platform-specific absolute failure paths.
- Run the focused subprocess test, `npm run typecheck`, the 10,000-node proof, `npm test`, and `git diff --check`.

Red/green expectation:
- Old behavior fails because no import script or CLI entry exists.
- New behavior passes after the thin composition root and documented command land.

Telemetry/evidence:
- Subprocess exit/stream assertions, public database reopen result, focused/full verification, and ops-ledger rows.

Non-goals:
- HTTP service, interactive prompts, progress UI, configuration files, packaging, Chrome API, Jobs, Health, enrichment, search, or UI.

Acceptance criteria:
- The README command works from a clean checkout with Node 26 and installed dependencies.
- All bounded outcomes match the module-map contract exactly.
- Production code imports no provider internals and contains no domain interpretation.
- The slice touches at most the five listed files.
- Focused subprocess tests, strict typecheck, scale proof, full suite, and diff check pass.
- Work and verification are recorded in the existing ops ledgers and this plan can close.

Risks:
- Subprocess behavior can become platform-dependent; fixtures, temporary directories, and fixed JSON assertions must keep it deterministic.

Estimated complexity:
M

Dependencies:
- S1–S4 completed; all required public runtime entries and their focused contracts are green.
