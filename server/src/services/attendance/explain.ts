import { computeDay, fullDayBy, isWeeklyOff, istTime, shiftWindow, type DayResult, type ShiftRule } from './compute.js';
import { pairDay } from './adms.js';

/**
 * Why a day says what it says.
 *
 * Nothing here decides anything. The explanation re-runs the same functions
 * the day was written with (pairDay for reader punches, computeDay for the
 * figures) on the same inputs, and narrates each step. If the stored day and
 * the re-run disagree — the shift's rules changed since, or the day was set
 * by hand — the explanation says so rather than pretending.
 */

const SOURCE_SAYS: Record<string, string> = {
  TEMPORARY: 'a temporary schedule',
  EMPLOYEE: 'their own schedule',
  ROTATION: 'a rotation',
  DEPARTMENT: "their department's schedule",
  DEFAULT: 'the company default',
};

const RECORD_SOURCE_SAYS: Record<string, string> = {
  DEVICE: 'worked out from reader punches',
  CLOCK: 'worked out from app clock-ins',
  MANUAL: 'marked by hand',
  REQUEST: 'set by an approved correction',
  LEAVE: 'set by approved leave',
  IMPORT: 'imported from a file',
};

export const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

export type ExplainInput = {
  date: string;
  shift: { name: string; source: string; rule: ShiftRule };
  holidayName: string | null;
  punches: Array<{ at: Date; kind: 'IN' | 'OUT' | null; where: string }>;
  record: null | {
    status: string;
    source: string;
    checkIn: Date | null;
    checkOut: Date | null;
    workedMinutes: number;
    lateMinutes: number;
    earlyOutMinutes: number;
    overtimeMinutes: number;
    overtimeApproved: boolean;
    /** The unpaid break time taken from the day's punches (a shift on punched breaks); null or absent, the fixed breaks. */
    breakMinutes?: number | null;
    validated: boolean;
    leaveName?: string | null;
  };
  today: string;
};

export function explainDay(input: ExplainInput) {
  const { date, shift, record } = input;
  const rule = shift.rule;
  const steps: Array<{ kind: string; text: string }> = [];
  const { start, end } = shiftWindow(rule, date);
  const crosses = end.getTime() - start.getTime() > 0 && istTime(end) <= istTime(start);
  const offDay = isWeeklyOff(rule, date);

  steps.push({
    kind: 'shift',
    text: `Shift ${shift.name}, ${rule.startTime}–${rule.endTime}${crosses ? ' (ends the next morning)' : ''}, from ${SOURCE_SAYS[shift.source] || 'the schedule'}.`,
  });
  if (input.holidayName) steps.push({ kind: 'rest', text: `Holiday: ${input.holidayName}. Time worked counts as overtime.` });
  else if (offDay) steps.push({ kind: 'rest', text: 'Weekly off for this shift. Time worked counts as overtime.' });

  const sorted = [...input.punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const paired = sorted.length ? pairDay(sorted.map((p) => ({ at: p.at, kind: p.kind }))) : null;
  if (sorted.length) {
    const first = sorted[0];
    steps.push({ kind: 'punches', text: `${sorted.length} punch${sorted.length === 1 ? '' : 'es'}: first ${istTime(first.at)} at ${first.where}${sorted.length > 1 ? `, last ${istTime(sorted[sorted.length - 1].at)} at ${sorted[sorted.length - 1].where}` : ''}.` });
    if (paired?.endsOnEntry) steps.push({ kind: 'punches', text: 'The last punch was an entry with no exit after it, so the day has no check-out from the reader.' });
  } else {
    steps.push({ kind: 'punches', text: 'No reader or app punches for this day.' });
  }

  if (!record) {
    steps.push({
      kind: 'result',
      text: date > input.today ? 'This day has not happened yet.' : input.holidayName || offDay ? 'No record: a rest day, paid.' : 'No record for a working day: it counts as absent (loss of pay) until it is marked or corrected.',
    });
    return { steps, recomputed: null as DayResult | null, matches: true, window: { start: istTime(start), end: istTime(end) } };
  }

  steps.push({ kind: 'source', text: `The day was ${RECORD_SOURCE_SAYS[record.source] || 'recorded'}.${record.leaveName ? ` Leave: ${record.leaveName}.` : ''}` });

  if (record.checkIn) {
    const lateBy = Math.max(0, Math.round((record.checkIn.getTime() - start.getTime()) / 60000));
    if (input.holidayName || offDay) steps.push({ kind: 'late', text: `In at ${istTime(record.checkIn)}. Lateness does not apply on a rest day.` });
    else if (lateBy === 0) steps.push({ kind: 'late', text: `In at ${istTime(record.checkIn)}, on time.` });
    else if (lateBy <= rule.graceMinutes) steps.push({ kind: 'late', text: `In at ${istTime(record.checkIn)}, ${lateBy} min after the start, within the ${rule.graceMinutes} min grace: not late.` });
    else steps.push({ kind: 'late', text: `In at ${istTime(record.checkIn)}, ${lateBy} min after the start. Grace is ${rule.graceMinutes} min, so it counts as ${lateBy} min late (from the start, not from the end of grace).` });
  }

  if (record.checkIn && !record.checkOut) {
    steps.push({ kind: 'worked', text: date < input.today ? 'No check-out. A past working day with only a check-in is not paid until someone corrects it.' : 'Checked in, not out yet: the day is still under way.' });
  } else if (record.checkIn && record.checkOut) {
    const span = Math.max(0, Math.round((record.checkOut.getTime() - record.checkIn.getTime()) / 60000));
    const lessBreak = span > rule.halfDayMinutes ? Math.max(rule.halfDayMinutes, span - rule.breakMinutes) : span;
    /* A shift on punched breaks, on a day with break punches: the time out comes off, less any paid break (breaks.ts). */
    const punched = rule.breakMode === 'PUNCHED' && record.breakMinutes !== null && record.breakMinutes !== undefined ? record.breakMinutes : null;
    const named = (rule.breaks || []).filter((x) => !x.paid);
    const fixedWords = named.length > 1 ? `the ${rule.breakMinutes} min of breaks (${named.map((x) => `${x.name} ${x.minutes}`).join(', ')})` : `the ${rule.breakMinutes} min break`;
    steps.push({
      kind: 'worked',
      text: punched !== null
        ? `Out at ${istTime(record.checkOut)}: ${hm(span)} on site, less ${punched} min of breaks punched out and in = ${hm(Math.max(0, span - punched))} worked.`
        : span > rule.halfDayMinutes
          ? `Out at ${istTime(record.checkOut)}: ${hm(span)} on site, less ${fixedWords} = ${hm(lessBreak)} worked.${rule.breakMode === 'PUNCHED' ? ' No break was punched that day, so the fixed breaks apply.' : ''}`
          : `Out at ${istTime(record.checkOut)}: ${hm(span)} worked (no break taken off a day shorter than half a day).`,
    });
    const earlyBy = Math.max(0, Math.round((end.getTime() - record.checkOut.getTime()) / 60000));
    if (!input.holidayName && !offDay && earlyBy > rule.earlyOutGraceMinutes) steps.push({ kind: 'early', text: `Left ${earlyBy} min before the shift ended${rule.earlyOutGraceMinutes ? ` (early-out grace ${rule.earlyOutGraceMinutes} min)` : ''}.` });
    /* The two ways to a full day (compute.ts): the shift worked as scheduled, or the full-day minutes. */
    const inBy = istTime(new Date(start.getTime() + rule.graceMinutes * 60_000));
    const outFrom = istTime(new Date(end.getTime() - rule.earlyOutGraceMinutes * 60_000));
    const by = !input.holidayName && !offDay ? fullDayBy(rule, date, record.checkIn, record.checkOut, record.workedMinutes) : null;
    steps.push({
      kind: 'status',
      text: `A full day is the shift worked as scheduled (in by ${inBy}, out from ${outFrom}) or ${hm(rule.fullDayMinutes)} worked; a half day is ${hm(rule.halfDayMinutes)}. ${by === 'SCHEDULE' ? 'Worked as scheduled' : `${hm(record.workedMinutes)} worked`}: ${statusWord(record.status)}.`,
    });
    const otAfter = rule.overtimeAfterMinutes ?? rule.fullDayMinutes;
    if (record.overtimeMinutes > 0) {
      steps.push({
        kind: 'overtime',
        text: input.holidayName || offDay
          ? `All ${hm(record.overtimeMinutes)} on a rest day is overtime, ${record.overtimeApproved ? 'approved' : 'not approved yet (unapproved overtime is not paid)'}.`
          : `Overtime counts after ${hm(otAfter)}: ${hm(record.overtimeMinutes)}, ${record.overtimeApproved ? 'approved' : 'not approved yet (unapproved overtime is not paid)'}.`,
      });
    }
  } else {
    steps.push({ kind: 'status', text: `Status ${statusWord(record.status)}.` });
  }

  steps.push({ kind: 'validated', text: record.validated ? 'Validated by a manager.' : 'Not validated yet.' });

  /* The same functions on the same inputs, to show the figures still follow from the rules. */
  let recomputed: DayResult | null = null;
  let matches = true;
  if (record.checkIn && ['DEVICE', 'CLOCK', 'MANUAL', 'REQUEST', 'IMPORT'].includes(record.source)) {
    try {
      recomputed = computeDay({ date, shift: rule, checkIn: record.checkIn, checkOut: record.checkOut, isHoliday: Boolean(input.holidayName), breakTakenMinutes: record.breakMinutes ?? null });
      matches =
        recomputed.status === record.status &&
        recomputed.workedMinutes === record.workedMinutes &&
        recomputed.lateMinutes === record.lateMinutes &&
        recomputed.overtimeMinutes === record.overtimeMinutes;
    } catch {
      recomputed = null;
    }
    if (!matches) steps.push({ kind: 'mismatch', text: "Today's shift rules give a different answer than the stored day, so the shift was probably changed after this day was worked out. Recalculate past days under Attendance rules to apply the current rules." });
  }
  return { steps, recomputed, matches, window: { start: istTime(start), end: istTime(end) } };
}

export const statusWord = (s: string) =>
  ({ PRESENT: 'present', HALF_DAY: 'a half day', ABSENT: 'absent', ON_LEAVE: 'on leave', HOLIDAY: 'a holiday', WEEKLY_OFF: 'a weekly off' } as Record<string, string>)[s] || s.toLowerCase();
