# ADR 0002: LM Studio protocol evidence

Status: evidence retained; disposable probe removed
Date: 2026-07-13

## Tested contract

- Discover models with `GET /api/v1/models`.
- Request structured generation with `POST /v1/chat/completions` at `http://127.0.0.1:1234`.
- Read generated content only from `choices[0].message.content`.
- Use strict JSON Schema output, `temperature: 0`, bounded tokens, and no streaming.
- Retry a transport failure or HTTP 5xx once with the same request. Do not retry or repair semantic or structural failures.
- Treat supplied page text as untrusted data. Provider output must pass the declared schema before local code uses it.

## Observed result

The host-access run discovered the loaded approved candidate `qwen3.5-9b`. Its generation request returned HTTP 200 in 3,282 ms. The outer response JSON passed, and `choices[0].message.content` failed strict validation with `invalid_json`.

The failed content received no semantic retry or local repair. No model state changed. Gemma 4 12B and Qwen3.6 27B were not tested.

## Open questions

- Can Gemma 4 12B or Qwen3.6 27B satisfy the same strict schema?
- Can any candidate detect the hostile instruction in the supplied source while producing grounded fields?
- Does the target runtime require authorization?
- Which schema and token limit fit the production enrichment evaluation?

## Cleanup note

The 614-line discovery script, 556-line exclusive test, and 4-line fixture were removed after this evidence was recorded. Future model comparison belongs inside the production enrichment vertical slice and must use a contract-owned schema. This ADR does not select a model or establish enrichment quality.
