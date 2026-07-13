import type {
  JobHandler,
  JobLease,
  JobQueue,
  JobQueueFailure,
  JobResultReference,
  JobWorker,
  JobWorkerConfigurationFailure,
  TypedJobFailure,
  WorkerIdentity,
} from "../../modules/jobs/public.js";
import type { Outcome } from "../../core/contracts/public.js";
import type {
  FakeJobQueue,
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
  readonly makeQueue: (options?: FakeQueueOptions) => FakeJobQueue;
  readonly makeHandler: (outcome: unknown) => {
    readonly handler: JobHandler;
    readonly calls: JobLease[];
  };
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
  makeQueue,
  makeHandler,
  validLease,
} = require("../helpers/fake-job-worker.ts") as HelperApi;

const assert: HelperApi["assert"] = assertHelper;

function makeWorker(
  fake: FakeJobQueue,
  outcome: unknown = { ok: true, value: RESULT },
): { readonly worker: JobWorker; readonly handlerCalls: JobLease[] } {
  const handler = makeHandler(outcome);
  const created = createJobWorker(fake.queue, [handler.handler]);
  assert(created.ok, "Test handler registry was rejected");
  return { worker: created.value, handlerCalls: handler.calls };
}

function makeThrowingHandler(
  mode: "throw" | "reject",
  calls: JobLease[],
  error: unknown,
): JobHandler {
  return {
    type: "health_check",
    handle(lease: JobLease): Promise<Outcome<JobResultReference, TypedJobFailure>> {
      calls.push(lease);
      if (mode === "throw") {
        throw error;
      }
      return Promise.reject(error);
    },
  };
}

test("a typed lease failure is wrapped with the lease operation and no report", async () => {
  const failure: JobQueueFailure = {
    code: "storage_unavailable",
    diagnostic: "opaque queue evidence",
  };
  const fake = makeQueue({ leaseOutcome: { ok: false, error: failure } });
  const handler = makeHandler({ ok: true, value: RESULT });
  const created = createJobWorker(fake.queue, [handler.handler]);
  assert(created.ok, "Handler registry was rejected");

  const result = await created.value.runOne({ id: WORKER_ID });

  assert(!result.ok, "Typed lease failure became success");
  assertDeepEqual(
    result,
    {
      ok: false,
      error: { code: "queue_failure", operation: "lease", failure },
    },
    "Lease failure shape changed",
  );
  if (result.ok || result.error.code !== "queue_failure") {
    return;
  }
  assertSame(result.error.failure, failure, "Queue failure reference changed");
  assertSame(handler.calls.length, 0, "Lease failure called the handler");
  assertSame(fake.succeedCalls.length, 0, "Lease failure called succeed");
  assertSame(fake.failCalls.length, 0, "Lease failure called fail");
});

test("a thrown or rejected lease is an operation-specific interruption", async () => {
  for (const mode of ["throw", "reject"] as const) {
    const fake = makeQueue({ leaseException: new Error(`${mode} details`) });
    const handler = makeHandler({ ok: true, value: RESULT });
    const created = createJobWorker(fake.queue, [handler.handler]);
    assert(created.ok, `${mode} handler registry was rejected`);

    const result = await created.value.runOne({ id: WORKER_ID });

    assertDeepEqual(
      result,
      { ok: false, error: { code: "queue_interrupted", operation: "lease" } },
      `${mode} lease interruption shape changed`,
    );
    assertSame(handler.calls.length, 0, `${mode} lease interruption called the handler`);
    assertDeepEqual(fake.events, ["lease"], `${mode} lease interruption mutated twice`);
  }
});

test("handler throws and rejects leave the lease unreported", async () => {
  for (const mode of ["throw", "reject"] as const) {
    const lease = validLease();
    const fake = makeQueue({ leaseOutcome: { ok: true, value: lease } });
    const calls: JobLease[] = [];
    const created = createJobWorker(
      fake.queue,
      [makeThrowingHandler(mode, calls, new Error(`${mode} handler details`))],
    );
    assert(created.ok, `${mode} handler registry was rejected`);

    const result = await created.value.runOne({ id: WORKER_ID });

    assertDeepEqual(
      result,
      { ok: false, error: { code: "handler_interrupted" } },
      `${mode} handler interruption shape changed`,
    );
    assertSame(calls.length, 1, `${mode} handler was not called once`);
    assertSame(calls[0], lease, `${mode} handler lease reference changed`);
    assertSame(fake.succeedCalls.length, 0, `${mode} handler called succeed`);
    assertSame(fake.failCalls.length, 0, `${mode} handler called fail`);
    assertDeepEqual(fake.events, ["lease"], `${mode} handler interruption reported the lease`);
  }
});

test("malformed handler outcomes are rejected without a queue report", async () => {
  const malformed: readonly { readonly name: string; readonly output: unknown }[] = [
    { name: "null top-level", output: null },
    { name: "missing top-level keys", output: { ok: true } },
    {
      name: "extra top-level key",
      output: { ok: true, value: RESULT, extra: true },
    },
    {
      name: "malformed result reference",
      output: { ok: true, value: { kind: "health_observation", id: "" } },
    },
    {
      name: "malformed failure reference",
      output: { ok: false, error: { code: "", disposition: "retry" } },
    },
    {
      name: "malformed failure diagnostic",
      output: { ok: false, error: { code: "failure", disposition: "retry", diagnostic: 3 } },
    },
  ];

  for (const item of malformed) {
    const lease = validLease();
    const fake = makeQueue({ leaseOutcome: { ok: true, value: lease } });
    const handler = makeHandler(item.output);
    const created = createJobWorker(fake.queue, [handler.handler]);
    assert(created.ok, `${item.name} handler registry was rejected`);

    const result = await created.value.runOne({ id: WORKER_ID });

    assertDeepEqual(
      result,
      { ok: false, error: { code: "invalid_handler_output" } },
      `${item.name} was repaired or accepted`,
    );
    assertSame(handler.calls.length, 1, `${item.name} did not call the handler`);
    assertSame(fake.succeedCalls.length, 0, `${item.name} called succeed`);
    assertSame(fake.failCalls.length, 0, `${item.name} called fail`);
    assertDeepEqual(fake.events, ["lease"], `${item.name} reported malformed output`);
  }
});

test("a typed succeed failure is returned with the succeed operation and no second mutation", async () => {
  const failure: JobQueueFailure = {
    code: "stale_lease",
    diagnostic: "opaque report evidence",
  };
  const lease = validLease();
  const fake = makeQueue({
    leaseOutcome: { ok: true, value: lease },
    succeedOutcome: { ok: false, error: failure },
  });
  const { worker } = makeWorker(fake);

  const result = await worker.runOne({ id: WORKER_ID });

  assertDeepEqual(
    result,
    { ok: false, error: { code: "queue_failure", operation: "succeed", failure } },
    "Succeed failure shape changed",
  );
  if (result.ok || result.error.code !== "queue_failure") {
    return;
  }
  assertSame(result.error.failure, failure, "Succeed failure reference changed");
  assertSame(fake.succeedCalls.length, 1, "Succeed was not called once");
  assertSame(fake.failCalls.length, 0, "Succeed failure triggered fail");
  assertDeepEqual(fake.events, ["lease", "succeed"], "Succeed failure mutated twice");
});

test("a thrown or rejected succeed is interrupted without a compensating fail", async () => {
  for (const mode of ["throw", "reject"] as const) {
    const lease = validLease();
    const fake = makeQueue({
      leaseOutcome: { ok: true, value: lease },
      succeedException: new Error(`${mode} succeed details`),
    });
    const { worker } = makeWorker(fake);

    const result = await worker.runOne({ id: WORKER_ID });

    assertDeepEqual(
      result,
      { ok: false, error: { code: "queue_interrupted", operation: "succeed" } },
      `${mode} succeed interruption shape changed`,
    );
    assertSame(fake.succeedCalls.length, 1, `${mode} succeed was not called once`);
    assertSame(fake.failCalls.length, 0, `${mode} succeed triggered fail`);
    assertDeepEqual(fake.events, ["lease", "succeed"], `${mode} succeed mutated twice`);
  }
});

test("a typed fail failure is returned with the fail operation and no second mutation", async () => {
  const failure: JobQueueFailure = {
    code: "storage_unavailable",
    diagnostic: "opaque fail evidence",
  };
  const lease = validLease();
  const fake = makeQueue({
    leaseOutcome: { ok: true, value: lease },
    failOutcome: { ok: false, error: failure },
  });
  const handler = makeHandler({ ok: false, error: FAILURE });
  const created = createJobWorker(fake.queue, [handler.handler]);
  assert(created.ok, "Failure handler registry was rejected");

  const result = await created.value.runOne({ id: WORKER_ID });

  assertDeepEqual(
    result,
    { ok: false, error: { code: "queue_failure", operation: "fail", failure } },
    "Fail failure shape changed",
  );
  if (result.ok || result.error.code !== "queue_failure") {
    return;
  }
  assertSame(result.error.failure, failure, "Fail failure reference changed");
  assertSame(fake.failCalls.length, 1, "Fail was not called once");
  assertSame(fake.succeedCalls.length, 0, "Fail failure triggered succeed");
  assertSame(fake.failCalls[0].failure, FAILURE, "Handler failure reference changed");
  assertDeepEqual(fake.events, ["lease", "fail"], "Fail failure mutated twice");
});

test("a thrown or rejected fail is interrupted without a compensating succeed", async () => {
  for (const mode of ["throw", "reject"] as const) {
    const lease = validLease();
    const fake = makeQueue({
      leaseOutcome: { ok: true, value: lease },
      failException: new Error(`${mode} fail details`),
    });
    const handler = makeHandler({ ok: false, error: FAILURE });
    const created = createJobWorker(fake.queue, [handler.handler]);
    assert(created.ok, `${mode} fail handler registry was rejected`);

    const result = await created.value.runOne({ id: WORKER_ID });

    assertDeepEqual(
      result,
      { ok: false, error: { code: "queue_interrupted", operation: "fail" } },
      `${mode} fail interruption shape changed`,
    );
    assertSame(fake.failCalls.length, 1, `${mode} fail was not called once`);
    assertSame(fake.succeedCalls.length, 0, `${mode} fail triggered succeed`);
    assertDeepEqual(fake.events, ["lease", "fail"], `${mode} fail mutated twice`);
  }
});
