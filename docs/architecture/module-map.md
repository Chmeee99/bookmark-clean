# Bookmark Clean module map

Status: target architecture for pre-implementation review  
Date: 2026-07-12

## System shape

Bookmark Clean is a local application with a thin Chrome connector. A small orchestration core coordinates use cases through module contracts. Runtime modules own domain behavior. Adapters own SQLite, LM Studio, HTTP, HTML extraction, Chrome, and browser-specific details.

No module may import another module's internal files. Each module exposes one `public.ts` entry point containing its contract and public value types. Shared primitives are limited to opaque IDs, timestamps, result types, and version identifiers.

Suggested top-level layout:

```text
apps/
  local-service/
  web-ui/
  chrome-extension/
core/
  orchestrator/
  contracts/
modules/
  catalog/
  jobs/
  health/
  extraction/
  enrichment/
  retrieval/
  review/
adapters/
  chrome-html/
  sqlite/
  lm-studio/
  web-fetch/
  chrome-bridge/
tests/
  contract/
  integration/
  fixtures/
```

## Shared contract types

```ts
type BookmarkId = string & { readonly __brand: "BookmarkId" };
type SnapshotId = string & { readonly __brand: "SnapshotId" };
type JobId = string & { readonly __brand: "JobId" };
type JobBatchId = string & { readonly __brand: "JobBatchId" };
type WorkerId = string & { readonly __brand: "WorkerId" };
type JobLeaseToken = string & { readonly __brand: "JobLeaseToken" };
type JobResultId = string & { readonly __brand: "JobResultId" };
type ReviewItemId = string & { readonly __brand: "ReviewItemId" };
type ContentHash = string & { readonly __brand: "ContentHash" };
type ModelProfileId = string & { readonly __brand: "ModelProfileId" };
type IsoDateTime = string & { readonly __brand: "IsoDateTime" };

type Outcome<T, E extends { code: string }> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

These types carry identity only. Domain schemas remain with the module that owns their meaning.

## Orchestrator

Responsibility: execute named application use cases by coordinating public module contracts.

Public contract:

```ts
interface BookmarkCleanApp {
  importSnapshot(
    input: BookmarkSnapshotInput,
  ): Promise<Outcome<ImportSummary, CatalogFailure>>;
  startProcessing(request: StartProcessingRequest): Promise<JobBatchSummary>;
  pauseProcessing(batchId: string): Promise<void>;
  search(request: SearchRequest): Promise<SearchResponse>;
  decideReviewItem(request: ReviewDecisionRequest): Promise<ReviewItem>;
  applyApprovedChangeSet(id: string): Promise<ApplyChangeSetResult>;
}
```

The orchestrator wires catalog, jobs, health, extraction, enrichment, retrieval, and review contracts. It may define transaction boundaries and use-case sequencing. It is forbidden to know SQL, Chrome API calls, HTTP behavior, prompt text, model response repair, DOM structure, vector representation, or UI state.

## Catalog module

Responsibility: own bookmark identity, immutable source snapshots, hierarchy, and ordering.

Public contract:

```ts
interface BookmarkCatalog {
  importSnapshot(
    input: BookmarkSnapshotInput,
  ): Promise<Outcome<ImportSummary, CatalogFailure>>;
  getSnapshot(
    id: SnapshotId,
  ): Promise<Outcome<BookmarkSnapshot | null, CatalogStorageFailure>>;
}

type BookmarkSource = "chrome_api" | "chrome_html";

interface BookmarkSnapshotInput {
  readonly source: BookmarkSource;
  readonly capturedAt: IsoDateTime;
  readonly roots: readonly SourceBookmarkNode[];
}

interface SourceBookmarkNodeBase {
  readonly sourceId: string;
  readonly title: string;
  readonly dateAdded?: IsoDateTime;
  readonly dateModified?: IsoDateTime;
}

interface SourceBookmarkFolder extends SourceBookmarkNodeBase {
  readonly kind: "folder";
  readonly children: readonly SourceBookmarkNode[];
}

interface SourceBookmark extends SourceBookmarkNodeBase {
  readonly kind: "bookmark";
  readonly url: string;
  readonly dateLastUsed?: IsoDateTime;
}

type SourceBookmarkNode = SourceBookmarkFolder | SourceBookmark;

interface BookmarkRecordBase {
  readonly id: BookmarkId;
  readonly sourceId: string;
  readonly title: string;
  readonly dateAdded?: IsoDateTime;
  readonly dateModified?: IsoDateTime;
}

interface BookmarkFolderRecord extends BookmarkRecordBase {
  readonly kind: "folder";
  readonly children: readonly BookmarkRecord[];
}

interface BookmarkLinkRecord extends BookmarkRecordBase {
  readonly kind: "bookmark";
  readonly url: string;
  readonly dateLastUsed?: IsoDateTime;
}

type BookmarkRecord = BookmarkFolderRecord | BookmarkLinkRecord;

interface BookmarkSnapshot {
  readonly id: SnapshotId;
  readonly source: BookmarkSource;
  readonly capturedAt: IsoDateTime;
  readonly roots: readonly BookmarkRecord[];
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
}

interface ImportSummary {
  readonly snapshotId: SnapshotId;
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
}

type CatalogImportFailureCode =
  | "invalid_captured_at"
  | "invalid_node"
  | "empty_source_id"
  | "duplicate_source_id"
  | "invalid_date"
  | "empty_url"
  | "cyclic_tree";

type CatalogImportFailureField =
  | "capturedAt"
  | "sourceId"
  | "dateAdded"
  | "dateModified"
  | "dateLastUsed"
  | "url"
  | "children"
  | "node";

interface CatalogImportFailure {
  readonly code: CatalogImportFailureCode;
  readonly path: readonly number[];
  readonly field?: CatalogImportFailureField;
  readonly diagnostic?: string;
}

type CatalogStorageFailureCode =
  | "snapshot_exists"
  | "storage_unavailable"
  | "stored_snapshot_invalid";

interface CatalogStorageFailure {
  readonly code: CatalogStorageFailureCode;
  readonly diagnostic?: string;
}

type CatalogFailure = CatalogImportFailure | CatalogStorageFailure;

interface CatalogSnapshotStore {
  save(
    snapshot: BookmarkSnapshot,
  ): Promise<Outcome<void, CatalogStorageFailure>>;
  load(
    id: SnapshotId,
  ): Promise<Outcome<BookmarkSnapshot | null, CatalogStorageFailure>>;
}

interface CatalogIdFactory {
  nextSnapshotId(): SnapshotId;
  nextBookmarkId(): BookmarkId;
}
```

Import contract rules:

- `roots` and every folder's `children` array are the only hierarchy and sibling-order representation. A numeric path such as `[0, 2, 1]` addresses a node for validation evidence.
- `sourceId` is non-empty and unique within one input. Chrome API adapters may preserve Chrome node IDs. The HTML adapter generates deterministic snapshot-scoped IDs; its encoding remains adapter-internal.
- Empty root arrays and empty titles are valid source facts. Bookmark URLs must be non-empty. Every URL scheme is preserved without normalization or support classification.
- Dates are optional canonical UTC `IsoDateTime` values. Raw HTML timestamp strings belong to the HTML adapter and never cross this boundary.
- Original source values and child order are immutable. `diagnostic` is optional debugging evidence and must never be parsed for meaning or used to repair an invalid input.
- `rootCount`, `folderCount`, and `bookmarkCount` are exact non-negative counts. Folder and bookmark counts include descendants; root count is `roots.length`.

Service and persistence rules:

- Catalog validates source input before requesting IDs or calling storage. It returns source validation failures unchanged.
- The ID factory emits non-empty correctly branded IDs without repeats for its lifetime. The service requests one snapshot ID and one bookmark ID per semantic node in deterministic depth-first order. The factory does not inspect source data or reconcile identities.
- Store `save` is atomic for one complete immutable snapshot and never overwrites an existing snapshot ID. It returns `snapshot_exists` for that conflict.
- Store `load` returns `ok: true` with `null` only when the snapshot ID is absent. An unavailable store returns `storage_unavailable`; a record that cannot be reconstructed as the public snapshot contract returns `stored_snapshot_invalid`.
- Catalog returns storage failures unchanged and never returns an import summary after failed storage. Optional storage diagnostics are debugging evidence only and cannot drive branching, repair, retry, or fallback.
- SQL errors, rows, transaction handles, and database exceptions never cross the port. Storage adapters translate expected engine failures into fixed codes without parsing error prose downstream.

Hides: source-ID indexing, snapshot construction, validation traversal, count traversal, and hierarchy queries.

Allowed dependencies: shared contract types. The runtime Catalog service may depend on `CatalogSnapshotStore` and `CatalogIdFactory`; adapters implement those ports without importing Catalog internals.

Boundary notes: adapters produce `BookmarkSnapshotInput` and may not decide catalog identity. The catalog validates input, requests local IDs, constructs immutable records, and returns typed validation or storage failures. Chrome IDs are source identifiers, not permanent global identity. `getBookmark`, scoped listing, reconciliation, and cross-snapshot identity reuse are deferred additive contracts; no caller may implement them by reaching into catalog internals. Migration order is executable public types first, Catalog service second, and SQLite store implementation third.

## Chrome HTML adapter

Responsibility: translate one in-memory Chrome Netscape bookmark export into Catalog input without file access, persistence, URL policy, or identity reconciliation.

Public contract:

```ts
interface ChromeHtmlImporter {
  parse(
    request: ChromeHtmlImportRequest,
  ): Outcome<BookmarkSnapshotInput, ChromeHtmlImportFailure>;
}

interface ChromeHtmlImportRequest {
  readonly html: string;
  readonly capturedAt: IsoDateTime;
}

type ChromeHtmlImportFailureCode =
  | "empty_input"
  | "missing_root_list"
  | "invalid_entry"
  | "invalid_timestamp";

type ChromeHtmlImportFailureField =
  | "html"
  | "entry"
  | "add_date"
  | "last_modified"
  | "last_visit";

interface ChromeHtmlImportFailure {
  readonly code: ChromeHtmlImportFailureCode;
  readonly path: readonly number[];
  readonly field: ChromeHtmlImportFailureField;
  readonly diagnostic?: string;
}
```

Import contract rules:

- The adapter accepts text already read by the caller. It never opens files, fetches bookmark URLs, executes source content, or invokes Chrome.
- The first top-level bookmark `DL` is the export root. A missing root list fails with `missing_root_list`; a whitespace-only input fails with `empty_input`. An empty root list is valid.
- Direct semantic entries under a list are folders represented by `H3` plus their following child `DL`, or bookmarks represented by `A`. A semantic entry that cannot be represented without guessing fails with `invalid_entry`; parser recovery is not treated as permission to invent hierarchy.
- Titles are decoded text content in document order. URL values are decoded `HREF` attribute values. Empty titles and non-empty URL strings of every scheme pass unchanged.
- `ADD_DATE`, `LAST_MODIFIED`, and `LAST_VISIT`, when present, must contain base-10 non-negative integer epoch seconds that convert to a valid canonical UTC timestamp. Invalid values fail with `invalid_timestamp`; absent values remain absent.
- Semantic sibling position produces `path`. The adapter creates a non-empty source ID from that path, deterministic for the same parsed tree and unique within one output. The literal encoding is private and is not stable identity across snapshots.
- Output source is always `chrome_html`, capture time comes from the request unchanged, and hierarchy is represented only by `roots` and folder `children`.
- `diagnostic` is optional debugging evidence. Callers must not parse it for meaning or use it to repair a failure.

Hides: `parse5` tree types, HTML recovery details, attribute lookup, timestamp conversion, text traversal, and source-ID encoding.

Allowed dependencies: shared contract types, Catalog public input types, and the parser API approved in ADR 0004.

Boundary notes: this adapter produces Catalog input but does not allocate `BookmarkId` or `SnapshotId`, validate catalog identity, normalize URLs, deduplicate entries, or persist data. Catalog validation remains the receiving boundary. Adding a new failure code or changing timestamp and hierarchy semantics requires a separate contract slice.

## Jobs module

Responsibility: own durable scheduling, priority, leases, retries, pause, resume, and cancellation.

Public contract:

```ts
type JobState =
  | "pending"
  | "leased"
  | "succeeded"
  | "retry_wait"
  | "failed"
  | "cancelled";

type JobBatchState = "active" | "paused" | "cancelled";
type JobType = "health_check";

interface BookmarkJobTarget {
  readonly kind: "bookmark";
  readonly bookmarkId: BookmarkId;
  readonly inputVersion: string;
}

type JobTarget = BookmarkJobTarget;

interface EnqueueJob {
  readonly type: JobType;
  readonly target: JobTarget;
  readonly priority: number;
  readonly sequence: number;
  readonly maxAttempts: number;
  readonly notBefore?: IsoDateTime;
}

interface EnqueueBatchRequest {
  readonly idempotencyKey: string;
  readonly jobs: readonly EnqueueJob[];
}

interface JobBatchSummary {
  readonly batchId: JobBatchId;
  readonly state: JobBatchState;
  readonly totalCount: number;
  readonly createdAt: IsoDateTime;
}

interface WorkerIdentity {
  readonly id: WorkerId;
}

interface JobLease {
  readonly token: JobLeaseToken;
  readonly jobId: JobId;
  readonly batchId: JobBatchId;
  readonly type: JobType;
  readonly target: JobTarget;
  readonly attempt: number;
  readonly leasedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

interface JobResultReference {
  readonly kind: "health_observation";
  readonly id: JobResultId;
}

interface TypedJobFailure {
  readonly code: string;
  readonly disposition: "retry" | "terminal";
  readonly diagnostic?: string;
}

interface JobProgress {
  readonly batchId: JobBatchId;
  readonly batchState: JobBatchState;
  readonly totalCount: number;
  readonly pendingCount: number;
  readonly leasedCount: number;
  readonly retryWaitCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly nextEligibleAt?: IsoDateTime;
}

type JobQueueFailureCode =
  | "empty_batch"
  | "invalid_request"
  | "idempotency_conflict"
  | "batch_not_found"
  | "stale_lease"
  | "invalid_transition"
  | "storage_unavailable";

interface JobQueueFailure {
  readonly code: JobQueueFailureCode;
  readonly diagnostic?: string;
}

interface JobQueue {
  enqueue(
    request: EnqueueBatchRequest,
  ): Promise<Outcome<JobBatchSummary, JobQueueFailure>>;
  lease(
    worker: WorkerIdentity,
    capabilities: readonly JobType[],
  ): Promise<Outcome<JobLease | null, JobQueueFailure>>;
  succeed(
    lease: JobLease,
    result: JobResultReference,
  ): Promise<Outcome<void, JobQueueFailure>>;
  fail(
    lease: JobLease,
    failure: TypedJobFailure,
  ): Promise<Outcome<void, JobQueueFailure>>;
  pause(batchId: JobBatchId): Promise<Outcome<void, JobQueueFailure>>;
  resume(batchId: JobBatchId): Promise<Outcome<void, JobQueueFailure>>;
  cancel(batchId: JobBatchId): Promise<Outcome<void, JobQueueFailure>>;
  getProgress(
    batchId: JobBatchId,
  ): Promise<Outcome<JobProgress, JobQueueFailure>>;
}

interface JobClock {
  now(): IsoDateTime;
}

interface JobRetrySchedule {
  nextRetryAt(attempt: number, failedAt: IsoDateTime): IsoDateTime;
}

interface JobIdFactory {
  nextBatchId(): JobBatchId;
  nextJobId(): JobId;
  nextLeaseToken(): JobLeaseToken;
}

interface JobQueueConfig {
  readonly leaseDurationMs: number;
}

interface StoredEnqueueCommand {
  readonly request: EnqueueBatchRequest;
  readonly requestFingerprint: string;
  readonly batchId: JobBatchId;
  readonly jobIds: readonly JobId[];
  readonly createdAt: IsoDateTime;
}

interface StoredLeaseCommand {
  readonly worker: WorkerIdentity;
  readonly capabilities: readonly JobType[];
  readonly now: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly token: JobLeaseToken;
}

interface StoredFailureCommand {
  readonly token: JobLeaseToken;
  readonly expectedAttempt: number;
  readonly failure: TypedJobFailure;
  readonly failedAt: IsoDateTime;
  readonly retryAt?: IsoDateTime;
}

interface StoredCompletionCommand {
  readonly token: JobLeaseToken;
  readonly expectedAttempt: number;
  readonly result: JobResultReference;
  readonly completedAt: IsoDateTime;
}

interface JobQueueStore {
  enqueueBatch(
    command: StoredEnqueueCommand,
  ): Promise<Outcome<JobBatchSummary, JobQueueFailure>>;
  leaseNext(
    command: StoredLeaseCommand,
  ): Promise<Outcome<JobLease | null, JobQueueFailure>>;
  completeLease(
    command: StoredCompletionCommand,
  ): Promise<Outcome<void, JobQueueFailure>>;
  failLease(
    command: StoredFailureCommand,
  ): Promise<Outcome<void, JobQueueFailure>>;
  setBatchState(
    batchId: JobBatchId,
    action: "pause" | "resume" | "cancel",
    changedAt: IsoDateTime,
  ): Promise<Outcome<void, JobQueueFailure>>;
  readProgress(
    batchId: JobBatchId,
    now: IsoDateTime,
  ): Promise<Outcome<JobProgress, JobQueueFailure>>;
}

type JobWorkerOperation = "lease" | "succeed" | "fail";

type JobWorkerStep =
  | { readonly status: "idle" }
  | {
      readonly status: "succeeded";
      readonly lease: JobLease;
      readonly result: JobResultReference;
    }
  | {
      readonly status: "failure_reported";
      readonly lease: JobLease;
      readonly failure: TypedJobFailure;
    };

type JobWorkerFailure =
  | {
      readonly code: "queue_failure";
      readonly operation: JobWorkerOperation;
      readonly failure: JobQueueFailure;
    }
  | {
      readonly code: "queue_interrupted";
      readonly operation: JobWorkerOperation;
    }
  | { readonly code: "handler_interrupted" }
  | { readonly code: "invalid_handler_output" };

interface JobWorkerConfigurationFailure {
  readonly code: "invalid_handler_registry";
}

interface JobHandler {
  readonly type: JobType;
  handle(
    lease: JobLease,
  ): Promise<Outcome<JobResultReference, TypedJobFailure>>;
}

interface JobWorker {
  runOne(
    worker: WorkerIdentity,
  ): Promise<Outcome<JobWorkerStep, JobWorkerFailure>>;
}

declare function createJobWorker(
  queue: JobQueue,
  handlers: readonly JobHandler[],
): Outcome<JobWorker, JobWorkerConfigurationFailure>;
```

Request and ordering rules:

- `idempotencyKey` is non-empty. Repeating an identical request returns the existing batch summary and creates no jobs. Reusing the key with a different canonical request fingerprint returns `idempotency_conflict`.
- A batch must contain at least one job. Priority is a safe integer where larger values lease first. Sequence is a unique non-negative safe integer within the batch and preserves source order among equal priorities. `maxAttempts` is a positive safe integer. `inputVersion` is non-empty.
- Eligible jobs are ordered by priority descending, sequence ascending, creation time ascending, then `JobId` ascending. `notBefore` and retry time must be at or before the injected current time.
- `capabilities` is deduplicated as a set. An empty set returns success with no lease. Lease duration is fixed queue configuration, not worker input.
- `leaseDurationMs` is a positive safe integer. Every supplied timestamp and every clock or retry-schedule result is canonical UTC. A retry time earlier than its failure time is `invalid_request`. Failure `code` is non-empty.

Lease and retry rules:

- Leasing and progress reads are atomic with expired-lease recovery. Before selecting or counting work, the store reclaims every expired lease: a job in an active or paused batch returns to `pending` when another attempt remains; it becomes `failed` when attempts are exhausted; it becomes `cancelled` when its batch is cancelled.
- A successful lease changes `pending` or eligible `retry_wait` to `leased`, increments `attempt` exactly once, and records one fresh token and expiry. Paused and cancelled batches never issue new leases.
- A lease is expired when `expiresAt` is at or before the current time. Only the current unexpired token may complete or fail a lease. Unknown, replaced, expired, already-consumed, or attempt-mismatched leases return `stale_lease` and cause no mutation.
- `succeed` changes `leased` to `succeeded` and stores one typed result reference. It remains valid when the batch was cancelled after the lease began, preserving bounded work that already committed a domain result.
- `fail` with `terminal` changes `leased` to `failed`, except that a cancelled batch changes it to `cancelled`. `retry` changes it to `retry_wait` with `JobRetrySchedule.nextRetryAt` only when attempts remain and the batch is not cancelled; otherwise it becomes `failed` or `cancelled` respectively.
- Failure `code` and `diagnostic` are stored as evidence. Queue logic branches only on `disposition`, attempts, batch state, and typed time fields; it never interprets either string.

Batch-control and progress rules:

- Pause changes active to paused and is idempotent when already paused. It does not revoke current leases or alter pending/retry jobs.
- Resume changes paused to active and is idempotent when already active. A cancelled batch returns `invalid_transition`.
- Cancel changes active or paused to cancelled and is idempotent when already cancelled. Pending and retry-wait jobs become cancelled immediately. Leased jobs retain their tokens and follow the completion/failure rules above.
- Progress counts every job in exactly one state, totals must add up, and `nextEligibleAt` is the earliest future `notBefore`, retry time, or lease expiry that could change eligibility. A missing batch returns `batch_not_found`.

Store and service boundaries:

- `JobQueue` owns validation, canonical request fingerprinting, ID allocation, lease-duration calculation, retry-time calculation from the returned lease attempt, and clock reads. It delegates each mutation to one atomic store operation.
- The canonical request fingerprint is a deterministic serialization of declared request fields in job-array order; it excludes diagnostics and runtime timestamps. The store treats it as opaque and compares it only for equality.
- `StoredEnqueueCommand.jobIds.length` must equal `request.jobs.length`; IDs align by array index. Port implementations reject malformed commands as `invalid_request` without partial writes.
- `JobQueueStore` owns durable compare-and-set mechanics and expired-lease recovery but no handler policy, domain result creation, clock, randomness, or prose interpretation.
- Fixed queue failures are returned unchanged. Expected unavailable storage becomes `storage_unavailable` without parsing database messages.

Worker and handler boundaries:

- `createJobWorker` validates a closed handler registry before work begins. Empty registries are valid idle workers. Every configured handler has one supported `JobType`; duplicate or malformed entries return `invalid_handler_registry`. Capabilities are the deduplicated lexical handler-type list.
- `runOne` performs at most one lease and one terminal queue report. It calls `lease` once; success-null returns `idle`. A returned lease is routed only to the exact registered handler for its declared type.
- A handler success is a typed `JobResultReference` and contractually means the owning domain result was committed durably before `handle` returned. The worker then calls `succeed` once. A typed handler failure is passed unchanged to `fail` once. Accepted queue calls return the matching `succeeded` or `failure_reported` step.
- Handler results and failures are strict contract values. Malformed output returns `invalid_handler_output`; handler rejection or throw returns `handler_interrupted`. Both leave the current lease untouched so ordinary expiry recovery can reclaim it. The worker never parses exception messages, diagnostics, or result prose.
- A typed queue outcome failure is wrapped as `queue_failure` with the exact operation and failure. A queue rejection or throw becomes `queue_interrupted` with the operation and no inferred diagnostic. Failed queue reports leave recovery to the lease state; the worker does not issue compensating mutations.
- The worker core has no polling loop or shared stop flag. The composition root controls repetition by calling `runOne`; graceful stop means no new call begins. Process loss or interruption during one call is represented by the untouched lease and is proven through expiry/reopen integration tests.
- Handler idempotency is owned by the handler's domain repository, keyed by stable job type, target, and input version rather than lease token or attempt. Retrying after a result commit returns the same durable result reference before queue success, preventing duplicate domain results.

State transitions:

| From | Event | To |
| --- | --- | --- |
| new | enqueue | `pending` |
| `pending` or eligible `retry_wait` | lease | `leased` |
| `leased` | succeed with current token | `succeeded` |
| `leased` | terminal failure | `failed` |
| `leased` | retry failure with attempts remaining | `retry_wait` |
| `leased` | retry failure at attempt limit | `failed` |
| expired `leased` | attempts remain | `pending` |
| expired `leased` | attempt limit reached | `failed` |
| `pending` or `retry_wait` | cancel batch | `cancelled` |
| `leased` in cancelled batch | fail or expire | `cancelled` |
| `leased` in cancelled batch | succeed | `succeeded` |

Terminal job states never transition. Invalid state/token operations return `stale_lease` for lease-token commands or `invalid_transition` for batch controls, with no mutation.

Hides: lease SQL, canonical fingerprint encoding, configured lease duration, retry algorithm, one-step worker routing, priority indexes, and expired-lease recovery queries.

Allowed dependencies: clock, random jitter source, a jobs persistence port, and domain handlers supplied only through `JobHandler`.

Boundary notes: jobs carry typed references, never page bodies or model prose. Handlers must be idempotent for a stable job target and input version, and must durably commit their result before returning success to the worker. The queue and worker do not infer whether a domain failure is retryable.

Capability brief for durable processing:

- Placement: extend the existing Jobs module. Durable scheduling is its sole cohesive responsibility; health and later handlers remain separate modules.
- Contract consumers: the orchestrator consumes `JobQueue`; the one-step worker consumes `JobQueue` plus registered `JobHandler` plugins; the Jobs service consumes `JobClock`, `JobRetrySchedule`, `JobIdFactory`, and `JobQueueStore`; the SQLite adapter implements `JobQueueStore`.
- Migration order: add shared job identifiers, add executable queue types, implement the Jobs service against a fake store, define and implement SQLite atomic operations, add executable worker/handler types, implement the one-step worker against fakes, then prove interruption and reopen with an idempotent fake domain repository. No runtime consumer exists before that sequence.
- Orchestrator wiring: selected-scope planning creates typed `health_check` batch requests; workers lease only declared capabilities and commit a Health result before queue success.
- Out of scope: domain handler implementation, SQL schema, URL policy, health semantics, concurrency tuning, UI projections, and future job-type unions.

## Health module

Current implementation status: deferred target. The prior classifier and transport fixtures have been removed. The remaining executable `modules/health/public.ts` surface has no runtime consumer and exists only for two contract tests pending its isolated removal in recovery Slice R5B. A future Health vertical slice must revalidate this target contract against a real caller before restoring executable types.

Responsibility: produce URL health observations and explainable staleness assessments.

Public contract:

```ts
type HealthStatus =
  | "healthy"
  | "redirect_permanent"
  | "redirect_temporary"
  | "authentication_required"
  | "forbidden"
  | "rate_limited"
  | "server_error"
  | "dns_failure"
  | "timeout"
  | "tls_error"
  | "not_found"
  | "gone"
  | "soft_404_suspected"
  | "parked_domain_suspected"
  | "unsupported_url"
  | "uncertain";

type HealthTransportFailureCode =
  | "unsupported_url"
  | "timeout"
  | "dns_failure"
  | "tls_error"
  | "connection_failure"
  | "malformed_response"
  | "unknown_transport";

type HealthObservationErrorCode =
  | HealthTransportFailureCode
  | "invalid_redirect"
  | "redirect_limit";

type HealthSelectedHeaderName =
  | "content-type"
  | "location"
  | "retry-after"
  | "etag"
  | "last-modified";

interface HealthSelectedHeader {
  readonly name: HealthSelectedHeaderName;
  readonly value: string;
}

interface HealthCheckRequest {
  readonly bookmarkId: BookmarkId;
  readonly inputVersion: string;
  readonly url: string;
}

interface RedirectHop {
  readonly requestedUrl: string;
  readonly statusCode: 301 | 302 | 303 | 307 | 308;
  readonly location: string;
  readonly nextUrl: string;
}

interface HealthObservation {
  readonly id: JobResultId;
  readonly bookmarkId: BookmarkId;
  readonly inputVersion: string;
  readonly status: HealthStatus;
  readonly checkedAt: IsoDateTime;
  readonly requestedUrl: string;
  readonly finalUrl?: string;
  readonly method: "GET";
  readonly httpStatus?: number;
  readonly redirects: readonly RedirectHop[];
  readonly durationMs: number;
  readonly retryCount: number;
  readonly headers: readonly HealthSelectedHeader[];
  readonly errorCode?: HealthObservationErrorCode;
  readonly bodyFingerprint?: ContentHash;
}

type HealthFailureCode =
  | "invalid_request"
  | "input_conflict"
  | "invalid_configuration"
  | "clock_unavailable"
  | "id_unavailable"
  | "transport_unavailable"
  | "storage_unavailable";

interface HealthFailure {
  readonly code: HealthFailureCode;
  readonly disposition: "retry" | "terminal";
  readonly diagnostic?: string;
}

interface HealthChecker {
  check(request: HealthCheckRequest): Promise<Outcome<HealthObservation, HealthFailure>>;
}

interface StalenessPolicy {
  assessStaleness(input: StalenessInput): StalenessAssessment;
}

interface HealthService extends HealthChecker, StalenessPolicy {}

interface HealthClock {
  now(): IsoDateTime;
}

interface HealthIdFactory {
  nextObservationId(): JobResultId;
}

interface HealthCheckConfig {
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly maxBodyBytes: number;
  readonly maxAttempts: number;
}

interface HealthTransportRequest {
  readonly url: string;
  readonly method: "GET";
  readonly redirect: "manual";
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
}

interface HealthTransportResponse {
  readonly url: string;
  readonly statusCode: number;
  readonly headers: readonly HealthSelectedHeader[];
  readonly body?: Uint8Array;
  readonly durationMs: number;
}

interface HealthTransportFailure {
  readonly code: HealthTransportFailureCode;
  readonly durationMs: number;
}

interface HealthTransport {
  request(
    request: HealthTransportRequest,
  ): Promise<Outcome<HealthTransportResponse, HealthTransportFailure>>;
}

type HealthTransportFact =
  | { readonly kind: "response"; readonly value: HealthTransportResponse }
  | { readonly kind: "failure"; readonly value: HealthTransportFailure };

type HealthRetryDecision =
  | { readonly retry: false }
  | { readonly retry: true; readonly delayMs: number };

interface HealthRetryPolicy {
  decide(attempt: number, fact: HealthTransportFact): HealthRetryDecision;
}

interface HealthDelay {
  wait(delayMs: number): Promise<void>;
}

interface HealthBodyFingerprinter {
  fingerprint(body: Uint8Array): ContentHash;
}

type HealthRepositoryFailureCode =
  | "observation_conflict"
  | "storage_unavailable";

interface HealthRepositoryFailure {
  readonly code: HealthRepositoryFailureCode;
  readonly diagnostic?: string;
}

interface HealthObservationRepository {
  loadByInput(
    bookmarkId: BookmarkId,
    inputVersion: string,
  ): Promise<Outcome<HealthObservation | null, HealthRepositoryFailure>>;
  saveIfAbsent(
    observation: HealthObservation,
  ): Promise<Outcome<HealthObservation, HealthRepositoryFailure>>;
  listForBookmark(
    bookmarkId: BookmarkId,
  ): Promise<Outcome<readonly HealthObservation[], HealthRepositoryFailure>>;
}

type StalenessDisposition = "no_warning" | "retry" | "review";

type StalenessReasonCode =
  | "no_observations"
  | "recent_reachable_observation"
  | "user_exception"
  | "single_failure_needs_confirmation"
  | "transient_or_access_failure"
  | "repeated_not_found_or_gone"
  | "repeated_typed_page_suspicion";

interface StalenessInput {
  readonly bookmarkId: BookmarkId;
  readonly observations: readonly HealthObservation[];
  readonly assessedAt: IsoDateTime;
  readonly userException: boolean;
}

interface StalenessAssessment {
  readonly disposition: StalenessDisposition;
  readonly confidence: number;
  readonly reasonCodes: readonly StalenessReasonCode[];
  readonly observationIds: readonly JobResultId[];
  readonly policyVersion: string;
}
```

Observation and idempotency rules:

- `check` requires non-empty bookmark ID, input version, and URL. Every config integer is safe and bounded: timeout/body/attempts are positive and redirects are non-negative. Every clock value, ID, transport fact, repository result, and retry decision is validated at its receiving boundary.
- `(bookmarkId, inputVersion)` is the immutable idempotency key for one requested check. `check` loads it before allocating an ID or calling transport. An existing observation with the exact requested URL returns unchanged. Reusing the key for a different URL returns terminal `input_conflict`. A later scheduled check must use a new input version.
- `saveIfAbsent` atomically inserts by that key. A concurrent identical observation returns the stored row. A different observation for the same key returns `observation_conflict`; local code never merges or repairs it.
- Expected network outcomes, including timeout, DNS, TLS, unsupported URL, malformed response, and connection failure, produce durable observations and successful `check` outcomes. `invalid_request`, `input_conflict`, `invalid_configuration`, and `id_unavailable` are terminal service failures. `clock_unavailable`, `transport_unavailable`, and `storage_unavailable` are retry failures. Repository `observation_conflict` maps to terminal `input_conflict`; repository unavailability maps to retry `storage_unavailable`. Diagnostics remain opaque evidence.
- The observation ID is a `JobResultId`, so a successful Health job can return it directly as `{ kind: "health_observation", id }` after the repository commit.

Transport and request-safety rules:

- `HealthTransport` executes one request with redirects disabled. The Health service walks redirects itself so every hop is recorded and bounded.
- The production transport accepts only HTTP and HTTPS URLs without credentials. Before every request, including redirect targets, it resolves the host, rejects loopback/private/link-local/multicast/unspecified destinations by default, pins the approved address for the connection, and preserves the original host for HTTP/TLS verification. Any unresolved or mixed public/private target is rejected as `unsupported_url`. These checks cannot be disabled by page content or redirects.
- Test transports may explicitly allow loopback fixtures. That permission is injected in tests and never becomes a user URL rule.
- Transport adapters author `HealthTransportFailureCode` from structured runtime facts. Unknown Node `TypeError` cases remain `unknown_transport` until typed cause fixtures prove a narrower mapping. Exception messages, socket prose, and traces never select a code.
- Headers are lower-case, deduplicated, and restricted to `HealthSelectedHeaderName`. Header/body values are evidence only. Bodies are capped before allocation beyond `maxBodyBytes`; the observation stores only a fingerprint.

Redirect, retry, and classification rules:

- Redirect statuses are 301, 302, 303, 307, and 308. A hop requires one non-empty `Location` that resolves against the current URL and passes transport safety. Missing/invalid locations produce `uncertain` with `invalid_redirect`. Exceeding `maxRedirects` produces `uncertain` with `redirect_limit`.
- `HealthRetryPolicy` decides from typed response/failure facts and attempt number only. `maxAttempts` includes the first request. Delay is non-negative and finite; `HealthDelay` is injected. The service records completed extra requests as `retryCount`. It does not parse `Retry-After` or diagnostics unless a later typed policy contract declares that field.
- A final 2xx response is `healthy` without redirects. A final 2xx after only 301/308 hops is `redirect_permanent`. Any 302/303/307 hop makes the result `redirect_temporary`.
- Final 401, 403, 404, 410, 429, and 5xx responses map to `authentication_required`, `forbidden`, `not_found`, `gone`, `rate_limited`, and `server_error`. Other HTTP statuses are `uncertain`.
- Transport failure codes map directly where a matching `HealthStatus` exists. Connection, malformed, and unknown transport failures map to `uncertain` while preserving `errorCode`. Unsupported URL maps to `unsupported_url` without a request.
- `soft_404_suspected` and `parked_domain_suspected` require a separate schema-valid typed page-classification result with evidence references. The deterministic network checker never emits either status from body prose or an HTTP status alone.
- `checkedAt` is the validated completion clock value. `durationMs` is the safe sum of transport durations and delays. Redirects, attempts, headers, final status, error code, and body fingerprint are reconstructed from typed fields only.

Staleness rules:

- Staleness consumes immutable observations for exactly one bookmark. It sorts by `checkedAt` plus observation ID for deterministic ties and returns only IDs it actually used.
- A user exception or a latest reachable (`healthy` or redirect) observation returns `no_warning`. No observations returns `retry`.
- A single failure of any kind returns `retry`. Authentication, forbidden, rate limit, server, DNS, timeout, TLS, unsupported, connection/malformed/unknown, and uncertain evidence never produce `review` by themselves.
- `review` requires repeated `not_found`/`gone` observations or repeated typed soft-404/parked evidence under a versioned threshold policy. The exact count and minimum elapsed interval are fixed in the dedicated staleness implementation slice before code; changing them requires policy-version and test changes.
- Confidence is finite in `[0, 1]`. Reason codes are closed, observations remain unchanged, and no assessment authorizes deletion. Models may supply typed page-suspicion evidence; they cannot set disposition, confidence, or reasons.

Hides: request headers, timeout implementation, safe address resolution/pinning, redirect walker, DNS/TLS structured-code mapping, retry schedule/jitter, per-domain limiter, body hashing, repository schema, and staleness thresholds.

Allowed dependencies: `HealthTransport`, `HealthClock`, `HealthIdFactory`, `HealthRetryPolicy`, `HealthDelay`, `HealthBodyFingerprinter`, `HealthObservationRepository`, configuration, and optional schema-valid typed page-classification evidence.

Boundary notes: health observations are facts from one bounded check. Staleness is a versioned policy result over history. Network/page evidence may be model-assisted only through a declared typed producer contract. No model, transport diagnostic, or single transient failure can issue a stale or delete decision.

Capability brief for first Health implementation:

- Placement: extend the Health module. Transport adapters implement execution and request safety; SQLite implements the Health-owned repository port; the Jobs handler calls `check` and returns the committed observation ID.
- Contract consumers: `HealthChecker` consumes transport/clock/ID/retry/delay/fingerprint/repository ports. `StalenessPolicy` consumes immutable observation history. A composition root may expose both as `HealthService`. The worker consumes `HealthChecker` through one Health `JobHandler`; UI/review consumers use stored observations and `StalenessPolicy`.
- Migration order: executable Health types, deterministic classifier/service against fakes, Node transport cause fixtures plus safe-request design, SQLite repository, Health job handler, then staleness policy thresholds. Public contract changes remain isolated slices.
- Out of scope for the first implementation: concurrency limits, rendered browsing, page-classifier production, live-internet probes, deletion, and Chrome writes.

## Extraction module

Responsibility: turn an allowed URL response into sanitized, bounded, source-referenced content artifacts.

Public contract:

```ts
interface ContentExtractor {
  acquire(request: AcquireContentRequest): Promise<Outcome<ContentArtifact, ExtractionFailure>>;
}

interface ContentArtifact {
  contentHash: ContentHash;
  finalUrl: string;
  canonicalUrl?: string;
  title?: string;
  description?: string;
  language?: string;
  contentType: string;
  metadata: Readonly<Record<string, string>>;
  spans: readonly SourceSpan[];
  warnings: readonly ExtractionWarning[];
  extractorVersion: string;
}

interface SourceSpan {
  id: string;
  kind: "metadata" | "heading" | "paragraph" | "list" | "code";
  text: string;
}
```

Hides: DOM parsing, sanitization library, readability scoring, content reduction, site-specific adapters, cache files, and rendered-browser implementation.

Allowed dependencies: retrieval/fetch port, content cache, and optional renderer port.

Boundary notes: source text is untrusted. The module returns data only and cannot emit instructions or model prompts. Browser rendering is an explicit fallback policy.

## Enrichment module

Responsibility: request, validate, version, and store grounded semantic metadata for a content artifact.

Public contract:

```ts
interface EnrichmentService {
  enrich(request: EnrichmentRequest): Promise<Outcome<EnrichmentRecord, EnrichmentFailure>>;
  getActive(bookmarkId: BookmarkId): Promise<EnrichmentRecord | null>;
  recordCorrection(correction: UserCorrection): Promise<void>;
}

interface EnrichmentRecord {
  description: string;
  detail: string;
  literalTags: readonly string[];
  topics: readonly string[];
  entities: readonly NamedEntity[];
  likelySaveIntent: string;
  language: string;
  contentType: string;
  fieldConfidence: Readonly<Record<string, number>>;
  evidence: Readonly<Record<string, readonly string[]>>;
  warnings: readonly string[];
  generationRunId: string;
  schemaVersion: string;
}
```

Hides: prompt templates, provider request construction, retry policy for invalid structured output, taxonomy normalization, and active-version selection.

Allowed dependencies: model provider port, enrichment repository, taxonomy contract, and clock.

Boundary notes: provider output must pass the declared schema. Local code may validate, normalize declared fields, or reject. It must not infer semantics from raw text, fallback prose, errors, logs, or malformed output. User corrections always win over generated values.

## Model provider adapters

Responsibility: translate provider-neutral generation and embedding requests to one local or explicitly enabled remote model API.

Public contracts:

```ts
interface StructuredGenerationProvider {
  listModels(): Promise<readonly ModelDescriptor[]>;
  generate<T>(request: StructuredGenerationRequest<T>): Promise<ProviderGeneration<T>>;
}

interface EmbeddingProvider {
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

interface StructuredGenerationRequest<T> {
  modelProfileId: ModelProfileId;
  systemPolicy: string;
  sourceMaterial: readonly SourceSpan[];
  outputSchema: JsonSchema<T>;
  promptVersion: string;
}
```

Hides: LM Studio endpoint paths, authentication headers, model loading, decoding parameters, raw provider response shape, token accounting conversion, and connection retries.

Allowed dependencies: HTTP client and secret/config store.

Boundary notes: the first adapter targets LM Studio at loopback. Provider adapters do not decide what content to send or what returned fields mean. Remote adapters remain disabled until explicitly configured.

## Retrieval module

Responsibility: index bookmark representations and return explainable lexical, semantic, and filtered search results.

Public contract:

```ts
interface BookmarkSearch {
  index(input: SearchDocument): Promise<void>;
  remove(bookmarkId: BookmarkId): Promise<void>;
  search(request: SearchRequest): Promise<SearchResponse>;
}

interface SearchRequest {
  query: string;
  filters: SearchFilters;
  sort: "relevance" | "bookmark_order" | "date_added" | "last_checked";
  limit: number;
  cursor?: string;
}

interface SearchHit {
  bookmarkId: BookmarkId;
  score: number;
  lexicalScore?: number;
  semanticScore?: number;
  matchedFields: readonly string[];
  excerpt?: string;
}
```

Hides: FTS5 schema, tokenizer choice, vector serialization, cosine implementation, score calibration, and cursor format.

Allowed dependencies: embedding provider, retrieval repository, and read-only catalog/enrichment projections.

Boundary notes: UI filters are explicit typed values. Any future model-generated search plan must pass its own contract before becoming a `SearchRequest`; malformed prose is never interpreted downstream.

## Review module

Responsibility: own evidence-backed proposals, user decisions, versioned Chrome change sets, approval, and rollback records.

Public contract:

```ts
interface ReviewWorkflow {
  propose(input: ReviewProposal): Promise<ReviewItem>;
  list(query: ReviewQuery): Promise<readonly ReviewItem[]>;
  decide(request: ReviewDecisionRequest): Promise<ReviewItem>;
  buildChangeSet(items: readonly ReviewItemId[], base: SnapshotId): Promise<ChangeSet>;
  approveChangeSet(id: string): Promise<ApprovedChangeSet>;
  recordApplyResult(result: ApplyChangeSetResult): Promise<void>;
}

type ChromeOperation =
  | { kind: "update_url"; chromeId: string; before: string; after: string }
  | { kind: "update_title"; chromeId: string; before: string; after: string }
  | { kind: "move"; chromeId: string; beforeParent: string; afterParent: string; afterIndex: number }
  | { kind: "remove"; chromeId: string; backup: SourceBookmarkNode };
```

Hides: review state transitions, confidence thresholds, evidence formatting, approval signatures, and rollback construction.

Allowed dependencies: catalog contract, health projections, enrichment projections, duplicate evidence, review repository, and Chrome connector contract.

Boundary notes: proposals never mutate Chrome. Applying a change set requires approval and a connector-level conflict check. Removal is a distinct, additionally confirmed operation.

## Chrome connector adapter

Responsibility: capture Chrome bookmark snapshots and apply approved, conflict-free bookmark operations.

Public contract:

```ts
interface ChromeConnector {
  capabilities(): Promise<ChromeCapabilities>;
  captureSnapshot(): Promise<BookmarkSnapshotInput>;
  watchChanges(since: string): AsyncIterable<ChromeBookmarkEvent>;
  validateChangeSet(changeSet: ApprovedChangeSet): Promise<ChangeSetValidation>;
  apply(changeSet: ApprovedChangeSet): Promise<ApplyChangeSetResult>;
}
```

Hides: Manifest V3 service worker, `chrome.bookmarks` API calls, native-messaging framing, chunking, reconnect behavior, host manifest paths, and extension permissions.

Allowed dependencies: Chrome extension APIs and one versioned bridge protocol.

Boundary notes: the connector never opens SQLite, calls a model, crawls a page, or decides whether an operation is desirable. Backup capture and conflict validation are mandatory before apply.

## SQLite adapter

Responsibility: implement module-owned persistence ports in one transactional local database.

Public contract:

```ts
interface DatabaseRuntime {
  migrate(registrations: readonly MigrationRegistration[]): Promise<void>;
  transaction<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
  backup(destination: string): Promise<DatabaseBackup>;
  health(): Promise<DatabaseHealth>;
}
```

Hides: connection lifecycle, pragmas, migrations table, prepared statements, FTS5 maintenance, BLOB encoding, backup implementation, and file paths.

Allowed dependencies: Node SQLite API and filesystem adapter.

Boundary notes: SQL stays inside adapter implementations or a module's private repository implementation. UI and orchestrator code never execute SQL. Every migration has an automated forward-migration test.

## Web UI

Responsibility: present application state and submit typed user commands.

Public contract: versioned local HTTP API generated from the orchestrator request and response schemas.

Hides: component library, browser state, caching, routing, and visual layout.

Allowed dependencies: local API client and view models only.

Boundary notes: no health policy, model parsing, staleness inference, duplicate decisions, or SQL in UI code. Raw HTML from pages is never rendered unsanitized.

## Extension recipe

To add a new provider, source, extractor, or review policy:

1. Define or extend the owning module's public contract and contract tests.
2. Implement the new adapter inside its own adapter directory.
3. Register it in the local-service composition root by configuration name.
4. Expose only required settings or status through the orchestrator API.
5. Add integration fixtures and one failure-path test.
6. Record any public contract change in this map before consumer code changes.

## Forbidden patterns

- Importing another module's internal files.
- Sharing mutable global state between workers.
- Allowing UI, connector, or adapters to own business policy.
- Letting the orchestrator parse HTML, SQL rows, provider responses, or Chrome messages.
- Reading or writing SQLite directly from the Chrome extension.
- Treating provider prose, exceptions, traces, or logs as semantic data.
- Repairing malformed model meaning downstream. Repair the prompt, schema, provider parser, or tests.
- Using an LLM decision as the sole basis for deletion, staleness, or URL replacement.
- Mutating original snapshot records.
- Adding a vector database, browser automation framework, or remote service without a measured requirement.

## Provisional boundaries

- PROVISIONAL: connector transport. Native messaging is the preferred stable bridge; a paired loopback bridge may be used first. Both must implement `ChromeConnector` and the same versioned message schemas.
- PROVISIONAL: rendered-browser fallback. It remains an extraction adapter and is excluded from the first vertical slice unless the spike shows that common saved pages cannot be understood without it.
- PROVISIONAL: taxonomy ownership. It begins inside enrichment. It becomes a separate module only if user-managed taxonomy behavior grows beyond normalization and CRUD.
- PROVISIONAL: exact vector scoring. It begins inside retrieval. A vector-index adapter is added only after a benchmark shows unacceptable latency.
- RESOLVED for first import: Chrome HTML source IDs derive from semantic node paths and are deterministic and unique within one output. Their literal encoding stays private and is not cross-snapshot identity; the implementation slice fixes and tests one encoding without widening this contract.
- PROVISIONAL: cross-snapshot `BookmarkId` reuse. The first import allocates local IDs. A later reconciliation contract will define when an existing ID may be reused.
- RESOLVED for first import: Catalog owns `CatalogSnapshotStore`, `CatalogIdFactory`, and typed storage failures. SQLite implements storage mechanics only; executable type migration and Catalog service implementation precede the SQLite store.
- PROVISIONAL: sanitized real-export coverage. ADR 0003 grounds the current provider-neutral fields, but a real-export probe remains required before claiming Chrome HTML compatibility.

## Contract changelog

- 2026-07-12: initial target module map created; no runtime consumers exist.
- 2026-07-13: completed the first catalog import/read contract and updated the orchestrator import signature; future consumers are catalog validators, the Chrome HTML adapter, and SQLite catalog persistence; no runtime consumers required migration.
- 2026-07-13: added the pure `ChromeHtmlImporter` producer contract, typed source failures, timestamp and hierarchy rules, and private path-derived source-ID ownership; no runtime consumers required migration.
- 2026-07-13: added typed Catalog storage failures, revised service results, and defined Catalog-owned snapshot-store and ID-factory ports; executable public types migrate before the Catalog service and SQLite adapter.
- 2026-07-13: completed the durable Jobs state machine, typed queue/store ports, lease and retry policy, and migration order; future consumers are the orchestrator, worker harness, and SQLite Jobs adapter, with no current runtime consumer to migrate.
- 2026-07-13: added the one-step worker and handler-plugin contract, typed interruption boundaries, and durable-result-before-success ownership; executable worker types must land before worker implementation and the interruption harness.
- 2026-07-13: replaced the provisional Health sketch with typed transport facts, safe manual redirects, idempotent observations, fixed classification rules, and a separate versioned staleness boundary; executable Health types precede service, transport, repository, handler, and threshold-policy slices.
- 2026-07-13: split Health behavior into `HealthChecker` and `StalenessPolicy`, with `HealthService` as their composition, after the first service gate exposed that observation execution and history policy could not migrate safely in one runtime slice.
- 2026-07-13: marked Health as a deferred target after removing its uncalled implementation and fixtures; the remaining executable types have only contract-test consumers and are removed in an isolated contract slice before future vertical replanning.
