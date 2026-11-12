import { createHmac, timingSafeEqual } from 'node:crypto';

/** fetch, injectable so the adapters' tests run on recorded provider answers instead of the network. */
export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export const defaultFetch: Fetcher = (url, init) => fetch(url, init);

/** One header, whatever case the provider sent it in. */
export function header(headers: Record<string, unknown>, name: string): string {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === want) return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
  return '';
}

export const rawText = (raw: string | Buffer) => (Buffer.isBuffer(raw) ? raw.toString('utf8') : raw);

export const hmac = (key: string, data: string, encoding: 'hex' | 'base64') => createHmac('sha256', key).update(data, 'utf8').digest(encoding);

/** Constant-time string compare. */
export function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Rupees as a provider sends them (1062, "1062.5", 1062.00) to whole paise, without floating point. */
export function rupeesToPaise(v: unknown): number | null {
  if (v == null || v === '') return null;
  const m = /^(\d+)(?:\.(\d{1,2})\d*)?$/.exec(String(v).trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0'));
}

export function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Calls a provider with a time limit. A network failure comes back as status 0. */
export async function call(fetcher: Fetcher, url: string, init: { method: string; headers: Record<string, string>; body?: string }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const r = await fetcher(url, { ...init, signal: ac.signal });
    const text = await r.text();
    return { status: r.status, body: parseJson(text) };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}
