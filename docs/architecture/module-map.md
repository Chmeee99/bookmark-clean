# Bookmark Clean module map

Status: current boundaries plus deferred targets
Date: 2026-07-16

## System shape

Bookmark Clean is currently a local CLI backed by Catalog, Processing, Jobs, and Health modules. A small orchestration core coordinates the import use case through module contracts. Runtime modules own domain behavior. Adapters own SQLite, Node networking, and Chrome HTML parsing. A local service, web UI, Chrome connector, extraction, enrichment, retrieval, review, model-provider, and browser-fetch adapters remain target architecture. They are not executable code.

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
  processing/
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

### Implementation status index

| Status | Modules and surfaces |
| --- | --- |
| CURRENT | `apps/local-cli`, `core/contracts`, `core/orchestrator`, `modules/catalog`, `modules/processing`, `modules/jobs`, `modules/health`, `adapters/chrome-html`, `adapters/node`, `adapters/sqlite` |
| TARGET | `apps/local-service`, `apps/web-ui`, `apps/chrome-extension`, `modules/extraction`, `modules/enrichment`, `modules/retrieval`, `modules/review`, `adapters/lm-studio`, `adapters/web-fetch`, `adapters/chrome-bridge` |

Sections for TARGET modules describe intended contracts and placement only. They are not evidence that the module exists or that a workflow is runnable. Capability briefs and the contract changelog record the implemented increments.

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
  importChromeHtml(
    request: ChromeHtmlImportRequest,
  ): Promise<ImportChromeHtmlOutcome>;
}

type ImportChromeHtmlFailure =
  | {
      readonly stage: "source";
      readonly failure: ChromeHtmlImportFailure;
    }
  | {
      readonly stage: "catalog";
      readonly failure: CatalogFailure;
    };

type ImportChromeHtmlOutcome =
  | { readonly ok: true; readonly value: ImportSummary }
  | { readonly ok: false; readonly error: ImportChromeHtmlFailure };

interface BookmarkCleanAppDependencies {
  readonly importer: ChromeHtmlImporter;
  readonly catalog: BookmarkCatalog;
}

declare function createBookmarkCleanApp(
  dependencies: BookmarkCleanAppDependencies,
): BookmarkCleanApp;
```

For the first runnable path, the orchestrator calls the Chrome HTML importer and passes successful input to Catalog. It wraps typed failures with their authoring stage without parsing diagnostics or repairing meaning. `ImportChromeHtmlOutcome` retains the shared outcome shape but is declared locally because the shared `Outcome` contract requires its error itself to own a `code`; adding a flattened Orchestrator code would duplicate author-owned meaning. Later use cases may coordinate Jobs and future modules through additional contracts. The orchestrator is forbidden to know files, command-line arguments, SQL, database lifecycle, Chrome API calls, HTTP behavior, prompt text, model response repair, DOM structure, vector representation, or UI state.

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
  getBookmark(
    id: BookmarkId,
  ): Promise<Outcome<BookmarkLinkRecord | null, CatalogStorageFailure>>;
}

interface CatalogInspectionFolder {
  readonly id: BookmarkId;
  readonly title: string;
  readonly bookmarkCount: number;
  readonly folders: readonly CatalogInspectionFolder[];
}

interface CatalogInspection {
  readonly snapshotId: SnapshotId;
  readonly capturedAt: IsoDateTime;
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
  readonly folders: readonly CatalogInspectionFolder[];
}

interface CatalogInspector {
  inspectSnapshot(
    id: SnapshotId,
  ): Promise<Outcome<CatalogInspection | null, CatalogStorageFailure>>;
}

interface CatalogResourceLimits {
  readonly maximumNodes: 20_000;
  readonly maximumDepth: 256;
}

declare const CATALOG_RESOURCE_LIMITS: CatalogResourceLimits;

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
  | "cyclic_tree"
  | "node_limit_exceeded"
  | "depth_limit_exceeded";

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
  loadBookmark(
    id: BookmarkId,
  ): Promise<Outcome<BookmarkLinkRecord | null, CatalogStorageFailure>>;
}

interface CatalogIdFactory {
  nextSnapshotId(): SnapshotId;
  nextBookmarkId(): BookmarkId;
}

interface CatalogServiceDependencies {
  readonly idFactory: CatalogIdFactory;
  readonly store: CatalogSnapshotStore;
}

declare function createBookmarkCatalog(
  dependencies: CatalogServiceDependencies,
): BookmarkCatalog;

declare function createCatalogInspector(
  catalog: Pick<BookmarkCatalog, "getSnapshot">,
): CatalogInspector;

declare function createCryptoCatalogIdFactory(): CatalogIdFactory;
```

Import contract rules:

- `roots` and every folder's `children` array are the only hierarchy and sibling-order representation. A numeric path such as `[0, 2, 1]` addresses a node for validation evidence.
- `sourceId` is non-empty and unique within one input. Chrome API adapters may preserve Chrome node IDs. The HTML adapter generates deterministic snapshot-scoped IDs; its encoding remains adapter-internal.
- Empty root arrays and empty titles are valid source facts. Bookmark URLs must be non-empty. Every URL scheme is preserved without normalization or support classification.
- Dates are optional canonical UTC `IsoDateTime` values. Raw HTML timestamp strings belong to the HTML adapter and never cross this boundary.
- Original source values and child order are immutable. `diagnostic` is optional debugging evidence and must never be parsed for meaning or used to repair an invalid input.
- `rootCount`, `folderCount`, and `bookmarkCount` are exact non-negative counts. Folder and bookmark counts include descendants; root count is `roots.length`.
- `CATALOG_RESOURCE_LIMITS` is the fixed first-horizon structural policy. `maximumNodes` counts folders plus bookmarks across all roots and is inclusive. `maximumDepth` is inclusive with each root at depth 1. Empty input has depth 0.
- Catalog is the receiving-boundary authority for the structural policy. It rejects the first depth-first node beyond 20,000 with `node_limit_exceeded` and the first node deeper than 256 with `depth_limit_exceeded`; the failure path identifies that node. When the same node violates both limits, depth is checked first and `depth_limit_exceeded` wins. Source adapters may reject earlier against the same public limits but may not widen them.

Service and persistence rules:

- Catalog validates source input before requesting IDs or calling storage. It returns source validation failures unchanged.
- The ID factory emits non-empty correctly branded IDs without repeats for its lifetime. The service requests one snapshot ID and one bookmark ID per semantic node in deterministic depth-first order. The factory does not inspect source data or reconcile identities.
- Store `save` is atomic for one complete immutable snapshot and never overwrites an existing snapshot ID. It returns `snapshot_exists` for that conflict.
- Store `load` returns `ok: true` with `null` only when the snapshot ID is absent. An unavailable store returns `storage_unavailable`; a record that cannot be reconstructed as the public snapshot contract returns `stored_snapshot_invalid`.
- Catalog returns storage failures unchanged and never returns an import summary after failed storage. Optional storage diagnostics are debugging evidence only and cannot drive branching, repair, retry, or fallback.
- SQL errors, rows, transaction handles, and database exceptions never cross the port. Storage adapters translate expected engine failures into fixed codes without parsing error prose downstream.

Hides: source-ID indexing, snapshot construction, validation traversal, count traversal, raw snapshot hierarchy queries, and inspection projection traversal.

Allowed dependencies: shared contract types. The runtime Catalog service may depend on `CatalogSnapshotStore` and `CatalogIdFactory`; adapters implement those ports without importing Catalog internals.

Boundary notes: adapters produce `BookmarkSnapshotInput` and may not decide catalog identity. The catalog validates input, requests local IDs, constructs immutable records, and returns typed validation or storage failures. Chrome IDs are source identifiers, not permanent global identity. `getBookmark` is the narrow lookup required by bookmark job handlers. `CatalogInspector` is the folder-only read projection for presentation consumers: root bookmarks contribute to snapshot totals but never appear in `folders`, folder order is preserved, and `bookmarkCount` is descendant-only for each folder. Every returned snapshot and inspection satisfies `CATALOG_RESOURCE_LIMITS`; a persistence adapter returns `stored_snapshot_invalid` for stored rows that exceed the structural policy. Reconciliation and cross-snapshot identity reuse remain deferred. No caller may reach into catalog internals. Migration order for inspection is the additive executable contract first, Catalog producer second, then Local CLI consumer migration.

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

declare const CHROME_HTML_MAX_INPUT_BYTES: 16_777_216;

type ChromeHtmlImportFailureCode =
  | "empty_input"
  | "missing_root_list"
  | "invalid_entry"
  | "invalid_timestamp"
  | "invalid_encoding"
  | "input_too_large"
  | "node_limit_exceeded"
  | "depth_limit_exceeded";

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

declare function parseBookmarksHtml(
  request: ChromeHtmlImportRequest,
): Outcome<BookmarkSnapshotInput, ChromeHtmlImportFailure>;
```

Import contract rules:

- The adapter accepts text already read by the caller. It never opens files, fetches bookmark URLs, executes source content, or invokes Chrome.
- File-reading consumers must decode source bytes as fatal UTF-8 before passing text to the adapter. Malformed UTF-8 fails with `invalid_encoding`; consumers must not persist replacement characters synthesized by a permissive decoder.
- `CHROME_HTML_MAX_INPUT_BYTES` is an inclusive 16 MiB UTF-8 limit checked before `parse5` receives the string. The Local CLI consumes the same public constant and reads at most one byte beyond it so an oversized file cannot be fully materialized before rejection.
- The first top-level bookmark `DL` is the export root. A missing root list fails with `missing_root_list`; a whitespace-only input fails with `empty_input`. An empty root list is valid.
- Direct semantic entries under a list are folders represented by `H3` plus their following child `DL`, or bookmarks represented by `A`. A semantic entry that cannot be represented without guessing fails with `invalid_entry`; parser recovery is not treated as permission to invent hierarchy.
- Titles are decoded text content in document order. URL values are decoded `HREF` attribute values. Empty titles and non-empty URL strings of every scheme pass unchanged.
- `ADD_DATE`, `LAST_MODIFIED`, and `LAST_VISIT`, when present, must contain base-10 non-negative integer epoch seconds that convert to a valid canonical UTC timestamp. Invalid values fail with `invalid_timestamp`; absent values remain absent.
- Semantic sibling position produces `path`. The adapter creates a non-empty source ID from that path, deterministic for the same parsed tree and unique within one output. The literal encoding is private and is not stable identity across snapshots.
- Output source is always `chrome_html`, capture time comes from the request unchanged, and hierarchy is represented only by `roots` and folder `children`.
- Semantic folders and bookmarks are counted against `CATALOG_RESOURCE_LIMITS` while the adapter builds output. The adapter returns the matching typed node or depth failure at the first offending depth-first path. Catalog independently enforces the same structural policy at its receiving boundary.
- `diagnostic` is optional debugging evidence. Callers must not parse it for meaning or use it to repair a failure.

Hides: `parse5` tree types, HTML recovery details, attribute lookup, timestamp conversion, text traversal, and source-ID encoding.

Allowed dependencies: shared contract types, Catalog public input types, and the parser API approved in ADR 0004.

Boundary notes: this adapter produces Catalog input but does not allocate `BookmarkId` or `SnapshotId`, validate catalog identity, normalize URLs, deduplicate entries, or persist data. It owns the HTML byte ceiling and early source rejection; Catalog remains the structural receiving boundary. Adding a new failure code or changing timestamp and hierarchy semantics requires a separate contract slice.

## Processing module

Responsibility: author versioned bounded work for a selected Catalog folder; the runtime previews it and enqueues it durably.

Public contract:

```ts
type ProcessingProfileId = "health_check_v1";

interface ProcessingPreviewRequest {
  readonly snapshotId: SnapshotId;
  readonly folderId: BookmarkId;
  readonly profileId: ProcessingProfileId;
}

interface ProcessingWorkProfile {
  readonly id: "health_check_v1";
  readonly jobType: "health_check";
  readonly maximumJobAttempts: 1;
  readonly maximumNetworkRequestsPerJob: 6;
  readonly maximumModelCallsPerJob: 0;
}

interface ProcessingPreview {
  readonly snapshotId: SnapshotId;
  readonly folderId: BookmarkId;
  readonly folderTitle: string;
  readonly profile: ProcessingWorkProfile;
  readonly bookmarkCount: number;
  readonly jobCount: number;
  readonly maximumNetworkRequests: number;
  readonly maximumModelCalls: number;
}

type ProcessingPreviewFailureCode =
  | "invalid_request"
  | "snapshot_not_found"
  | "folder_not_found"
  | "catalog_unavailable"
  | "snapshot_invalid"
  | "estimate_overflow";

interface ProcessingPreviewFailure {
  readonly code: ProcessingPreviewFailureCode;
}

interface ProcessingPlanner {
  preview(
    request: ProcessingPreviewRequest,
  ): Promise<Outcome<ProcessingPreview, ProcessingPreviewFailure>>;
}

declare function createProcessingPlanner(catalog: BookmarkCatalog): ProcessingPlanner;
```

Additive contract for selected-folder enqueue:

```ts
type ProcessingRunId = string & { readonly __brand: "ProcessingRunId" };

interface ProcessingStartRequest extends ProcessingPreviewRequest {
  readonly runId: ProcessingRunId;
}

interface ProcessingStart {
  readonly preview: ProcessingPreview;
  readonly batch: JobBatchSummary;
}

type ProcessingStartFailure =
  | ProcessingPreviewFailure
  | { readonly code: "empty_selection" }
  | { readonly code: "run_conflict" }
  | { readonly code: "queue_unavailable" }
  | {
      readonly code: "enqueue_rejected";
      readonly queueCode:
        | "invalid_request"
        | "batch_not_found"
        | "stale_lease"
        | "invalid_transition"
        | "stored_queue_invalid";
    };

interface ProcessingStarter {
  start(
    request: ProcessingStartRequest,
  ): Promise<Outcome<ProcessingStart, ProcessingStartFailure>>;
}

interface ProcessingStarterDependencies {
  readonly catalog: Pick<BookmarkCatalog, "getSnapshot">;
  readonly jobs: JobEnqueuer;
}

declare function createProcessingStarter(
  dependencies: ProcessingStarterDependencies,
): ProcessingStarter;
```

`health_check_v1` schedules one job for every bookmark below the selected folder. It allows one queue attempt, one request plus five manual redirect hops, and no in-check retry. Its complete run budget is therefore six requests per job and zero model calls. Multiplication outside the safe-integer range returns `estimate_overflow`.

For durable start, Processing performs the same depth-first traversal once and uses the resulting bookmark-ID order for both preview counts and Jobs sequence numbers. `runId` is a caller-authored opaque non-empty identifier for one logical Health run. Every job receives an `inputVersion` from a private collision-free serialization of `profileId`, `snapshotId`, and `runId`, plus priority zero, a zero-based sequence, and one maximum attempt. The Jobs idempotency key separately serializes `snapshotId`, `folderId`, `profileId`, and `runId`.

Repeating the same selection and `runId` authors the exact same enqueue request and replays the existing batch. A new `runId` creates a new batch and new Health input version. Reusing one `runId` across overlapping selections in the same snapshot intentionally lets the same bookmark reuse its committed Health observation while each selected batch remains independently idempotent. Including `snapshotId` prevents future cross-snapshot bookmark reconciliation from reusing an obsolete Health input. Empty folders return `empty_selection` without calling Jobs.

Jobs `idempotency_conflict` maps to `run_conflict`; `storage_unavailable` maps to `queue_unavailable`; `empty_batch` maps to `empty_selection`; other typed enqueue failures become `enqueue_rejected` with the original closed code. Processing never parses Jobs diagnostics.

Hides: depth-first folder lookup, descendant ID collection, safe arithmetic, profile registry, input-version encoding, Jobs request construction, and enqueue idempotency-key encoding.

Allowed dependencies: shared IDs and outcomes, the public Catalog read contract, and public Jobs profile, enqueue, failure, and batch-summary types.

Boundary notes: Processing may read folder IDs, folder titles, bookmark IDs, node kinds, and hierarchy from typed Catalog snapshots. It alone maps a selected scope and profile to ordered Jobs targets. It never reads bookmark titles or URLs, executes SQL, calls a network or model provider, or interprets diagnostics. Durable start calls only `JobEnqueuer.enqueue`; Local CLI code must not traverse snapshots or assemble Jobs requests. A handler must honor the selected profile budget; changing a budget requires a new profile ID.

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
  | "stored_queue_invalid"
  | "storage_unavailable";

interface JobQueueFailure {
  readonly code: JobQueueFailureCode;
  readonly diagnostic?: string;
}

interface JobEnqueuer {
  enqueue(
    request: EnqueueBatchRequest,
  ): Promise<Outcome<JobBatchSummary, JobQueueFailure>>;
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

interface JobEnqueueIdFactory {
  nextBatchId(): JobBatchId;
  nextJobId(): JobId;
}

interface JobIdFactory extends JobEnqueueIdFactory {
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

interface JobEnqueuerDependencies {
  readonly clock: JobClock;
  readonly idFactory: JobEnqueueIdFactory;
  readonly store: JobQueueStore;
}

interface JobQueueDependencies extends JobEnqueuerDependencies {
  readonly retrySchedule: JobRetrySchedule;
  readonly config: JobQueueConfig;
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

declare function createJobEnqueuer(
  dependencies: JobEnqueuerDependencies,
): JobEnqueuer;

declare function createJobQueue(
  dependencies: JobQueueDependencies,
): JobQueue;

declare function createJobWorker(
  queue: JobQueue,
  handlers: readonly JobHandler[],
): Outcome<JobWorker, JobWorkerConfigurationFailure>;
```

`JobEnqueuer`, `JobEnqueueIdFactory`, `JobEnqueuerDependencies`, and `createJobEnqueuer` are the additive composition seams for selected-folder enqueue. The implementation reuses the queue's existing enqueue validation, canonical fingerprinting, clock, ID allocation, and store call. It does not accept lease-token allocation, lease duration, or retry scheduling because enqueue does not consume those policies. The existing `JobIdFactory` and `JobQueue` remain structurally compatible, so current consumers do not migrate.

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

- `JobEnqueuer` owns enqueue validation, canonical request fingerprinting, enqueue ID allocation, and its clock read. `JobQueue` adds lease-duration calculation, retry-time calculation from the returned lease attempt, and the remaining controls. Both delegate each mutation to one atomic store operation and share one private enqueue implementation.
- The canonical request fingerprint is a deterministic serialization of declared request fields in job-array order; it excludes diagnostics and runtime timestamps. The store treats it as opaque and compares it only for equality.
- `StoredEnqueueCommand.jobIds.length` must equal `request.jobs.length`; IDs align by array index. Port implementations reject malformed commands as `invalid_request` without partial writes.
- `JobQueueStore` owns durable compare-and-set mechanics and expired-lease recovery but no handler policy, domain result creation, clock, randomness, or prose interpretation.
- Fixed queue failures are returned unchanged. Stored rows or projections that
  fail adapter-owned structured validation become `stored_queue_invalid`.
  Expected unavailable storage and compare-and-set/transaction failures become
  `storage_unavailable`. Neither mapping parses database or exception prose.

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

Current implementation status: the deterministic checker, Jobs handler, immutable observation, SQLite repository, safe Node target resolver, one-request Node transport, public composition, and runtime registration are executable. History listing and staleness remain target contracts.

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

interface CommittedHealthObservation {
  readonly id: JobResultId;
}

type HealthCheckFailureCode =
  | "invalid_request"
  | "input_conflict"
  | "invalid_configuration"
  | "id_unavailable"
  | "clock_unavailable"
  | "transport_unavailable"
  | "storage_unavailable";

type HealthCheckFailure =
  | {
      readonly code:
        | "invalid_request"
        | "input_conflict"
        | "invalid_configuration"
        | "id_unavailable";
      readonly disposition: "terminal";
      readonly diagnostic?: string;
    }
  | {
      readonly code:
        | "clock_unavailable"
        | "transport_unavailable"
        | "storage_unavailable";
      readonly disposition: "retry";
      readonly diagnostic?: string;
    };

interface HealthChecker {
  check(
    request: HealthCheckRequest,
  ): Promise<Outcome<CommittedHealthObservation, HealthCheckFailure>>;
}

interface HealthCheckJobHandlerDependencies {
  readonly catalog: Pick<BookmarkCatalog, "getBookmark">;
  readonly checker: HealthChecker;
}

declare function createHealthCheckJobHandler(
  dependencies: HealthCheckJobHandlerDependencies,
): JobHandler;

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
  readonly maxRedirects: 5;
  readonly maxBodyBytes: number;
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

interface HealthBodyFingerprinter {
  fingerprint(body: Uint8Array): ContentHash;
}

interface HealthCheckerDependencies {
  readonly config: HealthCheckConfig;
  readonly clock: HealthClock;
  readonly idFactory: HealthIdFactory;
  readonly transport: HealthTransport;
  readonly fingerprinter: HealthBodyFingerprinter;
  readonly repository: HealthObservationRepository;
}

declare function createHealthChecker(
  dependencies: HealthCheckerDependencies,
): HealthChecker;

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

- `check` requires non-empty bookmark ID, input version, and URL. Timeout and body limits are positive safe integers and `maxRedirects` is exactly five. Every clock value, ID, transport fact, and repository result is validated at its receiving boundary.
- A repository observation is valid only when its facts form one coherent checker result: `retryCount` is zero; redirect hops are contiguous from `requestedUrl` and contain at most five entries; response facts end at the final hop URL and agree with deterministic classification; transport failures carry the matching status and error code without response-only fields; redirect errors carry the matching redirect response facts. Structurally valid but contradictory observations fail closed.
- `(bookmarkId, inputVersion)` is the immutable idempotency key for one requested check. `check` loads it before allocating an ID or calling transport. An existing observation with the exact requested URL returns unchanged. Reusing the key for a different URL returns terminal `input_conflict`. A later scheduled check must use a new input version.
- `saveIfAbsent` atomically inserts by that key. A concurrent identical observation returns the stored row. A different observation for the same key returns `observation_conflict`; local code never merges or repairs it.
- Expected network outcomes, including timeout, DNS, TLS, unsupported URL, malformed response, and connection failure, produce durable observations and successful `check` outcomes. Invalid requests, input conflicts, invalid configuration, and unavailable IDs are terminal. Unavailable clock, transport, and storage dependencies are retryable. Repository `observation_conflict` maps to terminal `input_conflict`; repository unavailability maps to retry `storage_unavailable`. Diagnostics remain opaque evidence.
- The observation ID is a `JobResultId`, so a successful Health job can return it directly as `{ kind: "health_observation", id }` after the repository commit.
- The Health job handler accepts only `health_check` leases. It resolves the bookmark through `BookmarkCatalog.getBookmark`, passes the exact bookmark ID, input version, and stored URL to `HealthChecker.check`, and returns the committed observation ID. Missing bookmarks and invalid targets are terminal typed failures. Catalog unavailability and retry Health failures remain retry failures. The handler does not parse diagnostics or infer URL meaning.

Transport and request-safety rules:

- `HealthTransport` executes one request with redirects disabled. The Health service walks redirects itself so every hop is recorded and bounded.
- `HealthTransportRequest.timeoutMs` is the deadline for one complete transport call, including target resolution and the socket exchange. A resolution that misses the deadline returns `timeout`; its late result cannot start a request. Reported duration includes resolution time.
- The production transport accepts only HTTP and HTTPS URLs without credentials. Before every request, including redirect targets, it resolves the host, rejects loopback/private/link-local/multicast/unspecified destinations by default, pins the approved address for the connection, and preserves the original host for HTTP/TLS verification. Any unresolved or mixed public/private target is rejected as `unsupported_url`. These checks cannot be disabled by page content or redirects.
- IPv4 eligibility follows the IANA IPv4 Special-Purpose Address Registry. Non-global ranges are rejected, including deprecated 6to4 relay addresses; registry-declared globally reachable exceptions inside otherwise special ranges remain eligible.
- Test transports may explicitly allow loopback fixtures. That permission is injected in tests and never becomes a user URL rule.
- Transport adapters author `HealthTransportFailureCode` from structured runtime facts. Unknown Node `TypeError` cases remain `unknown_transport` until typed cause fixtures prove a narrower mapping. Exception messages, socket prose, and traces never select a code.
- Headers are lower-case, deduplicated, and restricted to `HealthSelectedHeaderName`. Header/body values are evidence only. Bodies are capped before allocation beyond `maxBodyBytes`; the observation stores only a fingerprint.

Redirect and classification rules:

- Redirect statuses are 301, 302, 303, 307, and 308. A hop requires one non-empty `Location` that resolves against the current URL and passes transport safety. Missing/invalid locations produce `uncertain` with `invalid_redirect`. Exceeding `maxRedirects` produces `uncertain` with `redirect_limit`.
- The first checker performs no retries. `retryCount` remains zero; the request budget covers one initial request and at most five manual redirect requests.
- A final 2xx response is `healthy` without redirects. A final 2xx after only 301/308 hops is `redirect_permanent`. Any 302/303/307 hop makes the result `redirect_temporary`.
- Final 401, 403, 404, 410, 429, and 5xx responses map to `authentication_required`, `forbidden`, `not_found`, `gone`, `rate_limited`, and `server_error`. Other HTTP statuses are `uncertain`.
- Transport failure codes map directly where a matching `HealthStatus` exists. Connection, malformed, and unknown transport failures map to `uncertain` while preserving `errorCode`. Unsupported URL maps to `unsupported_url` without a request.
- `soft_404_suspected` and `parked_domain_suspected` require a separate schema-valid typed page-classification result with evidence references. The deterministic network checker never emits either status from body prose or an HTTP status alone.
- `checkedAt` is the validated completion clock value. `durationMs` is the safe sum of transport durations. Redirects, requests, headers, final status, error code, and body fingerprint are reconstructed from typed fields only.

Staleness rules:

- Staleness consumes immutable observations for exactly one bookmark. It sorts by `checkedAt` plus observation ID for deterministic ties and returns only IDs it actually used.
- A user exception or a latest reachable (`healthy` or redirect) observation returns `no_warning`. No observations returns `retry`.
- A single failure of any kind returns `retry`. Authentication, forbidden, rate limit, server, DNS, timeout, TLS, unsupported, connection/malformed/unknown, and uncertain evidence never produce `review` by themselves.
- `review` requires repeated `not_found`/`gone` observations or repeated typed soft-404/parked evidence under a versioned threshold policy. The exact count and minimum elapsed interval are fixed in the dedicated staleness implementation slice before code; changing them requires policy-version and test changes.
- Confidence is finite in `[0, 1]`. Reason codes are closed, observations remain unchanged, and no assessment authorizes deletion. Models may supply typed page-suspicion evidence; they cannot set disposition, confidence, or reasons.

Hides: request headers, timeout implementation, safe address resolution/pinning, redirect walker, DNS/TLS structured-code mapping, per-domain limiter, body hashing, repository schema, and staleness thresholds.

Allowed dependencies: `HealthTransport`, `HealthClock`, `HealthIdFactory`, `HealthBodyFingerprinter`, `HealthObservationRepository`, configuration, and optional schema-valid typed page-classification evidence.

Boundary notes: health observations are facts from one bounded check. Staleness is a versioned policy result over history. Network/page evidence may be model-assisted only through a declared typed producer contract. No model, transport diagnostic, or single transient failure can issue a stale or delete decision.

Capability brief for first Health implementation:

- Placement: extend the Health module. Transport adapters implement execution and request safety; SQLite implements the Health-owned repository port; the Jobs handler calls `check` and returns the committed observation ID.
- Contract consumers: `HealthChecker` consumes transport, clock, ID, fingerprint, and repository ports. `StalenessPolicy` consumes immutable observation history. A composition root may expose both as `HealthService`. The worker consumes `HealthChecker` through one Health `JobHandler`; UI/review consumers use stored observations and `StalenessPolicy`.
- Migration order: executable Health types, deterministic classifier/service against fakes, Node transport cause fixtures plus safe-request design, SQLite repository, Health job handler, then staleness policy thresholds. Public contract changes remain isolated slices.
- The first handler composes `HealthChecker` with Catalog lookup and uses `health_check_v1`: one queue attempt, no in-check retry, and at most five redirects. The preview budget and runtime configuration must match before the handler is registered.
- Out of scope for the first implementation: concurrency limits, rendered browsing, page-classifier production, live-internet probes, deletion, and Chrome writes.

## Node runtime adapter

Responsibility: implement Node-specific runtime ports used by local composition.

Public contract:

```ts
interface NodeRuntimeClock extends HealthClock, JobClock {}

interface NodeRuntimePorts {
  readonly clock: NodeRuntimeClock;
  readonly healthIdFactory: HealthIdFactory;
  readonly jobIdFactory: JobIdFactory;
  readonly bodyFingerprinter: HealthBodyFingerprinter;
  readonly healthTransport: HealthTransport;
}

declare function createNodeRuntimePorts(): NodeRuntimePorts;
```

The returned transport always uses the private safe resolver by default. Test-only resolver injection stays on the internal transport factory and never appears in `adapters/node/public.ts`. The clock returns canonical UTC, IDs come from Node cryptographic randomness, and fingerprints use `sha256:` plus the lowercase SHA-256 hex digest of the supplied bytes.

Hides: DNS lookup records, address classification, pinned request options, TLS options, socket lifecycle, Node error objects, hash objects, and random UUID calls.

Allowed dependencies: Node DNS, HTTP, HTTPS, net, TLS, crypto, and clock APIs plus public Health and Jobs port types.

Boundary notes: this adapter supplies mechanisms only. It does not choose Health status, retry disposition, job attempts, redirect limits, worker repetition, or handler registration. Controlled certificate evidence proves that the production transport preserves Host and SNI while connecting to a pinned address; it does not claim public-network reachability.

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

Repository model-evaluation tooling is separate from the production adapter. It
owns fixed versioned benchmark schemas, synthetic source spans, gold labels,
deterministic scorers, and blinded review artifacts. The strict-output pilot
records only redacted structured outcomes. The labeled calibration benchmark may
retain generated fields for synthetic fixtures, validates every provider envelope
through the declared schema, and scores only explicit gold contracts: source-span
references, required-fact coverage, accepted tags/topics/entities, warning
expectations, and forbidden exact claims. It never repairs malformed output or
infers semantic correctness from free-form prose.

The calibration contract mirrors the target Enrichment fields closely enough to
test candidate suitability, but remains evaluation-owned and versioned
independently. Changing it does not change the Enrichment public contract.
Automated scores may qualify a candidate for blinded human review or a larger
benchmark; they cannot select the production enrichment profile or claim search
quality.

Evaluation artifacts:

```ts
interface LabeledEnrichmentCase {
  id: string;
  category: string;
  sourceSpans: readonly SourceSpan[];
  containsPageInstruction: boolean;
  gold: EnrichmentGoldContract;
}

interface EnrichmentGoldContract {
  expectedLanguage: string;
  expectedContentType: string;
  requiredFacts: readonly RequiredFact[];
  acceptedLiteralTags: readonly string[];
  acceptedTopics: readonly string[];
  acceptedEntities: readonly NamedEntity[];
  requiredWarnings: readonly string[];
  forbiddenClaims: readonly string[];
}

interface QualityBenchmarkReport {
  schemaValidRate: number;
  evidenceValidRate: number;
  requiredFactCoverage: number;
  literalTagPrecision: number;
  usefulTopicCoverage: number;
  entityPrecision: number;
  entityRecall: number;
  criticalInjectionFailures: number;
  forbiddenClaimMatches: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
}
```

Boundary notes: benchmark source material is synthetic or explicitly public.
Generated content may appear only in declared local evaluation artifacts. Human
ratings remain separate from automated scores and must identify their reviewer
and rubric version. The production Enrichment schema and its thresholds require
their own contract slice after the calibration evidence is reviewed.

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
interface CatalogDatabaseFailure {
  readonly code: "storage_unavailable";
}

interface CatalogDatabaseSession {
  readonly store: CatalogSnapshotStore;
  close(): void;
}

declare function openCatalogDatabase(
  databasePath: string,
): Outcome<CatalogDatabaseSession, CatalogDatabaseFailure>;

interface BookmarkCleanDatabaseSession {
  readonly catalogStore: CatalogSnapshotStore;
  readonly jobQueueStore: JobQueueStore;
  readonly healthRepository: HealthObservationRepository;
  close(): void;
}

interface BookmarkCleanDatabaseFailure {
  readonly code: "storage_unavailable";
}

declare function openBookmarkCleanDatabase(
  databasePath: string,
): Outcome<BookmarkCleanDatabaseSession, BookmarkCleanDatabaseFailure>;
```

`openCatalogDatabase` remains the backward-compatible Catalog-only opener. `openBookmarkCleanDatabase` opens one connection, completes Catalog, Jobs, and Health migrations before returning, and supplies each module-owned persistence port from that connection. Both sessions close before returning a failure and have idempotent `close` methods.

Hides: Node SQLite types, connection lifecycle, pragmas, migrations table, prepared statements, FTS5 maintenance, BLOB encoding, and backup implementation.

Allowed dependencies: Node SQLite API plus public module-owned persistence ports.

Boundary notes: SQL stays inside adapter implementations or a module's private repository implementation. Apps and orchestrator code never execute SQL or receive a raw database handle. Every migration has an automated forward-migration test. File-backed sessions require an existing owner-controlled parent directory and reject symlink final components, foreign-owned or multiply linked files, and group/world-writable parents before SQLite opens the path. The single-user local boundary does not claim encryption or protection from hostile ancestor replacement; shared or service distribution requires a new threat model.

## Local CLI app

Responsibility: turn local bookmark commands into application wiring, stable process output, and process exit codes.

Public command:

```text
npm run --silent import -- --input <bookmarks.html> --database <bookmarks.sqlite>
```

Successful stdout is one JSON line:

```ts
interface ImportCommandSuccess {
  readonly ok: true;
  readonly snapshotId: string;
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
}
```

Failure stderr is one JSON line. It contains fixed codes and may include typed source or Catalog fields, but never exception prose or a parsed diagnostic:

```ts
interface ImportCommandFailure {
  readonly ok: false;
  readonly code:
    | "invalid_arguments"
    | "input_unavailable"
    | "storage_unavailable"
    | "import_failed"
    | "unexpected_failure";
  readonly stage?: "source" | "catalog";
  readonly failureCode?: string;
  readonly path?: readonly number[];
  readonly field?: string;
}
```

Exit codes are `0` for success, `2` for invalid arguments, `3` for unreadable input, `4` for database open or migration failure, `5` for typed source or Catalog rejection, and `1` for an unexpected exception. The command creates its capture timestamp immediately after reading valid arguments. It always closes an opened database session in `finally`.

The read-only inspection command is:

```text
npm run --silent inspect -- --database <bookmarks.sqlite> --snapshot <snapshot-id>
```

Successful stdout is one JSON line. Folder order matches the stored snapshot; each `bookmarkCount` includes every bookmark below that folder:

```ts
interface InspectFolder {
  readonly id: string;
  readonly title: string;
  readonly bookmarkCount: number;
  readonly children: readonly InspectFolder[];
}

interface InspectCommandSuccess {
  readonly ok: true;
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly rootCount: number;
  readonly folderCount: number;
  readonly bookmarkCount: number;
  readonly folders: readonly InspectFolder[];
}
```

Inspection failure stderr is one JSON line:

```ts
interface InspectCommandFailure {
  readonly ok: false;
  readonly code:
    | "invalid_arguments"
    | "storage_unavailable"
    | "snapshot_not_found"
    | "snapshot_invalid"
    | "unexpected_failure";
}
```

Inspection exit codes are `0` for success, `2` for invalid arguments, `4` for database or store unavailability, `5` for an invalid stored snapshot, `6` for a missing snapshot, and `1` for an unexpected exception. The session closes before output on every opened path.

The selected-folder preview command is:

```text
npm run --silent preview -- --database <bookmarks.sqlite> --snapshot <snapshot-id> --folder <folder-id>
```

Successful stdout is one JSON line matching `ProcessingPreview` with `ok: true`. The command selects `health_check_v1`; callers cannot override its limits through free-form arguments.

Preview failure stderr is one JSON line with `ok: false` and one of `invalid_arguments`, `storage_unavailable`, `snapshot_invalid`, `snapshot_not_found`, `folder_not_found`, `estimate_overflow`, or `unexpected_failure`. Exit codes are `2`, `4`, `5`, `6`, `7`, `8`, and `1` respectively. The session closes before output on every opened path.

The selected-folder enqueue command is:

```text
npm run --silent enqueue -- --database <bookmarks.sqlite> --snapshot <snapshot-id> --folder <folder-id> --run <run-id>
```

The command selects `health_check_v1`; `run-id` is an opaque non-empty caller-authored identifier. Successful stdout is one JSON line containing `ok: true`, the exact `runId`, `ProcessingStart.preview`, and `ProcessingStart.batch`. The command does not run a worker or make a network call.

Enqueue failure stderr is one JSON line with `ok: false` and one of `invalid_arguments`, `storage_unavailable`, `snapshot_invalid`, `snapshot_not_found`, `folder_not_found`, `estimate_overflow`, `empty_selection`, `run_conflict`, `enqueue_rejected`, or `unexpected_failure`. Exit codes are `2`, `4`, `5`, `6`, `7`, `8`, `9`, `10`, `11`, and `1` respectively. `queue_unavailable` maps to `storage_unavailable`. The multi-module database session closes before output on every opened path.

The one-job Health worker command is:

```text
npm run --silent worker:once -- --database <bookmarks.sqlite>
```

Its Local CLI result contract is:

```ts
type RunOneCommandSuccess =
  | { readonly ok: true; readonly status: "idle" }
  | {
      readonly ok: true;
      readonly status: "succeeded";
      readonly jobId: JobId;
      readonly batchId: JobBatchId;
      readonly result: JobResultReference;
    }
  | {
      readonly ok: true;
      readonly status: "failure_reported";
      readonly jobId: JobId;
      readonly batchId: JobBatchId;
      readonly failureCode: string;
      readonly disposition: "retry" | "terminal";
    };

interface RunOneCommandFailure {
  readonly ok: false;
  readonly code:
    | "invalid_arguments"
    | "storage_unavailable"
    | "worker_unavailable"
    | "unexpected_failure";
}

type RunOneCommandResult =
  | { readonly exitCode: 0; readonly output: RunOneCommandSuccess }
  | {
      readonly exitCode: 1 | 2 | 4 | 12;
      readonly output: RunOneCommandFailure;
    };

type RunOneCommand = (
  arguments_: readonly string[],
) => Promise<RunOneCommandResult>;
```

The command accepts exactly one non-empty `--database` flag and runs at most one job with worker ID `worker:local-once`. Its fixed `health_check_v1` operating profile uses a 10,000 ms deadline for each request hop, five redirects, a 65,536-byte body cap, and a 300,000 ms lease. The required retry schedule returns the failure time unchanged; `health_check_v1` has one queue attempt, so this profile never makes a failed job eligible for another attempt. A multi-attempt profile requires a new policy decision.

`idle`, `succeeded`, and `failure_reported` are completed command steps and exit `0`. Success output omits lease tokens, targets, input versions, URLs, bookmark content, timestamps, and diagnostics. Queue storage failures map to exit `4`; other typed queue or handler interruptions map to `worker_unavailable` and exit `12`. Invalid handler configuration or output is an invariant violation and reaches the existing process-level `unexpected_failure` boundary. Every opened Health worker session closes in `finally`.

Hides: argument parsing, filesystem calls, wall-clock access, JSON serialization, stream writes, and process exit-code assignment.

Allowed dependencies: Node filesystem/process APIs and public Orchestrator, Catalog, Processing, Jobs, Health, Node-runtime, Chrome HTML, and SQLite session contracts.

Boundary notes: the CLI is the composition root. Its Health worker session opens the multi-module database session, builds Catalog and Jobs services from public factories, builds the checker from `NodeRuntimePorts`, registers exactly one Health handler, and exposes only the resulting `JobWorker` plus `close`. The run-one command owns the fixed first operating profile and invokes that worker once. The enqueue command separately composes Catalog, `JobEnqueuer`, and `ProcessingStarter`; it does not construct worker-only lease or retry policy. The safe resolver, transport options, repositories, stores, checker, handler array, and Jobs request encoding stay inside their owners. The CLI may select concrete implementations but may not parse HTML, validate Catalog data, traverse snapshots, assemble Jobs requests, execute SQL, calculate processing budgets, interpret diagnostics, or repeat worker execution. Import prints no bookmark contents. Inspection, preview, and enqueue may print folder IDs and titles plus aggregate counts, but never bookmark titles, URLs, source IDs, dates other than snapshot capture or typed batch times, or diagnostics. It never mutates Chrome.

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
- Letting CLI or orchestrator code traverse Catalog snapshots or assemble `EnqueueBatchRequest`; Processing owns selected-scope work authorship.
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
- RESOLVED for first runnable import: `apps/local-cli` owns files and process behavior, `core/orchestrator` owns parse-then-import sequencing, and the SQLite adapter owns open-migrate-close. The command consumes public runtime entry points only.
- RESOLVED for one real export: the production CLI imported a private Chrome export with 1,174 roots, 427 folders, and 13,709 bookmarks. The raw file remains ignored and uncommitted; broader Chrome-version compatibility remains unclaimed.
- RESOLVED 2026-07-16: the Local CLI inspection command no longer traverses Catalog snapshots or calculates descendant counts. The additive Catalog inspection-query contract landed first; Catalog now owns the projection and the CLI only formats its result.
- RESOLVED 2026-07-16: the Node adapter now applies the complete per-hop deadline and registry-aligned request-target safety policy at its existing boundary, including IPv4 and IPv6 special-purpose exceptions and embedded IPv4 forms.
- RESOLVED 2026-07-16: Health fully validates every `HealthObservationRepository` result before durable success, including fact coherence, retry count, redirect continuity, final URL, and deterministic classification. SQLite validation remains defense in depth.

## Capability brief: first runnable import command

- Behavior: read one Chrome HTML export, open and migrate one SQLite database, parse and import the snapshot, print a stable JSON summary, close the database, and return a stable exit code.
- Placement: `core/orchestrator` owns the import use case; `apps/local-cli` owns files, clock, wiring, output, and exit codes; existing Chrome HTML, Catalog, and SQLite owners keep their current responsibilities.
- Contract additions: Catalog exposes its service and ID-factory creators through `modules/catalog/public.ts`; Chrome HTML exposes its parser through `adapters/chrome-html/public.ts`; SQLite adds an opaque Catalog database session in `adapters/sqlite/public.ts`; the orchestrator adds the staged import contract in `core/orchestrator/public.ts`.
- Consumers: the first and only consumer is `apps/local-cli`. Future local HTTP service composition may reuse the orchestrator and database session without reusing CLI parsing or output code.
- Migration order: Catalog runtime entry point, Chrome HTML runtime entry point, SQLite session contract then implementation, Orchestrator contract then implementation, CLI composition and subprocess acceptance.
- Explicitly out of scope: Jobs execution, Health, enrichment, search, web UI, Chrome API import, real-export compatibility claims, database backup, generic plugin registration, and Chrome mutation.

## Capability brief: read-only library inspection

- Behavior: open and migrate a Catalog database, load one snapshot by ID, and print the stored folder hierarchy with descendant bookmark counts without writing snapshot data.
- Current placement: Catalog owns the implemented folder-only inspection projection through `CatalogInspector`; `apps/local-cli` owns argument parsing, formatting to the documented command output, stream selection, and lifecycle. SQLite continues to own persistence.
- Implemented contract: `CatalogInspector.inspectSnapshot(id: SnapshotId): Promise<Outcome<CatalogInspection | null, CatalogStorageFailure>>`. `CatalogInspection` contains `snapshotId`, `capturedAt`, `rootCount`, `folderCount`, `bookmarkCount`, and ordered `folders`. Each `CatalogInspectionFolder` contains `id: BookmarkId`, `title`, descendant `bookmarkCount`, and ordered child `folders`. Root bookmarks contribute to snapshot totals but not the folder list. The factory is `createCatalogInspector(catalog: Pick<BookmarkCatalog, "getSnapshot">): CatalogInspector`; it exposes neither SQLite nor full records to consumers.
- Consumers: the local CLI subprocess test and the user selecting a folder for a later processing preview.
- Completed migration order: the type-only Catalog contract and contract tests landed first; the approved factory was then implemented and exposed; the CLI migrated and deleted its snapshot traversal. Missing snapshots remain successful `null` reads and existing `CatalogStorageFailure` values pass through unchanged.
- Explicitly out of scope: bookmark titles or URLs in output, selected-folder job creation, HTTP/UI surfaces, reconciliation, health checks, extraction, enrichment, search, and Chrome mutation.

## Capability brief: selected-folder processing preview

- Behavior: load one snapshot, select one folder by local ID, count all descendant bookmarks, and report the bounded `health_check_v1` job, network-request, and model-call budget.
- Placement: the new Processing module owns scope traversal and budget arithmetic. Catalog remains the source of snapshot truth. The Local CLI selects the fixed profile and owns database lifecycle plus structured process output.
- Contract additions: add `ProcessingPlanner`, its request/result/failure types, the versioned `health_check_v1` profile, and the `preview` CLI command above. No existing executable module contract changes for this runnable increment.
- Consumers: the Local CLI now; later processing-start orchestration must consume the same profile before enqueuing Jobs.
- Migration order: Processing public types and contract tests, Processing service against Catalog fakes, then CLI composition and subprocess proof.
- Explicitly out of scope: enqueueing, database writes beyond normal migrations, network/model calls, bookmark content in output, Health implementation, UI, and Chrome mutation.

## Capability brief: first real processing handler

- Behavior: resolve a leased bookmark ID to its stored URL, execute one bounded Health check, durably commit the observation, and return its typed result reference to the existing Jobs worker.
- Placement: Catalog owns the bookmark lookup; Health owns checking and the `JobHandler` adapter; Jobs keeps lease and retry state; a later composition root registers the handler.
- Contract changes: add `BookmarkCatalog.getBookmark` plus the matching store read in an isolated Catalog contract slice. Reintroduce the smallest caller-driven Health executable contract in a separate slice before implementing its checker, repository, or handler.
- Consumers: the first Health handler consumes Catalog lookup and `HealthChecker`; the existing Jobs worker consumes the completed handler without changing its public contract.
- Migration order: Catalog lookup, minimal Health executable types, and the unregistered handler factory may land against fakes. The bounded checker and repository must land before runtime registration. `health_check_v1` runtime limits must match the preview before registration.
- Explicitly out of scope: extraction, enrichment, model calls, staleness policy, rendered browsing, deletion, Chrome writes, and smuggling URLs into Jobs targets or `inputVersion`.

## Capability brief: first local Health worker composition

- Behavior: open one local database, assemble the existing bounded Health checker and handler from public contracts, register that handler with the one-step Jobs worker, and close the shared database session after the caller finishes.
- Placement: the Local CLI remains the composition root. SQLite supplies Catalog, Jobs, and Health persistence ports through one opaque session. The Node runtime adapter supplies clock, IDs, body fingerprinting, and the default safe transport. Jobs and Health retain all domain behavior.
- Contract additions: the multi-module SQLite session, `NodeRuntimePorts`, public Jobs queue and worker factories, and the Local CLI `HealthWorkerSession` composition contract. The Health public contract does not change. The handler array is the registry; no container or registry abstraction is added.
- Consumers: the first consumer is the Local CLI Health worker session. Existing import, inspect, and preview commands keep `openCatalogDatabase` during this migration.
- Migration order: multi-module SQLite session; Node runtime ports; successful controlled HTTPS evidence; Jobs public factory promotion; Local CLI session composition and Health handler registration. Each public contract change remains in its owning slice.
- Local composition rule: the first registry contains only `health_check`. It uses `health_check_v1` with one job attempt, one initial request, at most five redirects, and zero model calls. A later multi-attempt profile must add an explicit retry-policy decision before registration.
- Explicitly out of scope: running a job from a command, polling, selected-folder enqueue, public internet proof, runtime configuration flags, rendered browsing, model calls, deletion, Chrome writes, and migrating existing CLI commands to the broader session.

## Capability brief: selected-folder durable enqueue

- Behavior: accept one database path, snapshot ID, folder ID, and opaque run ID; load the immutable Catalog snapshot; author one ordered `health_check_v1` job per descendant bookmark; atomically enqueue the batch; return the existing bounded preview plus typed batch summary; and close without executing work.
- Placement: extend Processing because selected-scope traversal, profile expansion, sequence order, run identity, and budget agreement are one responsibility. Jobs remains the sole enqueue implementation and SQLite remains the sole persistence mechanism. The Local CLI only parses arguments, wires public contracts, maps typed outcomes, and owns lifecycle.
- Jobs contract: the structurally narrow `JobEnqueueIdFactory`, `JobEnqueuer`, `JobEnqueuerDependencies`, and `createJobEnqueuer` reuse the queue's enqueue implementation without requiring lease-token, lease-duration, or retry-policy dependencies. Existing `JobIdFactory`, `JobQueue`, worker composition, and consumers remain compatible.
- Processing contract: `ProcessingRunId`, `ProcessingStartRequest`, `ProcessingStart`, `ProcessingStartFailure`, `ProcessingStarterDependencies`, `ProcessingStarter`, and `createProcessingStarter` extend the existing preview surface without changing preview behavior or its consumer.
- Orchestrator wiring: the Local CLI opens `BookmarkCleanDatabaseSession`, builds Catalog, gets clock and IDs from `NodeRuntimePorts`, builds only `JobEnqueuer`, builds `ProcessingStarter`, calls `start` once, and closes in `finally`. It does not expose the queue/store or reuse `HealthWorkerSession`.
- Idempotency: Processing privately serializes `(snapshotId, folderId, profileId, runId)` for Jobs batch idempotency and separately serializes `(profileId, snapshotId, runId)` for every target input version. Same tuple means replay; a new run ID means a new batch and Health input version. Snapshot immutability and versioned profiles keep a replay's authored request stable, while snapshot identity prevents stale reuse after future bookmark reconciliation.
- Consumers and migration: the Jobs enqueue-only seam, Processing starter, real SQLite composition proof, direct Local CLI command, and package route are complete. The package command is the first user-facing consumer.
- Explicitly out of scope: worker execution, polling, live network calls, production Health timeout or lease values, bookmark URLs or titles in output, SQL changes, new Jobs states, multi-attempt profiles, scheduling recurring runs, staleness decisions, deletion, and Chrome mutation.
- Provisional items: none. Callers supply the required run ID. The enqueue-only Jobs seam removes the otherwise unresolved need for unused worker policy values.

## Capability brief: one-job Health worker command

- Behavior: accept one database path, open the existing Health worker session with the fixed first operating profile, lease at most one eligible `health_check` job, report its handler result durably, return a redacted typed step, and close. One invocation never loops or polls.
- Placement: the Local CLI owns command arguments, operating values, result projection, exit codes, and lifecycle. The existing `HealthWorkerSession` owns public composition. Jobs retains lease and transition behavior, Health retains URL checking and observation meaning, and the Node adapter retains request safety and timeout mechanics.
- Contract changes: clarify that the existing transport timeout covers resolution plus socket exchange, then add the type-only Local CLI `RunOneCommandResult` contract above. No Jobs, Health, SQLite, Catalog, Processing, or Node public type shape changes.
- Operating profile: worker ID `worker:local-once`; 10,000 ms per-hop transport deadline; five redirects; 65,536-byte body cap; 300,000 ms lease; failure-time retry schedule; one queue attempt from `health_check_v1`.
- Migration order: complete the Node timeout behavior first, add the Local CLI result types, implement the direct command, prove one real queued job through SQLite with controlled zero-request loopback rejection, then add package routing and subprocess acceptance.
- Proof boundary: controlled fixtures may prove that default request safety rejects loopback without opening a socket. F0 does not claim public-internet success. Existing controlled HTTPS evidence remains the only successful production-transport proof.
- Explicitly out of scope: worker loops, polling, concurrency, configurable operating values, multi-attempt profiles, progress output, scheduling, public-internet acceptance, staleness, deletion, model calls, rendered browsing, and Chrome mutation.
- Provisional items: none. The first profile values are fixed for this command and version.

## Capability brief: bounded bookmark trees

- Behavior: reject oversized Chrome HTML before parser allocation grows without bound, reject Catalog inputs beyond one shared structural budget, reject over-budget stored snapshots as invalid, and keep import, inspection, preview, and enqueue behavior stack-safe at every accepted boundary.
- Placement: Catalog owns the cross-source semantic node and depth limits because it owns bookmark hierarchy. The Chrome HTML adapter owns the UTF-8 source-byte limit and applies Catalog's public structural limits while translating. SQLite owns bounded validation of stored rows. Processing and the Local CLI consume only bounded public Catalog projections and retain their existing output contracts.
- Fixed first-horizon limits: at most 20,000 semantic nodes, at most depth 256 with roots at depth 1, and at most 16,777,216 UTF-8 bytes for Chrome HTML. Limits are inclusive. The structural ceiling preserves the recorded 14,136-node real export and exceeds the maintained 10,000-node performance fixture; a later increase is a versioned policy decision with new performance evidence.
- Contract changes: Catalog adds `CatalogResourceLimits`, `CATALOG_RESOURCE_LIMITS`, `node_limit_exceeded`, and `depth_limit_exceeded`. Chrome HTML adds `CHROME_HTML_MAX_INPUT_BYTES` plus `invalid_encoding`, `input_too_large`, and matching structural failures. Existing success types, storage failure codes, CLI exits, inspection output, and Processing results remain unchanged.
- Failure ownership: Chrome HTML authors source-stage byte and early structural failures. Catalog independently authors structural failures for every producer. SQLite maps an over-budget or malformed stored graph to `stored_snapshot_invalid`; it does not repair or truncate. CLI and Processing map only these structured results and never infer resource meaning from diagnostics or exceptions.
- Implementation rule: current tree consumers use explicit work stacks or queues. Call-stack recursion is forbidden. Source order, depth-first ID allocation, immutable output, descendant counts, cycle rejection, atomic persistence, and privacy redaction remain unchanged. Each owner may back its public runtime constant with one private same-module value so internal implementations consume the exact policy without importing their own `public.ts` entry point.
- Migration order: public contracts first; Catalog validation/construction second; Chrome HTML and bounded CLI file reading third; SQLite save/load fourth; Catalog inspection plus CLI formatting fifth; Processing traversal sixth. Focused boundary tests precede behavior in each slice, and the existing 10,000-node end-to-end proof remains green throughout.
- Explicitly out of scope: streaming HTML parsing, configurable limits, database schema changes, truncation, partial imports, automatic retries, arbitrary-depth support, or a shared cross-module traversal implementation.
- Provisional items: none. Revisit the fixed values only with a concrete larger valid export and measured memory/runtime evidence.

## Contract changelog

- 2026-07-16: completed the post-remediation adversarial corrections: coherent Health repository facts, fatal Chrome HTML UTF-8 decoding, and IANA-aligned IPv4 request-target policy.
- 2026-07-16: added `invalid_encoding` to the Chrome HTML source failure contract for fatal UTF-8 decoding by file-reading consumers; the Local CLI and contract tests migrate before decoding behavior changes.
- 2026-07-16: completed bounded bookmark-tree enforcement across Catalog validation/construction, Chrome HTML and CLI input, SQLite persistence, inspection/formatting, and Processing selection. Every accepted owner path is iterative and limit-plus-one input fails through its existing typed boundary.
- 2026-07-16: approved fixed bookmark-tree resource contracts for Catalog and Chrome HTML; future consumers are Catalog validation/construction, the Chrome parser, SQLite persistence, Processing, and Local CLI inspection/import. Runtime public types migrate in an isolated contract slice before implementations.
- 2026-07-16: implemented the additive Catalog inspection-query contract for the Local CLI consumer after landing its public types separately; Catalog now owns projection and the CLI output shape is unchanged.
- 2026-07-15: distinguished current executable modules from target architecture and recorded three boundary repairs found by the adversarial audit: Catalog-owned inspection projection, Node-owned Health safety behavior, and Health-owned repository-result validation. No executable contract changed.
- 2026-07-12: initial target module map created; no runtime consumers exist.
- 2026-07-13: completed the first catalog import/read contract and updated the orchestrator import signature; future consumers are catalog validators, the Chrome HTML adapter, and SQLite catalog persistence; no runtime consumers required migration.
- 2026-07-13: added the pure `ChromeHtmlImporter` producer contract, typed source failures, timestamp and hierarchy rules, and private path-derived source-ID ownership; no runtime consumers required migration.
- 2026-07-13: added typed Catalog storage failures, revised service results, and defined Catalog-owned snapshot-store and ID-factory ports; executable public types migrate before the Catalog service and SQLite adapter.
- 2026-07-13: completed the durable Jobs state machine, typed queue/store ports, lease and retry policy, and migration order; future consumers are the orchestrator, worker harness, and SQLite Jobs adapter, with no current runtime consumer to migrate.
- 2026-07-13: added the one-step worker and handler-plugin contract, typed interruption boundaries, and durable-result-before-success ownership; executable worker types must land before worker implementation and the interruption harness.
- 2026-07-13: replaced the provisional Health sketch with typed transport facts, safe manual redirects, idempotent observations, fixed classification rules, and a separate versioned staleness boundary; executable Health types precede service, transport, repository, handler, and threshold-policy slices.
- 2026-07-13: split Health behavior into `HealthChecker` and `StalenessPolicy`, with `HealthService` as their composition, after the first service gate exposed that observation execution and history policy could not migrate safely in one runtime slice.
- 2026-07-13: marked Health as a deferred target after removing its uncalled implementation and fixtures; the remaining executable types have only contract-test consumers and are removed in an isolated contract slice before future vertical replanning.
- 2026-07-14: defined the first runnable import boundary; new consumers are the local CLI and its subprocess acceptance test, with public runtime entry points migrating before composition.
- 2026-07-14: implemented the Orchestrator import outcome as a local staged union rather than flattening source and Catalog failures to satisfy the shared coded-error generic.
- 2026-07-14: added the read-only inspect CLI contract; the local CLI and its subprocess test are the only new consumers and existing public module contracts do not change.
- 2026-07-14: added the Processing preview contract and fixed `health_check_v1` budget; its first consumers are the Processing service and Local CLI.
- 2026-07-14: approved additive Catalog bookmark lookup and the caller-driven Health handler boundary; their executable contracts migrate in isolated slices before handler registration.
- 2026-07-14: implemented indexed Catalog bookmark lookup, the minimal committed-observation Health contract, and an unregistered Health handler factory; checker and repository implementation remain prerequisites for runtime registration.
- 2026-07-15: approved the executable immutable Health observation and two-method repository contract; SQLite readers and writers consume it next while history listing remains deferred with staleness.
- 2026-07-15: replaced the deferred Health retry and delay sketch with the fixed `health_check_v1` checker ports; the classifier and deterministic checker consume the contract next.
- 2026-07-15: activated the deterministic Health checker factory with validated manual redirects and durable SQLite read-back; Node transport remains uncomposed.
- 2026-07-15: implemented the safe full-answer target resolver and pinned one-request Node transport; public composition and handler registration remain separate future contract work.
- 2026-07-15: placed first worker composition in the Local CLI, approved opaque multi-module SQLite and Node runtime ports, and kept the handler array private; consumers migrate SQLite, Node, and Jobs public seams before registration.
- 2026-07-15: implemented the additive multi-module SQLite session with real Catalog, Jobs, and Health ports; existing Catalog-only consumers remain on their original opener.
- 2026-07-15: implemented the zero-argument Node runtime port bundle with cryptographic IDs, exact SHA-256 fingerprints, and the private default-safe Health transport.
- 2026-07-15: proved certificate-validated HTTPS against a controlled `health.test` fixture through the unchanged production transport; child-only trust did not widen the Node public contract.
- 2026-07-15: promoted the existing queue and one-step worker factories through the exact Jobs public contract without changing service behavior.
- 2026-07-15: composed the public SQLite, Node, Catalog, Jobs, and Health seams into a Local CLI-owned session with one private Health handler and caller-supplied operating configuration.
- 2026-07-15: placed selected-folder durable enqueue in Processing, added target enqueue-only Jobs seams, and fixed caller-authored run identity so Local CLI composition needs no worker policy values; future consumers are `ProcessingStarter` and the `enqueue` command.
- 2026-07-15: implemented the additive enqueue-only Jobs contract through one shared enqueue operation; `ProcessingStarter` is its first planned consumer and existing queue consumers required no migration.
- 2026-07-15: implemented the type-only Processing durable-start contract; the E3 starter factory consumes it next while the current planner runtime requires no migration.
- 2026-07-15: implemented `createProcessingStarter` with shared depth-first traversal, collision-free private identity encodings, and closed Jobs failure mapping; existing preview consumers required no migration.
- 2026-07-15: completed the real SQLite enqueue proof and Local CLI `enqueue` command with exact replay, fixed process output, and no worker or network execution.
- 2026-07-15: placed the one-job Health worker command in the Local CLI, fixed its first operating profile and redacted result contract, and required the existing transport timeout to cover DNS resolution before command implementation.
