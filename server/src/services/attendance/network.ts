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

/** At most this many approved addresses per reader; the oldest goes first. */
export const MAX_NETWORKS = 20;
