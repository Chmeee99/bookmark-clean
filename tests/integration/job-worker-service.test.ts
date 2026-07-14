import type { Outcome } from "../../core/contracts/public.js";
import type {
  JobHandler,
  JobLease,
  JobQueue,
  JobResultReference,
  JobWorker,
  JobWorkerConfigurationFailure,
  WorkerIdentity,
} from "../../modules/jobs/public.js";
import type { FakeJobQueue, FakeQueueOptions } from "../helpers/fake-job-worker.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface HelperApi {
  readonly WORKER_ID: WorkerIdentity["id"];
  readonly RESULT: JobResultReference;
  readonly assert: (condition: unknown, message: string) => asserts condition;
  readonly assertSame: <T>(actual: T, expected: T, message: string) => void;
  readonly assertDeepEqual: (actual: unknown, expected: unknown, message: string) => void;
  readonly invalidRegistry: () => { readonly code: "invalid_handler_registry" };
  readonly makeQueue: (options?: FakeQueueOptions) => FakeJobQueue;
  readonly makeHandler: (outcome: unknown) => {
    readonly handler: JobHandler;
    readonly calls: JobLease[];
  };
  readonly validLease: () => JobLease;
}

declare const require: (specifier: string) => unknown;

const { test } = require("node:test") as NodeTestApi;
const { createJobWorker } = require("../../modules/jobs/job-worker-service.ts") as {
  createJobWorker(
    queue: JobQueue,
    handlers: readonly JobHandler[],
  ): Outcome<JobWorker, JobWorkerConfigurationFailure>;
};
const helper = require("../helpers/fake-job-worker.ts") as HelperApi;
const {
  WORKER_ID, RESULT, assertSame, assertDeepEqual,
  invalidRegistry, makeQueue, makeHandler, validLease,
} = helper;
const assert: HelperApi["assert"] = helper.assert;

test("an empty registry leases once with no capabilities and returns idle", async () => {
  const fake = makeQueue();
  const created = createJobWorker(fake.queue, []);
  assert(created.ok, "Empty handler registry was rejected");
  const worker: WorkerIdentity = { id: WORKER_ID };

  assertDeepEqual(
    await created.value.runOne(worker),
    { ok: true, value: { status: "idle" } },
    "Idle result changed",
  );
  assertDeepEqual(fake.leaseCalls, [{ worker, capabilities: [] }], "Lease changed");
  assertDeepEqual(fake.events, ["lease"], "Idle worker performed another operation");
});

test("one handler receives the exact lease and reports its result once", async () => {
  const lease = validLease();
  const fake = makeQueue({ leaseOutcome: { ok: true, value: lease } });
  const handler = makeHandler({ ok: true, value: RESULT });
  const created = createJobWorker(fake.queue, [handler.handler]);
  assert(created.ok, "Handler registry was rejected");

  const result = await created.value.runOne({ id: WORKER_ID });

  assertDeepEqual(
    result,
    { ok: true, value: { status: "succeeded", lease, result: RESULT } },
    "Success result changed",
  );
  assertSame(handler.calls[0], lease, "Handler received another lease");
  assertDeepEqual(
    fake.succeedCalls,
    [{ lease, result: RESULT }],
    "Success report changed",
  );
  assertDeepEqual(fake.failCalls, [], "Success called fail");
  assertDeepEqual(fake.events, ["lease", "succeed"], "Operation order changed");
});

test("invalid registries fail without touching the queue", () => {
  const valid = makeHandler({ ok: true, value: RESULT }).handler;
  const duplicate = makeHandler({ ok: true, value: RESULT }).handler;
  const cases: readonly unknown[] = [
    valid,
    [{ type: "unknown", handle: valid.handle }],
    [{ type: "health_check", handle: "not a function" }],
    [valid, duplicate],
  ];

  for (const handlers of cases) {
    const fake = makeQueue();
    assertDeepEqual(
      createJobWorker(fake.queue, handlers as readonly JobHandler[]),
      { ok: false, error: invalidRegistry() },
      "Invalid registry result changed",
    );
    assertDeepEqual(fake.events, [], "Invalid registry touched the queue");
  }
});
