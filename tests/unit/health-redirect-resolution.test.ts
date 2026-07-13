interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

interface NodeAssertApi {
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  strictEqual(actual: unknown, expected: unknown, message?: string): void;
}

type RedirectOutcome =
  | {
      readonly ok: true;
      readonly value: {
        readonly requestedUrl: string;
        readonly statusCode: number;
        readonly location: string;
        readonly nextUrl: string;
      };
    }
  | { readonly ok: false; readonly error: { readonly code: string } };

interface HealthRedirectResolutionApi {
  resolveHealthRedirect(currentUrl: unknown, response: unknown): RedirectOutcome;
}

declare const require: (
  specifier:
    | "node:test"
    | "node:assert/strict"
    | "../../modules/health/health-fact-classification.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const assert = require("node:assert/strict") as NodeAssertApi;
const { resolveHealthRedirect } = require(
  "../../modules/health/health-fact-classification.ts",
) as HealthRedirectResolutionApi;

const CURRENT_URL = "https://example.test/old/page";

function redirectResponse(
  statusCode: number,
  location?: string,
  headers: readonly Record<string, unknown>[] = [],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    url: CURRENT_URL,
    statusCode,
    headers:
      location === undefined
        ? headers
        : [...headers, { name: "location", value: location }],
    durationMs: 4,
    ...extra,
  };
}

function expectFailure(response: unknown, currentUrl: unknown, code: string, message: string): void {
  const result = resolveHealthRedirect(currentUrl, response);
  assert.strictEqual(result.ok, false, `${message}: expected failure`);
  if (result.ok) {
    return;
  }
  assert.deepEqual(result.error, { code }, `${message}: wrong failure`);
}

test("resolves relative and absolute locations for every redirect status", () => {
  for (const statusCode of [301, 302, 303, 307, 308]) {
    const relativeLocation = "../new?from=redirect";
    const relative = resolveHealthRedirect(
      CURRENT_URL,
      redirectResponse(statusCode, relativeLocation),
    );
    assert.strictEqual(relative.ok, true, `HTTP ${statusCode}: relative failed`);
    if (relative.ok) {
      assert.deepEqual(relative.value, {
        requestedUrl: CURRENT_URL,
        statusCode,
        location: relativeLocation,
        nextUrl: "https://example.test/new?from=redirect",
      });
    }

    const absoluteLocation = "https://other.example/final";
    const absolute = resolveHealthRedirect(
      CURRENT_URL,
      redirectResponse(statusCode, absoluteLocation),
    );
    assert.strictEqual(absolute.ok, true, `HTTP ${statusCode}: absolute failed`);
    if (absolute.ok) {
      assert.deepEqual(absolute.value, {
        requestedUrl: CURRENT_URL,
        statusCode,
        location: absoluteLocation,
        nextUrl: absoluteLocation,
      });
    }
  }
});

test("preserves the original URL and Location evidence", () => {
  const response = redirectResponse(302, "/next", [
    { name: "content-type", value: "text/html" },
  ]);
  const before = JSON.stringify(response);
  const result = resolveHealthRedirect(CURRENT_URL, response);

  assert.strictEqual(result.ok, true, "Expected redirect resolution success");
  if (result.ok) {
    assert.strictEqual(result.value.requestedUrl, CURRENT_URL);
    assert.strictEqual(result.value.location, "/next");
  }
  assert.strictEqual(JSON.stringify(response), before, "response was mutated");
});

test("rejects redirect-specific invalid inputs with invalid_redirect", () => {
  const cases: readonly [unknown, unknown, string][] = [
    [redirectResponse(302), CURRENT_URL, "missing location"],
    [
      redirectResponse(302, "/one", [{ name: "location", value: "/two" }]),
      CURRENT_URL,
      "duplicate location",
    ],
    [redirectResponse(302, ""), CURRENT_URL, "empty location"],
    [redirectResponse(302, "http://[bad"), CURRENT_URL, "unparseable location"],
    [redirectResponse(200, "/next"), CURRENT_URL, "non-redirect response"],
    [redirectResponse(302, "/next"), "", "empty current URL"],
    [redirectResponse(302, "/next"), "/relative", "relative current URL"],
    [redirectResponse(302, "/next"), "not a URL", "invalid current URL"],
  ];

  for (const [response, currentUrl, message] of cases) {
    expectFailure(response, currentUrl, "invalid_redirect", message);
  }
});

test("keeps malformed response facts as invalid_fact", () => {
  expectFailure(
    redirectResponse(302, "/next", [], { extra: true }),
    CURRENT_URL,
    "invalid_fact",
    "extra response key",
  );
  expectFailure(
    redirectResponse(302, "/next", [
      { name: "content-type", value: "" },
    ]),
    CURRENT_URL,
    "invalid_fact",
    "empty non-location header",
  );
  expectFailure(
    redirectResponse(302, "/next", [
      { name: "x-unknown", value: "value" },
    ]),
    CURRENT_URL,
    "invalid_fact",
    "unsupported header",
  );
});
