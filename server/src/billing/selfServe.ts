import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { clearAccessCache } from '../utils/accessCache.js';
import { syncAccountEntitlement } from '../services/subscriptions.js';
import { recordAccountEvent } from '../services/accountMembership.js';
import { publishedBook } from '../services/pricing/books.js';
import { fromBookPlan, fromCustom, periodEnd, priceDeal, unitWord, DealError, type DealOffer, type DealPlan } from '../services/pricing/deals.js';
import type { PricePeriod } from '../services/pricing/engine.js';
import { LeaseLost, exclusive, leaseFor } from '../services/jobLease.js';
import { registerJob } from '../services/jobRegistry.js';
import { buyerFor, createDraft, deleteDraft, issueInvoice, totalsFor, type Line } from './invoices.js';
import { cancelUnsentInvoiceMail } from './invoiceMailCancel.js';
import { PaymentsError } from './providers.js';

/**
 * Seats a customer adds to their own plan from Workspace (owner, 17 Nov 2026:
 * "we don't want clients to stuck somewhere"; Claude Team and Microsoft 365
 * work the same way).
 *
 * The seats work the moment they are added: the subscription's count goes up,
 * and the limit on users or employees (services/entitlements.ts boughtSeats)
 * reads it. A prorated invoice for the rest of the paid period is issued at
 * the same moment, due in `payDays` (14). Paid: the change is PAID and nothing
 * else moves (an ADDON invoice never moves the paid period, billing/events.ts).
 * Unpaid by then: the invoice is cancelled and those seats alone come off
 * (LAPSED); the rest of the account is untouched.
 *
 * Off until CLOR staff switch it on (Ops, Invoice settings). Only an active,
 * priced plan sold by the user or by the employee, with nothing overdue and no
 * other addition waiting to be paid. Removing seats, apps and refunds stay
 * with CLOR staff.
 */

export const SELF_SERVE_KEY = 'billing.selfServe';
export type SelfServe = { on: boolean; maxPerChange: number; payDays: number };
export const SELF_SERVE_LIMITS = { maxPerChange: { min: 1, max: 500 }, payDays: { min: 3, max: 30 } } as const;
const DEFAULTS: SelfServe = { on: false, maxPerChange: 20, payDays: 14 };

const int = (v: unknown, d: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : d;
};

export function readSelfServe(value: unknown): SelfServe {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    on: v.on === true,
    maxPerChange: int(v.maxPerChange, DEFAULTS.maxPerChange, SELF_SERVE_LIMITS.maxPerChange.min, SELF_SERVE_LIMITS.maxPerChange.max),
    payDays: int(v.payDays, DEFAULTS.payDays, SELF_SERVE_LIMITS.payDays.min, SELF_SERVE_LIMITS.payDays.max),
  };
}

export async function selfServeSettings(): Promise<SelfServe> {
  const row = await outsideTenant('billing: self-serve settings', () => platformPrisma.platformSetting.findUnique({ where: { key: SELF_SERVE_KEY } }));
  return readSelfServe(row?.value);
}

export async function saveSelfServe(input: Partial<SelfServe>, _userId: string): Promise<SelfServe> {
  const cur = await selfServeSettings();
  const problems: string[] = [];
  const next = { ...cur };
  if (input.on !== undefined) next.on = input.on === true;
  if (input.maxPerChange !== undefined) {
    const { min, max } = SELF_SERVE_LIMITS.maxPerChange;
    if (!Number.isInteger(input.maxPerChange) || input.maxPerChange < min || input.maxPerChange > max) problems.push(`At most ${min} to ${max} at a time.`);
    else next.maxPerChange = input.maxPerChange;
  }
  if (input.payDays !== undefined) {
    const { min, max } = SELF_SERVE_LIMITS.payDays;
    if (!Number.isInteger(input.payDays) || input.payDays < min || input.payDays > max) problems.push(`Days to pay is from ${min} to ${max}.`);
    else next.payDays = input.payDays;
  }
  if (problems.length) throw new PaymentsError('Check the settings.', 400, problems);
  await outsideTenant('billing: save self-serve settings', () =>
    platformPrisma.platformSetting.upsert({ where: { key: SELF_SERVE_KEY }, create: { key: SELF_SERVE_KEY, value: next as any }, update: { value: next as any } }),
  );
  return next;
}

/* ----------------------------------------------------------------- dates */

/** Today's date in India, YYYY-MM-DD. */
export const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayNo = (s: string) => Math.round(Date.parse(`${s}T00:00:00.000Z`) / 86_400_000);
const dateOf = (s: string) => new Date(`${s}T00:00:00.000Z`);
const shown = (s: string) => dateOf(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * What `delta` more per period costs from today to the end of what is paid.
 *
 * `paidTo` is the subscription's currentPeriodEnd: the first day not paid. The
 * period holding today is found by stepping back from it a period at a time;
 * today counts, and any whole periods already paid beyond that one are charged
 * in full. Paise, rounded half up, before GST.
 */
export function prorate(delta: number, paidTo: Date, period: PricePeriod, now = new Date()) {
  const today = istDay(now);
  const end = iso(paidTo);
  if (dayNo(end) <= dayNo(today)) throw new PaymentsError('The paid period has ended.', 409);
  let start = end;
  let whole = -1;
  for (let i = 0; i < 400 && dayNo(start) > dayNo(today); i++) {
    start = iso(periodEnd(dateOf(start), period, -1));
    whole += 1;
  }
  const thisEnd = iso(periodEnd(dateOf(start), period, 1));
  const length = Math.max(1, dayNo(thisEnd) - dayNo(start));
  const left = Math.max(0, Math.min(length, dayNo(thisEnd) - dayNo(today)));
  const amount = Math.floor((delta * left + Math.floor(length / 2)) / length) + Math.max(0, whole) * delta;
  return { amount, from: today, to: iso(new Date(paidTo.getTime() - 86_400_000)), daysLeft: left, periodDays: length, wholePeriods: Math.max(0, whole) };
}

/* ----------------------------------------------------------- eligibility */

export type Refusal = { code: 'OFF' | 'NO_PLAN' | 'NOT_BY_HEAD' | 'STOPPING' | 'OVERDUE' | 'OPEN' | 'ASK_CLOR'; reason: string; invoiceId?: string | null };

type Sub = NonNullable<Awaited<ReturnType<typeof readSub>>>;
const readSub = (accountId: string) => outsideTenant('billing: the plan seats are added to', () => platformPrisma.subscription.findUnique({ where: { accountId } }));

/** The deal plan the subscription was sold on, as it is priced today; null when it is gone. */
async function planOf(sub: Sub): Promise<DealPlan | null> {
  if (sub.planSource === 'book') {
    const p = (await publishedBook())?.plans.find((x) => x.code === sub.planRef);
    return p ? fromBookPlan(p) : null;
  }
  if (sub.planSource === 'custom' && sub.planRef) {
    const c = await outsideTenant('billing: a custom plan', () => platformPrisma.customPlan.findUnique({ where: { id: sub.planRef! } }));
    return c && !c.archivedAt ? fromCustom(c) : null;
  }
  return null;
}

/** The offer the customer holds, still in force for its own periods: their place is taken, so a pause or end date for new customers does not stop it. */
async function heldOffer(sub: Sub, now: Date): Promise<DealOffer | null> {
  if (!sub.offerId || (sub.offerEndsAt && sub.offerEndsAt <= now)) return null;
  const o = await outsideTenant('billing: the offer held', () => platformPrisma.offer.findUnique({ where: { id: sub.offerId! } }));
  return o ? ({ ...(o as DealOffer), pausedAt: null, endsAt: null, maxRedemptions: null, startsAt: new Date(0), archivedAt: null } as DealOffer) : null;
}

export async function openChange(accountId: string) {
  return outsideTenant('billing: an open seat change', () => platformPrisma.subscriptionChange.findFirst({ where: { accountId, status: 'OPEN' } }));
}

/** Whether this account may add seats itself now; a refusal says why, in words for the customer. */
export async function eligibility(accountId: string, now = new Date()): Promise<{ ok: true; sub: Sub; settings: SelfServe } | { ok: false; refusal: Refusal; settings: SelfServe }> {
  const settings = await selfServeSettings();
  const no = (refusal: Refusal) => ({ ok: false as const, refusal, settings });
  if (!settings.on) return no({ code: 'OFF', reason: 'Adding seats yourself is not open yet. Ask CLOR for the change.' });
  const sub = await readSub(accountId);
  if (!sub || sub.status !== 'active' || sub.periodAmount == null || !sub.planSource || !sub.quantity || !sub.currentPeriodEnd || !['month', 'year'].includes(String(sub.billingInterval)))
    return no({ code: 'NO_PLAN', reason: sub?.status === 'trialing' ? 'Choose a plan first. Seats are added to a plan you pay for.' : 'This account has no paid plan to add seats to. Ask CLOR for a plan.' });
  if (sub.planUnit !== 'USER' && sub.planUnit !== 'EMPLOYEE') return no({ code: 'NOT_BY_HEAD', reason: 'This plan is not priced by the user or the employee, so there are no seats to add.' });
  if (sub.currentPeriodEnd <= now) return no({ code: 'NO_PLAN', reason: 'The paid period has ended. Pay the renewal first.' });
  if (sub.cancelAtPeriodEnd) return no({ code: 'STOPPING', reason: 'This plan is set to stop at the end of the period. Keep the plan to add seats.' });
  const overdue = await outsideTenant('billing: an overdue invoice', () =>
    platformPrisma.billingInvoice.findFirst({ where: { accountId, status: 'ISSUED', dueDate: { lt: now } }, orderBy: { dueDate: 'asc' }, select: { id: true, number: true } }),
  );
  if (overdue) return no({ code: 'OVERDUE', reason: `Invoice ${overdue.number} is overdue. Pay it first, then add seats.`, invoiceId: overdue.id });
  const open = await openChange(accountId);
  if (open) {
    const inv = open.invoiceId ? await outsideTenant('billing: the open change invoice', () => platformPrisma.billingInvoice.findUnique({ where: { id: open.invoiceId! }, select: { number: true } })) : null;
    return no({ code: 'OPEN', reason: `${unitWord(open.unit, open.added)} added on ${inv?.number ? `invoice ${inv.number}` : 'an invoice'} are waiting to be paid. Pay it, then add more.`, invoiceId: open.invoiceId });
  }
  return { ok: true, sub, settings };
}

/* ------------------------------------------------------------------ quote */

export type SeatQuote = {
  add: number;
  unit: 'USER' | 'EMPLOYEE';
  quantityNow: number;
  quantityAfter: number;
  /** What each period costs more, before GST, from the next renewal. */
  perPeriodMore: number;
  period: 'month' | 'year';
  deltaList: number;
  deltaPeriod: number;
  from: string;
  to: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  dueOn: string;
  payDays: number;
  line: Line;
  planName: string;
};

export async function quoteSeats(accountId: string, add: number, now = new Date()): Promise<SeatQuote> {
  const e = await eligibility(accountId, now);
  if (!e.ok) throw new PaymentsError(e.refusal.reason, 409);
  const { sub, settings } = e;
  if (!Number.isInteger(add) || add < 1) throw new PaymentsError('Say how many to add: a whole number from 1.', 400);
  if (add > settings.maxPerChange) throw new PaymentsError(`Add up to ${settings.maxPerChange} at a time. For more, ask CLOR.`, 400);
  const plan = await planOf(sub);
  if (!plan) throw new PaymentsError('This plan is no longer on the price list. Ask CLOR to add seats.', 409);
  const period: PricePeriod = sub.billingInterval === 'year' ? 'YEARLY' : 'MONTHLY';
  const offer = await heldOffer(sub, now);
  let before;
  let after;
  try {
    before = priceDeal({ plan, period, quantity: sub.quantity!, offer, now });
    after = priceDeal({ plan, period, quantity: sub.quantity! + add, offer, now });
  } catch (err) {
    if (err instanceof DealError) throw new PaymentsError(`${err.message} Ask CLOR to add seats.`, 409);
    throw err;
  }
  const deltaList = after.listAmount - before.listAmount;
  const deltaPeriod = after.periodAmount - before.periodAmount;
  /* What this period is charged at: the offer's price while it lasts, else the list price (as dealLine does). */
  const delta = offer ? deltaPeriod : deltaList;
  const p = prorate(delta, sub.currentPeriodEnd!, period, now);
  const words = unitWord(sub.planUnit!, add);
  const line: Line = { description: `${words} more on CLOR ${sub.planName || plan.name}, ${shown(p.from)} to ${shown(p.to)}`.slice(0, 200), appCode: null, quantity: 1, unitAmount: p.amount, amount: p.amount };
  const buyer = await buyerFor(accountId);
  const t = await totalsFor([line], buyer.stateCode);
  return {
    add,
    unit: sub.planUnit as 'USER' | 'EMPLOYEE',
    quantityNow: sub.quantity!,
    quantityAfter: sub.quantity! + add,
    perPeriodMore: delta,
    period: sub.billingInterval === 'year' ? 'year' : 'month',
    deltaList,
    deltaPeriod,
    from: p.from,
    to: p.to,
    subtotal: t.subtotal,
    taxTotal: t.taxTotal,
    total: t.total,
    dueOn: istDay(new Date(now.getTime() + settings.payDays * 86_400_000)),
    payDays: settings.payDays,
    line,
    planName: sub.planName || plan.name,
  };
}

/* -------------------------------------------------------------------- add */

const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';

/**
 * Add the seats now and raise their invoice. `expectTotal` is the total the
 * customer was shown: a price that moved in between is said, not charged.
 */
export async function addSeats(accountId: string, add: number, userId: string, expectTotal?: number | null, now = new Date()) {
  const q = await quoteSeats(accountId, add, now);
  if (expectTotal != null && expectTotal !== q.total) throw new PaymentsError('The price changed a moment ago. Check the new amount and add again.', 409);
  const settings = await selfServeSettings();
  const dueAt = new Date(now.getTime() + settings.payDays * 86_400_000);
  const free = q.subtotal <= 0;

  let change;
  try {
    change = await outsideTenant('billing: add seats', () =>
      platformPrisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "accountId" = ${accountId} FOR UPDATE`;
        const sub = await tx.subscription.findUnique({ where: { accountId } });
        if (!sub || sub.quantity !== q.quantityNow || sub.status !== 'active') throw new PaymentsError('The plan changed a moment ago. Open it again.', 409);
        await tx.subscription.update({
          where: { accountId },
          data: { quantity: q.quantityAfter, listAmount: (sub.listAmount ?? 0) + q.deltaList, periodAmount: (sub.periodAmount ?? 0) + q.deltaPeriod },
        });
        await tx.subscriptionItem.updateMany({ where: { subscriptionId: sub.id, seats: { not: null } }, data: { seats: q.quantityAfter } });
        return tx.subscriptionChange.create({
          data: {
            accountId,
            unit: q.unit,
            added: add,
            fromQuantity: q.quantityNow,
            toQuantity: q.quantityAfter,
            deltaList: q.deltaList,
            deltaPeriod: q.deltaPeriod,
            proratedAmount: q.subtotal,
            periodFrom: q.from,
            periodTo: q.to,
            dueAt,
            requestedByUserId: userId,
            ...(free ? { status: 'PAID', settledAt: now, note: 'Nothing to pay: the plan includes these.' } : {}),
          },
        });
      }),
    );
  } catch (e) {
    if (isUnique(e)) throw new PaymentsError('Seats were added a moment ago and are waiting to be paid. Open the plan again.', 409);
    throw e;
  }
  await syncAccountEntitlement(accountId);
  clearAccessCache();

  let invoice: Awaited<ReturnType<typeof issueInvoice>> | null = null;
  if (!free) {
    let draftId: string | null = null;
    try {
      const draft = await createDraft(
        { accountId, lines: [q.line], periodStart: q.from, periodEnd: q.to, months: 1, note: `Seats added from Workspace. Unpaid by ${shown(istDay(dueAt))}, these ${q.unit === 'USER' ? 'users' : 'employees'} come off the plan.` },
        userId,
        { source: 'ADDON' },
      );
      draftId = draft.id;
      invoice = await issueInvoice(draft.id, userId, { dueDays: settings.payDays });
      await outsideTenant('billing: tie the seats to their invoice', () => platformPrisma.subscriptionChange.update({ where: { id: change.id }, data: { invoiceId: invoice!.id } }));
    } catch (e) {
      /* No invoice, no seats: put the count back as it was. */
      if (draftId && !invoice) await deleteDraft(draftId).catch(() => undefined);
      if (invoice)
        await outsideTenant('billing: cancel an untied seat invoice', () =>
          platformPrisma.billingInvoice.updateMany({ where: { id: invoice!.id, status: 'ISSUED' }, data: { status: 'VOID', voidedAt: new Date(), voidReason: 'The seats it was for could not be added.' } }),
        ).catch(() => undefined);
      await takeBack(change.id, 'CANCELLED', `The invoice could not be raised: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`, null);
      throw e instanceof PaymentsError ? e : new PaymentsError('The invoice for these seats could not be raised, so nothing was added. Try again, or ask CLOR.', 503);
    }
  }
  await recordAccountEvent({
    accountId,
    actorUserId: userId,
    action: 'SEATS_ADDED',
    targetType: 'Subscription',
    message: `${unitWord(q.unit, add)} added (${q.quantityNow} to ${q.quantityAfter})${invoice ? `, invoice ${invoice.number} due ${shown(istDay(dueAt))}` : ''}.`,
    metadata: { changeId: change.id, invoiceId: invoice?.id ?? null, total: q.total },
  }).catch(() => undefined);
  return { change: { ...change, invoiceId: invoice?.id ?? null }, invoice, quote: q };
}

/* ------------------------------------------------------------- take back */

/**
 * Take an open addition off again: its invoice is cancelled (when it is still
 * unpaid) and the count, prices and seats go back down by what it added.
 * LAPSED when the days to pay ran out; CANCELLED by CLOR staff, or when its
 * invoice could not be raised. False when it was paid or settled meanwhile.
 */
export async function takeBack(changeId: string, status: 'LAPSED' | 'CANCELLED', note: string, userId: string | null): Promise<boolean> {
  const out = await outsideTenant('billing: take seats back', () =>
    platformPrisma.$transaction(async (tx) => {
      const c = await tx.subscriptionChange.findUnique({ where: { id: changeId } });
      if (!c || c.status !== 'OPEN') return null;
      if (c.invoiceId) {
        const voided = await tx.billingInvoice.updateMany({
          where: { id: c.invoiceId, status: 'ISSUED' },
          data: { status: 'VOID', voidedAt: new Date(), voidReason: note.slice(0, 300), voidedByUserId: userId },
        });
        /* Paid a moment ago: the seats stay. */
        if (!voided.count) return null;
      }
      const claimed = await tx.subscriptionChange.updateMany({ where: { id: c.id, status: 'OPEN' }, data: { status, settledAt: new Date(), settledByUserId: userId, note: note.slice(0, 600) } });
      if (!claimed.count) throw new PaymentsError('This change was settled a moment ago.', 409);
      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "accountId" = ${c.accountId} FOR UPDATE`;
      const sub = await tx.subscription.findUnique({ where: { accountId: c.accountId } });
      if (sub) {
        const quantity = Math.max(1, (sub.quantity ?? c.toQuantity) - c.added);
        await tx.subscription.update({
          where: { accountId: c.accountId },
          data: { quantity, listAmount: sub.listAmount == null ? null : Math.max(0, sub.listAmount - c.deltaList), periodAmount: sub.periodAmount == null ? null : Math.max(0, sub.periodAmount - c.deltaPeriod) },
        });
        await tx.subscriptionItem.updateMany({ where: { subscriptionId: sub.id, seats: { not: null } }, data: { seats: quantity } });
      }
      /* A renewal raised while these seats were on carries them: staff check it (Ops shows the note). */
      const renewal = await tx.billingInvoice.findFirst({ where: { accountId: c.accountId, source: 'RENEWAL', createdAt: { gt: c.createdAt }, status: { in: ['ISSUED', 'PAID'] } }, select: { number: true } });
      if (renewal) await tx.subscriptionChange.update({ where: { id: c.id }, data: { note: `${note} Renewal ${renewal.number} was raised with these seats on; check it.`.slice(0, 600) } });
      return c;
    }),
  );
  if (!out) return false;
  if (out.invoiceId) await cancelUnsentInvoiceMail(out.invoiceId, 'VOID');
  await syncAccountEntitlement(out.accountId);
  clearAccessCache();
  await recordAccountEvent({
    accountId: out.accountId,
    actorUserId: userId,
    action: status === 'LAPSED' ? 'SEATS_LAPSED' : 'SEATS_CANCELLED',
    targetType: 'Subscription',
    message: `${unitWord(out.unit, out.added)} taken off the plan (${out.toQuantity} to ${out.fromQuantity}). ${note}`.slice(0, 500),
    metadata: { changeId: out.id, invoiceId: out.invoiceId },
  }).catch(() => undefined);
  return true;
}

/** Additions whose days to pay have run out with the invoice unpaid come off. */
export async function lapseDue(now = new Date()) {
  const due = await outsideTenant('billing: seat additions past their days to pay', () =>
    platformPrisma.subscriptionChange.findMany({ where: { status: 'OPEN', dueAt: { lte: now } }, orderBy: { dueAt: 'asc' }, take: 200 }),
  );
  let lapsed = 0;
  const failed: Array<{ id: string; reason: string }> = [];
  for (const c of due) {
    try {
      if (await takeBack(c.id, 'LAPSED', `Not paid within the days to pay, so these ${c.unit === 'USER' ? 'users' : 'employees'} came off the plan.`, null)) lapsed += 1;
    } catch (e) {
      if (e instanceof LeaseLost) throw e;
      failed.push({ id: c.id, reason: String(e instanceof Error ? e.message : e).slice(0, 200) });
    }
  }
  return { lapsed, failed };
}

/** Seat changes for one account, newest first, with their invoice's number and state. */
export async function changesFor(accountId: string, take = 20) {
  const rows = await outsideTenant('billing: seat changes', () => platformPrisma.subscriptionChange.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take }));
  const ids = rows.map((r) => r.invoiceId).filter(Boolean) as string[];
  const invs = ids.length ? await outsideTenant('billing: seat change invoices', () => platformPrisma.billingInvoice.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, status: true, total: true, dueDate: true } })) : [];
  const byId = new Map(invs.map((i) => [i.id, i]));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    unit: r.unit,
    added: r.added,
    fromQuantity: r.fromQuantity,
    toQuantity: r.toQuantity,
    proratedAmount: r.proratedAmount,
    periodFrom: r.periodFrom,
    periodTo: r.periodTo,
    dueAt: r.dueAt,
    createdAt: r.createdAt,
    settledAt: r.settledAt,
    note: r.note,
    invoice: r.invoiceId ? (byId.get(r.invoiceId) ?? null) : null,
  }));
}

const EVERY_MS = 60 * 60_000;

export function startSeatLapses({ intervalMs = EVERY_MS, startupDelayMs = 240_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () =>
    exclusive('billing.seatLapses', leaseFor(intervalMs), () => lapseDue(), { idempotent: true })
      .then((r) => r && (r.lapsed || r.failed.length) && console.log('[billing.seatLapses]', JSON.stringify(r)))
      .catch((e) => console.error('[billing.seatLapses] failed:', e instanceof Error ? e.message : e));
  registerJob('billing.seatLapses', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
