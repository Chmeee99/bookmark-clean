import type {
  JobLease,
  JobQueueFailure,
  JobResultReference,
  TypedJobFailure,
} from "../../modules/jobs/public.js";
import type { IsoDateTime, JobBatchId, Outcome } from "../../core/contracts/public.js";
import type {
  FakeOptions,
  FakeQueue,
  ProgressOutcome,
  VoidOutcome,
} from "../helpers/fake-job-queue.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface HelperApi {
  readonly NOW: IsoDateTime;
  readonly FUTURE: IsoDateTime;
  readonly BEFORE_NOW: IsoDateTime;
  readonly BATCH_ID: JobBatchId;
  readonly LEASE_TOKEN: string;
  readonly RESULT: JobResultReference;
  readonly makeQueue: (options?: FakeOptions) => FakeQueue;
  readonly validLease: (overrides?: Record<string, unknown>) => JobLease;
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
  BEFORE_NOW,
  BATCH_ID,
  LEASE_TOKEN,
  RESULT,
  makeQueue,
  validLease,
  assertSame,
  assertEqual,
  assertDeepEqual,
  assertFailureCode,
} = require("../helpers/fake-job-queue.ts") as HelperApi;

test("invalid clocks stop transitions after one clock call", async () => {
  const operations: readonly {
    readonly name: string;
    readonly invoke: (queue: FakeQueue["queue"]) => Promise<Outcome<unknown, JobQueueFailure>>;
  }[] = [
    {
      name: "succeed",
      invoke: (queue) => queue.succeed(validLease(), RESULT),
    },
    {
      name: "terminal fail",
      invoke: (queue) => queue.fail(validLease(), { code: "opaque", disposition: "terminal" }),
    },
    { name: "pause", invoke: (queue) => queue.pause(BATCH_ID) },
    { name: "resume", invoke: (queue) => queue.resume(BATCH_ID) },
    { name: "cancel", invoke: (queue) => queue.cancel(BATCH_ID) },
    { name: "getProgress", invoke: (queue) => queue.getProgress(BATCH_ID) },
  ];

  for (const operation of operations) {
    const fake = makeQueue({ now: "not-a-date" as IsoDateTime });
    const result = await operation.invoke(fake.queue);
    assertFailureCode(result, "invalid_request", `${operation.name} accepted an invalid clock`);
    assertDeepEqual(fake.events, ["clock"], `${operation.name} clock order changed`);
    assertEqual(fake.retryCalls.length, 0, `${operation.name} called retry scheduling`);
    assertEqual(fake.completeCommands.length, 0, `${operation.name} reached completion store`);
    assertEqual(fake.failCommands.length, 0, `${operation.name} reached failure store`);
    assertEqual(fake.controlCalls.length, 0, `${operation.name} reached control store`);
    assertEqual(fake.progressCalls.length, 0, `${operation.name} reached progress store`);
  }
});

test("succeed validates exact shapes and delegates one completion command", async () => {
  const outcome: VoidOutcome = {
    ok: false,
    error: { code: "stale_lease", diagnostic: "opaque" },
  };
  const fake = makeQueue({ completeOutcome: outcome });
  const result = await fake.queue.succeed(validLease(), RESULT);

  assertSame(result, outcome, "Completion outcome was reconstructed");
  assertDeepEqual(fake.events, ["clock", "store:complete"], "Completion order changed");
  assertDeepEqual(
    fake.completeCommands[0],
    {
      token: LEASE_TOKEN,
      expectedAttempt: 2,
      result: RESULT,
      completedAt: NOW,
    },
    "Completion command changed",
  );

  const invalidCases: readonly { readonly name: string; readonly lease?: unknown; readonly result?: unknown }[] = [
    { name: "empty token", lease: validLease({ token: "" }) },
    { name: "zero attempt", lease: validLease({ attempt: 0 }) },
    { name: "invalid lease time", lease: validLease({ leasedAt: "bad" }) },
    { name: "unknown lease key", lease: validLease({ extra: true }) },
    { name: "empty result ID", result: { ...RESULT, id: "" } },
    { name: "unknown result key", result: { ...RESULT, extra: true } },
  ];
  for (const item of invalidCases) {
    const invalid = makeQueue();
    const invalidResult = await invalid.queue.succeed(
      (item.lease ?? validLease()) as JobLease,
      (item.result ?? RESULT) as JobResultReference,
    );
    assertFailureCode(invalidResult, "invalid_request", item.name);
    assertDeepEqual(invalid.events, [], `${item.name} touched a dependency`);
  }
});

test("retry failure uses the returned lease attempt and retry time", async () => {
  const failure: TypedJobFailure = {
    code: "diagnostic-says-terminal",
    disposition: "retry",
    diagnostic: "evidence only",
  };
  const outcome: VoidOutcome = { ok: true, value: undefined };
  const fake = makeQueue({ retryAt: "2026-07-13T12:00:05.000Z" as IsoDateTime, failOutcome: outcome });
  const result = await fake.queue.fail(validLease({ attempt: 4 }), failure);

  assertSame(result, outcome, "Retry outcome was reconstructed");
  assertDeepEqual(fake.events, ["clock", "retry", "store:fail"], "Retry order changed");
  assertDeepEqual(fake.retryCalls, [{ attempt: 4, failedAt: NOW }], "Retry arguments changed");
  assertDeepEqual(
    fake.failCommands[0],
    {
      token: LEASE_TOKEN,
      expectedAttempt: 4,
      failure,
      failedAt: NOW,
      retryAt: "2026-07-13T12:00:05.000Z",
    },
    "Retry failure command changed",
  );
});

test("terminal failure never calls retry scheduling and omits retryAt", async () => {
  const failure: TypedJobFailure = {
    code: "retry-looking-code",
    disposition: "terminal",
    diagnostic: "evidence only",
  };
  const outcome: VoidOutcome = { ok: true, value: undefined };
  const fake = makeQueue({ retryAt: BEFORE_NOW, failOutcome: outcome });
  const result = await fake.queue.fail(validLease(), failure);

  assertSame(result, outcome, "Terminal outcome was reconstructed");
  assertDeepEqual(fake.events, ["clock", "store:fail"], "Terminal failure called retry scheduling");
  assertEqual(fake.retryCalls.length, 0, "Terminal failure scheduled a retry");
  assertDeepEqual(
    fake.failCommands[0],
    {
      token: LEASE_TOKEN,
      expectedAttempt: 2,
      failure,
      failedAt: NOW,
    },
    "Terminal failure command changed",
  );
  assertEqual("retryAt" in fake.failCommands[0], false, "Terminal command included retryAt");
});

test("invalid retry time stops before failLease", async () => {
  const fake = makeQueue({ retryAt: BEFORE_NOW });
  const result = await fake.queue.fail(validLease(), {
    code: "opaque",
    disposition: "retry",
  });

  assertFailureCode(result, "invalid_request", "Earlier retry time was accepted");
  assertDeepEqual(fake.events, ["clock", "retry"], "Invalid retry time reached the store");
  assertEqual(fake.failCommands.length, 0, "Invalid retry time delegated a failure");
});

test("invalid failures are rejected before clock and schedule dependencies", async () => {
  const cases: readonly unknown[] = [
    { code: "", disposition: "retry" },
    { code: "code", disposition: "other" },
    { code: "code", disposition: "retry", extra: true },
    { code: "code", disposition: "retry", diagnostic: 42 },
  ];
  for (const failure of cases) {
    const fake = makeQueue();
    const result = await fake.queue.fail(validLease(), failure as TypedJobFailure);
    assertFailureCode(result, "invalid_request", "Invalid failure was accepted");
    assertDeepEqual(fake.events, [], "Invalid failure touched a dependency");
  }
});

test("batch controls and progress use one clock value and return store outcomes unchanged", async () => {
  const controlOutcome: VoidOutcome = {
    ok: false,
    error: { code: "batch_not_found", diagnostic: "opaque" },
  };
  const progressOutcome: ProgressOutcome = {
    ok: true,
    value: {
      batchId: BATCH_ID,
      batchState: "paused",
      totalCount: 1,
      pendingCount: 0,
      leasedCount: 1,
      retryWaitCount: 0,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      nextEligibleAt: FUTURE,
    },
  };
  const fake = makeQueue({ controlOutcome, progressOutcome });

  const pause = await fake.queue.pause(BATCH_ID);
  const resume = await fake.queue.resume(BATCH_ID);
  const cancel = await fake.queue.cancel(BATCH_ID);
  const progress = await fake.queue.getProgress(BATCH_ID);

  assertSame(pause, controlOutcome, "Pause outcome was reconstructed");
  assertSame(resume, controlOutcome, "Resume outcome was reconstructed");
  assertSame(cancel, controlOutcome, "Cancel outcome was reconstructed");
  assertSame(progress, progressOutcome, "Progress outcome was reconstructed");
  assertDeepEqual(
    fake.events,
    [
      "clock",
      "store:control",
      "clock",
      "store:control",
      "clock",
      "store:control",
      "clock",
      "store:progress",
    ],
    "Batch command order changed",
  );
  assertDeepEqual(
    fake.controlCalls,
    [
      { batchId: BATCH_ID, action: "pause", changedAt: NOW },
      { batchId: BATCH_ID, action: "resume", changedAt: NOW },
      { batchId: BATCH_ID, action: "cancel", changedAt: NOW },
    ],
    "Batch control commands changed",
  );
  assertDeepEqual(
    fake.progressCalls,
    [{ batchId: BATCH_ID, now: NOW }],
    "Progress command changed",
  );
});

test("empty batch IDs are rejected before control and progress dependencies", async () => {
  for (const operation of ["pause", "resume", "cancel"] as const) {
    const fake = makeQueue();
    const result = await fake.queue[operation]("" as JobBatchId);
    assertFailureCode(result, "invalid_request", `${operation} accepted an empty ID`);
    assertDeepEqual(fake.events, [], `${operation} touched a dependency`);
  }
  const fake = makeQueue();
  const result = await fake.queue.getProgress("" as JobBatchId);
  assertFailureCode(result, "invalid_request", "Progress accepted an empty ID");
  assertDeepEqual(fake.events, [], "Progress touched a dependency");
});
