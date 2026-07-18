# Deferred backlog and open-risk implementation

Status: complete
Date: 2026-07-16

This brownfield plan implements the deferred items and open non-remediation risks
retained after the adversarial audit. It preserves the existing module shape,
isolates the one public Jobs contract change, and uses measurements rather than
speculation for the progress and model lanes.

## Scope and current evidence

- `npm run check` is the complete local gate, but no hosted CI workflow runs it.
- Five integration files require permission to bind ephemeral loopback listeners.
  Restricted sandboxes currently fail those tests with `EPERM`.
- File-backed databases are tightened to mode `0600`, but the opener follows a
  final-component symlink and does not reject an untrusted parent directory.
- Jobs maps corrupt stored rows and transient SQLite failures to the same
  `storage_unavailable` code. These conditions have different operator actions:
  retry can help the latter but cannot repair the former.
- Jobs progress validates and materializes every row. No maintained 10,000-job
  measurement proves whether that simple implementation meets a response budget.
- The first LM Studio probe tested only Qwen3.5 9B and failed strict JSON. LM
  Studio is installed locally, but its daemon was unavailable at plan time.
- At plan time, `adapters/sqlite/jobs-transition-validation.ts` was above 300 lines and mixed
  input validation, stored-row reconstruction, transaction helpers, and outcome
  factories. Other oversized validation files remain cohesive under current
  evidence.

## Fixed architecture decisions

- Hosted CI runs the full gate. A separate explicitly named restricted-environment
  gate may omit only tests marked as requiring a loopback listener; it never
  replaces the full gate.
- File-backed SQLite is supported only in an existing, owner-controlled directory.
  The opener rejects a symlink final component, non-regular or multiply linked
  files, foreign-owned files, and group/world-writable or foreign-owned parents.
  Encryption and hostile ancestor replacement remain outside the single-user
  local threat model and are documented residual risks.
- Add `stored_queue_invalid` to the Jobs failure union in its own public-contract
  slice. SQLite authors that failure only from structured receiving-boundary
  validation, never from exception prose. Engine and lifecycle failures remain
  `storage_unavailable`.
- A 10,000-job progress read has a 250 ms local responsiveness budget. Preserve
  row-level validation if it meets the budget; introduce validated SQL aggregates
  only if the maintained benchmark misses it.
- Model evaluation is repository tooling, not a production semantic fallback.
  It owns a fixed pilot schema and fixtures, treats model text as untrusted, does
  no semantic retry or repair, and records exact structured outcomes. It does not
  select a production model or claim the PRD's future 60–100-item quality gate.

## Rolling slices

Implementation progress: Slices 1–8 are complete. The live server became
available, both exact candidate keys were loaded and attempted, the original
loaded-model state was restored, and the redacted result is retained in
`docs/reports/model-structured-output-pilot-2026-07-16.md`.

### Slice 1 — Hosted CI and restricted-environment verification

Status: complete.

- Add a GitHub Actions workflow using Node 26, `npm ci`, and `npm run check`.
- Add a capability marker for the five listener-dependent test files.
- Extend the self-enrolling runner with an explicit loopback exclusion option.
- Add `test:restricted` and `check:restricted`; document that CI and ordinary
  local completion still require the full gate.
- Contract-test normal discovery, exclusion, deterministic order, and transparent
  skipped-file reporting.

Acceptance: full discovery remains automatic; restricted verification passes
without listeners and reports every omission; CI configuration invokes the full
gate.

### Slice 2 — Local database trust boundary

Status: complete.

- Red-test a symlink database target and an unsafe parent directory.
- Harden `private-database-file.ts` with descriptor-based ownership, type, link,
  permission, and parent checks plus `O_NOFOLLOW`.
- Preserve `:memory:`, existing database contents, both public openers, and mode
  `0600`.
- Add a durable threat-model document with supported assumptions, rejected
  placements, and residual encryption/ancestor-race limitations.

Acceptance: unsafe paths fail as `storage_unavailable` before SQLite opens;
ordinary private temporary directories and existing owner files still work.

### Slice 3 — Jobs stored-corruption public contract

Status: complete.

- Add only `stored_queue_invalid` to `JobQueueFailureCode`.
- Update exact contract/type tests and the module map.
- Update closed downstream mappings without adding runtime producer behavior.

Acceptance: the additive code compiles through every consumer and no SQLite
implementation changes in this slice.

### Slice 4 — Structured Jobs corruption mapping

Status: complete.

- Introduce one adapter-private typed integrity signal.
- Split transition input validation from stored-row validation and transaction
  helpers because the touched file demonstrably owns multiple responsibilities.
- Map malformed replay summaries, lease candidates, lease rows, batch rows,
  expired-lease rows, progress rows, and count mismatches to
  `stored_queue_invalid`.
- Keep compare-and-set/engine/closed-database failures as `storage_unavailable`;
  keep malformed caller commands as `invalid_request`.

Acceptance: focused corruption tests prove the distinction across enqueue, lease,
transition, control, and progress paths without parsing error messages.

### Slice 5 — 10,000-job progress evidence

Status: complete. The maintained measurement passed in 10.23 ms, so the
row-validating implementation remains unchanged.

- Add a deterministic 10,000-job performance test that times only the progress
  read after fixture setup.
- Assert exact counts and `nextEligibleAt` as well as the 250 ms budget.
- If the current row-validating implementation passes, retain it and record the
  evidence. If it fails, replace it with schema-validated SQL aggregates and
  rerun all corruption tests.

Acceptance: RISK-005 closes only with a passing maintained measurement.

### Slice 6 — LM Studio structured-output benchmark tooling

Status: complete.

- Add small, typed modules for the pilot benchmark contract, LM Studio transport,
  report aggregation, and CLI composition.
- Add fixed English, German, sparse-page, and prompt-injection fixtures.
- Test model-list validation, exact candidate selection, request construction,
  strict content validation, transport/5xx retry, no semantic retry, latency
  aggregation, and redacted report output with fake fetch responses.
- Enroll `tools/**/*.ts` in strict typecheck and module-boundary enforcement.

Acceptance: `npm run model:benchmark` produces a stable JSON report and exits
nonzero for unavailable candidates or any contract failure.

### Slice 7 — Live named-candidate run

Status: complete. Gemma completed all four cases and passed one. Qwen returned
HTTP 400 for all four cases when loaded alone; a diagnostic request without
structured output produced the same outcome and the loaded instance disappeared.
Neither candidate was selected.

- Start the local LM Studio service if available.
- Discover installed models and run Gemma 4 12B and Qwen3.6 27B one at a time
  against the fixed pilot contract.
- Record exact model identifiers, schema-valid rate, injection failures, median
  and p95 latency, and structured failure codes.
- Retain RISK-001 because neither candidate clears the contract; its mitigation
  now requires another candidate or a repaired Qwen runtime rather than another
  attempt to start the local server.

Acceptance: no model is selected, no malformed output is repaired, and the risk
state matches the evidence rather than the intended run.

### Slice 8 — Final reassessment and verification

Status: complete. The mixed transition validator was split into 138-line input
validation and 237-line stored-state/transaction modules. Other touched
production files above 300 lines each retain one cohesive owner responsibility.
The restricted gate, full 238-test gate, offline audit, CSV/YAML validation, and
diff checks pass. The live pilot and model-state restoration are recorded in
VER-688 through VER-691.

- Reassess every touched file above the decomposition prompt; split only the
  demonstrated mixed-responsibility transition validator.
- Run focused tests after each slice, then strict typecheck, restricted check,
  full `npm run check` with listener permission, offline dependency audit, CSV
  validation, link validation, and `git diff --check`.
- Update work items, decisions, TDD checkpoints, verification, risks, lessons,
  README, ADRs, and archive this plan only when no executable slice remains.

## Completion outcome

All repository-owned implementation slices and verification gates are complete.
The live comparison did not identify an eligible model:

- Gemma: one of four cases passed the full contract.
- Qwen: all four requests returned HTTP 400 even when isolated; an unstructured
  request produced the same result.

RISK-001 remains open as a product/runtime dependency. No executable work from
this plan remains, so the plan is archived.

## Post-completion evidence

A later Gemma 4 26B A4B QAT run exposed an MLX provider-schema incompatibility
with `uniqueItems` and an undersized completion ceiling. The benchmark was
corrected while retaining full local validation. The corrected 26B run failed
JSON parsing on all four cases and exhausted its 1,024-token bound. A corrected
Qwen3.6 27B rerun passed all four cases after the adapter validated LM Studio's
explicit `reasoning_content` envelope through the unchanged closed contract.
RISK-001 is closed, but production selection still requires the future labeled
quality benchmark. The plan remains archived because this follow-up is model
evaluation rather than deferred repository implementation.
