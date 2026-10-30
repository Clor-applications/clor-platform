import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';

/**
 * National and festival holidays a state's law asks for in a year
 * (TIME-LEAVE-MARKET-RESEARCH.md G4). Only figures checked against the Act
 * are here; a state whose figure was not verified says so instead of a number,
 * and a state not listed is simply not checked.
 */
export const STATE_HOLIDAY_MINIMUM: Record<string, { days: number | null; law: string }> = {
  Karnataka: { days: 10, law: 'Karnataka Industrial Establishments (National and Festival Holidays) Act: 5 national and 5 festival holidays' },
  Maharashtra: { days: 8, law: 'Maharashtra Shops and Establishments Act: 8 holidays, 4 of them fixed (26 Jan, 1 May, 15 Aug, 2 Oct)' },
  'Tamil Nadu': { days: null, law: 'Tamil Nadu Industrial Establishments (National and Festival Holidays) Act: the yearly figure is not confirmed here; check it before relying on this list' },
};

/**
 * For each branch in a state with a known minimum: the holidays its people
 * have in the year (the company's own, and the branch's), against that
 * minimum. Optional (restricted) holidays are not counted: nobody is owed them.
 */
export async function holidayMinimum(orgId: string, year: string) {
  const branches = await platformPrisma.branch.findMany({ where: { orgId, isActive: true }, select: { id: true, branchName: true, state: true } });
  const inScope = branches.filter((b) => STATE_HOLIDAY_MINIMUM[b.state]);
  if (!inScope.length) return [];
  const holidays = await peoplePrisma.holiday.findMany({ where: { orgId, isOptional: false, areaId: null, date: { gte: `${year}-01-01`, lte: `${year}-12-31` } }, select: { date: true, branchId: true } });
  return inScope.map((b) => {
    const rule = STATE_HOLIDAY_MINIMUM[b.state];
    const count = new Set(holidays.filter((h) => !h.branchId || h.branchId === b.id).map((h) => h.date)).size;
    return { branchId: b.id, branchName: b.branchName, state: b.state, holidays: count, minimum: rule.days, law: rule.law, short: rule.days != null && count < rule.days };
  });
}
