# Adversarial Review Corrections

Date: 2026-07-16

## Objective

Fix the three executable defects found by the post-remediation adversarial review without moving existing module boundaries:

1. Health must reject repository observations whose individually valid fields contradict one another.
2. Chrome HTML file input must reject malformed UTF-8 rather than persisting decoder replacement characters.
3. Node Health request-target approval must match the IANA IPv4 Special-Purpose Address Registry, including global exceptions.

## Scope and sequencing

The UTF-8 correction contains one additive public failure-code change, so it is isolated before CLI behavior changes. The remaining corrections are private implementation repairs behind existing contracts.

### Slice 1 — Enforce coherent Health observation facts (completed 2026-07-16)

1. **Slice name:** Enforce coherent Health observation facts.
2. **Goal:** Make Health reject structurally valid but impossible repository observations before they authorize idempotent or durable success.
3. **Source evidence:** `modules/health/health-observation-validation.ts` validates field shapes but accepts contradictory status/error pairs, nonzero retries, disconnected redirects, and response URLs unrelated to the redirect chain.
4. **Behavior change:** Invalid stored or concurrently returned observations map through the existing Health failure boundary instead of being treated as committed success.
5. **Relevant instructions:** Global `AGENTS.md`; `docs/architecture/module-map.md`; this plan; `ops-ledger`.
6. **Constraints:** Health owns semantic validation; SQLite remains defense in depth; no downstream prose/error interpretation; no public type change.
7. **Files likely to touch:** `modules/health/health-observation-validation.ts`; `tests/integration/health-checker-validation.test.ts`; ops ledgers.
8. **Files likely not to touch:** Health public types; SQLite schema; Jobs; CLI.
9. **Boundary affected:** Existing private Health receiving-boundary validator.
10. **Ownership analysis:** The validator may reconstruct deterministic meaning from typed observation fields and the Health classifier. It may not repair facts or infer meaning from diagnostics.
11. **Invariants:** `retryCount` is zero; no more than five contiguous redirect hops; response final URL equals the last hop; response status agrees with classification; transport failures have matching error/status and no response-only facts; redirect errors agree with the final redirect response.
12. **Tests:** Add load and save regressions for contradictory status/error, nonzero retry, disconnected or over-limit redirects, mismatched final URL, and mismatched response classification; retain valid response, redirect, and transport-failure controls.
13. **TDD:** New impossible-observation cases fail before implementation and pass after invariant validation.
14. **Evidence:** Focused Health integration test and aggregate repository gate.
15. **Risks:** Rejecting legitimate current checker output, duplicating classifier policy, or accidentally disallowing future typed page-suspicion observations.
16. **Non-goals:** New Health statuses, retry behavior, staleness policy, schema changes, or page-classifier implementation.
17. **Acceptance:** Every named contradiction is rejected on both repository load and save paths; all current checker outputs remain valid.
18. **Complexity:** S.
19. **Dependencies:** None.
20. **Executor tier:** standard.

### Slice 2 — Add the malformed-source encoding failure contract (completed 2026-07-16)

1. **Slice name:** Add the malformed-source encoding failure contract.
2. **Goal:** Add one typed source failure for malformed UTF-8 before changing file-reading behavior.
3. **Source evidence:** `apps/local-cli/import-command.ts` currently decodes bytes permissively, while Chrome HTML owns source-stage failures.
4. **Behavior change:** Type consumers can represent `invalid_encoding`; runtime decoding is unchanged in this slice.
5. **Relevant instructions:** Global `AGENTS.md`; `docs/architecture/module-map.md`; this plan; `ops-ledger`.
6. **Constraints:** Public contract changes are isolated; the addition is backward-compatible; no runtime implementation changes.
7. **Files likely to touch:** `adapters/chrome-html/public.ts`; Chrome HTML contract/typecheck tests; ops ledgers.
8. **Files likely not to touch:** CLI implementation; parser implementation; Catalog; SQLite.
9. **Boundary affected:** `ChromeHtmlImportFailureCode`.
10. **Ownership analysis:** Chrome HTML authors source-stage meaning; file-reading consumers may detect malformed source bytes and return that declared code without inventing an unrelated CLI code.
11. **Invariants:** Existing failure codes and success types remain unchanged; `field` remains `html`; import failure stage remains `source`.
12. **Tests:** Add exact compile-time/runtime contract coverage for `invalid_encoding`.
13. **TDD:** Contract assertion fails before the union addition and passes after it.
14. **Evidence:** Contract test plus typecheck.
15. **Risks:** Letting a CLI-only concern leak into Catalog or changing exit/output shapes.
16. **Non-goals:** Decoder implementation, encoding autodetection, transcoding, or replacement-character rejection in already-decoded strings.
17. **Acceptance:** Contract tests and typecheck recognize the additive code with no runtime behavior change.
18. **Complexity:** XS.
19. **Dependencies:** Architecture map update.
20. **Executor tier:** cheap.

### Slice 3 — Decode Chrome HTML input as fatal UTF-8 (completed 2026-07-16)

1. **Slice name:** Decode Chrome HTML input as fatal UTF-8.
2. **Goal:** Prevent malformed file bytes from being silently converted to U+FFFD and persisted.
3. **Source evidence:** `readBoundedHtml` uses `Buffer.toString("utf8")`, which replaces malformed sequences.
4. **Behavior change:** Malformed UTF-8 exits through the existing import-failed/source projection with failure code `invalid_encoding`, before opening the database.
5. **Relevant instructions:** Global `AGENTS.md`; `docs/architecture/module-map.md`; this plan; `ops-ledger`.
6. **Constraints:** Preserve limit-plus-one bounded reading, input-unavailable mapping, stable exit 5 source failures, and database non-creation before source validation.
7. **Files likely to touch:** `apps/local-cli/import-command.ts`; `tests/integration/local-cli-import.test.ts`; ops ledgers.
8. **Files likely not to touch:** Parser behavior; Catalog; SQLite internals; orchestrator.
9. **Boundary affected:** Existing CLI consumption of the Chrome HTML failure contract.
10. **Ownership analysis:** CLI owns bytes and decoding; it returns the adapter-authored typed source failure and never repairs malformed input.
11. **Invariants:** Valid UTF-8 and size-bound behavior are unchanged; malformed bytes never reach parser or storage; already-decoded strings remain parser inputs.
12. **Tests:** Write a byte fixture containing an invalid UTF-8 sequence; assert exit 5, source stage, `invalid_encoding`, `html`, and absent database.
13. **TDD:** Fixture currently imports with a replacement character; after the fix it fails before database open.
14. **Evidence:** Focused CLI import integration test and aggregate gate.
15. **Risks:** Mapping decoder exceptions to `input_unavailable`, decoding after database creation, or losing the byte cap.
16. **Non-goals:** BOM-based encoding detection, legacy Chrome export encodings, streaming parser changes, or parser contract changes.
17. **Acceptance:** Malformed input produces the exact typed failure and no database; all valid and oversized cases remain green.
18. **Complexity:** XS.
19. **Dependencies:** Slice 2.
20. **Executor tier:** cheap.

### Slice 4 — Align IPv4 target policy with IANA (completed 2026-07-16)

1. **Slice name:** Align IPv4 target policy with IANA.
2. **Goal:** Reject deprecated/non-global special-purpose IPv4 targets while allowing registry-declared global exceptions.
3. **Source evidence:** `ipv4Disposition` permits `192.88.99.2` and rejects globally reachable `192.0.0.9` and `192.0.0.10`.
4. **Behavior change:** Direct, DNS-resolved, IPv4-mapped IPv6, and RFC 6052 embedded targets use the corrected IPv4 disposition.
5. **Relevant instructions:** Global `AGENTS.md`; `docs/architecture/module-map.md`; this plan; `ops-ledger`.
6. **Constraints:** Fail closed on malformed addresses and non-global ranges; retain explicit test-only loopback permission; no public type change.
7. **Files likely to touch:** `adapters/node/health-request-target-resolver.ts`; `tests/unit/health-request-target-resolver.test.ts`; ops ledgers.
8. **Files likely not to touch:** Health module; transport public ports; CLI; SQLite.
9. **Boundary affected:** Private Node request-target approval policy.
10. **Ownership analysis:** The Node adapter owns network-address eligibility and may encode IANA registry facts; Health continues to receive only typed transport results.
11. **Invariants:** Mixed safe/unsafe DNS answers reject; loopback option affects loopback only; address pinning and host verification are unchanged; embedded IPv4 uses the same policy.
12. **Tests:** Reject `192.88.99.2`; allow `192.0.0.9` and `.10`; retain controls for private, documentation, multicast, public IPv4, mapped, and translated forms.
13. **TDD:** New registry cases demonstrate the inverted current behavior before implementation and pass after prefix/exception handling.
14. **Evidence:** Focused resolver unit test and aggregate gate.
15. **Risks:** Broadly allowing `192.0.0.0/24`, missing embedded forms, or introducing bit-mask errors.
16. **Non-goals:** Live internet reachability, dynamic registry download, DNS rebinding beyond existing pinning, or IPv6 policy redesign.
17. **Acceptance:** Named IANA cases and all existing resolver safety cases pass through every represented address form.
18. **Complexity:** S.
19. **Dependencies:** None.
20. **Executor tier:** standard.

## Completion

All four slices are complete. Focused red/green tests passed, the broad Health and Chrome/CLI suites passed, and `npm run check` passed with 225 tests across 54 files under approved loopback access. No executable packet remains.

## Final executed Slice Packet

Slice Packet: Enforce coherent Health observation facts

Goal:
Reject impossible `HealthObservationRepository` results at the Health receiving boundary.

Implementation boundary:
Change only the private Health observation validator, its focused integration tests, and execution ledgers. Reuse the Health classifier for deterministic response and transport-failure status checks.

Required red cases:

- `healthy` with `errorCode: "timeout"`.
- Nonzero `retryCount`.
- More than five redirects.
- Redirect chain not beginning at `requestedUrl` or not contiguous.
- Response `finalUrl` not matching the final redirect target.
- Response `status` not matching typed HTTP and redirect facts.

Required valid controls:

- Healthy response without redirects.
- Temporary redirect response with matching final URL.
- Timeout transport failure with no response-only fields.
- Page-suspicion statuses remain rejected until their separate typed evidence-producing contract can supply the required evidence references.

Verification:
Run the focused Health validation integration test, typecheck, then the aggregate repository gate before marking the slice complete.
