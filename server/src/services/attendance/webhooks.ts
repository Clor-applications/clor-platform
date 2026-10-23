import { createHmac } from 'node:crypto';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { decryptSecret } from '../mailer.js';
import { guardedPost } from '../outbound.js';
import { appLive, type Refusal } from '../principalAllowed.js';

/**
 * Events CLOR sends to a company's webhooks, as they happen.
 *
 *   POST <url>
 *   Content-Type: application/json
 *   X-Clor-Event: <event>
 *   X-Clor-Delivery: <id>            the same on every retry of one event
 *   X-Clor-Attempt: 1, 2, …
 *   X-Clor-Timestamp: <unix seconds> when this attempt was sent
 *   X-Clor-Signature: sha256=<hex HMAC-SHA256 of the raw body with the webhook secret>
 *   { "event": "…", "orgId": "…", "sentAt": "…", "data": … }
 *
 * Every event is a WebhookDelivery row first, then sent. A failure (no 2xx,
 * no answer) is retried on a schedule that backs off — a minute, five, thirty,
 * two hours, twelve — and then marked failed; the Integrations screen lists
 * deliveries and can send any one again. Delivery never holds up the action
 * that caused it.
 */
export const WEBHOOK_EVENTS = [
  'punch',
  'day',
  'employee.created',
  'employee.updated',
  'employee.left',
  'employee.transferred',
  'employee.rehired',
  'leave.requested',
  'leave.approved',
  'leave.rejected',
  'leave.cancelled',
  'correction.approved',
  'month.closed',
  'month.reopened',
  'reader.offline',
  'reader.online',
  'payroll.locked',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const EVENT_HELP: Record<WebhookEvent, string> = {
  punch: 'Punches as they arrive (a batch per arrival)',
  day: 'A day worked out or changed (in, out, status, late, overtime)',
  'employee.created': 'Somebody added',
  'employee.updated': 'An employee’s details changed',
  'employee.left': 'Somebody marked as having left',
  'employee.transferred': 'Somebody moved: department, location, branch, work state, designation, manager or type (with the date it counts from)',
  'employee.rehired': 'Somebody who had left is back',
  'leave.requested': 'Leave asked for',
  'leave.approved': 'Leave approved',
  'leave.rejected': 'Leave rejected',
  'leave.cancelled': 'Leave cancelled',
  'correction.approved': 'An attendance correction approved',
  'month.closed': 'An attendance month closed for payroll',
  'month.reopened': 'An attendance month reopened',
  'reader.offline': 'A reader has gone quiet',
  'reader.online': 'A reader is back',
  'payroll.locked': 'A pay run locked: payslips are final',
};

/** Minutes to wait before each retry; after the last, the delivery is marked failed. */
export const RETRY_MINUTES = [1, 5, 30, 120, 720];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

/*
 * A-45: who sends a delivery, and when it is next due.
 *
 * A delivery used to be written with no next-attempt time, and only the
 * first attempt's result set one. An instance that stopped between writing the
 * row and recording that attempt left it PENDING with nothing due, ever: the
 * retry job looked only for rows whose time had come. And the retry job sent
 * whatever it found, so two instances (or a retry racing the first send) could
 * send one delivery twice.
 *
 * Now every row has a time. Before an attempt, the sender claims the row by
 * moving that time CLAIM_MS ahead with a conditional update; only the update
 * that lands sends. A sender that dies mid-attempt leaves a row that comes due
 * again when the claim runs out, and is retried.
 */
export const CLAIM_MS = 2 * 60_000;
/** While the company's Attendance is paused or closing, retries wait this long and try again. */
const PAUSED_MS = 60 * 60_000;

const inFlight = new Set<Promise<unknown>>();
const track = <T>(p: Promise<T>) => {
  inFlight.add(p);
  p.finally(() => inFlight.delete(p)).catch(() => undefined);
  return p;
};

/** For tests: wait until every delivery started so far has finished. */
export async function flushWebhooks() {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

export const signBody = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

type Hook = { id: string; url: string; secret: string };

/** One attempt at one delivery; schedules the next or settles it. */
async function attempt(delivery: { id: string; webhookId: string; event: string; body: string; attempts: number }, hook: Hook, now = new Date()) {
  const secret = decryptSecret(hook.secret);
  const n = delivery.attempts + 1;
  let status = 0;
  let error: string | null = null;
  try {
    const r = await guardedPost(hook.url, delivery.body, {
      'Content-Type': 'application/json',
      'User-Agent': 'CLOR-Webhooks/2',
      'X-Clor-Event': delivery.event,
      'X-Clor-Delivery': delivery.id,
      'X-Clor-Attempt': String(n),
      'X-Clor-Timestamp': String(Math.floor(now.getTime() / 1000)),
      'X-Clor-Signature': signBody(secret, delivery.body),
    });
    status = r.status;
    if (status < 200 || status >= 300) error = `Answered ${status}`;
  } catch (e: any) {
    error = String(e?.message || e).slice(0, 300);
  }
  const ok = !error;
  const retryIn = ok || n >= MAX_ATTEMPTS ? null : RETRY_MINUTES[n - 1];
  await peoplePrisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts: n,
      lastStatus: status || null,
      lastError: error,
      status: ok ? 'OK' : retryIn == null ? 'FAILED' : 'PENDING',
      nextAttemptAt: retryIn == null ? null : new Date(now.getTime() + retryIn * 60_000),
      deliveredAt: ok ? now : null,
    },
  });
  await peoplePrisma.webhook
    .update({ where: { id: hook.id }, data: { lastStatus: status || null, lastError: error, lastDeliveredAt: now } })
    .catch(() => undefined);
  return { ok, status, error: error ?? undefined };
}

/** Record and send one event to one webhook now. Returns the first attempt's outcome. */
export async function deliver(hook: Hook & { accountId?: string }, event: string, orgId: string, data: unknown) {
  const body = JSON.stringify({ event, orgId, sentAt: new Date().toISOString(), data });
  const accountId = hook.accountId || (await peoplePrisma.webhook.findUnique({ where: { id: hook.id }, select: { accountId: true } }))?.accountId || '';
  /* Created already claimed by this sender; if it never records the attempt, the retry job takes it when the claim runs out. */
  const row = await peoplePrisma.webhookDelivery.create({ data: { accountId, orgId, webhookId: hook.id, event, body: body.slice(0, 20_000), nextAttemptAt: new Date(Date.now() + CLAIM_MS) } });
  return attempt(row, hook);
}

/** Take one due delivery for this sender: true only for the one conditional update that lands. */
async function claim(d: { id: string; attempts: number; nextAttemptAt: Date | null }, now: Date) {
  const r = await peoplePrisma.webhookDelivery.updateMany({
    where: { id: d.id, status: 'PENDING', attempts: d.attempts, nextAttemptAt: d.nextAttemptAt },
    data: { nextAttemptAt: new Date(now.getTime() + CLAIM_MS) },
  });
  return r.count === 1;
}

/** Try every delivery whose time has come. Run every minute by the scheduler. */
export async function retryDueDeliveries(now = new Date(), limit = 50) {
  const due = await peoplePrisma.webhookDelivery.findMany({
    where: {
      status: 'PENDING',
      /* Rows written before every delivery had a time: due once they are older than a claim. */
      OR: [{ nextAttemptAt: { lte: now } }, { nextAttemptAt: null, createdAt: { lt: new Date(now.getTime() - CLAIM_MS) } }],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
  });
  if (!due.length) return 0;
  const hooks = new Map((await peoplePrisma.webhook.findMany({ where: { id: { in: [...new Set(due.map((d) => d.webhookId))] } } })).map((h) => [h.id, h]));
  /* A retry is the company's integration working without anybody signed in: only while Attendance is live for it. */
  const live = new Map<string, Promise<Refusal | null>>();
  let tried = 0;
  for (const d of due) {
    const hook = hooks.get(d.webhookId);
    if (!hook || !hook.isActive) {
      await peoplePrisma.webhookDelivery.updateMany({ where: { id: d.id, status: 'PENDING' }, data: { status: 'FAILED', lastError: 'Webhook switched off or removed', nextAttemptAt: null } });
      continue;
    }
    const key = `${d.accountId}:${d.orgId}`;
    if (!live.has(key)) live.set(key, appLive(d.accountId, d.orgId, 'attendance'));
    const refused = await live.get(key);
    if (refused) {
      await peoplePrisma.webhookDelivery.updateMany({
        where: { id: d.id, status: 'PENDING', attempts: d.attempts },
        data: { nextAttemptAt: new Date(now.getTime() + PAUSED_MS), lastError: `Waiting: ${refused.error}` },
      });
      continue;
    }
    if (!(await claim(d, now))) continue;
    await attempt(d, hook, now);
    tried += 1;
  }
  return tried;
}

/** Send a past delivery again, whatever its state — from the Integrations screen. */
export async function resendDelivery(orgId: string, id: string) {
  const d = await peoplePrisma.webhookDelivery.findFirst({ where: { id, orgId } });
  if (!d) return null;
  const hook = await peoplePrisma.webhook.findFirst({ where: { id: d.webhookId, orgId } });
  if (!hook) return null;
  return attempt({ ...d, attempts: 0 }, hook);
}

/** Old deliveries are history nobody reads: keep a month. */
export async function pruneDeliveries(now = new Date()) {
  const r = await peoplePrisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
  return r.count;
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
  track(
    (async () => {
      if (!(await hasWebhooks(orgId))) return;
      const hooks = await peoplePrisma.webhook.findMany({ where: { orgId, isActive: true, events: { contains: event } } });
      await Promise.all(hooks.filter((h) => h.events.split(',').includes(event)).map((h) => deliver(h, event, orgId, data)));
    })()
  );
}

/* ---- The shapes events carry, so every emitter says the same thing. ---- */

export const employeeEvent = (e: any) => ({
  id: e.id,
  code: e.code ?? null,
  name: e.name,
  status: e.status,
  department: e.department ?? null,
  designation: e.designation ?? null,
  dateOfJoining: e.dateOfJoining ?? null,
  dateOfLeaving: e.dateOfLeaving ?? null,
  readerId: e.devicePin || e.code || null,
  updatedAt: e.updatedAt ?? null,
});

export const leaveEvent = (r: any) => ({
  id: r.id,
  employeeId: r.employeeId,
  employeeCode: r.employeeCode ?? null,
  employeeName: r.employeeName ?? null,
  leaveType: r.leaveTypeName ?? null,
  isPaid: r.isPaid ?? null,
  fromDate: r.fromDate,
  toDate: r.toDate,
  days: r.days,
  status: r.status,
  reason: r.reason,
  reviewNote: r.reviewNote ?? null,
});

/** Which leave event a request's new status is. */
export const leaveEventFor = (status: string): WebhookEvent | null =>
  status === 'APPROVED' ? 'leave.approved' : status === 'REJECTED' ? 'leave.rejected' : status === 'CANCELLED' ? 'leave.cancelled' : status === 'PENDING' ? 'leave.requested' : null;
