import { APP_CATALOG } from '../../constants/appCatalog.js';

/**
 * The pricing engine (roadmap item 9): what a set of CLOR plans costs, from a
 * price book an operator made in the operator console. Pure functions, no
 * database, and no prices of its own: the book and CLOR's GST standing are
 * handed in, so a quote can be worked out, previewed in the editor and tested
 * to the rupee without anything else running.
 *
 * Money is paise, integers, everywhere. Nothing here multiplies a float.
 *
 * A plan carries one or more apps and is counted by one unit (a company, a
 * user or an employee). For each period it is offered for, its base price
 * covers `includedUnits`, and each unit beyond adds `extraUnitPrice`.
 *
 * Yearly: either the plan's own yearly price, or — when the plan has a yearly
 * discount — twelve months of the monthly price less that percent. Either way
 * the quote shows what yearly saves on twelve monthly payments.
 *
 * GST: none until CLOR is registered (services/pricing/settings.ts). Then the
 * configured rate (18%) on the plans that carry it: CGST + SGST, half each, to
 * a buyer in CLOR's own state, IGST to anyone else and, before the buyer's
 * state is known, the full rate with the split left open.
 */

export const PRICE_PERIODS = ['MONTHLY', 'YEARLY'] as const;
export const PRICE_UNITS = ['COMPANY', 'USER', 'EMPLOYEE'] as const;
export const PRICE_BOOK_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type PricePeriod = (typeof PRICE_PERIODS)[number];
export type PriceUnit = (typeof PRICE_UNITS)[number];

/** The names clor.in uses; the catalogue's own otherwise. */
const SITE_NAMES: Record<string, string> = { accounting: 'Books' };
/** Every app a plan may carry: the platform's catalogue, available or coming. */
export const PRICEABLE_APPS = APP_CATALOG.map((a) => ({ code: a.code, name: SITE_NAMES[a.code] || a.name, available: a.available }));
export const appName = (code: string) => PRICEABLE_APPS.find((a) => a.code === code)?.name || code;
export const appAvailable = (code: string) => Boolean(PRICEABLE_APPS.find((a) => a.code === code)?.available);

export const DEFAULT_GST_RATE = 18;

export type PeriodPrice = { period: PricePeriod; basePrice: number; extraUnitPrice: number };
export type PlanData = {
  code: string;
  name: string;
  description?: string | null;
  apps: string[];
  unit: PriceUnit;
  includedUnits: number;
  trialDays: number;
  periods: PricePeriod[];
  yearlyDiscountPct: number | null;
  displayOrder: number;
  showOnWebsite: boolean;
  highlight: boolean;
  gstApplies: boolean;
  prices: PeriodPrice[];
};
export type PriceBookData = { version: number; currency: string; note?: string | null; plans: PlanData[] };
export type GstStanding = {
  /** False until CLOR is registered: no GST on any quote. */
  registered: boolean;
  /** CLOR's own state code, from its GSTIN. */
  sellerStateCode?: string | null;
  ratePercent?: number;
};

export class PricingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/* ----------------------------------------------------------------- money */

/** Half up, on integers: `paise × percent / 100`. */
export function percentOf(paise: number, percent: number) {
  return Math.floor((paise * percent + 50) / 100);
}

/** ₹1,23,456.50 the Indian way; whole rupees drop the paise. */
export function rupees(paise: number) {
  const abs = Math.abs(paise);
  const s = String(Math.floor(abs / 100));
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const fraction = abs % 100;
  return `${paise < 0 ? '−' : ''}₹${rest ? `${rest},` : ''}${last3}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
}

/* ---------------------------------------------------------------- prices */

/** A plan's price for a period, worked out: its own row, or yearly from monthly less the discount. Null when not offered. */
export function priceFor(plan: PlanData, period: PricePeriod): PeriodPrice | null {
  if (!plan.periods.includes(period)) return null;
  if (period === 'YEARLY' && plan.yearlyDiscountPct != null) {
    const m = plan.prices.find((p) => p.period === 'MONTHLY');
    if (!m) return null;
    const keep = 100 - plan.yearlyDiscountPct;
    return { period, basePrice: percentOf(m.basePrice * 12, keep), extraUnitPrice: percentOf(m.extraUnitPrice * 12, keep) };
  }
  return plan.prices.find((p) => p.period === period) || null;
}

/** What a plan costs for a number of units in a period. */
export const amountFor = (price: PeriodPrice, includedUnits: number, quantity: number) => price.basePrice + price.extraUnitPrice * Math.max(0, quantity - includedUnits);

/** Plans in the order they are shown: display order, then name. */
export const sortPlans = <T extends Pick<PlanData, 'displayOrder' | 'name'>>(plans: T[]) => [...plans].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));

/** A plan clor.in shows: switched on for the site, and every app in it available. */
export const onWebsite = (p: Pick<PlanData, 'showOnWebsite' | 'apps'>) => p.showOnWebsite && p.apps.length > 0 && p.apps.every(appAvailable);

/* ---------------------------------------------------------------- checks */

export const PLAN_CODE = /^[a-z][a-z0-9-]{1,31}$/;
/** ₹1 crore for a period is far past any real price; it catches a slipped decimal. */
export const MAX_AMOUNT = 1_000_000_000;
const whole = (v: unknown, min: number, max: number) => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;

/** Every problem with a set of plans, as plain sentences. Empty means it may be saved or published. */
export function planProblems(plans: PlanData[]): string[] {
  const out: string[] = [];
  const codes = new Set<string>();
  for (const p of plans) {
    const n = String(p.name || p.code || 'A plan').trim();
    if (!PLAN_CODE.test(String(p.code))) out.push(`${n}: the code is small letters, numbers and dashes, like books-starter.`);
    else if (codes.has(p.code)) out.push(`Two plans have the code ${p.code}.`);
    codes.add(p.code);
    if (!String(p.name || '').trim() || String(p.name).length > 60) out.push(`${n}: give it a name of up to 60 characters.`);
    if (p.description && String(p.description).length > 300) out.push(`${n}: keep the description under 300 characters.`);
    if (!Array.isArray(p.apps) || !p.apps.length) out.push(`${n}: choose at least one app.`);
    else {
      for (const a of p.apps) if (!PRICEABLE_APPS.some((x) => x.code === a)) out.push(`${n}: ${a} is not a CLOR app.`);
      if (new Set(p.apps).size !== p.apps.length) out.push(`${n}: an app is chosen twice.`);
    }
    if (!PRICE_UNITS.includes(p.unit)) out.push(`${n}: count it per company, per user or per employee.`);
    if (!whole(p.includedUnits, 1, 100_000)) out.push(`${n}: the price includes at least one.`);
    if (!whole(p.trialDays, 0, 90)) out.push(`${n}: a trial is 0 to 90 days.`);
    if (p.yearlyDiscountPct != null && !whole(p.yearlyDiscountPct, 0, 90)) out.push(`${n}: the yearly discount is 0 to 90 percent.`);
    if (!whole(p.displayOrder, 0, 10_000)) out.push(`${n}: the display order is a whole number.`);
    for (const f of ['showOnWebsite', 'highlight', 'gstApplies'] as const) if (typeof p[f] !== 'boolean') out.push(`${n}: ${f} is yes or no.`);
    const periods = Array.isArray(p.periods) ? p.periods : [];
    if (!periods.length || periods.some((x) => !PRICE_PERIODS.includes(x)) || new Set(periods).size !== periods.length) out.push(`${n}: offer it monthly, yearly or both.`);
    const prices = Array.isArray(p.prices) ? p.prices : [];
    for (const pr of prices) {
      if (!PRICE_PERIODS.includes(pr.period)) out.push(`${n}: a price is monthly or yearly.`);
      else if (!whole(pr.basePrice, 0, MAX_AMOUNT) || !whole(pr.extraUnitPrice, 0, MAX_AMOUNT)) out.push(`${n} ${pr.period.toLowerCase()}: prices are whole paise, from 0 to ₹1 crore.`);
    }
    if (new Set(prices.map((x) => x.period)).size !== prices.length) out.push(`${n}: a period has two prices.`);
    for (const per of periods) {
      if (!PRICE_PERIODS.includes(per)) continue;
      const derived = per === 'YEARLY' && p.yearlyDiscountPct != null;
      if (derived && !prices.some((x) => x.period === 'MONTHLY')) out.push(`${n}: a yearly discount needs a monthly price to work from.`);
      if (!derived && !prices.some((x) => x.period === per)) out.push(`${n}: give it a ${per.toLowerCase()} price.`);
    }
  }
  return out;
}

/* ----------------------------------------------------------------- quote */

export type QuoteInput = {
  /** Plan codes. Two plans may not carry the same app. */
  plans: string[];
  period: PricePeriod | 'monthly' | 'yearly';
  /** People who sign in: counted by per-user plans. */
  users?: number;
  /** People on the payroll or in People: counted by per-employee plans. */
  employees?: number;
  /** Companies: counted by per-company plans. One unless said. */
  companies?: number;
  priceBook: PriceBookData;
  gst?: GstStanding;
  /** The buyer's state code (two digits), once known: decides CGST + SGST or IGST. */
  buyerStateCode?: string | null;
  /** clor.in quotes only the plans it shows. */
  websiteOnly?: boolean;
};

export type QuoteLine = {
  planCode: string;
  planName: string;
  apps: string[];
  period: PricePeriod;
  unit: PriceUnit;
  /** How many the buyer has. */
  quantity: number;
  includedUnits: number;
  extraUnits: number;
  basePrice: number;
  extraUnitPrice: number;
  amount: number;
  /** Yearly only: twelve months at the monthly price, and what the yearly price saves on it. */
  monthlyEquivalent: number | null;
  saving: number;
  trialDays: number;
  gstApplies: boolean;
};

export type QuoteTax = {
  charged: boolean;
  /** NONE until registered; CGST_SGST or IGST by the buyer's state; GST while the state is not known. */
  kind: 'NONE' | 'CGST_SGST' | 'IGST' | 'GST';
  ratePercent: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  amount: number;
  note: string;
};

export type Quote = {
  priceBookVersion: number;
  currency: string;
  period: PricePeriod;
  lines: QuoteLine[];
  subtotal: number;
  /** Yearly: what the yearly prices save on paying monthly for twelve months. */
  yearlySaving: number;
  tax: QuoteTax;
  total: number;
  /** The shortest trial among the plans quoted. */
  trialDays: number;
  note: string | null;
};

const count = (n: unknown, fallback: number) => {
  const v = n == null ? fallback : Number(n);
  if (!Number.isSafeInteger(v) || v < 0 || v > 1_000_000) throw new PricingError('Counts are whole numbers from 0 to 10 lakh.', 'BAD_COUNT');
  return v;
};

export const NO_GST_NOTE = 'No GST is charged: CLOR is not registered for GST yet. The price shown is what you pay.';

export function quote(input: QuoteInput): Quote {
  const period = String(input.period || '').toUpperCase() as PricePeriod;
  if (!PRICE_PERIODS.includes(period)) throw new PricingError('Choose monthly or yearly.', 'BAD_PERIOD');
  const codes = [...new Set((input.plans || []).map((c) => String(c).trim().toLowerCase()))];
  if (!codes.length) throw new PricingError('Choose at least one plan.', 'NO_PLANS');
  const quantities: Record<PriceUnit, number> = {
    COMPANY: count(input.companies, 1),
    USER: count(input.users, 1),
    EMPLOYEE: count(input.employees, 0),
  };
  const book = input.priceBook;
  const chosen = codes.map((c) => {
    const plan = book.plans.find((p) => p.code === c && (!input.websiteOnly || onWebsite(p)));
    if (!plan) throw new PricingError('One of those plans is not on the price list.', 'UNKNOWN_PLAN');
    return plan;
  });
  const apps = chosen.flatMap((p) => p.apps);
  const twice = apps.find((a, i) => apps.indexOf(a) !== i);
  if (twice) throw new PricingError(`Two of those plans both carry ${appName(twice)}. Choose one.`, 'APP_TWICE');

  const lines: QuoteLine[] = sortPlans(chosen).map((plan) => {
    const price = priceFor(plan, period);
    if (!price) throw new PricingError(`${plan.name} is not offered ${period === 'MONTHLY' ? 'monthly' : 'yearly'}.`, 'NO_PRICE');
    const quantity = quantities[plan.unit];
    const amount = amountFor(price, plan.includedUnits, quantity);
    const monthly = period === 'YEARLY' ? priceFor(plan, 'MONTHLY') : null;
    const monthlyEquivalent = monthly ? amountFor(monthly, plan.includedUnits, quantity) * 12 : null;
    return {
      planCode: plan.code,
      planName: plan.name,
      apps: plan.apps,
      period,
      unit: plan.unit,
      quantity,
      includedUnits: plan.includedUnits,
      extraUnits: Math.max(0, quantity - plan.includedUnits),
      basePrice: price.basePrice,
      extraUnitPrice: price.extraUnitPrice,
      amount,
      monthlyEquivalent,
      saving: monthlyEquivalent == null ? 0 : Math.max(0, monthlyEquivalent - amount),
      trialDays: plan.trialDays,
      gstApplies: plan.gstApplies,
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = gstOn(lines.filter((l) => l.gstApplies).reduce((s, l) => s + l.amount, 0), input.gst, input.buyerStateCode);
  return {
    priceBookVersion: book.version,
    currency: book.currency || 'INR',
    period,
    lines,
    subtotal,
    yearlySaving: lines.reduce((s, l) => s + l.saving, 0),
    tax,
    total: subtotal + tax.amount,
    trialDays: Math.min(...lines.map((l) => l.trialDays)),
    note: book.note ?? null,
  };
}

/** GST on an amount, by CLOR's standing and the buyer's state. */
export function gstOn(taxable: number, gst: GstStanding | undefined, buyerStateCode?: string | null): QuoteTax {
  const none = { cgst: 0, sgst: 0, igst: 0 };
  if (!gst?.registered) return { charged: false, kind: 'NONE', ratePercent: 0, taxable, ...none, amount: 0, note: NO_GST_NOTE };
  const rate = gst.ratePercent ?? DEFAULT_GST_RATE;
  const seller = gst.sellerStateCode || '';
  const buyer = /^\d{2}$/.test(String(buyerStateCode || '')) ? String(buyerStateCode) : null;
  if (!buyer) {
    const amount = percentOf(taxable, rate);
    return { charged: true, kind: 'GST', ratePercent: rate, taxable, ...none, amount, note: `GST at ${rate}%: CGST and SGST in CLOR's own state, IGST anywhere else.` };
  }
  if (buyer === seller) {
    const half = percentOf(taxable, rate / 2);
    return { charged: true, kind: 'CGST_SGST', ratePercent: rate, taxable, cgst: half, sgst: half, igst: 0, amount: half * 2, note: `CGST ${rate / 2}% and SGST ${rate / 2}%: you are in the same state as CLOR.` };
  }
  const igst = percentOf(taxable, rate);
  return { charged: true, kind: 'IGST', ratePercent: rate, taxable, cgst: 0, sgst: 0, igst, amount: igst, note: `IGST ${rate}%: you are in another state from CLOR.` };
}
