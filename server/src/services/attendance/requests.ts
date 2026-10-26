import { z } from 'zod';

import { peoplePrisma, peopleWrite, afterPeopleCommit } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { ISO_DATE, daysBetween, employeeIn, fail, instants, isHoliday, shiftFor, today, withNames, writeDay } from './days.js';
import { isHHMM, isWeeklyOff } from './compute.js';
import { CHAINS, activeManagerOf, chainFor, type Chain } from './approvalChain.js';
import { deciderFor, managerStepBy } from './standIns.js';
import { REASON_CODES, reviewCorrection } from './corrections.js';
import { notifyUsers, usersWithPermission } from '../notifications.js';
import { resolveAccess } from '../access.js';
import { inScope, teamScope } from '../people/scope.js';
import { isFeatureEnabled } from '../features.js';

/**
 * Attendance requests (TIME-LEAVE-DECISIONS.md, advanced build): four kinds on
 * one list and one approval. A missed punch is the correction as before; work
 * from home and on duty mark the day present with its kind on the record,
 * never leave; permission is a few hours off, excused on the day. Each kind
 * has a monthly quota and a back-date window in Settings → Request rules;
 * the employee app shows used and left. One queue for HR and for managers.
 */
export const KINDS = ['MISSED_PUNCH', 'WFH', 'ON_DUTY', 'PERMISSION'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_WORDS: Record<Kind, { name: string; unit: string }> = {
  MISSED_PUNCH: { name: 'Missed punch', unit: 'missed-punch requests' },
  WFH: { name: 'Work from home', unit: 'work-from-home days' },
  ON_DUTY: { name: 'On duty', unit: 'on-duty days' },
  PERMISSION: { name: 'Permission', unit: 'permission hours' },
};
const MAX_SPAN_DAYS = 14;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type Rule = { on: boolean; quotaPerMonth: number | null; hoursPerMonth: number | null; maxMinutes: number; backDays: number; approval: Chain | null };
/** `approval` null = the company's correction chain (Attendance rules); a kind may have its own. */
export const DEFAULT_RULES: Record<Kind, Rule> = {
  MISSED_PUNCH: { on: true, quotaPerMonth: 3, hoursPerMonth: null, maxMinutes: 0, backDays: 30, approval: null },
  WFH: { on: false, quotaPerMonth: 4, hoursPerMonth: null, maxMinutes: 0, backDays: 7, approval: null },
  ON_DUTY: { on: false, quotaPerMonth: null, hoursPerMonth: null, maxMinutes: 0, backDays: 7, approval: null },
  PERMISSION: { on: false, quotaPerMonth: null, hoursPerMonth: 4, maxMinutes: 120, backDays: 7, approval: null },
};

const ruleSchema = z.object({
  on: z.boolean().optional(),
  quotaPerMonth: z.coerce.number().int().min(0).max(31).nullable().optional(),
  hoursPerMonth: z.coerce.number().min(0).max(200).nullable().optional(),
  maxMinutes: z.coerce.number().int().min(15).max(480).optional(),
  backDays: z.coerce.number().int().min(0).max(366).optional(),
  approval: z.enum(CHAINS as [Chain, ...Chain[]]).nullable().optional(),
});
export const rulesSchema = z.object({ MISSED_PUNCH: ruleSchema, WFH: ruleSchema, ON_DUTY: ruleSchema, PERMISSION: ruleSchema }).partial();

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
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
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
    if (await isHoliday(orgId, date, employee.branchId, employee.areaId ?? null)) continue;
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
  if (kind === 'MISSED_PUNCH') {
    if (!b.checkIn) throw fail(400, 'Give the time you came in, HH:MM.');
    if (b.date > t) throw fail(400, 'A correction is for a day that has happened.');
    ({ checkIn, checkOut } = instants(b.date, b.checkIn, b.checkOut || null));
  }
  if (kind === 'WFH' || kind === 'ON_DUTY') {
    toDate = b.toDate || b.date;
    if (toDate < b.date) throw fail(400, 'The end is before the start.');
    if (daysBetween(b.date, toDate).length > MAX_SPAN_DAYS) throw fail(400, `Up to ${MAX_SPAN_DAYS} days in one request.`);
    if (b.halfDay && toDate !== b.date) throw fail(400, 'A half day is one day; give one date.');
    if (kind === 'ON_DUTY' && !b.place) throw fail(400, 'Where will you be? Give the place.');
  }
  if (kind === 'PERMISSION') {
    if (!b.checkIn || !b.checkOut) throw fail(400, 'Give the hours: from and to, HH:MM.');
    ({ checkIn, checkOut } = instants(b.date, b.checkIn, b.checkOut));
    minutes = Math.round((checkOut!.getTime() - checkIn!.getTime()) / 60_000);
    if (minutes < 15 || minutes > rule.maxMinutes) throw fail(400, `A permission is between 15 minutes and ${hoursWords(rule.maxMinutes)}.`);
  }
  if (!who.onBehalf && b.date < addDays(t, -rule.backDays)) throw fail(400, `${name} requests go back ${rule.backDays} days at most; ask HR for older days.`, 'TOO_OLD');
  const span = { date: b.date, toDate };
  const last = toDate || b.date;
  if (kind !== 'MISSED_PUNCH') {
    /* A second correction on one day happens (in, then out); a second WFH does not. */
    const open = await peoplePrisma.attendanceRequest.findFirst({
      where: { orgId: who.orgId, employeeId: employee.id, kind, status: { in: ['PENDING', 'APPROVED'] }, date: { lte: last }, ...(existing ? { id: { not: existing.id } } : {}), OR: [{ toDate: null, date: { gte: b.date } }, { toDate: { gte: b.date } }] },
    });
    if (open) throw fail(409, `You already have a ${name.toLowerCase()} request for ${spanWords(open)}.`, 'OVERLAP');
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
  const u = await usage(who.orgId, employee.id, kind, b.date.slice(0, 7), { except: existing?.id, rules });
  if (u.quota != null) {
    const unit = KIND_WORDS[kind].unit;
    if (u.left! <= 0) throw fail(409, `You have used your ${u.quota} ${unit} for ${monthWords(u.month)}.`, 'QUOTA');
    if (need > u.left!) throw fail(409, `Only ${u.left} of your ${u.quota} ${unit} ${u.left === 1 ? 'is' : 'are'} left for ${monthWords(u.month)}.`, 'QUOTA');
  }
  return {
    kind, date: b.date, toDate: kind === 'WFH' || kind === 'ON_DUTY' ? (toDate === b.date ? null : toDate) : null,
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
  const v = await validate(who, employee, b, rules, null);
  /* The day as it stands now, so whoever reviews sees what would change. */
  const current = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: b.date } } });
  const { span: _span, ...data } = v;
  const row = await peoplePrisma.attendanceRequest.create({
    data: {
      accountId: who.accountId, orgId: who.orgId, employeeId: employee.id, ...data,
      beforeCheckIn: current?.checkIn ?? null, beforeCheckOut: current?.checkOut ?? null, beforeStatus: current?.status ?? null,
      requestedByUserId: who.userId,
      history: pushHistory([], { by: who.userId, what: 'ASKED' }),
    },
  });
  await requestAudit(who, { entityId: row.id, action: 'CREATE', message: `${who.onBehalf ? `Entered ${KIND_WORDS[b.kind].name.toLowerCase()} for ${employee.name || 'an employee'}` : `${employee.name || 'An employee'} asked for ${KIND_WORDS[b.kind].name.toLowerCase()}`}, ${spanWords(v.span)}`, metadata: { employeeId: employee.id, kind: b.kind, date: b.date, toDate: v.toDate } });
  tellAsked(who.orgId, row).catch((e) => console.error('[attendance requests] notice not sent:', e instanceof Error ? e.message : e));
  return row;
}

/** Change a waiting request; the manager's step, if taken, is reset so they see the new dates. */
export async function editRequest(who: Asker, r: any, body: unknown) {
  if (r.status !== 'PENDING') throw fail(409, 'Only a waiting request can be changed.');
  const employee = await employeeIn(who.orgId, who.accountId, r.employeeId);
  const b = parseAsk({ ...(body && typeof body === 'object' ? body : {}), reasonCode: (body as any)?.reasonCode === undefined ? r.reasonCode : (body as any).reasonCode }, r.kind as Kind);
  const rules = await rulesFor(who.orgId);
  const v = await validate(who, employee, b, rules, r);
  const { span: _span, ...data } = v;
  const fields = ['date', 'toDate', 'halfDay', 'place', 'minutes', 'checkIn', 'checkOut', 'reason', 'reasonCode'] as const;
  const changed = fields.filter((k) => String((data as any)[k] instanceof Date ? (data as any)[k].getTime() : (data as any)[k] ?? '') !== String(r[k] instanceof Date ? r[k].getTime() : r[k] ?? ''));
  if (!changed.length) return r;
  const from = Object.fromEntries(changed.map((k) => [k, r[k]]));
  const to = Object.fromEntries(changed.map((k) => [k, (data as any)[k]]));
  const row = await peoplePrisma.attendanceRequest.update({
    where: { id: r.id },
    data: { ...data, managerApprovedAt: null, managerApprovedById: null, managerNote: null, history: pushHistory(r.history, { by: who.userId, what: 'EDITED', from, to }) },
  });
  await requestAudit(who, { entityId: r.id, action: 'UPDATE', message: `${KIND_WORDS[r.kind as Kind].name} request for ${employee.name} changed: ${changed.join(', ')}`, metadata: { employeeId: r.employeeId, from, to } });
  /* Back to the start of the chain: whoever decides first hears of it again. */
  if (r.managerApprovedAt) tellAsked(who.orgId, row).catch((e) => console.error('[attendance requests] notice not sent:', e instanceof Error ? e.message : e));
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
  const kind = r.kind as Kind;
  const name = KIND_WORDS[kind].name;
  const chain = await chainOf(orgId, kind);
  const manager = chain === 'HR' ? null : await activeManagerOf(orgId, r.employeeId);
  const asManager = by.managerId && manager ? await managerStepBy(orgId, by.managerId, r.employeeId) : null;
  const who = { accountId, orgId, userId: by.userId };
  if (approve && chain === 'MANAGER_THEN_HR' && manager) {
    if (!r.managerApprovedAt) {
      if (!asManager) throw fail(409, `${manager.name || 'Their manager'} has not approved this yet; the company asks for the manager first.`, 'MANAGER_FIRST');
      const changed = await peoplePrisma.attendanceRequest.updateMany({
        where: { id: r.id, status: 'PENDING', managerApprovedAt: null },
        data: { managerApprovedAt: new Date(), managerApprovedById: by.managerId!, managerNote: note, history: pushHistory(r.history, { by: by.userId, what: 'MANAGER_APPROVED', note }) },
      });
      if (!changed.count) throw fail(409, 'This request is no longer waiting for the manager.');
      const row = await peoplePrisma.attendanceRequest.findFirstOrThrow({ where: { id: r.id } });
      await requestAudit(who, { entityId: r.id, action: 'MANAGER_APPROVE', message: `Manager approved ${name.toLowerCase()} request, ${spanWords(r)}; now with HR`, metadata: { employeeId: r.employeeId, kind } });
      tellAsked(orgId, row).catch((e) => console.error('[attendance requests] notice not sent:', e instanceof Error ? e.message : e));
      return { request: row, stage: 'HR' };
    }
    /* HR's step is a second pair of eyes: not the manager who took the first, and someone who decides for the whole company. */
    const firstBy = r.managerApprovedById ? await peoplePrisma.employee.findFirst({ where: { id: r.managerApprovedById, orgId }, select: { id: true, userId: true } }) : null;
    const samePerson = Boolean(firstBy && ((by.managerId && by.managerId === firstBy.id) || (firstBy.userId && firstBy.userId === by.userId)));
    if (samePerson || !by.scopeAll) throw fail(403, 'HR approves after the manager; the manager cannot take both steps.', 'HR_STEP');
  }
  /* A refusal says why: the person reads it in the employee app. Corrections keep their old manners. */
  if (!approve && kind !== 'MISSED_PUNCH' && !note) throw fail(400, 'Say why. They see this with the decision.');
  const history = pushHistory(r.history, { by: by.userId, what: approve ? 'APPROVED' : 'REJECTED', note });
  let row: any;
  if (kind === 'MISSED_PUNCH') {
    await reviewCorrection(accountId, orgId, r, approve, by.userId, note);
    row = await peoplePrisma.attendanceRequest.update({ where: { id: r.id }, data: { history } });
  } else {
    row = await peopleWrite(orgId, async () => {
      const changed = await peoplePrisma.attendanceRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedByUserId: by.userId, reviewedAt: new Date(), reviewNote: note, history } });
      if (!changed.count) throw fail(409, 'This request was already decided.');
      if (approve) await applyApproved(accountId, orgId, r, by.userId, note);
      return peoplePrisma.attendanceRequest.findFirstOrThrow({ where: { id: r.id } });
    });
  }
  await requestAudit(who, { entityId: r.id, action: approve ? 'APPROVE' : 'REJECT', message: `${approve ? 'Approved' : 'Rejected'} ${name.toLowerCase()} request, ${spanWords(r)}${note ? `: ${note}` : ''}`, metadata: { employeeId: r.employeeId, kind } });
  afterPeopleCommit(() => tellDecided(orgId, row).catch((e) => console.error('[attendance requests] notice not sent:', e instanceof Error ? e.message : e)));
  return { request: row };
}

/** What an approved WFH, on duty or permission does to the days. */
async function applyApproved(accountId: string, orgId: string, r: any, userId: string, note: string | null) {
  const kind = r.kind as Kind;
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
    /* A full day is present by the request; a half day leaves the status to the punches. */
    await writeDay({ accountId, orgId, userId, employee, date, checkIn: existing?.checkIn ?? null, checkOut: existing?.checkOut ?? null, statusOverride: r.halfDay ? null : 'PRESENT', source: 'REQUEST', dayKind: kind, attendanceRequestId: r.id, reason, ...(note ? { note } : {}) });
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
    if (r.status === 'APPROVED') {
      const employee = await employeeIn(orgId, accountId, r.employeeId);
      const days = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, employeeId: r.employeeId, attendanceRequestId: r.id } });
      for (const d of days) {
        await writeDay({ accountId, orgId, userId: by.userId, employee, date: d.date, checkIn: d.checkIn, checkOut: d.checkOut, source: d.source === 'REQUEST' ? 'MANUAL' : d.source, dayKind: null, attendanceRequestId: null, reason: `${KIND_WORDS[kind].name} cancelled` });
      }
    }
    return peoplePrisma.attendanceRequest.findFirstOrThrow({ where: { id: r.id } });
  });
  await requestAudit(who, { entityId: r.id, action: 'CANCEL', message: `${own ? 'Withdrew' : 'Cancelled'} ${KIND_WORDS[kind].name.toLowerCase()} request, ${spanWords(r)}`, metadata: { employeeId: r.employeeId, kind, wasApproved: r.status === 'APPROVED' } });
  if (!own) afterPeopleCommit(() => tellDecided(orgId, row).catch((e) => console.error('[attendance requests] notice not sent:', e instanceof Error ? e.message : e)));
  return row;
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/** Who may act on a waiting request: those who approve attendance requests, narrowed to whoever's scope holds the person. */
async function approversOf(accountId: string, orgId: string, employeeId: string) {
  const users = await usersWithPermission(accountId, orgId, 'ATTENDANCE::Attendance Requests::APPROVE');
  const out: string[] = [];
  for (const userId of users) {
    const access = await resolveAccess(accountId, orgId, userId);
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

/** A new request goes to whoever acts on it next: the manager (or their stand-in) when the company asks the manager first, else those who approve for that person. */
async function tellAsked(orgId: string, r: any) {
  const emp = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { accountId: true, name: true, code: true, userId: true } });
  if (!emp) return;
  const kind = r.kind as Kind;
  const who = `${emp.name}${emp.code ? ` (${emp.code})` : ''}`;
  const what = KIND_WORDS[kind].name.toLowerCase();
  const when = spanWords(r);
  const link = await linkFor(emp.accountId, orgId, 'attendanceRequests', { id: r.id });
  const body = kind === 'PERMISSION' ? hoursWords(r.minutes || 0) : kind === 'ON_DUTY' ? r.place : r.halfDay ? 'Half a day' : null;
  const chain = await chainOf(orgId, kind);
  const manager = chain !== 'HR' && !r.managerApprovedAt ? await activeManagerOf(orgId, r.employeeId) : null;
  if (manager) {
    const decider = await deciderFor(orgId, manager.id);
    const user = (await peoplePrisma.employee.findFirst({ where: { id: decider, orgId }, select: { userId: true } }))?.userId;
    if (user) await notifyUsers(emp.accountId, orgId, [user], { kind: 'attendance.request_asked', title: `${who} asks for ${what}, ${when}`, body, link }, { except: r.requestedByUserId });
    return;
  }
  const title = r.managerApprovedAt ? `${who}'s ${what}, ${when}, is approved by the manager and waits for you` : `${who} asks for ${what}, ${when}`;
  await notifyUsers(emp.accountId, orgId, await approversOf(emp.accountId, orgId, r.employeeId), { kind: 'attendance.request_asked', title, body, link }, { except: r.requestedByUserId });
}

/** A decision goes to the person, once, unless they made it themselves. */
async function tellDecided(orgId: string, r: any) {
  if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status)) return;
  const emp = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { accountId: true, userId: true } });
  if (!emp?.userId || r.reviewedByUserId === emp.userId || r.reviewedByUserId === `portal:${r.employeeId}`) return;
  const word = ({ APPROVED: 'approved', REJECTED: 'not approved', CANCELLED: 'cancelled' } as Record<string, string>)[r.status];
  await notifyUsers(emp.accountId, orgId, [emp.userId], { kind: 'attendance.request_decided', title: `Your ${KIND_WORDS[r.kind as Kind].name.toLowerCase()} request for ${spanWords(r)} is ${word}`, body: r.reviewNote || null, link: await linkFor(emp.accountId, orgId, 'myRequests') }, { except: r.reviewedByUserId });
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

const HISTORY_WORDS: Record<string, string> = { ASKED: 'Asked', EDITED: 'Changed', MANAGER_APPROVED: 'Approved by the manager', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

/** The request's story for its drawer: the row with names, what happened and who did it, the month's usage, and the days as they stand. */
export async function story(accountId: string, orgId: string, r: any) {
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
  const manager = chain !== 'HR' && r.status === 'PENDING' && !r.managerApprovedAt ? await activeManagerOf(orgId, r.employeeId) : null;
  return {
    request: shaped,
    history: history.map((h) => ({ ...h, byName: names.get(h.by) || null, what: HISTORY_WORDS[h.what] || h.what })),
    usage: use,
    rule: rules[kind],
    chain,
    days: await withNames(orgId, days),
    waitingForManager: chain === 'MANAGER_THEN_HR' && manager ? `${manager.name || 'Their manager'} has not approved this yet; the company asks for the manager first.` : null,
  };
}
