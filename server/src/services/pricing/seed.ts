import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';
import { clearPublishedCache } from './books.js';
import type { PlanPriceRow, PriceUnit } from './engine.js';

/**
 * Price book version 1: MOCK prices, round numbers to build and test against
 * until the products are final (owner, roadmap item 9: "create it with mock
 * data; later we will edit and add real pricing"). The real prices go in as a
 * new version through the operator console, not by editing this file.
 *
 * Every amount is before GST, in paise. Yearly is ten months' price: two months free.
 */
export const MOCK_NOTE = 'Mock prices — not final';
export const MOCK_TRIAL_DAYS = 30;

const RUPEE = 100;
/* app, unit, included units, starter ₹ a unit a month, growth ₹ a unit a month */
const MOCK: [string, PriceUnit, number, number, number][] = [
  ['accounting', 'USER', 1, 300, 600],
  ['payroll', 'EMPLOYEE', 10, 50, 100],
  ['people', 'EMPLOYEE', 10, 30, 60],
  ['attendance', 'EMPLOYEE', 10, 40, 80],
];

export function mockPrices(): PlanPriceRow[] {
  return MOCK.flatMap(([appCode, unit, includedUnits, starter, growth]) =>
    (
      [
        ['starter', starter],
        ['growth', growth],
      ] as const
    ).flatMap(([tier, monthly]) => [
      {
        appCode,
        tier,
        period: 'MONTHLY' as const,
        unit,
        unitAmount: monthly * RUPEE,
        includedUnits,
        trialDays: MOCK_TRIAL_DAYS,
        gstApplies: true,
      },
      {
        appCode,
        tier,
        period: 'YEARLY' as const,
        unit,
        unitAmount: monthly * 10 * RUPEE,
        includedUnits,
        trialDays: MOCK_TRIAL_DAYS,
        gstApplies: true,
      },
    ]),
  );
}

/**
 * Make and publish version 1 when there is no price book at all. Idempotent:
 * once any book exists — the mock, or real prices an operator published —
 * it does nothing, so it never overwrites anybody's work. Two instances
 * starting together: the version number is unique, and the second's insert
 * is refused and ignored.
 */
export const ensureFirstPriceBook = () =>
  outsideTenant('pricing: the first price book', async () => {
    if (await platformPrisma.priceBook.count()) return { created: false as const };
    try {
      const b = await platformPrisma.priceBook.create({
        data: {
          version: 1,
          status: 'PUBLISHED',
          currency: 'INR',
          note: MOCK_NOTE,
          publishedAt: new Date(),
          prices: { create: mockPrices() },
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
