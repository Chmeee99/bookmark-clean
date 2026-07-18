// test-capability: loopback-listener
import type {
  HealthTransport,
  HealthTransportRequest,
} from "../../modules/health/public.js";

interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }
interface FixtureRequest { readonly url?: string; readonly headers: Readonly<Record<string, string | undefined>>; }
interface FixtureResponse {
  writeHead(
    statusCode: number,
    headers?: Readonly<Record<string, string | readonly string[]>>,
  ): void;
  write(body: string): boolean;
  end(body?: string): void;
  on(event: "close", listener: () => void): this;
}
interface FixtureSocket { end(data?: string): void; destroy(): void; }
interface ListenerFixture { readonly port: number; close(): Promise<void>; }
interface FixtureApi {
  startHttpFixture(
    handler: (request: FixtureRequest, response: FixtureResponse) => void,
  ): Promise<ListenerFixture>;
  startTcpFixture(handler: (socket: FixtureSocket) => void): Promise<ListenerFixture>;
}
interface AddressRecord { readonly address: string; readonly family: 4 | 6; }
interface Resolver {
  resolve(url: string): Promise<unknown>;
}
interface ResolverApi {
  createHealthRequestTargetResolver(options?: {
    readonly lookup?: (hostname: string) => Promise<readonly AddressRecord[]>;
    readonly allowLoopback?: boolean;
  }): Resolver;
}
interface TransportApi {
  createNodeHealthTransport(options?: { readonly resolver?: Resolver }): HealthTransport;
}

declare const require: (specifier: string) => unknown;
const load = require as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const { startHttpFixture, startTcpFixture } = load(
  "../helpers/health-transport-fixture.ts",
) as FixtureApi;
const { createHealthRequestTargetResolver } = load(
  "../../adapters/node/health-request-target-resolver.ts",
) as ResolverApi;
const { createNodeHealthTransport } = load(
  "../../adapters/node/health-transport.ts",
) as TransportApi;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function request(url: string, overrides: Partial<HealthTransportRequest> = {}): HealthTransportRequest {
  return {
    url,
    method: "GET",
    redirect: "manual",
    timeoutMs: 100,
    maxBodyBytes: 16,
    ...overrides,
  };
}
function loopbackTransport(): HealthTransport {
  return createNodeHealthTransport({
    resolver: createHealthRequestTargetResolver({ allowLoopback: true }),
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function delayedTargetResolver(port: number, delayMs: number): Resolver {
  return {
    async resolve(url) {
      await wait(delayMs);
      return {
        ok: true,
        value: {
          url,
          protocol: "http:",
          address: "127.0.0.1",
          family: 4,
          hostname: "localhost",
          port,
          path: "/deadline",
          hostHeader: `localhost:${port}`,
        },
      };
    },
  };
}

test("times out target resolution and ignores its late approved target", async () => {
  let requests = 0;
  const fixture = await startHttpFixture((_incoming, response) => {
    requests += 1;
    response.writeHead(200);
    response.end("too late");
  });
  try {
    const transport = createNodeHealthTransport({
      resolver: delayedTargetResolver(fixture.port, 80),
    });
    const result = await transport.request(request(
      `http://localhost:${fixture.port}/deadline`,
      { timeoutMs: 20 },
    ));
    assert(!result.ok && result.error.code === "timeout", "Slow resolution did not time out");
    await wait(100);
    assert(requests === 0, "Late resolution started a request");
  } finally { await fixture.close(); }
});

test("socket exchange receives only the deadline remaining after resolution", async () => {
  let requests = 0;
  const fixture = await startHttpFixture((_incoming, response) => {
    requests += 1;
    setTimeout(() => {
      response.writeHead(200);
      response.end("after total deadline");
    }, 120);
  });
  try {
    const transport = createNodeHealthTransport({
      resolver: delayedTargetResolver(fixture.port, 120),
    });
    const result = await transport.request(request(
      `http://localhost:${fixture.port}/deadline`,
      { timeoutMs: 200 },
    ));
    assert(!result.ok && result.error.code === "timeout", "Socket timeout reset after resolution");
    assert(requests === 1, "Resolved target did not start exactly one request");
  } finally { await fixture.close(); }
});

test("enforces one absolute deadline while the response remains active", async () => {
  const fixture = await startHttpFixture((_incoming, response) => {
    response.writeHead(200);
    let writes = 0;
    const interval = setInterval(() => {
      response.write("x");
      writes += 1;
      if (writes === 12) {
        clearInterval(interval);
        response.end();
      }
    }, 20);
    response.on("close", () => clearInterval(interval));
  });
  try {
    const startedAt = performance.now();
    const result = await loopbackTransport().request(request(
      `http://127.0.0.1:${fixture.port}/slow-drip`,
      { timeoutMs: 80 },
    ));
    const elapsedMs = performance.now() - startedAt;
    assert(!result.ok && result.error.code === "timeout", "Active response escaped total deadline");
    assert(result.error.durationMs < 200, "Reported timeout exceeded total deadline tolerance");
    assert(elapsedMs < 200, "Wall time exceeded total deadline tolerance");
  } finally { await fixture.close(); }
});

test("returns selected response facts through one pinned request", async () => {
  const seen: Array<{ readonly url?: string; readonly host?: string }> = [];
  const fixture = await startHttpFixture((incoming, response) => {
    seen.push({ url: incoming.url, host: incoming.headers.host });
    response.writeHead(200, {
      "content-type": "text/plain",
      etag: "fixed",
      server: "must-not-leak",
    });
    response.end("ok");
  });
  try {
    const url = `http://localhost:${fixture.port}/facts?q=1`;
    const result = await loopbackTransport().request(request(url));
    assert(result.ok, "Pinned request failed");
    assert(result.value.url === url, "Response URL changed");
    assert(result.value.statusCode === 200, "Status changed");
    assert(JSON.stringify(result.value.headers) === JSON.stringify([
      { name: "content-type", value: "text/plain" },
      { name: "etag", value: "fixed" },
    ]), "Selected headers changed");
    assert(new TextDecoder().decode(result.value.body) === "ok", "Body changed");
    assert(Number.isSafeInteger(result.value.durationMs) && result.value.durationMs >= 0, "Duration changed");
    assert(seen.length === 1, "Transport made more than one request");
    assert(seen[0].url === "/facts?q=1", "Request path changed");
    assert(seen[0].host === `localhost:${fixture.port}`, "Original Host was not preserved");
  } finally { await fixture.close(); }
});

test("returns redirects without following and rejects duplicate selected headers", async () => {
  let requests = 0;
  const fixture = await startHttpFixture((_incoming, response) => {
    requests += 1;
    response.writeHead(302, { location: "/next" });
    response.end();
  });
  try {
    const result = await loopbackTransport().request(request(`http://127.0.0.1:${fixture.port}/start`));
    assert(result.ok && result.value.statusCode === 302, "Redirect fact changed");
    assert(result.ok && result.value.headers[0]?.name === "location", "Location was not selected");
    assert(requests === 1, "Transport followed the redirect");
  } finally { await fixture.close(); }

  const duplicate = await startHttpFixture((_incoming, response) => {
    response.writeHead(200, { etag: ["one", "two"] });
    response.end();
  });
  try {
    const result = await loopbackTransport().request(request(`http://127.0.0.1:${duplicate.port}`));
    assert(!result.ok && result.error.code === "malformed_response", "Duplicate header was accepted");
  } finally { await duplicate.close(); }
});

test("drops oversized bytes and maps the timeout event", async () => {
  const oversized = await startHttpFixture((_incoming, response) => {
    response.writeHead(200);
    response.end("abcdefgh");
  });
  try {
    const result = await loopbackTransport().request(request(
      `http://127.0.0.1:${oversized.port}`,
      { maxBodyBytes: 4 },
    ));
    assert(result.ok && result.value.body === undefined, "Partial oversized body leaked");
  } finally { await oversized.close(); }

  const delayed = await startHttpFixture(() => {});
  try {
    const result = await loopbackTransport().request(request(
      `http://127.0.0.1:${delayed.port}`,
      { timeoutMs: 20 },
    ));
    assert(!result.ok && result.error.code === "timeout", "Timeout event mapping changed");
  } finally { await delayed.close(); }
});

test("maps controlled connection parser and TLS codes", async () => {
  const reset = await startTcpFixture((socket) => socket.destroy());
  try {
    const result = await loopbackTransport().request(request(`http://127.0.0.1:${reset.port}`));
    assert(!result.ok && result.error.code === "connection_failure", "Reset mapping changed");
  } finally { await reset.close(); }

  const malformed = await startTcpFixture((socket) => socket.end("NOT HTTP\r\n\r\n"));
  try {
    const result = await loopbackTransport().request(request(`http://127.0.0.1:${malformed.port}`));
    assert(!result.ok && result.error.code === "malformed_response", "Parser mapping changed");
  } finally { await malformed.close(); }

  const plain = await startTcpFixture((socket) => socket.end("plain text"));
  try {
    const result = await loopbackTransport().request(request(`https://localhost:${plain.port}`));
    assert(
      !result.ok && result.error.code === "tls_error",
      `TLS mapping changed: ${JSON.stringify(result)}`,
    );
  } finally { await plain.close(); }
});

test("resolver rejection returns unsupported_url without transport fallback", async () => {
  const transport = createNodeHealthTransport({ resolver: {
    async resolve() { return { ok: false, error: { code: "unsupported_url" } }; },
  } });
  const result = await transport.request(request("http://10.0.0.1/private"));
  assert(!result.ok && result.error.code === "unsupported_url", "Rejected target mapping changed");
  assert(result.error.durationMs === 0, "Rejected target duration changed");

  const malformed = createNodeHealthTransport({ resolver: {
    async resolve() { return { ok: true, value: { address: "10.0.0.1" } }; },
  } });
  const malformedResult = await malformed.request(request("http://example.com"));
  assert(
    !malformedResult.ok && malformedResult.error.code === "unsupported_url",
    "Malformed approved target reached request execution",
  );
});

test("propagates structured resolver facts and contains thrown resolver failures", async () => {
  for (const code of ["dns_failure", "unknown_transport"] as const) {
    const transport = createNodeHealthTransport({ resolver: {
      async resolve() { return { ok: false, error: { code } }; },
    } });
    const result = await transport.request(request("http://example.com"));
    assert(!result.ok && result.error.code === code, `${code} resolver fact was discarded`);
  }

  const thrown = createNodeHealthTransport({ resolver: {
    async resolve(): Promise<never> { throw new Error("unsupported_url in non-semantic prose"); },
  } });
  const result = await thrown.request(request("http://example.com"));
  assert(!result.ok && result.error.code === "unknown_transport",
    "Thrown resolver prose acquired URL semantics");
});
