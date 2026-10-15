import { createHmac } from 'node:crypto';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { decryptSecret } from '../mailer.js';
import { guardedPost } from '../outbound.js';

/**
 * Events CLOR sends to a company's webhooks, as they happen:
 *   punch — punches from readers, e-Time Office or the API (a batch per arrival)
 *   day   — a day worked out or changed (in, out, status, late, overtime)
 *
 *   POST <url>
 *   Content-Type: application/json
 *   X-Clor-Event: punch | day
 *   X-Clor-Signature: sha256=<hex HMAC-SHA256 of the raw body with the webhook secret>
 *   { "event": "punch", "orgId": "…", "sentAt": "…", "data": … }
 *
 * Delivery is after the response, never holding up a punch; one attempt with a
 * 10-second limit, and the outcome kept on the webhook (last status / error).
 */
export const WEBHOOK_EVENTS = ['punch', 'day'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const inFlight = new Set<Promise<unknown>>();

/** For tests: wait until every delivery started so far has finished. */
export async function flushWebhooks() {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

export const signBody = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

export async function deliver(hook: { id: string; url: string; secret: string }, event: string, orgId: string, data: unknown) {
  const body = JSON.stringify({ event, orgId, sentAt: new Date().toISOString(), data });
  const secret = decryptSecret(hook.secret);
  try {
    const r = await guardedPost(hook.url, body, {
      'Content-Type': 'application/json',
      'User-Agent': 'CLOR-Webhooks/1',
      'X-Clor-Event': event,
      'X-Clor-Signature': signBody(secret, body),
    });
    const ok = r.status >= 200 && r.status < 300;
    await peoplePrisma.webhook.update({
      where: { id: hook.id },
      data: { lastStatus: r.status, lastError: ok ? null : `Answered ${r.status}`, lastDeliveredAt: new Date() },
    });
    return { ok, status: r.status };
  } catch (e: any) {
    const message = String(e?.message || e).slice(0, 300);
    await peoplePrisma.webhook.update({ where: { id: hook.id }, data: { lastStatus: null, lastError: message, lastDeliveredAt: new Date() } }).catch(() => undefined);
    return { ok: false, status: 0, error: message };
  }
}

/*
 * Which companies have webhooks at all, cached for 30 s: a day is written for
 * every punch and every leave day, and most companies have none to send to.
 * Changing a webhook clears the cache (forgetWebhooks).
 */
const known = new Map<string, { at: number; any: boolean }>();
export const forgetWebhooks = (orgId: string) => known.delete(orgId);
async function hasWebhooks(orgId: string) {
  const k = known.get(orgId);
  if (k && Date.now() - k.at < 30_000) return k.any;
  const any = (await peoplePrisma.webhook.count({ where: { orgId, isActive: true } })) > 0;
  known.set(orgId, { at: Date.now(), any });
  return any;
}

/** Send an event to every active webhook of the company that wants it. Never throws, never waits. */
export function emit(orgId: string, event: WebhookEvent, data: unknown) {
  const p = (async () => {
    if (!(await hasWebhooks(orgId))) return;
    const hooks = await peoplePrisma.webhook.findMany({ where: { orgId, isActive: true, events: { contains: event } } });
    await Promise.all(hooks.filter((h) => h.events.split(',').includes(event)).map((h) => deliver(h, event, orgId, data)));
  })().catch(() => undefined);
  inFlight.add(p);
  p.finally(() => inFlight.delete(p));
}
