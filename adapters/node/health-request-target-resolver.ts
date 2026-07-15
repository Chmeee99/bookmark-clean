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
interface HealthRequestTargetResolver {
  resolve(url: string): Promise<Outcome<ApprovedHealthRequestTarget, UnsupportedUrl>>;
}
interface ResolverOptions {
  readonly lookup?: (hostname: string) => Promise<readonly AddressRecord[]>;
  readonly allowLoopback?: boolean;
}
interface DnsApi {
  promises: {
    lookup(
      hostname: string,
      options: { readonly all: true; readonly verbatim: true },
    ): Promise<readonly { readonly address: string; readonly family: number }[]>;
  };
}
interface NetApi { isIP(address: string): number; }

declare const require: (specifier: "node:dns" | "node:net") => unknown;
declare const module: {
  exports: { createHealthRequestTargetResolver: typeof createHealthRequestTargetResolver };
};
const dns = require("node:dns") as DnsApi;
const net = require("node:net") as NetApi;

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

function inIpv4Range(
  bytes: readonly number[],
  first: number,
  secondStart = 0,
  secondEnd = 255,
): boolean {
  return bytes[0] === first && bytes[1] >= secondStart && bytes[1] <= secondEnd;
}

function ipv4Disposition(address: string): AddressDisposition {
  const bytes = ipv4Bytes(address);
  if (bytes === undefined) return "unsafe";
  const [first, second, third] = bytes;
  if (inIpv4Range(bytes, 127)) return "loopback";
  if (
    inIpv4Range(bytes, 0) ||
    inIpv4Range(bytes, 10) ||
    inIpv4Range(bytes, 100, 64, 127) ||
    inIpv4Range(bytes, 169, 254, 254) ||
    inIpv4Range(bytes, 172, 16, 31) ||
    first === 192 && second === 0 && (third === 0 || third === 2) ||
    inIpv4Range(bytes, 192, 168, 168) ||
    inIpv4Range(bytes, 198, 18, 19) ||
    first === 198 && second === 51 && third === 100 ||
    first === 203 && second === 0 && third === 113 ||
    first >= 224
  ) return "unsafe";
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

function ipv6Disposition(address: string): AddressDisposition {
  const parts = ipv6Hextets(address);
  if (parts === undefined) return "unsafe";
  const allZero = parts.every((part) => part === 0);
  if (allZero) return "unsafe";
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) {
    return "loopback";
  }
  const mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  if (mapped) {
    return ipv4Disposition([
      parts[6] >> 8, parts[6] & 255, parts[7] >> 8, parts[7] & 255,
    ].join("."));
  }
  if (
    (parts[0] & 0xfe00) === 0xfc00 ||
    (parts[0] & 0xffc0) === 0xfe80 ||
    (parts[0] & 0xff00) === 0xff00 ||
    (parts[0] === 0x2001 && parts[1] === 0x0db8) ||
    (parts[0] === 0x2001 && parts[1] === 0x0002) ||
    parts.slice(0, 6).every((part) => part === 0)
  ) return "unsafe";
  return "safe";
}

function addressDisposition(record: AddressRecord): AddressDisposition {
  if (net.isIP(record.address) !== record.family) return "unsafe";
  return record.family === 4
    ? ipv4Disposition(record.address)
    : ipv6Disposition(record.address);
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
  return {
    async resolve(input) {
      const target = parseTarget(input);
      if (target === undefined) return unsupported();
      let records: readonly AddressRecord[];
      try {
        const literal = literalRecord(target.hostname);
        records = literal === undefined ? await lookup(target.hostname) : [literal];
      } catch { return unsupported(); }
      if (!Array.isArray(records) || records.length === 0) return unsupported();
      for (const record of records) {
        if (!isAddressRecord(record)) return unsupported();
        const disposition = addressDisposition(record);
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
