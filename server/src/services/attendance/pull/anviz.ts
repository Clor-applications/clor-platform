import { randomUUID } from 'node:crypto';

import { readTime } from '../punchMapping.js';
import type { PullContext, PullResult } from './index.js';

/**
 * Anviz CrossChex Cloud — the cloud Anviz readers report to. One endpoint
 * per region (api.us / api.ap / api.eu .crosschexcloud.com), every call a
 * POST of `{ header: { nameSpace, nameAction, version, requestId, timestamp },
 * authorize?: { type: 'token', token }, payload }`:
 *
 *   authorize.token / token        { api_key, api_secret }   → { payload: { token, expires } }
 *   attendance.record / getrecord  { begin_time, end_time, order, page, per_page }
 *                                  → { payload: { list: [{ uuid, checktime, checktype, device: { serial_number, name },
 *                                                          employee: { workno, first_name, last_name } }], pageCount, count } }
 *
 * The API key and secret come from the CrossChex Cloud portal (System →
 * Cloud API). Public clients agree the service allows one request every
 * fifteen seconds, so requests are spaced out, and a token is reused until it
 * expires. `checktype` is not a reliable in/out: the connection's direction
 * decides (state 255). Shape taken from public clients, not tried here.
 */
export const ANVIZ_REGIONS: Record<string, string> = {
  us: 'https://api.us.crosschexcloud.com/',
  ap: 'https://api.ap.crosschexcloud.com/',
  eu: 'https://api.eu.crosschexcloud.com/',
};

/** Tokens and the last request time, per account; the pull runs in one process. */
const tokens = new Map<string, { token: string; exp: number }>();
const lastAt = new Map<string, number>();
export const GAP_MS = 15_000;

const tsNow = () => new Date().toISOString().replace('Z', '+00:00');

async function call(ctx: PullContext, nameSpace: string, nameAction: string, payload: Record<string, unknown>, token?: string) {
  const key = ctx.baseUrl;
  const wait = (lastAt.get(key) || 0) + (ctx.config?.gapMs ?? GAP_MS) - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt.set(key, Date.now());
  const body: Record<string, unknown> = { header: { nameSpace, nameAction, version: '1.0', requestId: randomUUID(), timestamp: tsNow() }, payload };
  if (token) body.authorize = { type: 'token', token };
  const f = ctx.fetchImpl || fetch;
  const r = await f(`${ctx.baseUrl}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, json, text };
}

const errorOf = (json: any) => (json?.payload?.type === 'AUTH_ERROR' ? 'auth' : json?.payload?.type === 'TOKEN_EXPIRES' ? 'expired' : json?.header?.name === 'Exception' ? String(json?.payload?.message || json?.payload?.type || 'error') : null);

async function tokenFor(ctx: PullContext, fresh = false) {
  const key = `${ctx.baseUrl}|${ctx.username}`;
  const have = tokens.get(key);
  if (!fresh && have && have.exp > Date.now() + 60_000) return { token: have.token };
  const r = await call(ctx, 'authorize.token', 'token', { api_key: ctx.username, api_secret: ctx.password });
  const token = r.json?.payload?.token;
  if (!token) {
    const why = errorOf(r.json);
    return { error: why === 'auth' ? 'CrossChex Cloud refused the API key or secret.' : r.status >= 400 ? `CrossChex Cloud answered ${r.status}.` : why || 'CrossChex Cloud gave no token — is the region right?' };
  }
  const exp = r.json?.payload?.expires ? Date.parse(r.json.payload.expires) : Date.now() + 3_600_000;
  tokens.set(key, { token, exp: Number.isFinite(exp) ? exp : Date.now() + 3_600_000 });
  return { token };
}

export async function pullAnviz(ctx: PullContext): Promise<PullResult> {
  if (!ctx.baseUrl) return { ok: false, message: 'Choose the CrossChex Cloud region.', lines: [], received: 0 };
  if (!ctx.username || !ctx.password) return { ok: false, message: 'Give the API key and secret from CrossChex Cloud (System → Cloud API).', lines: [], received: 0 };
  let t = await tokenFor(ctx);
  if (!t.token) return { ok: false, message: t.error!, lines: [], received: 0 };
  const lines: string[] = [];
  let received = 0;
  let payload: string | undefined;
  let retried = false;
  const begin = ctx.from.toISOString().replace('Z', '+00:00');
  const end = ctx.to.toISOString().replace('Z', '+00:00');
  for (let page = 1; page <= 5; page += 1) {
    const r = await call(ctx, 'attendance.record', 'getrecord', { begin_time: begin, end_time: end, order: 'asc', page, per_page: 100 }, t.token);
    const list = r.json?.payload?.list;
    if (!Array.isArray(list)) {
      const why = errorOf(r.json);
      if ((why === 'expired' || why === 'auth') && !retried) {
        retried = true;
        t = await tokenFor(ctx, true);
        if (!t.token) return { ok: false, message: t.error!, lines, received };
        page -= 1;
        continue;
      }
      return { ok: false, message: why === 'auth' ? 'CrossChex Cloud refused the API key or secret.' : why || (r.status >= 400 ? `CrossChex Cloud answered ${r.status}.` : 'CrossChex Cloud gave no records list.'), lines, received, payload };
    }
    if (page === 1) payload = r.text.slice(0, 20_000);
    for (const e of list) {
      received += 1;
      const code = String(e?.employee?.workno ?? e?.workno ?? '').trim();
      const when = readTime(e?.checktime, 'auto', ctx.zone);
      if (!code || !when) continue;
      lines.push(`${code}\t${when}\t255\t0`);
    }
    const pageCount = Number(r.json?.payload?.pageCount) || 0;
    if (list.length < 100 || page >= pageCount) break;
  }
  return { ok: true, message: 'Success', lines, received, payload };
}

/** For tests: forget cached tokens. */
export const _resetAnviz = () => {
  tokens.clear();
  lastAt.clear();
};
