import { isIP } from 'node:net';

// Pure source-address key for per-IP limits (Requirement 2.9, design M2-9).
// The result is used only as a rate-limit bucket and is never sent or logged.
//
// Normalization choices:
// - IPv4-mapped IPv6 (`::ffff:203.0.113.7`) becomes plain IPv4, so dual-stack
//   sockets and proxies that log IPv4 share one bucket.
// - Other IPv6 addresses are grouped by their /64 prefix (`2001:db8:1:2::/64`).
//   A /64 is the smallest block a home or phone network is normally given, and
//   any device in it can pick fresh addresses, so a per-address key would be
//   trivial to bypass.
// - `host:port` and `[v6]:port` forms are accepted from proxies that add ports.

// Returned when no usable address exists, so such clients share one bucket
// instead of escaping the limit.
export const UNKNOWN_CLIENT_IP = 'unknown';

// IPv4-mapped addresses are five zero hextets, then 0xffff, then the IPv4 bits.
const IPV4_MAPPED_MARKER_INDEX = 5;
const IPV4_MAPPED_MARKER = 0xffff;
const BYTE_BITS = 8;
const BYTE_MASK = 0xff;
const IPV6_HEXTETS = 8;
// A /64 is the first four 16-bit hextets.
const IPV6_PREFIX_HEXTETS = 4;
const IPV6_PREFIX_SUFFIX = '::/64';
const HEX_RADIX = 16;
const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
const BRACKETED_V6 = /^\[([^\]]+)\](?::\d+)?$/;

export function clientIp(remoteAddress: string | undefined, forwardedFor: string | undefined, trustedHops: number): string {
  const socketKey = normalizeAddress(remoteAddress) ?? UNKNOWN_CLIENT_IP;
  if (!Number.isSafeInteger(trustedHops) || trustedHops <= 0) return socketKey;
  if (forwardedFor === undefined) return socketKey;
  // Each trusted proxy appends one entry on the right. Entries further left
  // are whatever the client sent, so they are never read. If there are fewer
  // entries than trusted hops the header did not come through our proxies, and
  // the socket address is the safer key.
  const entries = forwardedFor.split(',');
  const index = entries.length - trustedHops;
  if (index < 0) return socketKey;
  return normalizeAddress(entries[index]) ?? socketKey;
}

function normalizeAddress(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  let value = raw.trim();
  if (value === '') return null;
  const bracketed = BRACKETED_V6.exec(value);
  if (bracketed?.[1] !== undefined) value = bracketed[1];
  else {
    const v4Port = IPV4_WITH_PORT.exec(value);
    if (v4Port?.[1] !== undefined) value = v4Port[1];
  }
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  const hextets = expandIpv6(value);
  if (hextets === null) return null;
  if (isIpv4Mapped(hextets)) return mappedIpv4(hextets);
  const prefix = hextets.slice(0, IPV6_PREFIX_HEXTETS).map((h) => h.toString(HEX_RADIX));
  return `${prefix.join(':')}${IPV6_PREFIX_SUFFIX}`;
}

// ::ffff:a.b.c.d in any spelling (dotted, hex, or uncompressed zeros).
function isIpv4Mapped(hextets: readonly number[]): boolean {
  return hextets.slice(0, IPV4_MAPPED_MARKER_INDEX).every((h) => h === 0) && hextets[IPV4_MAPPED_MARKER_INDEX] === IPV4_MAPPED_MARKER;
}

function mappedIpv4(hextets: readonly number[]): string {
  const high = hextets[IPV4_MAPPED_MARKER_INDEX + 1] ?? 0;
  const low = hextets[IPV4_MAPPED_MARKER_INDEX + 2] ?? 0;
  return [high >> BYTE_BITS, high & BYTE_MASK, low >> BYTE_BITS, low & BYTE_MASK].join('.');
}

// Expands an address `isIP` already accepted into eight numeric hextets.
function expandIpv6(address: string): number[] | null {
  const withoutZone = address.split('%')[0] ?? '';
  const [headPart, tailPart] = withoutZone.split('::');
  const head = parseGroups(headPart ?? '');
  const tail = tailPart === undefined ? [] : parseGroups(tailPart);
  if (head === null || tail === null) return null;
  const missing = IPV6_HEXTETS - head.length - tail.length;
  if (tailPart === undefined ? missing !== 0 : missing < 0) return null;
  return [...head, ...new Array<number>(Math.max(0, missing)).fill(0), ...tail];
}

function parseGroups(part: string): number[] | null {
  if (part === '') return [];
  const groups: number[] = [];
  for (const group of part.split(':')) {
    if (group.includes('.')) {
      // Embedded IPv4 tail (`::ffff:198.51.100.1`) fills the last two hextets.
      const [a = 0, b = 0, c = 0, d = 0] = group.split('.').map(Number);
      groups.push((a << BYTE_BITS) | b, (c << BYTE_BITS) | d);
    } else {
      const n = Number.parseInt(group, HEX_RADIX);
      if (Number.isNaN(n)) return null;
      groups.push(n);
    }
  }
  return groups;
}
