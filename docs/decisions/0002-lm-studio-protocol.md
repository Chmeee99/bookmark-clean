# ADR 0002: LM Studio protocol evidence

Status: evidence retained; disposable probe removed
Date: 2026-07-13

## Supersession note

As of 2026-07-16, the maintained strict-output pilot lives under
`tools/model-evaluation/` and runs through `npm run model:benchmark`. ADR 0011
defines its boundary. The live comparison is complete and recorded in
`docs/reports/model-structured-output-pilot-2026-07-16.md`. Neither named
candidate cleared the fixed contract, so this ADR still does not select a model.

## Tested contract

- Discover models with `GET /api/v1/models`.
- Request structured generation with `POST /v1/chat/completions` at `http://127.0.0.1:1234`.
- Read generated content only from `choices[0].message.content`.
- Use strict JSON Schema output, `temperature: 0`, bounded tokens, and no streaming.
- Retry a transport failure or HTTP 5xx once with the same request. Do not retry or repair semantic or structural failures.
- Treat supplied page text as untrusted data. Provider output must pass the declared schema before local code uses it.

## Observed result

The first host-access run discovered the loaded approved candidate `qwen3.5-9b`.
Its generation request returned HTTP 200 in 3,282 ms. The outer response JSON
passed, and `choices[0].message.content` failed strict validation with
`invalid_json`.

The maintained follow-up initially tested `google/gemma-4-12b` and
`qwen/qwen3.6-27b`. A later MLX backend trace showed that the provider schema's
`uniqueItems` keyword was unsupported, superseding the Qwen conclusion. The
corrected pilot then tested `google/gemma-4-26b-a4b-qat`; it exhausted the
1,024-token ceiling with invalid JSON. A corrected Qwen rerun passed all four
cases after the adapter validated LM Studio's explicit `reasoning_content`
envelope. No failed content received a semantic retry or local repair.

## Open questions

- Which new candidate or repaired Qwen runtime can satisfy the strict pilot?
- Can any candidate detect the hostile instruction in the supplied source while producing grounded fields?
- Does the target runtime require authorization?
- Which schema and token limit fit the production enrichment evaluation?

## Cleanup note

The 614-line discovery script, 556-line exclusive test, and 4-line fixture were removed after this evidence was recorded. The maintained replacement is split by contract, transport, reporting, and CLI composition and uses only synthetic fixtures. Production enrichment still requires its own module-owned schema and labeled quality gate. This ADR does not select a model or establish enrichment quality.
