import type { BookmarkId, JobResultId, Outcome } from "../../core/contracts/public.js";
import type { BookmarkLinkRecord, CatalogStorageFailure } from "../../modules/catalog/public.js";
import type { HealthCheckFailure, HealthCheckRequest, HealthChecker } from "../../modules/health/public.js";
import type { JobHandler, JobLease, JobQueue, JobWorker, JobWorkerConfigurationFailure } from "../../modules/jobs/public.js";
import type { FakeJobQueue, FakeQueueOptions } from "../helpers/fake-job-worker.js";

interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }
interface HelperApi {
  readonly WORKER_ID: Parameters<JobWorker["runOne"]>[0]["id"];
  readonly assert: (condition: unknown, message: string) => asserts condition;
  readonly assertSame: <T>(actual: T, expected: T, message: string) => void;
  readonly assertDeepEqual: (actual: unknown, expected: unknown, message: string) => void;
  readonly makeQueue: (options?: FakeQueueOptions) => FakeJobQueue;
  readonly validLease: () => JobLease;
}
type CatalogReader = {
  getBookmark(id: BookmarkId): Promise<Outcome<BookmarkLinkRecord | null, CatalogStorageFailure>>;
};

declare const require: (specifier: string) => unknown;
const { test } = require("node:test") as NodeTestApi;
const { createHealthCheckJobHandler } = require("../../modules/health/public.ts") as {
  createHealthCheckJobHandler(dependencies: {
    readonly catalog: CatalogReader;
    readonly checker: HealthChecker;
  }): JobHandler;
};
const { createJobWorker } = require("../../modules/jobs/job-worker-service.ts") as {
  createJobWorker(
    queue: JobQueue,
    handlers: readonly JobHandler[],
  ): Outcome<JobWorker, JobWorkerConfigurationFailure>;
};
const helper = require("../helpers/fake-job-worker.ts") as HelperApi;
const { assertSame, assertDeepEqual, makeQueue, validLease, WORKER_ID } = helper;
const assert: HelperApi["assert"] = helper.assert;

function storedBookmark(): BookmarkLinkRecord {
  return {
    id: "bookmark:leased" as BookmarkId,
    sourceId: "source:leased",
    kind: "bookmark",
    title: "Leased",
    url: "https://example.com/leased",
  };
}

function makeDependencies(
  catalogOutcome: Outcome<BookmarkLinkRecord | null, CatalogStorageFailure>,
  checkerOutcome: Outcome<{ readonly id: JobResultId }, HealthCheckFailure> = {
    ok: true,
    value: { id: "observation:one" as JobResultId },
  },
) {
  const bookmarkCalls: BookmarkId[] = [];
  const checkCalls: HealthCheckRequest[] = [];
  return {
    catalog: {
      async getBookmark(id: BookmarkId) {
        bookmarkCalls.push(id);
        return catalogOutcome;
      },
    },
    checker: {
      async check(request: HealthCheckRequest) {
        checkCalls.push(request);
        return checkerOutcome;
      },
    },
    bookmarkCalls,
    checkCalls,
  };
}

test("handler forwards the stored URL and exact lease identity once", async () => {
  const bookmark = storedBookmark();
  const dependencies = makeDependencies({ ok: true, value: bookmark });
  const lease = validLease();
  const result = await createHealthCheckJobHandler(dependencies).handle(lease);

  assertDeepEqual(result, {
    ok: true,
    value: { kind: "health_observation", id: "observation:one" },
  }, "Handler result changed");
  assertDeepEqual(dependencies.bookmarkCalls, [lease.target.bookmarkId], "Catalog lookup changed");
  assertDeepEqual(dependencies.checkCalls, [{
    bookmarkId: lease.target.bookmarkId,
    inputVersion: lease.target.inputVersion,
    url: bookmark.url,
  }], "Checker request changed");
});

test("Catalog outcomes map without invoking the checker or copying diagnostics", async () => {
  const cases = [
    {
      outcome: { ok: true, value: null },
      expected: { code: "bookmark_not_found", disposition: "terminal" },
    },
    {
      outcome: { ok: false, error: { code: "stored_snapshot_invalid", diagnostic: "private row detail" } },
      expected: { code: "bookmark_invalid", disposition: "terminal" },
    },
    {
      outcome: { ok: false, error: { code: "storage_unavailable", diagnostic: "private engine detail" } },
      expected: { code: "catalog_unavailable", disposition: "retry" },
    },
  ] as const;

  for (const fixture of cases) {
    const dependencies = makeDependencies(fixture.outcome);
    const result = await createHealthCheckJobHandler(dependencies).handle(validLease());
    assertDeepEqual(result, { ok: false, error: fixture.expected }, "Catalog mapping changed");
    assertDeepEqual(dependencies.checkCalls, [], "Catalog failure called the checker");
    assert(dependencies.bookmarkCalls.length === 1, "Catalog lookup count changed");
  }
});

test("checker failures pass through by reference", async () => {
  const failures: HealthCheckFailure[] = [
    { code: "input_conflict", disposition: "terminal", diagnostic: "opaque conflict" },
    { code: "transport_unavailable", disposition: "retry", diagnostic: "opaque transport" },
  ];
  for (const failure of failures) {
    const outcome = { ok: false, error: failure } as const;
    const dependencies = makeDependencies({ ok: true, value: storedBookmark() }, outcome);
    const result = await createHealthCheckJobHandler(dependencies).handle(validLease());
    assertSame(result, outcome, "Checker failure outcome reference changed");
    assert(dependencies.checkCalls.length === 1, "Checker call count changed");
  }
});

test("dependency interruptions propagate to the Jobs worker", async () => {
  const cases = [
    {
      catalog: {
        async getBookmark(): Promise<never> {
          throw new Error("fixed Catalog interruption");
        },
      },
      checker: {
        async check(): Promise<never> {
          throw new Error("Checker must not run");
        },
      },
    },
    {
      catalog: {
        async getBookmark() {
          return { ok: true, value: storedBookmark() } as const;
        },
      },
      checker: {
        async check(): Promise<never> {
          throw new Error("fixed checker interruption");
        },
      },
    },
    {
      catalog: {
        async getBookmark() {
          return { ok: false, error: { code: "snapshot_exists" } } as const;
        },
      },
      checker: {
        async check(): Promise<never> {
          throw new Error("Checker must not run");
        },
      },
    },
  ];

  for (const dependencies of cases) {
    const lease = validLease();
    const fake = makeQueue({ leaseOutcome: { ok: true, value: lease } });
    const created = createJobWorker(fake.queue, [createHealthCheckJobHandler(dependencies)]);
    assert(created.ok, "Production handler registry was rejected");
    assertDeepEqual(
      await created.value.runOne({ id: WORKER_ID }),
      { ok: false, error: { code: "handler_interrupted" } },
      "Worker interruption mapping changed",
    );
    assertDeepEqual(fake.events, ["lease"], "Interrupted handler reported a result");
  }
});

test("the production Jobs worker routes and commits the handler result", async () => {
  const lease = validLease();
  const dependencies = makeDependencies({ ok: true, value: storedBookmark() });
  const fake = makeQueue({ leaseOutcome: { ok: true, value: lease } });
  const created = createJobWorker(fake.queue, [createHealthCheckJobHandler(dependencies)]);
  assert(created.ok, "Production handler registry was rejected");

  const result = await created.value.runOne({ id: WORKER_ID });
  assert(result.ok && result.value.status === "succeeded", "Worker should succeed");
  assertDeepEqual(result.value.result, {
    kind: "health_observation",
    id: "observation:one",
  }, "Worker result changed");
  assertDeepEqual(fake.events, ["lease", "succeed"], "Worker operation order changed");
  assert(fake.succeedCalls.length === 1, "Worker success report count changed");
});
