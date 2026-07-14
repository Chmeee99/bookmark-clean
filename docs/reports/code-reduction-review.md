# Code-reduction review

Date: 2026-07-13
Primary lens: remove code and tests that do not advance the first runnable path.
Hot paths: Chrome HTML import and persistence; stop/reopen/resume; future local enrichment and search.
Known pain: 12,234 test/fixture lines, incomplete capability islands, and no application entry point.

## Baseline

- `npm test`: 158 passed in 592 ms on 2026-07-13.
- `npm run typecheck`: passed.
- `package.json:5-16` exposes test commands and typecheck only. No runtime command exists.
- Production lines: `core/` 15, `modules/` 2,413, `adapters/` 2,907, `scripts/` 614.
- Tests and fixtures: 12,234 lines.

## Flow traces

1. Import proof: `tests/performance/import-10k.test.ts:327-430` calls the Chrome parser, Catalog service, SQLite migration/store, closes the database, reopens it, and compares the exact snapshot. This is the strongest retained product-adjacent path.
2. Resume proof: `tests/integration/job-worker-resume.test.ts:27-389` composes the Jobs service/store with a fake durable handler. It proves recovery, though no application or real domain handler calls it.
3. Health path: production searches find imports only inside `modules/health/`; every external Health consumer is a contract or unit test. `modules/health/public.ts:99-109` declares checker/service interfaces with no implementation.

## Findings

### HIGH — no production entry point

Evidence: `package.json:5-16` lists test/typecheck commands only. Production factory searches lead to tests, with no composition root.

Consequence: static reachability cannot prove user value for any capability. Cleanup decisions must preserve verified behaviors and safety boundaries, then a later plan must create the first runnable path.

Falsification: a documented runtime command exercises production import, persistence, enrichment, and search from representative input.

### HIGH — Jobs is large and has no real handler

Evidence: Jobs has 3,181 production lines and 7,127 test/helper lines, 10,308 total. The earlier 10,063 count omitted `modules/jobs/public.ts`. That contract permits only `health_check` at line 21. The database-backed resume proof at `tests/integration/job-worker-resume.test.ts:27-389` uses a fake domain repository and handler.

Consequence: the code proves useful durability rules but cannot process the proposed enrichment/search vertical without a public-contract change. Deleting tests blindly would leave a complex state machine unprotected.

Decision: retain production and reduce test detail first. Rebuilding the SQLite compare-and-set queue would discard verified stale-lease recovery and result-before-success behavior that the PRD still needs. Production scope stays fixed until a real vertical caller proves which controls can go.

The first Jobs reduction pass removed 637 test lines. R7A cut the typecheck matrix from 456 to 104 lines. R7B cut the worker happy-path suite from 217 to 106 lines. R7C cut fake-store transitions from 281 to 107 lines. Stable contracts, worker routing, exact completion and retry commands, invalid input rejection, and the durable SQLite state machine remain covered.

1. Compress `tests/contract/jobs-types.typecheck.ts` from 456 lines to at most 150 while keeping closed unions, core signatures, branded IDs, and key negative assignments.
2. Compress `tests/integration/job-worker-service.test.ts` from 217 lines to at most 130. Keep idle, one success path, and invalid-registry coverage; the resume and failure suites retain interruption/reporting behavior.
3. Compress `tests/integration/job-queue-transitions.test.ts` from 281 lines to at most 175. Keep completion, retry scheduling, and invalid-failure policy; SQLite controls/progress suites retain their durable behavior.

After those slices, review SQL test overlap against the reopen proof. Do not delete branch coverage from a complex state machine while the corresponding production feature remains.

### R7D — Jobs SQL overlap review

Decision: keep the lease, recovery, progress, and worker-reopen suites. The recovery and progress files share an expired-lease helper but wrap it in different transactions. Lease recovery uniquely proves compare-and-set rollback; progress recovery uniquely proves projection rollback and recovery before `batch_not_found`. The 389-line reopen test plus its 446-line fixture and 230-line fake durable handler are 1,065 exclusive lines, but they are the only proof of result commit, interruption, reopen, idempotent replay, completion, and stale original-lease rejection.

### R8A — Catalog/import reduction audit

Primary finding: the 222-line SQLite capability spike was removable and R8B deleted it. Its transaction fact now has stronger Catalog and Jobs adapter tests. FTS5, Float32 BLOB, and backup have no production consumer; ADR 0001 preserves the observed Node 26 API and runtime facts. The 68-line temporary-database helper remains shared by Catalog, Jobs, and performance tests.

| Artifact | Decision | Evidence retained |
| --- | --- | --- |
| `sqlite-capabilities.test.ts` (222) | Delete whole file | ADR 0001; production rollback/reopen tests; revalidate future-only capabilities when a consumer lands. |
| Catalog type matrix (189) | R8C completed at 101 lines | Exact unions, ports, brands, recursive nodes, and representative invalid assignments remain. |
| Catalog validator suite (250) | R8D completed at 153 lines | Runtime-empty contract, exact paths, cycles, duplicate IDs, canonical dates, and first failure remain. |
| Chrome HTML suite (375) | R8E completed at 211 lines | Exact fixtures, deterministic values, semantic-entry rejection, timestamps, and bounded parser recovery remain. |
| Catalog service suite (413) | R8F completed at 280 lines | Validation before effects, depth-first allocation, fresh records, and exact store outcome forwarding remain. |
| Catalog SQLite suite (485) | R8H completed at 387 lines | All eight storage boundaries remain; only fixture and assertion mechanics were compressed. |
| 10,000-node proof plus generator (595) | Keep | Only parser-to-Catalog-to-SQLite close/reopen integrity proof at required scale. |

Verified healthy: Catalog owns snapshot validation and identity; the Chrome adapter produces Catalog input without inventing hierarchy; SQLite owns atomic storage and rejects corrupt reconstruction; the generated performance test exercises production code across every retained boundary.

### R8G — Catalog SQLite overlap review

All eight tests remain necessary. The scale proof covers save/load and file reopen more strongly, but it does not inspect fresh reconstructed containers or a missing lookup. The other six tests exercise separate adapter boundaries: exact idempotent migration, duplicate preservation, source IDs scoped per snapshot, atomic rollback after a node constraint failure, rejection without repair of corrupt stored counts, and error mapping after the database closes. R8H shortened the suite from 485 to 387 lines while retaining every named test and direct database check.

### MEDIUM — the LM Studio spike became a parallel implementation

Evidence: `scripts/spikes/lm-studio-probe.ts` is 614 lines, its test is 556 lines, and its fixture is 4 lines. The only code consumer is `tests/spikes/lm-studio-probe.test.ts:123`. ADR 0002 records the endpoint, schema, Qwen failure, and unresolved model comparison at `docs/decisions/0002-lm-studio-protocol.md:54-99`.

Consequence: future provider work may reuse a disposable interface and schema by accident. Every test run also maintains an implementation that no product module calls.

Decision: delete the spike, test, and fixture. Keep the observed result in a shorter ADR note.

### MEDIUM — Health is an incomplete capability island

Status: completed across R3–R5B. The implementation, fixtures, executable contract, and exclusive tests were removed after a separate architecture gate.

Evidence: the three production files total 708 lines and the four contract/unit files total 919 lines. External imports are confined to those tests. `modules/health/public.ts:99-219` declares checker, repository, retry, and staleness surfaces without a service implementation.

Consequence: the public surface invites another horizontal implementation sequence before a product path exists.

Decision: delete the partial Health module and exclusive contract/unit tests. Preserve the semantic rule that one transient failure cannot create a stale recommendation.

### MEDIUM — completed Health fixtures remain as permanent test machinery

Evidence: `tests/helpers/health-loopback-fixture.ts` and `tests/spikes/health-transport-fixtures.test.ts` total 534 lines. ADR 0008 already records the observed Node fetch behavior at `docs/decisions/0008-health-transport-fixtures.md:49-104`.

Consequence: the suite keeps a server harness for a capability removed from the current horizon.

Decision: delete the fixture/test after the Health core and compress ADR 0008 to the facts a future adapter needs.

## Capability decisions

| Capability | Decision | Evidence or retained behavior |
| --- | --- | --- |
| Shared contracts | Consolidate later | Remove brands only when their owning capability is deleted. |
| Chrome HTML and Catalog | Keep, then consolidate tests | Exact hierarchy/order, validation, persistence, and reopen are proven by the 10k path. |
| Jobs | Retain and reduce tests | Resume proof and SQLite recovery are costly to recreate; current handler is fake and job type is Health-only. |
| Health core | Delete | No production caller or service implementation. |
| Health transport spike | Delete after Health core | Runtime facts remain in ADR 0008. |
| LM Studio spike | Delete first | Protocol evidence remains in ADR 0002; no production caller. |
| SQLite capability spike | Consolidate later | Implemented Catalog storage now proves most selected runtime behavior. |
| Test infrastructure | Consolidate with owning capability | Helpers live only while retained tests use them. |

## First three cleanup slices

### R2 — remove the LM Studio spike

Status: completed. The slice removed 1,174 code/test/fixture lines; 140 retained tests and typecheck passed.

Files: `scripts/spikes/lm-studio-probe.ts`, `tests/spikes/lm-studio-probe.test.ts`, `tests/fixtures/lm-studio/synthetic-page.json`, `package.json`, and `docs/decisions/0002-lm-studio-protocol.md`.

Expected deletion: 1,174 code/test/fixture lines. Retain: endpoint family, schema-path fact, failed Qwen result, and unresolved comparison. Verification: `npm test`, `npm run typecheck`, reference search, and `git diff --check`.

### R3 — remove Health implementation and unit tests

Status: completed. The slice removed 1,030 code/test lines; 129 retained tests and typecheck passed.

Files: `modules/health/health-fact-validation.ts`, `modules/health/health-fact-classification.ts`, `tests/unit/health-fact-classification.test.ts`, `tests/unit/health-redirect-resolution.test.ts`, and `package.json`.

Expected deletion: 1,030 code/test lines. Retain: the type-only public contract until its separate architecture and contract-removal slices. Focused verification: `node --test tests/contract/health.contract.test.ts tests/spikes/health-transport-fixtures.test.ts`; then full test, typecheck, reference search, and diff check.

### R4 — remove completed Health transport machinery

Status: completed. The slice removed 534 test/helper lines; 123 retained tests and typecheck passed.

Files: `tests/helpers/health-loopback-fixture.ts`, `tests/spikes/health-transport-fixtures.test.ts`, `package.json`, and `docs/decisions/0008-health-transport-fixtures.md`.

Expected deletion: 534 code/test lines plus ADR compression. Retain: stable Node fetch facts and the ban on interpreting exception messages. Verification: full test, typecheck, reference search, and diff check.

## Verified healthy

- The full suite and strict typecheck pass before deletion.
- The 10,000-node import still exercises production parser, Catalog, SQLite, close, reopen, and read-back.
- Jobs interruption/reopen has one genuine database-backed integration proof, with the domain result repository disclosed as fake.
- Health classification does not infer meaning from body or diagnostic prose; this rule remains part of the target architecture after code removal.
