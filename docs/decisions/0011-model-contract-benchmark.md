# ADR 0011: Keep model contract evaluation as typed repository tooling

Status: accepted
Date: 2026-07-16

## Context

Qwen3.5 9B returned HTTP 200 but invalid JSON under the first strict LM Studio
probe. The named Gemma 4 12B and Qwen3.6 27B comparisons were never run. The
removed disposable probe was too large and was not a production contract.

The full enrichment module and its 60–100-item quality benchmark are still target
architecture. The immediate open risk is narrower: determine whether the named
local candidates can satisfy one fixed structured-output and prompt-injection
contract without local repair.

## Decision

Add `tools/model-evaluation` as non-production repository tooling with four
separate responsibilities:

- a fixed pilot contract and strict validator;
- an LM Studio protocol client;
- report aggregation; and
- CLI/file composition.

The tool uses `GET /api/v1/models` and `POST /v1/chat/completions`, temperature
zero, bounded output, thinking disabled, strict JSON Schema, and no streaming.
The provider schema avoids unsupported backend keywords while the local
validator retains the complete contract. It retries only a transport failure or
HTTP 5xx once with the identical request. Invalid JSON, schema failures, and
prompt-injection failures receive no retry or repair.

Fixtures contain only synthetic source material. Reports contain model
identifiers, fixed outcome codes, sizes, attempts, and timing; they do not retain
or print raw generated prose.

## Consequences

The tool can close the strict-output comparison risk but cannot select a
production enrichment model or satisfy the PRD's later grounded-quality gate.
`tools/**/*.ts` enters strict typechecking and static module-boundary checks, but
the live benchmark is not part of `npm run check` because it depends on local
models and substantial runtime resources.

## Live pilot evidence

The first 2026-07-16 host-access run exposed an MLX incompatibility with
`uniqueItems` and an undersized output ceiling. The corrected pilot disables
thinking, omits only that provider-side keyword while retaining local uniqueness
validation, and allows 1,024 bounded completion tokens. LM Studio returns Qwen's
constrained output in `reasoning_content` with empty `content`; the transport
accepts that explicit field only in that envelope and applies the same validator.
`qwen/qwen3.6-27b` passed all four cases, while
`google/gemma-4-26b-a4b-qat` failed JSON parsing on all four and exhausted the
token ceiling in a redacted follow-up. The pilot qualifies Qwen for later
grounded-quality evaluation but does not select it for production. The metrics
and decision are retained in
`docs/reports/model-structured-output-pilot-2026-07-16.md`.

## Labeled calibration follow-up

The evaluation tooling now also owns an independently versioned 16-case
enrichment calibration. Unlike the redacted pilot, its declared synthetic
artifacts may retain schema-valid generated fields for deterministic scoring and
candidate-blinded human review.

The corrected Qwen run produced 16/16 closed-schema and evidence-valid outputs
but failed the provisional quality gate. Exact label sets, content-type rules,
entity policy, and evidence specificity require revision before a 60–100-case
expansion. This does not alter the production Enrichment contract or select a
production model. See
`docs/reports/enrichment-quality-calibration-assessment-2026-07-16.md`.
