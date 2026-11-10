import { Router } from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { pricingQuoteLimiter } from '../middleware/rateLimit.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { deriveStateCodeFromInput } from '../utils/gstin.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { archiveBook, createDraft, listBooks, oneBook, publishDraft, publishedBook, rollBackTo, updateDraft } from '../services/pricing/books.js';
import { NO_GST_NOTE, PRICEABLE_APPS, PRICE_PERIODS, PRICE_UNITS, PricingError, onWebsite, planProblems, priceFor, quote, sortPlans, type PlanData, type PriceBookData } from '../services/pricing/engine.js';
import { samplePlans } from '../services/pricing/seed.js';
import { GST_RATES, GST_SETTING_KEY, checkTaxInput, taxSetting, type TaxSetting } from '../services/pricing/settings.js';
import { audit } from './ops.js';
import { siteOrigins } from './demoRequests.js';

/**
 * Pricing (roadmap item 9): CLOR's price list as its own engine
 * (services/pricing/), made entirely in the operator console.
 *
 * The public side, for clor.in with no sign-in: the published price book,
 * and a quote worked out from it. With nothing published the list answers
 * 404 and the site shows Request a demo instead of prices. Nothing a visitor
 * sends is kept.
 *
 * The operator side: plans, prices, publishing, archiving, rolling back, and
 * CLOR's own GST registration (Settings, Tax). Reading is for any operator;
 * every change is for the BILLING role with a fresh authenticator code
 * (step-up), and goes on the operator log. A published book is never edited,
 * and no change here touches a subscription already running: those keep their
 * own amounts on SubscriptionItem.
 */
export const pricingRouter = Router();
export const opsPricingRouter = Router();

/* ---------------------------------------------------------------- public */

/* clor.in is another origin: these two routes are open to the site's own origins, without credentials. Mounted in app.ts ahead of the app-wide CORS. */
export const pricingCors = cors({
  origin: (origin, cb) => cb(null, !origin || siteOrigins().has(origin)),
  methods: ['GET', 'POST'],
  credentials: false,
  maxAge: 7200,
  allowedHeaders: ['Content-Type'],
});

const gstNote = (t: Pick<TaxSetting, 'registered' | 'ratePercent'>) => (t.registered ? `Prices are before GST. GST at ${t.ratePercent}% is added.` : NO_GST_NOTE);

/** Plans as a pricing card shows them: each period's price worked out, and what yearly saves. */
export function planCards(plans: PlanData[]) {
  return sortPlans(plans).map((p) => {
    const monthly = priceFor(p, 'MONTHLY');
    const yearly = priceFor(p, 'YEARLY');
    return {
      code: p.code,
      name: p.name,
      description: p.description ?? null,
      apps: p.apps,
      unit: p.unit,
      includedUnits: p.includedUnits,
      trialDays: p.trialDays,
      highlight: p.highlight,
      gstApplies: p.gstApplies,
      monthly: monthly ? { basePrice: monthly.basePrice, extraUnitPrice: monthly.extraUnitPrice } : null,
      yearly: yearly ? { basePrice: yearly.basePrice, extraUnitPrice: yearly.extraUnitPrice, saving: monthly ? Math.max(0, monthly.basePrice * 12 - yearly.basePrice) : 0 } : null,
    };
  });
}

/** The published book as clor.in shows it: only the plans switched on for the site whose apps are all available. */
export function publicPricing(book: PriceBookData & { publishedAt?: Date | null }, tax: Pick<TaxSetting, 'registered' | 'ratePercent'>) {
  return {
    version: book.version,
    publishedAt: book.publishedAt ?? null,
    currency: book.currency,
    note: book.note ?? null,
    gst: { charged: tax.registered, ratePercent: tax.registered ? tax.ratePercent : 0, note: gstNote(tax) },
    apps: PRICEABLE_APPS,
    plans: planCards(book.plans.filter(onWebsite)),
  };
}

const NONE_PUBLISHED = { error: 'No prices are published.', code: 'NO_PRICE_BOOK' };

pricingRouter.get('/public/pricing', (_req, res) =>
  outsideTenant('pricing: the public price list', async () => {
    const [book, tax] = await Promise.all([publishedBook(), taxSetting()]);
    /* A minute at the edge: a publish or an archive shows on the site within that. */
    res.set('Cache-Control', 'public, max-age=60');
    if (!book) return res.status(404).json(NONE_PUBLISHED);
    res.json(publicPricing(book, tax));
  }),
);

const counts = {
  period: z.string().trim().toUpperCase().pipe(z.enum(PRICE_PERIODS, { error: 'Choose monthly or yearly.' })),
  users: z.coerce.number().int().min(0).max(1_000_000).optional(),
  employees: z.coerce.number().int().min(0).max(1_000_000).optional(),
  companies: z.coerce.number().int().min(1).max(1000).optional(),
  /** The buyer's state, by name or two-digit code: CGST + SGST or IGST, once CLOR charges GST. */
  state: z.string().trim().max(60).optional().nullable(),
};
const quoteBody = z.object({ plans: z.array(z.string().max(40)).min(1, 'Choose at least one plan.').max(20), ...counts });
type QuoteBody = z.infer<typeof quoteBody>;

const quoteFor = (d: QuoteBody, book: PriceBookData, tax: TaxSetting, websiteOnly: boolean) =>
  quote({ ...d, priceBook: book, gst: tax, buyerStateCode: d.state ? deriveStateCodeFromInput(d.state) || null : null, websiteOnly });

pricingRouter.post('/public/pricing/quote', ...pricingQuoteLimiter, (req, res) =>
  outsideTenant('pricing: a quote for a visitor', async () => {
    const parsed = quoteBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the quote.', code: 'INVALID' });
    const [book, tax] = await Promise.all([publishedBook(), taxSetting()]);
    if (!book) return res.status(404).json(NONE_PUBLISHED);
    try {
      res.json({ quote: quoteFor(parsed.data, book, tax, true) });
    } catch (e) {
      if (e instanceof PricingError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }
  }),
);

/* -------------------------------------------------------------- operator */

opsPricingRouter.use(['/ops/pricing', '/ops/settings'], requireAuth, requireOperator);

const refused = (res: Response, e: unknown) => {
  if (!(e instanceof PricingError)) throw e;
  const extra = e as PricingError & { problems?: string[]; draftId?: string };
  return res.status(e.status).json({ error: e.message, code: e.code, problems: extra.problems, draftId: extra.draftId });
};

const taxView = (t: TaxSetting) => ({ registered: t.registered, gstin: t.gstin, legalName: t.legalName, stateCode: t.stateCode, sac: t.sac, ratePercent: t.ratePercent, note: gstNote(t) });

/** Every book, newest first, what a plan may carry, and CLOR's GST standing. */
opsPricingRouter.get('/ops/pricing', (_req, res) =>
  outsideTenant('ops: pricing', async () => {
    const [books, tax] = await Promise.all([listBooks(), taxSetting()]);
    res.json({ books, tax: taxView(tax), apps: PRICEABLE_APPS, units: PRICE_UNITS, periods: PRICE_PERIODS });
  }),
);

/** The sample prices, for the draft editor's Load sample prices. Nothing is saved until the operator saves the draft. */
opsPricingRouter.get('/ops/pricing/sample', (_req, res) => {
  res.json({ plans: samplePlans(), note: 'Sample prices — not final' });
});

opsPricingRouter.get('/ops/pricing/books/:id', (req, res) =>
  outsideTenant('ops: one price book', async () => {
    const book = await oneBook(String(req.params.id));
    if (!book) return res.status(404).json({ error: 'No such price book.' });
    res.json({ book });
  }),
);

const priceRow = z.object({ period: z.enum(PRICE_PERIODS), basePrice: z.number().int(), extraUnitPrice: z.number().int() });
const planRow = z.object({
  code: z.string().trim().toLowerCase().max(40),
  name: z.string().max(120),
  description: z.string().max(600).optional().nullable(),
  apps: z.array(z.string().max(40)).max(20),
  unit: z.enum(PRICE_UNITS),
  includedUnits: z.number().int(),
  trialDays: z.number().int(),
  periods: z.array(z.enum(PRICE_PERIODS)).max(2),
  yearlyDiscountPct: z.number().int().nullable(),
  displayOrder: z.number().int(),
  showOnWebsite: z.boolean(),
  highlight: z.boolean(),
  gstApplies: z.boolean(),
  prices: z.array(priceRow).max(2),
});
const plansBody = z.array(planRow).max(100);

/**
 * The editor's preview: the clor.in cards and a sample quote for the plans as
 * they stand in the editor, saved or not. Reads nothing and writes nothing.
 */
const previewBody = z.object({ plans: plansBody, quote: quoteBody.partial({ plans: true }).optional() });
opsPricingRouter.post('/ops/pricing/preview', (req, res) =>
  outsideTenant('ops: price preview', async () => {
    const parsed = previewBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the plans: every amount is whole paise.', code: 'INVALID' });
    const plans = parsed.data.plans as PlanData[];
    const problems = planProblems(plans);
    const tax = await taxSetting();
    let q = null;
    let quoteError = null;
    const ask = parsed.data.quote;
    if (ask && !problems.length) {
      try {
        q = quoteFor({ ...ask, plans: ask.plans?.length ? ask.plans : plans.slice(0, 1).map((p) => p.code) }, { version: 0, currency: 'INR', plans }, tax, false);
      } catch (e) {
        if (!(e instanceof PricingError)) throw e;
        quoteError = e.message;
      }
    }
    res.json({ problems, cards: problems.length ? [] : planCards(plans.filter(onWebsite)), hidden: plans.filter((p) => !onWebsite(p)).map((p) => p.code), quote: q, quoteError, gst: { charged: tax.registered, note: gstNote(tax) } });
  }),
);

const draftBody = z.object({ fromId: z.string().max(40).optional().nullable(), empty: z.boolean().optional() });

/** A new draft: empty, or copied from the published book (or the one named). */
opsPricingRouter.post('/ops/pricing/books', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: a new draft price book', async () => {
    const parsed = draftBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid draft.' });
    try {
      const book = await createDraft(req.auth!.userId, parsed.data);
      await audit(req, 'PRICE_BOOK_DRAFTED', {}, { priceBookId: book.id, version: book.version, copiedFromId: book.copiedFromId, empty: Boolean(parsed.data.empty) });
      res.status(201).json({ book });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/* What changed, plan by plan, for the operator log. */
const planChanges = (before: PlanData[], after: PlanData[]) => {
  const was = new Map(before.map((p) => [p.code, JSON.stringify(p)]));
  const now = new Map(after.map((p) => [p.code, JSON.stringify(p)]));
  return {
    added: after.filter((p) => !was.has(p.code)).map((p) => p.code),
    removed: before.filter((p) => !now.has(p.code)).map((p) => p.code),
    changed: after.filter((p) => was.has(p.code) && was.get(p.code) !== now.get(p.code)).map((p) => ({ code: p.code, from: JSON.parse(was.get(p.code)!).prices, to: p.prices })),
  };
};

const editBody = z.object({ note: z.string().trim().max(200).optional().nullable(), plans: plansBody.optional() });

/** Edit a draft: the note, and the plans as one set. */
opsPricingRouter.patch('/ops/pricing/books/:id', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: edit a draft price book', async () => {
    const parsed = editBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the plans: every amount is whole paise.', code: 'INVALID' });
    try {
      const note = parsed.data.note === undefined ? undefined : parsed.data.note || null;
      const { before, after } = await updateDraft(String(req.params.id), { note, plans: parsed.data.plans as PlanData[] | undefined });
      await audit(req, 'PRICE_BOOK_EDITED', {}, {
        priceBookId: after.id,
        version: after.version,
        note: note === undefined || note === before.note ? undefined : { from: before.note, to: after.note },
        plans: parsed.data.plans ? planChanges(before.plans, after.plans) : undefined,
      });
      res.json({ book: after });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** Publish a draft: it replaces the published book on clor.in and in quotes; the old one is archived and kept. */
opsPricingRouter.post('/ops/pricing/books/:id/publish', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: publish a price book', async () => {
    try {
      const { previous, book } = await publishDraft(String(req.params.id), req.auth!.userId);
      await audit(req, 'PRICE_BOOK_PUBLISHED', {}, { priceBookId: book.id, version: book.version, previousVersion: previous?.version ?? null });
      res.json({ book, previousVersion: previous?.version ?? null });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** Archive the published book (the site then shows Request a demo) or discard a draft. Kept either way. */
opsPricingRouter.post('/ops/pricing/books/:id/archive', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: archive a price book', async () => {
    try {
      const { was, book } = await archiveBook(String(req.params.id));
      await audit(req, 'PRICE_BOOK_ARCHIVED', {}, { priceBookId: book.id, version: book.version, was });
      res.json({ book, was });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** Roll back: an older version copied as a new one and published at once. */
opsPricingRouter.post('/ops/pricing/books/:id/roll-back', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: roll back a price book', async () => {
    try {
      const { previous, from, book } = await rollBackTo(String(req.params.id), req.auth!.userId);
      await audit(req, 'PRICE_BOOK_ROLLED_BACK', {}, { priceBookId: book.id, version: book.version, fromVersion: from.version, previousVersion: previous?.version ?? null });
      res.json({ book, fromVersion: from.version, previousVersion: previous?.version ?? null });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/* ------------------------------------------------------- Settings, Tax */

opsPricingRouter.get('/ops/settings/tax', (_req, res) =>
  outsideTenant('ops: tax settings', async () => {
    res.json({ tax: taxView(await taxSetting()), rates: GST_RATES });
  }),
);

const taxBody = z.object({
  registered: z.boolean(),
  gstin: z.string().max(20).optional().nullable(),
  legalName: z.string().max(200).optional().nullable(),
  state: z.string().max(60).optional().nullable(),
  sac: z.string().max(12).optional().nullable(),
  ratePercent: z.number().int().optional().nullable(),
});

/** CLOR's GST registration. Off: no tax line on any quote. On: a valid GSTIN, the legal name and a SAC code first. */
opsPricingRouter.put('/ops/settings/tax', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: tax settings', async () => {
    const parsed = taxBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the tax settings.', code: 'INVALID' });
    const { value, problems } = checkTaxInput(parsed.data);
    if (problems.length) return res.status(400).json({ error: problems[0], code: 'INVALID_TAX', problems });
    const before = await taxSetting();
    await platformPrisma.platformSetting.upsert({ where: { key: GST_SETTING_KEY }, create: { key: GST_SETTING_KEY, value: value as any, updatedByUserId: req.auth!.userId }, update: { value: value as any, updatedByUserId: req.auth!.userId } });
    const after = await taxSetting();
    await audit(req, 'TAX_SETTINGS_CHANGED', {}, { from: taxView(before), to: taxView(after) });
    res.json({ tax: taxView(after) });
  }),
);
