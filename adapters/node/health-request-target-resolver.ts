import type { Outcome } from "../../core/contracts/public.js";

interface AddressRecord { readonly address: string; readonly family: 4 | 6; }
interface ApprovedHealthRequestTarget {
  readonly url: string;
  readonly protocol: "http:" | "https:";
  readonly address: string;
  readonly family: 4 | 6;
  readonly hostname: string;
  readonly port: number;
  readonly path: string;
  readonly hostHeader: string;
}
interface UnsupportedUrl { readonly code: "unsupported_url"; }
interface ResolverFailure {
  readonly code: "unsupported_url" | "dns_failure" | "unknown_transport";
}
interface HealthRequestTargetResolver {
  resolve(url: string): Promise<Outcome<ApprovedHealthRequestTarget, ResolverFailure>>;
}
interface ResolverOptions {
  readonly lookup?: (hostname: string) => Promise<readonly AddressRecord[]>;
  readonly allowLoopback?: boolean;
  readonly nat64Prefixes?: readonly string[];
  readonly nat64DiscoveryLookup?: (
    hostname: string,
  ) => Promise<readonly AddressRecord[]>;
}
interface DnsApi {
  promises: {
    lookup(
      hostname: string,
      options: { readonly all: true; readonly verbatim: true },
    ): Promise<readonly { readonly address: string; readonly family: number }[]>;
    resolve4(hostname: string): Promise<readonly string[]>;
    resolve6(hostname: string): Promise<readonly string[]>;
  };
}
interface NetApi { isIP(address: string): number; }

interface ErrorClassifierApi {
  mapNodeLookupError(error: unknown): "dns_failure" | "unknown_transport";
}

declare const require: (
  specifier: "node:dns" | "node:net" | "./health-node-error-classifier.ts",
) => unknown;
declare const module: {
  exports: { createHealthRequestTargetResolver: typeof createHealthRequestTargetResolver };
};
const dns = require("node:dns") as DnsApi;
const net = require("node:net") as NetApi;
const { mapNodeLookupError } = require(
  "./health-node-error-classifier.ts",
) as ErrorClassifierApi;

type AddressDisposition = "safe" | "loopback" | "unsafe";

function unsupported(): Outcome<never, UnsupportedUrl> {
  return { ok: false, error: { code: "unsupported_url" } };
}

function ipv4Bytes(address: string): readonly number[] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((part) => Number(part));
  return bytes.every((byte, index) =>
    Number.isInteger(byte) && byte >= 0 && byte <= 255 && String(byte) === parts[index]
  ) ? bytes : undefined;
}

type Ipv4Prefix = readonly [readonly number[], number];

// IANA IPv4 Special-Purpose Address Registry, last updated 2025-10-09:
// https://www.iana.org/assignments/iana-ipv4-special-registry/
const LOOPBACK_IPV4_PREFIX: Ipv4Prefix = [[127], 8];
const GLOBAL_IPV4_EXCEPTIONS: readonly Ipv4Prefix[] = [
  [[192, 0, 0, 9], 32],
  [[192, 0, 0, 10], 32],
];
const NON_GLOBAL_IPV4_PREFIXES: readonly Ipv4Prefix[] = [
  [[0], 8],
  [[10], 8],
  [[100, 64], 10],
  [[169, 254], 16],
  [[172, 16], 12],
  [[192, 0, 0], 24],
  [[192, 0, 2], 24],
  [[192, 88, 99], 24],
  [[192, 168], 16],
  [[198, 18], 15],
  [[198, 51, 100], 24],
  [[203, 0, 113], 24],
  [[224], 3],
];

function inIpv4Prefix(
  bytes: readonly number[],
  [prefix, length]: Ipv4Prefix,
): boolean {
  const complete = Math.floor(length / 8);
  for (let index = 0; index < complete; index += 1) {
    if (bytes[index] !== (prefix[index] ?? 0)) return false;
  }
  const remaining = length % 8;
  if (remaining === 0) return true;
  const mask = (0xff << (8 - remaining)) & 0xff;
  return (bytes[complete] & mask) === ((prefix[complete] ?? 0) & mask);
}

function ipv4Disposition(address: string): AddressDisposition {
  const bytes = ipv4Bytes(address);
  if (bytes === undefined) return "unsafe";
  if (inIpv4Prefix(bytes, LOOPBACK_IPV4_PREFIX)) return "loopback";
  if (GLOBAL_IPV4_EXCEPTIONS.some((prefix) => inIpv4Prefix(bytes, prefix))) {
    return "safe";
  }
  if (NON_GLOBAL_IPV4_PREFIXES.some((prefix) => inIpv4Prefix(bytes, prefix))) {
    return "unsafe";
  }
  return "safe";
}

function embeddedIpv4(address: string): string {
  const lastColon = address.lastIndexOf(":");
  const bytes = ipv4Bytes(address.slice(lastColon + 1));
  if (bytes === undefined) return address;
  const high = ((bytes[0] << 8) | bytes[1]).toString(16);
  const low = ((bytes[2] << 8) | bytes[3]).toString(16);
  return `${address.slice(0, lastColon)}:${high}:${low}`;
}

function ipv6Hextets(address: string): readonly number[] | undefined {
  if (address.includes("%")) return undefined;
  const normalized = embeddedIpv4(address.toLowerCase());
  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] === "" ? [] : halves[0].split(":");
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1].split(":");
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return undefined;
  }
  const parts = [...left, ...Array(missing).fill("0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return undefined;
  }
  return parts.map((part) => Number.parseInt(part, 16));
}

type Ipv6Prefix = readonly [readonly number[], number];
type Nat64PrefixLength = 32 | 40 | 48 | 56 | 64 | 96;
type Nat64Prefix = readonly [readonly number[], Nat64PrefixLength];

// IANA IPv6 Address Space, last updated 2025-10-23, identifies 2000::/3
// as Global Unicast; RFC 6052 defines the separate well-known translator.
const GLOBAL_UNICAST_IPV6_PREFIX: Ipv6Prefix = [[0x2000], 3];
const RFC6052_WELL_KNOWN_PREFIX: Ipv6Prefix = [[0x0064, 0xff9b], 96];
const RFC6052_PREFIX_LENGTHS: readonly Nat64PrefixLength[] = [32, 40, 48, 56, 64, 96];
// RFC 7050 discovers the active RFC 6052 prefix from these fixed records.
const RFC7050_DISCOVERY_HOSTNAME = "ipv4only.arpa";
const RFC7050_WELL_KNOWN_IPV4 = new Set(["192.0.0.170", "192.0.0.171"]);

// IANA IPv6 Special-Purpose Address Registry, last updated 2025-10-09:
// https://www.iana.org/assignments/iana-ipv6-special-registry/
const NON_GLOBAL_IPV6_PREFIXES: readonly Ipv6Prefix[] = [
  [[0x0064, 0xff9b, 0x0001], 48],
  [[0x0100], 64],
  [[0x0100, 0x0000, 0x0000, 0x0001], 64],
  [[0x2001, 0x0002], 48],
  [[0x2001, 0x0db8], 32],
  [[0x2002], 16],
  [[0x3ffe], 16],
  [[0x3fff], 20],
  [[0x5f00], 16],
  [[0xfc00], 7],
  [[0xfe80], 10],
  [[0xff00], 8],
  [[], 96],
];

const GLOBAL_IETF_PROTOCOL_EXCEPTIONS: readonly Ipv6Prefix[] = [
  [[0x2001, 0x0001, 0, 0, 0, 0, 0, 0x0001], 128],
  [[0x2001, 0x0001, 0, 0, 0, 0, 0, 0x0002], 128],
  [[0x2001, 0x0001, 0, 0, 0, 0, 0, 0x0003], 128],
  [[0x2001, 0x0003], 32],
  [[0x2001, 0x0004, 0x0112], 48],
  [[0x2001, 0x0020], 28],
  [[0x2001, 0x0030], 28],
];

function inIpv6Prefix(
  parts: readonly number[],
  [prefix, length]: Ipv6Prefix,
): boolean {
  const complete = Math.floor(length / 16);
  for (let index = 0; index < complete; index += 1) {
    if (parts[index] !== (prefix[index] ?? 0)) return false;
  }
  const remaining = length % 16;
  if (remaining === 0) return true;
  const mask = (0xffff << (16 - remaining)) & 0xffff;
  return (parts[complete] & mask) === ((prefix[complete] ?? 0) & mask);
}

function lastIpv4Disposition(parts: readonly number[]): AddressDisposition {
  return ipv4Disposition([
    parts[6] >> 8, parts[6] & 255, parts[7] >> 8, parts[7] & 255,
  ].join("."));
}

function parseNat64Prefix(value: unknown): Nat64Prefix | undefined {
  if (typeof value !== "string") return undefined;
  const separator = value.lastIndexOf("/");
  if (separator < 1) return undefined;
  const parts = ipv6Hextets(value.slice(0, separator));
  const length = Number(value.slice(separator + 1));
  if (parts === undefined || !RFC6052_PREFIX_LENGTHS.includes(length as Nat64PrefixLength)) {
    return undefined;
  }
  const complete = Math.floor(length / 16);
  const remaining = length % 16;
  if (remaining > 0) {
    const hostMask = 0xffff >>> remaining;
    if ((parts[complete] & hostMask) !== 0) return undefined;
  }
  const hostStart = complete + (remaining > 0 ? 1 : 0);
  if (parts.slice(hostStart).some((part) => part !== 0)) return undefined;
  return [parts, length as Nat64PrefixLength];
}

function parseNat64Prefixes(values: unknown): readonly Nat64Prefix[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const parsed = values.map(parseNat64Prefix);
  return parsed.every((prefix): prefix is Nat64Prefix => prefix !== undefined)
    ? parsed
    : undefined;
}

function ipv6Bytes(parts: readonly number[]): readonly number[] {
  return parts.flatMap((part) => [part >> 8, part & 255]);
}

function rfc6052Ipv4(parts: readonly number[], length: Nat64PrefixLength): string | undefined {
  const bytes = ipv6Bytes(parts);
  if (length !== 96 && bytes[8] !== 0) return undefined;
  const suffixStart = length === 32 ? 9
    : length === 40 ? 10
    : length === 48 ? 11
    : length === 56 ? 12
    : length === 64 ? 13
    : 16;
  if (bytes.slice(suffixStart).some((byte) => byte !== 0)) return undefined;
  const embedded = length === 32 ? bytes.slice(4, 8)
    : length === 40 ? [bytes[5], bytes[6], bytes[7], bytes[9]]
    : length === 48 ? [bytes[6], bytes[7], bytes[9], bytes[10]]
    : length === 56 ? [bytes[7], bytes[9], bytes[10], bytes[11]]
    : length === 64 ? [bytes[9], bytes[10], bytes[11], bytes[12]]
    : bytes.slice(12, 16);
  return embedded.join(".");
}

function prefixParts(
  parts: readonly number[],
  length: Nat64PrefixLength,
): readonly number[] {
  const normalized = [...parts];
  const complete = Math.floor(length / 16);
  const remaining = length % 16;
  let hostStart = complete;
  if (remaining > 0) {
    normalized[complete] &= (0xffff << (16 - remaining)) & 0xffff;
    hostStart += 1;
  }
  normalized.fill(0, hostStart);
  return normalized;
}

function discoveredNat64Prefix(parts: readonly number[]): Nat64Prefix | undefined {
  const candidates = RFC6052_PREFIX_LENGTHS.filter((length) => {
    const embedded = rfc6052Ipv4(parts, length);
    return embedded !== undefined && RFC7050_WELL_KNOWN_IPV4.has(embedded);
  });
  if (candidates.length !== 1) return undefined;
  const length = candidates[0];
  return [prefixParts(parts, length), length];
}

function discoverNat64Prefixes(
  records: unknown,
): readonly Nat64Prefix[] | undefined {
  if (!Array.isArray(records) || records.length === 0) return undefined;
  const discovered: Nat64Prefix[] = [];
  for (const value of records) {
    if (!isAddressRecord(value) || net.isIP(value.address) !== value.family) return undefined;
    if (value.family === 4) {
      if (!RFC7050_WELL_KNOWN_IPV4.has(value.address)) return undefined;
      continue;
    }
    const parts = ipv6Hextets(value.address);
    if (parts === undefined) return undefined;
    const prefix = discoveredNat64Prefix(parts);
    if (prefix === undefined) return undefined;
    if (!discovered.some((candidate) =>
      candidate[1] === prefix[1] && candidate[0].every((part, index) => part === prefix[0][index])
    )) discovered.push(prefix);
  }
  return discovered;
}

function translatedIpv4Disposition(
  parts: readonly number[],
  prefixes: readonly Nat64Prefix[],
): AddressDisposition | undefined {
  let matched = false;
  for (const prefix of prefixes) {
    if (!inIpv6Prefix(parts, prefix)) continue;
    matched = true;
    const embedded = rfc6052Ipv4(parts, prefix[1]);
    if (embedded === undefined) return "unsafe";
    const disposition = ipv4Disposition(embedded);
    if (disposition !== "safe") return "unsafe";
  }
  return matched ? "safe" : undefined;
}

function isNonGlobalIpv6(parts: readonly number[]): boolean {
  const ietfAssignments: Ipv6Prefix = [[0x2001], 23];
  if (inIpv6Prefix(parts, ietfAssignments) &&
    !GLOBAL_IETF_PROTOCOL_EXCEPTIONS.some((prefix) => inIpv6Prefix(parts, prefix))) {
    return true;
  }
  return NON_GLOBAL_IPV6_PREFIXES.some((prefix) => inIpv6Prefix(parts, prefix));
}

function ipv6Disposition(
  address: string,
  nat64Prefixes: readonly Nat64Prefix[],
): AddressDisposition {
  const parts = ipv6Hextets(address);
  if (parts === undefined) return "unsafe";
  const allZero = parts.every((part) => part === 0);
  if (allZero) return "unsafe";
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) {
    return "loopback";
  }
  const mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  if (mapped) {
    return lastIpv4Disposition(parts);
  }
  const translated = translatedIpv4Disposition(parts, [
    RFC6052_WELL_KNOWN_PREFIX as Nat64Prefix,
    ...nat64Prefixes,
  ]);
  if (translated !== undefined) return translated;
  if (!inIpv6Prefix(parts, GLOBAL_UNICAST_IPV6_PREFIX)) return "unsafe";
  if (isNonGlobalIpv6(parts)) return "unsafe";
  return "safe";
}

function addressDisposition(
  record: AddressRecord,
  nat64Prefixes: readonly Nat64Prefix[],
): AddressDisposition {
  if (net.isIP(record.address) !== record.family) return "unsafe";
  return record.family === 4
    ? ipv4Disposition(record.address)
    : ipv6Disposition(record.address, nat64Prefixes);
}

function isAddressRecord(value: unknown): value is AddressRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.address === "string" && (record.family === 4 || record.family === 6);
}

async function defaultLookup(hostname: string): Promise<readonly AddressRecord[]> {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return records.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
}

function nodeErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null
    ? (error as Record<string, unknown>).code
    : undefined;
}

async function defaultNat64DiscoveryLookup(
  hostname: string,
): Promise<readonly AddressRecord[]> {
  try {
    const addresses = await dns.promises.resolve6(hostname);
    if (addresses.length > 0) {
      return addresses.map((address) => ({ address, family: 6 as const }));
    }
  } catch (error) {
    if (nodeErrorCode(error) !== "ENODATA") throw error;
  }
  const addresses = await dns.promises.resolve4(hostname);
  return addresses.map((address) => ({ address, family: 4 as const }));
}

function literalRecord(hostname: string): AddressRecord | undefined {
  const family = net.isIP(hostname);
  return family === 4 || family === 6 ? { address: hostname, family } : undefined;
}

function parseTarget(input: string): {
  readonly parsed: URL;
  readonly hostname: string;
  readonly port: number;
} | undefined {
  let parsed: URL;
  try { parsed = new URL(input); } catch { return undefined; }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" || parsed.password !== "") return undefined;
  const hostname = parsed.hostname.startsWith("[")
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  if (hostname.length === 0) return undefined;
  const port = parsed.port === "" ? (parsed.protocol === "https:" ? 443 : 80) : Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return undefined;
  parsed.hash = "";
  return { parsed, hostname, port };
}

function approvedTarget(
  parsed: URL,
  hostname: string,
  port: number,
  record: AddressRecord,
): ApprovedHealthRequestTarget {
  const defaultPort = parsed.protocol === "https:" ? 443 : 80;
  const bracketed = record.family === 6 && net.isIP(hostname) === 6
    ? `[${hostname}]`
    : hostname;
  return {
    url: parsed.href,
    protocol: parsed.protocol as "http:" | "https:",
    address: record.address,
    family: record.family,
    hostname,
    port,
    path: `${parsed.pathname}${parsed.search}`,
    hostHeader: port === defaultPort ? bracketed : `${bracketed}:${port}`,
  };
}

function createHealthRequestTargetResolver(
  options: ResolverOptions = {},
): HealthRequestTargetResolver {
  const lookup = options.lookup ?? defaultLookup;
  const hasConfiguredNat64Prefixes = options.nat64Prefixes !== undefined;
  const configuredNat64Prefixes = hasConfiguredNat64Prefixes
    ? parseNat64Prefixes(options.nat64Prefixes)
    : undefined;
  const nat64DiscoveryLookup = options.nat64DiscoveryLookup ?? defaultNat64DiscoveryLookup;
  return {
    async resolve(input) {
      if (hasConfiguredNat64Prefixes && configuredNat64Prefixes === undefined) {
        return unsupported();
      }
      const target = parseTarget(input);
      if (target === undefined) return unsupported();
      let records: readonly AddressRecord[];
      try {
        const literal = literalRecord(target.hostname);
        records = literal === undefined ? await lookup(target.hostname) : [literal];
      } catch (error) {
        return { ok: false, error: { code: mapNodeLookupError(error) } };
      }
      if (!Array.isArray(records) || records.length === 0) return unsupported();
      let nat64Prefixes = configuredNat64Prefixes ?? [];
      if (!hasConfiguredNat64Prefixes && records.some((record) => record?.family === 6)) {
        let discoveryRecords: readonly AddressRecord[];
        try {
          discoveryRecords = await nat64DiscoveryLookup(RFC7050_DISCOVERY_HOSTNAME);
        } catch {
          return unsupported();
        }
        const discovered = discoverNat64Prefixes(discoveryRecords);
        if (discovered === undefined) return unsupported();
        nat64Prefixes = discovered;
      }
      for (const record of records) {
        if (!isAddressRecord(record)) return unsupported();
        const disposition = addressDisposition(record, nat64Prefixes);
        if (disposition === "unsafe" ||
          (disposition === "loopback" && options.allowLoopback !== true)) return unsupported();
      }
      const selected = [...records].sort((left, right) =>
        left.family - right.family || left.address.localeCompare(right.address)
      )[0];
      return { ok: true, value: approvedTarget(
        target.parsed, target.hostname, target.port, selected,
      ) };
    },
  };
}

module.exports = { createHealthRequestTargetResolver };
