import { guardedRequest } from '../../outbound.js';
import { authedRequest } from '../digest.js';
import { mappingSchema, recordsOf, toAttlog } from '../punchMapping.js';
import { localIn, type PullContext, type PullResult } from './common.js';

/**
 * Any attendance software or device with a JSON API nobody has written a
 * driver for. The company gives a URL to call with the time window written
 * into it, how to sign in, and — through the same field mapping as an HTTP
 * push source — where each field is in the answer.
 *
 * config: {
 *   method: "GET" | "POST",
 *   url: "https://host/api/punches?from={from}&to={to}",          {from} {to} replaced
 *   timeFormat: "iso" | "local" | "date" | "epoch" | "epoch_ms" | "dmy",
 *   auth: "none" | "basic" | "digest" | "header",                 header: apiUsername = header name
 *   body: "{\"from\":\"{from}\",\"to\":\"{to}\"}"                 POST only, same placeholders
 * }
 * Credentials are in apiUsername / apiSecret (encrypted).
 */
const stamp = (at: Date, fmt: string, zone: string) => {
  switch (fmt) {
    case 'epoch':
      return String(Math.floor(at.getTime() / 1000));
    case 'epoch_ms':
      return String(at.getTime());
    case 'date':
      return localIn(at, zone).slice(0, 10);
    case 'dmy': {
      const l = localIn(at, zone);
      return `${l.slice(8, 10)}/${l.slice(5, 7)}/${l.slice(0, 4)} ${l.slice(11, 16)}`;
    }
    case 'local':
      return localIn(at, zone);
    default:
      return at.toISOString();
  }
};

export async function pullHttp(ctx: PullContext): Promise<PullResult> {
  const c = ctx.config || {};
  const template = String(c.url || ctx.baseUrl || '');
  if (!template) return { ok: false, message: 'Set the URL to call.', lines: [], received: 0 };
  const fmt = String(c.timeFormat || 'iso');
  const fill = (s: string) => s.replace(/\{from\}/g, encodeURIComponent(stamp(ctx.from, fmt, ctx.zone))).replace(/\{to\}/g, encodeURIComponent(stamp(ctx.to, fmt, ctx.zone)));
  const url = fill(template);
  const method = String(c.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
  const body = method === 'POST' && c.body ? String(c.body).replace(/\{from\}/g, stamp(ctx.from, fmt, ctx.zone)).replace(/\{to\}/g, stamp(ctx.to, fmt, ctx.zone)) : undefined;
  const headers: Record<string, string> = { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const auth = String(c.auth || (ctx.username || ctx.password ? 'basic' : 'none'));
  let r;
  if (auth === 'header' && ctx.username) {
    headers[ctx.username] = ctx.password;
    r = await guardedRequest(method, url, { headers, body });
  } else if (auth === 'basic' || auth === 'digest') {
    r = await authedRequest(method, url, ctx.username, ctx.password, { headers, body });
  } else r = await guardedRequest(method, url, { headers, body });
  if (r.status === 401 || r.status === 403) return { ok: false, message: `The API refused the credentials (${r.status}).`, lines: [], received: 0, payload: r.text.slice(0, 20_000) };
  if (r.status < 200 || r.status >= 300) return { ok: false, message: `The API answered ${r.status}.`, lines: [], received: 0, payload: r.text.slice(0, 20_000) };
  const payload = r.text.slice(0, 20_000);
  let data: unknown;
  try {
    data = JSON.parse(r.text);
  } catch {
    return { ok: false, message: 'The API did not answer with JSON.', lines: [], received: 0, payload };
  }
  const mapping = mappingSchema.safeParse(ctx.mapping || {});
  if (!mapping.success) return { ok: true, message: 'Received. Set the field mapping to read punches from it.', lines: [], received: 0, payload };
  const records = recordsOf(data, mapping.data);
  const out = toAttlog(records, mapping.data, ctx.zone);
  return { ok: true, message: out.errors.length && !out.lines.length ? out.errors[0] : 'Success', lines: out.lines, sources: out.sources, aside: out.aside, received: records.length, payload };
}
