import type {
  BookmarkId,
  ContentHash,
  IsoDateTime,
  JobResultId,
  Outcome,
} from "../../core/contracts/public.js";
import type {
  HealthCheckRequest,
  HealthChecker,
  HealthCheckerDependencies,
  HealthObservation,
  HealthRepositoryFailure,
  HealthTransportFailure,
  HealthTransportRequest,
  HealthTransportResponse,
} from "../../modules/health/public.js";

interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }
interface HealthRuntime {
  createHealthChecker(dependencies: HealthCheckerDependencies): HealthChecker;
}
declare const require: (specifier: "node:test" | "../../modules/health/public.ts") => unknown;
const { test } = require("node:test") as NodeTestApi;
const { createHealthChecker } = require("../../modules/health/public.ts") as HealthRuntime;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)}`);
  }
}

const request: HealthCheckRequest = {
  bookmarkId: "bookmark:checker" as BookmarkId,
  inputVersion: "input:v1",
  url: "https://example.com/start",
};
const checkedAt = "2026-07-15T12:00:00.000Z" as IsoDateTime;
const observationId = "observation:checker" as JobResultId;

function response(
  statusCode = 200,
  overrides: Partial<HealthTransportResponse> = {},
): Outcome<HealthTransportResponse, HealthTransportFailure> {
  return {
    ok: true,
    value: {
      url: request.url,
      statusCode,
      headers: [],
      durationMs: 3,
      ...overrides,
    },
  };
}

interface HarnessOptions {
  readonly existing?: HealthObservation | null;
  readonly facts?: readonly Outcome<HealthTransportResponse, HealthTransportFailure>[];
  readonly loadFailure?: HealthRepositoryFailure;
  readonly saveFailure?: HealthRepositoryFailure;
  readonly dependencies?: Partial<HealthCheckerDependencies>;
}

function harness(options: HarnessOptions = {}) {
  const requests: HealthTransportRequest[] = [];
  const saved: HealthObservation[] = [];
  let loads = 0;
  let saves = 0;
  const facts = [...(options.facts ?? [response()])];
  const dependencies: HealthCheckerDependencies = {
    config: { timeoutMs: 100, maxRedirects: 5, maxBodyBytes: 16 },
    clock: { now: () => checkedAt },
    idFactory: { nextObservationId: () => observationId },
    transport: {
      async request(input) {
        requests.push(input);
        const fact = facts.shift();
        if (fact === undefined) throw new Error("Unexpected transport request");
        return fact;
      },
    },
    fingerprinter: {
      fingerprint: () => "sha256:body" as ContentHash,
    },
    repository: {
      async loadByInput() {
        loads += 1;
        return options.loadFailure
          ? { ok: false, error: options.loadFailure }
          : { ok: true, value: options.existing ?? null };
      },
      async saveIfAbsent(candidate) {
        saves += 1;
        saved.push(candidate);
        return options.saveFailure
          ? { ok: false, error: options.saveFailure }
          : { ok: true, value: candidate };
      },
    },
    ...options.dependencies,
  };
  return {
    checker: createHealthChecker(dependencies),
    state: { requests, saved, get loads() { return loads; }, get saves() { return saves; } },
  };
}

function stored(overrides: Partial<HealthObservation> = {}): HealthObservation {
  return {
    id: observationId,
    bookmarkId: request.bookmarkId,
    inputVersion: request.inputVersion,
    status: "healthy",
    checkedAt,
    requestedUrl: request.url,
    finalUrl: request.url,
    method: "GET",
    httpStatus: 200,
    redirects: [],
    durationMs: 3,
    retryCount: 0,
    headers: [],
    ...overrides,
  };
}

test("rejects invalid requests and configuration before I/O", async () => {
  const invalidRequest = harness();
  equal(await invalidRequest.checker.check({ ...request, inputVersion: "" }), {
    ok: false,
    error: { code: "invalid_request", disposition: "terminal" },
  }, "Invalid request outcome changed");
  equal(invalidRequest.state, { requests: [], saved: [], loads: 0, saves: 0 }, "Invalid request used I/O");

  const invalidConfig = harness({
    dependencies: { config: { timeoutMs: 0, maxRedirects: 5, maxBodyBytes: 16 } },
  });
  equal(await invalidConfig.checker.check(request), {
    ok: false,
    error: { code: "invalid_configuration", disposition: "terminal" },
  }, "Invalid config outcome changed");
  assert(invalidConfig.state.loads === 0, "Invalid config loaded storage");
});

test("replays exact input and rejects URL reuse before side effects", async () => {
  const replay = harness({ existing: stored() });
  equal(await replay.checker.check(request), { ok: true, value: { id: observationId } }, "Replay changed");
  assert(replay.state.requests.length === 0 && replay.state.saves === 0, "Replay used side effects");

  const conflict = harness({ existing: stored({
    requestedUrl: "https://other.example",
    finalUrl: "https://other.example",
  }) });
  equal(await conflict.checker.check(request), {
    ok: false,
    error: { code: "input_conflict", disposition: "terminal" },
  }, "Input conflict changed");
  assert(conflict.state.requests.length === 0, "Conflict called transport");
});

test("assembles fingerprints and commits a final typed response", async () => {
  const body = new Uint8Array([1, 2, 3]);
  const run = harness({ facts: [response(200, {
    headers: [{ name: "etag", value: "fixed" }],
    body,
    durationMs: 7,
  })] });
  equal(await run.checker.check(request), { ok: true, value: { id: observationId } }, "Commit result changed");
  equal(run.state.requests, [{
    url: request.url,
    method: "GET",
    redirect: "manual",
    timeoutMs: 100,
    maxBodyBytes: 16,
  }], "Transport request changed");
  equal(run.state.saved, [stored({
    headers: [{ name: "etag", value: "fixed" }],
    bodyFingerprint: "sha256:body" as ContentHash,
    durationMs: 7,
  })], "Saved observation changed");
});

test("persists typed transport failures and rejects thrown transport", async () => {
  const timeout = harness({ facts: [{
    ok: false,
    error: { code: "timeout", durationMs: 9 },
  }] });
  assert((await timeout.checker.check(request)).ok, "Typed timeout should commit");
  equal(timeout.state.saved, [stored({
    status: "timeout",
    finalUrl: undefined,
    httpStatus: undefined,
    durationMs: 9,
    errorCode: "timeout",
  })], "Timeout observation changed");

  const thrown = harness({ dependencies: {
    transport: { async request() { throw new Error("opaque transport prose"); } },
  } });
  equal(await thrown.checker.check(request), {
    ok: false,
    error: { code: "transport_unavailable", disposition: "retry" },
  }, "Thrown transport outcome changed");
  assert(thrown.state.saves === 0, "Thrown transport saved an observation");
});

test("walks valid redirects and stops invalid or excessive chains", async () => {
  const chain = harness({ facts: [
    response(301, { headers: [{ name: "location", value: "/one" }] }),
    response(302, { url: "https://example.com/one", headers: [{ name: "location", value: "/two" }] }),
    response(200, { url: "https://example.com/two" }),
  ] });
  assert((await chain.checker.check(request)).ok, "Redirect chain failed");
  assert(chain.state.requests.length === 3, "Redirect chain request count changed");
  assert(chain.state.saved[0]?.status === "redirect_temporary", "Redirect classification changed");
  assert(chain.state.saved[0]?.redirects.length === 2, "Redirect hops changed");
  assert(chain.state.saved[0]?.durationMs === 9, "Redirect duration changed");

  const invalid = harness({ facts: [response(301)] });
  assert((await invalid.checker.check(request)).ok, "Invalid redirect should commit");
  assert(invalid.state.saved[0]?.errorCode === "invalid_redirect", "Invalid redirect code changed");

  const redirect = response(301, { headers: [{ name: "location", value: "/next" }] });
  const repeated = response(301, {
    url: "https://example.com/next",
    headers: [{ name: "location", value: "/next" }],
  });
  const limited = harness({ facts: [redirect, repeated, repeated, repeated, repeated, repeated] });
  assert((await limited.checker.check(request)).ok, "Redirect limit should commit");
  assert(limited.state.requests.length === 6, "Redirect limit exceeded six requests");
  assert(limited.state.saved[0]?.redirects.length === 5, "Redirect limit recorded a sixth hop");
  assert(limited.state.saved[0]?.errorCode === "redirect_limit", "Redirect limit code changed");
});

test("maps ID clock and repository failures without parsing diagnostics", async () => {
  const badId = harness({ dependencies: {
    idFactory: { nextObservationId: () => "" as JobResultId },
  } });
  equal(await badId.checker.check(request), {
    ok: false,
    error: { code: "id_unavailable", disposition: "terminal" },
  }, "ID failure changed");
  assert(badId.state.requests.length === 0, "Bad ID called transport");

  const badClock = harness({ dependencies: {
    clock: { now: () => "not-a-date" as IsoDateTime },
  } });
  equal(await badClock.checker.check(request), {
    ok: false,
    error: { code: "clock_unavailable", disposition: "retry" },
  }, "Clock failure changed");
  assert(badClock.state.saves === 0, "Bad clock saved");

  const load = harness({ loadFailure: { code: "storage_unavailable", diagnostic: "opaque" } });
  equal(await load.checker.check(request), {
    ok: false,
    error: { code: "storage_unavailable", disposition: "retry" },
  }, "Load failure changed");
  const save = harness({ saveFailure: { code: "observation_conflict", diagnostic: "opaque" } });
  equal(await save.checker.check(request), {
    ok: false,
    error: { code: "input_conflict", disposition: "terminal" },
  }, "Save conflict changed");
});
