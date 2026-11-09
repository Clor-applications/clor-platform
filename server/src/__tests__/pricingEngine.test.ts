import { describe, expect, it } from 'vitest';

import { PricingError, gstOn, percentOf, priceProblems, quote, rupees, type PlanPriceRow, type PriceBookData } from '../services/pricing/engine.js';
import { MOCK_NOTE, mockPrices } from '../services/pricing/seed.js';
import { readGstSetting } from '../services/pricing/settings.js';

/**
 * The pricing engine (services/pricing/engine.ts): pure arithmetic over a
 * price book, checked to the rupee against the mock book version 1.
 *
 * Mock v1, before GST, a unit a month (yearly is ten months):
 *   Books       per user,     1 included:  starter ₹300, growth ₹600
 *   Payroll     per employee, 10 included: starter ₹50,  growth ₹100
 *   People      per employee, 10 included: starter ₹30,  growth ₹60
 *   Attendance  per employee, 10 included: starter ₹40,  growth ₹80
 */
const book: PriceBookData = { version: 1, currency: 'INR', note: MOCK_NOTE, prices: mockPrices() };
const RS = 100;
const registered = { registered: true, sellerStateCode: '29' };

describe('a quote', () => {
  it('Books Starter monthly for three users is ₹900, with no GST while CLOR is not registered', () => {
    const q = quote({ apps: ['books'], tier: 'starter', period: 'monthly', users: 3, priceBook: book });
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]).toMatchObject({ appCode: 'accounting', appName: 'Books', unit: 'USER', quantity: 3, billedUnits: 3, unitAmount: 300 * RS, amount: 900 * RS });
    expect(q.subtotal).toBe(900 * RS);
    expect(q.tax).toMatchObject({ charged: false, kind: 'NONE', ratePercent: 0, amount: 0 });
    expect(q.tax.note).toMatch(/not registered for GST/);
    expect(q.total).toBe(900 * RS);
    expect(q.trialDays).toBe(30);
    expect(q.note).toBe('Mock prices — not final');
  });

  it('bills at least the included employees: Payroll Starter is ₹500 for six, ₹700 for fourteen', () => {
    const six = quote({ apps: ['payroll'], tier: 'starter', period: 'MONTHLY', employees: 6, priceBook: book });
    expect(six.lines[0]).toMatchObject({ quantity: 6, billedUnits: 10, amount: 500 * RS });
    const fourteen = quote({ apps: ['payroll'], tier: 'starter', period: 'MONTHLY', employees: 14, priceBook: book });
    expect(fourteen.lines[0]).toMatchObject({ quantity: 14, billedUnits: 14, amount: 700 * RS });
  });

  it('four apps on Growth, yearly, for 2 users and 25 employees: ₹72,000, saving ₹14,400 on monthly', () => {
    const q = quote({ apps: ['attendance', 'people', 'payroll', 'accounting'], tier: 'growth', period: 'yearly', users: 2, employees: 25, priceBook: book });
    /* In the site's order, whatever order they were asked in. */
    expect(q.lines.map((l) => [l.appName, l.amount, l.monthlyEquivalent, l.saving])).toEqual([
      ['Books', 12_000 * RS, 14_400 * RS, 2_400 * RS],
      ['Payroll', 25_000 * RS, 30_000 * RS, 5_000 * RS],
      ['People', 15_000 * RS, 18_000 * RS, 3_000 * RS],
      ['Attendance', 20_000 * RS, 24_000 * RS, 4_000 * RS],
    ]);
    expect(q.subtotal).toBe(72_000 * RS);
    expect(q.yearlySaving).toBe(14_400 * RS);
    expect(q.total).toBe(72_000 * RS);
    expect(rupees(q.total)).toBe('₹72,000');
  });

  it('monthly shows no saving', () => {
    const q = quote({ apps: ['people'], tier: 'starter', period: 'monthly', employees: 12, priceBook: book });
    expect(q.lines[0]).toMatchObject({ amount: 360 * RS, monthlyEquivalent: null, saving: 0 });
    expect(q.yearlySaving).toBe(0);
  });

  it('counts a company once unless told otherwise', () => {
    const perCompany: PriceBookData = {
      version: 9,
      currency: 'INR',
      prices: (['MONTHLY', 'YEARLY'] as const).map((period) => ({ appCode: 'accounting', tier: 'starter', period, unit: 'COMPANY' as const, unitAmount: (period === 'MONTHLY' ? 499 : 4990) * RS, includedUnits: 1, trialDays: 14, gstApplies: true })),
    };
    expect(quote({ apps: ['accounting'], tier: 'starter', period: 'monthly', users: 40, priceBook: perCompany }).total).toBe(499 * RS);
    expect(quote({ apps: ['accounting'], tier: 'starter', period: 'monthly', companies: 3, priceBook: perCompany }).total).toBe(1497 * RS);
  });

  it('refuses what it cannot price, by name', () => {
    const err = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof PricingError ? e.code : String(e);
      }
      return 'no error';
    };
    expect(err(() => quote({ apps: [], tier: 'starter', period: 'monthly', priceBook: book }))).toBe('NO_APPS');
    expect(err(() => quote({ apps: ['projects'], tier: 'starter', period: 'monthly', priceBook: book }))).toBe('UNKNOWN_APP');
    expect(err(() => quote({ apps: ['books'], tier: 'enterprise', period: 'monthly', priceBook: book }))).toBe('NO_PRICE');
    expect(err(() => quote({ apps: ['books'], tier: 'starter', period: 'weekly' as never, priceBook: book }))).toBe('BAD_PERIOD');
    expect(err(() => quote({ apps: ['books'], tier: 'starter', period: 'monthly', users: -1, priceBook: book }))).toBe('BAD_COUNT');
    expect(err(() => quote({ apps: ['books'], tier: 'starter', period: 'monthly', users: 1.5, priceBook: book }))).toBe('BAD_COUNT');
  });
});

describe('GST', () => {
  it('once registered: CGST 9% + SGST 9% to a buyer in Karnataka — ₹900 becomes ₹1,062', () => {
    const q = quote({ apps: ['books'], tier: 'starter', period: 'monthly', users: 3, priceBook: book, gst: registered, buyerStateCode: '29' });
    expect(q.tax).toMatchObject({ charged: true, kind: 'CGST_SGST', ratePercent: 18, taxable: 900 * RS, cgst: 81 * RS, sgst: 81 * RS, igst: 0, amount: 162 * RS });
    expect(q.total).toBe(1062 * RS);
  });

  it('once registered: IGST 18% to a buyer in another state', () => {
    const q = quote({ apps: ['books'], tier: 'starter', period: 'monthly', users: 3, priceBook: book, gst: registered, buyerStateCode: '27' });
    expect(q.tax).toMatchObject({ kind: 'IGST', cgst: 0, sgst: 0, igst: 162 * RS, amount: 162 * RS });
    expect(q.total).toBe(1062 * RS);
  });

  it('once registered, before the state is known: 18%, the split left open', () => {
    const q = quote({ apps: ['payroll', 'people'], tier: 'starter', period: 'monthly', employees: 10, priceBook: book, gst: registered });
    expect(q.subtotal).toBe(800 * RS);
    expect(q.tax).toMatchObject({ kind: 'GST', amount: 144 * RS, cgst: 0, sgst: 0, igst: 0 });
    expect(q.total).toBe(944 * RS);
  });

  it('rounds each tax to the paisa, half up, on integers', () => {
    expect(percentOf(33_333, 9)).toBe(3000); // 2999.97
    expect(percentOf(33_333, 18)).toBe(6000); // 5999.94
    expect(percentOf(50, 9)).toBe(5); // 4.5 -> 5
    expect(percentOf(49, 9)).toBe(4); // 4.41
    const t = gstOn(33_333, registered, '29');
    expect([t.cgst, t.sgst, t.amount]).toEqual([3000, 3000, 6000]);
  });

  it('leaves out a line that carries no GST', () => {
    const noGstPeople = { ...book, prices: book.prices.map((p) => (p.appCode === 'people' ? { ...p, gstApplies: false } : p)) };
    const q = quote({ apps: ['payroll', 'people'], tier: 'starter', period: 'monthly', employees: 10, priceBook: noGstPeople, gst: registered, buyerStateCode: '07' });
    expect(q.tax).toMatchObject({ taxable: 500 * RS, igst: 90 * RS });
    expect(q.total).toBe(890 * RS);
  });

  it('reads CLOR as registered only with a valid GSTIN, and takes its state from it', () => {
    expect(readGstSetting(undefined)).toMatchObject({ registered: false, sellerStateCode: '29' });
    expect(readGstSetting({ registered: false, gstin: null })).toMatchObject({ registered: false });
    expect(readGstSetting({ registered: true })).toMatchObject({ registered: false });
    expect(readGstSetting({ registered: true, gstin: '29ABCDE1234F1Z5' })).toMatchObject({ registered: false }); // bad check digit
    expect(readGstSetting({ registered: true, gstin: '29AABCU9603R1ZJ' })).toEqual({ registered: true, gstin: '29AABCU9603R1ZJ', sellerStateCode: '29' });
  });
});

describe('checking a set of prices', () => {
  it('passes the mock book', () => {
    expect(priceProblems(mockPrices())).toEqual([]);
    expect(mockPrices()).toHaveLength(16);
  });

  it('names each problem', () => {
    const [m, y] = mockPrices().filter((p) => p.appCode === 'people' && p.tier === 'starter');
    const bad: PlanPriceRow[] = [
      { ...m, unitAmount: -100 },
      { ...y, unitAmount: 12.5 },
      { ...m, appCode: 'projects' },
      { ...m, tier: 'Growth Plus' },
      { ...m, appCode: 'payroll', tier: 'starter' },
      { ...m, appCode: 'payroll', tier: 'starter' },
    ];
    const problems = priceProblems(bad);
    expect(problems).toEqual(
      expect.arrayContaining([
        'People Starter monthly: the amount is whole paise, from 0 to ₹1 crore.',
        'People Starter yearly: the amount is whole paise, from 0 to ₹1 crore.',
        'projects is not an app CLOR sells.',
        'People Growth Plus monthly: a tier is written in small letters, like starter.',
        'Payroll Starter monthly is in the book twice.',
      ]),
    );
    expect(priceProblems([m])).toEqual(['People Starter needs both a monthly and a yearly price.']);
    expect(priceProblems([m, { ...y, includedUnits: 5 }])).toEqual(['People Starter: the monthly and yearly prices count the same unit and include the same number.']);
  });

  it('writes rupees the Indian way', () => {
    expect(rupees(12_345_650)).toBe('₹1,23,456.50');
    expect(rupees(90_000)).toBe('₹900');
    expect(rupees(1_00_00_000_00)).toBe('₹1,00,00,000');
    expect(rupees(5)).toBe('₹0.05');
  });
});
