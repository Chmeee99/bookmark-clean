interface NodeTestApi {
  test(name: string, callback: () => void): void;
}

interface Classification {
  readonly status: string;
  readonly errorCode?: string;
}

interface ClassifierModule {
  classifyHealthFact(fact: unknown): Classification;
}

declare const require: (
  specifier: "node:test" | "../../modules/health/health-fact-classifier.ts",
) => unknown;

const { test } = require("node:test") as NodeTestApi;
const { classifyHealthFact } = require(
  "../../modules/health/health-fact-classifier.ts"
) as ClassifierModule;

function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const permanentHop = {
  requestedUrl: "https://start.example",
  statusCode: 301,
  location: "/next",
  nextUrl: "https://start.example/next",
} as const;
const temporaryHop = { ...permanentHop, statusCode: 307 as const };

test("classifies successful final responses from typed redirect hops", () => {
  equal(classifyHealthFact({ kind: "response", statusCode: 204, redirects: [] }), {
    status: "healthy",
  });
  equal(classifyHealthFact({
    kind: "response",
    statusCode: 200,
    redirects: [permanentHop, { ...permanentHop, statusCode: 308 }],
  }), { status: "redirect_permanent" });
  for (const statusCode of [302, 303, 307] as const) {
    equal(classifyHealthFact({
      kind: "response",
      statusCode: 299,
      redirects: [permanentHop, { ...temporaryHop, statusCode }],
    }), { status: "redirect_temporary" });
  }
});

test("maps every fixed HTTP status without redirect precedence", () => {
  const cases = [
    [401, "authentication_required"],
    [403, "forbidden"],
    [404, "not_found"],
    [410, "gone"],
    [429, "rate_limited"],
    [500, "server_error"],
    [599, "server_error"],
    [300, "uncertain"],
    [400, "uncertain"],
    [600, "uncertain"],
  ] as const;
  for (const [statusCode, status] of cases) {
    equal(classifyHealthFact({
      kind: "response",
      statusCode,
      redirects: [temporaryHop],
    }), { status });
  }
});

test("maps every closed transport failure and preserves its error code", () => {
  const cases = [
    ["unsupported_url", "unsupported_url"],
    ["timeout", "timeout"],
    ["dns_failure", "dns_failure"],
    ["tls_error", "tls_error"],
    ["connection_failure", "uncertain"],
    ["malformed_response", "uncertain"],
    ["unknown_transport", "uncertain"],
  ] as const;
  for (const [code, status] of cases) {
    equal(classifyHealthFact({ kind: "failure", code }), {
      status,
      errorCode: code,
    });
  }
});

test("returns fresh results and never emits page-suspicion status", () => {
  const fact = { kind: "response", statusCode: 200, redirects: [] };
  const first = classifyHealthFact(fact);
  const second = classifyHealthFact(fact);
  if (first === second) throw new Error("Classifier reused a result object");
  for (const statusCode of [200, 401, 403, 404, 410, 429, 500]) {
    const { status } = classifyHealthFact({ kind: "response", statusCode, redirects: [] });
    if (status === "soft_404_suspected" || status === "parked_domain_suspected") {
      throw new Error(`Classifier invented page meaning for ${statusCode}`);
    }
  }
});
