import { randomUUID } from 'node:crypto';

import { platformPrisma } from '../utils/platformPrisma.js';
import { getSubscription, syncAccountEntitlement } from '../services/subscriptions.js';
import type { NormalizedEvent } from './gateway.js';
import { PaymentsError } from './providers.js';
import { periodEnd } from '../services/pricing/deals.js';

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
  invoice: ev.invoice ?? null,
});
const eventFrom = (n: any): NormalizedEvent => ({
  ...n,
  subscription: n.subscription ? { ...n.subscription, currentPeriodEnd: n.subscription.currentPeriodEnd ? new Date(n.subscription.currentPeriodEnd) : undefined } : undefined,
  invoice: n.invoice ?? undefined,
  raw: null,
});

/**
 * A payment link for one of CLOR's invoices was paid (billing/payLinks.ts):
 * the invoice is marked paid with the provider's payment id, and the
 * subscription is active and paid for the invoice's months, counted from when
 * the current paid period ends (or today), as Mark paid does.
 */
async function payInvoice(ev: NormalizedEvent, rowId: string): Promise<{ status: EventStatus; detail: string | null }> {
  const p = ev.invoice!;
  const inv =
    (p.invoiceId ? await platformPrisma.billingInvoice.findUnique({ where: { id: p.invoiceId } }) : null) ||
    (await platformPrisma.billingInvoice.findFirst({ where: { payLinkId: p.linkId } }));
  if (!inv) return { status: 'RECORDED', detail: 'The payment did not name an invoice CLOR knows, so nothing changed. Find the customer and mark their invoice paid by hand.' };
  if (inv.status === 'PAID') {
    /* A retry of this same event: the invoice was paid by it, only the access update failed. */
    if (inv.paymentEventId === rowId) {
      await syncAccountEntitlement(inv.accountId);
      return { status: 'APPLIED', detail: `Invoice ${inv.number} is paid, and the customer's access is up to date.` };
    }
    if (p.amountPaid && p.amountPaid > 0)
      return { status: 'RECORDED', detail: `Invoice ${inv.number} was already paid, and this second payment of ₹${(p.amountPaid / 100).toFixed(2)} (link ${p.linkId}) changed nothing. Refund it from the provider’s dashboard.` };
    return { status: 'RECORDED', detail: `Invoice ${inv.number} was already paid, so nothing changed.` };
  }
  if (inv.status !== 'ISSUED') return { status: 'RECORDED', detail: `Invoice ${inv.number} was cancelled before this payment arrived. Refund the customer from the provider’s dashboard.` };
  if (p.amountPaid != null && p.amountPaid < inv.total)
    return { status: 'RECORDED', detail: `The customer paid ₹${(p.amountPaid / 100).toFixed(2)}, less than invoice ${inv.number}’s ₹${(inv.total / 100).toFixed(2)}, so it stays unpaid. Settle the difference with them.` };
  const sub = await getSubscription(inv.accountId);
  /* A cancelled or paused subscription is not started again by a late payment: a person decides. */
  const moves = Boolean(sub && LIVE.includes(sub.status));
  const until = paidUntil(sub?.currentPeriodEnd ?? null, inv.months, inv.periodStart);
  const paid = await platformPrisma.$transaction(async (tx) => {
    const done = await tx.billingInvoice.updateMany({
      where: { id: inv.id, status: 'ISSUED' },
      data: { status: 'PAID', paidAt: new Date(), paidAmount: p.amountPaid ?? inv.total, paymentReference: ev.reference ? String(ev.reference).slice(0, 60) : p.linkId, paymentEventId: rowId },
    });
    if (!done.count) return false;
    if (moves) await tx.subscription.updateMany({ where: { accountId: inv.accountId }, data: { status: 'active', currentPeriodEnd: until, gatewayName: ev.gateway } });
    return true;
  });
  if (!paid) return { status: 'RECORDED', detail: `Invoice ${inv.number} changed a moment ago, so nothing changed. Open it to check.` };
  if (!sub) return { status: 'APPLIED', detail: `Invoice ${inv.number} is paid. The account has no subscription, so nothing else changed.` };
  if (!moves)
    return { status: 'RECORDED', detail: `Invoice ${inv.number} is paid, but the subscription is ${STATUS_WORD[sub.status] || sub.status}, so it was not started again. Restart it or refund the customer.` };
  await syncAccountEntitlement(inv.accountId);
  return { status: 'APPLIED', detail: `Invoice ${inv.number} paid online. The subscription is active, paid until ${day(until)}.` };
}

/** Subscription states a payment moves on; a cancelled or paused one waits for a person. */
const LIVE = ['active', 'trialing', 'past_due'];

/**
 * When a payment for `months` leaves the subscription paid until. An invoice
 * for a period (periodStart, YYYY-MM-DD) pays to that period's end, and never
 * shortens what is already paid: the first period's invoice of a deal, whose
 * period the subscription already shows, adds nothing. A payment for a period
 * that has already ended, or with no period, counts from when the paid period
 * ends, or from today if that has passed. Month ends are kept (31 Jan + 1 is 28 Feb).
 */
export function paidUntil(currentPeriodEnd: Date | null, months: number, periodStart?: string | null, now = new Date()) {
  const by = (from: Date) => (months % 12 === 0 ? periodEnd(from, 'YEARLY', months / 12) : periodEnd(from, 'MONTHLY', months));
  const paidTo = currentPeriodEnd && currentPeriodEnd > now ? currentPeriodEnd : null;
  if (periodStart && /^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
    const end = by(new Date(`${periodStart}T00:00:00.000Z`));
    if (end > now) return paidTo && paidTo > end ? paidTo : end;
  }
  return by(paidTo ?? now);
}

/** What an event does to the account's subscription, and the sentence the log shows for it. */
async function applyTo(ev: NormalizedEvent, rowId: string): Promise<{ status: EventStatus; detail: string | null }> {
  if (ev.invoice) return payInvoice(ev, rowId);
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
    const r = await applyTo(ev, id);
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
  const n = row.normalized as { subscription?: unknown; accountId?: string; invoice?: unknown } | null;
  if (n?.invoice) return row.status === 'FAILED';
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


/**
 * A payment made by UPI or bank transfer, recorded by CLOR staff ("Mark
 * paid"). The UTR or bank reference is the event id, so the same payment
 * cannot be recorded twice. The subscription becomes active and is paid
 * until the end of the months the payment covers, counted from when the
 * current paid period ends (or today, if that has passed).
 */
export async function recordManualPayment(input: { accountId: string; amount: number; reference: string; paidOn: Date; months: number; periodStart?: string | null; note?: string | null; userId: string }) {
  const account = await platformPrisma.account.findUnique({ where: { id: input.accountId }, select: { id: true, name: true } });
  if (!account) throw new PaymentsError('No such customer account.', 404);
  const sub = await getSubscription(input.accountId);
  const until = paidUntil(sub?.currentPeriodEnd ?? null, input.months, input.periodStart);
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
    'payment_link.paid': 'Invoice paid online',
    PAYMENT_LINK_EVENT: 'Payment link event',
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
