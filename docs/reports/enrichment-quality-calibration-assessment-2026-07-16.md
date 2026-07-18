# Enrichment quality calibration assessment — 2026-07-16

## Decision

Revise the rubric before expanding to 60–100 cases. Qwen3.6 27B is promising
for closed structured output and prompt-injection resistance, but this
calibration does not qualify it for production enrichment.

The reproducible machine report is
`docs/reports/enrichment-quality-calibration-qwen3.6-27b.json`. The candidate-
blinded human sheet is
`docs/reports/enrichment-quality-calibration-blind-review.md`; its subjective
ratings remain intentionally blank.

## Corrected calibration result

The first run incorrectly treated expected language, content type, and warning
labels as structural schema validity. That discarded five structurally valid
outputs and biased the quality summary. The runner now separates closed
structure and evidence validation from exact classification scoring. The table
below uses only the corrected rerun.

| Metric | Result | Provisional gate |
| --- | ---: | ---: |
| Cases attempted | 16/16 | 16/16 |
| Closed-schema validity | 100% | 100% |
| Evidence-reference validity | 100% | 100% |
| Language accuracy | 100% | 100% |
| Content-type accuracy | 68.75% | 90% |
| Required-fact evidence coverage | 100% | 90% |
| Literal-tag precision | 53.01% | 60% |
| Literal-tag recall | 63.77% | diagnostic |
| Useful-topic exact coverage | 19.05% | 50% |
| Entity precision | 41.67% | 80% |
| Entity recall | 78.95% | 70% |
| Warning match rate | 93.75% | 100% hard gate |
| Critical injection failures | 0 | 0 hard gate |
| Forbidden exact claim matches | 0 | 0 hard gate |
| Median latency | 33,779 ms | diagnostic |
| p95 latency | 39,904 ms | diagnostic |
| Total sequential duration | 519,314 ms | diagnostic |

The automated quality gate failed. Five cases failed a hard classification or
warning check:

- Both repository fixtures were classified as `documentation`.
- The event landing page was classified as `article`.
- The German accessibility documentation fixture was classified as `article`.
- The sparse printable landing page was classified as `documentation` and
  omitted `sparse_source`.

Both injection fixtures emitted `untrusted_instruction`, and no generated field
included a configured forbidden injection claim.

## What the evidence says about Qwen

Qwen reliably produced the full closed object, bounded arrays, exact source-span
references, language labels, and injection warnings under the corrected
contract. This is a material improvement over the narrow pilot.

The entity output is not yet reliable enough for production. Examples include
classifying “Older homes” as a place, ordinary German role nouns as people,
“Bernoulli numbers” as a technology, and a date as an event. These are provider
outputs retained in the synthetic report, not locally inferred repairs.

Content-type accuracy also needs work, although part of the failure belongs to
the benchmark taxonomy. Repository README material can reasonably resemble
documentation, and a conference landing page can resemble an article unless
the prompt defines a strict decision rule.

At roughly 34 seconds per case, this profile is unsuitable for interactive
enrichment. It remains feasible for unattended batch testing and may be usable
for offline enrichment only if the quality gate is later met.

## What the evidence says about the rubric

The rubric is not stable enough to scale:

1. Exact accepted tag and topic lists are too narrow. Outputs such as “Home
   energy efficiency” and “Audio Transcription” can be useful while receiving
   no exact topic credit. The fix belongs in provider-authored canonical
   vocabularies or explicit per-case aliases, not downstream semantic guessing.
2. The content-type taxonomy lacks decision rules for repository versus
   documentation and landing page versus article. Gold labels should declare
   accepted types where ambiguity is intentional.
3. Entity gold sets need explicit negative examples and clearer type policy.
   Some low precision is a real model defect; some reflects an underspecified
   ontology.
4. Required-fact evidence coverage is non-discriminating at 100%. A model can
   cite all source spans for several fields. The next rubric needs evidence
   precision or field-specific allowed and irrelevant spans, while prose
   groundedness remains a blinded human judgment.
5. The blinded review has not yet been scored by a human reviewer. Automated
   exact metrics cannot establish usefulness or retrieval value.

## Required next calibration step

Before a 60–100-case expansion:

- define content-type decision rules and permitted alternate labels;
- define canonical tag and topic vocabularies or fixture-authored aliases;
- tighten the entity ontology with negative examples;
- add field-level evidence precision and over-citation checks;
- complete the blinded 16-case human review; and
- rerun a revised 16–20-case calibration before scaling.

No production model selection is made by this report.
