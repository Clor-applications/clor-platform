import type { Request } from 'express';

/**
 * The internet address a request came from, as one canonical string: IPv4
 * dotted, IPv6 fully expanded and lower-case. Behind the api.clor.in Worker
 * this is Cloudflare's verified client address (app.ts trust proxy), so it
 * cannot be set by the caller.
 */
export function networkOf(req: Request): string | null {
  const raw = String(req.ip || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(raw)) {
    return raw.split('.').every((o) => Number(o) <= 255) ? raw.split('.').map(Number).join('.') : null;
  }
  return expandV6(raw);
}

function expandV6(ip: string): string | null {
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(':')) return null;
  const halves = ip.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const parts = [...head, ...Array(fill).fill('0'), ...tail];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => p.padStart(4, '0')).join(':');
}

/**
 * Two addresses in the same small block: the same /24 for IPv4, the same /56
 * for IPv6 — what an office line's dynamic address moves within, and far too
 * narrow for someone elsewhere to share by chance.
 */
export function sameBlock(a: string, b: string) {
  if (a.includes('.') !== b.includes('.')) return false;
  if (a.includes('.')) return a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.');
  return a.replace(/:/g, '').slice(0, 14) === b.replace(/:/g, '').slice(0, 14);
}

/**
 * The block an address belongs to, as a key: its /24 for IPv4, its /64 for IPv6 (what one line or one
 * provider customer gets). Anything that keys a limit or a cap on unknown callers keys it on this, so
 * moving through the addresses of one block does not buy more (review of #144). Accepts any form of
 * address; null when it is not one.
 */
export function blockOf(ip: string | null | undefined): string | null {
  const raw = String(ip || '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(raw)) {
    const o = raw.split('.').map(Number);
    return o.every((x) => x <= 255) ? `${o.slice(0, 3).join('.')}.0/24` : null;
  }
  const v6 = expandV6(raw);
  return v6 ? `${v6.split(':').slice(0, 4).join(':')}::/64` : null;
}

/** At most this many approved addresses per reader; the oldest goes first. */
export const MAX_NETWORKS = 20;

// ---------------------------------------------------------------------------
// The allow-list a company sets for a reader (AttendanceDevice.ipAllowList)
// ---------------------------------------------------------------------------

/** At most this many addresses or ranges per reader. */
export const MAX_ALLOW_LIST = 20;

const bitsOf = (canonical: string): { bits: bigint; width: number } =>
  canonical.includes('.')
    ? { bits: canonical.split('.').reduce((n, o) => (n << 8n) | BigInt(Number(o)), 0n), width: 32 }
    : { bits: BigInt(`0x${canonical.replace(/:/g, '')}`), width: 128 };

const canonicalOf = (raw: string): string | null => {
  const ip = raw.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip)) return ip.split('.').every((o) => Number(o) <= 255) ? ip.split('.').map(Number).join('.') : null;
  return expandV6(ip);
};

/**
 * One entry of an allow-list as a person types it — an address
 * ("203.0.113.7") or a range ("203.0.113.0/24", "2001:db8::/48") — in the one
 * form it is stored and compared in: canonical address, a slash, the prefix
 * length, with the bits past the prefix cleared. Null when it is neither.
 */
export function parseRange(input: string): string | null {
  const m = /^([^/\s]+)(?:\/(\d{1,3}))?$/.exec(String(input || '').trim());
  if (!m) return null;
  const ip = canonicalOf(m[1]);
  if (!ip) return null;
  const { bits, width } = bitsOf(ip);
  const prefix = m[2] === undefined ? width : Number(m[2]);
  if (prefix > width) return null;
  /* "/0" is every address there is: an allow-list that allows everyone is a mistake, not a rule. */
  if (prefix === 0) return null;
  const mask = ((1n << BigInt(prefix)) - 1n) << BigInt(width - prefix);
  const base = bits & mask;
  const text =
    width === 32
      ? [24n, 16n, 8n, 0n].map((s) => Number((base >> s) & 255n)).join('.')
      : base.toString(16).padStart(32, '0').match(/.{4}/g)!.join(':');
  return `${text}/${prefix}`;
}

/** Is this address (any form) inside this stored range (parseRange's form)? */
export function inRange(ip: string | null | undefined, range: string): boolean {
  const addr = canonicalOf(String(ip || ''));
  const [base, len] = String(range).split('/');
  if (!addr || !base || addr.includes('.') !== base.includes('.')) return false;
  const a = bitsOf(addr);
  const prefix = Number(len);
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > a.width) return false;
  const shift = BigInt(a.width - prefix);
  return a.bits >> shift === bitsOf(base).bits >> shift;
}

/**
 * A whole list as typed: each entry parsed, duplicates dropped. `bad` is the
 * first entry that is not an address or a range, for the message.
 */
export function parseAllowList(entries: string[]): { list: string[] } | { bad: string } {
  const list: string[] = [];
  for (const raw of entries.map((e) => String(e || '').trim()).filter(Boolean)) {
    const r = parseRange(raw);
    if (!r) return { bad: raw };
    if (!list.includes(r)) list.push(r);
  }
  return { list };
}

/** A stored range as it is shown: a single address without its "/32" or "/128". */
export const showRange = (range: string) => range.replace(/^([\d.]+)\/32$/, '$1').replace(/^([0-9a-f:]+)\/128$/, '$1');
