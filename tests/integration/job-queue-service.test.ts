import type {
  EnqueueBatchRequest,
  EnqueueJob,
  JobBatchSummary,
  JobLease,
  JobQueueFailure,
  JobResultReference,
  WorkerIdentity,
} from "../../modules/jobs/public.js";
import type {
  IsoDateTime,
  JobBatchId,
  Outcome,
  WorkerId,
} from "../../core/contracts/public.js";
import type {
  EnqueueOutcome,
  FakeOptions,
  FakeQueue,
  LeaseOutcome,
} from "../helpers/fake-job-queue.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface HelperApi {
  readonly NOW: IsoDateTime;
  readonly FUTURE: IsoDateTime;
  readonly BATCH_ID: JobBatchId;
  readonly WORKER_ID: WorkerId;
  readonly RESULT: JobResultReference;
  readonly makeQueue: (options?: FakeOptions) => FakeQueue;
  readonly validJob: (
    sequence?: number,
    priority?: number,
    notBefore?: IsoDateTime,
  ) => EnqueueJob;
  readonly validRequest: () => EnqueueBatchRequest;
  readonly assertSame: <T>(actual: T, expected: T, message: string) => void;
  readonly assertEqual: <T>(actual: T, expected: T, message: string) => void;
  readonly assertDeepEqual: (actual: unknown, expected: unknown, message: string) => void;
  readonly assertFailureCode: (
    result: Outcome<unknown, JobQueueFailure>,
    expected: JobQueueFailure["code"],
    message: string,
  ) => void;
}

declare const require: (
  specifier: "node:test" | "../helpers/fake-job-queue.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const {
  NOW,
  FUTURE,
  BATCH_ID,
  WORKER_ID,
  RESULT,
  makeQueue,
  validJob,
  validRequest,
  assertSame,
  assertEqual,
  assertDeepEqual,
  assertFailureCode,
} = require("../helpers/fake-job-queue.ts") as HelperApi;

test("invalid enqueue shapes return exact failures before dependencies", async () => {
  const base = validRequest();
  const baseJob = validJob();
  const cases: readonly {
    readonly name: string;
    readonly request: unknown;
    readonly code: JobQueueFailure["code"];
  }[] = [
    { name: "empty key", request: { ...base, idempotencyKey: "" }, code: "invalid_request" },
    { name: "unknown request key", request: { ...base, extra: true }, code: "invalid_request" },
    { name: "jobs is not an array", request: { ...base, jobs: "jobs" }, code: "invalid_request" },
    {
      name: "unknown job key",
      request: { ...base, jobs: [{ ...baseJob, extra: true }] },
      code: "invalid_request",
    },
    {
      name: "missing required job key",
      request: {
        ...base,
        jobs: [{
          type: baseJob.type,
          target: baseJob.target,
          priority: baseJob.priority,
          sequence: baseJob.sequence,
        }],
      },
      code: "invalid_request",
    },
    {
      name: "wrong job type",
      request: { ...base, jobs: [{ ...baseJob, type: "other" }] },
      code: "invalid_request",
    },
    {
      name: "wrong target kind",
      request: {
        ...base,
        jobs: [{ ...baseJob, target: { ...baseJob.target, kind: "other" } }],
      },
      code: "invalid_request",
    },
    {
      name: "empty input version",
      request: {
        ...base,
        jobs: [{ ...baseJob, target: { ...baseJob.target, inputVersion: "" } }],
      },
      code: "invalid_request",
    },
    {
      name: "unsafe priority",
      request: { ...base, jobs: [{ ...baseJob, priority: Number.MAX_SAFE_INTEGER + 1 }] },
      code: "invalid_request",
    },
    {
      name: "negative sequence",
      request: { ...base, jobs: [{ ...baseJob, sequence: -1 }] },
      code: "invalid_request",
    },
    {
      name: "duplicate sequence",
      request: { ...base, jobs: [baseJob, { ...baseJob, sequence: baseJob.sequence }] },
      code: "invalid_request",
    },
    {
      name: "non-positive attempts",
      request: { ...base, jobs: [{ ...baseJob, maxAttempts: 0 }] },
      code: "invalid_request",
    },
    {
      name: "invalid optional date",
      request: { ...base, jobs: [{ ...baseJob, notBefore: "not-a-date" }] },
      code: "invalid_request",
    },
    { name: "empty batch", request: { ...base, jobs: [] }, code: "empty_batch" },
  ];

  for (const item of cases) {
    const fake = makeQueue();
    const result = await fake.queue.enqueue(item.request as EnqueueBatchRequest);
    assertFailureCode(result, item.code, item.name);
    assertDeepEqual(fake.events, [], `${item.name} touched a dependency`);
  }
});

test("enqueue fingerprints canonical fields and preserves future notBefore", async () => {
  const request = {
    jobs: [
      validJob(2, 10),
      validJob(1, -2, FUTURE),
    ],
    idempotencyKey: "request-1",
  } as EnqueueBatchRequest;
  const before = JSON.stringify(request);
  const summary: JobBatchSummary = {
    batchId: BATCH_ID as JobBatchSummary["batchId"],
    state: "active",
    totalCount: 2,
    createdAt: NOW,
  };
  const outcome: EnqueueOutcome = { ok: true, value: summary };
  const fake = makeQueue({
    batchIds: ["batch-fixed"],
    jobIds: ["job-first", "job-second"],
    enqueueOutcome: outcome,
  });

  const result = await fake.queue.enqueue(request);

  assertSame(result, outcome, "Enqueue outcome was reconstructed");
  assertDeepEqual(
    fake.events,
    ["clock", "id:batch", "id:job", "id:job", "store:enqueue"],
    "Enqueue dependency order changed",
  );
  assertEqual(JSON.stringify(request), before, "Enqueue mutated its input");
  assertEqual(fake.enqueueCommands.length, 1, "Enqueue was not delegated once");
  assertSame(fake.enqueueCommands[0].request, request, "Enqueue request reference changed");
  assertDeepEqual(
    fake.enqueueCommands[0],
    {
      request,
      requestFingerprint:
        '{"idempotencyKey":"request-1","jobs":[{"type":"health_check","target":{"kind":"bookmark","bookmarkId":"bookmark-1","inputVersion":"version-1"},"priority":10,"sequence":2,"maxAttempts":3},{"type":"health_check","target":{"kind":"bookmark","bookmarkId":"bookmark-1","inputVersion":"version-1"},"priority":-2,"sequence":1,"maxAttempts":3,"notBefore":"2026-07-13T12:00:01.000Z"}]}',
      batchId: "batch-fixed",
      jobIds: ["job-first", "job-second"],
      createdAt: NOW,
    },
    "Enqueue command changed",
  );
});

test("enqueue rejects an invalid clock before allocation", async () => {
  const fake = makeQueue({ now: "not-a-date" as IsoDateTime });
  const result = await fake.queue.enqueue(validRequest());

  assertFailureCode(result, "invalid_request", "Invalid enqueue clock was accepted");
  assertDeepEqual(fake.events, ["clock"], "Invalid clock did not stop enqueue");
});

test("enqueue validates every emitted ID before the store call", async () => {
  const fake = makeQueue({
    batchIds: ["duplicate"],
    jobIds: ["duplicate", "duplicate"],
  });
  const result = await fake.queue.enqueue({
    idempotencyKey: "request-1",
    jobs: [validJob(0), validJob(1)],
  });

  assertFailureCode(result, "invalid_request", "Duplicate IDs were accepted");
  assertDeepEqual(
    fake.events,
    ["clock", "id:batch", "id:job", "id:job"],
    "ID validation changed allocation order",
  );
  assertEqual(fake.enqueueCommands.length, 0, "Malformed IDs reached the store");
});

test("lease deduplicates capabilities and calculates safe expiry once", async () => {
  const outcome: LeaseOutcome = {
    ok: false,
    error: { code: "storage_unavailable", diagnostic: "opaque" },
  };
  const capabilities = Object.freeze(["health_check", "health_check"] as const);
  const before = JSON.stringify(capabilities);
  const fake = makeQueue({ leaseTokens: ["token-fixed"], leaseDurationMs: 1_500, leaseOutcome: outcome });

  const result = await fake.queue.lease({ id: WORKER_ID }, capabilities);

  assertSame(result, outcome, "Lease outcome was reconstructed");
  assertDeepEqual(
    fake.events,
    ["clock", "id:token", "store:lease"],
    "Lease dependency order changed",
  );
  assertEqual(JSON.stringify(capabilities), before, "Lease mutated capabilities");
  assertDeepEqual(
    fake.leaseCommands[0],
    {
      worker: { id: WORKER_ID },
      capabilities: ["health_check"],
      now: NOW,
      expiresAt: "2026-07-13T12:00:01.500Z",
      token: "token-fixed",
    },
    "Lease command changed",
  );
});

test("empty capabilities return null without any dependency call", async () => {
  const fake = makeQueue({ now: "not-a-date" as IsoDateTime });
  const result = await fake.queue.lease({ id: WORKER_ID }, []);

  assertDeepEqual(result, { ok: true, value: null }, "Empty capabilities did not return null");
  assertDeepEqual(fake.events, [], "Empty capabilities touched a dependency");
});

test("lease validates worker, clock, and duration before token and store", async () => {
  const emptyWorker = makeQueue();
  const emptyWorkerResult = await emptyWorker.queue.lease(
    { id: "" } as unknown as WorkerIdentity,
    ["health_check"],
  );
  assertFailureCode(emptyWorkerResult, "invalid_request", "Empty worker ID was accepted");
  assertDeepEqual(emptyWorker.events, [], "Empty worker ID touched a dependency");

  const invalidClock = makeQueue({ now: "not-a-date" as IsoDateTime });
  const invalidClockResult = await invalidClock.queue.lease(
    { id: WORKER_ID },
    ["health_check"],
  );
  assertFailureCode(invalidClockResult, "invalid_request", "Invalid lease clock was accepted");
  assertDeepEqual(invalidClock.events, ["clock"], "Invalid lease clock call order changed");
  assertEqual(invalidClock.leaseCommands.length, 0, "Invalid lease clock reached the store");

  for (const leaseDurationMs of [0, -1]) {
    const invalidDuration = makeQueue({ leaseDurationMs });
    const invalidDurationResult = await invalidDuration.queue.lease(
      { id: WORKER_ID },
      ["health_check"],
    );
    assertFailureCode(
      invalidDurationResult,
      "invalid_request",
      `Lease duration ${leaseDurationMs} was accepted`,
    );
    assertDeepEqual(
      invalidDuration.events,
      ["clock"],
      `Lease duration ${leaseDurationMs} changed dependency order`,
    );
    assertEqual(
      invalidDuration.leaseCommands.length,
      0,
      `Lease duration ${leaseDurationMs} reached the store`,
    );
  }
});

test("lease rejects invalid capabilities, token, and unsafe expiry without store calls", async () => {
  const invalidCapability = makeQueue();
  const capabilityResult = await invalidCapability.queue.lease(
    { id: WORKER_ID },
    ["unknown"] as unknown as readonly "health_check"[],
  );
  assertFailureCode(capabilityResult, "invalid_request", "Unknown capability was accepted");
  assertDeepEqual(invalidCapability.events, [], "Unknown capability touched a dependency");

  const invalidToken = makeQueue({ leaseTokens: [""] });
  const tokenResult = await invalidToken.queue.lease({ id: WORKER_ID }, ["health_check"]);
  assertFailureCode(tokenResult, "invalid_request", "Empty token was accepted");
  assertDeepEqual(invalidToken.events, ["clock", "id:token"], "Invalid token order changed");

  const unsafeExpiry = makeQueue({
    now: "9999-12-31T23:59:59.999Z" as IsoDateTime,
    leaseDurationMs: 1,
  });
  const expiryResult = await unsafeExpiry.queue.lease({ id: WORKER_ID }, ["health_check"]);
  assertFailureCode(expiryResult, "invalid_request", "Unsafe expiry was accepted");
  assertDeepEqual(unsafeExpiry.events, ["clock"], "Unsafe expiry allocated a token");
});

test("dependency exceptions propagate unchanged", async () => {
  const exception = new Error("opaque store exception");
  const fake = makeQueue({ enqueueException: exception });
  let caught: unknown;
  try {
    await fake.queue.enqueue(validRequest());
  } catch (error) {
    caught = error;
  }
  assertSame(caught, exception, "Dependency exception was translated or swallowed");
});
