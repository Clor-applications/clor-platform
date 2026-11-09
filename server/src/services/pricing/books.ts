import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';
import { PricingError, priceProblems, sortPrices, type PlanPriceRow, type PriceBookData, type PricePeriod, type PriceUnit } from './engine.js';

/**
 * Price books in the platform database: the published one for clor.in and
 * quotes, and the operator's draft -> publish cycle (routes/pricing.ts).
 *
 * A published or archived book is never edited. A change is a new version:
 * copy, edit the draft, publish; the old one is archived in the same
 * transaction and kept, so what anybody was quoted can always be shown again.
 */

const PRICE_FIELDS = {
  appCode: true,
  tier: true,
  period: true,
  unit: true,
  unitAmount: true,
  includedUnits: true,
  trialDays: true,
  gstApplies: true,
} as const;

type BookRow = {
  id: string;
  version: number;
  status: string;
  currency: string;
  note: string | null;
  copiedFromId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
  prices?: unknown[];
};

export const bookData = (b: {
  version: number;
  currency: string;
  note: string | null;
  prices: {
    appCode: string;
    tier: string;
    period: string;
    unit: string;
    unitAmount: number;
    includedUnits: number;
    trialDays: number;
    gstApplies: boolean;
  }[];
}): PriceBookData => ({
  version: b.version,
  currency: b.currency,
  note: b.note,
  prices: sortPrices(
    b.prices.map((p) => ({
      ...p,
      period: p.period as PricePeriod,
      unit: p.unit as PriceUnit,
    })),
  ),
});

/* ------------------------------------------------- the published book, cached */

/*
 * clor.in and every quote read the published book. It changes when somebody
 * publishes, which is rare, so each instance keeps it for a minute; a publish
 * on this instance clears it at once, another instance's within the minute.
 */
const CACHE_MS = 60_000;
let cached: {
  at: number;
  book: (PriceBookData & { id: string; publishedAt: Date | null }) | null;
} | null = null;
export const clearPublishedCache = () => {
  cached = null;
};

export async function publishedBook() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.book;
  const b = await outsideTenant('pricing: the published price book', () =>
    platformPrisma.priceBook.findFirst({
      where: { status: 'PUBLISHED' },
      include: { prices: { select: PRICE_FIELDS } },
    }),
  );
  const book = b ? { ...bookData(b), id: b.id, publishedAt: b.publishedAt } : null;
  cached = { at: Date.now(), book };
  return book;
}

/* ---------------------------------------------------------------- operator */

const summary = (b: BookRow & { _count?: { prices: number } }) => ({
  id: b.id,
  version: b.version,
  status: b.status,
  currency: b.currency,
  note: b.note,
  copiedFromId: b.copiedFromId,
  createdAt: b.createdAt,
  publishedAt: b.publishedAt,
  archivedAt: b.archivedAt,
  priceCount: b._count?.prices ?? b.prices?.length ?? 0,
});

export const listBooks = () =>
  outsideTenant('ops: price books', async () => {
    const rows = await platformPrisma.priceBook.findMany({
      orderBy: { version: 'desc' },
      include: { _count: { select: { prices: true } } },
    });
    return rows.map(summary);
  });

export const oneBook = (id: string) =>
  outsideTenant('ops: one price book', async () => {
    const b = await platformPrisma.priceBook.findUnique({
      where: { id },
      include: { prices: { select: PRICE_FIELDS } },
    });
    if (!b) return null;
    return { ...summary(b), prices: bookData(b).prices };
  });

/**
 * A new draft, copied from the published book (or another one named). One
 * draft at a time: a second asks for the one already open.
 */
export const createDraft = (userId: string, fromId?: string | null) =>
  outsideTenant('ops: a new draft price book', async () => {
    const open = await platformPrisma.priceBook.findFirst({
      where: { status: 'DRAFT' },
      select: { id: true, version: true },
    });
    if (open) throw Object.assign(new PricingError(`Version ${open.version} is already a draft. Edit or publish that one.`, 'DRAFT_OPEN', 409), { draftId: open.id });
    const from = fromId
      ? await platformPrisma.priceBook.findUnique({
          where: { id: fromId },
          include: { prices: { select: PRICE_FIELDS } },
        })
      : await platformPrisma.priceBook.findFirst({
          where: { status: 'PUBLISHED' },
          include: { prices: { select: PRICE_FIELDS } },
        });
    if (fromId && !from) throw new PricingError('No such price book.', 'NOT_FOUND', 404);
    const last = await platformPrisma.priceBook.aggregate({
      _max: { version: true },
    });
    try {
      const b = await platformPrisma.priceBook.create({
        data: {
          version: (last._max.version || 0) + 1,
          status: 'DRAFT',
          currency: from?.currency || 'INR',
          note: from?.note ?? null,
          copiedFromId: from?.id ?? null,
          createdByUserId: userId,
          prices: { create: (from?.prices || []).map((p) => ({ ...p })) },
        },
        include: { prices: { select: PRICE_FIELDS } },
      });
      return { ...summary(b), prices: bookData(b).prices };
    } catch (e: any) {
      /* Two operators at once: the version number is unique, and the second is told to look again. */
      if (String(e?.code) === 'P2002') throw new PricingError('Somebody made a draft at the same moment. Open Pricing again.', 'DRAFT_OPEN', 409);
      throw e;
    }
  });

/** Edit a draft: its note, and its prices as a whole set. Only a draft. */
export const updateDraft = (id: string, change: { note?: string | null; prices?: PlanPriceRow[] }) =>
  outsideTenant('ops: edit a draft price book', async () => {
    if (change.prices) {
      const problems = priceProblems(change.prices);
      if (problems.length)
        throw Object.assign(new PricingError(problems[0], 'INVALID_PRICES'), {
          problems,
        });
    }
    return platformPrisma.$transaction(async (tx) => {
      /* Taken as a row lock, so a publish cannot slip between the check and the write. */
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "PriceBook" WHERE "id" = ${id} FOR UPDATE`;
      if (!locked.length) throw new PricingError('No such price book.', 'NOT_FOUND', 404);
      if (locked[0].status !== 'DRAFT') throw new PricingError('Only a draft can be changed. Make a new draft from this one.', 'NOT_DRAFT', 409);
      const before = await tx.priceBook.findUniqueOrThrow({
        where: { id },
        include: { prices: { select: PRICE_FIELDS } },
      });
      if (change.prices) {
        await tx.planPrice.deleteMany({ where: { priceBookId: id } });
        if (change.prices.length)
          await tx.planPrice.createMany({
            data: change.prices.map((p) => ({ ...p, priceBookId: id })),
          });
      }
      const b = await tx.priceBook.update({
        where: { id },
        data: change.note === undefined ? { updatedAt: new Date() } : { note: change.note },
        include: { prices: { select: PRICE_FIELDS } },
      });
      return {
        before: bookData(before),
        after: { ...summary(b), prices: bookData(b).prices },
      };
    });
  });

/**
 * Publish a draft. In one transaction: the published book is archived and
 * this one published, so there is never a moment with none or with two (the
 * partial unique index PriceBook_one_published would refuse two).
 */
export const publishDraft = (id: string, userId: string) =>
  outsideTenant('ops: publish a price book', async () => {
    const result = await platformPrisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "PriceBook" WHERE "id" = ${id} FOR UPDATE`;
      if (!locked.length) throw new PricingError('No such price book.', 'NOT_FOUND', 404);
      if (locked[0].status !== 'DRAFT') throw new PricingError('Only a draft can be published.', 'NOT_DRAFT', 409);
      const draft = await tx.priceBook.findUniqueOrThrow({
        where: { id },
        include: { prices: { select: PRICE_FIELDS } },
      });
      const problems = priceProblems(bookData(draft).prices);
      if (!draft.prices.length) problems.unshift('A price book needs at least one price.');
      if (problems.length)
        throw Object.assign(new PricingError(problems[0], 'INVALID_PRICES'), {
          problems,
        });
      const now = new Date();
      const previous = await tx.priceBook.findFirst({
        where: { status: 'PUBLISHED' },
        select: { id: true, version: true },
      });
      if (previous)
        await tx.priceBook.update({
          where: { id: previous.id },
          data: { status: 'ARCHIVED', archivedAt: now },
        });
      const b = await tx.priceBook.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          publishedAt: now,
          publishedByUserId: userId,
        },
        include: { prices: { select: PRICE_FIELDS } },
      });
      return { previous, book: { ...summary(b), prices: bookData(b).prices } };
    });
    clearPublishedCache();
    return result;
  });
