import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';
import { PricingError, planProblems, sortPlans, type PlanData, type PriceBookData, type PricePeriod, type PriceUnit } from './engine.js';

/**
 * Price books in the platform database: the published one for clor.in and
 * quotes, and the operator's cycle (routes/pricing.ts): make a draft (empty
 * or a copy), edit it, publish it; archive the published one; roll back to an
 * older version.
 *
 * A published or archived book is never edited. Publishing archives the book
 * it replaces in the same transaction; rolling back makes a new version, a
 * copy of the old one, and publishes that. So every version anybody was ever
 * quoted from is kept as it was.
 */

const PLAN_INCLUDE = { plans: { include: { prices: { select: { period: true, basePrice: true, extraUnitPrice: true } } } } } as const;

type DbPlan = {
  code: string;
  name: string;
  description: string | null;
  apps: string[];
  unit: string;
  includedUnits: number;
  trialDays: number;
  periods: string[];
  yearlyDiscountPct: number | null;
  displayOrder: number;
  showOnWebsite: boolean;
  highlight: boolean;
  gstApplies: boolean;
  prices: { period: string; basePrice: number; extraUnitPrice: number }[];
};
type DbBook = {
  id: string;
  version: number;
  status: string;
  currency: string;
  note: string | null;
  copiedFromId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  archivedAt: Date | null;
  plans: DbPlan[];
};

export const planData = (p: DbPlan): PlanData => ({
  code: p.code,
  name: p.name,
  description: p.description,
  apps: p.apps,
  unit: p.unit as PriceUnit,
  includedUnits: p.includedUnits,
  trialDays: p.trialDays,
  periods: p.periods as PricePeriod[],
  yearlyDiscountPct: p.yearlyDiscountPct,
  displayOrder: p.displayOrder,
  showOnWebsite: p.showOnWebsite,
  highlight: p.highlight,
  gstApplies: p.gstApplies,
  prices: [...p.prices].sort((a, b) => (a.period === b.period ? 0 : a.period === 'MONTHLY' ? -1 : 1)).map((x) => ({ period: x.period as PricePeriod, basePrice: x.basePrice, extraUnitPrice: x.extraUnitPrice })),
});

export const bookData = (b: DbBook): PriceBookData => ({ version: b.version, currency: b.currency, note: b.note, plans: sortPlans(b.plans.map(planData)) });

const full = (b: DbBook) => ({
  id: b.id,
  version: b.version,
  status: b.status,
  currency: b.currency,
  note: b.note,
  copiedFromId: b.copiedFromId,
  createdAt: b.createdAt,
  publishedAt: b.publishedAt,
  archivedAt: b.archivedAt,
  plans: bookData(b).plans,
});

/** The rows to create for a set of plans. */
const planRows = (plans: PlanData[]) =>
  plans.map((p) => ({
    code: p.code,
    name: p.name.trim(),
    description: p.description?.trim() || null,
    apps: p.apps,
    unit: p.unit,
    includedUnits: p.includedUnits,
    trialDays: p.trialDays,
    periods: p.periods,
    yearlyDiscountPct: p.yearlyDiscountPct,
    displayOrder: p.displayOrder,
    showOnWebsite: p.showOnWebsite,
    highlight: p.highlight,
    gstApplies: p.gstApplies,
    prices: { create: p.prices.map((x) => ({ period: x.period, basePrice: x.basePrice, extraUnitPrice: x.extraUnitPrice })) },
  }));

const invalid = (problems: string[]) => Object.assign(new PricingError(problems[0], 'INVALID_PLANS'), { problems });

/* ------------------------------------------------- the published book, cached */

/*
 * clor.in and every quote read the published book. It changes when somebody
 * publishes, which is rare, so each instance keeps it for a minute; a change
 * on this instance clears it at once, another instance's within the minute.
 */
const CACHE_MS = 60_000;
let cached: { at: number; book: (PriceBookData & { id: string; publishedAt: Date | null }) | null } | null = null;
export const clearPublishedCache = () => {
  cached = null;
};

export async function publishedBook() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.book;
  const b = await outsideTenant('pricing: the published price book', () => platformPrisma.priceBook.findFirst({ where: { status: 'PUBLISHED' }, include: PLAN_INCLUDE }));
  const book = b ? { ...bookData(b), id: b.id, publishedAt: b.publishedAt } : null;
  cached = { at: Date.now(), book };
  return book;
}

/* ---------------------------------------------------------------- operator */

export const listBooks = () =>
  outsideTenant('ops: price books', async () => {
    const rows = await platformPrisma.priceBook.findMany({ orderBy: { version: 'desc' }, include: { _count: { select: { plans: true } } } });
    return rows.map((b) => ({ id: b.id, version: b.version, status: b.status, note: b.note, copiedFromId: b.copiedFromId, createdAt: b.createdAt, publishedAt: b.publishedAt, archivedAt: b.archivedAt, planCount: b._count.plans }));
  });

export const oneBook = (id: string) =>
  outsideTenant('ops: one price book', async () => {
    const b = await platformPrisma.priceBook.findUnique({ where: { id }, include: PLAN_INCLUDE });
    return b ? full(b) : null;
  });

const nextVersion = async (tx: { priceBook: typeof platformPrisma.priceBook }) => ((await tx.priceBook.aggregate({ _max: { version: true } }))._max.version || 0) + 1;

/**
 * A new draft: empty, or a copy of the book named (the published one when
 * none is). One draft at a time: a second asks for the one already open.
 */
export const createDraft = (userId: string, opts: { fromId?: string | null; empty?: boolean }) =>
  outsideTenant('ops: a new draft price book', async () => {
    const open = await platformPrisma.priceBook.findFirst({ where: { status: 'DRAFT' }, select: { id: true, version: true } });
    if (open) throw Object.assign(new PricingError(`Version ${open.version} is already a draft. Edit, publish or discard that one first.`, 'DRAFT_OPEN', 409), { draftId: open.id });
    const from = opts.empty
      ? null
      : opts.fromId
        ? await platformPrisma.priceBook.findUnique({ where: { id: opts.fromId }, include: PLAN_INCLUDE })
        : await platformPrisma.priceBook.findFirst({ where: { status: 'PUBLISHED' }, include: PLAN_INCLUDE });
    if (opts.fromId && !from) throw new PricingError('No such price book.', 'NOT_FOUND', 404);
    try {
      const b = await platformPrisma.priceBook.create({
        data: {
          version: await nextVersion(platformPrisma),
          status: 'DRAFT',
          currency: from?.currency || 'INR',
          note: from?.note ?? null,
          copiedFromId: from?.id ?? null,
          createdByUserId: userId,
          plans: { create: planRows(from ? bookData(from).plans : []) },
        },
        include: PLAN_INCLUDE,
      });
      return full(b);
    } catch (e: any) {
      /* Two operators at once: the version number is unique, and the second is told to look again. */
      if (String(e?.code) === 'P2002') throw new PricingError('Somebody made a draft at the same moment. Open Pricing again.', 'DRAFT_OPEN', 409);
      throw e;
    }
  });

/** Lock a book's row for the rest of the transaction and say what it is. */
async function lock(tx: any, id: string) {
  const rows = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "PriceBook" WHERE "id" = ${id} FOR UPDATE`;
  if (!rows.length) throw new PricingError('No such price book.', 'NOT_FOUND', 404);
  return rows[0].status as string;
}

/** Edit a draft: its note, and its plans as a whole set. Only a draft. */
export const updateDraft = (id: string, change: { note?: string | null; plans?: PlanData[] }) =>
  outsideTenant('ops: edit a draft price book', async () => {
    if (change.plans) {
      const problems = planProblems(change.plans);
      if (problems.length) throw invalid(problems);
    }
    return platformPrisma.$transaction(async (tx) => {
      if ((await lock(tx, id)) !== 'DRAFT') throw new PricingError('Only a draft can be changed. Make a new draft from this one.', 'NOT_DRAFT', 409);
      const before = await tx.priceBook.findUniqueOrThrow({ where: { id }, include: PLAN_INCLUDE });
      if (change.plans) {
        await tx.pricePlan.deleteMany({ where: { priceBookId: id } });
        for (const data of planRows(change.plans)) await tx.pricePlan.create({ data: { ...data, priceBookId: id } });
      }
      const b = await tx.priceBook.update({ where: { id }, data: change.note === undefined ? { updatedAt: new Date() } : { note: change.note }, include: PLAN_INCLUDE });
      return { before: full(before), after: full(b) };
    });
  });

/**
 * Publish a draft. In one transaction the published book is archived and this
 * one published, so there are never two (the partial unique index
 * PriceBook_one_published would refuse it).
 */
export const publishDraft = (id: string, userId: string) =>
  outsideTenant('ops: publish a price book', async () => {
    const result = await platformPrisma.$transaction(async (tx) => {
      if ((await lock(tx, id)) !== 'DRAFT') throw new PricingError('Only a draft can be published.', 'NOT_DRAFT', 409);
      const draft = await tx.priceBook.findUniqueOrThrow({ where: { id }, include: PLAN_INCLUDE });
      const plans = bookData(draft).plans;
      const problems = plans.length ? planProblems(plans) : ['Add at least one plan before publishing.'];
      if (problems.length) throw invalid(problems);
      const now = new Date();
      const previous = await tx.priceBook.findFirst({ where: { status: 'PUBLISHED' }, select: { id: true, version: true } });
      if (previous) await tx.priceBook.update({ where: { id: previous.id }, data: { status: 'ARCHIVED', archivedAt: now } });
      const b = await tx.priceBook.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: now, publishedByUserId: userId }, include: PLAN_INCLUDE });
      return { previous, book: full(b) };
    });
    clearPublishedCache();
    return result;
  });

/**
 * Archive a book: the published one (clor.in then shows Request a demo
 * instead of prices), or a draft nobody wants (discarded, but kept).
 */
export const archiveBook = (id: string) =>
  outsideTenant('ops: archive a price book', async () => {
    const result = await platformPrisma.$transaction(async (tx) => {
      const status = await lock(tx, id);
      if (status === 'ARCHIVED') throw new PricingError('This version is archived already.', 'ARCHIVED', 409);
      const b = await tx.priceBook.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date() }, include: PLAN_INCLUDE });
      return { was: status, book: full(b) };
    });
    clearPublishedCache();
    return result;
  });

/**
 * Roll back to an older version: a new version, a copy of it, published at
 * once in place of the one live now. The old version itself stays archived as
 * it was. Refused while a draft is open, so the new version number cannot
 * jump a draft somebody is working on.
 */
export const rollBackTo = (id: string, userId: string) =>
  outsideTenant('ops: roll back a price book', async () => {
    const result = await platformPrisma.$transaction(async (tx) => {
      const status = await lock(tx, id);
      if (status !== 'ARCHIVED') throw new PricingError('Only an archived version can be brought back.', 'NOT_ARCHIVED', 409);
      const open = await tx.priceBook.findFirst({ where: { status: 'DRAFT' }, select: { id: true, version: true } });
      if (open) throw Object.assign(new PricingError(`Version ${open.version} is a draft. Publish or discard it first.`, 'DRAFT_OPEN', 409), { draftId: open.id });
      const from = await tx.priceBook.findUniqueOrThrow({ where: { id }, include: PLAN_INCLUDE });
      const plans = bookData(from).plans;
      const problems = plans.length ? planProblems(plans) : ['That version has no plans.'];
      if (problems.length) throw invalid(problems);
      const now = new Date();
      const previous = await tx.priceBook.findFirst({ where: { status: 'PUBLISHED' }, select: { id: true, version: true } });
      if (previous) await tx.priceBook.update({ where: { id: previous.id }, data: { status: 'ARCHIVED', archivedAt: now } });
      const b = await tx.priceBook.create({
        data: { version: await nextVersion(tx), status: 'PUBLISHED', currency: from.currency, note: from.note, copiedFromId: from.id, createdByUserId: userId, publishedAt: now, publishedByUserId: userId, plans: { create: planRows(plans) } },
        include: PLAN_INCLUDE,
      });
      return { previous, from: { id: from.id, version: from.version }, book: full(b) };
    });
    clearPublishedCache();
    return result;
  });
