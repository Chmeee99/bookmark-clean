import type {
  BookmarkCatalog,
  BookmarkFolderRecord,
  BookmarkLinkRecord,
  BookmarkSnapshot,
  CatalogStorageFailure,
} from "../../modules/catalog/public.js";
import type {
  ProcessingPlanner,
  ProcessingPreview,
  ProcessingPreviewFailure,
  ProcessingPreviewRequest,
  ProcessingRunId,
  ProcessingStarter,
  ProcessingStarterDependencies,
  ProcessingStartRequest,
} from "../../modules/processing/public.js";
import type {
  EnqueueBatchRequest,
  JobBatchSummary,
  JobEnqueuer,
  JobQueueFailure,
} from "../../modules/jobs/public.js";
import type {
  BookmarkId,
  IsoDateTime,
  JobBatchId,
  Outcome,
  SnapshotId,
} from "../../core/contracts/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface ProcessingRuntime {
  createProcessingPlanner(catalog: BookmarkCatalog): ProcessingPlanner;
  createProcessingStarter(dependencies: ProcessingStarterDependencies): ProcessingStarter;
}

declare const require: (specifier: string) => unknown;

const loadModule = require as unknown as (specifier: string) => unknown;
const { test } = loadModule("node:test") as NodeTestApi;
const publicRuntime = loadModule(
  "../../modules/processing/public.ts",
) as ProcessingRuntime;
const { createProcessingPlanner, createProcessingStarter } = publicRuntime;

const SNAPSHOT_ID = "snapshot:processing" as SnapshotId;
const CAPTURED_AT = "2026-07-14T00:00:00.000Z" as IsoDateTime;
const RUN_ID = "run:processing" as ProcessingRunId;
const BATCH_SUMMARY: JobBatchSummary = {
  batchId: "batch:processing" as JobBatchId,
  state: "active",
  totalCount: 3,
  createdAt: CAPTURED_AT,
};

function bookmark(id: string): BookmarkLinkRecord {
  return {
    kind: "bookmark",
    id: id as BookmarkId,
    get sourceId(): string {
      throw new Error("Processing read bookmark sourceId");
    },
    get title(): string {
      throw new Error("Processing read bookmark title");
    },
    get url(): string {
      throw new Error("Processing read bookmark URL");
    },
  };
}

function folder(
  id: string,
  title: string,
  children: readonly (BookmarkFolderRecord | BookmarkLinkRecord)[],
): BookmarkFolderRecord {
  return {
    kind: "folder",
    id: id as BookmarkId,
    sourceId: `source:${id}`,
    title,
    children,
  };
}

function snapshot(): BookmarkSnapshot {
  return {
    id: SNAPSHOT_ID,
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [
      folder("bookmark:root", "Root", [
        bookmark("bookmark:direct"),
        folder("bookmark:nested", "Nested", [
          bookmark("bookmark:nested-one"),
          folder("bookmark:empty", "Empty", []),
          bookmark("bookmark:nested-two"),
        ]),
      ]),
    ],
    rootCount: 1,
    folderCount: 3,
    bookmarkCount: 3,
  };
}

function deepSelectionSnapshot(folderDepth: number): BookmarkSnapshot {
  let node: BookmarkFolderRecord | BookmarkLinkRecord = bookmark("bookmark:deep-link");
  for (let level = folderDepth; level >= 1; level -= 1) {
    node = folder(
      level === 1 ? "bookmark:deep-root" : `bookmark:deep-folder-${level}`,
      `Folder ${level}`,
      [node],
    );
  }
  return {
    id: SNAPSHOT_ID,
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [node],
    rootCount: 1,
    folderCount: folderDepth,
    bookmarkCount: 1,
  };
}

function wideSelectionSnapshot(bookmarkCount: number): BookmarkSnapshot {
  const root = folder(
    "bookmark:wide-root",
    "Wide Root",
    Array.from(
      { length: bookmarkCount },
      (_, index) => bookmark(`bookmark:wide-${index}`),
    ),
  );
  return {
    id: SNAPSHOT_ID,
    source: "chrome_html",
    capturedAt: CAPTURED_AT,
    roots: [root],
    rootCount: 1,
    folderCount: 1,
    bookmarkCount,
  };
}

function request(folderId = "bookmark:root"): ProcessingPreviewRequest {
  return {
    snapshotId: SNAPSHOT_ID,
    folderId: folderId as BookmarkId,
    profileId: "health_check_v1",
  };
}

function startRequest(
  folderId = "bookmark:root",
  runId = RUN_ID,
  snapshotId = SNAPSHOT_ID,
): ProcessingStartRequest {
  return { ...request(folderId), snapshotId, runId };
}

function catalogReturning(
  outcome: Outcome<BookmarkSnapshot | null, CatalogStorageFailure>,
  onRead: () => void = () => undefined,
): BookmarkCatalog {
  return {
    async importSnapshot() {
      throw new Error("Import must not run during preview");
    },
    async getSnapshot() {
      onRead();
      return outcome;
    },
    async getBookmark() {
      throw new Error("Bookmark lookup must not run during preview");
    },
  };
}

function jobsReturning(
  outcome: Outcome<JobBatchSummary, JobQueueFailure>,
  onEnqueue: (request: EnqueueBatchRequest) => void = () => undefined,
): JobEnqueuer {
  return {
    async enqueue(enqueueRequest) {
      onEnqueue(enqueueRequest);
      return outcome;
    },
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message}: ${String(actual)}`);
}

function assertJsonEqual(actual: unknown, expected: unknown, message: string): void {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), message);
}

async function preview(
  planner: ProcessingPlanner,
  input: ProcessingPreviewRequest = request(),
): Promise<Outcome<ProcessingPreview, ProcessingPreviewFailure>> {
  return planner.preview(input);
}

test("public Processing runtime exposes only its approved factories", () => {
  assertJsonEqual(
    Object.keys(publicRuntime).sort(),
    ["createProcessingPlanner", "createProcessingStarter"],
    "Runtime exports changed",
  );
});

test("starter authors one exact depth-first enqueue request", async () => {
  const source = snapshot();
  const roots = source.roots;
  const root = roots[0] as BookmarkFolderRecord;
  const children = root.children;
  let catalogReads = 0;
  const authored: EnqueueBatchRequest[] = [];
  const starter = createProcessingStarter({
    catalog: catalogReturning(
      { ok: true, value: source },
      () => { catalogReads += 1; },
    ),
    jobs: jobsReturning(
      { ok: true, value: BATCH_SUMMARY },
      (enqueueRequest) => authored.push(enqueueRequest),
    ),
  });
  const input = Object.freeze(startRequest());
  const before = JSON.stringify(input);

  const result = await starter.start(input);

  assert(result.ok, "Processing start failed");
  assertEqual(catalogReads, 1, "Start did not read Catalog once");
  assertEqual(authored.length, 1, "Start did not enqueue once");
  assert(result.value.batch === BATCH_SUMMARY, "Start replaced the Jobs batch summary");
  assertEqual(JSON.stringify(input), before, "Start mutated its request");
  assert(source.roots === roots, "Start replaced snapshot roots");
  assert(root.children === children, "Start replaced folder children");
  assertJsonEqual(result.value.preview, {
    snapshotId: SNAPSHOT_ID,
    folderId: "bookmark:root",
    folderTitle: "Root",
    profile: {
      id: "health_check_v1",
      jobType: "health_check",
      maximumJobAttempts: 1,
      maximumNetworkRequestsPerJob: 6,
      maximumModelCallsPerJob: 0,
    },
    bookmarkCount: 3,
    jobCount: 3,
    maximumNetworkRequests: 18,
    maximumModelCalls: 0,
  }, "Start preview changed");
  const enqueueRequest = authored[0];
  assert(enqueueRequest.idempotencyKey.length > 0, "Batch key was empty");
  const inputVersion = enqueueRequest.jobs[0].target.inputVersion;
  assert(inputVersion.length > 0, "Input version was empty");
  assertJsonEqual(enqueueRequest.jobs, [
    {
      type: "health_check",
      target: {
        kind: "bookmark",
        bookmarkId: "bookmark:direct",
        inputVersion,
      },
      priority: 0,
      sequence: 0,
      maxAttempts: 1,
    },
    {
      type: "health_check",
      target: {
        kind: "bookmark",
        bookmarkId: "bookmark:nested-one",
        inputVersion,
      },
      priority: 0,
      sequence: 1,
      maxAttempts: 1,
    },
    {
      type: "health_check",
      target: {
        kind: "bookmark",
        bookmarkId: "bookmark:nested-two",
        inputVersion,
      },
      priority: 0,
      sequence: 2,
      maxAttempts: 1,
    },
  ], "Authored jobs changed");
});

test("starter identity encodings are deterministic and collision-free", async () => {
  const authored: EnqueueBatchRequest[] = [];
  const starter = createProcessingStarter({
    catalog: catalogReturning({ ok: true, value: snapshot() }),
    jobs: jobsReturning(
      { ok: true, value: BATCH_SUMMARY },
      (enqueueRequest) => authored.push(enqueueRequest),
    ),
  });
  const inputs = [
    startRequest(),
    startRequest(),
    startRequest("bookmark:root", "run:other" as ProcessingRunId),
    startRequest("bookmark:root", "bc" as ProcessingRunId, "a" as SnapshotId),
    startRequest("bookmark:root", "c" as ProcessingRunId, "ab" as SnapshotId),
  ];

  for (const input of inputs) {
    const result = await starter.start(input);
    assert(result.ok, "Determinism start failed");
  }

  assertEqual(JSON.stringify(authored[0]), JSON.stringify(authored[1]), "Same run drifted");
  assert(
    authored[0].idempotencyKey !== authored[2].idempotencyKey,
    "Changed run reused the batch key",
  );
  assert(
    authored[0].jobs[0].target.inputVersion !== authored[2].jobs[0].target.inputVersion,
    "Changed run reused the input version",
  );
  assert(
    authored[3].idempotencyKey !== authored[4].idempotencyKey,
    "Ambiguous tuples collided in the batch key",
  );
  assert(
    authored[3].jobs[0].target.inputVersion !== authored[4].jobs[0].target.inputVersion,
    "Ambiguous tuples collided in the input version",
  );
});

test("starter rejects invalid and empty selections before enqueue", async () => {
  let catalogReads = 0;
  let enqueues = 0;
  const starter = createProcessingStarter({
    catalog: catalogReturning(
      { ok: true, value: snapshot() },
      () => { catalogReads += 1; },
    ),
    jobs: jobsReturning(
      { ok: true, value: BATCH_SUMMARY },
      () => { enqueues += 1; },
    ),
  });

  const invalid = await starter.start(startRequest(
    "bookmark:root",
    "" as ProcessingRunId,
  ));
  assert(!invalid.ok, "Empty run ID passed");
  assertJsonEqual(invalid.error, { code: "invalid_request" }, "Invalid run failure changed");
  assertEqual(catalogReads, 0, "Invalid run reached Catalog");

  const empty = await starter.start(startRequest("bookmark:empty"));
  assert(!empty.ok, "Empty selection passed");
  assertJsonEqual(empty.error, { code: "empty_selection" }, "Empty selection failure changed");
  assertEqual(catalogReads, 1, "Empty selection Catalog reads changed");
  assertEqual(enqueues, 0, "Empty selection reached Jobs");
});

test("starter maps every Jobs failure without diagnostics", async () => {
  const cases = [
    ["empty_batch", { code: "empty_selection" }],
    ["idempotency_conflict", { code: "run_conflict" }],
    ["storage_unavailable", { code: "queue_unavailable" }],
    ["invalid_request", { code: "enqueue_rejected", queueCode: "invalid_request" }],
    ["batch_not_found", { code: "enqueue_rejected", queueCode: "batch_not_found" }],
    ["stale_lease", { code: "enqueue_rejected", queueCode: "stale_lease" }],
    ["invalid_transition", { code: "enqueue_rejected", queueCode: "invalid_transition" }],
  ] as const;

  for (const [code, expected] of cases) {
    const starter = createProcessingStarter({
      catalog: catalogReturning({ ok: true, value: snapshot() }),
      jobs: jobsReturning({
        ok: false,
        error: { code, diagnostic: "private" },
      }),
    });
    const result = await starter.start(startRequest());
    assert(!result.ok, `${code} passed`);
    assertJsonEqual(result.error, expected, `${code} mapping changed`);
  }
});

test("starter preserves preview read failures", async () => {
  const cases = [
    [{ ok: true, value: null }, { code: "snapshot_not_found" }],
    [
      { ok: false, error: { code: "storage_unavailable", diagnostic: "private" } },
      { code: "catalog_unavailable" },
    ],
    [
      { ok: false, error: { code: "stored_snapshot_invalid", diagnostic: "private" } },
      { code: "snapshot_invalid" },
    ],
  ] as const;
  for (const [catalogOutcome, expected] of cases) {
    const starter = createProcessingStarter({
      catalog: catalogReturning(catalogOutcome),
      jobs: jobsReturning({ ok: true, value: BATCH_SUMMARY }),
    });
    const result = await starter.start(startRequest());
    assert(!result.ok, "Preview failure passed");
    assertJsonEqual(result.error, expected, "Preview failure mapping changed");
  }
});

test("root and nested previews return exact bounded health work", async () => {
  const source = snapshot();
  const roots = source.roots;
  const rootFolder = roots[0] as BookmarkFolderRecord;
  const rootChildren = rootFolder.children;
  const planner = createProcessingPlanner(
    catalogReturning({ ok: true, value: source }),
  );

  const root = await preview(planner);
  assert(root.ok, "Root preview failed");
  assertJsonEqual(root.value, {
    snapshotId: SNAPSHOT_ID,
    folderId: "bookmark:root",
    folderTitle: "Root",
    profile: {
      id: "health_check_v1",
      jobType: "health_check",
      maximumJobAttempts: 1,
      maximumNetworkRequestsPerJob: 6,
      maximumModelCallsPerJob: 0,
    },
    bookmarkCount: 3,
    jobCount: 3,
    maximumNetworkRequests: 18,
    maximumModelCalls: 0,
  }, "Root preview changed");

  const nested = await preview(planner, request("bookmark:nested"));
  assert(nested.ok, "Nested preview failed");
  assertEqual(nested.value.bookmarkCount, 2, "Nested count changed");
  assertEqual(nested.value.maximumNetworkRequests, 12, "Nested budget changed");

  const empty = await preview(planner, request("bookmark:empty"));
  assert(empty.ok, "Empty preview failed");
  assertEqual(empty.value.jobCount, 0, "Empty folder created work");
  assertEqual(empty.value.maximumNetworkRequests, 0, "Empty budget changed");
  assert(source.roots === roots, "Preview replaced snapshot roots");
  assert(rootFolder.children === rootChildren, "Preview replaced folder children");
  assertEqual(rootFolder.title, "Root", "Preview changed the folder title");
});

test("invalid requests stop before Catalog", async () => {
  let reads = 0;
  const planner = createProcessingPlanner(
    catalogReturning({ ok: true, value: snapshot() }, () => { reads += 1; }),
  );
  for (const input of [
    { ...request(), snapshotId: "" as SnapshotId },
    { ...request(), folderId: "" as BookmarkId },
    { ...request(), profileId: "unknown" as never },
  ]) {
    const result = await preview(planner, input);
    assert(!result.ok, "Invalid request passed");
    assertEqual(result.error.code, "invalid_request", "Wrong invalid failure");
  }
  assertEqual(reads, 0, "Invalid request reached Catalog");
});

test("missing snapshots folders and bookmark IDs stay distinct", async () => {
  const missingSnapshot = await preview(
    createProcessingPlanner(catalogReturning({ ok: true, value: null })),
  );
  assert(!missingSnapshot.ok, "Missing snapshot passed");
  assertEqual(missingSnapshot.error.code, "snapshot_not_found", "Wrong snapshot failure");

  const planner = createProcessingPlanner(
    catalogReturning({ ok: true, value: snapshot() }),
  );
  for (const id of ["bookmark:missing", "bookmark:direct"]) {
    const result = await preview(planner, request(id));
    assert(!result.ok, `${id} selected a folder`);
    assertEqual(result.error.code, "folder_not_found", "Wrong folder failure");
  }
});

test("typed Catalog read failures map without diagnostics", async () => {
  for (const [failure, expected] of [
    [{ code: "storage_unavailable", diagnostic: "private" }, "catalog_unavailable"],
    [{ code: "stored_snapshot_invalid", diagnostic: "private" }, "snapshot_invalid"],
  ] as const) {
    const result = await preview(
      createProcessingPlanner(catalogReturning({ ok: false, error: failure })),
    );
    assert(!result.ok, "Catalog failure passed");
    assertJsonEqual(result.error, { code: expected }, "Catalog failure leaked fields");
  }
});

test("Processing accepts the inclusive depth and node boundaries", async () => {
  const deep = deepSelectionSnapshot(255);
  let enqueues = 0;
  const starter = createProcessingStarter({
    catalog: catalogReturning({ ok: true, value: deep }),
    jobs: jobsReturning(
      { ok: true, value: { ...BATCH_SUMMARY, totalCount: 1 } },
      () => { enqueues += 1; },
    ),
  });
  const started = await starter.start(startRequest("bookmark:deep-root"));
  assert(started.ok, "Depth 256 selection should start");
  assertEqual(started.value.preview.bookmarkCount, 1, "Deep selection count changed");
  assertEqual(enqueues, 1, "Deep selection did not enqueue once");

  const wide = await preview(
    createProcessingPlanner(
      catalogReturning({ ok: true, value: wideSelectionSnapshot(19_999) }),
    ),
    request("bookmark:wide-root"),
  );
  assert(wide.ok, "20,000-node snapshot should preview");
  assertEqual(wide.value.bookmarkCount, 19_999, "Wide selection count changed");
});

test("Processing rejects over-budget Catalog results before Jobs", async () => {
  for (const source of [
    deepSelectionSnapshot(256),
    wideSelectionSnapshot(20_000),
  ]) {
    let enqueues = 0;
    const starter = createProcessingStarter({
      catalog: catalogReturning({ ok: true, value: source }),
      jobs: jobsReturning(
        { ok: true, value: BATCH_SUMMARY },
        () => { enqueues += 1; },
      ),
    });
    const folderId = source.roots[0]?.id as BookmarkId;
    const result = await starter.start(startRequest(folderId));
    assert(!result.ok, "Over-budget selection started");
    assertJsonEqual(result.error, { code: "snapshot_invalid" }, "Bound failure changed");
    assertEqual(enqueues, 0, "Over-budget selection reached Jobs");
  }
});

void (null as unknown as ProcessingPreviewRequest);
