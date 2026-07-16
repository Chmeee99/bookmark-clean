# Adversarial project review

Date: 2026-07-15
Repository state reviewed: `main` at `10f2918`
Primary remediation plan: [`docs/plans/active/adversarial-audit-remediation.md`](../plans/active/adversarial-audit-remediation.md)

## Verdict

The project has a strong small-module foundation, good typed domain seams, unusually thorough state-machine tests, and a real runnable import-to-enqueue path. It does not need a rewrite.

It is not yet safe to claim that the local Health worker is fully bounded or that its request-target safety is complete. Four high-severity defects should be fixed before unattended use or use on a shared machine:

1. the network timeout resets on response activity and does not impose an absolute deadline;
2. several special-purpose IPv6 targets pass the SSRF safety check;
3. SQLite databases containing private bookmark data are created with mode `0644`;
4. the declared typecheck omits most production files and hides 30 strict TypeScript errors.

Six medium-severity issues affect error classification, repository-result validation, Catalog/CLI ownership, resource bounds, architecture enforcement, and project-memory accuracy. The recommended response is incremental: land the three safety repairs, make the compiler/test gates honest, then repair the two domain seams. The detailed rolling plan contains 10 near-term slices and a paste-ready first Slice Packet.

## Scope and method

The review covered:

- repository instructions, README, PRD, module map, ADRs, active plans, and ops ledgers;
- all production source under `apps`, `core`, `modules`, and `adapters`;
- public contracts, implementation imports, SQLite schemas/transactions, Node request safety, validation boundaries, CLI composition, and test enrollment;
- declared tests/typecheck, an independent all-source compiler check, dependency audit, generated 10,000-node import, and a real temporary import → inspect → preview → enqueue flow;
- controlled adversarial probes for slow-drip HTTP, special-purpose IPv6, structured DNS errors, invalid TLS certificates, malformed Health repository values, deep bookmark trees, and database file modes;
- git ignore/history checks for the private Chrome export and a production-secret scan.

The primary lens was correctness plus agent-safe maintainability. Hot paths were selected from the README and current module map. The audit did not change runtime code or tests.

## Verification summary

| Check | Result | Notes |
| --- | --- | --- |
| `npm test` | PASS | 194/194 tests; 51/51 discovered `*.test.ts` files are currently listed. |
| `npm run typecheck` | PASS, incomplete | `tsconfig.json` includes only tests; dynamic CommonJS edges do not pull in most production files. |
| Strict TypeScript over `apps/**/*.ts core/**/*.ts modules/**/*.ts adapters/**/*.ts` | FAIL | 30 errors in 10 production files. |
| `npm audit --offline` | PASS | 0 known vulnerabilities in the installed lockfile graph. |
| Temporary import → inspect → preview → enqueue | PASS | One root, folder, bookmark, preview job, and durable active batch produced through package commands. |
| 10,000-node generated import | PASS | About 201 ms, 88.5 MB observed RSS increase, 5.7 MB database on Node 26.4.0. |
| Private export hygiene | PASS | The real Chrome export is ignored, untracked, absent from history, and mode `0600`. |
| SQLite output privacy | FAIL | The derived database was mode `0644`. |
| Slow-drip total deadline | FAIL | `timeoutMs: 50` completed successfully after about 193 ms. |
| Special-purpose IPv6 policy | FAIL | Three unsafe/non-global examples were approved. |
| Structured DNS/TLS classification | FAIL | `ENOTFOUND` became `unsupported_url`; an untrusted certificate became `unknown_transport`. |
| Deep-tree bound | FAIL | Parsing about 4,000 nested folders raised `RangeError: Maximum call stack size exceeded`. |

## Ranked findings

| ID | Severity | Finding | Recommended plan location |
| --- | --- | --- | --- |
| F-01 | HIGH | Health transport does not enforce one absolute deadline | Slice 1 |
| F-02 | HIGH | Request-target resolver accepts unsafe/special-purpose IPv6 forms | Slice 2 |
| F-03 | HIGH | SQLite files expose private bookmark data through `0644` mode | Slice 3 |
| F-04 | HIGH | Production typecheck is incomplete and hides 30 errors | Slices 4–6 |
| F-05 | MEDIUM | DNS and common TLS failures are misclassified | Slice 7 |
| F-06 | MEDIUM | Health trusts structurally incomplete repository results | Slice 8 |
| F-07 | MEDIUM | CLI owns Catalog hierarchy projection despite the documented boundary | Slices 9–10 |
| F-08 | MEDIUM | Recursive input/traversal paths have no depth or node budget | Rough backlog: input bounds |
| F-09 | MEDIUM | Verification and architecture guards are not self-maintaining | Slice 6; CI backlog |
| F-10 | MEDIUM | Active plans, ADRs, and risks contain stale or disproven state | Rough backlog: project-memory repair |

## Detailed findings

### F-01 — Health transport does not enforce one absolute deadline

**Evidence**

- The module map defines `HealthTransportRequest.timeoutMs` as the deadline for resolution plus the complete socket exchange.
- `adapters/node/health-transport.ts:236` uses `request.setTimeout(...)` after resolution. Node request timeouts are inactivity timers and are reset by activity.
- A controlled server emitted one byte every 30 ms for roughly 190 ms. With `timeoutMs: 50`, the current transport returned a successful 200 response after about 193 ms.

**Consequence**

A peer can keep a Health job and its worker lease occupied indefinitely by sending data just before each inactivity timeout. This breaks the documented request budget and weakens queue throughput guarantees.

**Required repair**

Use one absolute elapsed timer beginning before resolution. Pass only remaining time into socket setup, destroy any active response and request on expiry, clear the timer on every settlement path, and add a slow-drip regression test.

**Falsification condition**

This finding is falsified only if a test using continuous sub-timeout activity reliably returns typed `timeout` within the original total budget. The current controlled probe does not.

### F-02 — Request-target resolver accepts unsafe/special-purpose IPv6 forms

**Evidence**

- `adapters/node/health-request-target-resolver.ts:111-133` blocks loopback, ULA, link-local, multicast, documentation, benchmarking, and IPv4-mapped unsafe addresses, but it does not cover several translation and non-global prefixes.
- Direct controlled resolutions approved:
  - `64:ff9b:1::1`;
  - `64:ff9b::7f00:1`, which embeds IPv4 loopback in the RFC 6052 translation prefix;
  - `100::1`, from the discard-only prefix.
- The [IANA IPv6 Special-Purpose Address Registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml), [RFC 6052](https://www.rfc-editor.org/info/rfc6052/), and [RFC 8215](https://www.rfc-editor.org/info/rfc8215) define the relevant special-use and translation ranges.

**Consequence**

Where local NAT64 or similar routing exists, an approved translated address can reach a destination that the IPv4 policy would reject. Even without such routing, non-global/discard targets pass a boundary documented as rejecting unsafe destinations.

**Required repair**

Create an explicit, tested IPv6 policy derived from a dated IANA registry snapshot. Reject non-global blocks and decode known embedded IPv4 forms before approval. Preserve deterministic rejection of a mixed safe/unsafe DNS answer set.

**Falsification condition**

This finding is falsified if all three probes are rejected before socket creation and prefix-edge/public-control tests show that the policy does not overblock ordinary public IPv6.

### F-03 — SQLite files expose private bookmark data through permissive mode

**Evidence**

- `adapters/sqlite/catalog-database.ts:80` and `adapters/sqlite/bookmark-clean-database.ts:106` pass the user path directly to `DatabaseSync` without secure pre-creation or permission tightening.
- The audited source Chrome export was mode `0600`; the SQLite file created from it was `-rw-r--r--` (`0644`).
- The database stores bookmark titles and URLs in clear text.

**Consequence**

On a multi-user POSIX machine, another local account can read the derived private bookmark library even though it cannot read the original export.

**Required repair**

Add one private SQLite file-preparation helper used by both public openers. Create new file-backed databases with `0600`, tighten existing files before use, skip `:memory:`, and return an existing typed open failure if hardening fails.

**Falsification condition**

This finding is falsified when integration tests prove `(mode & 0o077) === 0` for new and pre-existing files through both openers on POSIX.

### F-04 — Production typecheck is incomplete and hides 30 errors

**Evidence**

- `tsconfig.json:10` includes only `tests/**/*.ts`.
- Production code is loaded mostly with string-literal CommonJS `require()`, so TypeScript does not follow every runtime edge from tests. `tsc --listFilesOnly` reached only 17 production files.
- The reproducible all-source command below fails with 30 errors across 10 files:

```sh
npx tsc --noEmit --target ES2024 --module NodeNext --moduleResolution NodeNext --strict --forceConsistentCasingInFileNames apps/**/*.ts core/**/*.ts modules/**/*.ts adapters/**/*.ts
```

- Errors include nullable response status codes, possibly undefined database handles, a nullable `saveIfAbsent` success, an invalid `JobBatchId` import, and many un-narrowed `unknown` values at Jobs/SQLite validation boundaries.

**Consequence**

`npm run typecheck` gives false confidence and allows production defects or unsafe casts to merge. Runtime tests currently mask the errors; the compiler has not proved them impossible.

**Required repair**

Repair the errors in two behavior-neutral clusters, then expand `tsconfig` to all source/test roots. Do not use ignore directives, blanket casts, or weaker compiler options.

**Falsification condition**

This finding is falsified when the all-source command and the permanent `npm run typecheck` both pass and enumerate all production roots.

### F-05 — DNS and common TLS failures are misclassified

**Evidence**

- `adapters/node/health-request-target-resolver.ts:212` catches every lookup exception and returns `unsupported_url`. An injected structured `ENOTFOUND` therefore never reaches the declared `dns_failure` code.
- `adapters/node/health-transport.ts:87-96` maps only `EPROTO` and `ERR_SSL_*` to `tls_error`.
- A controlled untrusted certificate produced a structured certificate error but was returned as `unknown_transport`.
- `modules/health/public.ts` and the module map already declare DNS and TLS outcomes as expected durable facts.

**Consequence**

Missing domains appear to be unsupported inputs, while certificate failures remain uncertain. This degrades the bookmark-health result and leaves declared status paths effectively unreachable for common production failures.

**Required repair**

Give the private resolver a structured failure union that distinguishes unsafe/malformed URLs, DNS failures, and unexpected adapter failures. Map an explicit allowlist of Node DNS/certificate codes. Never parse exception messages.

**Falsification condition**

This finding is falsified when controlled `ENOTFOUND` and invalid-certificate cases return `dns_failure` and `tls_error`, while an unknown structured code remains `unknown_transport`.

### F-06 — Health trusts structurally incomplete repository results

**Evidence**

- `modules/health/health-checker.ts:82-92` validates only `id`, `bookmarkId`, `inputVersion`, and a non-empty `requestedUrl` before accepting a loaded/saved `HealthObservation`.
- The module map says every repository result is validated at its receiving boundary.
- Existing validation tests use an obviously malformed `{ id }` object. A matching-looking object with those four properties but without status, checked time, method, redirects, duration, retry count, or headers passes `matchesInput`.

**Consequence**

A buggy alternate repository or corrupted adapter return can authorize a committed Health result and allow Jobs to mark work successful without a valid durable observation.

**Required repair**

Add a Health-owned full structural validator for repository returns and validate request identity, enums, exact optional fields, numeric ranges, redirects, and headers. Reject malformed data as storage unavailable; do not fill defaults or reconstruct meaning.

**Falsification condition**

This finding is falsified when a table of one-field corruptions for both load and save paths is rejected while every valid observation family and exact replay remains accepted.

### F-07 — CLI owns Catalog hierarchy projection despite the documented boundary

**Evidence**

- `apps/local-cli/inspect-command.ts:120-145` recursively traverses `BookmarkRecord` values and calculates descendant bookmark counts.
- The module map explicitly forbids CLI/orchestrator traversal of Catalog snapshots and states that Catalog owns hierarchy meaning.
- The CLI must understand the full recursive Catalog record shape even though it only needs a folder-only output projection.

**Consequence**

Any future local service or UI must duplicate the algorithm or reuse CLI code. Catalog hierarchy changes have a larger consumer impact, and the architecture record is not truthful about the current seam.

**Required repair**

Add an isolated type-only Catalog inspection-query contract, then implement it and migrate the CLI in a second slice. The projection contains snapshot totals and folder IDs/titles/counts only—never URLs or bookmark titles.

**Falsification condition**

This finding is falsified when `inspect-command.ts` performs no snapshot traversal/counting and exact current command output is produced through a public Catalog query.

### F-08 — Recursive input and traversal paths have no resource budget

**Evidence**

- The Chrome parser, Catalog validation/build, SQLite reconstruction, Processing traversal, and CLI inspection all contain recursive tree walks.
- Parser probes at 100–2,000 nested folders completed; around 4,000 nested folders raised `RangeError: Maximum call stack size exceeded`.
- No public failure code or documented maximum input bytes, nodes, or depth exists.

**Consequence**

A malformed or unusually deep local export can trigger an untyped crash/denial of service. Repairing only the parser would leave Catalog and stored-data readers with inconsistent limits.

**Required repair**

Start with an architecture/contract slice deciding explicit byte/node/depth budgets or an iterative traversal invariant. Add source-side rejection before recursion and receiving-side Catalog validation. Migrate other traversals incrementally.

**Falsification condition**

This finding is falsified when an agreed maximum-depth boundary returns a typed failure without stack overflow, or all relevant paths are iterative and pass a substantially deeper stress case within a measured budget.

### F-09 — Verification and architecture guards are not self-maintaining

**Evidence**

- `package.json:11` manually enumerates all 51 test files. The list is correct today, but a new test is silently skipped unless the script is edited.
- Current source imports respect public module seams, but no test/lint rule prevents a future cross-module internal import.
- The repository has no `.github` CI workflow, no single `check` script, and no package `engines` declaration despite requiring Node 26.

**Consequence**

Junior developers or coding agents can add an unenrolled test or violate an internal module boundary while every declared local gate still passes. Node version drift can also change native TypeScript/SQLite behavior.

**Required repair**

After production compiles, add deterministic test discovery, a TypeScript-AST architecture contract test, `npm run check`, and a Node 26 engine declaration. Add the smallest host-appropriate CI workflow in a later slice.

**Falsification condition**

This finding is falsified when a newly added test is automatically run, a synthetic forbidden internal import fails a gate, all source is typechecked, and the repository’s standard check command runs automatically in the chosen CI host.

### F-10 — Project memory contains stale or disproven state

**Evidence**

- Before this audit plan was added, every file under `docs/plans/active/` was marked complete or closed even though the repository convention says active plans contain upcoming work only.
- `first-health-handler.md` claims strict typechecking and broad TLS evidence; `one-job-worker.md` claims the transport deadline covers the socket exchange. F-01 and F-04 disprove the broad readings of those claims.
- ADR 0008 says the loopback fixture was removed and a future production adapter is needed, but both now exist.
- `docs/ops/risks.csv` keeps RISK-002 open for a disposable LM Studio spike that the code-reduction report says was removed.

**Consequence**

New contributors and agents can plan from obsolete facts, redo completed work, or trust a verification claim whose scope was narrower than its wording.

**Required repair**

After the underlying defects are fixed, archive completed active plans, supersede stale ADR text without erasing history, close resolved risks, and annotate old verification claims with their actual scope.

**Falsification condition**

This finding is falsified when `docs/plans/active/` contains only actionable work, current ADRs describe the executable adapter/fixtures, resolved risks are closed, and no current document claims a broader gate than the repository runs.

## Architecture and seam assessment

### Correct and worth preserving

- The orchestration core is small and depends on typed interfaces. It has no direct dependency on SQLite or Node implementations.
- Catalog, Processing, Jobs, and Health each expose one public surface; the current import scan found no runtime cross-module internal imports.
- Jobs owns its state machine and policies. SQLite owns persistence mechanics and uses transactions for enqueue, leases, recovery, and result transitions.
- Processing authors selected-scope work and budgets; Jobs remains the queue executor.
- Health records durable observations before a successful job result, and replay/idempotency paths have strong integration coverage.
- SQL statements use bound parameters; migration and close behavior are well tested.
- CLI output is deliberately redacted and does not print bookmark URLs/titles or lease tokens.

### Architecture record change made by this audit

The module map previously mixed current executable modules with target modules in one system description. It now includes a current/target implementation-status index and records three required repairs:

- Catalog-owned inspection projection;
- Node-owned timeout/request-safety implementation fixes;
- Health-owned full repository-result validation.

No runtime boundary or public contract changed during the audit.

## Errors and omissions not promoted to near-term findings

- Several files slightly exceed the repository’s 300-line decomposition prompt, mainly cohesive Jobs/SQLite validators. Split them only when a touched file shows more than one responsibility; line count alone does not justify churn.
- The installed dependency graph is small and currently clean offline. Online freshness was not required for this audit and no dependency update is recommended without a specific need.
- Line/branch coverage percentages are not configured, so this review cannot claim a numeric coverage threshold. Behavior coverage is broad, but absence of coverage instrumentation remains a measurement limitation.
- The project intentionally lacks public-internet Health success evidence, a web UI, a Chrome API connector, enrichment/retrieval/review modules, and Windows-specific file-permission guarantees. Those target capabilities are not current implementation defects.
- Ordinary `0600` hardening does not solve database encryption or hostile-directory/symlink races. Reassess that threat model if the project becomes a multi-user service.

## Recommended implementation order

1. **Immediate safety:** absolute deadline, special-purpose IPv6 policy, SQLite owner-only mode.
2. **Honest gates:** repair all strict production errors, then expand typecheck, automatic test discovery, and boundary enforcement.
3. **Correct domain outcomes:** DNS/TLS mappings and full Health repository validation.
4. **Correct ownership:** Catalog inspection contract, then implementation/CLI migration.
5. **Next planning refresh:** input resource bounds, project-memory cleanup, and CI.

The active plan spells these out as 10 small slices with source evidence, likely files, forbidden behavior, invariants, tests, acceptance criteria, dependencies, complexity, and executor tier. Slice 1 is paste-ready for the repository’s `single-slice-executor` workflow.

## Residual risk after the proposed queue

After the 10 ready slices, the largest known residual risk is deep/unbounded tree handling. It requires a public resource-policy decision and should not be patched independently in each recursive function. Documentation cleanup and CI are also still required to make the corrected state durable for a larger team.
