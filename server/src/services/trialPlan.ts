import { APP_CATALOG, isSellableApp } from '../constants/appCatalog.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * What a self-serve trial gets (roadmap item 7): which apps may be started
 * from clor.in without talking to anybody, and for how many days.
 *
 * Both come from the published price book, which operators make in the
 * console (roadmap item 9, services/pricing/books.ts): a plan on the site
 * carries apps and a trialDays, and the trial for a set of apps is the
 * shortest trial among the plans that carry them, the same rule a quote
 * uses. A `?plan=` from a pricing card names one plan outright.
 *
 * Until a book is published (the pricing branch is being merged beside this
 * one) there is nothing to read, and the trial falls back to a plain default
 * so the page still works: every available app, DEFAULT_TRIAL_DAYS. The
 * answer says which it was (`source`), and the console shows it.
 */

export const DEFAULT_TRIAL_DAYS = 14;
/** The names clor.in uses; the catalogue's own otherwise. */
const SITE_NAMES: Record<string, string> = { accounting: 'Books' };
/** The site's product slugs and the platform's app codes, both accepted; stored as app codes. */
export const APP_OF: Record<string, string> = { books: 'accounting', accounting: 'accounting', payroll: 'payroll', people: 'people', attendance: 'attendance' };

export type PublishedPlan = { code: string; name: string; apps: string[]; trialDays: number; showOnWebsite: boolean };
export type TrialOffer = {
  /** Apps a visitor may start on their own, in the site's order. */
  apps: { code: string; name: string }[];
  /** Days, for the apps asked about (or the whole offer when none were). */
  trialDays: number;
  /** The plan the days came from, when one plan covers it. */
  planCode: string | null;
  source: 'published' | 'default';
};

const SITE_ORDER = ['accounting', 'people', 'attendance', 'payroll'];
const byOrder = (a: string, b: string) => SITE_ORDER.indexOf(a) - SITE_ORDER.indexOf(b);
const named = (codes: string[]) =>
  [...new Set(codes)]
    .filter(isSellableApp)
    .sort(byOrder)
    .map((code) => ({ code, name: SITE_NAMES[code] || APP_CATALOG.find((a) => a.code === code)?.name || code }));

/**
 * The published book's plans, if the price-book tables exist and one is
 * published; null otherwise. Read through the client's delegate by name so
 * this compiles before the pricing schema lands and works the day it does.
 */
export async function publishedPlans(): Promise<PublishedPlan[] | null> {
  const books = (platformPrisma as unknown as Record<string, any>).priceBook;
  if (!books || typeof books.findFirst !== 'function') return null;
  try {
    const book = await books.findFirst({ where: { status: 'PUBLISHED' }, include: { plans: true } });
    if (!book) return null;
    return (book.plans as any[]).map((p) => ({ code: String(p.code), name: String(p.name), apps: (p.apps as string[]) || [], trialDays: Number(p.trialDays) || 0, showOnWebsite: Boolean(p.showOnWebsite) }));
  } catch {
    /* The table is not there yet (a deploy between the two branches): the default below. */
    return null;
  }
}

/** The offer, worked out from the plans given: pure, so it can be tested without a database. */
export function offerFrom(plans: PublishedPlan[] | null, wanted: string[] = [], planCode?: string | null): TrialOffer {
  const asked = [...new Set(wanted.map((a) => APP_OF[String(a).toLowerCase()]).filter(Boolean))];
  if (!plans) {
    const all = APP_CATALOG.filter((a) => a.available).map((a) => a.code);
    return { apps: named(all), trialDays: DEFAULT_TRIAL_DAYS, planCode: null, source: 'default' };
  }
  /* Only plans on the site whose apps are all sold count as self-serve. */
  const onSite = plans.filter((p) => p.showOnWebsite && p.apps.length && p.apps.every(isSellableApp));
  const apps = named(onSite.flatMap((p) => p.apps));
  const chosen = planCode ? onSite.find((p) => p.code === String(planCode).toLowerCase()) : null;
  if (chosen && (!asked.length || asked.every((a) => chosen.apps.includes(a)))) return { apps, trialDays: chosen.trialDays, planCode: chosen.code, source: 'published' };
  /* The shortest trial among the plans that carry what was asked for, as a quote does. */
  const covering = asked.length ? onSite.filter((p) => p.apps.some((a) => asked.includes(a))) : onSite;
  const pool = covering.length ? covering : onSite;
  const trialDays = pool.length ? Math.min(...pool.map((p) => p.trialDays)) : DEFAULT_TRIAL_DAYS;
  return { apps, trialDays, planCode: pool.length === 1 ? pool[0].code : null, source: 'published' };
}

/** The offer for a visitor: what they may start and for how long. */
export async function trialOffer(wanted: string[] = [], planCode?: string | null): Promise<TrialOffer> {
  return offerFrom(await publishedPlans(), wanted, planCode);
}
