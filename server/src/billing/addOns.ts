import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { syncAppSwitches } from '../services/subscriptions.js';
import { unitWord } from '../services/pricing/deals.js';
import type { Line } from './invoices.js';

/**
 * Apps added to a plan on their own (SubscriptionAddOn), shared by the
 * customer's own "Add an app" (billing/selfServeApps.ts), taking one back
 * (billing/selfServe.ts takeBack), renewals (billing/renewals.ts) and a deal
 * or grant CLOR sets (services/subscriptions.ts setSubscription).
 *
 * The app's subscription items are marked `priceModel: 'addon'`: a deal set
 * later keeps them, seats added to the plan leave their count alone, and
 * ending the add-on removes exactly them. People brings Attendance with it,
 * as everywhere else a plan is set.
 */

type Db = Pick<typeof platformPrisma, 'subscription' | 'subscriptionItem' | 'subscriptionAddOn' | 'subscriptionChange'>;

export const ADDON = 'addon';
const byHead = (unit: string) => unit === 'USER' || unit === 'EMPLOYEE';

/** The apps an account's subscription carries now. */
export async function ownedApps(db: Db, accountId: string | null | undefined): Promise<Set<string>> {
  if (!accountId) return new Set();
  const sub = await db.subscription.findUnique({ where: { accountId }, select: { items: { select: { appCode: true } } } });
  return new Set((sub?.items || []).map((i) => i.appCode));
}

/** The apps an add-on for `appCode` brings: People carries Attendance. */
export const appsOf = (appCode: string) => (appCode === 'people' ? ['people', 'attendance'] : [appCode]);

/** Put the add-on's apps on the subscription (the ones it does not already carry). */
export async function addItemsIn(db: Db, subscriptionId: string, a: { appCode: string; unit: string; quantity: number }, owned: Set<string>) {
  for (const code of appsOf(a.appCode)) {
    if (owned.has(code)) continue;
    const main = code === a.appCode;
    await db.subscriptionItem.create({
      data: { subscriptionId, appCode: code, tier: null, seats: main && byHead(a.unit) ? a.quantity : null, priceModel: ADDON, unitAmount: null },
    });
  }
}

/** End one add-on in this transaction and take off the apps it brought. False when it had ended already. */
export async function endAddOnIn(db: Db, addOnId: string, reason: string, userId: string | null): Promise<boolean> {
  const a = await db.subscriptionAddOn.findUnique({ where: { id: addOnId } });
  if (!a) return false;
  const claimed = await db.subscriptionAddOn.updateMany({
    where: { id: addOnId, status: 'ACTIVE' },
    data: { status: 'ENDED', endedAt: new Date(), endedByUserId: userId, endedReason: reason.slice(0, 600) },
  });
  if (!claimed.count) return false;
  const sub = await db.subscription.findUnique({ where: { accountId: a.accountId }, select: { id: true } });
  if (sub) await db.subscriptionItem.deleteMany({ where: { subscriptionId: sub.id, appCode: { in: appsOf(a.appCode) }, priceModel: ADDON } });
  return true;
}

/** Turn the app switches on or off to match the subscription now, from what it carried before. */
export async function appSwitchesAfter(accountId: string, before: Set<string>) {
  await outsideTenant('billing: app switches after an add-on', async () => {
    const after = await ownedApps(platformPrisma, accountId);
    await syncAppSwitches(accountId, before, after);
  });
}

/** The add-ons running on an account. */
export function activeAddOns(accountId: string, db: Db = platformPrisma) {
  return db.subscriptionAddOn.findMany({ where: { accountId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
}

/**
 * A deal or grant CLOR sets replaces the plan's apps. An add-on whose app the
 * new plan now carries ends (the plan pays for it); every other one keeps its
 * apps on. Called inside setSubscription's transaction, after the plan's own
 * items are written. Returns the apps the add-ons keep, for the app switches.
 */
export async function keepAddOnsIn(db: Db, accountId: string, subscriptionId: string, planApps: Set<string>): Promise<string[]> {
  const kept: string[] = [];
  for (const a of await activeAddOns(accountId, db)) {
    if (planApps.has(a.appCode)) {
      await db.subscriptionAddOn.update({ where: { id: a.id }, data: { status: 'ENDED', endedAt: new Date(), endedReason: 'The plan CLOR set now includes this app.' } });
      continue;
    }
    const owned = new Set([...planApps, ...kept]);
    await addItemsIn(db, subscriptionId, a, owned);
    kept.push(...appsOf(a.appCode).filter((c) => !owned.has(c)));
  }
  return kept;
}

/** Each running add-on as a renewal line, at its list price for one period. */
export async function addOnLines(accountId: string, billingInterval: string | null): Promise<Line[]> {
  const per = billingInterval === 'year' ? 'yearly' : 'monthly';
  const rows = await outsideTenant('billing: add-ons to renew', () => activeAddOns(accountId));
  return rows
    .filter((a) => a.listAmount > 0)
    .map((a) => ({
      description: `CLOR ${a.planName}${byHead(a.unit) ? `, ${unitWord(a.unit, a.quantity)}` : ''}, ${per}, added`.slice(0, 200),
      appCode: a.appCode,
      quantity: 1,
      unitAmount: a.listAmount,
      amount: a.listAmount,
    }));
}
