interface NodeTestApi { test(name: string, callback: () => Promise<void>): void; }
interface RequestSocket { readonly servername?: string; }
interface IncomingRequest {
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly socket: RequestSocket;
}
interface ServerResponse {
  writeHead(statusCode: number, headers?: Readonly<Record<string, string>>): void;
  end(body?: string): void;
}
interface ServerAddress { readonly port: number; }
interface ServerSocket { destroy(): void; on(event: "close", listener: () => void): this; }
interface HttpsServer {
  listen(port: number, host: string, callback: () => void): void;
  address(): ServerAddress | string | null;
  close(callback: (error?: Error) => void): void;
  on(event: "connection", listener: (socket: ServerSocket) => void): this;
}
interface HttpsApi {
  createServer(
    options: { readonly key: Uint8Array; readonly cert: Uint8Array },
    handler: (request: IncomingRequest, response: ServerResponse) => void,
  ): HttpsServer;
}
interface ReadablePipe {
  setEncoding(encoding: "utf8"): void;
  on(event: "data", listener: (chunk: string) => void): this;
}
interface ChildProcess {
  readonly stdout: ReadablePipe;
  readonly stderr: ReadablePipe;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number | null) => void): this;
}
interface ChildProcessApi {
  spawn(
    executable: string,
    args: readonly string[],
    options: { readonly env: Readonly<Record<string, string | undefined>> },
  ): ChildProcess;
}
interface FsApi { readFileSync(path: string): Uint8Array; }
interface PathApi { resolve(...parts: readonly string[]): string; }

declare const require: (specifier: string) => unknown;
declare const process: {
  readonly execPath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  cwd(): string;
};
const { test } = require("node:test") as NodeTestApi;
const https = require("node:https") as HttpsApi;
const { spawn } = require("node:child_process") as ChildProcessApi;
const fs = require("node:fs") as FsApi;
const path = require("node:path") as PathApi;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function listen(server: HttpsServer): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("HTTPS fixture has no numeric address");
    }
    resolve(address.port);
  }));
}

function close(server: HttpsServer, sockets: ReadonlySet<ServerSocket>): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve, reject) => server.close((error) =>
    error === undefined ? resolve() : reject(error)));
}

function runClient(helper: string, port: number, caPath?: string): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper, String(port)], {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: caPath },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("validates controlled HTTPS while preserving Host and SNI", async () => {
  const root = process.cwd();
  const fixtureRoot = path.resolve(root, "tests/fixtures/health-tls");
  const observations: Array<{ readonly host?: string; readonly sni?: string; readonly url?: string }> = [];
  const server = https.createServer({
    key: fs.readFileSync(path.resolve(fixtureRoot, "server-key.pem")),
    cert: fs.readFileSync(path.resolve(fixtureRoot, "server.pem")),
  }, (request, response) => {
    observations.push({
      host: request.headers.host,
      sni: request.socket.servername,
      url: request.url,
    });
    response.writeHead(200, { "content-type": "text/plain", etag: "secure" });
    response.end("trusted");
  });
  const sockets = new Set<ServerSocket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const port = await listen(server);
  try {
    const untrustedChild = await runClient(
      path.resolve(root, "tests/helpers/health-https-client.ts"),
      port,
    );
    assert(untrustedChild.code === 0, `Untrusted HTTPS child failed: ${untrustedChild.stderr}`);
    assert(untrustedChild.stderr === "", `Untrusted HTTPS child wrote stderr: ${untrustedChild.stderr}`);
    const untrusted = JSON.parse(untrustedChild.stdout) as Record<string, unknown>;
    assert(untrusted.ok === false, "Untrusted certificate was accepted");
    assert((untrusted.error as Record<string, unknown>)?.code === "tls_error",
      `Untrusted certificate was misclassified: ${untrustedChild.stdout}`);

    const child = await runClient(
      path.resolve(root, "tests/helpers/health-https-client.ts"),
      port,
      path.resolve(fixtureRoot, "ca.pem"),
    );
    assert(child.code === 0, `HTTPS child failed: ${child.stderr}`);
    assert(child.stderr === "", `HTTPS child wrote stderr: ${child.stderr}`);
    const result = JSON.parse(child.stdout) as Record<string, unknown>;
    assert(result.ok === true, `HTTPS result failed: ${child.stdout}`);
    assert(result.url === `https://health.test:${port}/facts?q=1`, "Response URL changed");
    assert(result.statusCode === 200, "Response status changed");
    assert(result.body === "trusted", "Response body changed");
    assert(JSON.stringify(result.headers) === JSON.stringify([
      { name: "content-type", value: "text/plain" },
      { name: "etag", value: "secure" },
    ]), "Selected headers changed");
    assert(Number.isSafeInteger(result.durationMs) && (result.durationMs as number) >= 0,
      "Response duration changed");
    assert(observations.length === 1, "Transport made more than one request");
    assert(observations[0]?.host === `health.test:${port}`, "Original Host was not preserved");
    assert(observations[0]?.sni === "health.test", "TLS SNI was not preserved");
    assert(observations[0]?.url === "/facts?q=1", "Request path changed");
  } finally {
    await close(server, sockets);
  }
});
