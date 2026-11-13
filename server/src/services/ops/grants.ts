import type { Request } from 'express';

import { platformPrisma, type PlatformDb } from '../../utils/platformPrisma.js';
import { clearAccessCache } from '../../utils/accessCache.js';
import { clientIp, recordAuthEvent } from '../auth.js';
import { getSubscription, peopleIncludesAttendance, setSubscription, type SetSubscriptionInput } from '../subscriptions.js';
import { appName } from '../pricing/engine.js';
import { DealError } from '../pricing/deals.js';
import { audit } from '../../routes/ops.js';
import { ALREADY_WAITING, approvalSettings, askApproval } from './approvals.js';

/**
 * Grants: apps put on a customer's plan by hand, from the customer's page
 * ("Free plan by hand", "Change apps") or Trials ("Convert"). A grant can give
 * apps away, so it goes through the same two-person rule as a deal
 * (services/ops/approvals.ts): what it takes off is counted the way a deal's
 * discount is, and over the limit on the Approvals page it waits for a second
 * person instead of being set.
 *
 * What a grant takes off, per app, against what the customer has now:
 *  - an app put on free (no price, or a price of 0) that the customer did not
 *    already have free on an active plan: 100%. Free on a trial is not free
 *    for good, so a trial turned into a free active plan counts in full;
 *  - an app whose by-hand price is lowered: the share it was lowered by;
 *  - an app priced by a deal and re-priced by hand: 100%, as the deal's price
 *    no longer applies to it;
 *  - anything else (an app taken away, the same price, a higher one): 0.
 * Attendance with People is included in People, not given away. A plan set
 * on a trial ending within TRIAL_DAYS days (the most Extend trial gives), or
 * to a status that opens no app (past due, paused, cancelled), gives nothing
 * away. The grant counts as its largest share. Free is 100%, over any limit
 * (the limit is at most 90), so an app given away for good always needs a
 * second person.
 */
export const TRIAL_DAYS = 90;
const PRICED = new Set(['per_seat', 'per_app', 'flat']);

type Line = { appCode: string; priceModel?: string | null; unitAmount?: number | null };
type Current = { status: string; trialEndsAt: Date | null; items: Line[] } | null;

const paid = (l: Line) => l.priceModel === 'plan' || (PRICED.has(String(l.priceModel)) && (l.unitAmount ?? 0) > 0);

export function grantDiscount(current: Current, next: { status: string; trialEndsAt: Date | null; apps: Line[] }, now = new Date()) {
  const none = { percent: 0, given: [] as string[] };
  if (!['active', 'trialing'].includes(next.status)) return none;
  if (next.status === 'trialing' && next.trialEndsAt && next.trialEndsAt.getTime() <= now.getTime() + TRIAL_DAYS * 86_400_000) return none;
  const lines = peopleIncludesAttendance(next.apps);
  const withPeople = lines.some((l) => l.appCode === 'people');
  const had = new Map((current?.items || []).map((i) => [i.appCode, i]));
  const freeForGood = current?.status === 'active';
  let percent = 0;
  const given: string[] = [];
  for (const l of lines) {
    if (l.appCode === 'attendance' && withPeople) continue;
    const old = had.get(l.appCode);
    let share = 0;
    if (!paid(l)) share = old && !paid(old) && freeForGood ? 0 : 100;
    else if (old?.priceModel === 'plan' && l.priceModel !== 'plan') share = 100;
    else if (old && paid(old) && old.priceModel === l.priceModel && (old.unitAmount ?? 0) > 0 && (l.unitAmount ?? 0) < old.unitAmount!) share = Math.round(((old.unitAmount! - (l.unitAmount ?? 0)) * 100) / old.unitAmount!);
    if (share > 0) given.push(l.appCode);
    percent = Math.max(percent, share);
  }
  return { percent, given };
}

/** Over the limit deals use (Approvals), so a second person must approve it. */
export const grantOverLimit = (percent: number, limit: number) => percent > 0 && percent > limit;

const names = (codes: string[]) => codes.map(appName).join(', ');

/* ------------------------------------------------------------ the two kinds */

/** "Free plan by hand" / Trials "Convert": the subscription set wholesale (routes/billing.ts). */
export type PlanGrant = { route: 'plan'; body: SetSubscriptionInput & { reason?: string } };
/** "Change apps": which apps the plan carries; kept apps keep their price, added ones come in free (routes/opsCustomers.ts). */
export type AppsGrant = { route: 'apps'; body: { apps: string[]; reason: string } };
export type Grant = PlanGrant | AppsGrant;
/** What is kept on the request: the grant, and the plan's version when it was asked. */
export type GrantPayload = Grant & { basedOn: { subscriptionUpdatedAt: string | null } };

type Sub = Awaited<ReturnType<typeof getSubscription>>;

/** The subscription a grant would write, from the plan as it is now. */
export function grantInput(g: Grant, sub: Sub): SetSubscriptionInput {
  if (g.route === 'plan') return g.body;
  const keep = new Map((sub?.items || []).map((i) => [i.appCode, i]));
  return {
    apps: [...new Set(g.body.apps)].map((appCode) => {
      const k = keep.get(appCode);
      return k ? { appCode, tier: k.tier, seats: k.seats, priceModel: k.priceModel, unitAmount: k.unitAmount } : { appCode, priceModel: 'free' };
    }),
    /* The paid period stays exactly as it is: only the apps change. */
    status: sub?.status,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
  };
}

/** What the grant takes off, and the one line the Approvals list shows. */
export function priceGrant(g: Grant, sub: Sub, now = new Date()) {
  const input = grantInput(g, sub);
  const status = input.status || (input.trialDays ? 'trialing' : 'active');
  const trialEndsAt = input.trialEndsAt ?? (input.trialDays ? new Date(now.getTime() + input.trialDays * 86_400_000) : status === 'trialing' ? (sub?.trialEndsAt ?? null) : null);
  const d = grantDiscount(sub, { status, trialEndsAt, apps: input.apps }, now);
  const apps = [...new Set(input.apps.map((a) => a.appCode))];
  const free = d.given.length ? `; ${names(d.given)} ${d.percent === 100 ? 'free' : `${d.percent}% cheaper`}` : '';
  const summary =
    g.route === 'plan'
      ? `Plan set by hand: ${names(apps)}, ${status === 'trialing' ? `trial${input.trialDays ? ` of ${input.trialDays} days` : ' with no end date'}` : 'active, no end date'}${free}`
      : `Apps changed to ${names(apps)}${free}`;
  return { ...d, summary: summary.slice(0, 300) };
}

/** The plan's version: when it last changed, or null when there is none. Kept on a request when it is asked. */
export const planVersion = async (accountId: string) => {
  const s = await platformPrisma.subscription.findUnique({ where: { accountId }, select: { updatedAt: true } });
  return s ? s.updatedAt.toISOString() : null;
};

/**
 * Take the customer's plan row for this transaction and check it is the one
 * the request was asked against. A plan changed directly since (a deal, a
 * grant, a cancel) means the approver would approve a change to a plan nobody
 * looked at. `null`: there was no plan then.
 */
export async function expectPlanUnchanged(tx: PlatformDb, accountId: string, basedOn: string | null) {
  const rows = await tx.$queryRaw<Array<{ updatedAt: Date }>>`SELECT "updatedAt" FROM "Subscription" WHERE "accountId" = ${accountId} FOR UPDATE`;
  const now = rows[0]?.updatedAt ? new Date(rows[0].updatedAt).toISOString() : null;
  if (now !== basedOn) throw new DealError('The customer’s plan was changed after this was asked, so nothing was set. Ask again with the plan as it is now.', 409);
}

/**
 * Write a grant in one transaction: the plan, its apps, the entitlement and
 * the app switches. Asked earlier (`basedOn`), the plan is first checked to be
 * the one it was asked against.
 */
export async function applyGrant(accountId: string, g: Grant, opts: { basedOn?: string | null } = {}) {
  const r = await platformPrisma.$transaction(
    async (tx) => {
      if (opts.basedOn !== undefined) await expectPlanUnchanged(tx, accountId, opts.basedOn);
      const before = await getSubscription(accountId, tx);
      if (g.route === 'apps' && !before) throw new DealError('This customer has no plan yet. Use Set a plan first.', 409);
      const after = await setSubscription(accountId, grantInput(g, before), tx);
      return { before, after };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  clearAccessCache();
  return r;
}

/**
 * A grant over the limit: open the request for a second person instead of
 * setting it, and say so (202), or say why it cannot be asked. Null when it
 * is within the limit and the route sets it as it always has.
 */
export async function askForGrant(req: Request, accountId: string, g: Grant, reason: string | undefined): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const [sub, { discountPercent: limit }] = await Promise.all([getSubscription(accountId), approvalSettings()]);
  const p = priceGrant(g, sub);
  if (!grantOverLimit(p.percent, limit)) return null;
  const why = (reason || '').trim();
  if (why.length < 3) return { status: 400, body: { error: 'This gives apps away, so a colleague must approve it. Say why, in a sentence, for them to read.', needsApproval: true } };
  const { accountNames } = await import('../../routes/opsDeals.js');
  const customerName = (await accountNames([accountId])).get(accountId) || 'A customer';
  const payload: GrantPayload = { ...g, basedOn: { subscriptionUpdatedAt: sub ? sub.updatedAt.toISOString() : null } };
  const approval = await askApproval(req, { kind: 'GRANT', accountId, customerName, payload, summary: p.summary, discountPercent: p.percent, reason: why.slice(0, 500) });
  if (!approval) return { status: 409, body: { error: ALREADY_WAITING } };
  return { status: 202, body: { needsApproval: true, approval, limit } };
}

const appsOf = (s: Sub) => (s?.items || []).map((i) => i.appCode).sort();

/**
 * Write down what a grant changed: on the customer's own security log (A-17)
 * and on CLOR's operator record, as each route always has.
 */
export async function recordGrant(req: Request, accountId: string, g: Grant, r: { before: Sub; after: Sub }, extra: Record<string, unknown> = {}) {
  const reason = typeof g.body.reason === 'string' && g.body.reason ? g.body.reason.slice(0, 500) : undefined;
  if (g.route === 'apps') {
    await audit(req, 'SUBSCRIPTION_APPS_CHANGED', { accountId }, { from: appsOf(r.before), to: appsOf(r.after), reason, ...extra });
    return;
  }
  const shape = (s: Sub) => (s ? { status: s.status, apps: appsOf(s) } : null);
  await recordAuthEvent({
    accountId,
    userId: req.auth!.userId,
    eventType: 'OPERATOR_SUBSCRIPTION_SET',
    ip: clientIp(req),
    userAgent: req.headers['user-agent'] as string | undefined,
    detail: JSON.stringify({ before: shape(r.before), after: shape(r.after) }).slice(0, 1000),
  });
  await platformPrisma.operatorAuditEvent.create({
    data: { operatorUserId: req.auth!.userId, action: 'SUBSCRIPTION_SET', targetAccountId: accountId, detail: { before: shape(r.before), after: shape(r.after), reason, ...extra } as any, ip: clientIp(req) ?? null },
  });
}
