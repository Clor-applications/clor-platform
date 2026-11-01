import { z } from 'zod';

import { peoplePrisma, peopleWrite, afterPeopleCommit } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { ISO_DATE, closedMonthRefusal, daysBetween, employeeIn, fail, instants, isHoliday, shiftFor, today, withNames, writeDay } from './days.js';
import { isHHMM, isOvernight, isWeeklyOff } from './compute.js';
import { loadSchedule, resolveShift } from './schedule.js';
import { assertScheduleOpen } from './scheduleGuard.js';
import { assertNightConsent } from '../people/nightConsent.js';
import { recomputeDeviceDay } from './punches.js';
import { nightShiftsOn, timesOn } from './nightShift.js';
import { CHAINS, activeManagerOf, chainFor, hrChain, type Chain } from './approvalChain.js';
import { deciderFor, managerStepBy, standingInFor } from './standIns.js';
import { REASON_CODES } from './corrections.js';
import { selfDecisionAllowed } from '../makerChecker.js';
import { emit as emitWebhook } from './webhooks.js';
import { retireNotices, sendNotice, usersWithPermission } from '../notifications.js';
import { choicesFor } from '../people/companyChoices.js';
import { approverUsers, queueNotice, revisionOf } from './notices.js';
import { resolveAccess } from '../access.js';
import { inScope, teamScope, type TeamScope } from '../people/scope.js';
import { isFeatureEnabled } from '../features.js';
import { addDays } from '../../utils/istDate.js';

/**
 * Attendance requests (TIME-LEAVE-DECISIONS.md, advanced build): four kinds on
 * one list and one approval. A missed punch is the correction as before; work
 * from home and on duty mark the day present with its kind on the record,
 * never leave; permission is a few hours off, excused on the day. Each kind
 * has a monthly quota and a back-date window in Settings → Request rules;
 * the employee app shows used and left. One queue for HR and for managers.
 */
export const KINDS = ['MISSED_PUNCH', 'WFH', 'ON_DUTY', 'PERMISSION', 'SHIFT_CHANGE'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_WORDS: Record<Kind, { name: string; unit: string }> = {
  MISSED_PUNCH: { name: 'Missed punch', unit: 'missed-punch requests' },
  WFH: { name: 'Work from home', unit: 'work-from-home days' },
  ON_DUTY: { name: 'On duty', unit: 'on-duty days' },
  PERMISSION: { name: 'Permission', unit: 'permission hours' },
  SHIFT_CHANGE: { name: 'Shift change', unit: 'shift-change days' },
};
const MAX_SPAN_DAYS = 14;
/* A shift change is often for a month (a night rotation, a project): up to 31 days in one request. */
const MAX_SHIFT_DAYS = 31;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type Rule = { on: boolean; quotaPerMonth: number | null; hoursPerMonth: number | null; maxMinutes: number; backDays: number; approval: Chain | null };
/** `approval` null = the company's correction chain (Attendance rules); a kind may have its own. */
export const DEFAULT_RULES: Record<Kind, Rule> = {
  MISSED_PUNCH: { on: true, quotaPerMonth: 3, hoursPerMonth: null, maxMinutes: 0, backDays: 30, approval: null },
  WFH: { on: false, quotaPerMonth: 4, hoursPerMonth: null, maxMinutes: 0, backDays: 7, approval: null },
  ON_DUTY: { on: false, quotaPerMonth: null, hoursPerMonth: null, maxMinutes: 0, backDays: 7, approval: null },
  PERMISSION: { on: false, quotaPerMonth: null, hoursPerMonth: 4, maxMinutes: 120, backDays: 7, approval: null },
  /* Days still to come: a shift is planned, not corrected after the fact (HR entering it may go back). */
  SHIFT_CHANGE: { on: false, quotaPerMonth: null, hoursPerMonth: null, maxMinutes: 0, backDays: 0, approval: null },
};

const ruleSchema = z.object({
  on: z.boolean().optional(),
  quotaPerMonth: z.coerce.number().int().min(0).max(31).nullable().optional(),
  hoursPerMonth: z.coerce.number().min(0).max(200).nullable().optional(),
  maxMinutes: z.coerce.number().int().min(15).max(480).optional(),
  backDays: z.coerce.number().int().min(0).max(366).optional(),
  approval: z.enum(CHAINS as [Chain, ...Chain[]]).nullable().optional(),
});
export const rulesSchema = z.object({ MISSED_PUNCH: ruleSchema, WFH: ruleSchema, ON_DUTY: ruleSchema, PERMISSION: ruleSchema, SHIFT_CHANGE: ruleSchema }).partial();

/** The company's request rules: what is saved over the defaults, kind by kind. */
export async function rulesFor(orgId: string): Promise<Record<Kind, Rule>> {
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { requestRules: true } });
  const saved = (s?.requestRules && typeof s.requestRules === 'object' ? s.requestRules : {}) as Partial<Record<Kind, Partial<Rule>>>;
  return Object.fromEntries(KINDS.map((k) => [k, { ...DEFAULT_RULES[k], ...(saved[k] || {}) }])) as Record<Kind, Rule>;
}

export async function saveRules(accountId: string, orgId: string, userId: string, body: unknown) {
  const parsed = rulesSchema.safeParse(body);
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message || 'Invalid rules.');
  const current = await rulesFor(orgId);
  const next = Object.fromEntries(KINDS.map((k) => [k, { ...current[k], ...(parsed.data[k] || {}) }])) as Record<Kind, Rule>;
  await peoplePrisma.attendanceSettings.upsert({ where: { orgId }, create: { accountId, orgId, requestRules: next, updatedByUserId: userId }, update: { requestRules: next, updatedByUserId: userId } });
  return next;
}

/** The shifts a person may ask to change to: every shift in use, with its hours (for the shift change form); none while shift changes are off. */
export async function shiftChoices(orgId: string, rules?: Record<Kind, Rule>) {
  if (!(rules || (await rulesFor(orgId))).SHIFT_CHANGE.on) return [];
  return peoplePrisma.shift.findMany({ where: { orgId, isActive: true }, select: { id: true, name: true, startTime: true, endTime: true }, orderBy: { name: 'asc' } });
}

export const chainOf = async (orgId: string, kind: Kind, rules?: Record<Kind, Rule>): Promise<Chain> => (rules || (await rulesFor(orgId)))[kind].approval || chainFor(orgId, 'correction');

// ---------------------------------------------------------------------------
// Words and small helpers
// ---------------------------------------------------------------------------

export const dayWords = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)} ${d.slice(0, 4)}`;
const monthWords = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]}${month.slice(0, 4) === today().slice(0, 4) ? '' : ` ${month.slice(0, 4)}`}`;
const spanWords = (r: { date: string; toDate?: string | null }) => (!r.toDate || r.toDate === r.date ? dayWords(r.date) : `${dayWords(r.date)} to ${dayWords(r.toDate)}`);
const hoursWords = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} ${h === 1 ? 'hour' : 'hours'}` : '', m ? `${m} minutes` : ''].filter(Boolean).join(' ');
};
const round = (n: number) => Math.round(n * 100) / 100;
type Employee = { id: string; branchId: string | null; areaId?: string | null; name?: string | null };
type HistoryEntry = { at: string; by: string; what: string; note?: string | null; from?: Record<string, unknown>; to?: Record<string, unknown> };
/* Typed loosely on purpose: Prisma's Json input wants a plain array, not an interface. */
const pushHistory = (h: unknown, entry: Omit<HistoryEntry, 'at'>): any[] => [...(Array.isArray(h) ? h : []), { at: new Date().toISOString(), ...entry }];

/** The dates among these the person is expected at work: not a weekly off (their shift or the working week), not a holiday. */
export async function workingDates(orgId: string, employee: Employee, dates: string[]) {
  const out: string[] = [];
  for (const date of dates) {
    const { rule } = await shiftFor(orgId, employee.id, date);
    if (isWeeklyOff(rule, date)) continue;
    /* The person's own picked restricted holidays count as holidays too. */
    if (await isHoliday(orgId, date, employee.branchId, employee.areaId ?? null, employee.id)) continue;
    out.push(date);
  }
  return out;
}

/** An audit row for request actions; the employee app has no CLOR request behind it, so the service writes them all. */
export async function requestAudit(who: { accountId: string; orgId: string; userId: string }, entry: { entityId: string; action: string; message: string; metadata?: Record<string, unknown> }) {
  try {
    await platformPrisma.auditLog.create({ data: { accountId: who.accountId, orgId: who.orgId, branchId: '', entity: 'AttendanceRequest', entityId: entry.entityId, action: entry.action, message: entry.message.slice(0, 500), metadata: entry.metadata ? JSON.stringify(entry.metadata).slice(0, 20_000) : null, createdByUserId: who.userId, correlationId: null } });
  } catch (e) {
    console.error('[attendance requests] audit not recorded:', e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// Usage against the month's quota
// ---------------------------------------------------------------------------

/** What one request counts for in a month: days of WFH / on duty (working days only, a half day 0.5), one per missed punch, hours of permission. */
async function amountOf(orgId: string, employee: Employee, r: { kind: string; date: string; toDate: string | null; halfDay: string | null; minutes: number | null }, month: string) {
  if (r.kind === 'MISSED_PUNCH') return 1;
  if (r.kind === 'PERMISSION') return (r.minutes || 0) / 60;
  /* A shift change counts every day it covers: the new shift has its own days off. */
  if (r.kind === 'SHIFT_CHANGE') return daysBetween(r.date, r.toDate || r.date).filter((d) => d.slice(0, 7) === month).length;
  if (r.halfDay) return 0.5;
  const dates = daysBetween(r.date, r.toDate || r.date).filter((d) => d.slice(0, 7) === month);
  return (await workingDates(orgId, employee, dates)).length;
}

export async function usage(orgId: string, employeeId: string, kind: Kind, month: string, opts: { except?: string | null; rules?: Record<Kind, Rule> } = {}) {
  const rule = (opts.rules || (await rulesFor(orgId)))[kind];
  const employee = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, branchId: true, areaId: true } });
  const rows = employee
    ? await peoplePrisma.attendanceRequest.findMany({
        where: { orgId, employeeId, kind, status: { in: ['PENDING', 'APPROVED'] }, date: { lte: `${month}-31` }, ...(opts.except ? { id: { not: opts.except } } : {}), OR: [{ toDate: null, date: { gte: `${month}-01` } }, { toDate: { gte: `${month}-01` } }] },
      })
    : [];
  let used = 0;
  let pending = 0;
  for (const r of rows) {
    const n = await amountOf(orgId, employee!, r, month);
    if (r.status === 'APPROVED') used += n;
    else pending += n;
  }
  const quota = kind === 'PERMISSION' ? rule.hoursPerMonth : rule.quotaPerMonth;
  const unit = kind === 'PERMISSION' ? 'hours' : kind === 'MISSED_PUNCH' ? 'requests' : 'days';
  return {
    kind, month, unit, used: round(used), pending: round(pending), quota,
    left: quota == null ? null : Math.max(0, round(quota - used - pending)),
    ...(kind === 'PERMISSION' ? { hoursUsed: round(used + pending) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Asking, editing
// ---------------------------------------------------------------------------

const askSchema = z.object({
  kind: z.enum(KINDS).default('MISSED_PUNCH'),
  date: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  toDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.').optional().nullable(),
  halfDay: z.enum(['FIRST', 'SECOND']).optional().nullable(),
  place: z.string().trim().max(120).optional().nullable(),
  shiftId: z.string().trim().max(60).optional().nullable(),
  checkIn: z.string().refine(isHHMM, 'Times are HH:MM, 24-hour.').optional().nullable(),
  checkOut: z.string().refine(isHHMM, 'Times are HH:MM, 24-hour.').optional().nullable(),
  reason: z.string().trim().min(3, 'Say why.').max(500),
  reasonCode: z.enum(REASON_CODES).optional().nullable(),
});
type Ask = z.infer<typeof askSchema>;
export type Asker = { accountId: string; orgId: string; userId: string; /** HR entering it for someone: not held to the back-date window. */ onBehalf: boolean };

/**
 * Everything checked before a request is saved or changed: the kind is on, the
 * dates make sense, it is not too far back, nothing open overlaps it, the
 * person is not on leave then, and the month's quota holds it. `existing` is
 * the request being edited, left out of the overlap and the quota.
 */
async function validate(who: Asker, employee: Employee, b: Ask, rules: Record<Kind, Rule>, existing: { id: string } | null) {
  const kind = b.kind;
  const rule = rules[kind];
  const name = KIND_WORDS[kind].name;
  if (!rule.on) throw fail(400, `${name} requests are not switched on for this company.`, 'KIND_OFF');
  const t = today();
  let toDate: string | null = null;
  let minutes: number | null = null;
  let checkIn: Date | null = null;
  let checkOut: Date | null = null;
  /* Times after midnight on a night shift are that night's (feature attendanceNightShifts); off, as they always were. */
  const at = async (inHHMM: string, outHHMM: string | null) => {
    const { rule: shift } = await shiftFor(who.orgId, employee.id, b.date);
    if (isOvernight(shift) && (await nightShiftsOn(who.orgId, who.accountId))) return timesOn(b.date, shift, true, inHHMM, outHHMM);
    return instants(b.date, inHHMM, outHHMM);
  };
  if (kind === 'MISSED_PUNCH') {
    if (!b.checkIn) throw fail(400, 'Give the time you came in, HH:MM.');
    if (b.date > t) throw fail(400, 'A correction is for a day that has happened.');
    ({ checkIn, checkOut } = await at(b.checkIn, b.checkOut || null));
  }
  if (kind === 'WFH' || kind === 'ON_DUTY') {
    toDate = b.toDate || b.date;
    if (toDate < b.date) throw fail(400, 'The end is before the start.');
    if (daysBetween(b.date, toDate).length > MAX_SPAN_DAYS) throw fail(400, `Up to ${MAX_SPAN_DAYS} days in one request.`);
    if (b.halfDay && toDate !== b.date) throw fail(400, 'A half day is one day; give one date.');
    if (kind === 'ON_DUTY' && !b.place) throw fail(400, 'Where will you be? Give the place.');
  }
  let shiftId: string | null = null;
  if (kind === 'SHIFT_CHANGE') {
    toDate = b.toDate || b.date;
    if (toDate < b.date) throw fail(400, 'The end is before the start.');
    if (daysBetween(b.date, toDate).length > MAX_SHIFT_DAYS) throw fail(400, `Up to ${MAX_SHIFT_DAYS} days in one request.`);
    if (!b.shiftId) throw fail(400, 'Choose the shift you want to work.');
    const shift = await peoplePrisma.shift.findFirst({ where: { id: b.shiftId, orgId: who.orgId, isActive: true }, select: { id: true, name: true } });
    if (!shift) throw fail(400, 'That shift is not in use in this company.');
    /* Asking for the shift already worked on every one of those days changes nothing. */
    const schedule = await loadSchedule(who.orgId, [employee.id]);
    const differs = daysBetween(b.date, toDate).some((d) => resolveShift(schedule, employee.id, d).shiftId !== shift.id);
    if (!differs) throw fail(400, `${shift.name} is already the shift on those days.`, 'SAME_SHIFT');
    /* A woman asking for a shift into the night needs her consent on file (OSH Code s.43). */
    await assertNightConsent(who.orgId, [{ employeeId: employee.id, shiftIds: [shift.id] }], { self: !who.onBehalf });
    shiftId = shift.id;
  }
  if (kind === 'PERMISSION') {
    if (!b.checkIn || !b.checkOut) throw fail(400, 'Give the hours: from and to, HH:MM.');
    ({ checkIn, checkOut } = await at(b.checkIn, b.checkOut));
    minutes = Math.round((checkOut!.getTime() - checkIn!.getTime()) / 60_000);
    if (minutes < 15 || minutes > rule.maxMinutes) throw fail(400, `A permission is between 15 minutes and ${hoursWords(rule.maxMinutes)}.`);
  }
  /* A closed Attendance month: refused now, not left waiting for an approval that can never happen (O-09). */
  const shut = await closedMonthRefusal(who.orgId, daysBetween(b.date, toDate || b.date), 'request');
  if (shut) throw shut;
  if (!who.onBehalf && b.date < addDays(t, -rule.backDays)) throw fail(400, `${name} requests go back ${rule.backDays} days at most; ask HR for older days.`, 'TOO_OLD');
  const span = { date: b.date, toDate };
  const last = toDate || b.date;
  if (kind !== 'MISSED_PUNCH') {
    /* A second correction on one day happens (in, then out); a second WFH does not. */
    const open = await peoplePrisma.attendanceRequest.findFirst({
      where: { orgId: who.orgId, employeeId: employee.id, kind, status: { in: ['PENDING', 'APPROVED'] }, date: { lte: last }, ...(existing ? { id: { not: existing.id } } : {}), OR: [{ toDate: null, date: { gte: b.date } }, { toDate: { gte: b.date } }] },
    });
    if (open) throw fail(409, `You already have a ${name.toLowerCase()} request for ${spanWords(open)}.`, 'OVERLAP');
  }
  /* Leave on a day does not stop the shift changing around it; it stops work from home or on duty. */
  if (kind !== 'MISSED_PUNCH' && kind !== 'SHIFT_CHANGE') {
    const leave = await peoplePrisma.leaveRequest.findFirst({ where: { orgId: who.orgId, employeeId: employee.id, status: 'APPROVED', fromDate: { lte: last }, toDate: { gte: b.date } }, select: { fromDate: true, toDate: true } });
    if (leave) throw fail(409, `There is approved leave on ${leave.fromDate === leave.toDate ? dayWords(leave.fromDate) : `${dayWords(leave.fromDate)} to ${dayWords(leave.toDate)}`}; cancel the leave first.`, 'ON_LEAVE');
  }
  let need = 1;
  if (kind === 'WFH' || kind === 'ON_DUTY') {
    const working = await workingDates(who.orgId, employee, daysBetween(b.date, last));
    if (!working.length) throw fail(400, 'Those days are weekly offs or holidays; nothing to ask for.');
    need = b.halfDay ? 0.5 : working.length;
  }
  if (kind === 'PERMISSION') need = (minutes || 0) / 60;
  if (kind === 'SHIFT_CHANGE') need = daysBetween(b.date, last).length;
  /* A span over a month end is checked against each month's quota, with the days that fall in it. */
  const spanDays = kind === 'WFH' || kind === 'ON_DUTY' ? await workingDates(who.orgId, employee, daysBetween(b.date, last)) : kind === 'SHIFT_CHANGE' ? daysBetween(b.date, last) : [];
  const months = [...new Set((spanDays.length ? spanDays : [b.date]).map((d) => d.slice(0, 7)))];
  for (const month of months) {
    const needHere = kind === 'WFH' || kind === 'ON_DUTY' || kind === 'SHIFT_CHANGE' ? (b.halfDay && kind !== 'SHIFT_CHANGE' ? 0.5 : spanDays.filter((d) => d.slice(0, 7) === month).length) : need;
    if (!needHere) continue;
    /* The month's limit on missed punches holds the person, not HR entering one for them (WORKFLOW-GAP-RESEARCH 4.4.5). */
    if (who.onBehalf && kind === 'MISSED_PUNCH') continue;
    const u = await usage(who.orgId, employee.id, kind, month, { except: existing?.id, rules });
    if (u.quota == null) continue;
    const unit = KIND_WORDS[kind].unit;
    if (u.left! <= 0) throw fail(409, `You have used your ${u.quota} ${unit} for ${monthWords(u.month)}.`, 'QUOTA');
    if (needHere > u.left!) throw fail(409, `Only ${u.left} of your ${u.quota} ${unit} ${u.left === 1 ? 'is' : 'are'} left for ${monthWords(u.month)}.`, 'QUOTA');
  }
  return {
    kind, date: b.date, toDate: kind === 'WFH' || kind === 'ON_DUTY' || kind === 'SHIFT_CHANGE' ? (toDate === b.date ? null : toDate) : null,
    shiftId,
    halfDay: kind === 'WFH' || kind === 'ON_DUTY' ? b.halfDay || null : null,
    place: kind === 'ON_DUTY' ? b.place || null : null,
    minutes, checkIn, checkOut, reason: b.reason, reasonCode: kind === 'MISSED_PUNCH' ? b.reasonCode ?? null : null,
    span,
  };
}

const parseAsk = (body: unknown, kind?: Kind) => {
  const parsed = askSchema.safeParse({ ...(body && typeof body === 'object' ? body : {}), ...(kind ? { kind } : {}) });
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message || 'Invalid request.');
  return parsed.data;
};

export async function askRequest(who: Asker, employee: Employee, body: unknown) {
  const b = parseAsk(body);
  const rules = await rulesFor(who.orgId);
  /*
   * The request and its notice commit together (closure audit O-07), and the
   * overlap and monthly-quota checks run under the same lock as the insert,
   * as createLeave does: checked outside it, a double tap passed both checks
   * twice and saved two requests, or went past the month's quota.
   */
  let v!: Awaited<ReturnType<typeof validate>>;
  const row = await peopleWrite(who.orgId, async () => {
    v = await validate(who, employee, b, rules, null);
    /* The day as it stands now, so whoever reviews sees what would change. */
    const current = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: b.date } } });
    const { span: _span, ...data } = v;
    const created = await peoplePrisma.attendanceRequest.create({
      data: {
        accountId: who.accountId, orgId: who.orgId, employeeId: employee.id, ...data,
        beforeCheckIn: current?.checkIn ?? null, beforeCheckOut: current?.checkOut ?? null, beforeStatus: current?.status ?? null,
        requestedByUserId: who.userId,
        history: pushHistory([], { by: who.userId, what: 'ASKED' }),
      },
    });
    await queueRequestNotice(created);
    return created;
  });
  await requestAudit(who, { entityId: row.id, action: 'CREATE', message: `${who.onBehalf ? `Entered ${KIND_WORDS[b.kind].name.toLowerCase()} for ${employee.name || 'an employee'}` : `${employee.name || 'An employee'} asked for ${KIND_WORDS[b.kind].name.toLowerCase()}`}, ${spanWords(v.span)}`, metadata: { employeeId: employee.id, kind: b.kind, date: b.date, toDate: v.toDate } });
  return row;
}

/** Change a waiting request; the manager's step, if taken, is reset so they see the new dates. */
export async function editRequest(who: Asker, asRead: any, body: unknown) {
  if (asRead.status !== 'PENDING') throw fail(409, 'Only a waiting request can be changed.');
  const employee = await employeeIn(who.orgId, who.accountId, asRead.employeeId);
  const b = parseAsk({ ...(body && typeof body === 'object' ? body : {}), reasonCode: (body as any)?.reasonCode === undefined ? asRead.reasonCode : (body as any).reasonCode }, asRead.kind as Kind);
  const rules = await rulesFor(who.orgId);
  const fields = ['date', 'toDate', 'halfDay', 'place', 'shiftId', 'minutes', 'checkIn', 'checkOut', 'reason', 'reasonCode'] as const;
  /* Checked under the lock with the write, as askRequest: two edits at once cannot both pass the overlap or quota check. */
  let r: any = asRead;
  let changed: Array<(typeof fields)[number]> = [];
  let from: Record<string, unknown> = {};
  let to: Record<string, unknown> = {};
  const row = await peopleWrite(who.orgId, async () => {
    r = await peoplePrisma.attendanceRequest.findFirst({ where: { id: asRead.id, orgId: who.orgId } });
    if (!r || r.status !== 'PENDING') throw fail(409, 'Only a waiting request can be changed.');
    const v = await validate(who, employee, b, rules, r);
    const { span: _span, ...data } = v;
    changed = fields.filter((k) => String((data as any)[k] instanceof Date ? (data as any)[k].getTime() : (data as any)[k] ?? '') !== String(r[k] instanceof Date ? r[k].getTime() : r[k] ?? ''));
    if (!changed.length) return null;
    from = Object.fromEntries(changed.map((k) => [k, r[k]]));
    to = Object.fromEntries(changed.map((k) => [k, (data as any)[k]]));
    /* Only the reason: nothing the approver decides on moved, so the manager's step stands and nobody is asked again (closure audit O-07). */
    const reasonOnly = changed.every((k) => k === 'reason');
    const updated = await peoplePrisma.attendanceRequest.update({
      where: { id: r.id },
      data: reasonOnly
        ? { reason: data.reason, history: pushHistory(r.history, { by: who.userId, what: 'REASON_EDITED' }) }
        : { ...data, managerApprovedAt: null, managerApprovedById: null, managerNote: null, history: pushHistory(r.history, { by: who.userId, what: 'EDITED', from, to }) },
    });
    /* Back to the start of the chain: whoever decides first hears of it again. */
    if (!reasonOnly && r.managerApprovedAt) await queueRequestNotice(updated);
    return updated;
  });
  if (!row) return r;
  await requestAudit(who, { entityId: r.id, action: 'UPDATE', message: `${KIND_WORDS[r.kind as Kind].name} request for ${employee.name} changed: ${changed.join(', ')}`, metadata: { employeeId: r.employeeId, from, to } });
  return row;
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

export type Decider = { userId: string; /** The employee file of whoever decides, when they have one: lets them take the manager's step (or stand in). */ managerId?: string | null; /** Whole-company scope: HR's step under manager-then-HR needs it. */ scopeAll: boolean };

/**
 * The decision on a request, from People or the employee app — one function,
 * so the two never drift. Under manager-then-HR the manager (or their
 * stand-in) takes the first step and the request stays waiting; HR, someone
 * else with company-wide scope, takes the second. Approving writes the days.
 */
export async function decideRequest(accountId: string, orgId: string, r: any, approve: boolean, by: Decider, note: string | null): Promise<{ request: any; stage?: 'HR' }> {
  if (r.status !== 'PENDING') throw fail(409, `This request was already ${String(r.status).toLowerCase()}.`);
  /* Nobody decides their own request: not HR, not the owner, not a manager or stand-in (closure audit, 27 Oct 2026). */
  const subject = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { userId: true } });
  const ownByLogin = Boolean(subject?.userId && subject.userId === by.userId);
  if ((by.managerId && by.managerId === r.employeeId && !ownByLogin) || (ownByLogin && !(await selfDecisionAllowed(accountId, orgId, by.userId, 'ATTENDANCE::Attendance Requests::APPROVE')).allowed)) {
    throw fail(403, 'This is your own request; somebody else has to decide it. You can change or withdraw it.', 'OWN_RECORD');
  }
  /* Allowed only by the company's setting, or because nobody else can decide it (a one-person company): said so in the audit log. */
  if (ownByLogin) await requestAudit({ accountId, orgId, userId: by.userId }, { entityId: r.id, action: 'SELF_APPROVED', message: 'Decided by the person it is about: nobody else in the company can, or the company allows it', metadata: { employeeId: r.employeeId } });
  const kind = r.kind as Kind;
  const name = KIND_WORDS[kind].name;
  const chain = await chainOf(orgId, kind);
  /* HR only (the company's choice): a manager or team-scoped approver sees it but does not decide it. */
  if (chain === 'HR_ONLY' && !by.scopeAll) throw fail(403, 'HR decides these requests in this company; you can see it, not decide it.', 'HR_ONLY');
  const manager = hrChain(chain) ? null : await activeManagerOf(orgId, r.employeeId);
  const asManager = by.managerId && manager ? await managerStepBy(orgId, by.managerId, r.employeeId, undefined, 'ATTENDANCE') : null;
  const who = { accountId, orgId, userId: by.userId };
  if (approve && chain === 'MANAGER_THEN_HR' && manager) {
    if (!r.managerApprovedAt) {
      if (!asManager) throw fail(409, `${manager.name || 'Their manager'} has not approved this yet; the company asks for the manager first.`, 'MANAGER_FIRST');
      const row = await peopleWrite(orgId, async () => {
        const changed = await peoplePrisma.attendanceRequest.updateMany({
          where: { id: r.id, status: 'PENDING', managerApprovedAt: null },
          data: { managerApprovedAt: new Date(), managerApprovedById: by.managerId!, managerNote: note, history: pushHistory(r.history, { by: by.userId, what: 'MANAGER_APPROVED', note }) },
        });
        if (!changed.count) throw fail(409, 'This request is no longer waiting for the manager.');
        const stepped = await peoplePrisma.attendanceRequest.findFirstOrThrow({ where: { id: r.id } });
        await queueRequestNotice(stepped);
        return stepped;
      });
      await requestAudit(who, { entityId: r.id, action: 'MANAGER_APPROVE', message: `Manager approved ${name.toLowerCase()} request, ${spanWords(r)}; now with HR`, metadata: { employeeId: r.employeeId, kind } });
      return { request: row, stage: 'HR' };
    }
    /* HR's step is a second pair of eyes: not the manager who took the first, and someone who decides for the whole company. */
    const firstBy = r.managerApprovedById ? await peoplePrisma.employee.findFirst({ where: { id: r.managerApprovedById, orgId }, select: { id: true, userId: true } }) : null;
    const samePerson = Boolean(firstBy && ((by.managerId && by.managerId === firstBy.id) || (firstBy.userId && firstBy.userId === by.userId)));
    if (samePerson || !by.scopeAll) throw fail(403, 'HR approves after the manager; the manager cannot take both steps.', 'HR_STEP');
  }
  /* Once the manager has passed it to HR, it is HR's to decide either way: not the manager's again, nor a team-scoped approver's (as leave, routes/leave.ts reviewLeave). */
  if (!approve && chain === 'MANAGER_THEN_HR' && r.managerApprovedAt) {
    const firstBy = r.managerApprovedById ? await peoplePrisma.employee.findFirst({ where: { id: r.managerApprovedById, orgId }, select: { id: true, userId: true } }) : null;
    const samePerson = Boolean(firstBy && ((by.managerId && by.managerId === firstBy.id) || (firstBy.userId && firstBy.userId === by.userId)));
    if (samePerson || !by.scopeAll) throw fail(403, 'The manager has passed this to HR; HR decides it now.', 'HR_STEP');
  }
  /* A refusal says why: the person reads it in the employee app. Corrections keep their old manners. */
  if (!approve && kind !== 'MISSED_PUNCH' && !note) throw fail(400, 'Say why. They see this with the decision.');
  const history = pushHistory(r.history, { by: by.userId, what: approve ? 'APPROVED' : 'REJECTED', note });
  /*
   * One transaction for every kind, claimed by status: the decision, the day
   * it writes and the history line commit together or not at all, and two
   * people deciding at once cannot both write the day (closure audit,
   * 27 Oct 2026: a missed punch was three separate writes with no claim).
   */
  const row = await peopleWrite(orgId, async () => {
    const changed = await peoplePrisma.attendanceRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedByUserId: by.userId, reviewedAt: new Date(), reviewNote: note, history } });
    if (!changed.count) throw fail(409, 'This request was already decided.');
    if (approve && kind === 'MISSED_PUNCH') {
      const employee = await employeeIn(orgId, accountId, r.employeeId);
      await writeDay({ accountId, orgId, userId: by.userId, employee, date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, source: 'REQUEST', reason: `Correction approved: ${r.reason}` });
    } else if (approve) {
      await applyApproved(accountId, orgId, r, by.userId, note);
    }
    const decided = await peoplePrisma.attendanceRequest.findFirstOrThrow({ where: { id: r.id } });
    await queueRequestNotice(decided);
    return decided;
  });
  if (approve && kind === 'MISSED_PUNCH') afterPeopleCommit(() => emitWebhook(orgId, 'correction.approved', { id: row.id, employeeId: row.employeeId, date: row.date, checkIn: row.checkIn, checkOut: row.checkOut, reason: row.reason ?? null, reviewNote: row.reviewNote }));
  await requestAudit(who, { entityId: r.id, action: approve ? 'APPROVE' : 'REJECT', message: `${approve ? 'Approved' : 'Rejected'} ${name.toLowerCase()} request, ${spanWords(r)}${note ? `: ${note}` : ''}`, metadata: { employeeId: r.employeeId, kind } });
  return { request: row };
}

/**
 * Days already gone, scored again on the schedule as it is now: those from
 * readers and the clock; days someone decided by hand stay as they are (as
 * Scheduling's recompute does). Days still to come are worked out as they come.
 */
async function rescoreDays(accountId: string, orgId: string, employeeId: string, from: string, to: string, userId: string) {
  const until = to < today() ? to : today();
  if (from > until) return;
  const employee = await employeeIn(orgId, accountId, employeeId);
  const records = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, employeeId, date: { gte: from, lte: until }, source: { in: ['DEVICE', 'CLOCK'] } } });
  for (const d of records) {
    if (d.source === 'DEVICE') await recomputeDeviceDay(accountId, orgId, employee, d.date);
    else await writeDay({ accountId, orgId, userId, employee, date: d.date, checkIn: d.checkIn, checkOut: d.checkOut, source: 'CLOCK' });
  }
}

/** An approved shift change: a temporary schedule for its days, which wins over every other schedule, and the days already gone scored on it. */
async function applyShiftChange(accountId: string, orgId: string, r: any, userId: string) {
  const last = r.toDate || r.date;
  const shift = r.shiftId ? await peoplePrisma.shift.findFirst({ where: { id: r.shiftId, orgId, isActive: true }, select: { id: true } }) : null;
  if (!shift) throw fail(409, 'That shift is no longer in use; ask for another.', 'SHIFT_GONE');
  /* Its days may not be in a closed month (O-05), as any schedule's. */
  await assertScheduleOpen(orgId, [{ from: r.date, to: last }]);
  /* Consent may have been withdrawn since she asked (people/nightConsent.ts). */
  await assertNightConsent(orgId, [{ employeeId: r.employeeId, shiftIds: [shift.id] }]);
  const schedule = await peoplePrisma.temporarySchedule.create({ data: { accountId, orgId, employeeId: r.employeeId, shiftId: shift.id, fromDate: r.date, toDate: last, reason: `Shift change approved: ${r.reason}`.slice(0, 200), createdByUserId: userId } });
  await peoplePrisma.attendanceRequest.update({ where: { id: r.id }, data: { temporaryScheduleId: schedule.id } });
  await rescoreDays(accountId, orgId, r.employeeId, r.date, last, userId);
}

/** What an approved WFH, on duty, permission or shift change does to the days. */
async function applyApproved(accountId: string, orgId: string, r: any, userId: string, note: string | null) {
  const kind = r.kind as Kind;
  if (kind === 'SHIFT_CHANGE') return applyShiftChange(accountId, orgId, r, userId);
  const employee = await employeeIn(orgId, accountId, r.employeeId);
  const last = r.toDate || r.date;
  const leave = await peoplePrisma.leaveRequest.findFirst({ where: { orgId, employeeId: r.employeeId, status: 'APPROVED', fromDate: { lte: last }, toDate: { gte: r.date } }, select: { fromDate: true } });
  if (leave) throw fail(409, `${employee.name} is on approved leave on ${dayWords(leave.fromDate)}; cancel the leave first.`, 'ON_LEAVE');
  const reason = `${KIND_WORDS[kind].name} approved: ${r.reason}`;
  if (kind === 'PERMISSION') {
    const existing = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: r.employeeId, date: r.date } } });
    /* The day keeps its punches and status; the hours inside the window stop counting as late or early (writeDay). */
    await writeDay({ accountId, orgId, userId, employee, date: r.date, checkIn: existing?.checkIn ?? null, checkOut: existing?.checkOut ?? null, source: existing?.source || 'REQUEST', dayKind: 'PERMISSION', attendanceRequestId: r.id, reason, ...(note ? { note } : {}) });
    return;
  }
  for (const date of await workingDates(orgId, employee, daysBetween(r.date, last))) {
    const existing = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: r.employeeId, date } } });
    /* A full day is present by the request. A half day with punches is worked out from them; with none (a company without punches) the day is present by the request too, never absent. */
    await writeDay({ accountId, orgId, userId, employee, date, checkIn: existing?.checkIn ?? null, checkOut: existing?.checkOut ?? null, statusOverride: r.halfDay && existing?.checkIn ? null : 'PRESENT', source: 'REQUEST', dayKind: kind, attendanceRequestId: r.id, reason, ...(note ? { note } : {}) });
  }
}

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

export type Canceller = { userId: string; /** The person's own employee file, from the employee app or a linked sign-in. */ employeeId?: string | null; /** HR: may cancel anything, before or after the date. */ hr: boolean };

/** Waiting: the person any time. Approved WFH or on duty: the person before the date, HR after. Cancelling an approved request puts the days back as the punches say. */
export async function cancelRequest(accountId: string, orgId: string, r: any, by: Canceller, note: string | null = null) {
  const own = Boolean(by.employeeId && by.employeeId === r.employeeId);
  const kind = r.kind as Kind;
  if (r.status !== 'PENDING' && r.status !== 'APPROVED') throw fail(409, `This request was already ${String(r.status).toLowerCase()}.`);
  if (!own && !by.hr) throw fail(403, 'This request is not yours to withdraw.');
  if (r.status === 'APPROVED') {
    if (kind === 'MISSED_PUNCH') throw fail(409, 'An approved correction cannot be cancelled; change the day instead.');
    if (!by.hr && r.date <= today()) throw fail(409, 'This has started; ask HR to cancel it.');
  }
  const who = { accountId, orgId, userId: by.userId };
  const row = await peopleWrite(orgId, async () => {
    const changed = await peoplePrisma.attendanceRequest.updateMany({
      where: { id: r.id, status: r.status },
      data: { status: 'CANCELLED', reviewedByUserId: by.userId, reviewedAt: new Date(), reviewNote: note || (own ? 'Withdrawn by the employee.' : 'Cancelled by HR.'), history: pushHistory(r.history, { by: by.userId, what: 'CANCELLED', note }) },
    });
    if (!changed.count) throw fail(409, 'This request was already decided.');
    /* A cancelled shift change takes its schedule away; the days go back to the shift they had. */
    if (r.status === 'APPROVED' && kind === 'SHIFT_CHANGE') {
      await assertScheduleOpen(orgId, [{ from: r.date, to: r.toDate || r.date }]);
      if (r.temporaryScheduleId) await peoplePrisma.temporarySchedule.deleteMany({ where: { id: r.temporaryScheduleId, orgId } });
      await rescoreDays(accountId, orgId, r.employeeId, r.date, r.toDate || r.date, by.userId);
    } else if (r.status === 'APPROVED') {
      const employee = await employeeIn(orgId, accountId, r.employeeId);
      const days = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, employeeId: r.employeeId, attendanceRequestId: r.id } });
      for (const d of days) {
        await writeDay({ accountId, orgId, userId: by.userId, employee, date: d.date, checkIn: d.checkIn, checkOut: d.checkOut, source: d.source === 'REQUEST' ? 'MANUAL' : d.source, dayKind: null, attendanceRequestId: null, reason: `${KIND_WORDS[kind].name} cancelled` });
      }
    }
    const cancelled = await peoplePrisma.attendanceRequest.findFirstOrThrow({ where: { id: r.id } });
    /*
     * HR cancelling tells the person. The person cancelling their own approved
     * request tells whoever approved it (read before the cancellation wrote
     * over reviewedByUserId), who planned around it.
     */
    if (!own) await queueRequestNotice(cancelled);
    else if (r.status === 'APPROVED') await queueRequestNotice(cancelled, { own: true, approvedBy: r.reviewedByUserId || 'system' });
    else await queueRequestNotice(cancelled, { own: true, approvedBy: null });
    return cancelled;
  });
  await requestAudit(who, { entityId: r.id, action: 'CANCEL', message: `${own ? 'Withdrew' : 'Cancelled'} ${KIND_WORDS[kind].name.toLowerCase()} request, ${spanWords(r)}`, metadata: { employeeId: r.employeeId, kind, wasApproved: r.status === 'APPROVED' } });
  return row;
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/** Who may act on a waiting request: those who approve attendance requests, narrowed to whoever's scope holds the person. */
async function approversOf(accountId: string, orgId: string, employeeId: string, opts: { wholeCompanyOnly?: boolean } = {}) {
  const users = await usersWithPermission(accountId, orgId, 'ATTENDANCE::Attendance Requests::APPROVE');
  const out: string[] = [];
  for (const userId of users) {
    const access = await resolveAccess(accountId, orgId, userId);
    if (opts.wholeCompanyOnly && access.ownDocumentsOnly) continue;
    if (!access.ownDocumentsOnly || inScope(await teamScope({ ownDocumentsOnly: true, tenant: { orgId }, auth: { userId } } as any), employeeId)) out.push(userId);
  }
  return out;
}

/* People's screens, or Attendance's names for the same places when a company runs Attendance alone. */
const ATTENDANCE_SCREEN: Record<string, string> = { attendanceRequests: 'requests', myRequests: 'me' };
const PEOPLE_SCREEN: Record<string, string> = { myRequests: 'myDays' };
const linkFor = async (accountId: string, orgId: string, screen: string, params?: Record<string, string>) => {
  const people = await isFeatureEnabled(accountId, orgId, 'people');
  return { app: people ? 'people' : 'attendance', screen: people ? PEOPLE_SCREEN[screen] || screen : ATTENDANCE_SCREEN[screen] || screen, ...(params ? { params } : {}) };
};

/** What a request notice needs of the request, as it is now. */
const requestSnapshot = (r: any) => ({
  id: r.id, accountId: r.accountId, employeeId: r.employeeId, kind: r.kind, status: r.status,
  date: r.date, toDate: r.toDate ?? null, halfDay: r.halfDay ?? null, place: r.place ?? null, minutes: r.minutes ?? null, shiftId: r.shiftId ?? null,
  managerApprovedAt: r.managerApprovedAt ?? null, managerApprovedById: r.managerApprovedById ?? null,
  requestedByUserId: r.requestedByUserId ?? null, reviewedByUserId: r.reviewedByUserId ?? null, reviewNote: r.reviewNote ?? null,
});

/** Queue the notice for this request as it now stands, in the caller's People transaction (closure audit O-07). */
async function queueRequestNotice(r: any, extra: { own?: boolean; approvedBy?: string | null } = {}) {
  await queueNotice({ accountId: r.accountId, orgId: r.orgId }, 'request', { request: requestSnapshot(r), rev: revisionOf(r.history), own: Boolean(extra.own), approvedBy: extra.approvedBy ?? null }, { employeeId: r.employeeId, correlationId: `attendance_request_${r.id}` });
}

/** Delivered from the outbox (services/attendance/notices.ts): who hears of this request, and what. Throws when it cannot send, so the outbox tries again. */
export async function tellAboutRequest(orgId: string, r: any, ctx: { approvedBy?: string | null; rev?: number; own?: boolean } = {}) {
  if (r.status === 'PENDING') return tellAsked(orgId, r, ctx.rev ?? 0);
  /* Withdrawn while waiting (no approver to tell): the "waiting for you" notices say so, or go (Company choices, SPEC 3.6). */
  if (ctx.own && r.status === 'CANCELLED' && !ctx.approvedBy) return retireAsked(orgId, r);
  if (ctx.own && r.status === 'CANCELLED') return tellOwnCancel(orgId, r, ctx.approvedBy ?? null);
  /* HR cancelled it: any "waiting for you" notice still standing says so, or goes; the person is told as before. */
  if (r.status === 'CANCELLED') await retireAsked(orgId, r, 'Cancelled');
  return tellDecided(orgId, r);
}

/** A new request goes to whoever acts on it next: the manager (or their stand-in) when the company asks the manager first, else those who approve for that person. */
async function tellAsked(orgId: string, r: any, rev: number) {
  const emp = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { accountId: true, name: true, code: true, userId: true } });
  if (!emp) return;
  const kind = r.kind as Kind;
  const who = `${emp.name}${emp.code ? ` (${emp.code})` : ''}`;
  const what = KIND_WORDS[kind].name.toLowerCase();
  const when = spanWords(r);
  const link = await linkFor(emp.accountId, orgId, 'attendanceRequests', { id: r.id });
  const shiftName = kind === 'SHIFT_CHANGE' && r.shiftId ? (await peoplePrisma.shift.findFirst({ where: { id: r.shiftId, orgId }, select: { name: true } }))?.name : null;
  const body = kind === 'PERMISSION' ? hoursWords(r.minutes || 0) : kind === 'ON_DUTY' ? r.place : kind === 'SHIFT_CHANGE' ? (shiftName ? `To ${shiftName}` : null) : r.halfDay ? 'Half a day' : null;
  /* A retry has the same key; the manager's step, or a real change, does not. */
  const dedupeKey = `request-asked:${r.id}:${r.managerApprovedAt ? 'manager' : 'new'}:${rev}`;
  const chain = await chainOf(orgId, kind);
  const manager = !hrChain(chain) && !r.managerApprovedAt ? await activeManagerOf(orgId, r.employeeId) : null;
  if (manager) {
    const decider = await deciderFor(orgId, manager.id, undefined, 'ATTENDANCE');
    const user = (await peoplePrisma.employee.findFirst({ where: { id: decider, orgId }, select: { userId: true } }))?.userId;
    if (user) await sendNotice(emp.accountId, orgId, [user], { kind: 'attendance.request_asked', title: `${who} asks for ${what}, ${when}`, body, link }, { except: r.requestedByUserId, dedupeKey, subjectKey: `attendance:${r.id}` });
    return;
  }
  const title = r.managerApprovedAt ? `${who}'s ${what}, ${when}, is approved by the manager and waits for you` : `${who} asks for ${what}, ${when}`;
  await sendNotice(emp.accountId, orgId, await approversOf(emp.accountId, orgId, r.employeeId, { wholeCompanyOnly: chain === 'HR_ONLY' }), { kind: 'attendance.request_asked', title, body, link }, { except: r.requestedByUserId, dedupeKey, subjectKey: `attendance:${r.id}` });
}

async function retireAsked(orgId: string, r: any, word: 'Withdrawn' | 'Cancelled' = 'Withdrawn') {
  const link = await linkFor(r.accountId, orgId, 'attendanceRequests', { id: r.id });
  await retireNotices(orgId, `attendance:${r.id}`, (await choicesFor(orgId)).withdrawnNotices, link, word);
}

/** A decision goes to the person, once, unless they made it themselves. */
async function tellDecided(orgId: string, r: any) {
  if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status)) return;
  const emp = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { accountId: true, userId: true } });
  if (!emp?.userId || r.reviewedByUserId === emp.userId || r.reviewedByUserId === `portal:${r.employeeId}`) return;
  const word = ({ APPROVED: 'approved', REJECTED: 'not approved', CANCELLED: 'cancelled' } as Record<string, string>)[r.status];
  await sendNotice(emp.accountId, orgId, [emp.userId], { kind: 'attendance.request_decided', title: `Your ${KIND_WORDS[r.kind as Kind].name.toLowerCase()} request for ${spanWords(r)} is ${word}`, body: r.reviewNote || null, link: await linkFor(emp.accountId, orgId, 'myRequests') }, { except: r.reviewedByUserId, dedupeKey: `request-decided:${r.id}:${r.status}` });
}

/** The person cancelled their own approved work from home or on duty: whoever approved it is told; the rule's or a sign-in-less manager's approval goes to those who approve for this person. */
async function tellOwnCancel(orgId: string, r: any, approvedBy: string | null) {
  const emp = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { accountId: true, name: true, code: true, userId: true } });
  if (!emp) return;
  const to = await approverUsers(orgId, approvedBy, () => approversOf(emp.accountId, orgId, r.employeeId));
  const who = `${emp.name}${emp.code ? ` (${emp.code})` : ''}`;
  await sendNotice(emp.accountId, orgId, to, { kind: 'attendance.request_decided', title: `${who} cancelled their ${KIND_WORDS[r.kind as Kind].name.toLowerCase()}, ${spanWords(r)}`, link: await linkFor(emp.accountId, orgId, 'attendanceRequests', { id: r.id }) }, { except: emp.userId, dedupeKey: `request-cancelled:${r.id}` });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Names for the user ids in a history: CLOR users by name, the employee app's `portal:<id>` by the employee's. */
async function actorNames(orgId: string, ids: Array<string | null | undefined>) {
  const wanted = [...new Set(ids.filter(Boolean) as string[])];
  const portal = wanted.filter((id) => id.startsWith('portal:')).map((id) => id.slice(7));
  const users = wanted.filter((id) => !id.startsWith('portal:'));
  const [u, e] = await Promise.all([
    users.length ? platformPrisma.user.findMany({ where: { id: { in: users } }, select: { id: true, fullName: true } }) : [],
    portal.length ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: portal } }, select: { id: true, name: true } }) : [],
  ]);
  return new Map<string, string>([...u.map((x) => [x.id, x.fullName] as [string, string]), ...e.map((x) => [`portal:${x.id}`, x.name] as [string, string])]);
}

const HISTORY_WORDS: Record<string, string> = { ASKED: 'Asked', EDITED: 'Changed', REASON_EDITED: 'Changed the reason', MANAGER_APPROVED: 'Approved by the manager', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

/**
 * Who decides this request, in words that match what the reader can do (#80 QA F4: "Decided by: HR" while the
 * manager's Approve closed it). The company's chain names the steps; a team-scoped reader who may approve it and
 * is the person's manager, or stands in for them, decides it too, and is told so.
 */
async function deciderWords(orgId: string, r: any, chain: Chain, readerEmployeeId: string | null | undefined, reader: { canDecide?: boolean; scopeAll?: boolean }) {
  const manager = await activeManagerOf(orgId, r.employeeId);
  const step = manager && readerEmployeeId ? await managerStepBy(orgId, readerEmployeeId, r.employeeId, undefined, 'ATTENDANCE') : null;
  const me = step ? (step === readerEmployeeId ? 'you as their manager' : 'you, standing in for their manager') : null;
  const You = me ? me.charAt(0).toUpperCase() + me.slice(1) : null;
  if (chain === 'HR_ONLY') return 'HR';
  if (chain === 'HR') return me && reader.canDecide && !reader.scopeAll ? `HR, or ${me}` : 'HR';
  if (!manager) return 'HR';
  if (chain === 'MANAGER') return You || manager.name || 'Their manager';
  return `${You || manager.name || 'Their manager'}, then HR`;
}

/** The request's story for its drawer: the row with names, what happened and who did it, the month's usage, and the days as they stand. */
export async function story(accountId: string, orgId: string, r: any, readerEmployeeId?: string | null, reader: { canDecide?: boolean; scopeAll?: boolean } = {}) {
  const [shaped] = await withNames(orgId, [r]);
  const history = Array.isArray(r.history) ? (r.history as HistoryEntry[]) : [];
  const names = await actorNames(orgId, [r.requestedByUserId, r.reviewedByUserId, ...history.map((h) => h.by)]);
  const rules = await rulesFor(orgId);
  const kind = r.kind as Kind;
  const [use, days, chain] = await Promise.all([
    usage(orgId, r.employeeId, kind, r.date.slice(0, 7), { rules }),
    peoplePrisma.attendanceRecord.findMany({ where: { orgId, employeeId: r.employeeId, date: { gte: r.date, lte: r.toDate || r.date } }, orderBy: { date: 'asc' } }),
    chainOf(orgId, kind, rules),
  ]);
  const manager = !hrChain(chain) && r.status === 'PENDING' && !r.managerApprovedAt ? await activeManagerOf(orgId, r.employeeId) : null;
  /* The manager (or their stand-in) reading it is not waiting on anyone: Approve takes their step, as it does on the Approvals row. */
  const takesManagerStep = Boolean(manager && readerEmployeeId && (await managerStepBy(orgId, readerEmployeeId, r.employeeId, undefined, 'ATTENDANCE')));
  const decidedBy = await deciderWords(orgId, r, chain, readerEmployeeId, reader);
  return {
    request: shaped,
    history: history.map((h) => ({ ...h, byName: names.get(h.by) || null, what: HISTORY_WORDS[h.what] || h.what })),
    usage: use,
    rule: rules[kind],
    chain,
    decidedBy,
    days: await withNames(orgId, days),
    waitingForManager: chain === 'MANAGER_THEN_HR' && manager && !takesManagerStep ? `${manager.name || 'Their manager'} has not approved this yet; the company asks for the manager first.` : null,
  };
}

/**
 * Attendance requests waiting on this reader, not on someone before them:
 * inside their scope, not their own, and not still with the person's manager
 * when the kind asks the manager first (unless the reader is that manager or
 * stands in for them). The same rule as leave's waitingForReader; one
 * definition for the Approvals inbox and Home's count. Oldest first.
 */
export async function requestsWaitingForReader(orgId: string, scope: TeamScope, userId: string) {
  const rows = await peoplePrisma.attendanceRequest.findMany({ where: { orgId, status: 'PENDING', ...(scope.all ? {} : { employeeId: { in: scope.ids } }) }, orderBy: { createdAt: 'asc' }, take: 2000 });
  if (!rows.length) return rows;
  const rules = await rulesFor(orgId);
  const chains = new Map<string, Chain>();
  for (const k of KINDS) chains.set(k, await chainOf(orgId, k, rules));
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, userId: true, reportingManagerId: true } });
  const of = new Map(people.map((p) => [p.id, p]));
  const managerIds = [...new Set(people.map((p) => p.reportingManagerId).filter(Boolean) as string[])];
  const managers = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: managerIds } }, select: { id: true, status: true, userId: true } })).map((m) => [m.id, m]));
  const me = await peoplePrisma.employee.findFirst({ where: { orgId, userId }, select: { id: true } });
  const covers = new Set(me ? await standingInFor(orgId, me.id, undefined, 'ATTENDANCE') : []);
  return rows.filter((r) => {
    const p = of.get(r.employeeId);
    if (p?.userId && p.userId === userId) return false;
    /* HR only: waiting on HR, not on a team-scoped reader. */
    if (chains.get(r.kind) === 'HR_ONLY' && !scope.all) return false;
    const m = p?.reportingManagerId ? managers.get(p.reportingManagerId) : null;
    const activeManager = m && m.status !== 'LEFT' && m.status !== 'SUSPENDED' ? m : null;
    if (chains.get(r.kind) === 'MANAGER_THEN_HR' && !r.managerApprovedAt && activeManager) return activeManager.userId === userId || covers.has(activeManager.id);
    return true;
  });
}
