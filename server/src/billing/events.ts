import { randomUUID } from 'node:crypto';

import { platformPrisma } from '../utils/platformPrisma.js';
import { getSubscription, syncAccountEntitlement } from '../services/subscriptions.js';
import type { NormalizedEvent } from './gateway.js';
import { PaymentsError } from './providers.js';

/**
 * Every payment event CLOR hears of, kept in PaymentEvent for the Payments
 * log: provider webhooks, payments CLOR staff record by hand, and webhooks
 * refused because their signature did not match.
 *
 * Idempotent: a provider event id is kept once (unique gateway + eventId) and
 * a replay changes nothing. An event that could not be applied is kept as
 * FAILED with the reason, and staff can apply it again (Retry).
 */
export type EventStatus = 'APPLIED' | 'RECORDED' | 'FAILED' | 'REJECTED';

const STATUS_WORD: Record<string, string> = { active: 'active', trialing: 'on trial', past_due: 'overdue', paused: 'paused', cancelled: 'cancelled' };
const day = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** The event without its raw body, as kept for a retry. Dates as ISO text. */
const normalizedOf = (ev: NormalizedEvent) => ({
  gateway: ev.gateway,
  eventId: ev.eventId,
  type: ev.type,
  accountId: ev.accountId ?? null,
  amount: ev.amount ?? null,
  reference: ev.reference ?? null,
  subscription: ev.subscription ? { ...ev.subscription, currentPeriodEnd: ev.subscription.currentPeriodEnd ? new Date(ev.subscription.currentPeriodEnd).toISOString() : null } : null,
});
const eventFrom = (n: any): NormalizedEvent => ({
  ...n,
  subscription: n.subscription ? { ...n.subscription, currentPeriodEnd: n.subscription.currentPeriodEnd ? new Date(n.subscription.currentPeriodEnd) : undefined } : undefined,
  raw: null,
});

/** What an event does to the account's subscription, and the sentence the log shows for it. */
async function applyTo(ev: NormalizedEvent): Promise<{ status: EventStatus; detail: string | null }> {
  if (!ev.subscription) return { status: 'RECORDED', detail: null };
  if (!ev.accountId) return { status: 'RECORDED', detail: 'The event did not name a CLOR account, so no subscription changed.' };
  const s = ev.subscription;
  const n = await platformPrisma.subscription.updateMany({
    where: { accountId: ev.accountId },
    data: {
      status: s.status ?? undefined,
      currentPeriodEnd: s.currentPeriodEnd ?? undefined,
      gatewayName: ev.gateway,
      gatewaySubscriptionId: s.gatewaySubscriptionId ?? undefined,
    },
  });
  if (!n.count) return { status: 'RECORDED', detail: 'This account has no subscription yet, so nothing changed. Retry once it has one.' };
  await syncAccountEntitlement(ev.accountId);
  const parts = [s.status ? `The subscription is now ${STATUS_WORD[s.status] || s.status}` : 'The subscription was updated', s.currentPeriodEnd ? `, paid until ${day(new Date(s.currentPeriodEnd))}` : ''];
  return { status: 'APPLIED', detail: `${parts.join('')}.` };
}

async function applyRow(id: string, ev: NormalizedEvent) {
  try {
    const r = await applyTo(ev);
    await platformPrisma.paymentEvent.update({ where: { id }, data: { status: r.status, detail: r.detail, processed: true, processedAt: new Date(), attempts: { increment: 1 } } });
    return { applied: true, id, status: r.status, detail: r.detail };
  } catch (e) {
    const detail = `The subscription could not be updated: ${String(e instanceof Error ? e.message : e).slice(0, 200)}. Retry when this is fixed.`;
    await platformPrisma.paymentEvent.update({ where: { id }, data: { status: 'FAILED', detail, attempts: { increment: 1 } } });
    return { applied: false, id, status: 'FAILED' as EventStatus, detail };
  }
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';

/**
 * Keep a verified event and apply it. A replay of an event already kept is a
 * no-op: { applied: false, duplicate: true }.
 */
export async function applyGatewayEvent(ev: NormalizedEvent, by?: { userId?: string }): Promise<{ applied: boolean; duplicate?: boolean; id?: string; status?: EventStatus; detail?: string | null }> {
  let id: string;
  try {
    const row = await platformPrisma.paymentEvent.create({
      data: {
        gateway: ev.gateway,
        eventId: ev.eventId,
        type: ev.type,
        accountId: ev.accountId ?? null,
        payload: JSON.stringify(ev.raw ?? null).slice(0, 20_000),
        amount: ev.amount ?? null,
        reference: ev.reference ?? null,
        normalized: normalizedOf(ev),
        status: 'RECORDED',
        recordedByUserId: by?.userId ?? null,
      },
    });
    id = row.id;
  } catch (e) {
    if (isUnique(e)) return { applied: false, duplicate: true };
    throw e;
  }
  return applyRow(id, ev);
}

/** Whether Retry makes sense: it failed, or it waits for a subscription that may exist now. */
export const retryable = (row: { status: string; normalized: unknown }) => {
  const n = row.normalized as { subscription?: unknown; accountId?: string } | null;
  return (row.status === 'FAILED' || row.status === 'RECORDED') && Boolean(n?.subscription && n?.accountId);
};

/** Apply a kept event again. */
export async function retryEvent(id: string) {
  const row = await platformPrisma.paymentEvent.findUnique({ where: { id } });
  if (!row) throw new PaymentsError('No such payment event.', 404);
  if (!retryable(row)) throw new PaymentsError(row.status === 'APPLIED' ? 'This event is already applied.' : 'This event has nothing to apply.', 409);
  const before = row.status;
  const r = await applyRow(id, eventFrom(row.normalized));
  return { ...r, before, gateway: row.gateway, eventId: row.eventId };
}

/**
 * Keep a refused webhook so staff can see why a provider's events are not
 * arriving. At most 200 an hour, so a stranger posting junk cannot fill the table.
 */
export async function recordRejected(gateway: string, reason: string, raw: string) {
  const recent = await platformPrisma.paymentEvent.count({ where: { status: 'REJECTED', receivedAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recent >= 200) return;
  await platformPrisma.paymentEvent.create({
    data: { gateway, eventId: `rejected:${randomUUID()}`, type: 'rejected', payload: raw.slice(0, 2000), status: 'REJECTED', detail: reason },
  });
}

const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};

/**
 * A payment made by UPI or bank transfer, recorded by CLOR staff ("Mark
 * paid"). The UTR or bank reference is the event id, so the same payment
 * cannot be recorded twice. The subscription becomes active and is paid
 * until the end of the months the payment covers, counted from when the
 * current paid period ends (or today, if that has passed).
 */
export async function recordManualPayment(input: { accountId: string; amount: number; reference: string; paidOn: Date; months: number; note?: string | null; userId: string }) {
  const account = await platformPrisma.account.findUnique({ where: { id: input.accountId }, select: { id: true, name: true } });
  if (!account) throw new PaymentsError('No such customer account.', 404);
  const sub = await getSubscription(input.accountId);
  const from = sub?.currentPeriodEnd && sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
  const until = addMonths(from, input.months);
  const reference = input.reference.trim().toUpperCase();
  const ev: NormalizedEvent = {
    gateway: 'manual',
    eventId: `manual:${reference}`,
    type: 'payment.manual',
    accountId: input.accountId,
    amount: input.amount,
    reference,
    subscription: sub ? { status: 'active', currentPeriodEnd: until } : undefined,
    raw: { amount: input.amount, reference, paidOn: input.paidOn.toISOString().slice(0, 10), months: input.months, note: input.note || null },
  };
  const r = await applyGatewayEvent(ev, { userId: input.userId });
  if (r.duplicate) throw new PaymentsError(`A payment with reference ${reference} is already recorded.`, 409);
  if (!sub) {
    const detail = 'Recorded. This account has no subscription yet, so nothing else changed.';
    await platformPrisma.paymentEvent.update({ where: { id: r.id! }, data: { detail } });
    return { ...r, detail, account, paidUntil: null };
  }
  return { ...r, account, paidUntil: until };
}

/** In plain words, what an event was. */
export function describe(type: string): string {
  const known: Record<string, string> = {
    PAYMENT_SUCCESS_WEBHOOK: 'Payment received',
    PAYMENT_FAILED_WEBHOOK: 'Payment failed',
    PAYMENT_USER_DROPPED_WEBHOOK: 'Customer left before paying',
    'payment.captured': 'Payment received',
    'payment.authorized': 'Payment authorised',
    'payment.failed': 'Payment failed',
    'payment.manual': 'Payment recorded by hand',
    rejected: 'Event refused',
  };
  if (known[type]) return known[type];
  if (/^subscription\./.test(type)) return `Subscription ${type.slice(13).replace(/_/g, ' ')}`;
  if (/^SUBSCRIPTION_/.test(type)) return `Subscription ${type.slice(13).replace(/_WEBHOOK$/, '').replace(/_/g, ' ').toLowerCase()}`;
  return type;
}

export const EVENT_STATUSES: EventStatus[] = ['APPLIED', 'RECORDED', 'FAILED', 'REJECTED'];

/** The Payments log, newest first, 50 at a time. */
export async function listEvents(q: { status?: string; gateway?: string; before?: string }) {
  const where: Record<string, unknown> = {};
  if (q.status && (EVENT_STATUSES as string[]).includes(q.status)) where.status = q.status;
  if (q.gateway) where.gateway = q.gateway;
  if (q.before) where.receivedAt = { lt: new Date(q.before) };
  const rows = await platformPrisma.paymentEvent.findMany({ where, orderBy: { receivedAt: 'desc' }, take: 51 });
  const page = rows.slice(0, 50);
  const ids = [...new Set(page.map((r) => r.accountId).filter(Boolean))] as string[];
  const accounts = ids.length ? await platformPrisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(accounts.map((a) => [a.id, a.name]));
  return {
    events: page.map((r) => ({
      id: r.id,
      at: r.receivedAt,
      gateway: r.gateway,
      type: r.type,
      what: describe(r.type),
      accountId: r.accountId,
      accountName: r.accountId ? (name.get(r.accountId) ?? null) : null,
      amount: r.amount,
      reference: r.reference,
      status: r.status,
      detail: r.detail,
      attempts: r.attempts,
      canRetry: retryable(r),
    })),
    next: rows.length > 50 ? page[page.length - 1].receivedAt.toISOString() : null,
  };
}
