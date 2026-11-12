import { describe, expect, it } from 'vitest';
import { fromBookPlan, offerProblem, periodEnd, priceDeal, type DealOffer } from '../services/pricing/deals.js';
import { samplePlans } from '../services/pricing/seed.js';

/** Deals on the operator console, priced to the paisa with no database (services/pricing/deals.ts). */
const growth = fromBookPlan(samplePlans().find((p) => p.code === 'books-growth')!);
const offer = (o: Partial<DealOffer> = {}): DealOffer => ({
  id: 'o1',
  code: 'DIWALI25',
  name: 'Diwali',
  kind: 'PERCENT',
  value: 25,
  planCodes: [],
  periods: [],
  durationPeriods: 3,
  startsAt: new Date('2026-01-01'),
  endsAt: null,
  maxRedemptions: null,
  redemptions: 0,
  pausedAt: null,
  archivedAt: null,
  ...o,
});
const gst = { registered: true, sellerStateCode: '29', ratePercent: 18 };

describe('pricing a deal', () => {
  it('prices units beyond the included ones, takes the offer off, then GST', () => {
    const d = priceDeal({ plan: growth, period: 'MONTHLY', quantity: 5, offer: offer(), gst, buyerStateCode: '29' });
    expect(d.listAmount).toBe(300000); // ₹600 for the first user, ₹600 for each of 4 more
    expect(d.discount).toBe(75000);
    expect(d.periodAmount).toBe(225000);
    expect(d.tax).toMatchObject({ kind: 'CGST_SGST', cgst: 20250, sgst: 20250, amount: 40500 });
    expect(d.total).toBe(265500);
    expect(d.line).toEqual({ description: 'CLOR Books Growth, 5 users, monthly (DIWALI25: 25% off for 3 months)', quantity: 1, unitAmount: 225000, amount: 225000 });
  });

  it('yearly uses the yearly price; an amount off never goes below nothing; no GST until CLOR is registered', () => {
    const y = priceDeal({ plan: growth, period: 'YEARLY', quantity: 1, offer: offer({ kind: 'AMOUNT', value: 10_000_000, durationPeriods: null }) });
    expect(y.listAmount).toBe(600000);
    expect(y.periodAmount).toBe(0);
    expect(y.tax.charged).toBe(false);
    expect(y.offer?.words).toBe('₹1,00,000 off every year');
  });

  it('refuses an offer that does not fit, in plain words', () => {
    expect(offerProblem(offer({ periods: ['YEARLY'] }), growth, 'MONTHLY')).toBe('DIWALI25 is for yearly billing only.');
    expect(offerProblem(offer({ planCodes: ['books-starter'] }), growth, 'MONTHLY')).toBe('DIWALI25 is not for this plan.');
    expect(offerProblem(offer({ maxRedemptions: 2, redemptions: 2 }), growth, 'MONTHLY')).toMatch(/used by all 2/);
    expect(offerProblem(offer({ pausedAt: new Date() }), growth, 'MONTHLY')).toBe('DIWALI25 is paused.');
    expect(offerProblem(offer({ endsAt: new Date('2026-02-01') }), growth, 'MONTHLY', new Date('2026-03-01'))).toBe('DIWALI25 has ended.');
    expect(offerProblem(offer({ planCodes: ['books-growth'] }), { source: 'custom', ref: 'books-growth' }, 'MONTHLY')).toMatch(/not for this plan/);
    expect(() => priceDeal({ plan: { ...growth, yearly: null }, period: 'YEARLY', quantity: 1 })).toThrow('Books Growth is not offered yearly.');
  });

  it('a period ends a month or a year on, on the last day of a short month', () => {
    expect(periodEnd(new Date('2027-01-31T00:00:00Z'), 'MONTHLY').toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(periodEnd(new Date('2026-11-11T00:00:00Z'), 'MONTHLY', 3).toISOString().slice(0, 10)).toBe('2027-02-11');
    expect(periodEnd(new Date('2028-02-29T00:00:00Z'), 'YEARLY').toISOString().slice(0, 10)).toBe('2029-02-28');
  });
});
