import { describe, expect, it } from 'vitest';

import { PricingError, gstOn, onWebsite, percentOf, planProblems, priceFor, quote, rupees, type PlanData, type PriceBookData } from '../services/pricing/engine.js';
import { SAMPLE_NOTE, samplePlans } from '../services/pricing/seed.js';
import { checkTaxInput, readTaxSetting } from '../services/pricing/settings.js';

/**
 * The pricing engine (services/pricing/engine.ts): pure arithmetic over a
 * price book, checked to the rupee against the sample plans (the editor's
 * Load sample prices).
 *
 * Sample, before GST, a month (yearly is ten months):
 *   Books Starter / Growth          per user, 1 included:      ₹300 / ₹600, each more ₹300 / ₹600
 *   Payroll Starter / Growth        per employee, 10 included: ₹500 / ₹1,000, each more ₹50 / ₹100
 *   People Starter / Growth         per employee, 10 included: ₹300 / ₹600, each more ₹30 / ₹60
 *   Attendance Starter / Growth     per employee, 10 included: ₹400 / ₹800, each more ₹40 / ₹80
 */
const book: PriceBookData = { version: 1, currency: 'INR', note: SAMPLE_NOTE, plans: samplePlans() };
const RS = 100;
const registered = { registered: true, sellerStateCode: '29', ratePercent: 18 };
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof PricingError ? e.code : String(e);
  }
  return 'no error';
};

describe('a quote', () => {
  it('Books Starter monthly for three users is ₹900, with no GST while CLOR is not registered', () => {
    const q = quote({ plans: ['books-starter'], period: 'monthly', users: 3, priceBook: book });
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]).toMatchObject({ planName: 'Books Starter', apps: ['accounting'], unit: 'USER', quantity: 3, includedUnits: 1, extraUnits: 2, basePrice: 300 * RS, extraUnitPrice: 300 * RS, amount: 900 * RS });
    expect(q.subtotal).toBe(900 * RS);
    expect(q.tax).toMatchObject({ charged: false, kind: 'NONE', ratePercent: 0, amount: 0 });
    expect(q.tax.note).toMatch(/not registered for GST/);
    expect(q.total).toBe(900 * RS);
    expect(q.trialDays).toBe(30);
    expect(q.note).toBe('Sample prices — not final');
  });

  it('the base price covers the included employees: Payroll Starter is ₹500 for six, ₹700 for fourteen', () => {
    expect(quote({ plans: ['payroll-starter'], period: 'MONTHLY', employees: 6, priceBook: book }).lines[0]).toMatchObject({ extraUnits: 0, amount: 500 * RS });
    expect(quote({ plans: ['payroll-starter'], period: 'MONTHLY', employees: 14, priceBook: book }).lines[0]).toMatchObject({ extraUnits: 4, amount: 700 * RS });
  });

  it('four Growth plans, yearly, for 2 users and 25 employees: ₹72,000, saving ₹14,400 on monthly', () => {
    const q = quote({ plans: ['attendance-growth', 'people-growth', 'payroll-growth', 'books-growth'], period: 'yearly', users: 2, employees: 25, priceBook: book });
    /* In display order, whatever order they were asked in. */
    expect(q.lines.map((l) => [l.planName, l.amount, l.monthlyEquivalent, l.saving])).toEqual([
      ['Books Growth', 12_000 * RS, 14_400 * RS, 2_400 * RS],
      ['Payroll Growth', 25_000 * RS, 30_000 * RS, 5_000 * RS],
      ['People Growth', 15_000 * RS, 18_000 * RS, 3_000 * RS],
      ['Attendance Growth', 20_000 * RS, 24_000 * RS, 4_000 * RS],
    ]);
    expect(q.subtotal).toBe(72_000 * RS);
    expect(q.yearlySaving).toBe(14_400 * RS);
    expect(rupees(q.total)).toBe('₹72,000');
  });

  it('works yearly out from monthly when the plan has a yearly discount: 20% off ₹500 a month is ₹4,800 a year', () => {
    const plan: PlanData = { ...samplePlans()[2], yearlyDiscountPct: 20, prices: [{ period: 'MONTHLY', basePrice: 500 * RS, extraUnitPrice: 50 * RS }] };
    expect(priceFor(plan, 'YEARLY')).toEqual({ period: 'YEARLY', basePrice: 4800 * RS, extraUnitPrice: 480 * RS });
    const q = quote({ plans: [plan.code], period: 'yearly', employees: 12, priceBook: { ...book, plans: [plan] } });
    expect(q.lines[0]).toMatchObject({ amount: 5760 * RS, monthlyEquivalent: 7200 * RS, saving: 1440 * RS });
  });

  it('counts a company once unless told otherwise', () => {
    const perCompany: PlanData = { ...samplePlans()[0], code: 'books-flat', unit: 'COMPANY', prices: [{ period: 'MONTHLY', basePrice: 499 * RS, extraUnitPrice: 399 * RS }, { period: 'YEARLY', basePrice: 4990 * RS, extraUnitPrice: 3990 * RS }] };
    const flat = { ...book, plans: [perCompany] };
    expect(quote({ plans: ['books-flat'], period: 'monthly', users: 40, priceBook: flat }).total).toBe(499 * RS);
    expect(quote({ plans: ['books-flat'], period: 'monthly', companies: 3, priceBook: flat }).total).toBe((499 + 2 * 399) * RS);
  });

  it('refuses what it cannot price, by name', () => {
    const monthlyOnly = { ...book, plans: [{ ...samplePlans()[0], periods: ['MONTHLY' as const] }] };
    expect(code(() => quote({ plans: [], period: 'monthly', priceBook: book }))).toBe('NO_PLANS');
    expect(code(() => quote({ plans: ['enterprise'], period: 'monthly', priceBook: book }))).toBe('UNKNOWN_PLAN');
    expect(code(() => quote({ plans: ['books-starter', 'books-growth'], period: 'monthly', priceBook: book }))).toBe('APP_TWICE');
    expect(code(() => quote({ plans: ['books-starter'], period: 'yearly', priceBook: monthlyOnly }))).toBe('NO_PRICE');
    expect(code(() => quote({ plans: ['books-starter'], period: 'weekly' as never, priceBook: book }))).toBe('BAD_PERIOD');
    expect(code(() => quote({ plans: ['books-starter'], period: 'monthly', users: -1, priceBook: book }))).toBe('BAD_COUNT');
    expect(code(() => quote({ plans: ['books-starter'], period: 'monthly', users: 1.5, priceBook: book }))).toBe('BAD_COUNT');
  });

  it('keeps plans off the website that are switched off or carry an app still coming', () => {
    const [a] = samplePlans();
    expect(onWebsite(a)).toBe(true);
    expect(onWebsite({ ...a, showOnWebsite: false })).toBe(false);
    expect(onWebsite({ ...a, apps: ['accounting', 'projects'] })).toBe(false);
    const hidden = { ...book, plans: [{ ...a, showOnWebsite: false }] };
    expect(code(() => quote({ plans: [a.code], period: 'monthly', priceBook: hidden, websiteOnly: true }))).toBe('UNKNOWN_PLAN');
    expect(quote({ plans: [a.code], period: 'monthly', priceBook: hidden }).total).toBe(300 * RS);
  });
});

describe('GST', () => {
  it('once registered: CGST 9% + SGST 9% to a buyer in Karnataka — ₹900 becomes ₹1,062', () => {
    const q = quote({ plans: ['books-starter'], period: 'monthly', users: 3, priceBook: book, gst: registered, buyerStateCode: '29' });
    expect(q.tax).toMatchObject({ charged: true, kind: 'CGST_SGST', ratePercent: 18, taxable: 900 * RS, cgst: 81 * RS, sgst: 81 * RS, igst: 0, amount: 162 * RS });
    expect(q.total).toBe(1062 * RS);
  });

  it('once registered: IGST 18% to a buyer in another state', () => {
    const q = quote({ plans: ['books-starter'], period: 'monthly', users: 3, priceBook: book, gst: registered, buyerStateCode: '27' });
    expect(q.tax).toMatchObject({ kind: 'IGST', cgst: 0, sgst: 0, igst: 162 * RS, amount: 162 * RS });
    expect(q.total).toBe(1062 * RS);
  });

  it('once registered, before the state is known: 18%, the split left open', () => {
    const q = quote({ plans: ['payroll-starter', 'people-starter'], period: 'monthly', employees: 10, priceBook: book, gst: registered });
    expect(q.subtotal).toBe(800 * RS);
    expect(q.tax).toMatchObject({ kind: 'GST', amount: 144 * RS });
    expect(q.total).toBe(944 * RS);
  });

  it('rounds each tax to the paisa, half up', () => {
    expect(percentOf(33_333, 9)).toBe(3000); // 2999.97
    expect(percentOf(33_333, 18)).toBe(6000); // 5999.94
    expect(percentOf(50, 9)).toBe(5); // 4.5
    expect(percentOf(49, 9)).toBe(4); // 4.41
    const t = gstOn(33_333, registered, '29');
    expect([t.cgst, t.sgst, t.amount]).toEqual([3000, 3000, 6000]);
  });

  it('leaves out a plan that carries no GST', () => {
    const noGstPeople = { ...book, plans: book.plans.map((p) => (p.code === 'people-starter' ? { ...p, gstApplies: false } : p)) };
    const q = quote({ plans: ['payroll-starter', 'people-starter'], period: 'monthly', employees: 10, priceBook: noGstPeople, gst: registered, buyerStateCode: '07' });
    expect(q.tax).toMatchObject({ taxable: 500 * RS, igst: 90 * RS });
    expect(q.total).toBe(890 * RS);
  });

  it('reads CLOR as registered only with a valid GSTIN, and takes its state from it', () => {
    expect(readTaxSetting(undefined)).toMatchObject({ registered: false, ratePercent: 18 });
    expect(readTaxSetting({ registered: true })).toMatchObject({ registered: false });
    expect(readTaxSetting({ registered: true, gstin: '29ABCDE1234F1Z5' })).toMatchObject({ registered: false }); // bad check digit
    expect(readTaxSetting({ registered: true, gstin: '29AABCU9603R1ZJ', ratePercent: 18 })).toMatchObject({ registered: true, gstin: '29AABCU9603R1ZJ', sellerStateCode: '29', ratePercent: 18 });
  });

  it('checks what an operator types before CLOR charges GST', () => {
    expect(checkTaxInput({ registered: false }).problems).toEqual([]);
    expect(checkTaxInput({ registered: true }).problems).toEqual(['Enter CLOR’s GSTIN to charge GST.', 'Enter the legal name on the GST registration.', 'Enter the SAC code for CLOR’s services.']);
    expect(checkTaxInput({ registered: true, gstin: '29AABCU9603R1ZJ', legalName: 'Clor Applications Pvt Ltd', sac: '998314', state: 'Maharashtra' }).problems).toEqual(['The state does not match the GSTIN: its first two digits are the state code.']);
    const ok = checkTaxInput({ registered: true, gstin: '29aabcu9603r1zj', legalName: 'Clor Applications Pvt Ltd', sac: '998314', state: 'Karnataka', ratePercent: 18 });
    expect(ok).toEqual({ problems: [], value: { registered: true, gstin: '29AABCU9603R1ZJ', legalName: 'Clor Applications Pvt Ltd', stateCode: '29', sac: '998314', ratePercent: 18 } });
    expect(checkTaxInput({ registered: false, ratePercent: 20, sac: 'abc' }).problems).toEqual(['A SAC code is 4 to 8 digits, like 998314.', 'The rate is one of 0, 5, 12, 18 or 28 percent.']);
  });
});

describe('checking a set of plans', () => {
  it('passes the sample plans', () => {
    expect(planProblems(samplePlans())).toEqual([]);
    expect(samplePlans()).toHaveLength(8);
  });

  it('names each problem', () => {
    const [a, b] = samplePlans();
    const problems = planProblems([
      { ...a, prices: [{ period: 'MONTHLY', basePrice: -100, extraUnitPrice: 0 }, a.prices[1]] },
      { ...b, code: a.code },
      { ...b, code: 'Bad Code', apps: [] },
      { ...b, code: 'unknown-app', apps: ['crm'] },
      { ...b, code: 'no-yearly', prices: [b.prices[0]] },
      { ...b, code: 'discount-no-monthly', yearlyDiscountPct: 10, periods: ['YEARLY'], prices: [] },
      { ...b, code: 'too-much-off', yearlyDiscountPct: 95 },
    ]);
    expect(problems).toEqual([
      'Books Starter monthly: prices are whole paise, from 0 to ₹1 crore.',
      'Two plans have the code books-starter.',
      'Books Growth: the code is small letters, numbers and dashes, like books-starter.',
      'Books Growth: choose at least one app.',
      'Books Growth: crm is not a CLOR app.',
      'Books Growth: give it a yearly price.',
      'Books Growth: a yearly discount needs a monthly price to work from.',
      'Books Growth: the yearly discount is 0 to 90 percent.',
    ]);
  });

  it('writes rupees the Indian way', () => {
    expect(rupees(12_345_650)).toBe('₹1,23,456.50');
    expect(rupees(90_000)).toBe('₹900');
    expect(rupees(1_000_000_000)).toBe('₹1,00,00,000');
    expect(rupees(5)).toBe('₹0.05');
  });
});
