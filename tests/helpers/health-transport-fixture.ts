interface FixtureRequest {
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}
interface FixtureResponse {
  writeHead(
    statusCode: number,
    headers?: Readonly<Record<string, string | readonly string[]>>,
  ): void;
  end(body?: string): void;
}
interface FixtureSocket {
  write(data: string): void;
  end(data?: string): void;
  destroy(): void;
  on(event: "close", listener: () => void): this;
}
interface ServerAddress { readonly port: number; }
interface ListenerServer {
  listen(port: number, host: string, callback: () => void): void;
  address(): ServerAddress | string | null;
  close(callback: (error?: Error) => void): void;
  on(event: "connection", listener: (socket: FixtureSocket) => void): this;
}
interface HttpApi {
  createServer(
    handler: (request: FixtureRequest, response: FixtureResponse) => void,
  ): ListenerServer;
}
interface NetApi {
  createServer(handler: (socket: FixtureSocket) => void): ListenerServer;
}
interface ListenerFixture { readonly port: number; close(): Promise<void>; }

declare const require: (specifier: "node:http" | "node:net") => unknown;
declare const module: {
  exports: {
    startHttpFixture: typeof startHttpFixture;
    startTcpFixture: typeof startTcpFixture;
  };
};
const http = require("node:http") as HttpApi;
const net = require("node:net") as NetApi;

function listen(server: ListenerServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Fixture listener has no numeric address");
      }
      resolve(address.port);
    });
  });
}

async function fixture(server: ListenerServer): Promise<ListenerFixture> {
  const sockets = new Set<FixtureSocket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const port = await listen(server);
  let closed = false;
  return {
    port,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    },
  };
}

function startHttpFixture(
  handler: (request: FixtureRequest, response: FixtureResponse) => void,
): Promise<ListenerFixture> {
  return fixture(http.createServer(handler));
}

function startTcpFixture(
  handler: (socket: FixtureSocket) => void,
): Promise<ListenerFixture> {
  return fixture(net.createServer(handler));
}

module.exports = { startHttpFixture, startTcpFixture };
