import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';
import { clearPublishedCache } from './books.js';
import type { PlanData, PriceUnit } from './engine.js';

/**
 * Sample prices: round numbers to try the engine, the editor and clor.in with,
 * clearly marked as not final. Nothing depends on them. In the operator
 * console they are the draft's "Load sample prices" button; for a developer's
 * own database, `npm run seed:pricing` publishes them as version 1 when there
 * is no price book at all. Real prices are made in the console.
 *
 * Every amount is before GST, in paise. Yearly is ten months' price, two
 * months free; as a percentage that would be 16.67%, so each sample plan
 * carries its own yearly price rather than a yearly discount.
 */
export const SAMPLE_NOTE = 'Sample prices — not final';
export const SAMPLE_TRIAL_DAYS = 30;

const RS = 100;
/* code, name, apps, unit, included, monthly base ₹, monthly extra ₹, description, highlight */
const SAMPLE: [string, string, string[], PriceUnit, number, number, number, string, boolean][] = [
  ['books-starter', 'Books Starter', ['accounting'], 'USER', 1, 300, 300, 'GST invoices, bills and the books for one company.', false],
  ['books-growth', 'Books Growth', ['accounting'], 'USER', 1, 600, 600, 'Inventory, branches and approvals on top of Starter.', true],
  ['payroll-starter', 'Payroll Starter', ['payroll'], 'EMPLOYEE', 10, 500, 50, 'Pay runs with PF, ESI, PT and TDS, and payslips.', false],
  ['payroll-growth', 'Payroll Growth', ['payroll'], 'EMPLOYEE', 10, 1000, 100, 'Loans, revisions, settlements and posting to Books.', false],
  ['people-starter', 'People Starter', ['people'], 'EMPLOYEE', 10, 300, 30, 'Employee records, documents and the employee app.', false],
  ['people-growth', 'People Growth', ['people'], 'EMPLOYEE', 10, 600, 60, 'Onboarding, approvals, letters and engagement.', false],
  ['attendance-starter', 'Attendance Starter', ['attendance'], 'EMPLOYEE', 10, 400, 40, 'Phone punches, shifts and leave.', false],
  ['attendance-growth', 'Attendance Growth', ['attendance'], 'EMPLOYEE', 10, 800, 80, 'Biometric readers, rules and month close for payroll.', false],
];

export function samplePlans(): PlanData[] {
  return SAMPLE.map(([code, name, apps, unit, includedUnits, base, extra, description, highlight], i) => ({
    code,
    name,
    description,
    apps,
    unit,
    includedUnits,
    trialDays: SAMPLE_TRIAL_DAYS,
    periods: ['MONTHLY', 'YEARLY'],
    yearlyDiscountPct: null,
    displayOrder: (i + 1) * 10,
    showOnWebsite: true,
    highlight,
    gstApplies: true,
    prices: [
      { period: 'MONTHLY', basePrice: base * RS, extraUnitPrice: extra * RS },
      { period: 'YEARLY', basePrice: base * 10 * RS, extraUnitPrice: extra * 10 * RS },
    ],
  }));
}

/**
 * For a developer's database: publish the sample prices as version 1 when there
 * is no price book at all. Idempotent: with any book there it does nothing.
 */
export const seedSampleBook = () =>
  outsideTenant('pricing: sample price book', async () => {
    if (await platformPrisma.priceBook.count()) return { created: false as const };
    try {
      const b = await platformPrisma.priceBook.create({
        data: {
          version: 1,
          status: 'PUBLISHED',
          currency: 'INR',
          note: SAMPLE_NOTE,
          publishedAt: new Date(),
          plans: { create: samplePlans().map(({ prices, ...p }) => ({ ...p, prices: { create: prices } })) },
        },
        select: { id: true, version: true },
      });
      clearPublishedCache();
      return { created: true as const, ...b };
    } catch (e: any) {
      if (String(e?.code) === 'P2002') return { created: false as const };
      throw e;
    }
  });
