interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface HealthLoopbackFixture {
  readonly urls: {
    readonly status200: string;
    readonly redirect301: string;
    readonly redirect302: string;
    readonly status401: string;
    readonly status403: string;
    readonly status404: string;
    readonly status410: string;
    readonly status429: string;
    readonly status503: string;
    readonly connectionClose: string;
    readonly pending: string;
    readonly malformed: string;
  };
  readonly requestCounts: Readonly<Record<string, number>>;
  close(): Promise<void>;
}

interface HealthLoopbackFixtureApi {
  createHealthLoopbackFixture(): Promise<HealthLoopbackFixture>;
}

interface ErrorFacts {
  readonly type: string;
  readonly name: string;
}

declare const require: (
  specifier: "node:test" | "../helpers/health-loopback-fixture.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const { createHealthLoopbackFixture } = require(
  "../helpers/health-loopback-fixture.ts",
) as HealthLoopbackFixtureApi;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function errorFacts(error: unknown): ErrorFacts {
  if (typeof error !== "object" || error === null) {
    return { type: typeof error, name: "unknown" };
  }

  const candidate = error as {
    readonly name?: unknown;
    readonly constructor?: { readonly name?: unknown };
  };
  return {
    type:
      typeof candidate.constructor?.name === "string"
        ? candidate.constructor.name
        : "unknown",
    name: typeof candidate.name === "string" ? candidate.name : "unknown",
  };
}

function recordRejectedFetch(
  request: Promise<Response>,
): Promise<{ readonly rejected: false } | { readonly rejected: true; readonly error: unknown }> {
  return request.then(
    () => ({ rejected: false as const }),
    (error: unknown) => ({ rejected: true as const, error }),
  );
}

async function withFixture<T>(work: (fixture: HealthLoopbackFixture) => Promise<T>): Promise<T> {
  const fixture = await createHealthLoopbackFixture();
  try {
    return await work(fixture);
  } finally {
    await fixture.close();
  }
}

test("200 response exposes deterministic transport facts", async () => {
  await withFixture(async (fixture) => {
    const response = await fetch(fixture.urls.status200);
    const body = await response.text();

    assertEqual(response.status, 200, "unexpected 200 status");
    assertEqual(response.ok, true, "200 response should be ok");
    assertEqual(response.url, fixture.urls.status200, "200 response URL changed");
    assertEqual(
      response.headers.get("content-type"),
      "text/html; charset=utf-8",
      "unexpected 200 content type",
    );
    assertEqual(
      response.headers.get("x-fixture-route"),
      "status-200",
      "unexpected 200 route header",
    );
    assertEqual(
      body,
      "<!doctype html><html><body>fixture-status-200</body></html>",
      "unexpected 200 body",
    );
    assertEqual(fixture.requestCounts.status200, 1, "200 route request count changed");
  });
});

test("manual redirects preserve each hop and default follow reaches the final URL", async () => {
  await withFixture(async (fixture) => {
    const permanent = await fetch(fixture.urls.redirect301, { redirect: "manual" });
    assertEqual(permanent.status, 301, "unexpected 301 status");
    assertEqual(permanent.ok, false, "301 response should not be ok");
    assertEqual(permanent.url, fixture.urls.redirect301, "301 response URL changed");
    assertEqual(
      permanent.headers.get("location"),
      fixture.urls.status200,
      "301 location changed",
    );

    const temporary = await fetch(fixture.urls.redirect302, { redirect: "manual" });
    assertEqual(temporary.status, 302, "unexpected 302 status");
    assertEqual(temporary.ok, false, "302 response should not be ok");
    assertEqual(temporary.url, fixture.urls.redirect302, "302 response URL changed");
    assertEqual(
      temporary.headers.get("location"),
      fixture.urls.status200,
      "302 location changed",
    );

    const followed = await fetch(fixture.urls.redirect302);
    assertEqual(followed.status, 200, "followed response status changed");
    assertEqual(followed.ok, true, "followed response should be ok");
    assertEqual(followed.url, fixture.urls.status200, "followed response URL changed");
    assertEqual(followed.redirected, true, "followed response should record a redirect");

    assertEqual(fixture.requestCounts.redirect301, 1, "301 request count changed");
    assertEqual(fixture.requestCounts.redirect302, 2, "302 request count changed");
    assertEqual(fixture.requestCounts.status200, 1, "followed 200 request count changed");
  });
});

test("HTTP failure responses resolve with exact status and selected headers", async () => {
  await withFixture(async (fixture) => {
    const cases = [
      ["status401", fixture.urls.status401, 401],
      ["status403", fixture.urls.status403, 403],
      ["status404", fixture.urls.status404, 404],
      ["status410", fixture.urls.status410, 410],
      ["status429", fixture.urls.status429, 429],
      ["status503", fixture.urls.status503, 503],
    ] as const;

    for (const [route, url, status] of cases) {
      const response = await fetch(url);
      assertEqual(response.status, status, `${route} status changed`);
      assertEqual(response.ok, false, `${route} response should not be ok`);
      assertEqual(response.url, url, `${route} response URL changed`);
      assertEqual(
        response.headers.get("x-fixture-route"),
        `status-${status}`,
        `${route} route header changed`,
      );
      assertEqual(
        response.headers.get("retry-after"),
        status === 429 ? "7" : null,
        `${route} retry header changed`,
      );
      assertEqual(fixture.requestCounts[route], 1, `${route} request count changed`);
    }
  });
});

test("deliberately aborted pending response exposes its stable error name", async () => {
  await withFixture(async (fixture) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      const result = await recordRejectedFetch(
        fetch(fixture.urls.pending, { signal: controller.signal }),
      );
      assert(result.rejected, "pending response unexpectedly resolved");
      assertEqual(errorFacts(result.error).name, "AbortError", "abort error name changed");
      assertEqual(fixture.requestCounts.pending, 1, "pending route request count changed");
    } finally {
      clearTimeout(timer);
    }
  });
});

test("connection close and malformed HTTP reject with stable top-level error facts", async () => {
  await withFixture(async (fixture) => {
    const connectionClose = await recordRejectedFetch(fetch(fixture.urls.connectionClose));
    assert(connectionClose.rejected, "connection-close response unexpectedly resolved");
    assertDeepEqual(
      errorFacts(connectionClose.error),
      { type: "TypeError", name: "TypeError" },
      "connection-close error facts changed",
    );
    assertEqual(
      fixture.requestCounts.connectionClose,
      1,
      "connection-close route request count changed",
    );

    const malformed = await recordRejectedFetch(fetch(fixture.urls.malformed));
    assert(malformed.rejected, "malformed response unexpectedly resolved");
    assertDeepEqual(
      errorFacts(malformed.error),
      { type: "TypeError", name: "TypeError" },
      "malformed-response error facts changed",
    );
    assertEqual(fixture.requestCounts.malformed, 1, "malformed request count changed");
  });
});

test("all fixture URLs use loopback and cleanup is idempotent", async () => {
  const fixture = await createHealthLoopbackFixture();
  try {
    for (const url of Object.values(fixture.urls)) {
      assertEqual(new URL(url).hostname, "127.0.0.1", "fixture URL left loopback");
    }
  } finally {
    await fixture.close();
  }

  await fixture.close();
});
