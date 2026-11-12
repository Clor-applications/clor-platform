import { amountFor, gstOn, percentOf, priceFor, rupees, type GstStanding, type PlanData, type PricePeriod, type PriceUnit, type QuoteTax } from './engine.js';

/**
 * Deals CLOR staff make on the operator console (routes/opsDeals.ts): a plan
 * from the published price book or a custom plan, a number of units, a period
 * and maybe an offer, priced to the paisa. Pure, like engine.ts: the plan,
 * the offer and CLOR's GST standing are handed in.
 */

export type DealPlan = {
  source: 'book' | 'custom';
  /** Book plan code, or custom plan id. */
  ref: string;
  name: string;
  apps: string[];
  unit: PriceUnit;
  includedUnits: number;
  gstApplies: boolean;
  /** Null when the plan is not offered for that period. */
  monthly: { basePrice: number; extraUnitPrice: number } | null;
  yearly: { basePrice: number; extraUnitPrice: number } | null;
};

export type DealOffer = {
  id: string;
  code: string;
  name: string;
  kind: 'PERCENT' | 'AMOUNT';
  value: number;
  planCodes: string[];
  periods: string[];
  durationPeriods: number | null;
  startsAt: Date;
  endsAt: Date | null;
  maxRedemptions: number | null;
  redemptions: number;
  pausedAt: Date | null;
  archivedAt: Date | null;
};

export type Deal = {
  plan: { source: string; ref: string; name: string; apps: string[]; unit: PriceUnit; includedUnits: number };
  period: PricePeriod;
  quantity: number;
  /** Paise for the period at list price. */
  listAmount: number;
  discount: number;
  /** What one period costs before GST. */
  periodAmount: number;
  tax: QuoteTax;
  total: number;
  offer: { id: string; code: string; name: string; words: string; periodsLeft: number | null } | null;
  /** One invoice line for a period. */
  line: { description: string; quantity: number; unitAmount: number; amount: number };
};

export class DealError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const UNIT_WORDS: Record<string, [string, string]> = { COMPANY: ['company', 'companies'], USER: ['user', 'users'], EMPLOYEE: ['employee', 'employees'] };
export const unitWord = (unit: string, n: number) => `${n} ${(UNIT_WORDS[unit] || ['unit', 'units'])[n === 1 ? 0 : 1]}`;

/** A price book plan as a deal plan, yearly worked out as the book says. */
export function fromBookPlan(p: PlanData): DealPlan {
  const m = priceFor(p, 'MONTHLY');
  const y = priceFor(p, 'YEARLY');
  return {
    source: 'book',
    ref: p.code,
    name: p.name,
    apps: p.apps,
    unit: p.unit,
    includedUnits: p.includedUnits,
    gstApplies: p.gstApplies,
    monthly: m ? { basePrice: m.basePrice, extraUnitPrice: m.extraUnitPrice } : null,
    yearly: y ? { basePrice: y.basePrice, extraUnitPrice: y.extraUnitPrice } : null,
  };
}

/** Why an offer cannot be used on this plan and period now, or null when it can. */
export function offerProblem(o: DealOffer, plan: Pick<DealPlan, 'source' | 'ref'>, period: PricePeriod, now = new Date()): string | null {
  if (o.archivedAt) return `${o.code} is archived.`;
  if (o.pausedAt) return `${o.code} is paused.`;
  if (o.startsAt > now) return `${o.code} starts on ${o.startsAt.toISOString().slice(0, 10)}.`;
  if (o.endsAt && o.endsAt <= now) return `${o.code} has ended.`;
  if (o.maxRedemptions != null && o.redemptions >= o.maxRedemptions) return `${o.code} has been used by all ${o.maxRedemptions} customers it allows.`;
  if (o.periods.length && !o.periods.includes(period)) return `${o.code} is for ${o.periods.map((p) => p.toLowerCase()).join(' and ')} billing only.`;
  if (o.planCodes.length && (plan.source !== 'book' || !o.planCodes.includes(plan.ref))) return `${o.code} is not for this plan.`;
  return null;
}

/** "25% off for 3 months", "₹500 off each year". */
export function offerWords(o: { kind: string; value: number; durationPeriods: number | null }, period?: PricePeriod) {
  const off = o.kind === 'PERCENT' ? `${o.value}% off` : `${rupees(o.value)} off`;
  const each = period === 'YEARLY' ? 'year' : period === 'MONTHLY' ? 'month' : 'period';
  if (o.durationPeriods == null) return `${off}${period ? ` every ${each}` : ''}`;
  return `${off} for ${o.durationPeriods} ${period ? (o.durationPeriods === 1 ? each : `${each}s`) : o.durationPeriods === 1 ? 'billing period' : 'billing periods'}`;
}

export function priceDeal(input: { plan: DealPlan; period: PricePeriod; quantity: number; offer?: DealOffer | null; gst?: GstStanding; buyerStateCode?: string | null; now?: Date }): Deal {
  const { plan, period } = input;
  const q = Number(input.quantity);
  if (!Number.isSafeInteger(q) || q < 1 || q > 100000) throw new DealError('The number of units is a whole number from 1.');
  const price = period === 'YEARLY' ? plan.yearly : plan.monthly;
  if (!price) throw new DealError(`${plan.name} is not offered ${period === 'YEARLY' ? 'yearly' : 'monthly'}.`);
  const listAmount = amountFor({ period, ...price }, plan.includedUnits, q);
  let discount = 0;
  let offer: Deal['offer'] = null;
  if (input.offer) {
    const problem = offerProblem(input.offer, plan, period, input.now);
    if (problem) throw new DealError(problem, 409);
    const o = input.offer;
    discount = Math.min(listAmount, o.kind === 'PERCENT' ? percentOf(listAmount, o.value) : o.value);
    offer = { id: o.id, code: o.code, name: o.name, words: offerWords(o, period), periodsLeft: o.durationPeriods };
  }
  const periodAmount = listAmount - discount;
  const tax = plan.gstApplies ? gstOn(periodAmount, input.gst, input.buyerStateCode) : gstOn(periodAmount, { registered: false });
  const per = period === 'YEARLY' ? 'yearly' : 'monthly';
  const description = `CLOR ${plan.name}, ${unitWord(plan.unit, q)}, ${per}${offer ? ` (${offer.code}: ${offer.words})` : ''}`;
  return {
    plan: { source: plan.source, ref: plan.ref, name: plan.name, apps: plan.apps, unit: plan.unit, includedUnits: plan.includedUnits },
    period,
    quantity: q,
    listAmount,
    discount,
    periodAmount,
    tax,
    total: periodAmount + tax.amount,
    offer,
    line: { description: description.slice(0, 200), quantity: 1, unitAmount: periodAmount, amount: periodAmount },
  };
}

/** The day one period after `from`: a month or a year on, the last day of a short month when the date does not exist. */
export function periodEnd(from: Date, period: PricePeriod, periods = 1) {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  if (period === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + periods);
  else d.setUTCMonth(d.getUTCMonth() + periods);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
