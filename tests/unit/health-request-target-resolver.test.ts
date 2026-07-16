interface NodeTestApi { test(name: string, callback: () => void | Promise<void>): void; }
interface AddressRecord { readonly address: string; readonly family: 4 | 6; }
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
    | { readonly ok: false; readonly error: {
      readonly code: "unsupported_url" | "dns_failure" | "unknown_transport";
    } }
  >;
}
interface ResolverApi {
  createHealthRequestTargetResolver(options?: {
    readonly lookup?: (hostname: string) => Promise<readonly AddressRecord[]>;
    readonly allowLoopback?: boolean;
  }): TargetResolver;
}

declare const require: (specifier: string) => unknown;
const { test } = require("node:test") as NodeTestApi;
const { createHealthRequestTargetResolver } = require(
  "../../adapters/node/health-request-target-resolver.ts",
) as ResolverApi;

function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
const rejected = { ok: false, error: { code: "unsupported_url" } } as const;
const safeLookup = async (): Promise<readonly AddressRecord[]> => [
  { address: "93.184.216.34", family: 4 },
];

test("normalizes approved HTTP targets and preserves verification fields", async () => {
  const resolver = createHealthRequestTargetResolver({ lookup: safeLookup });
  equal(await resolver.resolve("https://Example.COM:8443/a%20b?q=1#hidden"), {
    ok: true,
    value: {
      url: "https://example.com:8443/a%20b?q=1",
      protocol: "https:",
      address: "93.184.216.34",
      family: 4,
      hostname: "example.com",
      port: 8443,
      path: "/a%20b?q=1",
      hostHeader: "example.com:8443",
    },
  });
  equal(await resolver.resolve("http://example.com/path"), {
    ok: true,
    value: {
      url: "http://example.com/path",
      protocol: "http:",
      address: "93.184.216.34",
      family: 4,
      hostname: "example.com",
      port: 80,
      path: "/path",
      hostHeader: "example.com",
    },
  });
});

test("rejects malformed URLs schemes credentials and lookup results", async () => {
  const resolver = createHealthRequestTargetResolver({ lookup: safeLookup });
  for (const url of [
    "not a URL",
    "ftp://example.com/file",
    "file:///tmp/private",
    "https://user@example.com/",
    "https://:secret@example.com/",
    "https://example.com:70000/",
  ]) equal(await resolver.resolve(url), rejected);

  for (const lookup of [
    async () => [],
    async () => [null as never],
    async () => [{ address: "bad-address", family: 4 as const }],
    async () => [{ address: "1.1.1.1", family: 6 as const }],
  ]) {
    equal(await createHealthRequestTargetResolver({ lookup }).resolve("https://example.com"), rejected);
  }
});

test("classifies structured lookup failures without interpreting error prose", async () => {
  for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
    const resolver = createHealthRequestTargetResolver({
      async lookup(): Promise<readonly AddressRecord[]> {
        throw Object.assign(new Error("opaque resolver prose"), { code });
      },
    });
    equal(await resolver.resolve("https://example.com"), {
      ok: false,
      error: { code: "dns_failure" },
    });
  }

  for (const thrown of [
    Object.assign(new Error("not semantic input"), { code: "EUNKNOWN" }),
    new Error("ENOTFOUND appears only in prose"),
  ]) {
    const resolver = createHealthRequestTargetResolver({
      async lookup(): Promise<readonly AddressRecord[]> { throw thrown; },
    });
    equal(await resolver.resolve("https://example.com"), {
      ok: false,
      error: { code: "unknown_transport" },
    });
  }
});

test("rejects every configured unsafe IPv4 and IPv6 range", async () => {
  const unsafe: readonly AddressRecord[] = [
    { address: "0.0.0.0", family: 4 },
    { address: "10.0.0.1", family: 4 },
    { address: "100.64.0.1", family: 4 },
    { address: "127.0.0.1", family: 4 },
    { address: "169.254.1.1", family: 4 },
    { address: "172.16.0.1", family: 4 },
    { address: "192.0.2.1", family: 4 },
    { address: "192.88.99.2", family: 4 },
    { address: "192.168.1.1", family: 4 },
    { address: "198.18.0.1", family: 4 },
    { address: "198.51.100.1", family: 4 },
    { address: "203.0.113.1", family: 4 },
    { address: "224.0.0.1", family: 4 },
    { address: "240.0.0.1", family: 4 },
    { address: "::", family: 6 },
    { address: "0:0:0:0:0:0:0:1", family: 6 },
    { address: "fc00::1", family: 6 },
    { address: "fe80::1", family: 6 },
    { address: "ff02::1", family: 6 },
    { address: "2001:db8::1", family: 6 },
    { address: "::ffff:127.0.0.1", family: 6 },
  ];
  for (const record of unsafe) {
    const resolver = createHealthRequestTargetResolver({ lookup: async () => [record] });
    equal(await resolver.resolve("https://example.com"), rejected);
  }
});

test("rejects reserved non-global and deprecated IPv6 blocks", async () => {
  const unsafe: readonly string[] = [
    "64:ff9b:0:ffff::1",
    "64:ff9b:1::1",
    "64:ff9b:2::1",
    "100::1",
    "100:0:0:1::1",
    "100:0:0:2::1",
    "2001::1",
    "2001:10::1",
    "2002:7f00:1::",
    "3ffe:ffff::1",
    "3fff::1",
    "4000::1",
    "5eff::1",
    "5f00::1",
    "6000::1",
    "fec0::1",
  ];
  for (const address of unsafe) {
    const resolver = createHealthRequestTargetResolver({ lookup: async () => [
      { address, family: 6 },
    ] });
    equal(await resolver.resolve("https://example.com"), rejected);
  }
});

test("applies the RFC 6052 IPv4 policy inside 64:ff9b::/96", async () => {
  for (const address of [
    "64:ff9b::7f00:1",
    "64:ff9b::a00:1",
    "64:ff9b::c0a8:101",
    "64:ff9b::c058:6302",
  ]) {
    const resolver = createHealthRequestTargetResolver({
      allowLoopback: true,
      lookup: async () => [{ address, family: 6 }],
    });
    equal(await resolver.resolve("https://example.com"), rejected);
  }

  const publicTranslation = createHealthRequestTargetResolver({ lookup: async () => [
    { address: "64:ff9b::808:808", family: 6 },
  ] });
  const result = await publicTranslation.resolve("https://example.com");
  equal(result.ok ? result.value.address : result, "64:ff9b::808:808");
});

test("preserves global special-address exceptions and prefix-edge controls", async () => {
  const safe: readonly AddressRecord[] = [
    { address: "192.0.0.9", family: 4 },
    { address: "192.0.0.10", family: 4 },
    { address: "2001:1::1", family: 6 },
    { address: "2001:1::2", family: 6 },
    { address: "2001:1::3", family: 6 },
    { address: "2001:3::1", family: 6 },
    { address: "2001:4:112::1", family: 6 },
    { address: "2001:20::1", family: 6 },
    { address: "2001:30::1", family: 6 },
    { address: "2606:4700:4700::1111", family: 6 },
    { address: "::ffff:192.0.0.9", family: 6 },
    { address: "64:ff9b::c000:9", family: 6 },
  ];
  for (const record of safe) {
    const resolver = createHealthRequestTargetResolver({ lookup: async () => [record] });
    const result = await resolver.resolve("https://example.com");
    equal(result.ok ? result.value.address : result, record.address);
  }

  const mixed = createHealthRequestTargetResolver({ lookup: async () => [
    { address: "2606:4700:4700::1111", family: 6 },
    { address: "64:ff9b:1::1", family: 6 },
  ] });
  equal(await mixed.resolve("https://example.com"), rejected);
});

test("rejects mixed answers and selects safe answers deterministically", async () => {
  const mixed = createHealthRequestTargetResolver({ lookup: async () => [
    { address: "1.1.1.1", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ] });
  equal(await mixed.resolve("https://example.com"), rejected);

  for (const records of [
    [
      { address: "2606:4700:4700::1111", family: 6 as const },
      { address: "8.8.8.8", family: 4 as const },
      { address: "1.1.1.1", family: 4 as const },
    ],
    [
      { address: "1.1.1.1", family: 4 as const },
      { address: "8.8.8.8", family: 4 as const },
      { address: "2606:4700:4700::1111", family: 6 as const },
    ],
  ]) {
    const result = await createHealthRequestTargetResolver({ lookup: async () => records })
      .resolve("https://example.com");
    equal(result.ok ? [result.value.address, result.value.family] : result, ["1.1.1.1", 4]);
  }
  const publicSpecialNeighbor = createHealthRequestTargetResolver({ lookup: async () => [
    { address: "192.0.1.1", family: 4 },
  ] });
  const neighbor = await publicSpecialNeighbor.resolve("https://example.com");
  equal(neighbor.ok ? neighbor.value.address : neighbor, "192.0.1.1");

  const mapped = createHealthRequestTargetResolver({ lookup: async () => [
    { address: "::ffff:8.8.8.8", family: 6 },
  ] });
  const mappedResult = await mapped.resolve("https://example.com");
  equal(mappedResult.ok ? mappedResult.value.address : mappedResult, "::ffff:8.8.8.8");
});

test("loopback permission is explicit narrow and works for IP literals", async () => {
  equal(await createHealthRequestTargetResolver().resolve("http://127.0.0.1:8080/a"), rejected);
  equal(await createHealthRequestTargetResolver({ allowLoopback: true })
    .resolve("http://127.0.0.1:8080/a"), {
    ok: true,
    value: {
      url: "http://127.0.0.1:8080/a",
      protocol: "http:",
      address: "127.0.0.1",
      family: 4,
      hostname: "127.0.0.1",
      port: 8080,
      path: "/a",
      hostHeader: "127.0.0.1:8080",
    },
  });
  const privateTarget = createHealthRequestTargetResolver({
    allowLoopback: true,
    lookup: async () => [{ address: "10.0.0.1", family: 4 }],
  });
  equal(await privateTarget.resolve("https://example.com"), rejected);
});
