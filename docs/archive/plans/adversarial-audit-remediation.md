# Adversarial audit remediation

Status: completed 2026-07-16

This brownfield plan repairs the correctness, security, verification, and ownership gaps found by the 2026-07-15 adversarial audit. It preserves the current microkernel/module shape. Work is ordered so bounded network behavior and local-data privacy land first, the production compiler gate becomes trustworthy next, and domain-boundary repairs follow on a green baseline.

## Current planning state

- **Greenfield or brownfield:** Brownfield.
- **Selected active plan document:** `docs/plans/active/adversarial-audit-remediation.md`.
- **Scope lock decision:** This is the only plan maintained by this planning run. Existing completed files under `docs/plans/active/` were inspected because the user requested a project-wide adversarial review, but they are not rewritten here.
- **Recent implementation facts considered:** The original ten slices and corrective Slices 11–12 are complete. A fresh 2026-07-16 follow-up reproduced `RangeError: Maximum call stack size exceeded` through `CatalogInspector` at 4,000 nested folders, confirmed that TypeScript import-equals syntax produces zero boundary-gate specifiers, and found eight repaired risks plus eight completed plans still recorded as active. The aggregate gate passes 211 tests across 54 discovered files when loopback listener access is allowed.
- **Major uncertainties:** Windows behavior for SQLite permission hardening remains outside the claimed guarantee. The bounded-tree contract is now fixed in the module map at 20,000 semantic nodes, depth 256, and 16 MiB of UTF-8 Chrome HTML. No remaining slice needs user input.
- **Implementation progress:** Slices 1–20 are complete. No remediation slice remains.
- **Latest checkpoint:** The completed-work audit of Slices 16–18 passed without a corrective finding. Catalog, Chrome HTML/CLI, and SQLite use the same public limits, preserve depth-first order, and reject before forbidden downstream work. The final two packets remain valid.
- **Latest checkpoint:** The completed-work audit of Slices 13–15 passed without a corrective finding. Queue refresh found one implementation-shape clarification: same-module implementations use private backing values for public runtime constants instead of importing their own `public.ts` entry point. If one node exceeds both structural limits, depth is checked first.

## Completed remediation summary

Slices 1–12 are complete. They established one absolute Health deadline, fail-closed IPv6 target approval, POSIX SQLite mode `0600`, full-source typechecking, deterministic test discovery, AST module-boundary enforcement, structured DNS/TLS classification, complete Health repository validation, Catalog-owned inspection projection, and exact requested-URL identity after save.

Primary evidence: TDD-054 through TDD-065, W-098 through W-113, and VER-540 through VER-615 in `docs/ops/`. The approved aggregate run passed 211 tests across 54 files.

## Verified follow-up findings

- **Deep-input stack exhaustion confirmed:** `modules/catalog/catalog-inspector.ts` and `apps/local-cli/inspect-command.ts` recurse once per folder. A direct 4,000-folder `CatalogInspector` probe returned `RangeError: Maximum call stack size exceeded`. `VER-535` retains the earlier parser failure at the same scale. The parser, Catalog validator and constructor, SQLite save/load reconstruction, and Processing selection also contain recursive tree walks.
- **Project-memory drift confirmed:** RISK-007 through RISK-013 and RISK-015 still say `open` despite completed TDD and verification rows. Eight other plan files under `docs/plans/active/` declare themselves complete. RISK-002 describes a spike removed by the recovery work, and ADR 0008 predates the current production transport fixtures.
- **Boundary-gate blind spot confirmed:** the current AST probe detects ordinary imports, exports, import types, dynamic imports, and `require()` calls. It returns `[]` for `import Internal = require("../../modules/catalog/catalog-service.js")` even though TypeScript parses an `ImportEqualsDeclaration`.
- **Healthy baseline:** the focused boundary and Catalog-inspector tests pass. `npm run check` passes all 211 tests across 54 files when the known loopback suites receive listener permission. The first restricted run failed only with the recorded `EPERM` condition.

## Remaining remediation queue: 5 ready slices

### Slice 13 — Reconcile completed plans, risks, and superseded evidence (completed 2026-07-16)

1. **Slice name:** Reconcile completed plans, risks, and superseded evidence.
2. **Goal:** Make project memory match the implemented state without deleting dated evidence.
3. **Source evidence:** `docs/ops/risks.csv` leaves RISK-007–RISK-013 and RISK-015 open; RISK-002 describes removed spike files; RISK-016 names this drift. Eight plans other than this one declare completion under `docs/plans/active/`. ADR 0008 says its loopback fixture was removed and its evidence excludes production DNS/TLS/timeout behavior that current tests now cover.
4. **User-visible or system-visible behavior change:** Agents see only live work under `docs/plans/active/`, repaired risks are closed with dated notes, and historical ADR claims point to their current replacement evidence.
5. **Relevant instruction files:** User-provided global `AGENTS.md`; `docs/architecture/module-map.md`; this plan; the `ops-ledger` stateful-row rules.
6. **Project constraints activated:** Preserve history; update only `status`, `closed_at`, and `notes` on existing risk rows; archive completed plans as files; keep this remediation plan active; validate every CSV field count and local Markdown link.
7. **Files likely to touch:** `docs/ops/risks.csv`; `docs/decisions/0008-health-transport-fixtures.md`; the eight completed files now under `docs/plans/active/`; new `docs/archive/plans/`; `docs/ops/work-items.csv` and `docs/ops/verification.csv` for execution evidence.
8. **Files likely not to touch:** Runtime code; tests; package configuration; `docs/architecture/module-map.md`; this plan’s completed slice history.
9. **Contract/boundary affected:** Repository-memory and audit-evidence boundary only; no executable contract.
10. **Ownership and domain-rule analysis:** The ops ledgers own current state, ADRs own dated decisions, and plan location owns active versus historical work. The slice may close or supersede records with evidence. It may not rewrite old observations, delete plan history, close RISK-014, or claim checks that were not run.
11. **Invariants that must remain true:** RISK-014 stays open; RISK-006 remains accurate about listener permission; all eight archived plans retain their content and working relative links; this file remains the sole active remediation plan.
12. **Tests to add or update:** None. Verify active/archive inventory, risk statuses and dates, RFC-4180 field counts, local links, and `git diff --check`.
13. **Red/green TDD expectation:** Not applicable; this is documentation and state reconciliation. Before evidence is the stale inventory and risk statuses; after evidence is the corrected inventory plus schema/link validation.
14. **Telemetry/logging/trace evidence if relevant:** Append the executed validation commands to `docs/ops/verification.csv` and record the work item’s completion.
15. **Risks:** Moving files can break relative links; updating descriptive risk fields would violate ledger history; broad prose cleanup could erase the context future reviewers need.
16. **Explicit non-goals:** Closing RISK-014, editing runtime behavior, refreshing every ADR, changing open product risks, or rewriting archived plans for current wording.
17. **Acceptance criteria:** RISK-002, RISK-007–RISK-013, RISK-015, and RISK-016 are closed on 2026-07-16 with evidence notes; RISK-014 remains open; the eight completed plans move to `docs/archive/plans/`; ADR 0008 carries a dated supersession note; CSV and link checks pass.
18. **Estimated complexity:** S.
19. **Dependencies on previous slices:** Slices 1–12 and their verification rows.
20. **Executor tier:** standard — the edits are mechanical, but append-only history and cross-document links need judgment.

### Slice 14 — Detect TypeScript import-equals boundary bypasses (completed 2026-07-16)

1. **Slice name:** Detect TypeScript import-equals boundary bypasses.
2. **Goal:** Enroll `ImportEqualsDeclaration` module references in the existing production boundary gate.
3. **Source evidence:** `tests/contract/module-boundaries.contract.test.ts::staticSpecifiers` has no import-equals branch; a direct TypeScript AST probe reports `importEquals: true` and `detected: []` for the forbidden Catalog internal import.
4. **User-visible or system-visible behavior change:** A production file cannot bypass public module surfaces with `import Alias = require("...")` syntax.
5. **Relevant instruction files:** User-provided global `AGENTS.md`; `docs/architecture/module-map.md`; this plan.
6. **Project constraints activated:** The boundary test remains TypeScript-AST-based; only relative module paths enter the existing ownership check; tests may inspect internals, production may not.
7. **Files likely to touch:** `tests/contract/module-boundaries.contract.test.ts`; `docs/ops/tdd-checkpoints.csv`, `docs/ops/work-items.csv`, and `docs/ops/verification.csv` after implementation.
8. **Files likely not to touch:** Production modules; package scripts; test discovery; public contracts; module map.
9. **Contract/boundary affected:** Static enforcement of the existing public-module import rule; no contract shape changes.
10. **Ownership and domain-rule analysis:** Ownership boundary: each module exposes only `public.ts`. The gate may extract a literal external module reference from import-equals syntax. It must not treat qualified entity-name aliases or non-literal external references as inferred paths.
11. **Invariants that must remain true:** Ordinary imports/exports, import types, dynamic imports, and `require()` remain detected; same-module, public-surface, and test-only imports remain allowed; traversal remains deterministic.
12. **Tests to add or update:** Add an in-test negative fixture using `import Internal = require("../../modules/catalog/catalog-service.js")`; assert extraction and the existing violation message. Add a public-surface import-equals control.
13. **Red/green TDD expectation:** Red: the new forbidden fixture yields no specifier. Green: it yields one violation while the public control remains allowed.
14. **Telemetry/logging/trace evidence if relevant:** Focused test output and the aggregate gate; no runtime logging.
15. **Risks:** Reading the wrong AST property or double-counting syntax already represented as a call expression.
16. **Explicit non-goals:** Bare package policy, path aliases, JavaScript parsing, lint migration, or new module boundaries.
17. **Acceptance criteria:** The reproduced bypass fails under the gate, the public control passes, existing boundary and discovery tests pass, and `npm run check` stays green.
18. **Estimated complexity:** XS.
19. **Dependencies on previous slices:** None; it may run after Slice 13 or independently.
20. **Executor tier:** cheap — one test file, fixed AST shape, and exact expected behavior.

### Slice 15 — Publish bounded bookmark-tree contracts (completed 2026-07-16)

1. **Slice name:** Publish bounded bookmark-tree contracts.
2. **Goal:** Implement the already-approved Catalog and Chrome HTML resource-limit types, constants, and typed failures before any producer or consumer changes behavior.
3. **Source evidence:** The module map’s bounded-bookmark-tree capability fixes 20,000 semantic nodes, depth 256, and 16,777,216 UTF-8 bytes. Current public contracts expose none of these values or failure codes.
4. **User-visible or system-visible behavior change:** No runtime rejection changes yet. Consumers can compile against one exact structural policy and one source-byte policy.
5. **Relevant instruction files:** User-provided global `AGENTS.md`; `docs/architecture/module-map.md`; this plan.
6. **Project constraints activated:** Public contract changes remain isolated; Catalog authors structural limits; Chrome HTML authors its byte cap and source failures; no implementation enters this slice.
7. **Files likely to touch:** `modules/catalog/public.ts`; `adapters/chrome-html/public.ts`; `tests/contract/catalog-types.typecheck.ts`; `tests/contract/catalog-snapshot.contract.test.ts`; `tests/contract/chrome-html-types.typecheck.ts`; `tests/contract/chrome-html.contract.test.ts`.
8. **Files likely not to touch:** Catalog/parser implementations; SQLite; Processing; CLI; package configuration; module map.
9. **Contract/boundary affected:** Additive Catalog and Chrome HTML public contracts as specified in the module map.
10. **Ownership and domain-rule analysis:** Catalog owns semantic node/depth meaning. Chrome HTML owns UTF-8 source size and translates the structural failures at its own source boundary. Local code may compare measured integers to the fixed constants. It may not guess alternative limits or infer failures from exceptions.
11. **Invariants that must remain true:** Existing success types and runtime factories remain compatible; existing failure values remain unchanged; the constants are exact immutable runtime exports.
12. **Tests to add or update:** Exact type assertions for constants and new failure unions; exact runtime-export assertions updated to allow only the approved constants plus current factories.
13. **Red/green TDD expectation:** Red: type assertions and runtime export checks fail because the symbols do not exist. Green: exact approved shapes compile and no unapproved export appears.
14. **Telemetry/logging/trace evidence if relevant:** Compiler and runtime export evidence; no logging.
15. **Risks:** Accidentally combining contract and enforcement or widening the module runtime surface beyond the two constants.
16. **Explicit non-goals:** Enforcing limits, iterative traversal, configurable profiles, CLI output changes, or stored-data handling.
17. **Acceptance criteria:** Both public constants and all typed failure codes match the module map; contract tests and typecheck pass; runtime implementation files are unchanged.
18. **Estimated complexity:** S.
19. **Dependencies on previous slices:** Architecture contract recorded by this planning run.
20. **Executor tier:** planner-grade — this changes two public contracts and fixes the source of truth for five later slices.

### Slice 16 — Enforce Catalog structural limits without recursion (completed 2026-07-16)

1. **Slice name:** Enforce Catalog structural limits without recursion.
2. **Goal:** Make Catalog validation and immutable record construction iterative, with deterministic node/depth rejection before ID allocation or storage.
3. **Source evidence:** `modules/catalog/validate-snapshot.ts::validateNode` and `modules/catalog/catalog-service.ts::buildRecord` recurse through every folder; Catalog currently has no resource checks.
4. **User-visible or system-visible behavior change:** Inputs above 20,000 nodes or depth 256 return the new typed Catalog failure. Accepted inputs keep the same IDs, order, counts, and stored shape.
5. **Relevant instruction files:** User-provided global `AGENTS.md`; `docs/architecture/module-map.md`; this plan.
6. **Project constraints activated:** Catalog is the receiving-boundary authority; validation completes before IDs or storage; first failure stays depth-first; cycle and duplicate-source detection remain exact; use explicit work stacks.
7. **Files likely to touch:** `modules/catalog/catalog-resource-limits.ts`; `modules/catalog/public.ts` only to wire the same private runtime value to the existing public export; `modules/catalog/validate-snapshot.ts`; `modules/catalog/catalog-service.ts`; `tests/contract/catalog-snapshot.contract.test.ts`; `tests/integration/catalog-service.test.ts`.
8. **Files likely not to touch:** Chrome parser; SQLite; Processing; CLI; Catalog public type shape; schemas.
9. **Contract/boundary affected:** Implementation of the Slice 15 Catalog resource contract.
10. **Ownership and domain-rule analysis:** Catalog alone decides whether a semantic tree meets its public structural policy. It may validate, count, and reject. It may not truncate, partially allocate IDs, call storage after rejection, or reinterpret source content.
11. **Invariants that must remain true:** Root and sibling order; depth-first ID request order; immutable fresh records; path accuracy; active-cycle detection; repeated non-active objects remain allowed as today; exact empty input behavior.
12. **Tests to add or update:** Boundary cases at depth 256/257 and nodes 20,000/20,001; exact depth-first precedence with depth winning when one node violates both limits; dependency call counts on rejection; existing cycle, duplicate, order, count, and 10,000-node tests.
13. **Red/green TDD expectation:** Red: over-limit inputs recurse or continue to dependencies. Green: they return the exact typed failure and accepted boundary inputs retain current output.
14. **Telemetry/logging/trace evidence if relevant:** Focused tests assert ID/store call counts; no runtime logging.
15. **Risks:** Reversing sibling order with a LIFO stack, changing first-failure precedence, or allocating IDs before validation completes.
16. **Explicit non-goals:** Chrome byte limits, SQLite corruption handling, inspection, Processing, or public contract edits.
17. **Acceptance criteria:** No Catalog tree walk calls itself; exact boundary tests pass; rejected input has zero ID/store calls; existing Catalog and 10,000-node integration evidence passes.
18. **Estimated complexity:** M.
19. **Dependencies on previous slices:** Slice 15.
20. **Executor tier:** standard — two cohesive Catalog internals change under exact contract and ordering tests.

### Slice 17 — Bound Chrome HTML before parse and during translation (completed 2026-07-16)

1. **Slice name:** Bound Chrome HTML before parse and during translation.
2. **Goal:** Reject oversized files before full CLI materialization, reject oversized strings before `parse5`, and translate accepted DOM trees with iterative traversal under Catalog’s limits.
3. **Source evidence:** `apps/local-cli/import-command.ts` calls unbounded `readFileSync`; `adapters/chrome-html/parse-bookmarks-html.ts` passes any non-empty string to `parse5` and recursively implements root search, text collection, and semantic list parsing.
4. **User-visible or system-visible behavior change:** Oversized input returns exit 5 with `import_failed`, source stage, `input_too_large`, and field `html`. Over-depth or over-node HTML returns its matching source failure. Valid output stays unchanged.
5. **Relevant instruction files:** User-provided global `AGENTS.md`; `docs/architecture/module-map.md`; this plan.
6. **Project constraints activated:** CLI owns file I/O and consumes the adapter-authored byte constant; Chrome HTML authors source failures; Catalog limits cannot be widened; no exception prose supplies meaning.
7. **Files likely to touch:** `adapters/chrome-html/chrome-html-resource-limits.ts`; `adapters/chrome-html/public.ts` only to wire the same private runtime value to the existing public export; `apps/local-cli/import-command.ts`; `adapters/chrome-html/parse-bookmarks-html.ts`; `tests/integration/local-cli-import.test.ts`; `tests/integration/chrome-html-import.test.ts`; one small CLI-owned bounded reader helper only if needed to keep the command cohesive.
8. **Files likely not to touch:** Catalog implementation; SQLite; Processing; inspect command; Chrome HTML public type shape; schemas; package scripts.
9. **Contract/boundary affected:** Implementation of Slice 15’s Chrome HTML and Catalog structural contracts; existing CLI result shape.
10. **Ownership and domain-rule analysis:** The CLI may read at most limit plus one byte and reject a measured overflow. The adapter independently measures UTF-8 bytes before `parse5`, counts semantic nodes/depth, and returns its authored failures. Neither owner may truncate bytes or repair HTML meaning.
11. **Invariants that must remain true:** Existing parser recovery rules, path/source-ID encoding, timestamps, text order, sibling order, no file access inside the adapter, and no database open after early source rejection.
12. **Tests to add or update:** Byte limit and limit-plus-one for parser and CLI; depth 256/257; nodes 20,000/20,001; very deep non-semantic DOM/text traversal; current fixture mapping and typed CLI parser rejection.
13. **Red/green TDD expectation:** Red: oversized files are fully read or parsed, and deep semantic HTML can exhaust the stack. Green: exact structured failures occur before the forbidden dependency and accepted boundaries remain byte-compatible.
14. **Telemetry/logging/trace evidence if relevant:** Tests assert `parse5`/database are not reached on byte rejection where injection allows; no runtime logging.
15. **Risks:** UTF-8 byte measurement can differ from string length; iterative DOM traversal can reverse text or sibling order; a pre-read stat alone leaves a file-growth race.
16. **Explicit non-goals:** Streaming HTML parsing, partial imports, configurable limits, Chrome API changes, or Catalog enforcement.
17. **Acceptance criteria:** CLI reads at most 16,777,217 bytes; parser checks bytes before `parse5`; no adapter tree walk calls itself; all limit-edge, fixture, subprocess, typecheck, and 10,000-node tests pass.
18. **Estimated complexity:** M.
19. **Dependencies on previous slices:** Slices 15 and 16.
20. **Executor tier:** standard — this crosses a source adapter and its CLI file boundary with ordering and allocation concerns.

### Slice 18 — Reject over-budget stored trees without recursive persistence (completed 2026-07-16)

1. **Slice name:** Reject over-budget stored trees without recursive persistence.
2. **Goal:** Make SQLite Catalog save and reconstruction iterative, and reject stored graphs beyond Catalog’s node/depth contract as `stored_snapshot_invalid` before returning them.
3. **Source evidence:** `adapters/sqlite/catalog-snapshot-store.ts::insertNode` and `adapters/sqlite/catalog-snapshot-reconstruction.ts::assembleRecord` recurse once per folder. Reconstruction validates counts and cycles but not the public resource policy.
4. **User-visible or system-visible behavior change:** Corrupt or externally authored over-budget snapshots fail as `stored_snapshot_invalid`; accepted snapshots save/load with the same rows and hierarchy.
5. **Relevant instruction files:** User-provided global `AGENTS.md`; `docs/architecture/module-map.md`; this plan.
6. **Project constraints activated:** SQLite owns mechanics and receiving validation for rows; Catalog owns limit meaning through its public constant; no schema change; save remains atomic; stored corruption is never repaired.
7. **Files likely to touch:** `adapters/sqlite/catalog-snapshot-store.ts`; `adapters/sqlite/catalog-snapshot-reconstruction.ts`; `tests/integration/catalog-sqlite.test.ts`; `tests/integration/catalog-database.test.ts` only if public opener coverage is needed.
8. **Files likely not to touch:** Catalog service/public types; Chrome parser; Processing; CLI; migrations/schema.
9. **Contract/boundary affected:** Existing `CatalogSnapshotStore` implementation and `stored_snapshot_invalid` read behavior.
10. **Ownership and domain-rule analysis:** SQLite may validate row structure, count, graph topology, and public resource bounds. It may not select new semantic limits, truncate nodes, repair counts, or return a partial snapshot.
11. **Invariants that must remain true:** One transaction per save; exact parent/sibling ordering; duplicate/cycle/orphan rejection; fresh containers on load; bookmark lookup behavior; rollback on engine failure.
12. **Tests to add or update:** Stored row sets at node/depth boundaries and just beyond; deep save/load without recursion; order and rollback controls; existing corruption and reopen tests.
13. **Red/green TDD expectation:** Red: an over-depth stored graph reaches recursive assembly and may overflow. Green: it returns `stored_snapshot_invalid`; accepted boundary data round-trips exactly.
14. **Telemetry/logging/trace evidence if relevant:** SQLite row counts and typed outcomes in tests; no runtime logging.
15. **Risks:** Iterative post-order assembly can attach children out of order; early rejection inside a transaction can leave it open; direct invalid save inputs are contract violations and must not gain a new public meaning.
16. **Explicit non-goals:** Schema indexes, query optimization, migration changes, encryption, or direct SQL inspection projection.
17. **Acceptance criteria:** Save and reconstruction have no self-recursive tree functions; over-budget stored data returns `stored_snapshot_invalid`; transaction, corruption, 10,000-node, and aggregate tests pass.
18. **Estimated complexity:** M.
19. **Dependencies on previous slices:** Slices 15 and 16.
20. **Executor tier:** standard — persistence topology and transaction behavior require careful tests, but no public contract changes.

### Slice 19 — Make inspection projection and CLI formatting stack-safe (completed 2026-07-16)

1. **Slice name:** Make inspection projection and CLI formatting stack-safe.
2. **Goal:** Replace the two recursive functions named by the follow-up review with iterative, order-preserving projection and formatting.
3. **Source evidence:** `modules/catalog/catalog-inspector.ts::projectRecords/projectFolder` and `apps/local-cli/inspect-command.ts::formatFolder` recurse per folder; the direct 4,000-folder inspector probe currently throws `RangeError`.
4. **User-visible or system-visible behavior change:** Accepted maximum-depth snapshots inspect successfully with byte-compatible JSON. An over-budget snapshot supplied by a faulty Catalog dependency fails closed as `stored_snapshot_invalid` before formatting.
5. **Relevant instruction files:** User-provided global `AGENTS.md`; `docs/architecture/module-map.md`; this plan.
6. **Project constraints activated:** Catalog owns projection meaning and limit validation; CLI only renames `folders` to `children`; bookmark facts remain private; explicit stacks must preserve source order and descendant counts.
7. **Files likely to touch:** `modules/catalog/catalog-inspector.ts`; `apps/local-cli/inspect-command.ts`; `tests/integration/catalog-inspector.test.ts`; `tests/integration/local-cli-inspect.test.ts`.
8. **Files likely not to touch:** Catalog public types; SQLite; Processing; parser; CLI routing; README.
9. **Contract/boundary affected:** Private implementation of the existing `CatalogInspector` and inspect-command output mapping.
10. **Ownership and domain-rule analysis:** Catalog may validate and project the structured snapshot. CLI may format only the typed projection. Neither may expose URLs, bookmark titles, source IDs, diagnostics, or infer a substitute hierarchy.
11. **Invariants that must remain true:** Folder order; root bookmark omission; descendant bookmark counts; missing/failure pass-through; output keys and exits; one Catalog read; no mutation.
12. **Tests to add or update:** Depth 256 accepted projection; over-limit faulty dependency maps to `stored_snapshot_invalid`; current privacy/order/count cases; subprocess output compatibility; direct regression proving the former 4,000-level call stack is no longer reached.
13. **Red/green TDD expectation:** Red: the 4,000-folder probe throws before a typed result. Green: iterative code rejects it by contract and accepts depth 256 without recursion.
14. **Telemetry/logging/trace evidence if relevant:** Typed probe result and subprocess JSON; no runtime logging.
15. **Risks:** Wrong post-order count accumulation, reversed siblings, or accidental bookmark disclosure while changing work frames.
16. **Explicit non-goals:** SQL-level projection, output redesign, UI work, larger limits, or new public failure codes.
17. **Acceptance criteria:** The named recursive functions are gone; the direct deep probe returns typed `stored_snapshot_invalid`; maximum accepted depth and existing CLI/privacy/downstream workflow tests pass.
18. **Estimated complexity:** M.
19. **Dependencies on previous slices:** Slices 15, 16, and 18.
20. **Executor tier:** standard — two owners change together to close the exact end-to-end inspection defect.

### Slice 20 — Make Processing selection stack-safe and close RISK-014 (completed 2026-07-16)

1. **Slice name:** Make Processing selection stack-safe and close RISK-014.
2. **Goal:** Replace Processing’s recursive folder search and bookmark collection with one bounded iterative traversal, then run final deep-input verification and close the risk.
3. **Source evidence:** `modules/processing/processing-planner.ts::findFolder` and `collectBookmarkIds` recurse over Catalog hierarchy. Preview and enqueue share this path.
4. **User-visible or system-visible behavior change:** Preview and enqueue handle every accepted Catalog tree without call-stack growth; a faulty over-budget snapshot returns existing `snapshot_invalid` and never reaches Jobs.
5. **Relevant instruction files:** User-provided global `AGENTS.md`; `docs/architecture/module-map.md`; this plan; `ops-ledger` rules.
6. **Project constraints activated:** Processing consumes Catalog’s public limit; it preserves depth-first job order and fixed budget arithmetic; no bookmark content enters Jobs; RISK-014 closes only after every preceding owner path and aggregate check passes.
7. **Files likely to touch:** `modules/processing/processing-planner.ts`; `tests/integration/processing-planner.test.ts`; `tests/integration/processing-enqueue-sqlite.test.ts`; `docs/ops/risks.csv`; execution rows in `docs/ops/tdd-checkpoints.csv`, `docs/ops/work-items.csv`, and `docs/ops/verification.csv`.
8. **Files likely not to touch:** Processing public types; Jobs; Catalog implementation; SQLite; parser; CLI output.
9. **Contract/boundary affected:** Private implementation of existing Processing preview/start contracts; RISK-014 state.
10. **Ownership and domain-rule analysis:** Processing may validate a Catalog result against Catalog’s structured limit and author work for a selected folder. It may not reinterpret hierarchy, reorder jobs, leak URLs, or enqueue after invalid input.
11. **Invariants that must remain true:** First matching folder in depth-first order; exact descendant bookmark order; deterministic idempotency/input encodings; preview/start agreement; existing typed failure mappings; no Jobs call on rejection.
12. **Tests to add or update:** Depth 256 preview/start; over-depth faulty Catalog result; 20,000-node boundary where practical without enqueueing all jobs; normal order and idempotency controls; complete import-inspect-preview-enqueue workflow.
13. **Red/green TDD expectation:** Red: deep input reaches recursive search/collection and can overflow. Green: iterative traversal accepts the contract boundary and returns `snapshot_invalid` beyond it before Jobs.
14. **Telemetry/logging/trace evidence if relevant:** Focused traversal and Jobs call-count evidence; final `npm run check`, direct deep probes, `git diff --check`, and offline audit recorded in `verification.csv`.
15. **Risks:** A stack can reverse job order; separate search and collection can count nodes twice; closing RISK-014 before final cross-owner verification would repeat the current memory defect.
16. **Explicit non-goals:** New Processing result codes, parallel enqueue, streaming jobs, profile changes, or higher resource limits.
17. **Acceptance criteria:** No Processing tree walk calls itself; accepted-boundary order and budgets match current behavior; over-budget input returns `snapshot_invalid` with zero Jobs calls; all deep-input probes and the aggregate gate pass; RISK-014 closes with dated evidence.
18. **Estimated complexity:** S.
19. **Dependencies on previous slices:** Slices 15–19.
20. **Executor tier:** standard — the code is local, but order, Jobs isolation, and final risk closure need cross-workflow evidence.

## Rough backlog notes for later work

### Add continuous integration

- **Why it matters:** Local gates are not automatically enforced on pushes or pull requests.
- **Dependency or trigger:** Choose a repository host and branch policy. The existing `npm run check` command is ready for CI.
- **Major uncertainty:** The repository host and branch protection policy are not documented.

### Reassess large validation files when touched

- **Why it matters:** Several cohesive Jobs/SQLite validation files sit above the repository’s 300-line decomposition prompt.
- **Dependency or trigger:** Reassess during a behavior change. Split only when a file owns more than one responsibility.
- **Major uncertainty:** A mechanical split could make the validation flow harder to follow.

### Expand local-database threat modeling if distribution changes

- **Why it matters:** Slice 3 covers ordinary POSIX permissions. It does not cover encryption or a hostile directory and symlink race.
- **Dependency or trigger:** Revisit before multi-user installation, background-service operation, or storage outside a user-controlled directory.
- **Major uncertainty:** Product distribution and adversary model are not defined.

## Notes on sequencing risks

- Slices 13 and 14 are independent and can land before the resource work. Keep RISK-014 open during Slice 13.
- Slice 15 is the only public contract slice. Slices 16–20 consume it and must not invent local values.
- Slice 16 makes Catalog the receiving-boundary authority before early adapter rejection lands. This keeps non-HTML producers safe.
- Slice 17 must bound CLI reading with limit-plus-one I/O. A pre-read `stat` check alone does not cover file replacement or growth.
- Slice 18 must reject corrupt stored depth before it returns a public snapshot. Slice 19 can then keep the inspector/CLI failure shape unchanged.
- Slice 20 closes RISK-014 only after the source, Catalog, persistence, inspection, and Processing probes all pass.
- After each implementation slice, run focused red/green tests, relevant integrations, then `npm run check`. Listener-dependent tests need approved loopback access. Record commands actually run in `docs/ops/verification.csv`.

## Refresh trigger

The final refresh and completed-work audit are complete. Reopen this plan only if a larger valid export or measured runtime evidence justifies a versioned limit change.

## Final executed Slice Packet

No executable packet remains. The retained packet below records the final completed slice.

Slice Packet: Make Processing selection stack-safe and close RISK-014

Goal:
Replace Processing’s recursive folder search and bookmark collection with one bounded iterative traversal, then run final deep-input verification and close RISK-014.

Behavior change:
Preview and start handle every accepted Catalog tree without stack growth. A faulty over-budget snapshot returns `snapshot_invalid` and never reaches Jobs.

Source evidence:
- `modules/processing/processing-planner.ts::findFolder` and `collectBookmarkIds` recurse.
- Preview and start share this selection path.
- All preceding source, Catalog, storage, and inspection paths are now bounded and iterative.

Relevant instruction files:
- User-provided global AGENTS.md.
- docs/architecture/module-map.md.
- docs/plans/active/adversarial-audit-remediation.md.

Project constraints activated:
- Processing consumes Catalog’s public limits.
- Preserve first matching folder and depth-first bookmark order.
- No bookmark content enters Jobs.
- Close RISK-014 only after final cross-owner verification.

Files likely to touch:
- modules/processing/processing-planner.ts.
- tests/integration/processing-planner.test.ts.
- tests/integration/processing-enqueue-sqlite.test.ts only if workflow coverage needs expansion.
- docs/ops/risks.csv.
- docs/ops/tdd-checkpoints.csv, docs/ops/work-items.csv, and docs/ops/verification.csv.

Files likely not to touch:
- Processing public types, Jobs, Catalog implementation, SQLite, parser, CLI output, or package configuration.

Contract/boundary affected:
- Private implementation of existing Processing preview/start contracts and RISK-014 state.

Owning module (from the module map, if the project has one):
- Processing.

Executor tier:
- standard — source parsing and file reading cross one adapter boundary with strict ordering and allocation constraints.

Ownership and domain-rule analysis:
- Ownership boundary involved:
  - Processing owns selection and Jobs request authorship over typed Catalog data.
- Structured contract or source of truth involved:
  - `CATALOG_RESOURCE_LIMITS`, Processing preview/start results, and Jobs enqueue request.
- Local behavior allowed:
  - Validate bounds, find the first folder, collect bookmark IDs, and calculate fixed budgets.
- Local behavior explicitly forbidden:
  - Reordering, URL/title leakage into Jobs, enqueue after invalid input, new failure codes, or recursion.

Invariants:
- First matching folder in depth-first order.
- Exact descendant bookmark order and deterministic encodings.
- Preview/start agreement and fixed budget arithmetic.
- Zero Jobs calls on invalid or over-budget input.

Tests:
- Add accepted depth 256 preview/start traversal.
- Add node 20,000 preview boundary.
- Add depth 257 and node 20,001 faulty dependency failures with zero Jobs calls.
- Retain normal order/idempotency and real SQLite workflow controls.

Red/green expectation:
- Old recursive selection accepts over-budget trees or can overflow.
- New behavior returns `snapshot_invalid` before Jobs and preserves accepted output.

Telemetry/evidence:
- Focused traversal and Jobs call counts plus final aggregate deep probes diff check and offline audit recorded in the ops ledgers.

Non-goals:
- New Processing codes, parallel enqueue, streaming jobs, configurable profiles, or larger limits.

Acceptance criteria:
- No Processing tree walk calls itself.
- Accepted-boundary order and budgets remain exact.
- Over-budget input returns `snapshot_invalid` with zero Jobs calls.
- Final verification passes and RISK-014 closes with dated evidence.

Risks:
- Reversed job order, validating only the selected subtree, or closing the risk before all owner paths pass.

Estimated complexity:
M

Dependencies:
- Slices 15–19.
