/**
 * The pricing engine (roadmap item 9): what a set of CLOR apps costs, from a
 * price book. Pure functions, no database: the book and CLOR's GST standing
 * are handed in, so a quote can be worked out, tested and explained to the
 * rupee without anything else running.
 *
 * Money is paise, integers, everywhere. Nothing here multiplies a float.
 *
 * How one price works: `unitAmount` paise per unit (a company, a user, an
 * employee) per period, and the price covers at least `includedUnits` — so
 * People at ₹30 an employee with 10 included is ₹300 a month for up to ten
 * employees and ₹30 for each one more.
 *
 * Yearly: a book carries its own yearly prices. Where a yearly price is less
 * than twelve months of the monthly one, the quote shows the saving.
 *
 * GST: none until CLOR is registered (services/pricing/settings.ts). Then 18%
 * on the lines that carry it: CGST 9% + SGST 9% to a buyer in CLOR's own
 * state, IGST 18% to anyone else, and, before the buyer's state is known,
 * 18% with the split left open.
 */

export const PRICE_PERIODS = ['MONTHLY', 'YEARLY'] as const;
export const PRICE_UNITS = ['COMPANY', 'USER', 'EMPLOYEE'] as const;
export const PRICE_BOOK_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type PricePeriod = (typeof PRICE_PERIODS)[number];
export type PriceUnit = (typeof PRICE_UNITS)[number];

/** The apps that carry a price, by the names clor.in uses, in its order. */
export const PRICED_APPS: { code: string; name: string }[] = [
  { code: 'accounting', name: 'Books' },
  { code: 'payroll', name: 'Payroll' },
  { code: 'people', name: 'People' },
  { code: 'attendance', name: 'Attendance' },
];
/** clor.in's product slugs, and the platform's own app codes, both accepted. */
const APP_ALIASES: Record<string, string> = {
  books: 'accounting',
  accounting: 'accounting',
  payroll: 'payroll',
  people: 'people',
  attendance: 'attendance',
};
export const appCodeOf = (raw: string) =>
  APP_ALIASES[
    String(raw || '')
      .trim()
      .toLowerCase()
  ] || null;
export const pricedAppName = (code: string) => PRICED_APPS.find((a) => a.code === code)?.name || code;

/** Tiers in the order they are shown. A tier not listed sorts after them, by its code. */
export const TIERS: { code: string; name: string }[] = [
  { code: 'starter', name: 'Starter' },
  { code: 'growth', name: 'Growth' },
];
export const tierName = (code: string) => TIERS.find((t) => t.code === code)?.name || code.charAt(0).toUpperCase() + code.slice(1);
const tierOrder = (code: string) => {
  const i = TIERS.findIndex((t) => t.code === code);
  return i < 0 ? TIERS.length : i;
};

export const GST_RATE_PERCENT = 18;
/** Karnataka: CLOR's registered office is in Bengaluru. */
export const CLOR_STATE_CODE = '29';

export type PlanPriceRow = {
  appCode: string;
  tier: string;
  period: PricePeriod;
  unit: PriceUnit;
  unitAmount: number;
  includedUnits: number;
  trialDays: number;
  gstApplies: boolean;
};
export type PriceBookData = {
  version: number;
  currency: string;
  note?: string | null;
  prices: PlanPriceRow[];
};
export type GstStanding = {
  /** False until CLOR has a GSTIN: no GST on any quote. */
  registered: boolean;
  /** CLOR's own state code, from its GSTIN. */
  sellerStateCode?: string | null;
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

/* ---------------------------------------------------------------- checks */

export const TIER_CODE = /^[a-z][a-z0-9-]{1,23}$/;
/** ₹1 crore a unit is far past any real price; it catches a slipped decimal. */
export const MAX_UNIT_AMOUNT = 1_000_000_000;

/** Every problem with a set of prices, as plain sentences. Empty means it may be saved. */
export function priceProblems(prices: PlanPriceRow[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of prices) {
    const where = `${pricedAppName(p.appCode)} ${tierName(String(p.tier))} ${String(p.period).toLowerCase()}`;
    if (!PRICED_APPS.some((a) => a.code === p.appCode)) out.push(`${p.appCode} is not an app CLOR sells.`);
    if (!TIER_CODE.test(String(p.tier))) out.push(`${where}: a tier is written in small letters, like starter.`);
    if (!PRICE_PERIODS.includes(p.period)) out.push(`${where}: the period is monthly or yearly.`);
    if (!PRICE_UNITS.includes(p.unit)) out.push(`${where}: the unit is a company, a user or an employee.`);
    if (!Number.isSafeInteger(p.unitAmount) || p.unitAmount < 0 || p.unitAmount > MAX_UNIT_AMOUNT) out.push(`${where}: the amount is whole paise, from 0 to ₹1 crore.`);
    if (!Number.isSafeInteger(p.includedUnits) || p.includedUnits < 1 || p.includedUnits > 100_000) out.push(`${where}: at least one unit is included.`);
    if (!Number.isSafeInteger(p.trialDays) || p.trialDays < 0 || p.trialDays > 90) out.push(`${where}: a trial is 0 to 90 days.`);
    if (typeof p.gstApplies !== 'boolean') out.push(`${where}: say whether GST applies.`);
    const key = `${p.appCode}|${p.tier}|${p.period}`;
    if (seen.has(key)) out.push(`${where} is in the book twice.`);
    seen.add(key);
  }
  /* A tier sold one way is sold both ways, on the same terms: the site's monthly/yearly switch shows every tier in both. */
  const pairs = new Map<string, PlanPriceRow[]>();
  for (const p of prices) pairs.set(`${p.appCode}|${p.tier}`, [...(pairs.get(`${p.appCode}|${p.tier}`) || []), p]);
  for (const rows of pairs.values()) {
    const [a] = rows;
    const name = `${pricedAppName(a.appCode)} ${tierName(String(a.tier))}`;
    if (rows.length !== 2) out.push(`${name} needs both a monthly and a yearly price.`);
    else if (rows[0].unit !== rows[1].unit || rows[0].includedUnits !== rows[1].includedUnits) out.push(`${name}: the monthly and yearly prices count the same unit and include the same number.`);
  }
  return out;
}

/** The book's prices in the order they are shown: app, then tier, monthly before yearly. */
export function sortPrices<T extends Pick<PlanPriceRow, 'appCode' | 'tier' | 'period'>>(prices: T[]): T[] {
  const app = (c: string) => {
    const i = PRICED_APPS.findIndex((a) => a.code === c);
    return i < 0 ? PRICED_APPS.length : i;
  };
  return [...prices].sort(
    (a, b) => app(a.appCode) - app(b.appCode) || tierOrder(a.tier) - tierOrder(b.tier) || a.tier.localeCompare(b.tier) || PRICE_PERIODS.indexOf(a.period) - PRICE_PERIODS.indexOf(b.period),
  );
}

/* ----------------------------------------------------------------- money */

/** Half up, on integers: `paise × percent / 100`, without a float. */
export function percentOf(paise: number, percent: number) {
  return Math.floor((paise * percent + 50) / 100);
}

/** ₹1,23,456.50 the Indian way; whole rupees drop the paise. */
export function rupees(paise: number) {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  const s = String(whole);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}₹${rest ? `${rest},` : ''}${last3}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
}

/* ----------------------------------------------------------------- quote */

export type QuoteInput = {
  /** App codes or clor.in slugs (books = accounting). */
  apps: string[];
  tier: string;
  period: PricePeriod | 'monthly' | 'yearly';
  /** People who sign in: counted by per-user prices. */
  users?: number;
  /** People on the payroll or in People: counted by per-employee prices. */
  employees?: number;
  /** Companies: counted by per-company prices. One unless said. */
  companies?: number;
  priceBook: PriceBookData;
  gst?: GstStanding;
  /** The buyer's state code (two digits), once known: decides CGST + SGST or IGST. */
  buyerStateCode?: string | null;
};

export type QuoteLine = {
  appCode: string;
  appName: string;
  tier: string;
  tierName: string;
  period: PricePeriod;
  unit: PriceUnit;
  /** How many the buyer has. */
  quantity: number;
  /** How many are billed: at least the included number. */
  billedUnits: number;
  includedUnits: number;
  unitAmount: number;
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
  tier: string;
  period: PricePeriod;
  lines: QuoteLine[];
  subtotal: number;
  /** Yearly: what the yearly prices save on paying monthly for twelve months. */
  yearlySaving: number;
  tax: QuoteTax;
  total: number;
  /** The shortest trial among the apps quoted. */
  trialDays: number;
  /** "Mock prices — not final" and the like, from the book. */
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
  const tier = String(input.tier || '')
    .trim()
    .toLowerCase();
  const codes = [...new Set((input.apps || []).map((a) => appCodeOf(a)))];
  if (!codes.length) throw new PricingError('Choose at least one app.', 'NO_APPS');
  if (codes.includes(null)) throw new PricingError('One of those is not an app CLOR sells.', 'UNKNOWN_APP');
  const quantities: Record<PriceUnit, number> = {
    COMPANY: count(input.companies, 1),
    USER: count(input.users, 1),
    EMPLOYEE: count(input.employees, 0),
  };
  const book = input.priceBook;
  const find = (app: string, p: PricePeriod) => book.prices.find((r) => r.appCode === app && r.tier === tier && r.period === p);

  const lines: QuoteLine[] = sortPrices(codes.map((c) => ({ appCode: c as string, tier, period }))).map(({ appCode }) => {
    const row = find(appCode, period);
    if (!row) throw new PricingError(`${pricedAppName(appCode)} has no ${tierName(tier)} ${period.toLowerCase()} price.`, 'NO_PRICE');
    const quantity = quantities[row.unit];
    const billedUnits = Math.max(quantity, row.includedUnits);
    const amount = row.unitAmount * billedUnits;
    const monthly = period === 'YEARLY' ? find(appCode, 'MONTHLY') : undefined;
    const monthlyEquivalent = monthly ? monthly.unitAmount * Math.max(quantities[monthly.unit], monthly.includedUnits) * 12 : null;
    return {
      appCode,
      appName: pricedAppName(appCode),
      tier,
      tierName: tierName(tier),
      period,
      unit: row.unit,
      quantity,
      billedUnits,
      includedUnits: row.includedUnits,
      unitAmount: row.unitAmount,
      amount,
      monthlyEquivalent,
      saving: monthlyEquivalent == null ? 0 : Math.max(0, monthlyEquivalent - amount),
      trialDays: row.trialDays,
      gstApplies: row.gstApplies,
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const tax = gstOn(
    lines.filter((l) => l.gstApplies).reduce((s, l) => s + l.amount, 0),
    input.gst,
    input.buyerStateCode,
  );
  return {
    priceBookVersion: book.version,
    currency: book.currency || 'INR',
    tier,
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
  if (!gst?.registered)
    return {
      charged: false,
      kind: 'NONE',
      ratePercent: 0,
      taxable,
      ...none,
      amount: 0,
      note: NO_GST_NOTE,
    };
  const seller = gst.sellerStateCode || CLOR_STATE_CODE;
  const buyer = /^\d{2}$/.test(String(buyerStateCode || '')) ? String(buyerStateCode) : null;
  if (!buyer) {
    const amount = percentOf(taxable, GST_RATE_PERCENT);
    return {
      charged: true,
      kind: 'GST',
      ratePercent: GST_RATE_PERCENT,
      taxable,
      ...none,
      amount,
      note: `GST at ${GST_RATE_PERCENT}%: CGST and SGST in CLOR's own state, IGST anywhere else.`,
    };
  }
  if (buyer === seller) {
    const half = percentOf(taxable, GST_RATE_PERCENT / 2);
    return {
      charged: true,
      kind: 'CGST_SGST',
      ratePercent: GST_RATE_PERCENT,
      taxable,
      cgst: half,
      sgst: half,
      igst: 0,
      amount: half * 2,
      note: `CGST ${GST_RATE_PERCENT / 2}% and SGST ${GST_RATE_PERCENT / 2}%: you are in the same state as CLOR.`,
    };
  }
  const igst = percentOf(taxable, GST_RATE_PERCENT);
  return {
    charged: true,
    kind: 'IGST',
    ratePercent: GST_RATE_PERCENT,
    taxable,
    cgst: 0,
    sgst: 0,
    igst,
    amount: igst,
    note: `IGST ${GST_RATE_PERCENT}%: you are in another state from CLOR.`,
  };
}
