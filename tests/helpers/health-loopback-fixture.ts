interface FixtureSocket {
  destroy(): void;
  end(data?: string): void;
  once(event: "close", listener: () => void): FixtureSocket;
}

interface HttpRequest {
  readonly url?: string;
  readonly socket: FixtureSocket;
}

interface HttpResponse {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body?: string): void;
}

interface LoopbackServer {
  on(event: "connection", listener: (socket: FixtureSocket) => void): LoopbackServer;
  once(event: "error", listener: (error: unknown) => void): LoopbackServer;
  listen(port: number, host: string, callback: () => void): LoopbackServer;
  address(): { readonly address: string; readonly port: number } | null;
  close(callback: (error?: unknown) => void): void;
}

interface HttpApi {
  createServer(handler: (request: HttpRequest, response: HttpResponse) => void): LoopbackServer;
}

interface NetApi {
  createServer(listener: (socket: FixtureSocket) => void): LoopbackServer;
}

const { createServer: createHttpServer } = require("node:http") as HttpApi;
const { createServer: createTcpServer } = require("node:net") as NetApi;

const ROUTE_PATHS = {
  status200: "/status-200",
  redirect301: "/redirect-301",
  redirect302: "/redirect-302",
  status401: "/status-401",
  status403: "/status-403",
  status404: "/status-404",
  status410: "/status-410",
  status429: "/status-429",
  status503: "/status-503",
  connectionClose: "/connection-close",
  pending: "/pending",
} as const;

type HttpRoute = keyof typeof ROUTE_PATHS;
type FixtureRoute = HttpRoute | "malformed";

export interface HealthLoopbackFixture {
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
  readonly requestCounts: Readonly<Record<FixtureRoute, number>>;
  close(): Promise<void>;
}

interface FixtureServers {
  readonly http: LoopbackServer;
  readonly malformed: LoopbackServer;
  readonly httpSockets: Set<FixtureSocket>;
  readonly malformedSockets: Set<FixtureSocket>;
  httpListening: boolean;
  malformedListening: boolean;
}

function initializeRequestCounts(): Record<FixtureRoute, number> {
  return {
    status200: 0,
    redirect301: 0,
    redirect302: 0,
    status401: 0,
    status403: 0,
    status404: 0,
    status410: 0,
    status429: 0,
    status503: 0,
    connectionClose: 0,
    pending: 0,
    malformed: 0,
  };
}

function routeForPath(path: string): HttpRoute | undefined {
  for (const route of Object.keys(ROUTE_PATHS) as HttpRoute[]) {
    if (ROUTE_PATHS[route] === path) {
      return route;
    }
  }
  return undefined;
}

function trackSockets(server: LoopbackServer, sockets: Set<FixtureSocket>): void {
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
}

function listenOnLoopback(server: LoopbackServer): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    server.once("error", (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || address.port === 0) {
        if (!settled) {
          settled = true;
          reject(new Error("Loopback fixture did not receive an ephemeral port"));
        }
        return;
      }
      settled = true;
      resolve(address.port);
    });
  });
}

function closeServer(
  server: LoopbackServer,
  sockets: Set<FixtureSocket>,
  listening: boolean,
): Promise<void> {
  if (!listening) {
    for (const socket of sockets) {
      socket.destroy();
    }
    return Promise.resolve();
  }

  const closed = new Promise<void>((resolve, reject) => {
    server.close((error?: unknown) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  for (const socket of sockets) {
    socket.destroy();
  }
  return closed;
}

function createHttpHandler(
  requestCounts: Record<FixtureRoute, number>,
  healthyUrl: () => string,
): (request: HttpRequest, response: HttpResponse) => void {
  return (request, response) => {
    const path = (request.url ?? "/").split("?", 1)[0] ?? "/";
    const route = routeForPath(path);

    if (route === undefined) {
      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8",
        "x-fixture-route": "unknown",
      });
      response.end("fixture-status-404");
      return;
    }

    requestCounts[route] += 1;

    if (route === "pending") {
      return;
    }

    if (route === "connectionClose") {
      request.socket.destroy();
      return;
    }

    if (route === "status200") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "x-fixture-route": "status-200",
      });
      response.end("<!doctype html><html><body>fixture-status-200</body></html>");
      return;
    }

    if (route === "redirect301" || route === "redirect302") {
      response.writeHead(route === "redirect301" ? 301 : 302, {
        "content-type": "text/plain; charset=utf-8",
        location: healthyUrl(),
        "x-fixture-route": route === "redirect301" ? "redirect-301" : "redirect-302",
      });
      response.end(`fixture-${route}`);
      return;
    }

    const status = Number(route.slice("status".length));
    response.writeHead(status, {
      "content-type": "text/plain; charset=utf-8",
      ...(status === 429 ? { "retry-after": "7" } : {}),
      "x-fixture-route": `status-${status}`,
    });
    response.end(`fixture-status-${status}`);
  };
}

async function createHealthLoopbackFixture(): Promise<HealthLoopbackFixture> {
  const requestCounts = initializeRequestCounts();
  const httpSockets = new Set<FixtureSocket>();
  const malformedSockets = new Set<FixtureSocket>();
  let healthyUrl = "";
  const httpServer = createHttpServer(createHttpHandler(requestCounts, () => healthyUrl));
  const malformedServer = createTcpServer((socket) => {
    requestCounts.malformed += 1;
    socket.end("HTTP/1.1 200 OK\r\nContent-Length: nope\r\n\r\n");
  });
  const servers: FixtureServers = {
    http: httpServer,
    malformed: malformedServer,
    httpSockets,
    malformedSockets,
    httpListening: false,
    malformedListening: false,
  };
  trackSockets(httpServer, httpSockets);
  trackSockets(malformedServer, malformedSockets);

  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= Promise.all([
      closeServer(servers.http, servers.httpSockets, servers.httpListening),
      closeServer(servers.malformed, servers.malformedSockets, servers.malformedListening),
    ]).then(() => undefined);
    return closePromise;
  };

  try {
    const httpPort = await listenOnLoopback(httpServer);
    servers.httpListening = true;
    const malformedPort = await listenOnLoopback(malformedServer);
    servers.malformedListening = true;
    const httpBaseUrl = `http://127.0.0.1:${httpPort}`;
    healthyUrl = `${httpBaseUrl}${ROUTE_PATHS.status200}`;
    return {
      urls: {
        status200: `${httpBaseUrl}${ROUTE_PATHS.status200}`,
        redirect301: `${httpBaseUrl}${ROUTE_PATHS.redirect301}`,
        redirect302: `${httpBaseUrl}${ROUTE_PATHS.redirect302}`,
        status401: `${httpBaseUrl}${ROUTE_PATHS.status401}`,
        status403: `${httpBaseUrl}${ROUTE_PATHS.status403}`,
        status404: `${httpBaseUrl}${ROUTE_PATHS.status404}`,
        status410: `${httpBaseUrl}${ROUTE_PATHS.status410}`,
        status429: `${httpBaseUrl}${ROUTE_PATHS.status429}`,
        status503: `${httpBaseUrl}${ROUTE_PATHS.status503}`,
        connectionClose: `${httpBaseUrl}${ROUTE_PATHS.connectionClose}`,
        pending: `${httpBaseUrl}${ROUTE_PATHS.pending}`,
        malformed: `http://127.0.0.1:${malformedPort}`,
      },
      requestCounts,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export interface HealthLoopbackFixtureApi {
  readonly createHealthLoopbackFixture: typeof createHealthLoopbackFixture;
}

declare const require: (specifier: "node:http" | "node:net") => unknown;
declare const module: { exports: HealthLoopbackFixtureApi };

module.exports = { createHealthLoopbackFixture };
