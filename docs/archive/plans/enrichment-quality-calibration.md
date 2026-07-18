# Enrichment quality calibration benchmark

Status: completed
Date: 2026-07-16

## Overview

Build and run a 16-case labeled calibration benchmark for local enrichment
models. The benchmark will mirror the target Enrichment record closely enough to
measure grounded descriptions, tags, topics, entities, likely save intent,
warnings, evidence references, language, and content type. It remains
repository-owned evaluation tooling rather than production Enrichment runtime.

Stopping condition: Qwen3.6 27B runs all 16 cases through the real LM Studio
server; deterministic results and a blinded human-review sheet are written as
reproducible local artifacts; focused and full repository verification pass; and
the evidence states whether the rubric is stable enough to expand to 60–100
cases.

Authentic entry point: `npm run model:quality-calibration`

Representative input: the versioned 16-case synthetic calibration fixture.

Real dependency: loaded `qwen/qwen3.6-27b` through LM Studio at
`http://127.0.0.1:1234`.

Observable output: a JSON quality report and blinded Markdown review sheet under
`docs/reports/`.

Economic gate: the repository default of 50,000 tokens or 60 minutes. Stop
partial after the current atomic slice if reached.

## Current planning state

- Brownfield repository with existing strict-output model tooling.
- Selected plan: `docs/plans/active/enrichment-quality-calibration.md`.
- Slice 1 is complete: the decomposed versioned contract validates 16 synthetic
  cases across nine categories two languages and two injection variants.
- Slice 2 is complete: exact declared-label and evidence-ID scores feed a
  deterministic candidate-blinded review with blank human ratings.
- Slice 3 is complete: the independent command reuses only narrow LM Studio
  transport and envelope mechanics and writes JSON plus blinded Markdown.
- Slice 4 is complete: the corrected live run attempted all 16 cases and
  produced 16 closed-schema and evidence-valid outputs.
- Outcome: revise the rubric before scale-up. Qwen passed structural and
  injection gates but failed provisional classification warning tag topic and
  entity gates; the blinded human ratings remain pending.
- Scope lock: calibration benchmark only; no production Enrichment module,
  extraction runtime, embedding benchmark, web UI, or model selection.
- Recent facts: Qwen3.6 27B passed the corrected four-case structured-output
  pilot; LM Studio may return its constrained JSON in `reasoning_content`.
- Main uncertainty: whether deterministic gold labels discriminate useful,
  grounded quality well enough to justify a full 60–100-case benchmark.

## Rolling queue

### Slice 1 — Versioned quality contract and calibration fixture

Goal: define the evaluation-owned enrichment schema, gold-label schema, strict
validators, and 16 representative synthetic cases.

Source evidence:
- `docs/PRD.md` lines 186–241
- `docs/architecture/module-map.md` Model provider adapters section
- `tools/model-evaluation/benchmark-contract.ts`
- `tests/fixtures/model-evaluation/structured-output-pilot.json`

Behavior change: repository tooling can load a valid, versioned 16-case
calibration set and build a strict provider request for its full enrichment
shape.

Relevant instructions:
- root `AGENTS.md`
- `docs/architecture/module-map.md`
- this plan

Constraints activated:
- Provider output is contract-shaped and untrusted.
- Evaluation schema does not mutate the target Enrichment public contract.
- Fixtures are synthetic or public and contain no private bookmark data.

Files likely to touch:
- `tools/model-evaluation/quality-contract.ts`
- `tests/fixtures/model-evaluation/enrichment-quality-calibration-v1.json`
- `tests/unit/model-quality-calibration.test.ts`

Files likely not to touch:
- `modules/enrichment/**`
- `adapters/**`
- `apps/**`
- existing pilot contract except shared type imports if unavoidable

Contract/boundary affected: evaluation-owned schema and fixture contract only.

Owning module: repository model-evaluation tooling.

Executor tier: planner-grade — new schema and semantic boundary.

Ownership analysis:
- Ownership boundary: evaluation tooling authors prompts, schemas, fixture
  contracts, and scoring inputs.
- Source of truth: versioned quality contract plus gold fixture.
- Allowed: strict validation, normalization of declared comparison keys, and
  rejection.
- Forbidden: semantic repair, prose parsing, production model selection, and
  changing Enrichment runtime contracts.

Invariants:
- Exact keys and bounded values.
- Evidence references are source-span IDs.
- Duplicate source IDs and malformed gold labels fail closed.
- Provider schema avoids MLX-unsupported keywords; local validation remains
  complete.

Tests:
- Valid fixture loads all 16 unique cases.
- One-field corruptions fail deterministically.
- Output validator rejects missing/extra fields, invalid evidence IDs, duplicate
  tags/entities, unsupported warning combinations, and language/content-type
  mismatch.
- Request contains delimited untrusted source spans, thinking disabled, bounded
  tokens, and strict JSON Schema.

Red/green:
- Old code has no full enrichment calibration contract or fixture.
- New focused tests pass against the new contract.

Telemetry/evidence: fixture inventory by category and language.

Non-goals: scoring, LM Studio requests, generated reports, threshold decisions.

Acceptance:
- Exactly 16 cases spanning the PRD categories.
- Contract and fixture tests pass.
- No raw provider output exists yet.

Risks: overcomplicated schema or labels that cannot be scored deterministically.

Complexity: M

Dependencies: none.

### Slice 2 — Deterministic quality scorer and blinded review sheet

Goal: score schema-valid outputs against explicit gold labels and render a
model-blinded review artifact without automated semantic inference.

Source evidence:
- Slice 1 contract
- PRD metric list and hard gates
- architecture evaluation boundary

Behavior change: one validated output per case can produce reproducible hard
metrics and a human-review row.

Relevant instructions: root `AGENTS.md`, module map, this plan.

Constraints activated: scoring may compare declared values and references only;
subjective usefulness remains a human rating.

Files likely to touch:
- `tools/model-evaluation/quality-scorer.ts`
- `tools/model-evaluation/quality-review.ts`
- `tests/unit/model-quality-calibration.test.ts`

Files likely not to touch: production modules, adapters, pilot runner.

Contract/boundary affected: internal evaluation result and review artifact.

Owning module: repository model-evaluation tooling.

Executor tier: standard — multi-file deterministic scoring with sensitive
semantic guardrails.

Ownership analysis:
- Allowed: exact normalized comparisons, set precision/recall, evidence-ID
  coverage, forbidden exact phrase detection, latency aggregation.
- Forbidden: judging prose truth with heuristics or an LLM, extracting missing
  meaning, or silently awarding partial semantic credit.

Invariants:
- Invalid schema receives no quality score.
- Generated text is retained only for synthetic evaluation artifacts.
- Human sheet hides model identity and keeps subjective fields blank.

Tests:
- Exact metric calculations and zero-denominator behavior.
- Injection and forbidden-claim hard failures.
- Deterministic review order and hidden candidate identity.

Red/green:
- Old tooling cannot calculate quality metrics or review artifacts.
- New tests prove exact summaries and review rendering.

Telemetry/evidence: per-case fixed codes plus aggregate rates.

Non-goals: live generation, human ratings, final thresholds.

Acceptance: scorer never interprets prose beyond exact configured phrase
matching and emits a stable review sheet.

Risks: accepted-label sets may be too narrow; surface this in human review.

Complexity: M

Dependencies: Slice 1.

### Slice 3 — Live quality runner and artifact command

Goal: run one loaded candidate through the calibration contract and write
reproducible JSON and blinded Markdown artifacts.

Source evidence:
- existing `lm-studio-client.ts` envelope handling
- Slices 1–2 contracts
- `model:benchmark` CLI patterns

Behavior change: `npm run model:quality-calibration` exercises real LM Studio
and writes declared reports.

Relevant instructions: root `AGENTS.md`, module map, this plan.

Constraints activated:
- One retry only for transport/5xx with identical request.
- No semantic retry or output repair.
- Provider-authored `content` or exact alternate `reasoning_content` envelope
  only.

Files likely to touch:
- `tools/model-evaluation/quality-main.ts`
- `tools/model-evaluation/quality-lm-studio-client.ts` or a narrow reusable
  transport extraction
- `package.json`
- `tests/unit/model-quality-calibration.test.ts`

Files likely not to touch: production runtime, SQLite, existing pilot output
semantics.

Contract/boundary affected: local LM Studio evaluation integration.

Owning module: repository model-evaluation tooling.

Executor tier: standard — real external integration with established envelope.

Ownership analysis:
- Adapter code may transport and validate provider output.
- It may not interpret malformed text or synthesize missing fields.

Invariants:
- Fixture and output schema versions appear in reports.
- Artifacts are written atomically only after fixture validation.
- Candidate model ID is absent from the blinded review sheet.

Tests:
- Fake-fetch success, invalid schema, transport retry, HTTP failure, and
  artifact rendering.
- CLI argument validation.

Red/green:
- Old package has no calibration entry point.
- New command and fake integration tests pass.

Telemetry/evidence: duration, bytes, attempts, structured failure code, and
aggregate throughput.

Non-goals: live Qwen execution, human scoring, full 60–100 expansion.

Acceptance: fake provider run writes deterministic artifacts and exits nonzero
on hard-gate failures.

Risks: duplicating pilot transport; prefer the smallest reusable extraction that
does not broaden public contracts.

Complexity: M

Dependencies: Slices 1–2.

### Slice 4 — Real Qwen calibration and rubric assessment

Goal: execute Qwen3.6 27B over all 16 cases, preserve the synthetic evaluation
artifacts, assess automated hard metrics, and decide whether the rubric is ready
to scale.

Source evidence: Slices 1–3 and loaded LM Studio Qwen instance.

Behavior change: repository contains authentic calibration evidence and a
reproducible next decision.

Relevant instructions: root `AGENTS.md`, module map, this plan.

Constraints activated: no private data, no model selection from this small set,
no fabricated human scores.

Files likely to touch:
- generated `docs/reports/enrichment-quality-calibration-qwen3.6-27b.json`
- generated `docs/reports/enrichment-quality-calibration-blind-review.md`
- `docs/reports/model-structured-output-pilot-2026-07-16.md`
- ops ledgers
- this plan, moved to archive when complete

Files likely not to touch: runtime modules and adapters.

Contract/boundary affected: evidence and decision records only.

Owning module: repository model-evaluation tooling.

Executor tier: planner-grade — evidence interpretation and scale/no-scale
decision.

Ownership analysis:
- Automated metrics may gate schema, grounding references, explicit labels, and
  injection behavior.
- Subjective usefulness scores remain blank until a human review occurs.

Invariants:
- Live command uses real LM Studio.
- Failed outputs are recorded with structured codes, not repaired.
- Report distinguishes automated pass/fail from pending human judgment.

Tests:
- Focused tests, strict typecheck, full `npm run check`, CSV/YAML checks, and
  `git diff --check`.

Red/green: not applicable; live evidence is the acceptance gate.

Telemetry/evidence: report paths, Qwen identifier, case count, hard metrics,
latency, throughput, and pending human fields.

Non-goals: inventing human scores, expanding to 60–100 if labels prove unstable,
production model selection.

Acceptance:
- All 16 cases attempted.
- Reports are reproducible and model-blinded where required.
- Rubric assessment explicitly says ready, needs revision, or blocked.
- All repository verification passes.

Risks: Qwen may be unloaded or the calibration may reveal that gold sets need
revision before scale-up.

Complexity: M

Dependencies: Slices 1–3.

## Rough backlog

- Expand the stable calibration format to 60–100 cases after human review.
- Add at least one smaller candidate to establish the “smallest acceptable
  model” comparison.
- Build the separate embedding retrieval benchmark.
- Create the production Enrichment contract only after calibration fields and
  thresholds are accepted.

## Sequencing risks

- The evaluation schema must precede scoring and live generation.
- Automated grounding is limited to explicit evidence IDs and gold sets; prose
  truth remains a human-review concern.
- Generated artifacts must not be mistaken for production records.
- A live schema-valid run is delivery evidence for the benchmark, not for the
  future Enrichment product flow.

## Refresh trigger

Refresh after Slice 3 or sooner if the provider envelope or schema assumptions
change.

## Next executable Slice Packet

Slice Packet: Real Qwen calibration and rubric assessment

Goal:
Execute Qwen3.6 27B over all 16 cases and decide whether the rubric is ready to
expand to 60 to 100 cases.

Behavior change:
The repository gains authentic local quality evidence and an explicit
scale-or-revise assessment.

Source evidence:
- Slices 1 through 3
- loaded `qwen/qwen3.6-27b` LM Studio instance

Relevant instruction files:
- root `AGENTS.md`
- `docs/architecture/module-map.md`
- `docs/plans/active/enrichment-quality-calibration.md`

Project constraints activated:
- Provider output is contract-shaped and untrusted.
- Evaluation contracts do not mutate the target Enrichment public contract.
- Fixtures contain no private bookmark data.

Files likely to touch:
- generated quality JSON report
- generated blinded Markdown review
- model pilot report and ops ledgers
- this plan moved to archive when complete

Files likely not to touch:
- production modules and adapters

Contract/boundary affected:
- Evaluation evidence and decision records only.

Owning module:
- Repository model-evaluation tooling.

Executor tier:
- planner-grade — authentic evidence interpretation and scale decision.

Ownership and domain-rule analysis:
- Ownership boundary involved:
  - Automated evaluation owns exact metrics and humans own subjective ratings.
- Structured contract or source of truth involved:
  - Versioned fixture report and blinded review.
- Local behavior allowed:
  - Running the real candidate preserving synthetic generated fields and
    comparing exact declared metrics.
- Local behavior explicitly forbidden:
  - Fabricating human scores selecting production use or expanding a rubric
    whose labels are demonstrably unstable.

Invariants:
- All 16 cases are attempted against the real local server.
- Invalid output is recorded by structured code and never repaired.
- Automated and pending human judgments remain distinct.
- The blinded review contains no candidate identifier.

Tests:
- Run the authentic command.
- Re-run focused tests strict typecheck full repository checks CSV validation
  and whitespace checks.

Red/green expectation:
- Live evidence is the acceptance gate rather than a synthetic red-green cycle.

Telemetry/evidence:
- Schema rate hard metrics exact quality metrics latency and pending human
  fields.

Non-goals:
- Invented human ratings production selection and immediate benchmark expansion.

Acceptance criteria:
- All cases attempted and both artifacts written.
- Assessment states ready needs revision or blocked.
- Full repository verification passes.

Risks:
- Qwen may be unloaded or exact accepted labels may prove too narrow for
  reliable scaling.

Estimated complexity:
M

Dependencies:
- None.
