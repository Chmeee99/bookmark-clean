interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

interface NodeAssertApi {
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  strictEqual(actual: unknown, expected: unknown, message?: string): void;
}

type Header = {
  readonly name: string;
  readonly value: string;
};

type Classification = {
  readonly status: string;
  readonly finalUrl?: string;
  readonly httpStatus?: number;
  readonly headers: readonly Header[];
  readonly errorCode?: string;
};

type ClassificationOutcome =
  | { readonly ok: true; readonly value: Classification }
  | { readonly ok: false; readonly error: { readonly code: string } };

interface HealthFactClassificationApi {
  classifyTerminalHealthFact(
    fact: unknown,
    redirects: unknown,
  ): ClassificationOutcome;
}

declare const require: (
  specifier:
    | "node:test"
    | "node:assert/strict"
    | "../../modules/health/health-fact-classification.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const assert = require("node:assert/strict") as NodeAssertApi;
const { classifyTerminalHealthFact } = require(
  "../../modules/health/health-fact-classification.ts",
) as HealthFactClassificationApi;

const BASE_URL = "https://example.test/health";

function response(
  statusCode: number,
  headers: readonly Header[] = [],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    url: BASE_URL,
    statusCode,
    headers,
    durationMs: 17,
    ...extra,
  };
}

function responseFact(
  statusCode: number,
  headers: readonly Header[] = [],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "response",
    value: response(statusCode, headers, extra),
  };
}

function failureFact(
  code: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "failure",
    value: {
      code,
      durationMs: 17,
      ...extra,
    },
  };
}

function hop(statusCode: number, suffix = "next"): Record<string, unknown> {
  return {
    requestedUrl: `https://example.test/${suffix}-from`,
    statusCode,
    location: `/${suffix}`,
    nextUrl: `https://example.test/${suffix}`,
  };
}

function expectFailure(
  result: ClassificationOutcome,
  code: string,
  message: string,
): void {
  assert.strictEqual(result.ok, false, `${message}: expected failure`);
  if (result.ok) {
    return;
  }
  assert.deepEqual(result.error, { code }, `${message}: wrong failure`);
}

function expectClassification(
  fact: unknown,
  redirects: unknown,
  expected: Classification,
  message: string,
): Classification {
  const result = classifyTerminalHealthFact(fact, redirects);
  assert.strictEqual(result.ok, true, `${message}: expected success`);
  if (!result.ok) {
    throw new Error(`${message}: unexpected ${result.error.code}`);
  }
  assert.deepEqual(result.value, expected, `${message}: wrong classification`);
  return result.value;
}

test("classifies every terminal HTTP status mapping", () => {
  const responseMappings: readonly [number, string][] = [
    [200, "healthy"],
    [299, "healthy"],
    [401, "authentication_required"],
    [403, "forbidden"],
    [404, "not_found"],
    [410, "gone"],
    [429, "rate_limited"],
    [500, "server_error"],
    [599, "server_error"],
    [100, "uncertain"],
    [199, "uncertain"],
    [300, "uncertain"],
    [304, "uncertain"],
    [400, "uncertain"],
    [499, "uncertain"],
  ];

  for (const [statusCode, status] of responseMappings) {
    const headers = [{ name: "content-type", value: `status-${statusCode}` }];
    const result = expectClassification(
      responseFact(statusCode, headers),
      [],
      {
        status,
        finalUrl: BASE_URL,
        httpStatus: statusCode,
        headers,
      },
      `HTTP ${statusCode}`,
    );
    assert.strictEqual(
      result.headers,
      headers,
      `HTTP ${statusCode}: validated headers should be preserved by reference`,
    );
  }
});

test("requires redirect walking for every supported redirect status", () => {
  for (const statusCode of [301, 302, 303, 307, 308]) {
    expectFailure(
      classifyTerminalHealthFact(responseFact(statusCode), []),
      "redirect_required",
      `HTTP ${statusCode}`,
    );
  }
});

test("classifies final 2xx responses from exact redirect history", () => {
  const cases: readonly [readonly number[], string][] = [
    [[], "healthy"],
    [[301], "redirect_permanent"],
    [[308, 301], "redirect_permanent"],
    [[302], "redirect_temporary"],
    [[303], "redirect_temporary"],
    [[307], "redirect_temporary"],
    [[301, 302], "redirect_temporary"],
  ];

  for (const [statuses, expectedStatus] of cases) {
    const redirects = statuses.map((statusCode, index) =>
      hop(statusCode, `hop-${index}`),
    );
    expectClassification(
      responseFact(204),
      redirects,
      {
        status: expectedStatus,
        finalUrl: BASE_URL,
        httpStatus: 204,
        headers: [],
      },
      `redirect history ${statuses.join(",") || "empty"}`,
    );
  }
});

test("maps every typed transport failure without diagnostics", () => {
  const cases: readonly [string, string][] = [
    ["unsupported_url", "unsupported_url"],
    ["timeout", "timeout"],
    ["dns_failure", "dns_failure"],
    ["tls_error", "tls_error"],
    ["connection_failure", "uncertain"],
    ["malformed_response", "uncertain"],
    ["unknown_transport", "uncertain"],
  ];

  for (const [code, status] of cases) {
    const result = expectClassification(
      failureFact(code),
      [],
      {
        status,
        headers: [],
        errorCode: code,
      },
      `transport failure ${code}`,
    );
    assert.deepEqual(
      Object.keys(result).sort(),
      ["errorCode", "headers", "status"].sort(),
      `transport failure ${code}: unexpected output keys`,
    );
  }
});

test("body bytes and header values remain evidence rather than meaning", () => {
  const firstHeaders = [{ name: "content-type", value: "looks-like-error" }];
  const secondHeaders = [{ name: "content-type", value: "looks-like-success" }];
  const first = responseFact(200, firstHeaders, {
    body: new Uint8Array([0, 1, 2]),
  });
  const second = responseFact(200, secondHeaders, {
    body: new Uint8Array([255, 254, 253]),
  });

  const firstResult = expectClassification(
    first,
    [],
    {
      status: "healthy",
      finalUrl: BASE_URL,
      httpStatus: 200,
      headers: firstHeaders,
    },
    "first evidence",
  );
  const secondResult = expectClassification(
    second,
    [],
    {
      status: "healthy",
      finalUrl: BASE_URL,
      httpStatus: 200,
      headers: secondHeaders,
    },
    "second evidence",
  );
  assert.strictEqual(firstResult.status, secondResult.status);
});

test("rejects malformed facts, arrays, headers, bodies, and hops exactly", () => {
  const validFact = responseFact(200);
  const malformedFacts: readonly [unknown, string][] = [
    [{ ...validFact, extra: true }, "extra fact key"],
    [Object.assign({ ...validFact }, { [Symbol("extra")]: true }), "symbol fact key"],
    [{ ...validFact, kind: "other" }, "unsupported fact discriminant"],
    [
      { kind: "response", value: { ...response(200), extra: true } },
      "extra response key",
    ],
    [{ kind: "response", value: { ...response(99) } }, "status below range"],
    [{ kind: "response", value: { ...response(600) } }, "status above range"],
    [{ kind: "response", value: { ...response(200.5) } }, "fractional status"],
    [{ kind: "response", value: { ...response(200), durationMs: -1 } }, "negative duration"],
    [
      { kind: "response", value: { ...response(200), durationMs: Number.MAX_SAFE_INTEGER + 1 } },
      "unsafe duration",
    ],
    [
      { kind: "response", value: { ...response(200), body: "body prose" } },
      "wrong body type",
    ],
    [{ kind: "response", value: { ...response(200), body: undefined } }, "undefined body"],
    [
      { kind: "response", value: { ...response(200), headers: [{ name: "content-type", value: "" }] } },
      "empty header value",
    ],
    [
      { kind: "response", value: { ...response(200), headers: [{ name: "content-type", value: "one" }, { name: "content-type", value: "two" }] } },
      "duplicate header name",
    ],
    [
      { kind: "response", value: { ...response(200), headers: [{ name: "x-unknown", value: "value" }] } },
      "unsupported header name",
    ],
    [
      { kind: "response", value: { ...response(200), headers: Object.assign([], { extra: true }) } },
      "extra array key",
    ],
    [
      { kind: "response", value: { ...response(200), headers: new Array(1) } },
      "sparse header array",
    ],
    [
      { kind: "failure", value: { code: "not-a-failure", durationMs: 17 } },
      "unsupported failure code",
    ],
    [
      { kind: "failure", value: { code: "timeout", durationMs: 17, extra: true } },
      "extra failure key",
    ],
    [
      { kind: "failure", value: { code: "timeout", durationMs: Number.NaN } },
      "non-finite failure duration",
    ],
  ];

  for (const [fact, message] of malformedFacts) {
    expectFailure(
      classifyTerminalHealthFact(fact, []),
      "invalid_fact",
      message,
    );
  }

  const malformedRedirects: readonly [unknown, string][] = [
    [new Array(1), "sparse redirect array"],
    [[{ ...hop(306) }], "unsupported redirect status"],
    [[{ ...hop(301), requestedUrl: "" }], "empty requested URL"],
    [[{ ...hop(301), location: "" }], "empty location"],
    [[{ ...hop(301), nextUrl: "" }], "empty next URL"],
    [[{ ...hop(301), extra: true }], "extra redirect key"],
    [
      [Object.assign({ ...hop(301) }, { [Symbol("extra")]: true })],
      "symbol redirect key",
    ],
  ];

  for (const [redirects, message] of malformedRedirects) {
    expectFailure(
      classifyTerminalHealthFact(validFact, redirects),
      "invalid_fact",
      message,
    );
  }
});

test("does not mutate facts or redirect history while validating", () => {
  const headers = [{ name: "etag", value: "opaque" }];
  const redirects = [hop(301)];
  const fact = responseFact(200, headers, { body: new Uint8Array([1, 2, 3]) });
  const factBefore = JSON.stringify(fact);
  const redirectsBefore = JSON.stringify(redirects);

  expectClassification(
    fact,
    redirects,
    {
      status: "redirect_permanent",
      finalUrl: BASE_URL,
      httpStatus: 200,
      headers,
    },
    "immutable validation",
  );

  assert.strictEqual(JSON.stringify(fact), factBefore, "fact was mutated");
  assert.strictEqual(
    JSON.stringify(redirects),
    redirectsBefore,
    "redirect history was mutated",
  );
});
