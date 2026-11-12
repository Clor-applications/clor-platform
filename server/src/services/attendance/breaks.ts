import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { isHHMM, isOvernight, istInstant, shiftSpanMinutes, type ShiftBreak, type ShiftRule } from './compute.js';

/**
 * A shift's breaks.
 *
 * A shift had one fixed break (`breakMinutes`), taken off any day longer than
 * half a day. It may now name several: each with a name, either a time of day
 * (start to end) or only a length, and paid or unpaid. Two things follow, and
 * nothing else changes:
 *
 *  - Fixed breaks (the default). The unpaid breaks' total is the shift's
 *    `breakMinutes`, written when the shift is saved, so the day engine, the
 *    full-day check and every report read the one figure they always did. A
 *    paid break is time at work: it takes nothing off. A shift with no named
 *    breaks is exactly the old shift: one unpaid break of `breakMinutes`.
 *
 *  - Punched breaks (the company's choice, per shift). Where a reader or a
 *    phone records break out and break in, the time actually out comes off
 *    the day instead of the fixed total. Paid breaks are not taken off: the
 *    part of the time out that falls inside a paid break's times, and, for a
 *    paid break with only a length, up to that length of what is left. A day
 *    with no break punches at all keeps the fixed breaks, so not punching
 *    never earns a longer day. An out with no in after it is not a break: the
 *    last out is the end of the day (adms.ts pairDay).
 *
 * Pure, apart from `punchedBreakFor`, which reads the day's punches.
 */

export const BREAK_MODES = ['FIXED', 'PUNCHED'] as const;
export const MAX_BREAKS = 8;

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A break's length: its times when it has them (a break may run past midnight on a night shift), else its minutes. */
export const breakLength = (b: Pick<ShiftBreak, 'startTime' | 'endTime' | 'minutes'>) => {
  if (b.startTime && b.endTime) {
    const d = minutesOf(b.endTime) - minutesOf(b.startTime);
    return d > 0 ? d : d + 24 * 60;
  }
  return Math.max(0, Math.round(Number(b.minutes) || 0));
};

/** Shift.breaks, read safely: well-formed breaks only, each with its length worked out. */
export function breaksOf(raw: unknown): ShiftBreak[] {
  if (!Array.isArray(raw)) return [];
  const out: ShiftBreak[] = [];
  for (const x of raw as Array<Record<string, unknown>>) {
    if (!x || typeof x !== 'object') continue;
    const startTime = typeof x.startTime === 'string' && isHHMM(x.startTime) ? x.startTime : null;
    const endTime = typeof x.endTime === 'string' && isHHMM(x.endTime) ? x.endTime : null;
    const timed = Boolean(startTime && endTime);
    const b: ShiftBreak = { name: String(x.name || '').trim().slice(0, 40) || 'Break', startTime: timed ? startTime : null, endTime: timed ? endTime : null, minutes: 0, paid: Boolean(x.paid) };
    b.minutes = breakLength({ ...b, minutes: Number(x.minutes) || 0 });
    if (b.minutes > 0) out.push(b);
    if (out.length >= MAX_BREAKS) break;
  }
  return out;
}

/** What the fixed breaks take off a day: the unpaid ones. */
export const unpaidBreakMinutes = (breaks: ShiftBreak[]) => breaks.filter((b) => !b.paid).reduce((a, b) => a + b.minutes, 0);
export const paidBreakMinutes = (breaks: ShiftBreak[]) => breaks.filter((b) => b.paid).reduce((a, b) => a + b.minutes, 0);

/** A shift that named no breaks has the one it always had: `breakMinutes`, unpaid. */
export const effectiveBreaks = (shift: Pick<ShiftRule, 'breaks' | 'breakMinutes'>): ShiftBreak[] =>
  shift.breaks?.length ? shift.breaks : shift.breakMinutes > 0 ? [{ name: 'Break', startTime: null, endTime: null, minutes: shift.breakMinutes, paid: false }] : [];

/** Minutes from the shift's start to a time of day inside it; a time before the start on a night shift is after midnight. */
const offsetIn = (shift: Pick<ShiftRule, 'startTime' | 'endTime'>, hhmm: string) => {
  const d = minutesOf(hhmm) - minutesOf(shift.startTime);
  return d >= 0 ? d : isOvernight(shift) ? d + 24 * 60 : d;
};

/** Why a shift's breaks do not hold together, or null. */
export function breaksProblem(breaks: ShiftBreak[], shift: Pick<ShiftRule, 'startTime' | 'endTime'>): string | null {
  if (breaks.length > MAX_BREAKS) return `A shift has at most ${MAX_BREAKS} breaks.`;
  const span = shiftSpanMinutes(shift);
  const timed: Array<{ name: string; from: number; to: number }> = [];
  for (const b of breaks) {
    if (b.minutes <= 0) return `${b.name}: a break needs a length, or a start and an end.`;
    if (b.startTime && b.endTime) {
      const from = offsetIn(shift, b.startTime);
      const to = from + b.minutes;
      if (from < 0 || to > span) return `${b.name}: ${b.startTime}–${b.endTime} is outside the shift (${shift.startTime}–${shift.endTime}).`;
      const clash = timed.find((t) => from < t.to && t.from < to);
      if (clash) return `${b.name} and ${clash.name} overlap.`;
      timed.push({ name: b.name, from, to });
    }
  }
  if (breaks.reduce((a, b) => a + b.minutes, 0) >= span) return 'The breaks are as long as the shift.';
  return null;
}

export type Gap = { from: Date; to: Date };

/**
 * The breaks punched inside a day: each out followed by an in, between the
 * day's first in and last out. Punches with no direction (a reader that sends
 * none) are read in turn: out, in, out, in. An out with no in after it is left
 * alone.
 */
export function punchedGaps(points: Array<{ at: Date; kind: 'IN' | 'OUT' | null }>, checkIn: Date, checkOut: Date): Gap[] {
  const inside = points.filter((p) => p.at.getTime() > checkIn.getTime() && p.at.getTime() < checkOut.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime());
  const gaps: Gap[] = [];
  let outAt: Date | null = null;
  for (const p of inside) {
    const kind = p.kind ?? (outAt ? 'IN' : 'OUT');
    if (kind === 'OUT' && !outAt) outAt = p.at;
    else if (kind === 'IN' && outAt) {
      gaps.push({ from: outAt, to: p.at });
      outAt = null;
    }
  }
  return gaps;
}

const mins = (ms: number) => Math.max(0, Math.round(ms / 60_000));

/**
 * What punched breaks take off a day: the time out, less the paid part.
 * `total` is the time out, `paid` the part of it a paid break covers,
 * `deducted` the rest.
 */
export function punchedBreak(gaps: Gap[], shift: Pick<ShiftRule, 'startTime' | 'endTime' | 'breaks' | 'breakMinutes'>, date: string) {
  const total = gaps.reduce((a, g) => a + mins(g.to.getTime() - g.from.getTime()), 0);
  const paidBreaks = effectiveBreaks(shift).filter((b) => b.paid);
  const start = istInstant(date, shift.startTime).getTime();
  let paid = 0;
  for (const b of paidBreaks.filter((x) => x.startTime && x.endTime)) {
    const from = start + offsetIn(shift, b.startTime!) * 60_000;
    const to = from + b.minutes * 60_000;
    for (const g of gaps) paid += mins(Math.min(to, g.to.getTime()) - Math.max(from, g.from.getTime()));
  }
  paid = Math.min(total, paid);
  /* A paid break with only a length: up to that much of the time out that is left. */
  paid += Math.min(total - paid, paidBreaks.filter((x) => !(x.startTime && x.endTime)).reduce((a, b) => a + b.minutes, 0));
  return { total, paid, deducted: total - paid };
}

/**
 * The unpaid break time punched on one person's day, for a shift on punched
 * breaks; null when the shift is on fixed breaks, the day is not complete, or
 * nobody punched a break that day (the fixed breaks then apply). Reads what
 * the day itself is worked out from: reader and phone punches that count
 * (held, refused and waiting ones do not), and clock-ins from the app.
 */
export async function punchedBreakFor(orgId: string, employeeId: string, date: string, shift: ShiftRule, checkIn: Date | null, checkOut: Date | null): Promise<number | null> {
  if (shift.breakMode !== 'PUNCHED' || !checkIn || !checkOut || checkOut.getTime() <= checkIn.getTime()) return null;
  const between = { gt: checkIn, lt: checkOut };
  const [punches, clocks] = await Promise.all([
    peoplePrisma.devicePunch.findMany({ where: { orgId, employeeId, at: between, OR: [{ reviewStatus: null }, { reviewStatus: 'APPROVED' }] }, select: { at: true, kind: true } }),
    peoplePrisma.attendanceActivity.findMany({ where: { orgId, employeeId, source: 'CLOCK', at: between }, select: { at: true, kind: true } }),
  ]);
  const gaps = punchedGaps(
    [...punches.map((p) => ({ at: p.at, kind: (p.kind as 'IN' | 'OUT' | null) ?? null })), ...clocks.map((c) => ({ at: c.at, kind: c.kind === 'OUT' ? ('OUT' as const) : ('IN' as const) }))],
    checkIn,
    checkOut,
  );
  return gaps.length ? punchedBreak(gaps, shift, date).deducted : null;
}
