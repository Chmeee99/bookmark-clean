import type {
  BookmarkId,
  ContentHash,
  IsoDateTime,
  JobResultId,
} from "../../core/contracts/public.js";
import type {
  HealthChecker,
  HealthCheckerDependencies,
  HealthObservation,
} from "../../modules/health/public.js";

interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }
declare const require: (specifier: string) => unknown;
const { test } = require("node:test") as NodeTestApi;
const { createHealthChecker } = require("../../modules/health/public.ts") as {
  createHealthChecker(dependencies: HealthCheckerDependencies): HealthChecker;
};

const request = {
  bookmarkId: "bookmark:validation" as BookmarkId,
  inputVersion: "input:v1",
  url: "https://example.com",
};

function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function dependencies(
  overrides: Partial<HealthCheckerDependencies> = {},
): { readonly value: HealthCheckerDependencies; readonly saved: HealthObservation[] } {
  const saved: HealthObservation[] = [];
  return {
    saved,
    value: {
      config: { timeoutMs: 10, maxRedirects: 5, maxBodyBytes: 2 },
      clock: { now: () => "2026-07-15T14:00:00.000Z" as IsoDateTime },
      idFactory: { nextObservationId: () => "observation:validation" as JobResultId },
      transport: {
        async request(input) {
          return {
            ok: true,
            value: { url: input.url, statusCode: 200, headers: [], durationMs: 1 },
          };
        },
      },
      fingerprinter: { fingerprint: () => "sha256:validation" as ContentHash },
      repository: {
        async loadByInput() { return { ok: true, value: null }; },
        async saveIfAbsent(observation) { saved.push(observation); return { ok: true, value: observation }; },
      },
      ...overrides,
    },
  };
}

function observation(overrides: Partial<HealthObservation> = {}): HealthObservation {
  return {
    id: "observation:valid" as JobResultId,
    bookmarkId: request.bookmarkId,
    inputVersion: request.inputVersion,
    status: "healthy",
    checkedAt: "2026-07-15T14:00:00.000Z" as IsoDateTime,
    requestedUrl: request.url,
    finalUrl: request.url,
    method: "GET",
    httpStatus: 200,
    redirects: [],
    durationMs: 1,
    retryCount: 0,
    headers: [],
    ...overrides,
  };
}

function without(value: HealthObservation, key: string): HealthObservation {
  const changed = { ...value } as Record<string, unknown>;
  delete changed[key];
  return changed as unknown as HealthObservation;
}

function redirectChain(count: number): HealthObservation["redirects"] {
  let current = request.url;
  const redirects = [];
  for (let index = 0; index < count; index += 1) {
    const nextUrl = `${request.url}/redirect-${index + 1}`;
    redirects.push({
      requestedUrl: current,
      statusCode: 302 as const,
      location: `/redirect-${index + 1}`,
      nextUrl,
    });
    current = nextUrl;
  }
  return redirects;
}

const storageFailure = {
  ok: false,
  error: { code: "storage_unavailable", disposition: "retry" },
} as const;

test("malformed configuration returns its closed failure without throwing", async () => {
  const input = dependencies({ config: undefined as never });
  equal(await createHealthChecker(input.value).check(request), {
    ok: false,
    error: { code: "invalid_configuration", disposition: "terminal" },
  });
  equal(input.saved, []);
});

test("malformed transport and fingerprint results stop before storage", async () => {
  for (const transport of [
    { async request() { return { ok: true, value: {
      url: request.url, statusCode: 99, headers: [], durationMs: 1,
    } } as never; } },
    { async request() { return { ok: true, value: {
      url: request.url, statusCode: 200, headers: [],
      body: new Uint8Array([1, 2, 3]), durationMs: 1,
    } } as never; } },
  ]) {
    const input = dependencies({ transport });
    equal(await createHealthChecker(input.value).check(request), {
      ok: false,
      error: { code: "transport_unavailable", disposition: "retry" },
    });
    equal(input.saved, []);
  }
  const fingerprint = dependencies({
    transport: { async request(input) { return { ok: true, value: {
      url: input.url, statusCode: 200, headers: [], body: new Uint8Array([1]), durationMs: 1,
    } }; } },
    fingerprinter: { fingerprint() { throw new Error("opaque fingerprint prose"); } },
  });
  equal(await createHealthChecker(fingerprint.value).check(request), {
    ok: false,
    error: { code: "transport_unavailable", disposition: "retry" },
  });
  equal(fingerprint.saved, []);
});

test("malformed successful repository results cannot supply committed IDs", async () => {
  const input = dependencies({ repository: {
    async loadByInput() { return { ok: true, value: null }; },
    async saveIfAbsent() {
      return { ok: true, value: { id: "observation:other" as JobResultId } as HealthObservation };
    },
  } });
  equal(await createHealthChecker(input.value).check(request), {
    ok: false,
    error: { code: "storage_unavailable", disposition: "retry" },
  });
});

test("matching-looking incomplete repository observations are rejected on load and save", async () => {
  const incomplete = {
    id: "observation:incomplete" as JobResultId,
    bookmarkId: request.bookmarkId,
    inputVersion: request.inputVersion,
    requestedUrl: request.url,
  } as HealthObservation;

  for (const repository of [
    {
      async loadByInput() { return { ok: true as const, value: incomplete }; },
      async saveIfAbsent(observation: HealthObservation) { return { ok: true as const, value: observation }; },
    },
    {
      async loadByInput() { return { ok: true as const, value: null }; },
      async saveIfAbsent() { return { ok: true as const, value: incomplete }; },
    },
  ]) {
    const input = dependencies({ repository });
    equal(await createHealthChecker(input.value).check(request), {
      ok: false,
      error: { code: "storage_unavailable", disposition: "retry" },
    });
  }
});

test("rejects one-field observation corruptions on both repository boundaries", async () => {
  const base = observation();
  const required = [
    "id", "bookmarkId", "inputVersion", "status", "checkedAt", "requestedUrl",
    "method", "redirects", "durationMs", "retryCount", "headers",
  ];
  const corruptions: Array<readonly [string, HealthObservation]> = required.map((key) => [
    `missing ${key}`,
    without(base, key),
  ]);
  corruptions.push(
    ["extra key", { ...base, unexpected: true } as unknown as HealthObservation],
    ["empty id", observation({ id: "" as JobResultId })],
    ["wrong bookmark", observation({ bookmarkId: "bookmark:other" as BookmarkId })],
    ["empty input", observation({ inputVersion: "" })],
    ["unknown status", observation({ status: "unknown" as never })],
    ["invalid checkedAt", observation({ checkedAt: "2026-07-15" as IsoDateTime })],
    ["empty requestedUrl", observation({ requestedUrl: "" })],
    ["wrong method", observation({ method: "POST" as never })],
    ["invalid redirects", observation({ redirects: {} as never })],
    ["incomplete redirect", observation({ redirects: [{
      requestedUrl: request.url, statusCode: 301, location: "/next",
    }] as never })],
    ["invalid redirect status", observation({ redirects: [{
      requestedUrl: request.url, statusCode: 304, location: "/next", nextUrl: `${request.url}/next`,
    }] as never })],
    ["negative duration", observation({ durationMs: -1 })],
    ["fractional duration", observation({ durationMs: 1.5 })],
    ["negative retry", observation({ retryCount: -1 })],
    ["nonzero retry", observation({ retryCount: 1 })],
    ["invalid header name", observation({ headers: [{ name: "server", value: "x" }] as never })],
    ["duplicate header", observation({ headers: [
      { name: "etag", value: "one" }, { name: "etag", value: "two" },
    ] })],
    ["empty finalUrl", observation({ finalUrl: "" })],
    ["invalid httpStatus", observation({ httpStatus: 99 })],
    ["fractional httpStatus", observation({ httpStatus: 200.5 })],
    ["unknown errorCode", observation({ errorCode: "unknown" as never })],
    ["empty bodyFingerprint", observation({ bodyFingerprint: "" as ContentHash })],
    ["response with transport error", observation({ errorCode: "timeout" })],
    ["transport failure with response facts", observation({
      status: "timeout", errorCode: "timeout",
    })],
    ["transport failure with wrong status", observation({
      status: "dns_failure", finalUrl: undefined, httpStatus: undefined,
      errorCode: "timeout",
    })],
    ["response with wrong classification", observation({ status: "not_found" })],
    ["response with wrong final URL", observation({
      status: "redirect_temporary",
      finalUrl: "https://unrelated.example",
      redirects: redirectChain(1),
    })],
    ["disconnected redirect chain", observation({
      status: "redirect_temporary",
      finalUrl: `${request.url}/redirect-2`,
      redirects: [
        ...redirectChain(1),
        {
          requestedUrl: "https://unrelated.example",
          statusCode: 302,
          location: "/redirect-2",
          nextUrl: `${request.url}/redirect-2`,
        },
      ],
    })],
    ["too many redirects", observation({
      status: "redirect_temporary",
      finalUrl: `${request.url}/redirect-6`,
      redirects: redirectChain(6),
    })],
    ["redirect response without redirect error", observation({
      status: "uncertain",
      httpStatus: 302,
    })],
    ["redirect limit without five completed hops", observation({
      status: "uncertain",
      errorCode: "redirect_limit",
      httpStatus: 302,
    })],
    ["invalid redirect with a valid selected location", observation({
      status: "uncertain",
      errorCode: "invalid_redirect",
      httpStatus: 302,
      headers: [{ name: "location", value: "/valid" }],
    })],
    ["redirect limit without a selected location", observation({
      status: "uncertain",
      finalUrl: `${request.url}/redirect-5`,
      errorCode: "redirect_limit",
      httpStatus: 302,
      redirects: redirectChain(5),
    })],
    ["page suspicion without typed evidence", observation({
      status: "soft_404_suspected",
    })],
  );

  for (const [label, corrupted] of corruptions) {
    const loaded = dependencies({ repository: {
      async loadByInput() { return { ok: true, value: corrupted }; },
      async saveIfAbsent(candidate) { return { ok: true, value: candidate }; },
    } });
    equal(await createHealthChecker(loaded.value).check(request), storageFailure);

    const saved = dependencies({ repository: {
      async loadByInput() { return { ok: true, value: null }; },
      async saveIfAbsent() { return { ok: true, value: corrupted }; },
    } });
    const result = await createHealthChecker(saved.value).check(request);
    if (JSON.stringify(result) !== JSON.stringify(storageFailure)) {
      throw new Error(`${label} passed save validation: ${JSON.stringify(result)}`);
    }
  }
});

test("accepts valid observation families and preserves requested URL conflicts", async () => {
  const variants = [
    observation(),
    observation({
      status: "timeout", finalUrl: undefined, httpStatus: undefined,
      errorCode: "timeout", bodyFingerprint: undefined,
    }),
    observation({
      status: "redirect_temporary",
      finalUrl: `${request.url}/redirect-1`,
      redirects: [{
        requestedUrl: request.url, statusCode: 302, location: "/redirect-1",
        nextUrl: `${request.url}/redirect-1`,
      }],
      bodyFingerprint: "sha256:valid" as ContentHash,
    }),
    observation({
      status: "uncertain",
      errorCode: "invalid_redirect",
      httpStatus: 302,
      headers: [],
    }),
    observation({
      status: "uncertain",
      finalUrl: `${request.url}/redirect-5`,
      errorCode: "redirect_limit",
      httpStatus: 302,
      redirects: redirectChain(5),
      headers: [{ name: "location", value: "/redirect-6" }],
    }),
  ];
  for (const value of variants) {
    const input = dependencies({ repository: {
      async loadByInput() { return { ok: true, value }; },
      async saveIfAbsent(candidate) { return { ok: true, value: candidate }; },
    } });
    equal(await createHealthChecker(input.value).check(request), {
      ok: true,
      value: { id: value.id },
    });
    equal(input.saved, []);
  }

  const conflict = observation({
    requestedUrl: "https://other.example",
    finalUrl: "https://other.example",
  });
  const input = dependencies({ repository: {
    async loadByInput() { return { ok: true, value: conflict }; },
    async saveIfAbsent(candidate) { return { ok: true, value: candidate }; },
  } });
  equal(await createHealthChecker(input.value).check(request), {
    ok: false,
    error: { code: "input_conflict", disposition: "terminal" },
  });
});

test("rejects a requested URL conflict returned by saveIfAbsent", async () => {
  const conflict = observation({
    requestedUrl: "https://other.example",
    finalUrl: "https://other.example",
  });
  let saveCalls = 0;
  const input = dependencies({ repository: {
    async loadByInput() { return { ok: true, value: null }; },
    async saveIfAbsent() { saveCalls += 1; return { ok: true, value: conflict }; },
  } });

  equal(await createHealthChecker(input.value).check(request), {
    ok: false,
    error: { code: "input_conflict", disposition: "terminal" },
  });
  equal(saveCalls, 1);
});
