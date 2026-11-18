import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { clearAccessCache } from '../utils/accessCache.js';
import { syncAccountEntitlement } from '../services/subscriptions.js';
import { recordAccountEvent } from '../services/accountMembership.js';
import { publishedBook } from '../services/pricing/books.js';
import { fromBookPlan, priceDeal, unitWord, DealError } from '../services/pricing/deals.js';
import { appAvailable, appName, priceFor, type PlanData, type PricePeriod } from '../services/pricing/engine.js';
import { isSellableApp } from '../constants/appCatalog.js';
import { buyerFor, totalsFor, type Line } from './invoices.js';
import { PaymentsError } from './providers.js';
import { activeAddOns, addItemsIn, appSwitchesAfter, appsOf, endAddOnIn, ownedApps } from './addOns.js';
import { eligibility, istDay, isUnique, prorate, raiseFor, shown, type Sub } from './selfServe.js';

/**
 * Apps a customer adds to their own plan from Workspace (owner, 17 Nov 2026:
 * seats and apps on at once, as Claude Team and Microsoft 365 do).
 *
 * The same rules as seats (billing/selfServe.ts): the staff switch, an active
 * paid plan, nothing overdue, one addition waiting to be paid at a time. The
 * app is priced from its own plan in the published price book (People
 * Starter, People Growth, ...), at the list price, by the subscription's own
 * period, for the number the customer chooses. It works at once; a prorated
 * invoice for the rest of the paid period is issued, due in the days to pay.
 * Unpaid by then, that app alone comes off. Every renewal after carries it
 * on its own line (billing/renewals.ts). Removing it once paid, changing its
 * count and refunds stay with CLOR.
 */

export const MAX_APP_UNITS = 5000;

const periodOf = (sub: Sub): PricePeriod => (sub.billingInterval === 'year' ? 'YEARLY' : 'MONTHLY');

/** Price book plans that sell this one app on this period. */
function plansFor(plans: PlanData[], appCode: string, period: PricePeriod) {
  return plans.filter((p) => p.apps.length === 1 && p.apps[0] === appCode && priceFor(p, period));
}

/** How many to start the count at: the plan's own number when it is sold the same way, else what the plan includes. */
const startCount = (sub: Sub, p: PlanData) => (p.unit === sub.planUnit && sub.quantity ? sub.quantity : Math.max(1, p.includedUnits));

export type AppOption = {
  appCode: string;
  appName: string;
  plans: Array<{ code: string; name: string; description: string | null; unit: string; includedUnits: number; startAt: number; basePrice: number; extraUnitPrice: number }>;
};

/** The apps this account could add now, each with the plans it is sold on; and the add-ons it already has. */
export async function appOptions(accountId: string, now = new Date()) {
  const e = await eligibility(accountId, now, 'app');
  const addOns = (await outsideTenant('billing: add-ons', () => activeAddOns(accountId))).map((a) => ({ id: a.id, appCode: a.appCode, appName: appName(a.appCode), planName: a.planName, unit: a.unit, quantity: a.quantity, listAmount: a.listAmount, since: a.createdAt }));
  if (!e.ok) return { eligibility: e, options: [] as AppOption[], addOns };
  const period = periodOf(e.sub);
  const book = await publishedBook();
  const owned = await outsideTenant('billing: apps owned', () => ownedApps(platformPrisma, accountId));
  const codes = [...new Set((book?.plans || []).flatMap((p) => (p.apps.length === 1 ? p.apps : [])))].filter((c) => isSellableApp(c) && appAvailable(c) && !owned.has(c) && !(c === 'people' && owned.has('attendance')));
  const options: AppOption[] = codes
    .map((code) => ({
      appCode: code,
      appName: appName(code),
      plans: plansFor(book!.plans, code, period).map((p) => {
        const price = priceFor(p, period)!;
        return { code: p.code, name: p.name, description: p.description ?? null, unit: p.unit, includedUnits: p.includedUnits, startAt: startCount(e.sub, p), basePrice: price.basePrice, extraUnitPrice: price.extraUnitPrice };
      }),
    }))
    .filter((o) => o.plans.length);
  return { eligibility: e, options, addOns };
}

export type AppQuote = {
  appCode: string;
  appName: string;
  planCode: string;
  planName: string;
  unit: string;
  quantity: number;
  /** What each period costs more, before GST, from the next renewal. */
  perPeriod: number;
  period: 'month' | 'year';
  from: string;
  to: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  dueOn: string;
  payDays: number;
  line: Line;
};

export async function quoteApp(accountId: string, planCode: string, quantity: number, now = new Date()): Promise<AppQuote> {
  const e = await eligibility(accountId, now, 'app');
  if (!e.ok) throw new PaymentsError(e.refusal.reason, 409);
  const { sub, settings } = e;
  const period = periodOf(sub);
  const p = (await publishedBook())?.plans.find((x) => x.code === planCode);
  if (!p || p.apps.length !== 1 || !priceFor(p, period)) throw new PaymentsError('That plan is not on the price list for this account. Choose another, or ask CLOR.', 409);
  const appCode = p.apps[0];
  if (!isSellableApp(appCode) || !appAvailable(appCode)) throw new PaymentsError(`${appName(appCode)} cannot be added yet.`, 409);
  const owned = await outsideTenant('billing: apps owned', () => ownedApps(platformPrisma, accountId));
  if (owned.has(appCode)) throw new PaymentsError(`${appName(appCode)} is already on this account.`, 409);
  /* People takes Attendance's place rather than sitting beside it: that move is a request to CLOR (Move to People). */
  if (appCode === 'people' && owned.has('attendance')) throw new PaymentsError('This account has Attendance. Moving to People replaces it: ask CLOR with Move to People.', 409);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_APP_UNITS) throw new PaymentsError(`Say how many: a whole number from 1 to ${MAX_APP_UNITS}.`, 400);
  let deal;
  try {
    deal = priceDeal({ plan: fromBookPlan(p), period, quantity, offer: null, now });
  } catch (err) {
    if (err instanceof DealError) throw new PaymentsError(`${err.message} Ask CLOR to add this app.`, 409);
    throw err;
  }
  const perPeriod = deal.listAmount;
  const r = prorate(perPeriod, sub.currentPeriodEnd!, period, now);
  const byHead = p.unit === 'USER' || p.unit === 'EMPLOYEE';
  const line: Line = {
    description: `CLOR ${p.name}${byHead ? `, ${unitWord(p.unit, quantity)}` : ''}, added, ${shown(r.from)} to ${shown(r.to)}`.slice(0, 200),
    appCode,
    quantity: 1,
    unitAmount: r.amount,
    amount: r.amount,
  };
  const buyer = await buyerFor(accountId);
  const t = await totalsFor([line], buyer.stateCode);
  return {
    appCode,
    appName: appName(appCode),
    planCode: p.code,
    planName: p.name,
    unit: p.unit,
    quantity,
    perPeriod,
    period: period === 'YEARLY' ? 'year' : 'month',
    from: r.from,
    to: r.to,
    subtotal: t.subtotal,
    taxTotal: t.taxTotal,
    total: t.total,
    dueOn: istDay(new Date(now.getTime() + settings.payDays * 86_400_000)),
    payDays: settings.payDays,
    line,
  };
}

/**
 * Add the app now and raise its invoice. `expectTotal` is the total the
 * customer was shown: a price that moved in between is said, not charged.
 */
export async function addApp(accountId: string, planCode: string, quantity: number, userId: string, expectTotal?: number | null, now = new Date()) {
  const q = await quoteApp(accountId, planCode, quantity, now);
  if (expectTotal != null && expectTotal !== q.total) throw new PaymentsError('The price changed a moment ago. Check the new amount and add again.', 409);
  const e = await eligibility(accountId, now, 'app');
  if (!e.ok) throw new PaymentsError(e.refusal.reason, 409);
  const payDays = e.settings.payDays;
  const dueAt = new Date(now.getTime() + payDays * 86_400_000);
  const free = q.subtotal <= 0;
  const paidTo = e.sub.currentPeriodEnd!.getTime();

  let made;
  try {
    made = await outsideTenant('billing: add an app', () =>
      platformPrisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "accountId" = ${accountId} FOR UPDATE`;
        const sub = await tx.subscription.findUnique({ where: { accountId } });
        if (!sub || sub.status !== 'active' || sub.currentPeriodEnd?.getTime() !== paidTo) throw new PaymentsError('The plan changed a moment ago. Open it again.', 409);
        const before = await ownedApps(tx, accountId);
        if (before.has(q.appCode)) throw new PaymentsError(`${q.appName} is already on this account.`, 409);
        const addOn = await tx.subscriptionAddOn.create({
          data: { accountId, appCode: q.appCode, planCode: q.planCode, planName: q.planName, unit: q.unit, quantity: q.quantity, listAmount: q.perPeriod, createdByUserId: userId },
        });
        await addItemsIn(tx, sub.id, { appCode: q.appCode, unit: q.unit, quantity: q.quantity }, before);
        const change = await tx.subscriptionChange.create({
          data: {
            accountId,
            kind: 'APP',
            appCode: q.appCode,
            addOnId: addOn.id,
            unit: q.unit,
            added: q.quantity,
            fromQuantity: 0,
            toQuantity: q.quantity,
            deltaList: q.perPeriod,
            deltaPeriod: q.perPeriod,
            proratedAmount: q.subtotal,
            periodFrom: q.from,
            periodTo: q.to,
            dueAt,
            requestedByUserId: userId,
            ...(free ? { status: 'PAID', settledAt: now, note: 'Nothing to pay for the rest of this period.' } : {}),
          },
        });
        return { change, addOn, before };
      }),
    );
  } catch (err) {
    if (isUnique(err)) throw new PaymentsError('Something was added a moment ago and is waiting to be paid. Open the plan again.', 409);
    throw err;
  }
  await appSwitchesAfter(accountId, made.before);
  await syncAccountEntitlement(accountId);
  clearAccessCache();

  const invoice = free
    ? null
    : await raiseFor(made.change.id, accountId, q.line, q.from, q.to, `${q.appName} added from Workspace. Unpaid by ${shown(istDay(dueAt))}, ${q.appName} comes off the plan.`, userId, payDays, `The invoice for ${q.appName} could not be raised, so it was not added. Try again, or ask CLOR.`);
  await recordAccountEvent({
    accountId,
    actorUserId: userId,
    action: 'APP_ADDON_ADDED',
    targetType: 'Subscription',
    message: `${q.planName} added${q.unit === 'USER' || q.unit === 'EMPLOYEE' ? ` for ${unitWord(q.unit, q.quantity)}` : ''}${invoice ? `, invoice ${invoice.number} due ${shown(istDay(dueAt))}` : ''}.`,
    metadata: { changeId: made.change.id, addOnId: made.addOn.id, invoiceId: invoice?.id ?? null, total: q.total, apps: appsOf(q.appCode) },
  }).catch(() => undefined);
  return { change: { ...made.change, invoiceId: invoice?.id ?? null }, addOn: made.addOn, invoice, quote: q };
}

/**
 * CLOR staff take a paid app off again (Ops, the account's Subscription tab).
 * No refund is made here; one still waiting to be paid is taken back with its
 * invoice instead (takeBack). False when it had ended already.
 */
export async function endAddOn(addOnId: string, reason: string, userId: string): Promise<boolean> {
  const r = await outsideTenant('billing: end an add-on', () =>
    platformPrisma.$transaction(async (tx) => {
      const a = await tx.subscriptionAddOn.findUnique({ where: { id: addOnId } });
      if (!a || a.status !== 'ACTIVE') return null;
      const open = await tx.subscriptionChange.findFirst({ where: { addOnId, status: 'OPEN' }, select: { id: true } });
      if (open) throw new PaymentsError('Its invoice is still waiting to be paid. Take it back from the list of additions instead.', 409);
      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "accountId" = ${a.accountId} FOR UPDATE`;
      const before = await ownedApps(tx, a.accountId);
      if (!(await endAddOnIn(tx, a.id, reason, userId))) return null;
      return { a, before };
    }),
  );
  if (!r) return false;
  await appSwitchesAfter(r.a.accountId, r.before);
  await syncAccountEntitlement(r.a.accountId);
  clearAccessCache();
  await recordAccountEvent({
    accountId: r.a.accountId,
    actorUserId: userId,
    action: 'APP_ADDON_ENDED',
    targetType: 'Subscription',
    message: `${r.a.planName} taken off the plan by CLOR. ${reason}`.slice(0, 500),
    metadata: { addOnId: r.a.id },
  }).catch(() => undefined);
  return true;
}
