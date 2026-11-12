import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { clearAccessCache } from '../utils/accessCache.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { getSubscription, setSubscription } from '../services/subscriptions.js';
import { publishedBook } from '../services/pricing/books.js';
import { taxSetting } from '../services/pricing/settings.js';
import { PRICE_PERIODS, PRICE_UNITS, PRICEABLE_APPS, appName, rupees, type PricePeriod } from '../services/pricing/engine.js';
import { DealError, fromBookPlan, offerProblem, offerWords, periodEnd, priceDeal, unitWord, type DealOffer, type DealPlan } from '../services/pricing/deals.js';
import { approvalSettings, askApproval } from '../services/ops/approvals.js';
import { buyerFor, createDraft } from '../billing/invoices.js';
import { SELLABLE_APP_CODES } from '../constants/appCatalog.js';
import { audit, customerTitle } from './ops.js';

/**
 * Offers, custom plans and paid subscriptions on the operator console (Money).
 *
 * - Offers: a code that takes a percent or an amount off, for chosen plans and
 *   periods, for a number of periods, between dates, up to a number of
 *   customers.
 * - Custom plans: a deal's own apps, unit and prices, never on clor.in; for one
 *   customer or any.
 * - A subscription deal: a published or custom plan, a period, a number of
 *   units and maybe an offer, priced to the paisa, set on a customer with the
 *   first invoice drafted if asked.
 *
 * Everyone on the console reads; Billing writes, each with a fresh
 * authenticator code and a reason on the record. Offers and plans are CLOR's
 * own data (customerLog false); a subscription deal is also written to the
 * customer's security log.
 */
export const opsDealsRouter = Router();
opsDealsRouter.use(['/ops/offers', '/ops/custom-plans', '/ops/subscriptions', '/ops/accounts/:id/deal-options', '/ops/accounts/:id/deal'], requireAuth, requireOperator);
const BILLING = [requireOperatorRole('BILLING'), requireOperatorStepUp] as const;

const SAY_WHY = 'Say why, in a sentence.';
const reason = z.string().trim().min(3, SAY_WHY).max(500);
const optionalReason = z.string().trim().max(500).optional();
const paise = z.number().int().min(0).max(1_000_000_000);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.')
  .transform((s) => new Date(`${s}T00:00:00.000Z`));
const fail = (res: any, e: unknown) => {
  if (e instanceof DealError) return res.status(e.status).json({ error: e.message });
  throw e;
};

/* ------------------------------------------------------------------ offers */

export function offerStatus(o: DealOffer, now = new Date()) {
  if (o.archivedAt) return 'archived';
  if (o.pausedAt) return 'paused';
  if (o.endsAt && o.endsAt <= now) return 'ended';
  if (o.maxRedemptions != null && o.redemptions >= o.maxRedemptions) return 'used-up';
  if (o.startsAt > now) return 'scheduled';
  return 'active';
}

const offerFields = z.object({
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/, 'A code is 3 to 24 capitals, digits or dashes, like DIWALI25.')),
  name: z.string().trim().min(3, 'Give it a name staff will recognise.').max(80),
  description: z.string().trim().max(300).nullable().optional(),
  kind: z.enum(['PERCENT', 'AMOUNT']),
  value: z.number().int().min(1),
  planCodes: z.array(z.string().trim().min(1).max(32)).max(30),
  periods: z.array(z.enum(PRICE_PERIODS)).max(2),
  durationPeriods: z.number().int().min(1).max(60).nullable(),
  startsOn: day.nullable().optional(),
  endsOn: day.nullable().optional(),
  maxRedemptions: z.number().int().min(1).max(100000).nullable(),
});
/* Defaults only when making one: a change leaves what it does not name alone. */
const newOffer = offerFields.extend({
  planCodes: offerFields.shape.planCodes.default([]),
  periods: offerFields.shape.periods.default([]),
  durationPeriods: offerFields.shape.durationPeriods.default(null),
  maxRedemptions: offerFields.shape.maxRedemptions.default(null),
});

const offerShape = (o: any, now = new Date()) => ({
  id: o.id,
  code: o.code,
  name: o.name,
  description: o.description,
  kind: o.kind,
  value: o.value,
  planCodes: o.planCodes,
  periods: o.periods,
  durationPeriods: o.durationPeriods,
  startsAt: o.startsAt,
  endsAt: o.endsAt,
  maxRedemptions: o.maxRedemptions,
  redemptions: o.redemptions,
  status: offerStatus(o, now),
  words: offerWords(o),
  createdAt: o.createdAt,
});

/** The end date is the last day it can be used: it stops at the end of that day (UTC). */
const endOfDay = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 86_400_000 - 1) : null);

function offerChecks(v: { kind: string; value: number; startsAt: Date; endsAt: Date | null }) {
  if (v.kind === 'PERCENT' && v.value > 100) return 'A percent is at most 100.';
  if (v.kind === 'AMOUNT' && v.value > 1_000_000_000) return 'That amount is too large.';
  if (v.endsAt && v.endsAt <= v.startsAt) return 'The last day must come after the first.';
  return null;
}

opsDealsRouter.get('/ops/offers', (req, res) =>
  outsideTenant('ops: offers', async () => {
    const [rows, book] = await Promise.all([platformPrisma.offer.findMany({ orderBy: { createdAt: 'desc' }, take: 300 }), publishedBook()]);
    const now = new Date();
    const offers = rows.map((o) => offerShape(o, now));
    const counts: Record<string, number> = { active: 0, scheduled: 0, paused: 0, ended: 0, 'used-up': 0, archived: 0 };
    for (const o of offers) counts[o.status] += 1;
    res.json({ offers, counts, plans: (book?.plans || []).map((p) => ({ code: p.code, name: p.name })) });
  }),
);

opsDealsRouter.post('/ops/offers', ...BILLING, (req, res) =>
  outsideTenant('ops: make an offer', async () => {
    const p = newOffer.extend({ reason: optionalReason }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the offer.' });
    const v = p.data;
    const startsAt = v.startsOn || new Date();
    const endsAt = endOfDay(v.endsOn);
    const problem = offerChecks({ kind: v.kind, value: v.value, startsAt, endsAt });
    if (problem) return res.status(400).json({ error: problem });
    if (await platformPrisma.offer.findUnique({ where: { code: v.code } })) return res.status(409).json({ error: `${v.code} is taken. Choose another code.` });
    const o = await platformPrisma.offer.create({
      data: {
        code: v.code,
        name: v.name,
        description: v.description || null,
        kind: v.kind,
        value: v.value,
        planCodes: [...new Set(v.planCodes)],
        periods: [...new Set(v.periods)],
        durationPeriods: v.durationPeriods,
        startsAt,
        endsAt,
        maxRedemptions: v.maxRedemptions,
        createdByUserId: req.auth!.userId,
      },
    });
    await audit(req, 'OFFER_MADE', {}, { code: o.code, offer: offerWords(o), ...(v.reason ? { reason: v.reason } : {}) }, { customerLog: false });
    res.status(201).json({ offer: offerShape(o) });
  }),
);

/** Before anyone takes it, anything changes; after, only its name, description, last day and how many may take it. */
opsDealsRouter.patch('/ops/offers/:id', ...BILLING, (req, res) =>
  outsideTenant('ops: change an offer', async () => {
    const was = await platformPrisma.offer.findUnique({ where: { id: String(req.params.id) } });
    if (!was) return res.status(404).json({ error: 'No such offer.' });
    if (was.archivedAt) return res.status(409).json({ error: 'It is archived. Make a new one instead.' });
    const p = offerFields.partial().extend({ reason: optionalReason }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the offer.' });
    const v = p.data;
    const taken = was.redemptions > 0;
    const locked = (['code', 'kind', 'value', 'planCodes', 'periods', 'durationPeriods', 'startsOn'] as const).filter((k) => v[k] !== undefined && taken);
    if (locked.length) return res.status(409).json({ error: `${was.redemptions} ${was.redemptions === 1 ? 'customer has' : 'customers have'} taken it, so its price and rules stay. Change the name, last day or limit, or make a new offer.` });
    const next = {
      kind: v.kind ?? was.kind,
      value: v.value ?? was.value,
      startsAt: v.startsOn === undefined ? was.startsAt : v.startsOn || new Date(),
      endsAt: v.endsOn === undefined ? was.endsAt : endOfDay(v.endsOn),
    };
    const problem = offerChecks(next);
    if (problem) return res.status(400).json({ error: problem });
    if (v.maxRedemptions != null && v.maxRedemptions < was.redemptions) return res.status(400).json({ error: `${was.redemptions} have taken it already; the limit cannot be lower.` });
    if (v.code && v.code !== was.code && (await platformPrisma.offer.findUnique({ where: { code: v.code } }))) return res.status(409).json({ error: `${v.code} is taken. Choose another code.` });
    const o = await platformPrisma.offer.update({
      where: { id: was.id },
      data: {
        ...(v.code !== undefined ? { code: v.code } : {}),
        ...(v.name !== undefined ? { name: v.name } : {}),
        ...(v.description !== undefined ? { description: v.description || null } : {}),
        ...(v.planCodes !== undefined ? { planCodes: [...new Set(v.planCodes)] } : {}),
        ...(v.periods !== undefined ? { periods: [...new Set(v.periods)] } : {}),
        ...(v.durationPeriods !== undefined ? { durationPeriods: v.durationPeriods } : {}),
        ...(v.maxRedemptions !== undefined ? { maxRedemptions: v.maxRedemptions } : {}),
        kind: next.kind,
        value: next.value,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        updatedByUserId: req.auth!.userId,
      },
    });
    await audit(req, 'OFFER_CHANGED', {}, { code: o.code, offer: offerWords(o), ...(v.reason ? { reason: v.reason } : {}) }, { customerLog: false });
    res.json({ offer: offerShape(o) });
  }),
);

const offerStep = (action: 'pause' | 'resume' | 'archive') =>
  opsDealsRouter.post(`/ops/offers/:id/${action}`, ...BILLING, (req, res) =>
    outsideTenant(`ops: ${action} an offer`, async () => {
      const was = await platformPrisma.offer.findUnique({ where: { id: String(req.params.id) } });
      if (!was) return res.status(404).json({ error: 'No such offer.' });
      if (was.archivedAt) return res.status(409).json({ error: 'It is archived already.' });
      if (action === 'pause' && was.pausedAt) return res.status(409).json({ error: 'It is paused already.' });
      if (action === 'resume' && !was.pausedAt) return res.status(409).json({ error: 'It is not paused.' });
      const now = new Date();
      const data = action === 'pause' ? { pausedAt: now } : action === 'resume' ? { pausedAt: null } : { archivedAt: now };
      const o = await platformPrisma.offer.update({ where: { id: was.id }, data: { ...data, updatedByUserId: req.auth!.userId } });
      const why = typeof req.body?.reason === 'string' && req.body.reason.trim() ? { reason: req.body.reason.trim().slice(0, 300) } : {};
      await audit(req, { pause: 'OFFER_PAUSED', resume: 'OFFER_RESUMED', archive: 'OFFER_ARCHIVED' }[action], {}, { code: o.code, ...why }, { customerLog: false });
      res.json({ offer: offerShape(o) });
    }),
  );
offerStep('pause');
offerStep('resume');
offerStep('archive');

/* ------------------------------------------------------------ custom plans */

const money = paise.nullable();
const planFields = z.object({
  accountId: z.string().trim().min(1).nullable(),
  name: z.string().trim().min(3, 'Give the plan a name.').max(80),
  description: z.string().trim().max(300).nullable().optional(),
  apps: z
    .array(z.string())
    .min(1, 'Pick at least one app.')
    .max(10)
    .refine((a) => a.every((x) => SELLABLE_APP_CODES.includes(x)), 'Pick apps from the list.'),
  unit: z.enum(PRICE_UNITS),
  includedUnits: z.number().int().min(1).max(100000),
  monthlyPrice: money,
  monthlyExtra: paise,
  yearlyPrice: money,
  yearlyExtra: paise,
  gstApplies: z.boolean(),
});
const newPlan = planFields.extend({
  accountId: planFields.shape.accountId.default(null),
  monthlyPrice: money.default(null),
  monthlyExtra: paise.default(0),
  yearlyPrice: money.default(null),
  yearlyExtra: paise.default(0),
  gstApplies: z.boolean().default(true),
});

const planShape = (p: any, names: Map<string, string>) => ({
  id: p.id,
  accountId: p.accountId,
  accountName: p.accountId ? names.get(p.accountId) || 'A customer' : null,
  name: p.name,
  description: p.description,
  apps: p.apps,
  unit: p.unit,
  includedUnits: p.includedUnits,
  monthlyPrice: p.monthlyPrice,
  monthlyExtra: p.monthlyExtra,
  yearlyPrice: p.yearlyPrice,
  yearlyExtra: p.yearlyExtra,
  gstApplies: p.gstApplies,
  archivedAt: p.archivedAt,
  createdAt: p.createdAt,
  inUse: 0,
});

/** Customers by the name the console shows them under: their first company, unless the account was named. */
export const accountNames = async (ids: Array<string | null>) => {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  if (!list.length) return new Map<string, string>();
  const [rows, owners] = await Promise.all([
    platformPrisma.account.findMany({ where: { id: { in: list } }, select: { id: true, name: true, orgs: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } }),
    platformPrisma.accountMembership.findMany({ where: { accountId: { in: list }, role: 'OWNER' }, select: { accountId: true, userId: true } }),
  ]);
  const users = owners.length ? await platformPrisma.user.findMany({ where: { id: { in: owners.map((o) => o.userId) } }, select: { id: true, fullName: true } }) : [];
  const fullName = new Map(users.map((u) => [u.id, u.fullName]));
  const owner = new Map(owners.map((o) => [o.accountId, fullName.get(o.userId)]));
  return new Map(rows.map((r) => [r.id, customerTitle(r.name, owner.get(r.id), r.orgs[0]?.name)]));
};

const fromCustom = (p: any): DealPlan => ({
  source: 'custom',
  ref: p.id,
  name: p.name,
  apps: p.apps,
  unit: p.unit,
  includedUnits: p.includedUnits,
  gstApplies: p.gstApplies,
  monthly: p.monthlyPrice != null ? { basePrice: p.monthlyPrice, extraUnitPrice: p.monthlyExtra } : null,
  yearly: p.yearlyPrice != null ? { basePrice: p.yearlyPrice, extraUnitPrice: p.yearlyExtra } : null,
});

opsDealsRouter.get('/ops/custom-plans', (req, res) =>
  outsideTenant('ops: custom plans', async () => {
    const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined;
    const rows = await platformPrisma.customPlan.findMany({ where: accountId ? { OR: [{ accountId }, { accountId: null }] } : {}, orderBy: { createdAt: 'desc' }, take: 300 });
    const names = await accountNames(rows.map((r) => r.accountId));
    const used = await platformPrisma.subscription.groupBy({ by: ['planRef'], where: { planSource: 'custom', planRef: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    const uses = new Map(used.map((u) => [u.planRef, u._count._all]));
    res.json({ plans: rows.map((r) => ({ ...planShape(r, names), inUse: uses.get(r.id) || 0 })), apps: PRICEABLE_APPS.filter((a) => SELLABLE_APP_CODES.includes(a.code)) });
  }),
);

function planChecks(v: { monthlyPrice: number | null; yearlyPrice: number | null }) {
  if (v.monthlyPrice == null && v.yearlyPrice == null) return 'Give it a monthly price, a yearly price, or both.';
  return null;
}

opsDealsRouter.post('/ops/custom-plans', ...BILLING, (req, res) =>
  outsideTenant('ops: make a custom plan', async () => {
    const p = newPlan.extend({ reason: optionalReason }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the plan.' });
    const { reason: why, ...v } = p.data;
    const problem = planChecks(v);
    if (problem) return res.status(400).json({ error: problem });
    if (v.accountId && !(await platformPrisma.account.findUnique({ where: { id: v.accountId }, select: { id: true } }))) return res.status(404).json({ error: 'No such customer.' });
    const row = await platformPrisma.customPlan.create({ data: { ...v, apps: [...new Set(v.apps)], description: v.description || null, createdByUserId: req.auth!.userId } });
    await audit(req, 'CUSTOM_PLAN_MADE', { accountId: row.accountId }, { plan: row.name, ...(why ? { reason: why } : {}) }, { customerLog: false });
    res.status(201).json({ plan: planShape(row, await accountNames([row.accountId])) });
  }),
);

/** A subscription copied the price when it was set, so a change here reaches only deals made after it. */
opsDealsRouter.patch('/ops/custom-plans/:id', ...BILLING, (req, res) =>
  outsideTenant('ops: change a custom plan', async () => {
    const was = await platformPrisma.customPlan.findUnique({ where: { id: String(req.params.id) } });
    if (!was) return res.status(404).json({ error: 'No such plan.' });
    if (was.archivedAt) return res.status(409).json({ error: 'It is archived. Make a new one instead.' });
    const p = planFields.partial().extend({ reason: optionalReason }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the plan.' });
    const { reason: why, ...v } = p.data;
    const problem = planChecks({ monthlyPrice: v.monthlyPrice === undefined ? was.monthlyPrice : v.monthlyPrice, yearlyPrice: v.yearlyPrice === undefined ? was.yearlyPrice : v.yearlyPrice });
    if (problem) return res.status(400).json({ error: problem });
    const row = await platformPrisma.customPlan.update({ where: { id: was.id }, data: { ...v, ...(v.apps ? { apps: [...new Set(v.apps)] } : {}), updatedByUserId: req.auth!.userId } });
    await audit(req, 'CUSTOM_PLAN_CHANGED', { accountId: row.accountId }, { plan: row.name, ...(why ? { reason: why } : {}) }, { customerLog: false });
    res.json({ plan: planShape(row, await accountNames([row.accountId])) });
  }),
);

opsDealsRouter.post('/ops/custom-plans/:id/archive', ...BILLING, (req, res) =>
  outsideTenant('ops: archive a custom plan', async () => {
    const was = await platformPrisma.customPlan.findUnique({ where: { id: String(req.params.id) } });
    if (!was) return res.status(404).json({ error: 'No such plan.' });
    if (was.archivedAt) return res.status(409).json({ error: 'It is archived already.' });
    const row = await platformPrisma.customPlan.update({ where: { id: was.id }, data: { archivedAt: new Date(), updatedByUserId: req.auth!.userId } });
    await audit(req, 'CUSTOM_PLAN_ARCHIVED', { accountId: row.accountId }, { plan: row.name }, { customerLog: false });
    res.json({ plan: planShape(row, await accountNames([row.accountId])) });
  }),
);

/* ------------------------------------------------------- subscription deal */

const dealFields = z.object({
  source: z.enum(['book', 'custom']),
  ref: z.string().trim().min(1),
  period: z.enum(PRICE_PERIODS),
  quantity: z.number().int().min(1).max(100000),
  offerCode: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .nullable()
    .optional(),
});

/** The plan a deal names: in the published book, or a custom plan for this customer or any. */
async function dealPlan(accountId: string, source: 'book' | 'custom', ref: string): Promise<DealPlan> {
  if (source === 'book') {
    const book = await publishedBook();
    const p = book?.plans.find((x) => x.code === ref);
    if (!p) throw new DealError('That plan is not in the published price list.', 404);
    return fromBookPlan(p);
  }
  const c = await platformPrisma.customPlan.findUnique({ where: { id: ref } });
  if (!c || c.archivedAt) throw new DealError('No such custom plan.', 404);
  if (c.accountId && c.accountId !== accountId) throw new DealError('That custom plan was made for another customer.', 409);
  return fromCustom(c);
}

async function dealOffer(code: string | null | undefined) {
  if (!code) return null;
  const o = await platformPrisma.offer.findUnique({ where: { code } });
  if (!o) throw new DealError(`There is no offer ${code}.`, 404);
  return o as DealOffer;
}

export async function quoteFor(accountId: string, body: z.infer<typeof dealFields>) {
  const [plan, offer, gst, buyer, sub] = await Promise.all([
    dealPlan(accountId, body.source, body.ref),
    dealOffer(body.offerCode),
    taxSetting(),
    buyerFor(accountId),
    platformPrisma.subscription.findUnique({ where: { accountId }, select: { offerId: true } }),
  ]);
  /*
   * A customer who already holds the offer keeps it when their deal changes:
   * their place is taken, and a pause or an end date stops new customers, not
   * them. The plan and period rules still apply.
   */
  const held = Boolean(offer && sub?.offerId === offer.id);
  const asked = offer && held ? { ...offer, pausedAt: null, endsAt: null, maxRedemptions: null, startsAt: new Date(0) } : offer;
  return { plan, offer, held, deal: priceDeal({ plan, period: body.period as PricePeriod, quantity: body.quantity, offer: asked, gst, buyerStateCode: buyer.stateCode }) };
}

/** What can be sold to this customer now: published plans, custom plans for them or anyone, and offers in force. */
opsDealsRouter.get('/ops/accounts/:id/deal-options', (req, res) =>
  outsideTenant('ops: deal options', async () => {
    const id = String(req.params.id);
    if (!(await platformPrisma.account.findUnique({ where: { id }, select: { id: true } }))) return res.status(404).json({ error: 'No such customer' });
    const [book, custom, offers, sub] = await Promise.all([
      publishedBook(),
      platformPrisma.customPlan.findMany({ where: { archivedAt: null, OR: [{ accountId: id }, { accountId: null }] }, orderBy: { createdAt: 'desc' } }),
      platformPrisma.offer.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'desc' } }),
      getSubscription(id),
    ]);
    const now = new Date();
    const plans = [...(book?.plans || []).filter((p) => p.apps.every((a) => SELLABLE_APP_CODES.includes(a))).map(fromBookPlan), ...custom.map(fromCustom)];
    res.json({
      plans: plans.map((p) => ({ ...p, appNames: p.apps.map(appName), forThisCustomer: p.source === 'custom' && custom.find((c) => c.id === p.ref)?.accountId === id })),
      offers: offers.filter((o) => offerStatus(o as DealOffer, now) === 'active').map((o) => ({ code: o.code, name: o.name, words: offerWords(o), planCodes: o.planCodes, periods: o.periods })),
      current: sub ? { status: sub.status, apps: sub.items.map((i) => i.appCode), planSource: (sub as any).planSource ?? null, planRef: (sub as any).planRef ?? null } : null,
      priceListPublished: Boolean(book),
    });
  }),
);

opsDealsRouter.post('/ops/accounts/:id/deal/quote', (req, res) =>
  outsideTenant('ops: price a deal', async () => {
    const id = String(req.params.id);
    const p = dealFields.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Pick a plan, a period and how many.' });
    try {
      const q = await quoteFor(id, p.data);
      const limit = (await approvalSettings()).discountPercent;
      /* Whether setting it will need a second person (Approvals), so the drawer can say so before it is sent. */
      res.json({ deal: q.deal, needsApproval: overLimit(q.deal, limit), limit });
    } catch (e) {
      return fail(res, e);
    }
  }),
);

export const dealBody = dealFields.extend({
  status: z.enum(['active', 'trialing']).default('active'),
  trialDays: z.number().int().min(1).max(365).nullable().optional(),
  startsOn: day.nullable().optional(),
  draftInvoice: z.boolean().default(false),
  reason,
});
export type DealBody = z.infer<typeof dealBody>;

/** One line naming a deal, for the approvals list and the audit log. */
export const dealSummary = (q: { deal: { plan: { name: string; unit: string }; quantity: number; period: string; offer: { code: string; words: string } | null; periodAmount: number; listAmount: number } }) =>
  `${q.deal.plan.name}, ${unitWord(q.deal.plan.unit, q.deal.quantity)}, ${q.deal.period === 'YEARLY' ? 'yearly' : 'monthly'}, ${rupees(q.deal.periodAmount)} instead of ${rupees(q.deal.listAmount)}${q.deal.offer ? ` (${q.deal.offer.code}: ${q.deal.offer.words})` : ''}`.slice(0, 300);

/**
 * Whether a deal takes more off the list price than the limit (Approvals), so
 * a second person must approve it. Every time it is set, also for a customer
 * who already holds the offer: more units at the same share is more money off.
 */
export const overLimit = (d: { discount: number; listAmount: number }, limit: number) => d.discount > 0 && d.discount * 100 > limit * d.listAmount;

/** The share of the list price a deal takes off, in percent (two decimals). */
export const discountShare = (d: { discount: number; listAmount: number }) => (d.listAmount > 0 ? Math.round((d.discount * 10000) / d.listAmount) / 100 : 0);

/**
 * Set the deal: the subscription carries the plan's apps, the units, the
 * period and the price, from the start date. An offer counts one customer the
 * first time it is set on them. With draftInvoice, the first period's invoice
 * is drafted for Billing to check and issue. Priced again here, so a deal
 * approved later uses the offer and plan as they are then.
 */
export async function applyDeal(id: string, v: DealBody, operatorUserId: string) {
  const q = await quoteFor(id, v);
  const { plan, offer, deal, held: sameOffer } = q;
  const before = await getSubscription(id);

  /* Count the customer on the offer first, conditionally, so the last place cannot be taken twice. */
  if (offer && !sameOffer) {
    const taken = await platformPrisma.offer.updateMany({
      where: { id: offer.id, archivedAt: null, pausedAt: null, ...(offer.maxRedemptions != null ? { redemptions: { lt: offer.maxRedemptions } } : {}) },
      data: { redemptions: { increment: 1 } },
    });
    if (!taken.count) throw new DealError(`${offer.code} has just been used up or paused. Choose another offer.`, 409);
  }

  /* Today as it is in India, not in UTC: a deal set at 1 am IST starts that day. */
  const start = v.startsOn || new Date(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const firstDay = v.status === 'trialing' ? new Date(start.getTime() + v.trialDays! * 86_400_000) : start;
  const end = periodEnd(firstDay, deal.period);
  const keep = new Map((before?.items || []).map((i) => [i.appCode, i]));
  try {
    await setSubscription(id, {
      /* People carries Attendance, as everywhere else a plan is set. */
      apps: [...new Set([...plan.apps, ...(plan.apps.includes('people') ? ['attendance'] : [])])].map((appCode) => ({ appCode, tier: keep.get(appCode)?.tier ?? null, seats: deal.quantity, priceModel: 'plan', unitAmount: null })),
      status: v.status,
      billingInterval: deal.period === 'YEARLY' ? 'year' : 'month',
      trialEndsAt: v.status === 'trialing' ? firstDay : null,
      currentPeriodEnd: end,
    });
  } catch (e) {
    if (offer && !sameOffer) await platformPrisma.offer.update({ where: { id: offer.id }, data: { redemptions: { decrement: 1 } } });
    throw e;
  }
  /*
   * Counted period by period, as renewals move on (each from the last one's
   * end), so a start on the 31st ends the offer on the day a renewal starts.
   */
  let offerEndsAt: Date | null = null;
  if (offer && offer.durationPeriods != null) {
    offerEndsAt = firstDay;
    for (let i = 0; i < offer.durationPeriods; i++) offerEndsAt = periodEnd(offerEndsAt, deal.period);
  }
  await platformPrisma.subscription.update({
    where: { accountId: id },
    data: {
      planSource: plan.source,
      planRef: plan.ref,
      planName: plan.name,
      planUnit: plan.unit,
      quantity: deal.quantity,
      listAmount: deal.listAmount,
      periodAmount: deal.periodAmount,
      offerId: offer?.id ?? null,
      offerCode: offer?.code ?? null,
      offerEndsAt,
      currentPeriodStart: firstDay,
      ...(v.status === 'active' ? { trialEndsAt: null } : {}),
    },
  });
  clearAccessCache();

  /* The deal is set by now; a draft that cannot be made is said, not a reason to call the deal failed. */
  let invoice: { id: string } | null = null;
  let invoiceProblem: string | null = null;
  if (v.draftInvoice) {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const lastDay = new Date(end.getTime() - 86_400_000);
    try {
      invoice = await createDraft({ accountId: id, lines: [deal.line], periodStart: iso(firstDay), periodEnd: iso(lastDay), months: deal.period === 'YEARLY' ? 12 : 1 }, operatorUserId);
    } catch (e) {
      invoiceProblem = `The first invoice was not drafted: ${String(e instanceof Error ? e.message : e).slice(0, 200)} Draft it under Invoices.`;
    }
  }
  const record = {
    plan: plan.name,
    units: deal.quantity,
    period: deal.period === 'YEARLY' ? 'yearly' : 'monthly',
    price: rupees(deal.periodAmount),
    ...(offer ? { offer: `${offer.code} (${deal.offer?.words})` } : {}),
    ...(v.status === 'trialing' ? { trial: `${v.trialDays} days` } : {}),
    reason: v.reason,
    ...(invoiceProblem ? { invoice: invoiceProblem } : {}),
  };
  return { deal, invoiceId: invoice?.id ?? null, invoiceProblem, subscription: await getSubscription(id), record };
}

/**
 * Set a deal, or, when its discount is above the limit (Approvals), ask a
 * second person: 202 with the request, and nothing changes until someone
 * else approves it. One waiting request per customer.
 */
opsDealsRouter.post('/ops/accounts/:id/deal', ...BILLING, (req, res) =>
  outsideTenant('ops: set a subscription deal', async () => {
    const id = String(req.params.id);
    const p = dealBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the subscription.' });
    const v = p.data;
    if (!(await platformPrisma.account.findUnique({ where: { id }, select: { id: true } }))) return res.status(404).json({ error: 'No such customer' });
    if (v.status === 'trialing' && !v.trialDays) return res.status(400).json({ error: 'Say how many days the trial lasts.' });
    try {
      const q = await quoteFor(id, v);
      const limit = (await approvalSettings()).discountPercent;
      if (overLimit(q.deal, limit)) {
        /* One request at a time per customer, so two cannot both be approved and set. */
        const waiting = await platformPrisma.opsApproval.findFirst({ where: { accountId: id, kind: 'DEAL', status: 'PENDING', expiresAt: { gt: new Date() } }, select: { id: true } });
        if (waiting) return res.status(409).json({ error: 'A deal for this customer is already waiting in Approvals. Withdraw it there first, or wait for the decision.' });
        const customerName = (await accountNames([id])).get(id) || 'A customer';
        const approval = await askApproval(req, { kind: 'DEAL', accountId: id, customerName, payload: req.body, summary: dealSummary(q), discountPercent: Math.round(discountShare(q.deal)), reason: v.reason });
        return res.status(202).json({ needsApproval: true, approval, limit });
      }
      const r = await applyDeal(id, v, req.auth!.userId);
      await audit(req, 'SUBSCRIPTION_DEAL_SET', { accountId: id }, r.record);
      res.json({ deal: r.deal, invoiceId: r.invoiceId, invoiceProblem: r.invoiceProblem, subscription: r.subscription });
    } catch (e) {
      return fail(res, e);
    }
  }),
);

/* ------------------------------------------------------- subscriptions list */

/** Every customer with a plan, what they pay and when it renews; the monthly total of what active ones pay (before GST). */
opsDealsRouter.get('/ops/subscriptions', (req, res) =>
  outsideTenant('ops: subscriptions', async () => {
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    const rows = await platformPrisma.subscription.findMany({ where: status ? { status } : {}, orderBy: { updatedAt: 'desc' }, take: 500, include: { items: { select: { appCode: true } } } });
    const [codes, titles] = await Promise.all([platformPrisma.account.findMany({ where: { id: { in: rows.map((r) => r.accountId) } }, select: { id: true, code: true } }), accountNames(rows.map((r) => r.accountId))]);
    const byId = new Map(codes.map((n) => [n.id, { code: n.code, name: titles.get(n.id) }]));
    const now = new Date();
    const charged = (r: (typeof rows)[number]) => (r.periodAmount == null ? null : r.offerEndsAt && r.offerEndsAt <= now ? r.listAmount : r.periodAmount);
    let monthly = 0;
    for (const r of rows) {
      const c = charged(r);
      if (r.status !== 'active' || c == null) continue;
      monthly += r.billingInterval === 'year' ? Math.round(c / 12) : c;
    }
    res.json({
      subscriptions: rows.map((r) => ({
        accountId: r.accountId,
        name: byId.get(r.accountId)?.name || 'A customer',
        code: byId.get(r.accountId)?.code || null,
        status: r.status,
        apps: r.items.map((i) => i.appCode),
        planName: r.planName,
        planSource: r.planSource,
        unit: r.planUnit,
        quantity: r.quantity,
        interval: r.billingInterval,
        amount: charged(r),
        listAmount: r.listAmount,
        offerCode: r.offerCode,
        offerEndsAt: r.offerEndsAt,
        trialEndsAt: r.trialEndsAt,
        renewsAt: r.currentPeriodEnd,
        byHand: !r.gatewayName,
      })),
      monthly,
    });
  }),
);
