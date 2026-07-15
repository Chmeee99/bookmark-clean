import type { NodeRuntimePorts } from "../../adapters/node/public.js";

interface NodeTestApi {
  test(name: string, callback: () => void | Promise<void>): void;
}

interface NodeRuntimeApi {
  createNodeRuntimePorts(): NodeRuntimePorts;
}

declare const require: (specifier: string) => unknown;

const load = require as unknown as (specifier: string) => unknown;
const { test } = load("node:test") as NodeTestApi;
const nodePublic = load(
  "../../adapters/node/public.ts",
) as NodeRuntimeApi & Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

test("public Node runtime supplies exact clock ID and fingerprint ports", () => {
  assertDeepEqual(
    Object.keys(nodePublic),
    ["createNodeRuntimePorts"],
    "Node public runtime exports changed",
  );
  const ports = nodePublic.createNodeRuntimePorts();
  assertDeepEqual(
    Object.keys(ports),
    [
      "clock",
      "healthIdFactory",
      "jobIdFactory",
      "bodyFingerprinter",
      "healthTransport",
    ],
    "Node runtime ports changed",
  );

  const now = ports.clock.now();
  assert(new Date(now).toISOString() === now, "Clock was not canonical UTC");

  const ids = [
    ports.healthIdFactory.nextObservationId(),
    ports.healthIdFactory.nextObservationId(),
    ports.jobIdFactory.nextBatchId(),
    ports.jobIdFactory.nextBatchId(),
    ports.jobIdFactory.nextJobId(),
    ports.jobIdFactory.nextJobId(),
    ports.jobIdFactory.nextLeaseToken(),
    ports.jobIdFactory.nextLeaseToken(),
  ];
  assert(ids.every((id) => id.length > 0), "Generated an empty ID");
  assert(new Set(ids).size === ids.length, "Generated a duplicate ID");
  assert(ids[0].startsWith("observation:"), "Observation prefix changed");
  assert(ids[2].startsWith("batch:"), "Batch prefix changed");
  assert(ids[4].startsWith("job:"), "Job prefix changed");
  assert(ids[6].startsWith("lease:"), "Lease prefix changed");

  const bytes = new TextEncoder().encode("bookmark-clean");
  assert(
    ports.bodyFingerprinter.fingerprint(bytes) ===
      "sha256:572601c8e77db3d682a71c5aebf05e104d83a3f8d9098c889a0859b444f97a43",
    "SHA-256 fingerprint changed",
  );
  assert(
    ports.bodyFingerprinter.fingerprint(bytes) ===
      ports.bodyFingerprinter.fingerprint(new Uint8Array(bytes)),
    "Fingerprint depends on byte identity",
  );
});

test("public Node transport keeps default request safety", async () => {
  const transport = nodePublic.createNodeRuntimePorts().healthTransport;
  const request = {
    method: "GET" as const,
    redirect: "manual" as const,
    timeoutMs: 50,
    maxBodyBytes: 32,
  };
  const malformed = await transport.request({ ...request, url: "bad url" });
  const loopback = await transport.request({
    ...request,
    url: "http://127.0.0.1:1/",
  });
  assertDeepEqual(
    malformed,
    { ok: false, error: { code: "unsupported_url", durationMs: 0 } },
    "Malformed URL reached transport",
  );
  assert(loopback.ok === false, "Loopback URL was accepted");
  assert(loopback.error.code === "unsupported_url", "Loopback failure changed");
});
