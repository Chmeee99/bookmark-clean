import type { HealthTransport } from "../../modules/health/public.js";

interface Resolver {
  resolve(url: string): Promise<{
    readonly ok: true;
    readonly value: {
      readonly url: string;
      readonly protocol: "https:";
      readonly address: "127.0.0.1";
      readonly family: 4;
      readonly hostname: "health.test";
      readonly port: number;
      readonly path: "/facts?q=1";
      readonly hostHeader: string;
    };
  }>;
}
interface TransportApi {
  createNodeHealthTransport(options: { readonly resolver: Resolver }): HealthTransport;
}

declare const require: (specifier: string) => unknown;
declare const process: {
  readonly argv: readonly string[];
  readonly stdout: { write(value: string): void };
  readonly stderr: { write(value: string): void };
  exitCode?: number;
};
const { createNodeHealthTransport } = require(
  "../../adapters/node/health-transport.ts",
) as TransportApi;

async function main(): Promise<void> {
  const port = Number(process.argv[2]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Expected one valid HTTPS fixture port");
  }
  const url = `https://health.test:${port}/facts?q=1`;
  const resolver: Resolver = {
    async resolve(inputUrl) {
      if (inputUrl !== url) throw new Error("Unexpected Health URL");
      return { ok: true, value: {
        url,
        protocol: "https:",
        address: "127.0.0.1",
        family: 4,
        hostname: "health.test",
        port,
        path: "/facts?q=1",
        hostHeader: `health.test:${port}`,
      } };
    },
  };
  const result = await createNodeHealthTransport({ resolver }).request({
    url,
    method: "GET",
    redirect: "manual",
    timeoutMs: 1_000,
    maxBodyBytes: 64,
  });
  process.stdout.write(JSON.stringify(result.ok
    ? { ok: true, ...result.value, body: result.value.body === undefined
      ? undefined
      : new TextDecoder().decode(result.value.body) }
    : result));
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.message : "Unknown child failure");
  process.exitCode = 1;
});
