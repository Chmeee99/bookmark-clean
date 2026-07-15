interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }
interface NodeError extends Error { code?: string; }
interface IncomingMessage {
  readonly statusCode?: number;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  on(event: "data", listener: (chunk: Uint8Array) => void): this;
  on(event: "end", listener: () => void): this;
}
interface ClientRequest {
  on(event: "error", listener: (error: NodeError) => void): this;
  setTimeout(milliseconds: number, listener: () => void): this;
  end(): void;
  destroy(): void;
}
interface HttpApi {
  request(options: unknown, callback?: (response: IncomingMessage) => void): ClientRequest;
}
interface TlsSocket {
  on(event: "error", listener: (error: NodeError) => void): this;
  on(event: "secureConnect", listener: () => void): this;
  destroy(): void;
}
interface TlsApi { connect(options: unknown): TlsSocket; }
interface FixtureRequest { readonly url?: string; readonly headers: Readonly<Record<string, string | undefined>>; }
interface FixtureResponse {
  writeHead(statusCode: number, headers?: Readonly<Record<string, string>>): void;
  end(body?: string): void;
}
interface FixtureSocket { write(data: string): void; end(data?: string): void; destroy(): void; }
interface ListenerFixture { readonly port: number; close(): Promise<void>; }
interface FixtureApi {
  startHttpFixture(
    handler: (request: FixtureRequest, response: FixtureResponse) => void,
  ): Promise<ListenerFixture>;
  startTcpFixture(handler: (socket: FixtureSocket) => void): Promise<ListenerFixture>;
}

declare const require: (specifier: string) => unknown;
const load = require as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const http = load("node:http") as HttpApi;
const tls = load("node:tls") as TlsApi;
const { startHttpFixture, startTcpFixture } = load(
  "../helpers/health-transport-fixture.ts",
) as FixtureApi;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function responseEvidence(options: unknown, cap = Number.MAX_SAFE_INTEGER): Promise<{
  readonly statusCode: number | undefined;
  readonly headers: IncomingMessage["headers"];
  readonly body: Uint8Array;
  readonly exceeded: boolean;
}> {
  return new Promise((resolve, reject) => {
    const request = http.request(options, (response) => {
      const bytes: number[] = [];
      let exceeded = false;
      response.on("data", (chunk) => {
        for (const byte of chunk) {
          if (bytes.length < cap) bytes.push(byte);
          else exceeded = true;
        }
      });
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: new Uint8Array(bytes),
        exceeded,
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

function requestError(options: unknown): Promise<NodeError> {
  return new Promise((resolve) => {
    const request = http.request(options);
    request.on("error", resolve);
    request.end();
  });
}

test("records response redirect body-cap and pinned Host evidence", async () => {
  const hosts: string[] = [];
  const fixture = await startHttpFixture((request, response) => {
    hosts.push(request.headers.host ?? "");
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/final" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("abcdefgh");
  });
  try {
    const redirect = await responseEvidence({
      hostname: "127.0.0.1", port: fixture.port, path: "/redirect",
      headers: { host: "original.example" },
    });
    assert(redirect.statusCode === 302, "Client followed the redirect");
    assert(redirect.headers.location === "/final", "Location evidence changed");
    const bounded = await responseEvidence({
      hostname: "127.0.0.1", port: fixture.port, path: "/body",
      headers: { host: "original.example" },
    }, 4);
    assert(new TextDecoder().decode(bounded.body) === "abcd", "Body cap changed");
    assert(bounded.exceeded, "Oversized body was not observed");
    assert(hosts.length === 2 && hosts.every((host) => host === "original.example"), "Host was not preserved");
  } finally {
    await fixture.close();
    await fixture.close();
  }
});

test("records timeout and injected DNS facts without public network", async () => {
  const fixture = await startHttpFixture(() => {});
  try {
    const timedOut = await new Promise<boolean>((resolve) => {
      const request = http.request({ hostname: "127.0.0.1", port: fixture.port });
      request.setTimeout(20, () => { request.destroy(); resolve(true); });
      request.on("error", () => {});
      request.end();
    });
    assert(timedOut, "Request timeout event did not fire");
  } finally {
    await fixture.close();
  }

  const dns = await requestError({
    hostname: "fixture.invalid",
    lookup(_hostname: string, _options: unknown, callback: (error: NodeError) => void) {
      const error = new Error("opaque DNS prose") as NodeError;
      error.code = "ENOTFOUND";
      callback(error);
    },
  });
  assert(dns.code === "ENOTFOUND", "Structured DNS code changed");
});

test("records connection malformed-response and TLS error codes", async () => {
  const closed = await startTcpFixture(() => {});
  const refusedPort = closed.port;
  await closed.close();
  const refused = await requestError({ hostname: "127.0.0.1", port: refusedPort });
  assert(refused.code === "ECONNREFUSED", `Unexpected refusal code ${refused.code}`);

  const resetFixture = await startTcpFixture((socket) => socket.destroy());
  try {
    const reset = await requestError({ hostname: "127.0.0.1", port: resetFixture.port });
    assert(reset.code === "ECONNRESET", `Unexpected reset code ${reset.code}`);
  } finally { await resetFixture.close(); }

  const malformedFixture = await startTcpFixture((socket) => {
    socket.end("NOT HTTP\r\n\r\n");
  });
  try {
    const malformed = await requestError({ hostname: "127.0.0.1", port: malformedFixture.port });
    assert(malformed.code?.startsWith("HPE_") === true, `Unexpected parser code ${malformed.code}`);
  } finally { await malformedFixture.close(); }

  const tlsFixture = await startTcpFixture((socket) => socket.end("plain text"));
  try {
    const tlsError = await new Promise<NodeError>((resolve, reject) => {
      const socket = tls.connect({
        host: "127.0.0.1", port: tlsFixture.port,
        servername: "original.example", rejectUnauthorized: false,
      });
      socket.on("error", resolve);
      socket.on("secureConnect", () => { socket.destroy(); reject(new Error("Unexpected TLS connection")); });
    });
    assert(tlsError.code?.startsWith("ERR_SSL_") === true, `Unexpected TLS code ${tlsError.code}`);
  } finally { await tlsFixture.close(); }
});
