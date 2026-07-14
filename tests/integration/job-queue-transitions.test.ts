import type { IsoDateTime, Outcome } from "../../core/contracts/public.js";
import type {
  JobLease,
  JobQueueFailure,
  JobResultReference,
  TypedJobFailure,
} from "../../modules/jobs/public.js";
import type {
  FakeOptions,
  FakeQueue,
  VoidOutcome,
} from "../helpers/fake-job-queue.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface HelperApi {
  readonly NOW: IsoDateTime;
  readonly LEASE_TOKEN: string;
  readonly RESULT: JobResultReference;
  readonly makeQueue: (options?: FakeOptions) => FakeQueue;
  readonly validLease: (overrides?: Record<string, unknown>) => JobLease;
  readonly assertSame: <T>(actual: T, expected: T, message: string) => void;
  readonly assertDeepEqual: (actual: unknown, expected: unknown, message: string) => void;
  readonly assertFailureCode: (
    result: Outcome<unknown, JobQueueFailure>,
    expected: JobQueueFailure["code"],
    message: string,
  ) => void;
}

declare const require: (specifier: string) => unknown;

const { test } = require("node:test") as NodeTestApi;
const helper = require("../helpers/fake-job-queue.ts") as HelperApi;
const {
  NOW, LEASE_TOKEN, RESULT, makeQueue, validLease,
  assertSame, assertDeepEqual, assertFailureCode,
} = helper;

test("completion sends one exact store command", async () => {
  const outcome: VoidOutcome = {
    ok: false,
    error: { code: "stale_lease", diagnostic: "opaque" },
  };
  const fake = makeQueue({ completeOutcome: outcome });

  const result = await fake.queue.succeed(validLease(), RESULT);

  assertSame(result, outcome, "Completion outcome was reconstructed");
  assertDeepEqual(fake.events, ["clock", "store:complete"], "Completion order changed");
  assertDeepEqual(
    fake.completeCommands,
    [{
      token: LEASE_TOKEN,
      expectedAttempt: 2,
      result: RESULT,
      completedAt: NOW,
    }],
    "Completion command changed",
  );
});

test("retry scheduling uses the lease attempt and returned time", async () => {
  const retryAt = "2026-07-13T12:00:05.000Z" as IsoDateTime;
  const failure: TypedJobFailure = {
    code: "diagnostic-says-terminal",
    disposition: "retry",
    diagnostic: "evidence only",
  };
  const outcome: VoidOutcome = { ok: true, value: undefined };
  const fake = makeQueue({ retryAt, failOutcome: outcome });

  const result = await fake.queue.fail(validLease({ attempt: 4 }), failure);

  assertSame(result, outcome, "Retry outcome was reconstructed");
  assertDeepEqual(fake.events, ["clock", "retry", "store:fail"], "Retry order changed");
  assertDeepEqual(fake.retryCalls, [{ attempt: 4, failedAt: NOW }], "Retry input changed");
  assertDeepEqual(
    fake.failCommands,
    [{
      token: LEASE_TOKEN,
      expectedAttempt: 4,
      failure,
      failedAt: NOW,
      retryAt,
    }],
    "Failure command changed",
  );
});

test("invalid typed failures stop before dependencies", async () => {
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
