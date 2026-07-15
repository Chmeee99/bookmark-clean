import type {
  HealthSelectedHeader,
  HealthSelectedHeaderName,
  HealthTransport,
  HealthTransportFailure,
  HealthTransportFailureCode,
  HealthTransportRequest,
  HealthTransportResponse,
} from "../../modules/health/public.js";
import type { Outcome } from "../../core/contracts/public.js";

interface ApprovedTarget {
  readonly url: string;
  readonly protocol: "http:" | "https:";
  readonly address: string;
  readonly family: 4 | 6;
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
  readonly hostHeader: string;
}
interface TargetResolver {
  resolve(url: string): Promise<
    | { readonly ok: true; readonly value: ApprovedTarget }
    | { readonly ok: false; readonly error: { readonly code: "unsupported_url" } }
  >;
}
interface ResolverApi { createHealthRequestTargetResolver(): TargetResolver; }
interface NodeError extends Error { readonly code?: string; }
interface IncomingMessage {
  readonly statusCode?: number;
  readonly headersDistinct?: Readonly<Record<string, readonly string[] | undefined>>;
  on(event: "data", listener: (chunk: Uint8Array) => void): this;
  on(event: "end" | "aborted", listener: () => void): this;
  on(event: "error", listener: (error: NodeError) => void): this;
  destroy(): void;
}
interface ClientRequest {
  on(event: "error", listener: (error: NodeError) => void): this;
  setTimeout(milliseconds: number, listener: () => void): this;
  end(): void;
  destroy(): void;
}
interface RequestApi {
  request(options: unknown, listener: (response: IncomingMessage) => void): ClientRequest;
}
interface NetApi { isIP(address: string): number; }
interface TransportOptions { readonly resolver?: TargetResolver; }
type ResolutionResult =
  | { readonly kind: "resolved"; readonly value: unknown }
  | { readonly kind: "rejected" }
  | { readonly kind: "timeout" };

declare const require: (
  specifier:
    | "node:http"
    | "node:https"
    | "node:net"
    | "./health-request-target-resolver.ts",
) => unknown;
declare const module: {
  exports: { createNodeHealthTransport: typeof createNodeHealthTransport };
};
const http = require("node:http") as RequestApi;
const https = require("node:https") as RequestApi;
const net = require("node:net") as NetApi;
const { createHealthRequestTargetResolver } = require(
  "./health-request-target-resolver.ts",
) as ResolverApi;

const HEADER_NAMES: readonly HealthSelectedHeaderName[] = [
  "content-type", "location", "retry-after", "etag", "last-modified",
];

function durationSince(startedAt: number): number {
  const elapsed = Math.max(0, Math.round(performance.now() - startedAt));
  return Number.isSafeInteger(elapsed) ? elapsed : Number.MAX_SAFE_INTEGER;
}

function failed(
  code: HealthTransportFailureCode,
  durationMs: number,
): Outcome<never, HealthTransportFailure> {
  return { ok: false, error: { code, durationMs } };
}

function mapError(
  error: NodeError,
  protocol: ApprovedTarget["protocol"],
): HealthTransportFailureCode {
  const code = error.code;
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return "connection_failure";
  if (code?.startsWith("HPE_") === true) return "malformed_response";
  if ((protocol === "https:" && code === "EPROTO") ||
    code?.startsWith("ERR_SSL_") === true) return "tls_error";
  return "unknown_transport";
}

function validRequest(value: HealthTransportRequest): boolean {
  return typeof value?.url === "string" && value.url.length > 0 &&
    value.method === "GET" && value.redirect === "manual" &&
    Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0 &&
    Number.isSafeInteger(value.maxBodyBytes) && value.maxBodyBytes > 0;
}

function validTarget(value: unknown): value is ApprovedTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  return (target.protocol === "http:" || target.protocol === "https:") &&
    typeof target.url === "string" && typeof target.address === "string" &&
    (target.family === 4 || target.family === 6) && net.isIP(target.address) === target.family &&
    typeof target.hostname === "string" && target.hostname.length > 0 &&
    Number.isSafeInteger(target.port) && (target.port as number) >= 1 && (target.port as number) <= 65535 &&
    typeof target.path === "string" && target.path.startsWith("/") &&
    typeof target.hostHeader === "string" && target.hostHeader.length > 0;
}

function selectedHeaders(
  response: IncomingMessage,
): readonly HealthSelectedHeader[] | undefined {
  if (response.headersDistinct === undefined) return undefined;
  const selected: HealthSelectedHeader[] = [];
  for (const name of HEADER_NAMES) {
    const values = response.headersDistinct[name];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== "string") {
      return undefined;
    }
    selected.push({ name, value: values[0] });
  }
  return selected;
}

function concatenate(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function requestOptions(target: ApprovedTarget): Record<string, unknown> {
  return {
    protocol: target.protocol,
    hostname: target.address,
    family: target.family,
    port: target.port,
    path: target.path,
    method: "GET",
    headers: { Host: target.hostHeader },
    agent: false,
    ...(target.protocol === "https:" && net.isIP(target.hostname) === 0
      ? { servername: target.hostname }
      : {}),
  };
}

function resolveBeforeDeadline(
  resolver: TargetResolver,
  url: string,
  timeoutMs: number,
): Promise<ResolutionResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ResolutionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);
    Promise.resolve()
      .then(() => resolver.resolve(url))
      .then(
        (value) => finish({ kind: "resolved", value }),
        () => finish({ kind: "rejected" }),
      );
  });
}

function executeRequest(
  target: ApprovedTarget,
  input: HealthTransportRequest,
  startedAt: number,
): Promise<Outcome<HealthTransportResponse, HealthTransportFailure>> {
  return new Promise((resolve) => {
    let settled = false;
    let request: ClientRequest;
    const finish = (outcome: Outcome<HealthTransportResponse, HealthTransportFailure>) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const api = target.protocol === "https:" ? https : http;
    request = api.request(requestOptions(target), (response) => {
      const headers = selectedHeaders(response);
      const statusCode = response.statusCode;
      if (headers === undefined || !Number.isSafeInteger(statusCode) ||
        (statusCode as number) < 100 || (statusCode as number) > 599) {
        finish(failed("malformed_response", durationSince(startedAt)));
        response.destroy();
        return;
      }
      const chunks: Uint8Array[] = [];
      let length = 0;
      response.on("data", (chunk) => {
        if (settled) return;
        if (!(chunk instanceof Uint8Array) || length + chunk.byteLength > input.maxBodyBytes) {
          finish({ ok: true, value: {
            url: input.url, statusCode, headers,
            durationMs: durationSince(startedAt),
          } });
          response.destroy();
          return;
        }
        chunks.push(new Uint8Array(chunk));
        length += chunk.byteLength;
      });
      response.on("end", () => finish({ ok: true, value: {
        url: input.url, statusCode, headers,
        body: concatenate(chunks, length),
        durationMs: durationSince(startedAt),
      } }));
      response.on("aborted", () => finish(failed(
        "connection_failure", durationSince(startedAt),
      )));
      response.on("error", (error) => finish(failed(
        mapError(error, target.protocol), durationSince(startedAt),
      )));
    });
    request.on("error", (error) => finish(failed(
      mapError(error, target.protocol), durationSince(startedAt),
    )));
    request.setTimeout(input.timeoutMs, () => {
      finish(failed("timeout", durationSince(startedAt)));
      request.destroy();
    });
    request.end();
  });
}

function createNodeHealthTransport(options: TransportOptions = {}): HealthTransport {
  const resolver = options.resolver ?? createHealthRequestTargetResolver();
  return {
    async request(input) {
      if (!validRequest(input)) return failed("unknown_transport", 0);
      const startedAt = performance.now();
      const resolution = await resolveBeforeDeadline(
        resolver,
        input.url,
        input.timeoutMs,
      );
      if (resolution.kind === "timeout") {
        return failed("timeout", durationSince(startedAt));
      }
      if (resolution.kind === "rejected") {
        return failed("unsupported_url", durationSince(startedAt));
      }
      const resolved = resolution.value as Awaited<ReturnType<TargetResolver["resolve"]>>;
      if (!resolved || resolved.ok !== true || !validTarget(resolved.value)) {
        return failed("unsupported_url", durationSince(startedAt));
      }
      const remainingMs = input.timeoutMs - durationSince(startedAt);
      if (remainingMs <= 0) {
        return failed("timeout", durationSince(startedAt));
      }
      return executeRequest(
        resolved.value,
        { ...input, timeoutMs: remainingMs },
        startedAt,
      );
    },
  };
}

module.exports = { createNodeHealthTransport };
