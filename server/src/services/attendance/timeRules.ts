import { z } from 'zod';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { recordRuleVersion } from './ruleVersions.js';
import { isHHMM } from './compute.js';

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
export type MarkRules = { on: boolean; late: MarkKind; early: MarkKind; cost: 0.5 | 1; takeFrom: string[] };
export type NudgeRules = { on: boolean; afterHours: number; managerDigest: boolean };
export type AbsenceRules = { on: boolean; days: number; noticeGapDays: number; replyDays: number };
/** ENFORCE: a night shift is refused without consent. WARN: it is saved, and who lacks consent is listed (People Home, Night work). */
export type NightRules = { on: boolean; from: string; to: string; mode: 'ENFORCE' | 'WARN' };
export type TimeRules = { marks: MarkRules; nudge: NudgeRules; absence: AbsenceRules; night: NightRules };

export const DEFAULT_TIME_RULES: TimeRules = {
  marks: { on: false, late: { on: true, graceMinutes: null, every: 3, free: 0 }, early: { on: false, graceMinutes: null, every: 3, free: 0 }, cost: 0.5, takeFrom: [] },
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
  return { ...DEFAULT_TIME_RULES.marks, on: every > 0, late: { on: true, graceMinutes: null, every: every || 3, free: Math.max(0, s?.lateAllowancePerMonth || 0) } };
};

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
export async function saveTimeRules(accountId: string, orgId: string, userId: string, body: unknown) {
  const parsed = timeRulesSchema.safeParse(body);
  if (!parsed.success) throw new RulesError(parsed.error.issues[0]?.message || 'Check the rules.');
  const before = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId } });
  const current = rulesOf(before);
  const next = mergeRules(current, parsed.data);
  if (next.marks.takeFrom.length) {
    const types = await peoplePrisma.leaveType.findMany({ where: { orgId, id: { in: next.marks.takeFrom }, isPaid: true }, select: { id: true } });
    if (types.length !== next.marks.takeFrom.length) throw new RulesError('Take penalties only from paid leave types of this company.');
  }
  if (next.night.from === next.night.to) throw new RulesError('The night window needs a start and an end that differ.');
  /* The Attendance app's two numbers follow the late part of the rule (it knows only half a day of loss of pay). */
  const legacy = next.marks.on && next.marks.late.on ? { latePenaltyEvery: next.marks.late.every, lateAllowancePerMonth: next.marks.late.free } : { latePenaltyEvery: 0, lateAllowancePerMonth: before?.lateAllowancePerMonth ?? 0 };
  await peoplePrisma.attendanceSettings.upsert({
    where: { orgId },
    create: { accountId, orgId, timeRules: next as any, ...legacy, updatedByUserId: userId },
    update: { timeRules: next as any, ...legacy, updatedByUserId: userId },
  });
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  const v = changed ? await recordRuleVersion(accountId, orgId, userId, { kind: 'RULES', name: 'Attendance rules', before: current, after: next }) : null;
  return { rules: next, version: v?.version ?? (await currentRuleVersion(orgId)) };
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
