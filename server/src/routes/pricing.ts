import { Router } from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { pricingQuoteLimiter } from '../middleware/rateLimit.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { deriveStateCodeFromInput } from '../utils/gstin.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { createDraft, listBooks, oneBook, publishDraft, publishedBook, updateDraft } from '../services/pricing/books.js';
import { NO_GST_NOTE, GST_RATE_PERCENT, PRICED_APPS, PRICE_PERIODS, PRICE_UNITS, PricingError, TIERS, quote, tierName, type PlanPriceRow, type PriceBookData } from '../services/pricing/engine.js';
import { gstSetting } from '../services/pricing/settings.js';
import { audit } from './ops.js';
import { siteOrigins } from './demoRequests.js';

/**
 * Pricing (roadmap item 9): CLOR's price list as its own engine
 * (services/pricing/).
 *
 * The public side, for clor.in with no sign-in: the published price book, and
 * a quote worked out from it. Nothing a visitor sends is kept.
 *
 * The operator side: CLOR's billing team lists the books, makes a draft by
 * copying the published one, edits its prices and publishes it. Behind
 * requireOperator, the BILLING role and step-up, like routes/ops.ts; every
 * change is on the operator log. A published book is never edited, and a
 * publish does not touch a subscription already running: those keep their
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

const gstNote = (registered: boolean) => (registered ? `Prices are before GST. GST at ${GST_RATE_PERCENT}% is added.` : NO_GST_NOTE);

/** The published book as clor.in shows it: apps in the site's order, each with its tiers and periods. */
export function publicPricing(book: PriceBookData & { publishedAt?: Date | null }, gst: { registered: boolean }) {
  const tiers = [...new Set(book.prices.map((p) => p.tier))];
  return {
    version: book.version,
    publishedAt: book.publishedAt ?? null,
    currency: book.currency,
    note: book.note ?? null,
    gst: {
      charged: gst.registered,
      ratePercent: gst.registered ? GST_RATE_PERCENT : 0,
      note: gstNote(gst.registered),
    },
    tiers: tiers.map((code) => ({ code, name: tierName(code) })),
    apps: PRICED_APPS.filter((a) => book.prices.some((p) => p.appCode === a.code)).map((a) => ({
      code: a.code,
      name: a.name,
      prices: book.prices
        .filter((p) => p.appCode === a.code)
        .map(({ tier, period, unit, unitAmount, includedUnits, trialDays, gstApplies }) => ({
          tier,
          period,
          unit,
          unitAmount,
          includedUnits,
          trialDays,
          gstApplies,
        })),
    })),
  };
}

const NONE_PUBLISHED = {
  error: 'Prices are not published yet.',
  code: 'NO_PRICE_BOOK',
};

pricingRouter.get('/public/pricing', (_req, res) =>
  outsideTenant('pricing: the public price list', async () => {
    const [book, gst] = await Promise.all([publishedBook(), gstSetting()]);
    if (!book) return res.status(503).json(NONE_PUBLISHED);
    /* Five minutes in a browser or the edge; a publish shows on the site within that. */
    res.set('Cache-Control', 'public, max-age=300');
    res.json(publicPricing(book, gst));
  }),
);

const quoteBody = z.object({
  apps: z.array(z.string().max(40)).min(1, 'Choose at least one app.').max(10),
  tier: z.string().trim().toLowerCase().max(24),
  period: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(PRICE_PERIODS, { error: 'Choose monthly or yearly.' })),
  users: z.coerce.number().int().min(0).max(1_000_000).optional(),
  employees: z.coerce.number().int().min(0).max(1_000_000).optional(),
  companies: z.coerce.number().int().min(1).max(1000).optional(),
  /** The buyer's state, by name or two-digit code: CGST + SGST or IGST, once CLOR charges GST. */
  state: z.string().trim().max(60).optional().nullable(),
});

pricingRouter.post('/public/pricing/quote', ...pricingQuoteLimiter, (req, res) =>
  outsideTenant('pricing: a quote for a visitor', async () => {
    const parsed = quoteBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Check the quote.',
        code: 'INVALID',
      });
    const [book, gst] = await Promise.all([publishedBook(), gstSetting()]);
    if (!book) return res.status(503).json(NONE_PUBLISHED);
    const d = parsed.data;
    try {
      const q = quote({
        ...d,
        priceBook: book,
        gst,
        buyerStateCode: d.state ? deriveStateCodeFromInput(d.state) || null : null,
      });
      res.json({ quote: q });
    } catch (e) {
      if (e instanceof PricingError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }
  }),
);

/* -------------------------------------------------------------- operator */

opsPricingRouter.use('/ops/pricing', requireAuth, requireOperator);

const refused = (res: Response, e: unknown) => {
  if (!(e instanceof PricingError)) throw e;
  const extra = e as PricingError & { problems?: string[]; draftId?: string };
  return res.status(e.status).json({
    error: e.message,
    code: e.code,
    problems: extra.problems,
    draftId: extra.draftId,
  });
};

/** Every book, newest first, and CLOR's GST standing. */
opsPricingRouter.get('/ops/pricing', (_req, res) =>
  outsideTenant('ops: pricing', async () => {
    const [books, gst] = await Promise.all([listBooks(), gstSetting()]);
    res.json({
      books,
      gst: {
        registered: gst.registered,
        gstin: gst.gstin,
        ratePercent: gst.registered ? GST_RATE_PERCENT : 0,
        note: gstNote(gst.registered),
      },
      tiers: TIERS,
      apps: PRICED_APPS,
    });
  }),
);

opsPricingRouter.get('/ops/pricing/books/:id', (req, res) =>
  outsideTenant('ops: one price book', async () => {
    const book = await oneBook(String(req.params.id));
    if (!book) return res.status(404).json({ error: 'No such price book.' });
    res.json({ book });
  }),
);

const draftBody = z.object({
  fromId: z.string().max(40).optional().nullable(),
});

/** A new draft, copied from the published book (or the one named). */
opsPricingRouter.post('/ops/pricing/books', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: a new draft price book', async () => {
    const parsed = draftBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid draft.' });
    try {
      const book = await createDraft(req.auth!.userId, parsed.data.fromId);
      await audit(
        req,
        'PRICE_BOOK_DRAFTED',
        {},
        {
          priceBookId: book.id,
          version: book.version,
          copiedFromId: book.copiedFromId,
        },
      );
      res.status(201).json({ book });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

const priceRow = z.object({
  appCode: z.string().max(40),
  tier: z.string().trim().toLowerCase().max(24),
  period: z.enum(PRICE_PERIODS),
  unit: z.enum(PRICE_UNITS),
  /** Paise, a whole number. */
  unitAmount: z.number().int(),
  includedUnits: z.number().int(),
  trialDays: z.number().int(),
  gstApplies: z.boolean(),
});
const editBody = z.object({
  note: z.string().trim().max(200).optional().nullable(),
  prices: z.array(priceRow).max(200).optional(),
});

/* What changed, row by row, for the operator log: an amount from and to. */
const changes = (before: PlanPriceRow[], after: PlanPriceRow[]) => {
  const key = (p: PlanPriceRow) => `${p.appCode}|${p.tier}|${p.period}`;
  const was = new Map(before.map((p) => [key(p), p]));
  const now = new Map(after.map((p) => [key(p), p]));
  const out: {
    price: string;
    from: Partial<PlanPriceRow> | null;
    to: Partial<PlanPriceRow> | null;
  }[] = [];
  for (const [k, p] of now) {
    const b = was.get(k);
    const fields = (['unit', 'unitAmount', 'includedUnits', 'trialDays', 'gstApplies'] as const).filter((f) => !b || b[f] !== p[f]);
    if (fields.length)
      out.push({
        price: k,
        from: b ? Object.fromEntries(fields.map((f) => [f, b[f]])) : null,
        to: Object.fromEntries(fields.map((f) => [f, p[f]])),
      });
  }
  for (const [k] of was)
    if (!now.has(k))
      out.push({
        price: k,
        from: { unitAmount: was.get(k)!.unitAmount },
        to: null,
      });
  return out.slice(0, 60);
};

/** Edit a draft: the note, and the prices as one set. */
opsPricingRouter.patch('/ops/pricing/books/:id', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: edit a draft price book', async () => {
    const parsed = editBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: 'Check the prices: each amount is whole paise.',
        code: 'INVALID',
      });
    try {
      const { before, after } = await updateDraft(String(req.params.id), {
        note: parsed.data.note === undefined ? undefined : parsed.data.note || null,
        prices: parsed.data.prices as PlanPriceRow[] | undefined,
      });
      await audit(
        req,
        'PRICE_BOOK_EDITED',
        {},
        {
          priceBookId: after.id,
          version: after.version,
          note: parsed.data.note === undefined || (parsed.data.note || null) === before.note ? undefined : { from: before.note, to: after.note },
          changes: parsed.data.prices ? changes(before.prices, after.prices) : undefined,
        },
      );
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
      await audit(
        req,
        'PRICE_BOOK_PUBLISHED',
        {},
        {
          priceBookId: book.id,
          version: book.version,
          previousVersion: previous?.version ?? null,
        },
      );
      res.json({ book, previousVersion: previous?.version ?? null });
    } catch (e) {
      return refused(res, e);
    }
  }),
);
