import { platformPrisma } from '../../utils/platformPrisma.js';
import { isFeatureEnabled } from '../features.js';
import { istInstant, isOvernight, nightInstants, nightShiftLabel, shiftHalves, istTime, type ShiftRule } from './compute.js';

/**
 * Night shifts (feature `attendanceNightShifts`, off by default; O-11 /
 * TLA-003). A shift whose end is earlier than its start belongs to the date it
 * starts, its "shift date". The day engine already scores such a shift across
 * midnight (compute.ts shiftWindow) and readers already file a morning exit on
 * the night before (punches.ts shiftDayFor). With the feature on, the rest of
 * the product reads the shift the same way:
 * - times written by hand (a correction, a missed punch, a manager's entry)
 *   that fall after midnight are put after midnight (compute.ts nightInstants);
 * - a clock-in from the web after midnight goes on the night it belongs to;
 * - leave on a date covers the night shift starting that date, and a half day
 *   is the first or second half of that shift, said so in the preview;
 * - the day record and My days name the shift: "Night shift 22:00–06:00
 *   (ends next day)".
 * Off, every path behaves exactly as it did before the feature existed.
 */
export const NIGHT_SHIFTS = 'attendanceNightShifts';

/** The company has switched night shifts on. `accountId` is looked up when the caller does not have it. */
export async function nightShiftsOn(orgId: string, accountId?: string | null) {
  const account = accountId || (await platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } }))?.accountId;
  if (!account) return false;
  return isFeatureEnabled(account, orgId, NIGHT_SHIFTS);
}

/** Hand-written times on a date as instants: the night-shift reading when it is on and the shift ends the next day, else the plain one. */
export function timesOn(date: string, rule: Pick<ShiftRule, 'startTime' | 'endTime'>, on: boolean, inHHMM?: string | null, outHHMM?: string | null) {
  if (on && isOvernight(rule)) return nightInstants(date, rule, inHHMM, outHHMM);
  const checkIn = inHHMM ? istInstant(date, inHHMM) : null;
  let checkOut = outHHMM ? istInstant(date, outHHMM) : null;
  if (checkIn && checkOut && checkOut <= checkIn) checkOut = istInstant(date, outHHMM!, 1);
  return { checkIn, checkOut };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const nextDate = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/**
 * What a day of leave covers on a night shift, in words for the preview:
 * the whole shift from its start on the date to its end the next morning, or
 * one half of it. Null for a shift that does not cross midnight.
 */
export function nightCover(rule: ShiftRule, date: string, half: 'FIRST' | 'SECOND' | null = null) {
  if (!isOvernight(rule)) return null;
  const label = nightShiftLabel(rule);
  const next = nextDate(date);
  if (!half) return { label, covers: `${rule.startTime} on ${shortDay(date)} to ${rule.endTime} on ${shortDay(next)}` };
  const h = shiftHalves(rule, date)[half];
  const from = istTime(h.from);
  const to = istTime(h.to);
  const onDay = (at: Date) => (at.getTime() >= istInstant(next, '00:00').getTime() ? shortDay(next) : shortDay(date));
  return { label, covers: `${half === 'FIRST' ? 'First' : 'Second'} half: ${from} on ${onDay(h.from)} to ${to} on ${onDay(h.to)}` };
}
