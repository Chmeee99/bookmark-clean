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
