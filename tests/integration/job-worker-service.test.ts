import type {
  JobHandler,
  JobLease,
  JobQueue,
  JobQueueFailure,
  JobResultReference,
  JobType,
  JobWorker,
  JobWorkerConfigurationFailure,
  TypedJobFailure,
  WorkerIdentity,
} from "../../modules/jobs/public.js";
import type { Outcome } from "../../core/contracts/public.js";
import type {
  FakeJobQueue,
  FakeHandler,
  FakeQueueOptions,
} from "../helpers/fake-job-worker.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface ServiceApi {
  createJobWorker(
    queue: JobQueue,
    handlers: readonly JobHandler[],
  ): Outcome<JobWorker, JobWorkerConfigurationFailure>;
}

interface HelperApi {
  readonly WORKER_ID: WorkerIdentity["id"];
  readonly RESULT: JobResultReference;
  readonly FAILURE: TypedJobFailure;
  readonly assert: (condition: unknown, message: string) => asserts condition;
  readonly assertSame: <T>(actual: T, expected: T, message: string) => void;
  readonly assertDeepEqual: (
    actual: unknown,
    expected: unknown,
    message: string,
  ) => void;
  readonly invalidRegistry: () => { readonly code: "invalid_handler_registry" };
  readonly makeQueue: (options?: FakeQueueOptions) => FakeJobQueue;
  readonly makeHandler: (outcome: unknown, type?: JobType) => FakeHandler;
  readonly validLease: (overrides?: Partial<JobLease>) => JobLease;
}

declare const require: (specifier: string) => unknown;

const { test } = require("node:test") as NodeTestApi;
const { createJobWorker } = require(
  "../../modules/jobs/job-worker-service.ts",
) as ServiceApi;
const {
  WORKER_ID,
  RESULT,
  FAILURE,
  assert: assertHelper,
  assertSame,
  assertDeepEqual,
  invalidRegistry,
  makeQueue,
  makeHandler,
  validLease,
} = require("../helpers/fake-job-worker.ts") as HelperApi;

const assert: HelperApi["assert"] = assertHelper;

test("an empty registry leases once with no capabilities and can be idle", async () => {
  const fake = makeQueue();
  const created = createJobWorker(fake.queue, []);
  assert(created.ok, "Empty handler registry was rejected");

  const worker: WorkerIdentity = { id: WORKER_ID };
  const result = await created.value.runOne(worker);

  assertDeepEqual(result, { ok: true, value: { status: "idle" } }, "Idle step changed");
  assertSame(fake.leaseCalls.length, 1, "Idle worker did not lease once");
  assertSame(fake.leaseCalls[0].worker, worker, "Worker reference changed");
  assertDeepEqual(fake.leaseCalls[0].capabilities, [], "Empty capabilities changed");
  assertDeepEqual(fake.events, ["lease"], "Idle worker performed another operation");
});

test("an object-literal handler receives the exact lease and reports success once", async () => {
  const lease = validLease();
  const fake = makeQueue({ leaseOutcome: { ok: true, value: lease } });
  const handler = makeHandler({ ok: true, value: RESULT });
  const created = createJobWorker(fake.queue, [handler.handler]);
  assert(created.ok, "Object-literal handler registry was rejected");

  const result = await created.value.runOne({ id: WORKER_ID });

  assert(result.ok, "Successful worker step failed");
  assertSame(result.value.status, "succeeded", "Success status changed");
  if (result.value.status !== "succeeded") {
    return;
  }
  assertSame(result.value.lease, lease, "Success step lease reference changed");
  assertSame(result.value.result, RESULT, "Success step result reference changed");
  assertSame(handler.calls.length, 1, "Handler was not called once");
  assertSame(handler.calls[0], lease, "Handler lease reference changed");
  assertSame(fake.succeedCalls.length, 1, "Succeed was not called once");
  assertSame(fake.succeedCalls[0].lease, lease, "Succeed lease reference changed");
  assertSame(fake.succeedCalls[0].result, RESULT, "Succeed result reference changed");
  assertSame(fake.failCalls.length, 0, "Opposite report was called");
  assertDeepEqual(fake.leaseCalls[0].capabilities, ["health_check"], "Capabilities changed");
  assertDeepEqual(fake.events, ["lease", "succeed"], "Success operation order changed");
});

test("a class handler with a private field and prototype method is supported", async () => {
  class PrototypeHandler implements JobHandler {
    readonly type = "health_check" as const;
    readonly extraState = "allowed";
    #calls: JobLease[] = [];

    get calls(): readonly JobLease[] {
      return this.#calls;
    }

    async handle(
      lease: JobLease,
    ): Promise<Outcome<JobResultReference, TypedJobFailure>> {
      this.#calls.push(lease);
      return { ok: true, value: RESULT };
    }
  }

  const lease = validLease();
  const fake = makeQueue({ leaseOutcome: { ok: true, value: lease } });
  const handler = new PrototypeHandler();
  const created = createJobWorker(fake.queue, [handler]);
  assert(created.ok, "Prototype handler registry was rejected");

  const result = await created.value.runOne({ id: WORKER_ID });

  assert(result.ok, "Prototype handler worker step failed");
  assert(result.value.status === "succeeded", "Prototype handler did not succeed");
  assertSame(handler.calls.length, 1, "Prototype handler did not keep its receiver");
  assertSame(handler.calls[0], lease, "Prototype handler lease reference changed");
  assertSame(fake.succeedCalls[0].result, RESULT, "Prototype result reference changed");
});

test("routing snapshots handler type and a bound callable", async () => {
  const lease = validLease();
  const fake = makeQueue({ leaseOutcome: { ok: true, value: lease } });
  const originalCalls: JobLease[] = [];
  const original = {
    type: "health_check" as const,
    privateState: "allowed",
    calls: originalCalls,
    handle(this: { calls: JobLease[] }, receivedLease: JobLease) {
      this.calls.push(receivedLease);
      return Promise.resolve({ ok: true as const, value: RESULT });
    },
  };
  const replacement = makeHandler({ ok: true, value: RESULT });
  const handlers = [original as unknown as JobHandler];
  const created = createJobWorker(fake.queue, handlers);
  assert(created.ok, "Mutable handler registry was rejected");

  handlers[0] = replacement.handler;
  (original as unknown as { type: string }).type = "unsupported";
  (original as unknown as { handle: unknown }).handle = () =>
    Promise.reject(new Error("replacement must not run"));

  const result = await created.value.runOne({ id: WORKER_ID });

  assert(result.ok, "Snapshotted handler failed");
  assert(result.value.status === "succeeded", "Snapshotted handler did not succeed");
  assertDeepEqual(fake.leaseCalls[0].capabilities, ["health_check"], "Capabilities changed");
  assertSame(originalCalls.length, 1, "Original callable was not retained");
  assertSame(originalCalls[0], lease, "Original callable received a different lease");
  assertSame(replacement.calls.length, 0, "Replacement handler was called");
});

test("invalid registries return one exact configuration failure without dependencies", () => {
  const valid = makeHandler({ ok: true, value: RESULT }).handler;
  const duplicate = makeHandler({ ok: true, value: RESULT }).handler;
  const sparse = new Array(1) as unknown[];
  const extraKey = [valid] as unknown[];
  (extraKey as unknown as { extra: boolean }).extra = true;
  const extraSymbol = [valid] as unknown[];
  Object.defineProperty(extraSymbol, Symbol("extra"), { value: true });
  const functionEntry = Object.assign(() => undefined, {
    type: "health_check",
    handle: () => Promise.resolve({ ok: true, value: RESULT }),
  });
  const cases: readonly { readonly name: string; readonly handlers: unknown }[] = [
    { name: "non-array", handlers: valid },
    { name: "null", handlers: null },
    { name: "sparse array", handlers: sparse },
    { name: "array extra key", handlers: extraKey },
    { name: "array symbol key", handlers: extraSymbol },
    {
      name: "unknown handler type",
      handlers: [{ type: "unknown", handle: async () => ({ ok: true, value: RESULT }) }],
    },
    { name: "non-function handle", handlers: [{ type: "health_check", handle: "nope" }] },
    { name: "null entry", handlers: [null] },
    { name: "function entry", handlers: [functionEntry] },
    { name: "duplicate handler type", handlers: [valid, duplicate] },
  ];

  for (const item of cases) {
    const fake = makeQueue();
    const result = createJobWorker(
      fake.queue,
      item.handlers as readonly JobHandler[],
    );
    assertDeepEqual(
      result,
      { ok: false, error: invalidRegistry() },
      `${item.name} did not return the exact configuration failure`,
    );
    assertDeepEqual(fake.events, [], `${item.name} touched the queue`);
  }
});
