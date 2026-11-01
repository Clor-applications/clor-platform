import { z } from 'zod';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { recordRuleVersion } from './ruleVersions.js';
import { isHHMM } from './compute.js';
import { todayIst as istDay } from '../../utils/istDate.js';

/**
 * People → Settings → Attendance rules (WORKFLOW-GAP-RESEARCH-2026-10-30 4.4, 4.5, 4.6, B19), kept in
 * AttendanceSettings.timeRules and read over these defaults, part by part:
 *
 *  - marks: late marks and early exits. "Every [3] late marks after [10] min = [½ day], from [leave,
 *    else unpaid]". Off by default: it costs pay. Before this screen the Attendance rules kept a
 *    simpler form (lateAllowancePerMonth, latePenaltyEvery: half a day of loss of pay); a company that
 *    set it and never saved here keeps exactly that, read as marks rules (`legacyMarks`).
 *  - nudge: the missing-punch notice to the person, and the manager's morning list. On by default.
 *  - absence: unexplained absence, so HR can follow it up. On by default, 5 working days. The right
 *    number depends on the company's standing orders (state model standing orders differ): a lawyer's
 *    check, not a rule CLOR knows (the research marks it unverified).
 *  - night: women's consent to night work (OSH Code 2020 s.43: before 6 am or after 7 pm). On by
 *    default; the window is the company's, since states set their own conditions.
 */

export type MarkKind = { on: boolean; graceMinutes: number | null; every: number; free: number };
/**
 * How much a mark cuts (docs/people/workflow-engine/SPEC.md 3.1, DECISIONS.md 1):
 *  - TIME_MISSED: the time actually missed (each counted mark's whole late or early minutes), as a part of the
 *    day: minutes ÷ the shift's full-day minutes. Code on Wages 2019 s.20 allows a cut in proportion to the time
 *    missed, so this is the default for a company not yet using late marks.
 *  - TIME_MISSED_ROUNDED_DOWN: the same, each mark rounded DOWN to 15, 30 or 60 minutes (`roundToMinutes`): a
 *    20-minute late under 15 cuts 15, a 10-minute late cuts nothing. It can never cut more than the time missed.
 *    (Before 1 Nov 2026 this mode rounded up, as TIME_MISSED_ROUNDED; that cut more than the time missed, so the
 *    migration 20261115090000_late_cut_round_down rewrote it, and a stray old value still reads as round-down.)
 *  - HALF_DAY_PER_N: every N marks cost ½ or 1 day (`every`, `cost`). It can cut more than the time missed; a
 *    company already using late marks keeps it, with its numbers, so its pay does not change.
 * The first `free` marks of a month cost nothing in every mode.
 */
export type CutMode = 'TIME_MISSED' | 'TIME_MISSED_ROUNDED_DOWN' | 'HALF_DAY_PER_N';
export const CUT_MODES: CutMode[] = ['TIME_MISSED', 'TIME_MISSED_ROUNDED_DOWN', 'HALF_DAY_PER_N'];
/** A minute cut: never more than the time missed. */
export const isMinuteCut = (m: CutMode) => m === 'TIME_MISSED' || m === 'TIME_MISSED_ROUNDED_DOWN';
export type MarkRules = { on: boolean; late: MarkKind; early: MarkKind; cost: 0.5 | 1; takeFrom: string[]; cutMode: CutMode; roundToMinutes: 15 | 30 | 60 };
export type NudgeRules = { on: boolean; afterHours: number; managerDigest: boolean };
export type AbsenceRules = { on: boolean; days: number; noticeGapDays: number; replyDays: number };
/** ENFORCE: a night shift is refused without consent. WARN: it is saved, and who lacks consent is listed (People Home, Night work). */
export type NightRules = { on: boolean; from: string; to: string; mode: 'ENFORCE' | 'WARN' };
export type TimeRules = { marks: MarkRules; nudge: NudgeRules; absence: AbsenceRules; night: NightRules };

export const DEFAULT_TIME_RULES: TimeRules = {
  marks: { on: false, late: { on: true, graceMinutes: null, every: 3, free: 0 }, early: { on: false, graceMinutes: null, every: 3, free: 0 }, cost: 0.5, takeFrom: [], cutMode: 'TIME_MISSED', roundToMinutes: 15 },
  nudge: { on: true, afterHours: 2, managerDigest: true },
  absence: { on: true, days: 5, noticeGapDays: 7, replyDays: 7 },
  /* New companies ENFORCE; companies already on CLOR when the check arrived were set to WARN (migration 20261111090200). */
  night: { on: true, from: '19:00', to: '06:00', mode: 'ENFORCE' },
};

const kindSchema = z.object({
  on: z.boolean().optional(),
  graceMinutes: z.coerce.number().int().min(0).max(240).nullable().optional(),
  every: z.coerce.number().int().min(1, 'Every 1 mark or more.').max(31).optional(),
  free: z.coerce.number().int().min(0).max(31).optional(),
});
export const timeRulesSchema = z.object({
  marks: z.object({
    on: z.boolean().optional(),
    late: kindSchema.optional(),
    early: kindSchema.optional(),
    cost: z.union([z.literal(0.5), z.literal(1)]).optional(),
    takeFrom: z.array(z.string().min(1).max(60)).max(10).optional(),
    cutMode: z.enum(CUT_MODES as [CutMode, ...CutMode[]]).optional(),
    roundToMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
  }).optional(),
  nudge: z.object({ on: z.boolean().optional(), afterHours: z.coerce.number().int().min(0).max(24).optional(), managerDigest: z.boolean().optional() }).optional(),
  absence: z.object({
    on: z.boolean().optional(),
    days: z.coerce.number().int().min(2, 'At least 2 days.').max(30, 'At most 30 days.').optional(),
    noticeGapDays: z.coerce.number().int().min(1).max(30).optional(),
    replyDays: z.coerce.number().int().min(1).max(30).optional(),
  }).optional(),
  night: z.object({
    on: z.boolean().optional(),
    from: z.string().refine(isHHMM, 'Times are HH:MM, 24-hour.').optional(),
    to: z.string().refine(isHHMM, 'Times are HH:MM, 24-hour.').optional(),
    mode: z.enum(['ENFORCE', 'WARN']).optional(),
  }).optional(),
});

type Saved = Partial<{ marks: Partial<MarkRules> & { late?: Partial<MarkKind>; early?: Partial<MarkKind> }; nudge: Partial<NudgeRules>; absence: Partial<AbsenceRules>; night: Partial<NightRules> }>;

/** The old two-number rule, as marks rules: the first `lateAllowancePerMonth` late days free, then half a day of loss of pay every `latePenaltyEvery`. */
export const legacyMarks = (s: { lateAllowancePerMonth?: number | null; latePenaltyEvery?: number | null } | null | undefined): MarkRules => {
  const every = Math.max(0, s?.latePenaltyEvery || 0);
  /* A company on the old rule keeps it: half a day every N (SPEC 3.1, "existing companies keep their numbers"). */
  return { ...DEFAULT_TIME_RULES.marks, on: every > 0, late: { on: true, graceMinutes: null, every: every || 3, free: Math.max(0, s?.lateAllowancePerMonth || 0) }, cutMode: every > 0 ? 'HALF_DAY_PER_N' : 'TIME_MISSED' };
};
const isCutMode = (v: unknown): v is CutMode => CUT_MODES.includes(v as CutMode);
/* The old round-up value is read as round-down: rounding up cut more than the time missed (s.20). */
const cutModeOf = (v: unknown): CutMode | null => (v === 'TIME_MISSED_ROUNDED' ? 'TIME_MISSED_ROUNDED_DOWN' : isCutMode(v) ? v : null);

/** The rules as they stand, from the settings row (or null when none). */
export function rulesOf(s: { timeRules?: unknown; lateAllowancePerMonth?: number | null; latePenaltyEvery?: number | null } | null | undefined): TimeRules {
  const saved = (s?.timeRules && typeof s.timeRules === 'object' ? s.timeRules : {}) as Saved;
  const d = DEFAULT_TIME_RULES;
  const marksBase = saved.marks ? d.marks : legacyMarks(s);
  const m = saved.marks || {};
  return {
    marks: {
      ...marksBase,
      ...m,
      late: { ...marksBase.late, ...(m.late || {}) },
      early: { ...marksBase.early, ...(m.early || {}) },
      takeFrom: Array.isArray(m.takeFrom) ? m.takeFrom : marksBase.takeFrom,
      /* Saved before the choice existed: a company using late marks was on every N = ½ or 1 day, and stays there. */
      cutMode: cutModeOf(m.cutMode) ?? (saved.marks ? ((m.on ?? marksBase.on) ? 'HALF_DAY_PER_N' : 'TIME_MISSED') : marksBase.cutMode),
      roundToMinutes: m.roundToMinutes === 30 || m.roundToMinutes === 60 ? m.roundToMinutes : 15,
    },
    nudge: { ...d.nudge, ...(saved.nudge || {}) },
    absence: { ...d.absence, ...(saved.absence || {}) },
    night: { ...d.night, ...(saved.night || {}) },
  };
}

export async function timeRulesFor(orgId: string): Promise<TimeRules> {
  return rulesOf(await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { timeRules: true, lateAllowancePerMonth: true, latePenaltyEvery: true } }));
}

/** Merge a change over the rules in force (part by part, field by field). */
export function mergeRules(current: TimeRules, change: z.infer<typeof timeRulesSchema>): TimeRules {
  const m = change.marks || {};
  return {
    marks: {
      ...current.marks,
      ...(m.on !== undefined ? { on: m.on } : {}),
      ...(m.cost !== undefined ? { cost: m.cost } : {}),
      ...(m.takeFrom !== undefined ? { takeFrom: [...new Set(m.takeFrom)] } : {}),
      ...(m.cutMode !== undefined ? { cutMode: m.cutMode } : {}),
      ...(m.roundToMinutes !== undefined ? { roundToMinutes: m.roundToMinutes } : {}),
      late: { ...current.marks.late, ...stripUndefined(m.late || {}) },
      early: { ...current.marks.early, ...stripUndefined(m.early || {}) },
    },
    nudge: { ...current.nudge, ...stripUndefined(change.nudge || {}) },
    absence: { ...current.absence, ...stripUndefined(change.absence || {}) },
    night: { ...current.night, ...stripUndefined(change.night || {}) },
  };
}
const stripUndefined = <T extends Record<string, unknown>>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export class RulesError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

/**
 * Save a change: validated, written with the old two-number rule kept in step (the Attendance app's
 * rules screen shows it), and a version recorded so a month can say which rules it was worked under.
 * Returns the rules and the version number.
 */
/** The first day of the month after this IST day. */
export const nextMonthStart = (day: string) => {
  const [y, m] = day.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};
const monthEnd = (day: string) => {
  const [y, m] = day.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
/** `base` with only what changed from `was` to `now` (late and early field by field). */
export function withChange(base: MarkRules, was: MarkRules, now: MarkRules): MarkRules {
  const out: any = { ...base };
  for (const k of Object.keys(now) as (keyof MarkRules)[]) {
    if (k === 'late' || k === 'early') {
      const part: any = { ...base[k] };
      for (const f of Object.keys(now[k]) as (keyof MarkKind)[]) if (now[k][f] !== was[k][f]) part[f] = now[k][f];
      out[k] = part;
    } else if (JSON.stringify(now[k]) !== JSON.stringify(was[k])) out[k] = now[k];
  }
  return out;
}

/**
 * A change to late marks costs pay, and a month is worked out under the rule of its last day, so a change made on
 * 31 October would rework all of October. By default it takes effect from the next month; `marksFrom: 'THIS_MONTH'`
 * applies it to this month too (the screen warns). Other parts of the rules take effect at once.
 */
export function marksFromOf(body: unknown): 'NEXT_MONTH' | 'THIS_MONTH' {
  const v = (body as any)?.marksFrom;
  if (v === undefined || v === null || v === 'NEXT_MONTH') return 'NEXT_MONTH';
  if (v === 'THIS_MONTH') return 'THIS_MONTH';
  throw new RulesError('A late-mark change takes effect from next month or from this month.');
}

export async function saveTimeRules(accountId: string, orgId: string, userId: string, body: unknown) {
  const when = marksFromOf(body);
  const parsed = timeRulesSchema.safeParse(body);
  if (!parsed.success) throw new RulesError(parsed.error.issues[0]?.message || 'Check the rules.');
  const before = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } });
  const current = rulesOf(before);
  const next = mergeRules(current, parsed.data);
  /* The late-mark rule this month is worked out under, which may differ from the saved one while a next-month change waits. */
  const { marksRulesOn } = await import('./markRules.js');
  const thisMonth = (await marksRulesOn(orgId, monthEnd(istDay()))).marks;
  if (next.marks.takeFrom.length) {
    const types = await peoplePrisma.leaveType.findMany({ where: { orgId, id: { in: next.marks.takeFrom }, isPaid: true }, select: { id: true } });
    if (types.length !== next.marks.takeFrom.length) throw new RulesError('Take penalties only from paid leave types of this company.');
  }
  if (next.night.from === next.night.to) throw new RulesError('The night window needs a start and an end that differ.');
  /* The Attendance app's two numbers follow the late part of the rule (it knows only half a day of loss of pay). */
  /* It knows only "half a day every N": under a time-missed cut it reads 0 (no step rule), so it never shows a rule that is not in force. */
  const legacy = next.marks.on && next.marks.late.on && next.marks.cutMode === 'HALF_DAY_PER_N' ? { latePenaltyEvery: next.marks.late.every, lateAllowancePerMonth: next.marks.late.free } : { latePenaltyEvery: 0, lateAllowancePerMonth: before?.lateAllowancePerMonth ?? 0 };
  await peoplePrisma.attendanceSettings.upsert({
    where: { orgId },
    create: { accountId, orgId, timeRules: next as any, ...legacy, updatedByUserId: userId },
    update: { timeRules: next as any, ...legacy, updatedByUserId: userId },
  });
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  const marksChanged = JSON.stringify(current.marks) !== JSON.stringify(next.marks);
  const from = marksChanged && when === 'NEXT_MONTH' ? nextMonthStart(istDay()) : null;
  let v: Awaited<ReturnType<typeof recordRuleVersion>> = null;
  if (changed && marksChanged && when === 'THIS_MONTH' && JSON.stringify(thisMonth) !== JSON.stringify(current.marks)) {
    /* A next-month change is waiting: this month gets only this change, next month gets both (markRules.ts marksRulesOn). */
    await recordRuleVersion(accountId, orgId, userId, { kind: 'RULES', name: 'Attendance rules', before: { ...current, marks: thisMonth }, after: { ...next, marks: withChange(thisMonth, current.marks, next.marks) } });
    v = await recordRuleVersion(accountId, orgId, userId, { kind: 'RULES', name: 'Attendance rules', before: current, after: next, from: nextMonthStart(istDay()) });
  } else if (changed) {
    v = await recordRuleVersion(accountId, orgId, userId, { kind: 'RULES', name: 'Attendance rules', before: current, after: next, ...(from ? { from } : {}) });
  }
  return { rules: next, version: v?.version ?? (await currentRuleVersion(orgId)), marksFrom: from };
}

/** The latest saved rule version (0 before any). */
export async function currentRuleVersion(orgId: string) {
  return (await peoplePrisma.attendanceRuleVersion.findFirst({ where: { orgId }, orderBy: { version: 'desc' }, select: { version: true } }))?.version ?? 0;
}

/** When the Attendance app saves its two numbers, the marks rule follows them, so the two screens never disagree. */
export function marksFromLegacy(current: TimeRules, legacy: { lateAllowancePerMonth: number; latePenaltyEvery: number }): TimeRules {
  const every = Math.max(0, legacy.latePenaltyEvery || 0);
  const m = current.marks;
  /* 0 = no late penalty: late marks stop costing anything; early exits keep their own switch. */
  if (!every) return { ...current, marks: { ...m, on: m.on && m.early.on, late: { ...m.late, on: false } } };
  /* Numbers only: the cut stays what People's Attendance rules say (the Attendance app is told it as lateCutMode). */
  return { ...current, marks: { ...m, on: true, late: { ...m.late, on: true, every, free: Math.max(0, legacy.lateAllowancePerMonth || 0) } } };
}

// ---------------------------------------------------------------------------
// The night window
// ---------------------------------------------------------------------------

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Whether a shift touches the night window. The window runs from `from` to `to` the next morning
 * (19:00 to 06:00 by default); a shift ending at or before its start ends the next day. Touching
 * means any minute inside: a 14:00–22:00 shift touches 19:00–06:00, a 06:00–14:00 one does not.
 */
export function touchesNight(shift: { startTime: string; endTime: string }, night: Pick<NightRules, 'from' | 'to'>): boolean {
  const s = minutesOf(shift.startTime);
  let e = minutesOf(shift.endTime);
  if (e <= s) e += 1440;
  const wFrom = minutesOf(night.from);
  let wTo = minutesOf(night.to);
  if (wTo <= wFrom) wTo += 1440;
  /* The window of the evening before, of this evening, and of the next: a shift spans at most two days. */
  for (const shiftBy of [-1440, 0, 1440]) {
    if (s < wTo + shiftBy && e > wFrom + shiftBy) return true;
  }
  return false;
}

/** "7 pm to 6 am", for messages. */
export const nightWords = (night: Pick<NightRules, 'from' | 'to'>) => `${clock(night.from)} to ${clock(night.to)}`;
const clock = (hhmm: string) => {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m === '00' ? `${h12} ${ampm}` : `${h12}:${m} ${ampm}`;
};
