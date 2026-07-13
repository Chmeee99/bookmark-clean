# Bookmark Clean product requirements

Status: draft for review  
Revision: 0.1 — 2026-07-12  
Implementation status: foundation import path implemented; durable processing and read-only vertical slice remain in progress

## Product decision

Bookmark Clean will be a local application with a small Chrome extension as a connector. It should not be built as an extension-only product.

The local application will own SQLite, crawling, extraction, job scheduling, model calls, search, review state, and the main interface. The extension will read Chrome's bookmark tree, report bookmark changes, and eventually apply explicitly approved changes. This keeps long-running work outside Chrome's short-lived extension service worker and gives the product a normal database, filesystem access, testable workers, and model-provider freedom.

The first useful release will be read-only with respect to Chrome. It will import a bookmark snapshot, process a selected folder, enrich the results through LM Studio, and make them searchable. Chrome write-back comes only after review, backup, conflict detection, and rollback exist.

## Product interpretation

The problem is not that 10,000 bookmarks need tidying. The collection has lost enough context that titles, URLs, and folders no longer explain why many items were saved. Bookmark Clean should recover that context while helping the user remove obvious waste safely.

The product has two connected jobs:

1. Library maintenance: find broken links, redirects, duplicates, and low-confidence stale items, then present evidence for a decision.
2. Knowledge retrieval: add grounded descriptions and searchable signals so an old bookmark can be found from a half-remembered need.

Success means the collection becomes more useful after every processing session, even if most of it remains untouched.

## Intended user

The initial user is one technically comfortable person with a large Chrome collection, a Mac, and local models in LM Studio. The design may support other users later, but packaging, multi-user accounts, cloud sync, and Chrome Web Store distribution are outside the first release.

## Product principles

- Local by default. URLs, page content, annotations, embeddings, and model prompts stay on the machine unless a remote provider is explicitly enabled.
- Evidence before action. Health and staleness decisions show their observations, dates, and confidence.
- Progressive value. A selected folder can be processed without waiting for a full 10,000-bookmark migration.
- Reversible changes. Chrome remains unchanged until the user approves a reviewed change set with a backup.
- Deterministic workflow. Models produce structured enrichment; application code validates, stores, and executes it. Application code never guesses meaning from model prose or errors.
- Measured model choice. The smallest model that clears a quality threshold wins. Parameter count alone is not the decision.
- Original data is permanent evidence. Imported titles, URLs, paths, order, and timestamps are never overwritten in the local history.

## Goals

The product should:

1. Import at least 10,000 Chrome bookmarks while preserving hierarchy and sibling order.
2. Process selected scopes incrementally and resume after interruption.
3. Record nuanced URL health with enough evidence to distinguish dead pages from temporary or access-related failures.
4. Create grounded descriptions, topics, entities, and likely-save intent using a local model.
5. Search titles, URLs, folders, extracted text, metadata, and embeddings together.
6. Explain why each result matched and why each cleanup action was suggested.
7. Produce reviewed, conflict-aware Chrome changes in a later phase.
8. Double as a practical learning project in local AI, evals, Chrome integration, queues, retrieval, and human-in-the-loop systems.

## Non-goals for the first useful release

- Automatic deletion or bulk mutation of Chrome bookmarks.
- A general web archive or full-page archival system.
- Continuous browser-history surveillance.
- Multi-user collaboration or cloud accounts.
- A universal ontology generated in advance.
- An autonomous agent that decides what the user values.
- Perfect classification of every hostile, authenticated, or JavaScript-heavy site.
- A desktop shell such as Electron or Tauri. The initial UI can run locally in the browser.

## Primary user workflows

### First run

1. Start the local service and open its local web interface.
2. Import a Chrome bookmark snapshot through the connector or a Chrome HTML export.
3. Review the imported roots, counts, and ordering.
4. Confirm LM Studio connectivity and choose a tested enrichment and embedding profile.
5. Select a folder from the Bookmarks Bar and start a bounded processing run.

### Process a folder

1. Select a folder, bookmarks, or saved processing filter.
2. Preview the number of jobs, network requests, and estimated model work.
3. Start, pause, resume, or cancel the run.
4. Inspect progress and failures without blocking search or review.
5. Open any bookmark to see health evidence, extracted content, generated metadata, and provenance.

### Find an old bookmark

1. Enter a natural-language query or conventional search terms.
2. Add exact filters when useful: folder, tag, health, date, content type, or processing state.
3. See blended results with the contributing match signals.
4. Correct metadata or pin a useful result.

### Review cleanup suggestions

1. Open a review queue for stale items, redirects, duplicates, or low-confidence enrichments.
2. Compare original data, current evidence, and the proposed action.
3. Keep, defer, edit, approve, or reject the proposal.
4. In the write-back phase, apply an approved change set after a fresh Chrome snapshot and conflict check.

## Chrome integration recommendation

Chrome exposes bookmark IDs, tree order, title, URL, creation time, folder modification time, and, on supported versions, last-used time. It can create, update, move, and remove normal nodes. It cannot attach arbitrary summaries or tags, and special root folders cannot be replaced or moved. All enrichment therefore belongs in SQLite.

The integration will evolve in three steps:

1. HTML export importer: a zero-risk fallback and fixture source for the first technical spike.
2. Manifest V3 connector: reads `chrome.bookmarks.getTree()`, sends versioned snapshot chunks to the local app, and listens for bookmark events. It contains no crawler, model logic, or durable job queue.
3. Reviewed write-back connector: accepts a typed change set, re-reads affected nodes, rejects conflicts, creates a backup snapshot, and applies only approved operations.

Native messaging is the preferred production bridge because Chrome restricts it to declared extension origins and launches a registered local host. Protocol messages will be bounded and chunked; Chrome limits host-to-extension native messages to 1 MB, and a full snapshot should never become one monolithic payload. A paired loopback HTTP bridge is acceptable for the first developer build if it binds only to `127.0.0.1`, requires an unguessable token, validates the extension origin where available, and exposes no database-shaped endpoints.

## Technical shape

The initial stack is TypeScript on Node.js 26, a local HTTP service, a browser UI, a Manifest V3 extension, and SQLite. Node's built-in SQLite support should be tried before adding a native database dependency. SQLite FTS5 will handle lexical search.

Embedding vectors will be stored in SQLite with model ID, dimensions, and version. With roughly 10,000 bookmarks, exact cosine scoring in the local process is small enough for the first release. A vector database or SQLite vector extension earns a place only if measured search latency requires it.

The application uses a small orchestration core and replaceable modules. The durable module and contract design is recorded in `docs/architecture/module-map.md`.

## Data model

The schema may be normalized differently during implementation, but these concepts and relationships are required.

| Entity | Purpose | Important fields |
| --- | --- | --- |
| `bookmark_snapshot` | One immutable import from Chrome | source, captured_at, browser_profile, root_hash |
| `bookmark_node` | Original and current known Chrome node | internal_id, chrome_id, parent_id, index, title, url, dates, snapshot_id |
| `bookmark_identity` | Stable local identity across snapshots | internal_id, normalized_url, first_seen_at, last_seen_at |
| `health_observation` | One network check and its evidence | status, HTTP status, final URL, redirect chain, timing, error, checked_at |
| `content_artifact` | Retrieved and extracted page material | retrieval metadata, canonical URL, content type, language, text hash, sanitized text |
| `enrichment` | Validated model output | description, detail, literal tags, topics, entities, intent, warnings, confidence |
| `embedding` | Vector for a named source text | model, dimensions, vector, source hash, created_at |
| `duplicate_group` | Evidence that several nodes may overlap | kind, members, canonical candidate, confidence, evidence |
| `job` | Resumable unit of work | type, target, state, attempts, lease, timestamps, error code |
| `review_item` | A proposed user decision | type, evidence, proposed action, state, decision, decided_at |
| `change_set` | Reviewed Chrome mutations | base_snapshot, operations, approval, apply result, rollback data |
| `generation_run` | Reproducibility record | provider, model, parameters, prompt version, schema version, duration, token counts |
| `user_correction` | User-owned truth over generated metadata | field, old value, new value, reason, created_at |

Large page bodies may be compressed or moved to content-addressed files later. SQLite remains the source of record for references, hashes, and provenance.

## Processing pipeline

Each stage is idempotent and writes a durable result before the next stage is scheduled.

1. Import a snapshot and reconcile stable local identities.
2. Normalize the URL without losing the original.
3. Run a bounded health check and record the observation.
4. Retrieve page metadata and readable content when policy allows.
5. Sanitize and reduce the content to a high-signal model input.
6. Ask the configured model for a strict enrichment object.
7. Validate the object against its schema. Invalid output becomes a typed failure eligible for provider retry; downstream code does not repair its meaning.
8. Generate an embedding from the approved source text.
9. update lexical indexes and duplicate evidence.
10. Create review items when policy thresholds are crossed.

Jobs move through `pending`, `leased`, `succeeded`, `retry_wait`, `failed`, or `cancelled`. A crashed worker can safely release an expired lease and continue. Pausing prevents new leases while allowing current bounded work to finish.

The default queue follows Chrome tree order, beginning with the Bookmarks Bar. User-selected work receives a higher priority without destroying the original sequence.

## URL health and staleness

Health is an observation. Staleness is a policy decision based on observations over time. They must remain separate.

Initial health statuses are:

- `healthy`
- `redirect_permanent`
- `redirect_temporary`
- `authentication_required`
- `forbidden`
- `rate_limited`
- `server_error`
- `dns_failure`
- `timeout`
- `tls_error`
- `not_found`
- `gone`
- `soft_404_suspected`
- `parked_domain_suspected`
- `unsupported_url`
- `uncertain`

The checker records method, status code, final URL, redirect hops, response time, retry count, selected headers, error code, and body fingerprint when a body is retrieved. Requests use global and per-domain concurrency limits, bounded redirects, jittered retries, and a user-visible pause control.

No single timeout, `403`, `429`, bot challenge, or JavaScript shell makes a bookmark stale. A `404` or `410` is strong evidence, yet deletion still requires review. A rule-based policy combines repeated observations, elapsed time, domain state, replacement evidence, content mismatch, and user exceptions. Every policy result returns named reasons and the observation IDs that support them.

Model-assisted soft-404, parked-domain, and content-change assessments are separate typed evidence. They never replace the network record.

## Content extraction and model contract

The extractor prefers cheap, grounded inputs in this order:

1. Response metadata, canonical URL, Open Graph fields, JSON-LD, and page title.
2. Main readable content from sanitized HTML.
3. Site-specific public material such as a repository README or documentation overview through a dedicated adapter.
4. A rendered-browser fallback for selected failures after user-visible consent.

Fetched text is untrusted data. It is delimited as source material and cannot issue instructions, select tools, change policy, or alter the output schema.

The enrichment provider must return a versioned object containing:

- one-sentence description;
- useful paragraph explaining contents, problem addressed, and likely retrieval occasion;
- literal tags grounded in page text or metadata;
- broader topics;
- named entities with types;
- likely reason the bookmark was saved;
- language and content type;
- per-field confidence;
- extraction warnings;
- evidence references to supplied text spans or metadata fields.

The original provider response is retained for audit. Only schema-valid fields enter the active enrichment record. User corrections override generated values and are never silently replaced by a later run.

## LM Studio model evaluation

Model selection is a repeatable product capability. The repository will contain an evaluation suite and a versioned benchmark set.

The LM Studio server is available at `http://127.0.0.1:1234`. Models detected on 2026-07-12 include:

- Qwen3.5 9B, Q4_K_M — first small enrichment candidate;
- Gemma 4 12B, Q4_K_M — middle-size comparison;
- Qwen3.6 27B, MLX 4-bit — quality reference;
- Gemma 4 12B coder fine-tune — included only to test whether specialization hurts this task;
- DiffusionGemma 26B A4B — exploratory candidate if its runtime behavior is suitable;
- Nomic Embed Text v1.5, Q4_K_M — first embedding baseline.

The enrichment benchmark will use 60–100 bookmarks sampled across articles, products, documentation, repositories, videos, sparse landing pages, German pages, English pages, redirects, failures, and prompt-injection examples. A small hand-authored gold set will define acceptable descriptions, required facts, forbidden unsupported claims, useful tags, and entities.

Each candidate runs the same extraction input, prompt, schema, context budget, and decoding policy. The report records:

- schema-valid response rate;
- unsupported-claim rate;
- required-fact coverage;
- tag precision and useful-topic coverage;
- entity accuracy;
- blinded human usefulness score;
- prompt-injection failure rate;
- median and p95 latency;
- bookmarks per hour;
- memory use and model size;
- input and output token counts.

The smallest candidate wins when it meets all hard gates: at least 99% schema-valid output after one provider-level retry, no critical prompt-injection failures, an unsupported-claim rate below the agreed threshold, and a human usefulness score close enough to the quality reference that the difference does not matter in search. Exact thresholds will be locked after labeling the pilot set.

Embedding models get a separate retrieval benchmark. Human-written queries will map to one or more relevant bookmarks. We will compare recall@10, mean reciprocal rank, German/English behavior, latency, and storage cost. The enrichment model and embedding model may be different.

## Search

The first search implementation blends:

- SQLite FTS5 scores over title, URL, folder path, descriptions, tags, and extracted text;
- exact filters chosen in the interface;
- exact vector similarity over the query and indexed bookmark representations;
- health and confidence signals used only as explicit boosts or filters.

Results show the title, URL, folder, health, description, matching excerpt, tags, and the contributing lexical, semantic, and filter signals.

Natural-language query planning beyond embedding search is optional. If added, a provider must return a strict `SearchPlan` schema. The application validates or rejects the plan; it does not infer filters from assistant prose or malformed output.

## Duplicate detection

Duplicate evidence is layered:

1. Exact normalized URL.
2. Tracking-parameter, fragment, scheme, and trailing-slash variants.
3. Shared final or canonical URL.
4. Matching content fingerprints.
5. High semantic similarity with compatible content type and site evidence.

A duplicate group is a review proposal. The product shows all folder placements and metadata that an automatic merge would lose. No semantic duplicate is merged automatically.

## Interface

The local web interface has five areas:

- Library: bookmark tree and table with processing, health, and enrichment state.
- Search: one prominent query box with conventional filters and explainable results.
- Processing: queue, throughput, failures, current model, pause, resume, and estimated remaining work.
- Review: stale, redirect, duplicate, extraction, low-confidence, and later write-back queues.
- Settings and lab: crawler limits, taxonomy, providers, prompt versions, model benchmark runs, and privacy controls.

The bookmark detail page is the evidence hub. It shows original Chrome data, health history, sanitized extraction, active enrichment, raw provenance, duplicates, corrections, and proposed actions.

## Safety and privacy

- The service binds to loopback by default and refuses non-loopback traffic unless explicitly configured.
- Remote providers are disabled by default and require a separate opt-in profile.
- Provider logs avoid page bodies and secrets by default.
- HTML previews are sanitized and rendered without scripts.
- Retrieved content is treated as hostile input and cannot direct application behavior.
- Authentication cookies are not collected in the initial release.
- Chrome write-back requires a fresh snapshot, conflict check, approved change set, backup, and result log.
- Deletion remains a distinct operation with an additional confirmation.
- API tokens and pairing secrets are stored outside source control with restrictive permissions.

## Phases

### Phase 0: evidence and technical spikes

Deliver the Chrome field probe, 10,000-node import benchmark, health-check fixture set, extraction comparison, LM Studio enrichment eval, embedding retrieval eval, and architecture decision records. This phase ends with explicit model profiles and a proven database/search path.

### Phase 1: read-only vertical slice

Import a real bookmark snapshot, preserve hierarchy, process one selected folder, run health checks, extract readable text, enrich through LM Studio, store results in SQLite, resume jobs, and search the processed set. Include the library, processing, search, and detail views.

### Phase 2: review and correction

Add health history, quarantine policy, redirects, duplicate groups, editable metadata, user corrections, review queues, and evaluation feedback capture.

### Phase 3: Chrome connector hardening

Add incremental snapshot reconciliation, bookmark event capture, native-messaging packaging, pairing, connector diagnostics, and repeatable browser integration tests.

### Phase 4: controlled write-back

Add typed change sets, approval, backup, conflict detection, application logs, rollback, and deletion confirmation.

### Phase 5: optional agentic features

Add bounded workflows that can propose replacement research, rerun selected enrichments, or assemble review batches. Every agent action uses declared tools, budgets, typed outputs, and approval gates. Open-ended browsing or autonomous deletion is excluded.

## MVP acceptance criteria

The read-only MVP is complete when it can demonstrate all of the following on the user's machine:

1. Import 10,000 bookmark nodes with matching hierarchy and sibling order.
2. Process a selected folder and resume cleanly after stopping the service mid-run.
3. Record distinct healthy, redirect, not-found, access, timeout, and uncertain outcomes.
4. Avoid a stale recommendation from one transient failure.
5. Produce schema-valid, grounded local enrichment that passes the locked evaluation threshold.
6. Return better top-10 results than Chrome search on the benchmark query set.
7. Explain every search match and cleanup recommendation with stored signals.
8. Detect exact, normalized, redirect, and canonical URL duplicate candidates.
9. Keep the interface responsive during background work.
10. Send no bookmark data to a remote model in the default configuration.
11. Leave Chrome unchanged.
12. Preserve model, prompt, extraction, and input provenance for every generated field.

## Main risks and responses

| Risk | Response |
| --- | --- |
| Bot protection makes health results misleading | Keep access failures distinct, retry over time, use rendered fallback selectively, require evidence for staleness |
| Small models produce fluent unsupported details | Ground output to supplied spans, require evidence references, validate schemas, benchmark hallucinations |
| Local processing of 10,000 pages takes too long | Prioritize useful folders, cache by content hash, cap extraction, measure throughput, make all stages resumable |
| Native messaging installation becomes a project of its own | Start with HTML import and a paired loopback bridge; preserve one connector contract |
| Bookmark IDs or content change between snapshots | Maintain local identities, immutable snapshots, and explicit reconciliation/conflict rules |
| Vector infrastructure adds fragility | Use exact in-process scoring at this scale; add an index only after measurement |
| Taxonomy work consumes the project | Start with editable tags and user corrections; measure search value before expanding controls |
| The project becomes an AI demo with weak utility | Gate every AI feature against retrieval or review outcomes and keep deterministic baselines |

## Learning agenda

Each phase should leave one artifact that explains what was learned:

- An architecture decision record explains why the product is hybrid and where Chrome's boundaries matter.
- The model report shows how eval design changes the answer to “which model is good enough?”
- The queue trace demonstrates leases, idempotency, retry policy, and resumability.
- The enrichment provenance view makes structured generation and prompt injection concrete.
- The search report compares lexical, semantic, and blended retrieval with real queries.
- The write-back design demonstrates human approval, optimistic concurrency, audit logs, and rollback.
- Optional agents come last, after the tools and contracts they are allowed to use are reliable.

This makes the project credible portfolio evidence: a product decision, a measured local-AI system, and a safety-conscious Chrome integration with visible trade-offs.

## Assumptions and decisions still open

- The initial platform is macOS and one Chrome profile.
- English and German retrieval both matter.
- The local service can be started from the terminal during early phases.
- An HTML bookmark export can be supplied as an early realistic fixture.
- Page login sessions and Chrome cookies stay out of scope until a specific use case justifies them.
- The final connector transport will be selected after comparing native-messaging setup cost with a paired loopback bridge.
- The exact enrichment quality thresholds require a labeled pilot set and cannot be chosen honestly in advance.
- Chrome last-used timestamps may improve prioritization where present, but the system works without them.

## Sources checked for this revision

- [Chrome bookmarks API](https://developer.chrome.com/docs/extensions/reference/api/bookmarks)
- [Chrome extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [LM Studio REST API](https://lmstudio.ai/docs/developer/rest)
- [LM Studio model listing API](https://lmstudio.ai/docs/developer/rest/list)
