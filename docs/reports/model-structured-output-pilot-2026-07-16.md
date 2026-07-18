# LM Studio structured-output pilot — 2026-07-16

The maintained four-case pilot ran against the exact installed candidate keys
through LM Studio at `http://127.0.0.1:1234`. Generated prose was neither
retained nor repaired.

## Benchmark corrections

The first live run exposed two benchmark portability defects:

- LM Studio's MLX structured-output engine rejects the JSON Schema keyword
  `uniqueItems`. The provider schema no longer sends that keyword; the local
  validator still rejects duplicate tags.
- The original 320-token ceiling was smaller than the declared schema's maximum
  output. The bounded ceiling is now 1,024 tokens.

Thinking is explicitly disabled for the JSON-only comparison. Unit tests cover
all three request-contract properties.

LM Studio also places Qwen's grammar-constrained JSON in the explicit
`reasoning_content` response field while returning empty ordinary `content`.
The transport accepts that field only under that exact envelope condition and
passes it through the same closed validator. It does not interpret or repair it.
The earlier Gemma 12B GGUF result remains historical evidence but is not directly
comparable to the corrected pilot.

## Corrected-pilot result

| Candidate | Completed schema validations | Median latency | p95 latency | Outcome |
| --- | ---: | ---: | ---: | --- |
| `qwen/qwen3.6-27b` | 4/4 (100%) | 4,442 ms | 6,431 ms | Passed |
| `google/gemma-4-26b-a4b-qat` | 0/4 (0%) | 18,055 ms | 18,401 ms | Rejected |

Qwen passed the exact schema and semantic checks on every case, including the
hostile page instruction, with no retry or repair.

Gemma's maintained corrected run returned outer response JSON for every request
but all four generated contents failed JSON parsing. A redacted follow-up
recorded `finish_reason: length` at 1,023 completion tokens. The model therefore
did not reliably obey the structured-output constraint and exhausted the bounded
budget. One earlier isolated request passed, which is insufficient for a
deterministic production contract.

## Earlier run, retained for history

| Candidate | Completed schema validations | Injection failures | Median latency | p95 latency | Outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| `google/gemma-4-12b` | 1/4 (25%) | 2 | 3,067 ms | 4,107 ms | Rejected |
| `qwen/qwen3.6-27b` | 0/4 (0%) | 0 | 14 ms | 2,488 ms | Superseded |

Gemma returned outer JSON for every request. One fixture passed the complete
contract; two returned `page_instruction_mismatch`, and the German fixture
returned `invalid_schema`.

Qwen returned `http_400` for all four structured requests, but the later MLX
backend trace identified unsupported `uniqueItems` processing. That run cannot
support a model-quality conclusion.

## Decision

Qwen3.6 27B clears the narrow strict-output and prompt-injection pilot. Gemma 4
26B A4B QAT does not. RISK-001 is closed because the named comparison now has a
qualifying candidate, but this result does not select the production enrichment
model or replace the future labeled 60–100-item grounded-quality benchmark.

## Labeled calibration follow-up

The next 16-case enrichment calibration is complete. Qwen produced 16/16
closed-schema and evidence-valid outputs with no critical injection failure or
forbidden exact claim. It did not clear the provisional quality gate, and the
rubric itself needs revision before expansion. See
`docs/reports/enrichment-quality-calibration-assessment-2026-07-16.md`.
