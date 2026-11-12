import { compOffExpiresOn, compOffGrants, expiringOf } from '../services/attendance/compOff.js';
import { Router } from 'express';
import { trackFirst } from '../services/productEvents.js';
import { ownWorkRefusal, selfDecisionAllowed } from '../services/makerChecker.js';
import { permKey } from '../constants/permissionCatalog.js';
import { CHAINS, activeManagerOf, chainFor, hrMayDecide, type Chain } from '../services/attendance/approvalChain.js';
import { activeLeaveRule, configuredLeaveApproval, LEAVE_CHAINS, nextLeaveStep, skippedLines, stepsOf, takesStep, type LeaveChain } from '../services/attendance/leaveRules.js';
import { retireNotices, sendNotice, usersWithPermission } from '../services/notifications.js';
import { choicesFor } from '../services/people/companyChoices.js';
import { approverUsers, queueNotice, revisionOf } from '../services/attendance/notices.js';
import { resolveAccess } from '../services/access.js';
import { isFeatureEnabled } from '../services/features.js';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requireAnyPermission, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { logDayChange } from '../services/attendance/history.js';
import { sendEncashmentToPayroll } from '../services/attendance/leaveEncashment.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { peoplePrisma, peopleWrite, afterPeopleCommit } from '../utils/peoplePrisma.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../services/attendance/guards.js';
import { hrOrAttendanceRouteOk } from '../services/people/guards.js';
import { isOvernight, isWeeklyOff, type ShiftRule } from '../services/attendance/compute.js';
import { nightCover, nightShiftsOn } from '../services/attendance/nightShift.js';
import { ACCRUALS, CALENDAR, balanceFor, carryLimitOf, periodEnd, periodLabel, periodOf, periodStart, workedCredit, type LeavePeriod, type Worked } from '../services/attendance/leaveAccrual.js';
import { emit as emitWebhook, leaveEvent, leaveEventFor } from '../services/attendance/webhooks.js';
import { ISO_DATE, MonthClosedError, PayrollTakenError, closedMonthRefusal, closedMonths, codeKey, employeeIn, fail, isHoliday, myEmployee, payrollTaken, peopleByCode, sendError, shiftFor, today, withNames, assertMonthOpen, writeDay } from '../services/attendance/days.js';
import { deleteToBin } from '../services/recycleBin.js';
import { blockFor, blockSchema, checkBlockIds } from '../services/attendance/leaveBlocks.js';
import { recordAudit } from '../services/auditTrail.js';
import { placeProblem, plural, policyProblem } from '../services/people/leavePolicy.js';
import { QUARTER_TIME, halfOn, minutesOf, partOfDay, weightOn } from '../services/attendance/leaveHalves.js';
import { decodeDocument } from '../services/people/documentFiles.js';
import { OPEN, balancesFor, entitledDays, leavePeriodOf, leaveYearOf, probationOf, round } from '../services/attendance/leaveBalances.js';
/** Hourly leave's share of a day, to four places. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
import { daysWorkedBefore, daysWorkedByPeriod } from '../services/attendance/daysWorked.js';
import { deciderFor, managerStepBy, standingInFor, teamDecidedBy } from '../services/attendance/standIns.js';
import { LEAVE_DELEGATE_TYPES, cleanTypes, covers, coversPeople, deciders, findStandIn, listStandIns, nameStandIn, removeStandIn } from '../services/people/approvals/standIns.js';
import { earlierWeeks, loadSchedule, resolveShift, weeksBefore, type EarlierWeek } from '../services/attendance/schedule.js';
import { dayAfterMonth, scheduleGuard } from '../services/attendance/scheduleGuard.js';
import { Prisma as PeoplePrisma } from '../generated/people/index.js';
import { authorize } from '../middleware/rbac.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { inScope, teamScope, type TeamScope } from '../services/people/scope.js';
import { decideLeaveOnEngine, decidesNow, engineStepView, goesOnEngine, refreshForPerson, refreshLeaveSteps, engineLeaveNaming, engineQueue, engineRequestOf, engineStepOf, openLeaveOnEngine, restartLeaveOnEngine, syncLeaveDecision } from '../services/attendance/leaveEngine.js';

/**
 * Leave, basic (after Horilla HRMS's leave app; reference only).
 *
 * Types (paid or unpaid, days a year), per-person allocations when a person
 * gets something other than the type's days, and requests. Approving a
 * request marks each working day in it "on leave" — weekly offs and holidays
 * inside the range are not leave and are not counted. Unpaid leave is loss of
 * pay in the attendance month summary. A request stays inside one calendar
 * year, so a balance is always one year's.
 */
export const leaveRouter = Router();
leaveRouter.use(requireAuth, requireTenantContext);

const R = ATTENDANCE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(ATTENDANCE_MODULE, action as any, resource);
/**
 * A leave route about one request (or a list of them in body.ids): whoever a
 * waiting step of the leave rule names may open and decide those requests
 * without the general right to; everyone else needs the right.
 */
const canOrStep = (action: string, resource: string) => {
  const gate = can(action, resource);
  return async (req: any, res: any, next: any) => {
    const ids: string[] = req.params?.id ? [String(req.params.id)] : Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 200) : [];
    const userId = req.auth?.userId;
    const orgId = req.tenant?.orgId || req.params?.orgId;
    /* Someone who holds the right goes through the ordinary gate: no lookup. */
    const accountId = req.tenant?.accountId;
    const holds = userId && orgId && accountId ? await resolveAccess(accountId, orgId, userId).then((a) => a.isAdmin || a.permissions.has(permKey(ATTENDANCE_MODULE, R.leave, 'APPROVE'))).catch(() => false) : false;
    if (!holds && ids.length && userId && orgId) {
      const rows = await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, groupId: true, ruleId: true, ruleStep: true, stepUserIds: true, status: true } });
      if (rows.length === ids.length && rows.every((r) => takesStep(r, [userId]))) return next();
      /* Leave on the approval engine: whoever may decide it now, worked out live (a stand-in, a manager who decides in the employee app); never someone a step named once and no longer would. */
      if (rows.length === ids.length && accountId) {
        let named = true;
        for (const r of rows) named = named && r.status === 'PENDING' && !r.ruleId && (await decidesNow(accountId, orgId, r, userId));
        if (named) return next();
      }
    }
    return gate(req, res, next);
  };
};
/**
 * Whoever may decide a leave on the engine now (worked out live) as its leave rule names them: like a step of the
 * walker, they open it, and read what they decide on, outside their team. A chain's decider is in the team anyway.
 */
async function engineStepper(accountId: string, orgId: string, r: { id: string; groupId: string | null; status: string; ruleId: string | null }, userId: string) {
  if (r.status !== 'PENDING' || r.ruleId) return false;
  const step = await engineStepOf(orgId, r);
  if (!step || step.preset !== 'RULE') return false;
  return decidesNow(accountId, orgId, r, userId);
}
const onEngineNow = (e: Awaited<ReturnType<typeof engineRequestOf>>) => Boolean(e && e.status === 'WAITING' && e.steps.some((s) => s.status === 'WAITING'));
const base = '/orgs/:orgId/attendance/leave';
const MAX_SPAN_DAYS = 60;
/** The longest single request: 26 weeks. A type's own longest request above 60 days lifts the span to it. */
export const MAX_REQUEST_DAYS = 182;
export const spanLimitOf = (type: { maxDaysPerRequest?: number | null }) => Math.min(MAX_REQUEST_DAYS, Math.max(MAX_SPAN_DAYS, Math.ceil(Number(type.maxDaysPerRequest) || 0)));

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** ?year= when it is a year, else the period today is in. */
const yearParam = async (orgId: string, v: unknown) => {
  const y = Number(v);
  return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : leaveYearOf(orgId);
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const dayWords = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)} ${d.slice(0, 4)}`;
/** "January 2026" for a whole month, "1 Jan 2026 to 31 Mar 2026" otherwise: dates as CLOR writes them. */
const spanWords = (from: string, to: string) =>
  from.slice(8) === '01' && from.slice(0, 7) === to.slice(0, 7) && addDays(to, 1).slice(8) === '01' ? `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}` : `${dayWords(from)} to ${dayWords(to)}`;

/** A period's first and last day, and its name. */
export const periodBounds = (p: LeavePeriod, year: number) => ({ year, from: periodStart(p, year), to: periodEnd(p, year), label: periodLabel(p, year) });

/** One date in a request: whether it is charged, and if not, why (the preview shows every one). */
export type PlannedDay = {
  date: string;
  counted: boolean;
  why: string | null;
  /** Why a date is not a working day, for the sandwich options. */
  off?: 'HOLIDAY' | 'WEEKLY_OFF';
  /** With night shifts on, a date whose shift ends the next morning: the shift, and the hours this leave covers (the day record says the same). */
  night?: { label: string; covers: string };
};

/**
 * Every date from first to last: a weekly off on that day's shift (or the
 * company's working week) and a holiday for the person's branch and location
 * are skipped, with the reason. Under the sandwich rule the offs and holidays
 * between the first and last working day are charged too, and say so.
 * Loaded once for the range, not once a day.
 */
/** How a type charges dates: the sandwich rule, or every calendar date (maternity). A boolean is the sandwich rule alone. */
export type CountRule = boolean | {
  sandwich?: boolean | null;
  countsCalendarDays?: boolean | null;
  /* Sandwich options (LeaveType): at least this many working days; weekly offs; holidays; leave half days at the ends out. */
  sandwichMinDays?: number | null;
  sandwichWeekOffs?: boolean | null;
  sandwichHolidays?: boolean | null;
  sandwichIgnoreHalf?: boolean | null;
};
/** The request's own shape, where it changes what a day counts as: a half on one day, or after lunch on the first and to lunch on the last. */
export type PlanEdges = { halfDay?: string | null; startHalf?: boolean | null; endHalf?: boolean | null };
export async function dayPlan(orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, from: string, to: string, rule: CountRule, edges: PlanEdges = {}): Promise<PlannedDay[]> {
  const sandwich = typeof rule === 'boolean' ? rule : Boolean(rule?.sandwich);
  const calendar = typeof rule === 'boolean' ? false : Boolean(rule?.countsCalendarDays);
  const [schedule, holidays] = await Promise.all([
    loadSchedule(orgId, [employee.id]),
    peoplePrisma.holiday.findMany({
      where: {
        orgId, date: { gte: from, lte: to },
        AND: [
          { OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])] },
          { OR: [{ areaId: null }, ...(employee.areaId ? [{ areaId: employee.areaId }] : [])] },
        ],
      },
      select: { id: true, date: true, name: true, isOptional: true },
    }),
  ]);
  /* A restricted holiday counts for the person who picked it. */
  const optional = holidays.filter((h) => h.isOptional);
  const picked = optional.length ? new Set((await peoplePrisma.holidayPick.findMany({ where: { orgId, employeeId: employee.id, holidayId: { in: optional.map((h) => h.id) } }, select: { holidayId: true } })).map((x) => x.holidayId)) : new Set<string>();
  const holidayOn = new Map(holidays.filter((h) => !h.isOptional || picked.has(h.id)).map((h) => [h.date, h.name]));
  const out: PlannedDay[] = [];
  /* Holidays and weekly offs are the shift date's: a night starting on a holiday is the holiday's, whatever the morning after is. */
  const rules = new Map<string, ShiftRule>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const rule = resolveShift(schedule, employee.id, d).rule;
    rules.set(d, rule);
    const name = holidayOn.get(d);
    if (name !== undefined) out.push({ date: d, counted: false, why: `Holiday: ${name}`, off: 'HOLIDAY' });
    else if (isWeeklyOff(rule, d)) out.push({ date: d, counted: false, why: 'Weekly off', off: 'WEEKLY_OFF' });
    else out.push({ date: d, counted: true, why: null });
  }
  /* Leave on a date covers the night shift that starts on it (feature attendanceNightShifts). */
  if ([...rules.values()].some(isOvernight) && (await nightShiftsOn(orgId))) {
    for (const x of out) {
      const cover = nightCover(rules.get(x.date)!, x.date);
      if (cover) x.night = cover;
    }
  }
  /* Calendar days (maternity: 26 weeks are 182 days): every date is leave, and the skipped ones say why they count. */
  if (calendar) {
    for (const x of out) if (!x.counted) { x.counted = true; x.why = `${x.why}, counted (calendar days)`; }
    return out;
  }
  const opts = typeof rule === 'boolean' ? {} : rule || {};
  /* A half day at either end is not an end of the sandwich when the type says so: only whole working days hold the offs between. */
  const half = (d: string) => Boolean((edges.halfDay && d === from) || (from !== to && ((d === from && edges.startHalf) || (d === to && edges.endHalf))));
  const working = out.filter((x) => x.counted && !(opts.sandwichIgnoreHalf && half(x.date)));
  const longEnough = opts.sandwichMinDays == null || out.filter((x) => x.counted).length >= opts.sandwichMinDays;
  if (sandwich && working.length >= 2 && longEnough) {
    const first = working[0].date;
    const last = working[working.length - 1].date;
    for (const x of out) {
      if (x.counted || x.date <= first || x.date >= last) continue;
      if (x.off === 'WEEKLY_OFF' && opts.sandwichWeekOffs === false) continue;
      if (x.off === 'HOLIDAY' && opts.sandwichHolidays === false) continue;
      x.counted = true;
      x.why = `${x.why}, counted (sandwich rule)`;
    }
  }
  return out;
}

/** The days in a range that are leave: not a weekly off on that day's shift, not a holiday. */
const workingDays = async (orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, from: string, to: string) =>
  (await dayPlan(orgId, employee, from, to, false)).filter((x) => x.counted).map((x) => x.date);

/** The days a request takes: working days, and under the sandwich rule the offs between them. */
const leaveDays = async (orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, from: string, to: string, rule: CountRule) =>
  (await dayPlan(orgId, employee, from, to, rule)).filter((x) => x.counted).map((x) => x.date);

/*
 * Team scope (services/people/scope.ts), as every People read: a role
 * limited to its own team sees and decides that team's leave only; anyone
 * else reads as absent. For leave, the team is widened by the teams this
 * person stands in for today (standIns.ts), so a stand-in can see what they
 * are asked to decide.
 */
export async function leaveScope(req: any): Promise<TeamScope> {
  const scope = await teamScope(req);
  if (scope.all || !scope.selfId) return scope;
  const covered = await teamDecidedBy(req.tenant!.orgId, scope.selfId, undefined, 'LEAVE');
  if (!covered.length) return scope;
  return { all: false, ids: [...new Set([...scope.ids, ...covered.map((e) => e.id)])], selfId: scope.selfId };
}
const scopeRows = (scope: TeamScope) => (scope.all ? {} : { employeeId: { in: scope.ids } });
async function scopedOr404(req: any, employeeId: string) {
  if (!inScope(await leaveScope(req), employeeId)) throw fail(404, 'No such employee.');
}
/** Company-wide leave set-up (imports, the leave period, the working week): a team role is refused. */
/**
 * Days added to your own balance, or paid out to you, are approved by
 * somebody else, as the company's maker-checker setting decides (the same
 * rule as approving your own leave; a one-person company still can).
 */
async function ownBalanceRefused(req: any, res: any, employee: { id: string }, what: string) {
  const own = await peoplePrisma.employee.findFirst({ where: { id: employee.id, orgId: req.tenant!.orgId }, select: { userId: true } });
  const refused = await ownWorkRefusal(req, { makers: [own?.userId], module: ATTENDANCE_MODULE, resource: R.leave, entity: 'ATTENDANCE_LEAVE_BALANCE', entityId: employee.id, what });
  if (!refused) return false;
  res.status(refused.status).json({ ...refused.body, error: `This is your own leave balance; somebody else has to make this ${what}.` });
  return true;
}

async function wholeCompany(req: any, res: any) {
  if ((await leaveScope(req)).all) return true;
  res.status(403).json({ error: 'This is set up for the whole company; your role covers your own team.' });
  return false;
}

/**
 * Private leave (sick, medical, maternity): the reason, and the type itself,
 * are read only by those who decide leave for the whole company (and the
 * person). A team lead, the calendar and colleagues see "Private leave", so
 * cover can be planned without a diagnosis on show.
 */
export async function readsPrivateLeave(req: any) {
  if (req.isAdmin) return true;
  if (!(await leaveScope(req)).all) return false;
  return !(await authorize(req, ATTENDANCE_MODULE, PermissionAction.APPROVE, R.leave)) || !(await authorize(req, ATTENDANCE_MODULE, PermissionAction.EDIT, R.leave));
}
export const PRIVATE_LABEL = 'Private leave';
/** Rows as this reader may see them: a private type's name and reason hidden unless they read private leave or it is their own. */
export const masked = (rows: any[], reads: boolean, ownEmployeeId: string | null = null) =>
  rows.map((r) => (!r.isPrivate || reads || (ownEmployeeId && r.employeeId === ownEmployeeId) ? r : { ...r, leaveTypeId: null, leaveTypeName: PRIVATE_LABEL, leaveTypeColor: null, reason: null, reviewNote: null, reasonHidden: true }));

export const withTypes = async (orgId: string, rows: any[]) => {
  const types = new Map(
    (await peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true, isPaid: true, color: true, isPrivate: true } })).map((t) => [t.id, t])
  );
  return (await withNames(orgId, rows)).map((r) => ({
    ...r,
    leaveTypeName: types.get(r.leaveTypeId)?.name || '—',
    isPaid: types.get(r.leaveTypeId)?.isPaid ?? true,
    leaveTypeColor: types.get(r.leaveTypeId)?.color ?? null,
    isPrivate: types.get(r.leaveTypeId)?.isPrivate ?? false,
  }));
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const typeSchema = z.object({
  name: z.string().trim().min(1, 'Name the leave type.').max(60),
  code: z.string().trim().max(10).optional().nullable(),
  isPaid: z.boolean().default(true),
  annualDays: z.coerce.number().min(0, 'Days cannot be negative.').max(366).default(0),
  isActive: z.boolean().optional(),
  accrual: z.enum(ACCRUALS as [string, ...string[]]).default('YEARLY'),
  prorateForJoiners: z.boolean().default(false),
  /** null: unused days lapse at the year end. */
  carryForwardMax: z.coerce.number().min(0).max(366).nullable().optional(),
  /** Carried days used within this many days of the period start, else they lapse; null: they last the period. */
  carryExpiresAfterDays: z.coerce.number().int().min(1).max(365).nullable().optional(),
});

/**
 * The policy HR sets on a type. Every field is optional with no default, so
 * a form that does not show them (Attendance's) leaves them as they are.
 */
const policySchema = z.object({
  description: z.string().trim().max(300).nullable().optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'A colour is #rrggbb.').nullable().optional(),
  allowHalfDay: z.boolean().optional(),
  minNoticeDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  maxDaysPerRequest: z.coerce.number().min(0.5, 'At least half a day.').max(182, 'One request is at most 182 days (26 weeks).').nullable().optional(),
  backdatedDays: z.coerce.number().int().min(0).max(366).nullable().optional(),
  negativeDays: z.coerce.number().min(0, 'Days cannot be negative.').max(366).optional(),
  gender: z.enum(['FEMALE', 'MALE']).nullable().optional(),
  employeeTypeIds: z.array(z.string().min(1)).max(50).optional(),
  /** Only these departments, branches and grades; empty = every one. */
  departmentIds: z.array(z.string().min(1)).max(200).optional(),
  branchIds: z.array(z.string().min(1)).max(200).optional(),
  gradeIds: z.array(z.string().min(1)).max(100).optional(),
  /** A document is asked for with a request longer than this many days; null = never. */
  attachmentAfterDays: z.coerce.number().min(0, 'Days cannot be negative.').max(366).nullable().optional(),
  availableAfterDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  sandwich: z.boolean().optional(),
  isPrivate: z.boolean().optional(),
  /** Days a year by employee type and length of service, over annualDays (leaveBalances.entitledDays). */
  entitlements: z.array(z.object({
    employeeTypeId: z.string().min(1).nullable().optional(),
    minServiceMonths: z.coerce.number().int().min(0).max(600).nullable().optional(),
    annualDays: z.coerce.number().min(0).max(366),
  })).max(20).optional(),
  probationRule: z.enum(['ACCRUE', 'HOLD', 'LOCK']).optional(),
  /** This type's own chain; null = the company's. */
  approval: z.enum(LEAVE_CHAINS as [LeaveChain, ...LeaveChain[]]).nullable().optional(),
  autoApproveUpToDays: z.coerce.number().min(0.5).max(366).nullable().optional(),
  handOnAfterDays: z.coerce.number().int().min(1).max(90).nullable().optional(),
  encashable: z.boolean().optional(),
  maxEncashDays: z.coerce.number().min(0).max(366).nullable().optional(),
  /** What a paid-out day is worth: these monthly wages from the last approved payslip ÷ the divisor (time depth, gap 19). */
  encashBase: z.enum(['BASIC_DA', 'GROSS']).optional(),
  encashDivisor: z.coerce.number().int().refine((n) => n === 26 || n === 30, 'A day is a month ÷ 26 or ÷ 30.').optional(),
  /** When each credit lands: START or END of each part of the leave period, or DAY (creditDay, 1–28). */
  creditOn: z.enum(['START', 'END', 'DAY']).optional(),
  creditDay: z.coerce.number().int().min(1, 'A day from 1 to 28.').max(28, 'A day from 1 to 28, so every month has it.').nullable().optional(),
  /** Statutory leave, each opt-in (TIME-LEAVE-MARKET-RESEARCH.md G1–G3). */
  accrualBasis: z.enum(['CALENDAR', 'PER_DAYS_WORKED']).optional(),
  perDaysWorked: z.coerce.number().min(1, 'At least one day worked per day earned.').max(366).nullable().optional(),
  minDaysWorked: z.coerce.number().min(0).max(366).nullable().optional(),
  oshCarry: z.boolean().optional(),
  countsCalendarDays: z.boolean().optional(),
  availableAfterBasis: z.enum(['JOINING', 'DAYS_WORKED']).optional(),
  /** Leave policy rules (TIME-LEAVE-DECISIONS.md, "Leave policy rules"). */
  unit: z.enum(['DAY', 'HOUR']).optional(),
  /** An hourly type's day in hours: its allowance and balance read in hours, and an hour is this share of a day (null = 8). */
  hoursPerDay: z.coerce.number().min(1, 'A day is at least one hour.').max(24, 'A day is at most 24 hours.').nullable().optional(),
  overBalance: z.enum(['REFUSE', 'LOSS_OF_PAY']).optional(),
  notWithTypeIds: z.array(z.string().min(1)).max(30).optional(),
  sandwichMinDays: z.coerce.number().int().min(2, 'At least two days.').max(60).nullable().optional(),
  sandwichWeekOffs: z.boolean().optional(),
  sandwichHolidays: z.boolean().optional(),
  sandwichIgnoreHalf: z.boolean().optional(),
  onNotice: z.enum(['ALLOW', 'WARN', 'BLOCK']).optional(),
  /** Comp-off credited to the type is used within this many days of the day worked, else it lapses; null: it does not expire (compOff.ts). */
  compOffValidDays: z.coerce.number().int().min(1, 'At least one day.').max(730, 'At most 730 days (two years).').nullable().optional(),
});

async function policyOf(orgId: string, body: unknown): Promise<{ data: Record<string, unknown> } | { error: string }> {
  const parsed = policySchema.safeParse(body || {});
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || 'Check the leave policy.' };
  if (parsed.data.creditOn === 'DAY' && !parsed.data.creditDay) return { error: 'Say which day of the month leave is credited.' };
  if (parsed.data.accrualBasis === 'PER_DAYS_WORKED' && !parsed.data.perDaysWorked) return { error: 'Say how many days worked earn one day of leave.' };
  const ids = [...(parsed.data.employeeTypeIds || []), ...(parsed.data.entitlements || []).map((e) => e.employeeTypeId).filter(Boolean) as string[]];
  if (ids.length) {
    const found = await peoplePrisma.employeeType.count({ where: { orgId, id: { in: [...new Set(ids)] } } });
    if (found !== new Set(ids).size) return { error: 'One of those employee types is not in this company.' };
  }
  for (const e of parsed.data.entitlements || []) if (!e.employeeTypeId && !e.minServiceMonths) return { error: 'An entitlement rule names an employee type, a length of service, or both.' };
  const exist = async (ids: string[] | undefined, count: (ids: string[]) => Promise<number>) => !ids?.length || (await count([...new Set(ids)])) === new Set(ids).size;
  if (!(await exist(parsed.data.departmentIds, (ids) => peoplePrisma.department.count({ where: { orgId, id: { in: ids } } })))) return { error: 'One of those departments is not in this company.' };
  if (!(await exist(parsed.data.branchIds, (ids) => platformPrisma.branch.count({ where: { orgId, id: { in: ids } } })))) return { error: 'One of those branches is not in this company.' };
  if (!(await exist(parsed.data.gradeIds, (ids) => peoplePrisma.grade.count({ where: { orgId, id: { in: ids } } })))) return { error: 'One of those grades is not in this company.' };
  if (parsed.data.approval === 'RULE' && !(await activeLeaveRule(orgId))) return { error: 'Set up the leave approval rule first, in Settings → Approval Rules.' };
  if (!(await exist(parsed.data.notWithTypeIds, (ids) => peoplePrisma.leaveType.count({ where: { orgId, id: { in: ids } } })))) return { error: 'One of the types it may not sit next to is not in this company.' };
  if (parsed.data.unit === 'HOUR' && parsed.data.countsCalendarDays) return { error: 'Hourly leave counts hours on a working day, not calendar days.' };
  return { data: parsed.data };
}

/* Read by whoever enters or decides leave too (Enter leave lists the types), not only by those who set the policy. */
// ---------------------------------------------------------------------------
// Leave block dates
// ---------------------------------------------------------------------------

/** Days nobody may ask for leave (services/attendance/leaveBlocks.ts), soonest first; past blocks drop off after a month. */
leaveRouter.get(`${base}/blocks`, can(PermissionAction.VIEW, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const rows = await peoplePrisma.leaveBlock.findMany({ where: { orgId, toDate: { gte: addDays(today(), -31) } }, orderBy: { fromDate: 'asc' } });
  res.json({ blocks: rows });
});

leaveRouter.post(`${base}/blocks`, can(PermissionAction.EDIT, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = blockSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the block.' });
  const wrong = await checkBlockIds(orgId, parsed.data);
  if (wrong) return res.status(400).json({ error: wrong });
  const block = await peoplePrisma.leaveBlock.create({ data: { ...parsed.data, accountId, orgId, createdByUserId: req.auth!.userId } });
  await recordAudit(req, { entity: 'LeaveBlock', entityId: block.id, action: 'CREATE', message: `Leave blocked ${block.fromDate} to ${block.toDate}: ${block.name}`, metadata: parsed.data });
  res.status(201).json({ block });
});

leaveRouter.put(`${base}/blocks/:id`, can(PermissionAction.EDIT, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const existing = await peoplePrisma.leaveBlock.findFirst({ where: { id: String(req.params.id), orgId } });
  if (!existing) return res.status(404).json({ error: 'No such block.' });
  const parsed = blockSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the block.' });
  const wrong = await checkBlockIds(orgId, parsed.data);
  if (wrong) return res.status(400).json({ error: wrong });
  const block = await peoplePrisma.leaveBlock.update({ where: { id: existing.id }, data: parsed.data });
  await recordAudit(req, { entity: 'LeaveBlock', entityId: block.id, action: 'UPDATE', message: `Leave block changed: ${block.name}, ${block.fromDate} to ${block.toDate}`, metadata: { before: existing, after: parsed.data } });
  res.json({ block });
});

leaveRouter.delete(`${base}/blocks/:id`, can(PermissionAction.EDIT, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const existing = await peoplePrisma.leaveBlock.findFirst({ where: { id: String(req.params.id), orgId } });
  if (!existing) return res.status(404).json({ error: 'No such block.' });
  await peoplePrisma.leaveBlock.delete({ where: { id: existing.id } });
  await recordAudit(req, { entity: 'LeaveBlock', entityId: existing.id, action: 'DELETE', message: `Leave block removed: ${existing.name}, ${existing.fromDate} to ${existing.toDate}` });
  res.json({ ok: true });
});

leaveRouter.get(`${base}/types`, requireAnyPermission([ATTENDANCE_MODULE, PermissionAction.VIEW, R.leaveTypes], [ATTENDANCE_MODULE, PermissionAction.VIEW, R.leave]), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const types = await peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, orderBy: { name: 'asc' } });
  /* The types are policy and listed to anyone who enters leave; how much each was used is counted inside the reader's
     own scope, and a private type's count only for those who read private leave (closure audit: "Maternity: 1" told a team lead too much). */
  const scope = await leaveScope(req);
  const reads = await readsPrivateLeave(req);
  const used = await peoplePrisma.leaveRequest.groupBy({ by: ['leaveTypeId'], where: { accountId, orgId, ...(scope.all ? {} : { employeeId: { in: scope.ids } }) }, _count: { _all: true } });
  const n = new Map(used.map((u) => [u.leaveTypeId, u._count._all]));
  res.json({ types: types.map((t) => ({ ...t, requests: t.isPrivate && !reads ? null : n.get(t.id) || 0 })) });
});

/** The name of the other type in this org already using `code` (codes print on payslips and reports, so one each), or null. */
async function codeTakenBy(orgId: string, code: string | null | undefined, exceptId?: string) {
  const c = (code || '').trim();
  if (!c) return null;
  const other = await peoplePrisma.leaveType.findFirst({ where: { orgId, code: { equals: c, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
  return other?.name ?? null;
}

/*
 * The database holds one code per type too (partial unique index
 * LeaveType_orgId_lower_code_key, migration 20261101090100): two saves at the
 * same moment can both pass codeTakenBy, and the second is refused there. It
 * reaches us as a P2002 (or, from a raw driver error, a 23505), answered like
 * the check's own 409 rather than as a generic clash.
 *
 * Prisma does not say which constraint refused the row (its P2002 here has
 * target null, for the name's constraint as for the code's), so the clash is
 * told apart by asking: LeaveType has one other unique key, (orgId, name), and
 * a clash with no other type of that name is the code's. A save with no code
 * cannot clash on it, and an error that is not a unique violation is not ours.
 */
const isCodeClash = async (e: any, orgId: string, data: { name: string; code?: string | null }, exceptId?: string) => {
  const state = String(e?.code || '');
  if ((state !== 'P2002' && state !== '23505') || !String(data.code || '').trim()) return false;
  const twin = await peoplePrisma.leaveType.findFirst({ where: { orgId, name: data.name, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  return !twin;
};
const codeTaken = (code: string | null | undefined, by: string | null) => ({
  error: `The code ${code} is already used by ${by || 'another leave type'}. Pick another.`,
  code: 'LEAVE_TYPE_CODE_TAKEN',
});

leaveRouter.post(`${base}/types`, can(PermissionAction.CREATE, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  /* A leave type is company policy, like the working week: a team-scoped role does not change it (closure audit). */
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid leave type.' });
  const policy = await policyOf(orgId, req.body);
  if ('error' in policy) return res.status(400).json({ error: policy.error });
  const clash = await codeTakenBy(orgId, parsed.data.code);
  if (clash) return res.status(409).json(codeTaken(parsed.data.code, clash));
  try {
    const type = await peoplePrisma.leaveType.create({
      data: { accountId, orgId, ...parsed.data, ...policy.data, code: parsed.data.code || null, createdByUserId: req.auth!.userId },
    });
    await recordAudit(req, { entity: 'LeaveType', entityId: type.id, action: 'CREATE', message: `Leave type ${type.name}: ${type.isPaid ? `${type.annualDays} days a period, ${type.accrual.toLowerCase().replace('_', '-')}` : 'unpaid'}`, metadata: { ...parsed.data, ...policy.data } });
    res.status(201).json({ type });
  } catch (e) {
    if (await isCodeClash(e, orgId, parsed.data)) return res.status(409).json(codeTaken(parsed.data.code, await codeTakenBy(orgId, parsed.data.code)));
    return sendError(res, e);
  }
});

leaveRouter.put(`${base}/types/:id`, can(PermissionAction.EDIT, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  /* A leave type is company policy, like the working week: a team-scoped role does not change it (closure audit). */
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.leaveType.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such leave type.' });
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid leave type.' });
  if (parsed.data.isPaid !== existing.isPaid && (await peoplePrisma.leaveRequest.count({ where: { orgId, leaveTypeId: existing.id, status: 'APPROVED' } }))) {
    return res.status(409).json({ error: 'Leave of this type has been approved, so whether it is paid cannot change. Make a new type instead.', code: 'LEAVE_POLICY_IN_USE' });
  }
  const policy = await policyOf(orgId, req.body);
  if ('error' in policy) return res.status(400).json({ error: policy.error });
  const clash = await codeTakenBy(orgId, parsed.data.code, existing.id);
  if (clash) return res.status(409).json(codeTaken(parsed.data.code, clash));
  try {
    const type = await peopleWrite(orgId, async () => {
      const financial = ['isPaid', 'annualDays', 'accrual', 'prorateForJoiners', 'carryForwardMax', 'carryExpiresAfterDays', 'creditOn', 'creditDay', 'sandwich', 'accrualBasis', 'perDaysWorked', 'minDaysWorked', 'oshCarry', 'countsCalendarDays', 'unit', 'hoursPerDay', 'sandwichMinDays', 'sandwichWeekOffs', 'sandwichHolidays', 'sandwichIgnoreHalf'] as const;
      const next: Record<string, unknown> = { ...parsed.data, ...policy.data };
      if (Array.isArray(next.notWithTypeIds)) next.notWithTypeIds = (next.notWithTypeIds as string[]).filter((id) => id !== existing.id);
      const changed = financial.some((key) => key in next && JSON.stringify((next as any)[key]) !== JSON.stringify(existing[key]));
      /*
       * Entitlement rules (and the probation rule) may change on a type in use:
       * they apply from the start of the current leave period, so past periods
       * are not re-earned (leaveBalances.entitledDays) and history stays as it was.
       */
      const rulesChanged = 'entitlements' in next && JSON.stringify(next.entitlements) !== JSON.stringify(existing.entitlements);
      if (rulesChanged && (await peoplePrisma.leaveRequest.count({ where: { orgId, leaveTypeId: existing.id } })) + (await peoplePrisma.leaveAllocation.count({ where: { orgId, leaveTypeId: existing.id } })) + (await peoplePrisma.leaveAdjustment.count({ where: { orgId, leaveTypeId: existing.id, reversedAt: null } })) > 0) {
        next.entitlementsFrom = periodStart(await leavePeriodOf(orgId), await leaveYearOf(orgId));
      }
      if (changed) {
        const activity = await Promise.all([
          peoplePrisma.leaveRequest.count({ where: { orgId, leaveTypeId: existing.id } }),
          peoplePrisma.leaveAllocation.count({ where: { orgId, leaveTypeId: existing.id } }),
          peoplePrisma.leaveAdjustment.count({ where: { orgId, leaveTypeId: existing.id, reversedAt: null } }),
        ]);
        const accrued = existing.createdAt.toISOString().slice(0, 10) < today() && await peoplePrisma.employee.count({ where: { orgId } });
        if (activity.some(Boolean) || accrued) throw fail(409, 'This policy already has balances or requests. Create a new leave type for the new entitlement; existing history is preserved.', 'LEAVE_POLICY_IN_USE');
      }
      return peoplePrisma.leaveType.update({ where: { id: existing.id }, data: { ...(next as any), code: parsed.data.code || null } });
    });
    const changed = Object.keys({ ...parsed.data, ...policy.data }).filter((k) => JSON.stringify((type as any)[k]) !== JSON.stringify((existing as any)[k]));
    if (changed.length) await recordAudit(req, { entity: 'LeaveType', entityId: type.id, action: 'UPDATE', message: `Leave type ${type.name} changed: ${changed.join(', ')}`, metadata: Object.fromEntries(changed.map((k) => [k, { before: (existing as any)[k], after: (type as any)[k] }])) });
    res.json({ type });
  } catch (e) {
    if (await isCodeClash(e, orgId, parsed.data, existing.id)) return res.status(409).json(codeTaken(parsed.data.code, await codeTakenBy(orgId, parsed.data.code, existing.id)));
    return sendError(res, e);
  }
});

leaveRouter.delete(`${base}/types/:id`, can(PermissionAction.DELETE, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  /* A leave type is company policy, like the working week: a team-scoped role does not change it (closure audit). */
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const existing = await peoplePrisma.leaveType.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!existing) return res.status(404).json({ error: 'No such leave type.' });
  const used =
    (await peoplePrisma.leaveRequest.count({ where: { orgId, leaveTypeId: existing.id } })) +
    (await peoplePrisma.leaveAllocation.count({ where: { orgId, leaveTypeId: existing.id } }));
  if (used) return res.status(409).json({ error: 'This leave type has requests or balances. Mark it inactive instead.' });
  await deleteToBin(req, 'leaveType', existing);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

leaveRouter.get(`${base}/balances`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = await yearParam(orgId, req.query.year);
  const scope = await leaveScope(req);
  const people = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, status: { not: 'LEFT' }, ...(scope.all ? {} : { id: { in: scope.ids } }) },
    select: { id: true, name: true, code: true, department: true },
    orderBy: { name: 'asc' },
  });
  const { types, balances } = await balancesFor(accountId, orgId, people.map((p) => p.id), year);
  /* A private type (maternity, sick) is not shown at all to those who may not read private leave. */
  const reads = await readsPrivateLeave(req);
  res.json({
    year,
    types: types.filter((t) => t.isActive && (reads || !t.isPrivate)),
    rows: people.map((p) => ({ employeeId: p.id, name: p.name, code: p.code, department: p.department, balances: Object.fromEntries(balances.get(p.id)!) })),
  });
});

leaveRouter.put(`${base}/allocations`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      employeeId: z.string().min(1),
      leaveTypeId: z.string().min(1),
      year: z.coerce.number().int().min(2000).max(2100),
      /** null puts the person back on the type's annual days. */
      days: z.coerce.number().min(0).max(366).nullable(),
      note: z.string().trim().max(200).optional().nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a person, a leave type, a year and the days.' });
  const b = parsed.data;
  try {
    const employee = await employeeIn(orgId, accountId, b.employeeId);
    await scopedOr404(req, employee.id);
    if (await ownBalanceRefused(req, res, employee, 'change')) return;
    const type = await peoplePrisma.leaveType.findFirst({ where: { id: b.leaveTypeId, accountId, orgId } });
    if (!type) return res.status(400).json({ error: 'That leave type is not in this organisation.' });
    if (!type.isPaid) return res.status(400).json({ error: 'Unpaid leave has no balance to set.' });
    const key = { employeeId_leaveTypeId_year: { employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year } };
    const which = { employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: b.year };
    /* Read before the change, in the same write, so the audit line says what it was as well as what it is now. */
    const daysNote = (a: { days: number; note: string | null } | null) => (a ? { days: a.days, note: a.note } : null);
    const out = await peopleWrite(orgId, async () => {
      const before = await peoplePrisma.leaveAllocation.findUnique({ where: key, select: { days: true, note: true } });
      if (b.days === null) {
        await peoplePrisma.leaveAllocation.deleteMany({ where: { orgId, ...which } });
        return { before, allocation: null };
      }
      const allocation = await peoplePrisma.leaveAllocation.upsert({
        where: key,
        create: { accountId, orgId, ...which, days: b.days, note: b.note || null, createdByUserId: req.auth!.userId },
        update: { days: b.days, note: b.note || null },
      });
      return { before, allocation };
    });
    if (!out.allocation) {
      await recordAudit(req, { entity: 'LeaveAllocation', entityId: `${b.employeeId}:${b.leaveTypeId}:${b.year}`, action: 'DELETE', message: `${employee.name}: ${type.name} for ${b.year} back on the policy's days`, metadata: { ...which, before: daysNote(out.before), after: null } });
      return res.json({ allocation: null });
    }
    const allocation = out.allocation;
    await recordAudit(req, { entity: 'LeaveAllocation', entityId: allocation.id, action: 'UPDATE', message: `${employee.name}: ${type.name} for ${b.year} set to ${b.days} days${b.note ? ` (${b.note})` : ''}`, metadata: { ...which, days: b.days, before: daysNote(out.before), after: daysNote(allocation) } });
    res.json({ allocation });
  } catch (e) {
    return sendError(res, e);
  }
});

/*
 * Opening balances from a list (AT-02): a company moving to CLOR mid-year
 * brings each person's days for the year. Same as setting a balance on Leave
 * Balances: the days a person has for that year, in place of the type's own.
 * Rows: employeeCode, leaveType (by name), year, days, note.
 */
leaveRouter.post(`${base}/allocations/import`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > 5000) return res.status(400).json({ error: 'Import up to 5,000 balances at a time.' });
  const dryRun = req.body?.dryRun === true;
  const [byCode, types] = await Promise.all([peopleByCode(orgId), peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, select: { id: true, name: true, isPaid: true } })]);
  const typeByName = new Map(types.map((t) => [t.name.trim().toLowerCase(), t]));
  const results: Array<{ row: number; ok: boolean; error?: string }> = [];
  let imported = 0;
  const currentYear = await leaveYearOf(orgId);
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const emp = byCode.get(codeKey(r.employeeCode ?? r.code));
    if (!emp) { results.push({ row: i + 1, ok: false, error: `No employee with code ${String(r.employeeCode ?? '').trim() || '(blank)'}.` }); continue; }
    const type = typeByName.get(String(r.leaveType || '').trim().toLowerCase());
    if (!type) { results.push({ row: i + 1, ok: false, error: `No leave type called ${String(r.leaveType || '').trim() || '(blank)'}.` }); continue; }
    if (!type.isPaid) { results.push({ row: i + 1, ok: false, error: `${type.name} is unpaid: it has no balance.` }); continue; }
    const year = Number(String(r.year || '').trim()) || currentYear;
    const days = Number(String(r.days ?? '').trim());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { results.push({ row: i + 1, ok: false, error: 'The year is a four-digit year.' }); continue; }
    if (!Number.isFinite(days) || days < 0 || days > 366) { results.push({ row: i + 1, ok: false, error: 'Days are a number from 0 to 366.' }); continue; }
    const note = String(r.note || '').trim().slice(0, 200) || 'Imported opening balance';
    if (!dryRun) {
      await peoplePrisma.leaveAllocation.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: type.id, year } },
        create: { accountId, orgId, employeeId: emp.id, leaveTypeId: type.id, year, days, note, createdByUserId: req.auth!.userId },
        update: { days, note },
      });
    }
    imported += 1;
  }
  if (!dryRun && imported) await recordAudit(req, { entity: 'LeaveAllocation', entityId: orgId, action: 'IMPORT', message: `Imported ${imported} opening ${imported === 1 ? 'balance' : 'balances'}`, metadata: { rows: rows.slice(0, 5000).map((r: any) => ({ employeeCode: r?.employeeCode ?? r?.code, leaveType: r?.leaveType, year: r?.year, days: r?.days })) } });
  res.json({ dryRun, imported, failed: results.length, results });
});

/*
 * Leave already taken, from a list (AT-02): each row becomes an approved
 * request, through the same approval as any other, so its days are marked
 * "on leave" and the balance counts it. A row that overlaps leave already on
 * file, or covers only weekly offs and holidays, is refused and named.
 * Rows: employeeCode, leaveType, from, to, halfDay (FIRST / SECOND / blank), reason.
 */
leaveRouter.post(`${base}/requests/import`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  /* Every row is approved as it lands: importing leave is deciding it, so it takes Leave APPROVE (HR User may not; owner, 8 Nov 2026). */
  const notApprover = await authorize(req, ATTENDANCE_MODULE, PermissionAction.APPROVE, R.leave);
  if (notApprover) return res.status(notApprover.status).json(notApprover.body);
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to import.' });
  if (rows.length > 2000) return res.status(400).json({ error: 'Import up to 2,000 leave rows at a time.' });
  const dryRun = req.body?.dryRun === true;
  const [byCode, types] = await Promise.all([peopleByCode(orgId), peoplePrisma.leaveType.findMany({ where: { accountId, orgId }, select: { id: true, name: true } })]);
  const typeByName = new Map(types.map((t) => [t.name.trim().toLowerCase(), t]));
  const results: Array<{ row: number; ok: boolean; error?: string }> = [];
  let imported = 0;
  const period = await leavePeriodOf(orgId);
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i] || {};
    const emp = byCode.get(codeKey(r.employeeCode ?? r.code));
    if (!emp) { results.push({ row: i + 1, ok: false, error: `No employee with code ${String(r.employeeCode ?? '').trim() || '(blank)'}.` }); continue; }
    const type = typeByName.get(String(r.leaveType || '').trim().toLowerCase());
    if (!type) { results.push({ row: i + 1, ok: false, error: `No leave type called ${String(r.leaveType || '').trim() || '(blank)'}.` }); continue; }
    const from = String(r.from || '').trim();
    const to = String(r.to || '').trim() || from;
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) { results.push({ row: i + 1, ok: false, error: 'Dates are YYYY-MM-DD.' }); continue; }
    if (to < from) { results.push({ row: i + 1, ok: false, error: 'The last day is before the first.' }); continue; }
    if (periodOf(period, from) !== periodOf(period, to)) { results.push({ row: i + 1, ok: false, error: `Leave stays inside one leave period. Split it at ${periodEnd(period, periodOf(period, from))}.` }); continue; }
    const half = String(r.halfDay || '').trim().toUpperCase();
    if (half && !['FIRST', 'SECOND'].includes(half)) { results.push({ row: i + 1, ok: false, error: 'Half day is FIRST, SECOND or blank.' }); continue; }
    if (half && from !== to) { results.push({ row: i + 1, ok: false, error: 'A half-day leave is for one day.' }); continue; }
    const days = await workingDays(orgId, emp, from, to);
    if (!days.length) { results.push({ row: i + 1, ok: false, error: 'Those are all weekly offs or holidays.' }); continue; }
    const clash = await peoplePrisma.leaveRequest.findFirst({ where: { orgId, employeeId: emp.id, status: { in: OPEN }, fromDate: { lte: to }, toDate: { gte: from } } });
    if (clash) { results.push({ row: i + 1, ok: false, error: `Overlaps leave already on file (${clash.fromDate} to ${clash.toDate}).` }); continue; }
    /*
     * Each row is approved as it comes, so your own row is your own leave
     * approved by you: the company's maker-checker decides, as it does in
     * reviewLeave (A-13). Refused, it is named; somebody else imports it.
     */
    const ownUser = (await peoplePrisma.employee.findFirst({ where: { id: emp.id, orgId }, select: { userId: true } }))?.userId;
    if (ownUser && ownUser === req.auth!.userId) {
      const refused = dryRun
        ? !(await selfDecisionAllowed(accountId, orgId, ownUser, permKey(ATTENDANCE_MODULE, R.leave, 'APPROVE'))).allowed
        : await ownWorkRefusal(req, { makers: [ownUser], module: ATTENDANCE_MODULE, resource: R.leave, entity: 'ATTENDANCE_LEAVE_REQUEST', entityId: emp.id, what: 'leave request' });
      if (refused) { results.push({ row: i + 1, ok: false, error: 'This is your own leave; somebody else has to import or approve it.' }); continue; }
    }
    if (!dryRun) {
      let row: any = null;
      try {
        row = await peoplePrisma.leaveRequest.create({
          data: { accountId, orgId, employeeId: emp.id, leaveTypeId: type.id, fromDate: from, toDate: to, days: half ? 0.5 : days.length, halfDay: half || null, reason: String(r.reason || '').trim().slice(0, 500) || 'Imported leave', requestedByUserId: req.auth!.userId },
        });
        await approveLeave(accountId, orgId, row, req.auth!.userId, 'Imported', { chain: false });
      } catch (e: any) {
        /* Approval refused (a closed month, punches on the day): do not leave a stray pending request behind. */
        if (row) await peoplePrisma.leaveRequest.delete({ where: { id: row.id } }).catch(() => null);
        results.push({ row: i + 1, ok: false, error: String(e?.message || 'Not imported.') });
        continue;
      }
    }
    imported += 1;
  }
  if (!dryRun && imported) await recordAudit(req, { entity: 'LeaveRequest', entityId: orgId, action: 'IMPORT', message: `Imported ${imported} leave ${imported === 1 ? 'row' : 'rows'} already taken, approved as they came`, metadata: { rows: rows.slice(0, 2000).map((r: any) => ({ employeeCode: r?.employeeCode ?? r?.code, leaveType: r?.leaveType, from: r?.from, to: r?.to })) } });
  res.json({ dryRun, imported, failed: results.length, results });
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** A long request of a type that asks for a document (LeaveType.attachmentAfterDays). */
export const documentNeeded = (type: { attachmentAfterDays?: number | null }, days: number) => type.attachmentAfterDays != null && days > type.attachmentAfterDays;

const requestSchema = z.object({
  employeeId: z.string().trim().optional(),
  /** The document sent with it: a data URL (or base64 with mime), up to 5 MB; kept on the person's file. */
  attachment: z.object({ name: z.string().trim().max(120).optional(), data: z.string().min(1).max(8_000_000), mime: z.string().max(120).optional() }).nullable().optional(),
  leaveTypeId: z.string().min(1, 'Choose a leave type.'),
  fromDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  toDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
  /** Required, at least three letters, except for a private type, where it is the person's choice. */
  reason: z.string().trim().max(500).optional().default(''),
  /** The first or second half of a single day. */
  halfDay: z.enum(['FIRST', 'SECOND']).nullable().optional(),
  /** A longer leave that starts after lunch on its first day, or ends at lunch on its last (ERPNext's half-day date, at either end). */
  startHalf: z.boolean().optional(),
  endHalf: z.boolean().optional(),
  /** Hourly leave (a type whose unit is HOUR): HH:MM on the one day. */
  fromTime: z.string().trim().nullable().optional(),
  toTime: z.string().trim().nullable().optional(),
  /** Leave crossing the leave-period end is saved as one linked request per period. */
  split: z.boolean().optional(),
});

/** This type's chain: its own (LeaveType.approval) or the company's leave chain. */
export async function leaveChainFor(orgId: string, leaveTypeId: string | null | undefined): Promise<Chain> {
  const t = leaveTypeId ? await peoplePrisma.leaveType.findFirst({ where: { id: leaveTypeId, orgId }, select: { approval: true } }) : null;
  return t?.approval && (CHAINS as string[]).includes(t.approval) ? (t.approval as Chain) : chainFor(orgId, 'leave');
}

export type HistoryEntry = { at: string; by: string | null; what: string; note?: string | null; from?: string | null; to?: string | null };
/** One more line in a request's own history (LeaveRequest.history), newest last. */
export const withHistory = (row: { history?: unknown }, entry: Omit<HistoryEntry, 'at'>): HistoryEntry[] => [...((Array.isArray(row.history) ? row.history : []) as HistoryEntry[]), { at: new Date().toISOString(), ...entry }];

/**
 * A new or changed request of a type that follows the company's leave rule
 * (services/attendance/leaveRules.ts): the rule version is noted on every
 * part and the first step that applies opens; when no step applies, the leave
 * is approved as asked. With no rule in use, or a type on a simple chain, the
 * rows come back as they were (a changed request off the rule leaves it).
 */
async function startRule(accountId: string, orgId: string, rows: any[]): Promise<any[]> {
  const waiting = rows.filter((r) => r.status === 'PENDING');
  if (!waiting.length) return rows;
  const rule = (await configuredLeaveApproval(orgId, waiting[0].leaveTypeId)) === 'RULE' ? await activeLeaveRule(orgId) : null;
  if (!rule) {
    if (!waiting.some((r) => r.ruleId)) return rows;
    const off = [];
    for (const r of rows) off.push(r.ruleId ? await peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { ruleId: null, ruleStep: null, stepUserIds: [], stepDueAt: null, stepRemindedAt: null } }) : r);
    return off;
  }
  const first = waiting[0];
  const days = round(waiting.reduce((a, r) => a + Number(r.days || 0), 0));
  const step = await nextLeaveStep(accountId, orgId, { employeeId: first.employeeId, requestedByUserId: first.requestedByUserId, leaveTypeId: first.leaveTypeId, days }, rule.steps as any, 1, false);
  const lines = [...skippedLines(step.skipped), ...(!step.done && step.lastResort ? [{ what: 'STEP_WAITING', note: `Step ${step.order} sent to the admins: nobody else could decide it.` }] : [])];
  const fresh = [];
  for (const r of waiting) {
    let history = r.history;
    for (const line of lines) history = withHistory({ history }, { by: 'system', ...line });
    fresh.push(await peoplePrisma.leaveRequest.update({
      where: { id: r.id },
      data: { ruleId: rule.id, ruleStep: step.done ? null : step.order, stepUserIds: step.done ? [] : step.users, stepDueAt: step.done ? null : step.dueAt, stepRemindedAt: null, history: history as any },
    }));
  }
  if (!step.done) return fresh;
  /* Every step's condition passes this leave by: approved as asked, and the story says why. */
  return approveByRule(accountId, orgId, fresh, 'No step of the leave approval rule applies', 'Not approved by the rule');
}

/**
 * A leave approved by a rule, not a person (the type's auto-approval, or a
 * leave rule none of whose steps applies). Every part of a leave split at the
 * period end is checked first and all are approved, or none: approving one
 * part and leaving the other waiting for nobody left it pending for ever.
 * When any part cannot be approved, every part waits for a person and the
 * story says why.
 */
async function approveByRule(accountId: string, orgId: string, rows: any[], note: string, skipped: string): Promise<any[]> {
  try {
    for (const row of rows) await approvable(accountId, orgId, row, { chain: false });
  } catch (e) {
    const why = e instanceof Error ? e.message : 'it could not be applied';
    const waiting = [];
    for (const row of rows) waiting.push(await peoplePrisma.leaveRequest.update({ where: { id: row.id }, data: { history: withHistory(row, { by: 'system', what: 'RULE_SKIPPED', note: `${skipped}: ${why}` }) as any } }));
    return waiting;
  }
  const done = [];
  for (const row of rows) {
    await approveLeave(accountId, orgId, row, 'system', note, { chain: false, auto: true });
    done.push(await peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id: row.id } }));
  }
  return done;
}

/**
 * One step of the leave rule, taken by `by` (a user, or portal:<employeeId>):
 * recorded on every waiting part, and the next step that applies opens.
 * Answers whether that was the last step; the caller then approves the leave
 * as that person. Two people deciding the same step at once leave one.
 */
async function takeRuleStep(accountId: string, orgId: string, r: any, by: string, note: string | null): Promise<{ last: boolean; row: any }> {
  return peopleWrite(orgId, async () => {
    const current = await peoplePrisma.leaveRequest.findFirst({ where: { id: r.id, orgId } });
    if (!current || current.status !== 'PENDING' || !current.ruleId || !current.ruleStep) throw fail(409, 'This request is no longer waiting for a step.');
    if (!takesStep(current, [by])) throw fail(403, 'This step is not yours to decide.', 'NOT_YOUR_STEP');
    const parts = current.groupId ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: current.groupId, status: 'PENDING' }, orderBy: { fromDate: 'asc' } }) : [current];
    const days = round(parts.reduce((a, x) => a + x.days, 0));
    const steps = await stepsOf(current.ruleId);
    const approvedBy = [by, ...((Array.isArray(current.history) ? current.history : []) as HistoryEntry[]).filter((h) => h.what === 'STEP_APPROVED' && h.by).map((h) => h.by as string)];
    const next = await nextLeaveStep(accountId, orgId, { employeeId: current.employeeId, requestedByUserId: current.requestedByUserId, leaveTypeId: current.leaveTypeId, days }, steps, current.ruleStep + 1, true, today(), approvedBy);
    const lines = [{ by, what: 'STEP_APPROVED', note: note ? `Step ${current.ruleStep}: ${note}` : `Step ${current.ruleStep}` }, ...skippedLines(next.skipped).map((l) => ({ by: 'system', ...l }))];
    for (const x of parts) {
      let history: unknown = x.history;
      for (const line of lines) history = withHistory({ history }, line);
      const claimed = await peoplePrisma.leaveRequest.updateMany({
        where: { id: x.id, orgId, status: 'PENDING', ruleStep: current.ruleStep },
        data: { ruleStep: next.done ? null : next.order, stepUserIds: next.done ? [] : next.users, stepDueAt: next.done ? null : next.dueAt, stepRemindedAt: null, history: history as any },
      });
      if (!claimed.count) throw fail(409, 'Someone else just decided this step.', 'ALREADY_DECIDED');
    }
    const row = await peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id: current.id } });
    if (!next.done) await announce(orgId, row);
    return { last: next.done, row };
  });
}

/**
 * A decision on a request under the leave rule, by whoever may take the step
 * waiting now (`by`: their user, or portal:<employeeId> in the employee app).
 * A refusal at any step ends it; an approval takes the step, and the last one
 * approves the leave.
 */
export async function decideRuleLeave(accountId: string, orgId: string, r: any, by: string, note: string | null, approve: boolean): Promise<{ request: any; stage?: 'NEXT' }> {
  if (!takesStep(r, [by])) throw fail(403, 'This step is not yours to decide.', 'NOT_YOUR_STEP');
  /*
   * A refusal is checked again under the lock, as an approval is in
   * takeRuleStep: the row the caller read may be a step behind (someone just
   * took this step, and the next one is not this person's).
   */
  if (!approve) {
    return peopleWrite(orgId, async () => {
      const current = await peoplePrisma.leaveRequest.findFirst({ where: { id: r.id, orgId } });
      if (!current || current.status !== 'PENDING' || !current.ruleId || !current.ruleStep) throw fail(409, 'This request is no longer waiting for a step.');
      if (!takesStep(current, [by])) throw fail(403, 'This step is not yours to decide.', 'NOT_YOUR_STEP');
      return { request: await decideLeave(accountId, orgId, current, by, note, false) };
    });
  }
  const { last, row } = await takeRuleStep(accountId, orgId, r, by, note);
  if (!last) return { request: (await withTypes(orgId, [row]))[0], stage: 'NEXT' };
  return { request: await decideLeave(accountId, orgId, row, by, note, true) };
}

/** A request's parts: one, or one per leave period when it crosses a period end. */
function partsOf(period: LeavePeriod, from: string, to: string) {
  const parts: Array<{ year: number; from: string; to: string }> = [];
  for (let f = from; f <= to; ) {
    const year = periodOf(period, f);
    const end = periodEnd(period, year) < to ? periodEnd(period, year) : to;
    parts.push({ year, from: f, to: end });
    f = addDays(end, 1);
  }
  return parts;
}

type Asker = { id: string; branchId: string | null; areaId?: string | null; status?: string | null };
type Ask = { leaveTypeId: string; fromDate: string; toDate: string; halfDay?: 'FIRST' | 'SECOND' | null; startHalf?: boolean; endHalf?: boolean; fromTime?: string | null; toTime?: string | null; reason?: string; attachment?: { data?: string } | null; hasDocument?: boolean };
type Row = { from: string; to: string; halfDay: 'FIRST' | 'SECOND' | null; days: number; minutes?: number | null };
/** Days over the balance (overBalance LOSS_OF_PAY): saved as rows of the unpaid type, in the same group. */
type Overflow = { typeId: string; typeName: string; days: number; from: string; rows: Row[] };

/**
 * The rows one part of a request is saved as. A longer leave that starts after
 * lunch, or ends at lunch, keeps that day as a half-day row of its own, linked
 * to the rest by the group, as a leave split at the period end is: balances,
 * approval, the calendar and payroll already read half days row by row.
 */
export function rowsOf(part: { from: string; to: string; dates: Array<{ date: string; counted: boolean }> }, b: Ask): Row[] {
  const longer = b.fromDate !== b.toDate;
  const head = Boolean(longer && b.startHalf && part.from === b.fromDate);
  const tail = Boolean(longer && b.endHalf && part.to === b.toDate);
  const segs: Array<Omit<Row, 'days'>> = [];
  let from = part.from;
  let to = part.to;
  if (head) { segs.push({ from, to: from, halfDay: 'SECOND' }); from = addDays(from, 1); }
  const last = tail && to >= from ? { from: to, to, halfDay: 'FIRST' as const } : null;
  if (last) to = addDays(to, -1);
  if (from <= to) segs.push({ from, to, halfDay: longer ? null : b.halfDay ?? null });
  if (last) segs.push(last);
  const counted = part.dates.filter((d) => d.counted).map((d) => d.date);
  return segs.map((x) => {
    const n = counted.filter((d) => d >= x.from && d <= x.to).length;
    return { ...x, days: x.halfDay ? (n ? 0.5 : 0) : n };
  }).filter((x) => x.days > 0);
}

/**
 * Everything a request would do, without writing it (AUT-05): each date
 * charged or skipped and why, per leave period; the balance before and
 * after; the policy, overlap and balance problems, in the words the person
 * sees. Used by the preview and, again, by the save, so what the preview
 * says is what the save does.
 */
export async function planLeave(accountId: string, orgId: string, employee: Asker, b: Ask, onBehalf: boolean, ignoreIds: string[] = []) {
  if (!ISO_DATE.test(b.fromDate) || !ISO_DATE.test(b.toDate)) return { error: 'Dates are YYYY-MM-DD.' } as const;
  if (b.toDate < b.fromDate) return { error: 'The last day is before the first.' } as const;
  if (employee.status === 'LEFT') return { error: 'This person has left.' } as const;
  const type = await peoplePrisma.leaveType.findFirst({ where: { id: b.leaveTypeId, accountId, orgId, isActive: true } });
  if (!type) return { error: 'That leave type is not available.' } as const;
  /* The span is per type: 60 days, or the type's own longest request up to 26 weeks (maternity as one request). */
  const span = spanLimitOf(type);
  if (addDays(b.fromDate, span - 1) < b.toDate) return { error: `One request for ${type.name} covers at most ${span} days.` } as const;
  if (b.halfDay && b.fromDate !== b.toDate) return { error: 'A half-day leave is for one day.' } as const;
  if ((b.startHalf || b.endHalf) && b.fromDate === b.toDate) return { error: 'For one day, choose the first or second half.' } as const;
  const longer = b.fromDate !== b.toDate;
  const edges = { halfDay: b.halfDay ?? null, startHalf: longer && Boolean(b.startHalf), endHalf: longer && Boolean(b.endHalf) };
  /* Hourly leave: one day, quarter-hour steps inside that day's shift; each hour is 1/hoursPerDay of a day (gap 23), so the balance reads the same in hours whatever the shift. */
  let hours: { fromTime: string; toTime: string; minutes: number; dayMinutes: number } | null = null;
  if (type.unit === 'HOUR') {
    if (longer) return { error: `${type.name} is taken in hours on one day.` } as const;
    if (b.halfDay) return { error: `${type.name} is taken in hours, not half days.` } as const;
    const from = String(b.fromTime || ''), to = String(b.toTime || '');
    if (!QUARTER_TIME.test(from) || !QUARTER_TIME.test(to)) return { error: 'Give the hours as from and to, in steps of 15 minutes (09:00, 09:15…).' } as const;
    if (minutesOf(to) <= minutesOf(from)) return { error: 'The end is before the start.' } as const;
    const rule = (await shiftFor(orgId, employee.id, b.fromDate)).rule;
    const start = minutesOf(rule.startTime);
    const end = minutesOf(rule.endTime) <= start ? minutesOf(rule.endTime) + 1440 : minutesOf(rule.endTime);
    if (minutesOf(from) < start || minutesOf(to) > end) return { error: `Hourly leave is inside the shift, ${rule.startTime} to ${rule.endTime}.` } as const;
    hours = { fromTime: from, toTime: to, minutes: minutesOf(to) - minutesOf(from), dayMinutes: Math.round((type.hoursPerDay || 8) * 60) };
  } else if (b.fromTime || b.toTime) {
    return { error: `${type.name} is taken in days; hours are for an hourly type.` } as const;
  }
  const period = await leavePeriodOf(orgId);
  const plan = await dayPlan(orgId, employee, b.fromDate, b.toDate, type, edges);
  /* A half day on a night shift is the first or second half of that night. */
  if (b.halfDay && plan.length === 1 && plan[0].night) {
    const cover = nightCover((await shiftFor(orgId, employee.id, b.fromDate)).rule, b.fromDate, b.halfDay);
    if (cover) plan[0].night = cover;
  }
  const t0 = today();
  const parts = [];
  /* Two parts in one period (a half day at the start, then the rest) draw on the same balance: each sees what the one before took. */
  const taken = new Map<number, number>();
  for (const part of partsOf(period, b.fromDate, b.toDate)) {
    const dates = plan.filter((d) => d.date >= part.from && d.date <= part.to);
    const rows = rowsOf({ ...part, dates }, b);
    /* An hour's leave is its share of the shift, never more than the day. */
    /* Kept to four places (review of PR #75): at two, an hour of a 7.5-hour day was 0.13 and the hours drifted as they added up. */
    if (hours) for (const x of rows) { x.days = round4(Math.min(1, hours.minutes / hours.dayMinutes)); x.minutes = hours.minutes; }
    const days = (hours ? round4 : round)(rows.reduce((a, x) => a + x.days, 0));
    let balance: { before: number | null; after: number | null; negativeDays: number; locked?: boolean; lockedUntil?: string | null } = { before: null, after: null, negativeDays: type.negativeDays };
    if (type.isPaid && days) {
      const { balances } = await balancesFor(accountId, orgId, [employee.id], part.year, part.from > t0 ? part.from : undefined);
      const bal = balances.get(employee.id)!.get(type.id)!;
      const before = bal.available == null ? null : round(bal.available - (taken.get(part.year) || 0));
      taken.set(part.year, (taken.get(part.year) || 0) + days);
      /* Locked by probation: nothing can be taken yet, so no days in advance either (the advance would undo the lock). */
      balance = { before, after: before == null ? null : round(before - days), negativeDays: bal.locked ? 0 : type.negativeDays, locked: Boolean(bal.locked), lockedUntil: bal.lockedUntil ?? null };
    }
    parts.push({ ...part, label: periodLabel(period, part.year), days, dates, balance, rows, overflow: null as Overflow | null });
  }
  const total = (hours ? round4 : round)(parts.reduce((a, p) => a + p.days, 0));
  const person = await peoplePrisma.employee.findFirst({ where: { id: employee.id, orgId }, select: { gender: true, employeeTypeId: true, dateOfJoining: true, dateOfLeaving: true, branchId: true, areaId: true, departmentId: true, gradeId: true, status: true } });
  /* Eligibility by days worked in the 12 months before (Code on Social Security, maternity: 80), when the type asks for it. */
  const workedBefore = type.availableAfterBasis === 'DAYS_WORKED' && type.availableAfterDays && person ? (await daysWorkedBefore(accountId, orgId, { id: employee.id, ...person }, b.fromDate)).eligible : null;
  const clash = await peoplePrisma.leaveRequest.findFirst({ where: { orgId, employeeId: employee.id, status: { in: OPEN }, fromDate: { lte: b.toDate }, toDate: { gte: b.fromDate }, ...(ignoreIds.length ? { id: { notIn: ignoreIds } } : {}) } });
  /* Hourly leave and half days share a day with other leave only when they do not cover the same part of it. */
  const sameDay = clash && (hours || edges.halfDay) && clash.fromDate === clash.toDate && clash.fromDate === b.fromDate && ((clash.minutes && hours) || (clash.halfDay && edges.halfDay && clash.halfDay !== edges.halfDay)) ? clash : null;
  const reasonText = String(b.reason || '').trim();
  const problems: Array<{ code: string; message: string; month?: string; months?: string[] }> = [];
  /* What does not stop the request but the asker and the approver should know. */
  const warnings: Array<{ code: string; message: string }> = [];
  /* A closed Attendance month: refused now, not left waiting for an approval that can never happen (O-09). */
  const counted = plan.filter((d) => d.counted).map((d) => d.date);
  const shut = await closedMonthRefusal(orgId, counted.length ? counted : [b.fromDate, b.toDate], 'leave');
  if (shut) problems.push({ code: shut.code, message: shut.message, month: shut.month, months: shut.months });
  if (!total) problems.push({ code: 'NO_WORKING_DAYS', message: 'Those are all weekly offs or holidays — there is nothing to take leave from.' });
  const halfAsked = b.halfDay ?? (b.fromDate !== b.toDate && (b.startHalf || b.endHalf) ? (b.startHalf ? 'SECOND' : 'FIRST') : null);
  const policy = total ? policyProblem(type, person, { fromDate: b.fromDate, halfDay: halfAsked, days: total, workedBefore }, t0, onBehalf) : null;
  if (policy) problems.push({ code: 'LEAVE_POLICY', message: policy });
  /* Leave block dates hold the person asking; HR entering leave for someone is not held to them. */
  const block = !onBehalf && person ? await blockFor(orgId, { id: employee.id, departmentId: person.departmentId }, type.id, counted) : null;
  if (block) problems.push({ code: 'LEAVE_BLOCKED', message: block.message });
  if (clash && !sameDay) problems.push({ code: 'OVERLAP', message: `This overlaps leave already asked for (${clash.fromDate} to ${clash.toDate}).` });
  /* Serving notice (Keka): the type says whether leave is taken then. HR entering it is told, not stopped. */
  if (person?.status === 'ON_NOTICE' && type.onNotice !== 'ALLOW') {
    const leaving = person.dateOfLeaving ? ` (last day ${dayWords(person.dateOfLeaving)})` : '';
    if (type.onNotice === 'BLOCK' && !onBehalf) problems.push({ code: 'ON_NOTICE', message: `${type.name} is not taken while serving notice${leaving}. Ask HR if it must be.` });
    else warnings.push({ code: 'ON_NOTICE', message: `Serving notice${leaving}: the approver sees this.` });
  }
  /* Clubbing: types that may not sit next to each other, weekly offs and holidays between still counting as next to. */
  const club = await clubbingClash(orgId, employee, type, b.fromDate, b.toDate, ignoreIds);
  if (club) problems.push({ code: 'CLUBBING', message: club });
  /* More than the balance: refused, or (LOSS_OF_PAY) the extra days become linked unpaid rows. Not while locked by probation: nothing is taken then. */
  const lop = type.overBalance === 'LOSS_OF_PAY' && type.isPaid && !hours ? await lossOfPayType(orgId) : null;
  for (const p of parts) {
    if (p.balance.locked && p.days > 0) {
      problems.push({ code: 'NO_BALANCE', message: `${type.name} cannot be taken until confirmed${p.balance.lockedUntil ? ` (${dayWords(p.balance.lockedUntil)})` : ''}.` });
    } else if (p.balance.after != null && p.balance.after < -p.balance.negativeDays && type.overBalance === 'LOSS_OF_PAY' && !hours) {
      if (!lop) {
        problems.push({ code: 'NO_BALANCE', message: `Only ${p.balance.before} ${p.balance.before === 1 ? 'day' : 'days'} of ${type.name} ${p.balance.before === 1 ? 'is' : 'are'} left. The rest would be loss of pay, but there is no unpaid leave type: add Loss of Pay in Leave Policy.` });
        continue;
      }
      const cut = overBalance(p.rows, p.dates, round((p.balance.before ?? 0) + p.balance.negativeDays));
      const unpaid = round(cut.unpaid.reduce((a, x) => a + x.days, 0));
      const paidDays = round(p.days - unpaid);
      p.overflow = { typeId: lop.id, typeName: lop.name, days: unpaid, from: cut.unpaid[0].from, rows: cut.unpaid };
      p.rows = cut.paid;
      p.days = paidDays;
      if (cut.paid.length) p.to = cut.paid[cut.paid.length - 1].to;
      p.balance = { ...p.balance, after: round((p.balance.before ?? 0) - paidDays) };
      warnings.push({ code: 'LOSS_OF_PAY', message: `${plural(unpaid, 'day')} over the balance ${unpaid === 1 ? 'is' : 'are'} loss of pay (${lop.name}), from ${dayWords(p.overflow.from)}.` });
    } else if (p.balance.after != null && p.balance.after < -p.balance.negativeDays) {
      const extra = p.balance.negativeDays ? ` (and ${p.balance.negativeDays} in advance)` : '';
      problems.push({ code: 'NO_BALANCE', message: `Only ${p.balance.before} ${p.balance.before === 1 ? 'day' : 'days'} of ${type.name} ${p.balance.before === 1 ? 'is' : 'are'} left${parts.length > 1 ? ` in ${p.label}` : ' this year'}${extra}; this is ${p.days}.` });
    }
  }
  if (!type.isPrivate && reasonText.length < 3) problems.push({ code: 'REASON', message: 'Say why.' });
  /* A long request asks for a document (a medical certificate) when the type says so; HR entering it is not held to it. */
  if (documentNeeded(type, total) && !onBehalf && !b.attachment?.data && !b.hasDocument) problems.push({ code: 'DOCUMENT', message: `${type.name} for more than ${type.attachmentAfterDays} ${type.attachmentAfterDays === 1 ? 'day' : 'days'} needs a document, such as a medical certificate. Attach it to ask.` });
  /* total: what this type is charged (days over the balance are the loss-of-pay part, not this type's); asked: the whole request. */
  const charged = (hours ? round4 : round)(parts.reduce((a, p) => a + p.days, 0));
  return { type, parts, total: charged, asked: total, problems, warnings, clash, split: parts.length > 1, reason: reasonText, edges, hours, lossOfPay: parts.some((p) => p.overflow) } as const;
}

/**
 * Splits a part's rows where the balance runs out: whole days and halves in
 * date order are paid while the room lasts, the rest is loss of pay. Each
 * part ends and starts on a working day: weekly offs and holidays between
 * the last paid day and the first unpaid one are neither, so each request
 * counts the same again when it is approved. A row that straddles the cut
 * becomes two.
 */
export function overBalance(rows: Row[], dates: Array<{ date: string; counted: boolean; off?: string }>, room: number) {
  const weightOf = (d: string) => { const x = rows.find((r) => d >= r.from && d <= r.to); return x ? (x.halfDay ? 0.5 : 1) : 0; };
  let left = room;
  let short = false;
  let lastPaid: string | null = null;
  for (const d of dates) {
    if (!d.counted) continue;
    const w = weightOf(d.date);
    if (w > left + 1e-9) { short = true; break; }
    left = round(left - w);
    if (!d.off) lastPaid = d.date;
  }
  if (!short) return { paid: rows, unpaid: [] as Row[] };
  const paidEnd = lastPaid ?? '';
  const firstUnpaid = lastPaid ? dates.find((d) => d.counted && !d.off && d.date > paidEnd)?.date ?? addDays(paidEnd, 1) : rows[0].from;
  const count = (from: string, to: string, half: Row['halfDay']) => { const n = dates.filter((d) => d.counted && d.date >= from && d.date <= to).length; return half ? (n ? 0.5 : 0) : n; };
  const paid: Row[] = [], unpaid: Row[] = [];
  for (const r of rows) {
    if (lastPaid && r.from <= paidEnd) { const to = r.to < paidEnd ? r.to : paidEnd; paid.push({ ...r, to, days: count(r.from, to, r.halfDay) }); }
    if (r.to >= firstUnpaid) { const from = r.from > firstUnpaid ? r.from : firstUnpaid; unpaid.push({ ...r, from, days: count(from, r.to, r.halfDay) }); }
  }
  return { paid: paid.filter((r) => r.days > 0), unpaid: unpaid.filter((r) => r.days > 0) };
}

/** The company's unpaid type that takes days over a balance: the one coded LOP, else the first unpaid type in use. */
async function lossOfPayType(orgId: string) {
  const unpaid = await peoplePrisma.leaveType.findMany({ where: { orgId, isActive: true, isPaid: false, unit: 'DAY' }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } });
  return unpaid.find((t) => String(t.code || '').toUpperCase() === 'LOP') || unpaid[0] || null;
}

/**
 * Clubbing (Keka, Zoho): a type may name types that cannot sit next to it, and
 * the rule works both ways. "Next to" skips the weekly offs and holidays
 * between, so Casual on Friday and Earned on Monday are next to each other.
 */
async function clubbingClash(orgId: string, employee: Asker, type: { id: string; name: string; notWithTypeIds: string[] }, from: string, to: string, ignoreIds: string[]) {
  const others = await peoplePrisma.leaveType.findMany({ where: { orgId, OR: [{ id: { in: type.notWithTypeIds } }, { notWithTypeIds: { has: type.id } }] }, select: { id: true, name: true } });
  if (!others.length) return null;
  /* The working day before the first and after the last (two weeks either way is plenty). */
  const before = (await dayPlan(orgId, employee, addDays(from, -14), addDays(from, -1), false)).filter((d) => d.counted).at(-1)?.date || addDays(from, -1);
  const after = (await dayPlan(orgId, employee, addDays(to, 1), addDays(to, 14), false)).find((d) => d.counted)?.date || addDays(to, 1);
  const near = await peoplePrisma.leaveRequest.findFirst({
    where: {
      orgId, employeeId: employee.id, status: { in: OPEN }, leaveTypeId: { in: others.map((t) => t.id) },
      ...(ignoreIds.length ? { id: { notIn: ignoreIds } } : {}),
      OR: [{ toDate: { gte: before, lt: from } }, { fromDate: { gt: to, lte: after } }],
    },
    select: { leaveTypeId: true, fromDate: true, toDate: true },
  });
  if (!near) return null;
  const name = others.find((t) => t.id === near.leaveTypeId)!.name;
  return `${type.name} cannot be taken next to ${name} (${near.fromDate === near.toDate ? dayWords(near.fromDate) : `${dayWords(near.fromDate)} to ${dayWords(near.toDate)}`}).`;
}

/**
 * Whether this person's own leave must be approved by somebody else: they
 * can approve leave themselves, and the company's maker-checker setting
 * (makerChecker.ts) would refuse them approving their own (STRICT, or AUTO
 * while another approver exists). The same answer reviewLeave's
 * ownWorkRefusal gives them.
 */
async function ownLeaveHeld(accountId: string, orgId: string, employeeId: string) {
  const own = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { userId: true } });
  if (!own?.userId) return false;
  const permission = permKey(ATTENDANCE_MODULE, R.leave, 'APPROVE');
  const access = await resolveAccess(accountId, orgId, own.userId);
  if (!access.isAdmin && !access.permissions.has(permission)) return false;
  return !(await selfDecisionAllowed(accountId, orgId, own.userId, permission)).allowed;
}

/** `by` is who asks: the signed-in user, or — from the employee portal — the employee themselves. */
export async function createLeave(
  req: any,
  res: any,
  employee: Asker,
  by?: { accountId: string; orgId: string; userId: string },
  /** HR entering leave for someone is not held to notice or how far back. */
  opts: { onBehalf?: boolean } = {}
) {
  const { accountId, orgId } = by || req.tenant!;
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request.' });
  const b = parsed.data;
  const first = await planLeave(accountId, orgId, employee, b, Boolean(opts.onBehalf));
  if ('error' in first) return res.status(400).json({ error: first.error });
  const closed = first.problems.find((p) => p.code === 'ATTENDANCE_MONTH_CLOSED');
  if (closed) return res.status(409).json({ error: closed.message, code: closed.code, month: closed.month, months: closed.months });
  if (first.split && !b.split) {
    const end = first.parts[0].to;
    return res.status(400).json({ error: `Leave stays inside one leave period (${first.parts[0].label}). Split it at ${end}.`, code: 'CROSSES_PERIOD', splitAt: end });
  }
  /* Reason, policy and "nothing to take" are the person's to fix; overlap and balance are checked again under the lock. */
  const early = first.problems.find((p) => ['REASON', 'NO_WORKING_DAYS', 'LEAVE_POLICY', 'LEAVE_BLOCKED', 'DOCUMENT', 'ON_NOTICE', 'CLUBBING'].includes(p.code));
  if (early) return res.status(400).json({ error: early.message, code: early.code === 'REASON' ? undefined : early.code });
  const file = b.attachment?.data ? decodeDocument(b.attachment.data, b.attachment.mime) : null;
  if (file && 'error' in file) return res.status(400).json({ error: file.error, code: 'DOCUMENT' });
  /*
   * Auto-approval is the type's rule, but the person may be a leave approver
   * themselves: under the company's own-leave maker-checker (A-13), their own
   * leave waits for somebody else, as reviewLeave would ask, not for 'system'.
   */
  const autoAllowed = !opts.onBehalf && (first.type.autoApproveUpToDays == null || !(await ownLeaveHeld(accountId, orgId, employee.id)));

  /*
   * Check and insert under one lock per employee. As separate steps, a double
   * tap in the portal passed the overlap and balance checks twice and saved two
   * overlapping requests, overdrawing the balance. The second request now waits
   * here, then sees the first one and is refused.
   */
  const outcome = await peopleWrite(orgId, async (): Promise<{ status: number; body: Record<string, unknown> } | { rows: any[] }> => {
    const tx = peoplePrisma;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${employee.id}`}))`;
    const plan = await planLeave(accountId, orgId, employee, b, Boolean(opts.onBehalf));
    if ('error' in plan) return { status: 400, body: { error: plan.error } };
    const closedNow = plan.problems.find((p) => p.code === 'ATTENDANCE_MONTH_CLOSED');
    if (closedNow) return { status: 409, body: { error: closedNow.message, code: closedNow.code, month: closedNow.month, months: closedNow.months } };
    const overlap = plan.problems.find((p) => p.code === 'OVERLAP');
    if (overlap) return { status: 409, body: { error: overlap.message } };
    const short = plan.problems.find((p) => p.code === 'NO_BALANCE');
    if (short) return { status: 400, body: { error: short.message, code: 'NO_BALANCE' } };
    const saved = plan.parts.flatMap((p) => [...p.rows, ...(p.overflow?.rows || [])]);
    const groupId = saved.length > 1 ? `lg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : null;
    const asker = by?.userId || req.auth!.userId;
    const story = { at: new Date().toISOString(), by: asker, what: opts.onBehalf ? 'ENTERED' : 'ASKED' };
    const common = { accountId, orgId, employeeId: employee.id, reason: plan.reason, groupId, requestedByUserId: asker, fromTime: plan.hours?.fromTime ?? null, toTime: plan.hours?.toTime ?? null };
    let rows = [];
    for (const part of plan.parts) {
      let paidId: string | null = null;
      for (const x of part.rows) {
        const row = await tx.leaveRequest.create({ data: { ...common, leaveTypeId: plan.type.id, fromDate: x.from, toDate: x.to, days: x.days, halfDay: x.halfDay, minutes: x.minutes ?? null, history: [story] } });
        paidId ??= row.id;
        rows.push(row);
      }
      /* Days over the balance (overBalance LOSS_OF_PAY): the unpaid rows, decided with the paid ones (same group). */
      for (const x of part.overflow?.rows || []) {
        rows.push(await tx.leaveRequest.create({ data: { ...common, leaveTypeId: part.overflow!.typeId, fromDate: x.from, toDate: x.to, days: x.days, halfDay: x.halfDay, overflowOfId: paidId, history: [{ ...story, note: `Over the ${plan.type.name} balance: loss of pay` }] } }));
      }
    }
    if (file) {
      const docId = await keepLeaveDocument(accountId, orgId, employee.id, plan.type, rows[0], file, b.attachment?.name, asker);
      rows = await Promise.all(rows.map((row) => tx.leaveRequest.update({ where: { id: row.id }, data: { attachmentDocId: docId } })));
    }
    /*
     * The type's own rule (autoApproveUpToDays): a person's own short request,
     * within their balance, is approved as it is sent — no one waits for a
     * two-day casual leave. HR entering leave for someone still goes through
     * the chain, and so does anything longer than the rule allows.
     */
    const withinBalance = plan.parts.every((p) => p.balance.after == null || p.balance.after >= 0) && !plan.lossOfPay;
    const autoApproves = autoAllowed && plan.type.autoApproveUpToDays != null && plan.total <= plan.type.autoApproveUpToDays && withinBalance;
    /* A company whose leave is on the approval engine (workflow engine 2c): the type's auto-approval and the leave rule are the engine's. */
    const onEngine = await goesOnEngine(orgId, plan.type.id);
    if (autoApproves && !onEngine) {
      /* The rule could not approve it (a clock-in that day, a closed month, something approved on it): it waits for a person instead, and the story says why. */
      rows = await approveByRule(accountId, orgId, rows, 'Approved by the leave rule', 'Not approved by the leave rule');
    }
    /* Still waiting, and its type follows the company's leave rule: the first step opens. */
    if (!onEngine) rows = await startRule(accountId, orgId, rows);
    /* On the engine: its request opens there, approved by the rule when the type approves it on its own. */
    const waitingBefore = new Set(rows.filter((r: any) => r.status === 'PENDING').map((r: any) => r.id));
    rows = await openLeaveOnEngine(accountId, orgId, rows, { autoApproved: autoApproves ? 'Approved by the leave rule' : null });
    /* Announced inside the transaction: the notice is queued with the request (closure audit O-07). One the engine approved at once was announced when it was approved: once is enough. */
    const shaped: any[] = [];
    for (const row of rows) shaped.push(waitingBefore.has(row.id) && row.status !== 'PENDING' ? (await withTypes(orgId, [row]))[0] : await announce(orgId, row));
    return { rows: shaped };
  });
  if (!('rows' in outcome)) return res.status(outcome.status).json(outcome.body);
  const shaped = outcome.rows;
  res.status(201).json({ request: shaped[0], ...(shaped.length > 1 ? { requests: shaped } : {}) });
}

/**
 * The document sent with a leave request, kept on the person's file like any
 * other (a certificate), so it is where HR looks for it later. Private leave's
 * document is confidential: it opens for those who read confidential files,
 * and for whoever decides the leave, through the request.
 */
async function keepLeaveDocument(accountId: string, orgId: string, employeeId: string, type: { name: string; isPrivate: boolean }, r: { fromDate: string; toDate: string }, file: { mime: string; data: Buffer }, name: string | undefined, by: string) {
  const when = r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`;
  const doc = await peoplePrisma.employeeDocument.create({
    data: {
      accountId, orgId, employeeId, kind: 'CERTIFICATE', title: `${type.name}, ${when}${name ? ` (${name})` : ''}`.slice(0, 120), mime: file.mime, size: file.data.length, data: file.data,
      classification: type.isPrivate ? 'CONFIDENTIAL' : 'EMPLOYEE_VISIBLE', visibleToEmployee: !type.isPrivate, uploadedByUserId: by,
    },
    select: { id: true },
  });
  return doc.id;
}

/** Undo an approved leave's days. Days someone clocked in on anyway are theirs, and stay. */
async function clearLeaveDays(orgId: string, requestId: string) {
  const linked = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, leaveRequestId: requestId }, select: { date: true, employeeId: true } });
  for (const day of linked) await assertMonthOpen(orgId, day.date, day.employeeId);
  /* A half-day leave's day keeps its punches: worked out again without the leave. */
  const halves = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, leaveRequestId: requestId, status: { not: 'ON_LEAVE' } } });
  for (const h of halves) {
    const emp = await peoplePrisma.employee.findFirst({ where: { id: h.employeeId, orgId }, select: { id: true, branchId: true, areaId: true } });
    if (!emp) continue;
    await writeDay({ accountId: h.accountId, orgId, userId: 'system', employee: emp, date: h.date, checkIn: h.checkIn, checkOut: h.checkOut, source: h.source === 'LEAVE' ? 'DEVICE' : h.source, leaveRequestId: null, reason: 'Half-day leave cancelled or rejected' });
  }
  const cleared = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, leaveRequestId: requestId, status: 'ON_LEAVE', checkIn: null } });
  await peoplePrisma.attendanceRecord.deleteMany({ where: { orgId, leaveRequestId: requestId, status: 'ON_LEAVE', checkIn: null } });
  for (const r of cleared) {
    await logDayChange({ accountId: r.accountId, orgId, employeeId: r.employeeId, date: r.date, recordId: r.id, action: 'LEAVE_CANCELLED', before: r, after: null, userId: 'system', reason: 'Leave cancelled or rejected' });
  }
}

const STATUSES_ = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

/**
 * Leave requests. With `limit` (People's list): one page, searched and
 * filtered on the server, with the total and a count per status for the tabs.
 * Without it (Attendance's screen, the calendar), the old shape, still capped.
 * Always inside the caller's team scope, private leave masked.
 */
leaveRouter.get(`${base}/requests`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const scope = await leaveScope(req);
  const status = String(req.query.status || '').trim();
  const employeeId = String(req.query.employeeId || '').trim();
  /* ?month=YYYY-MM: requests touching that month (the leave calendar). */
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : '';
  const inMonth = month ? { fromDate: { lte: `${month}-31` }, toDate: { gte: `${month}-01` } } : {};
  /* ?from&to: requests touching the range (the overview's week). */
  const from = ISO_DATE.test(String(req.query.from || '')) ? String(req.query.from) : '';
  const to = ISO_DATE.test(String(req.query.to || '')) ? String(req.query.to) : '';
  const inRange = from && to ? { fromDate: { lte: to }, toDate: { gte: from } } : {};
  /* ?year=: applications starting in that leave period (the register of applications). */
  const yearQ = Number(req.query.year);
  const period = Number.isInteger(yearQ) && yearQ >= 2000 && yearQ <= 2100 ? await leavePeriodOf(orgId) : null;
  const inYear = period ? { fromDate: { gte: periodStart(period, yearQ), lte: periodEnd(period, yearQ) } } : {};
  let leaveTypeId = String(req.query.leaveTypeId || '').trim();
  /* Filtering by a private type would name who took it: for a non-reader it finds nothing. */
  if (leaveTypeId && !(await readsPrivateLeave(req)) && (await peoplePrisma.leaveType.findFirst({ where: { id: leaveTypeId, orgId }, select: { isPrivate: true } }))?.isPrivate) leaveTypeId = '__none__';
  /* Search and department narrow the people first, then the requests: name, employee ID. */
  const q = String(req.query.q || '').trim().slice(0, 80);
  const departmentId = String(req.query.departmentId || '').trim();
  let people: string[] | null = scope.all ? null : scope.ids;
  if (q || departmentId) {
    const found = await peoplePrisma.employee.findMany({
      where: { orgId, ...(people ? { id: { in: people } } : {}), ...(departmentId ? { departmentId } : {}), ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] } : {}) },
      select: { id: true },
      take: 5000,
    });
    people = found.map((f) => f.id);
  }
  const base_ = { accountId, orgId, ...(employeeId ? { employeeId } : {}), ...(people ? { employeeId: employeeId ? (people.includes(employeeId) ? employeeId : '__none__') : { in: people } } : {}), ...(leaveTypeId ? { leaveTypeId } : {}), ...inMonth, ...inRange, ...inYear };
  const where = { ...base_, ...(status ? { status } : {}) };
  const reads = await readsPrivateLeave(req);
  const limitQ = Number(req.query.limit);
  if (Number.isInteger(limitQ) && limitQ > 0) {
    const limit = Math.min(100, limitQ);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    /* Waiting: oldest first, so what has waited longest is on top; the rest newest first. */
    const orderBy: any = status === 'PENDING' ? [{ createdAt: 'asc' }] : [{ fromDate: 'desc' }, { createdAt: 'desc' }];
    const [rows, total, grouped] = await Promise.all([
      peoplePrisma.leaveRequest.findMany({ where, orderBy, take: limit, skip: offset }),
      peoplePrisma.leaveRequest.count({ where }),
      peoplePrisma.leaveRequest.groupBy({ by: ['status'], where: base_, _count: { _all: true } }),
    ]);
    const counts: Record<string, number> = Object.fromEntries(STATUSES_.map((k) => [k, 0]));
    for (const g of grouped) counts[g.status] = g._count._all;
    counts.all = Object.values(counts).reduce((a, n) => a + n, 0);
    return res.json({ requests: masked(await withTypes(orgId, rows), reads), total, counts, limit, offset });
  }
  const rows = await peoplePrisma.leaveRequest.findMany({
    where,
    orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
    take: period ? 5000 : 500,
  });
  res.json({ requests: masked(await withTypes(orgId, rows), reads) });
});

leaveRouter.post(`${base}/requests`, can(PermissionAction.CREATE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  try {
    const employee = await employeeIn(req.tenant!.orgId, req.tenant!.accountId, String(req.body?.employeeId || ''));
    await scopedOr404(req, employee.id);
    /* Your own leave entered here keeps the rules your employee app would (notice, back-dating): on behalf means somebody else's. */
    const ownFile = await peoplePrisma.employee.findFirst({ where: { id: employee.id, orgId: req.tenant!.orgId }, select: { userId: true } });
    await createLeave(req, res, employee, undefined, { onBehalf: ownFile?.userId !== req.auth!.userId });
    if (res.statusCode === 201) await recordAudit(req, { entity: 'LeaveRequest', entityId: employee.id, action: 'CREATE', message: `Entered leave for ${employee.name}, ${req.body?.fromDate} to ${req.body?.toDate}`, metadata: { employeeId: employee.id, leaveTypeId: req.body?.leaveTypeId, fromDate: req.body?.fromDate, toDate: req.body?.toDate } });
    return;
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * Everything approveLeave checks before it writes a day, without writing
 * anything: throws the same `fail` errors. A leave split at the period end is
 * checked part by part first, so the rule approves all of it or none.
 */
export async function approvable(accountId: string, orgId: string, r: any, opts: { chain?: boolean } = {}) {
  return peopleWrite(orgId, async () => {
    const current = await peoplePrisma.leaveRequest.findFirst({ where: { id: r.id, accountId, orgId } });
    if (!current || current.status !== 'PENDING') throw fail(409, 'This request is no longer pending.');
    r = current;
    if (opts.chain !== false && !r.ruleId) {
      const turn = await hrMayDecide(orgId, 'leave', r, await leaveChainFor(orgId, r.leaveTypeId));
      if (!turn.ok) throw fail(409, turn.error, 'MANAGER_FIRST');
    }
    const employee = await employeeIn(orgId, accountId, r.employeeId);
    const type = await peoplePrisma.leaveType.findFirst({ where: { id: r.leaveTypeId, orgId } });
    if (!type) throw fail(409, 'The leave type is gone.');
    /* Holidays or shifts may have changed since it was asked for: count again. */
    const days = await leaveDays(orgId, employee, r.fromDate, r.toDate, type);
    if (!days.length) throw fail(409, 'Nothing in this range is a working day any more. Reject it instead.');
    /* A half day or hours sit beside the punches of the rest of the day; a whole day must have none. */
    const part = r.halfDay || r.minutes;
    const worked = part
      ? null
      : await peoplePrisma.attendanceRecord.findFirst({ where: { orgId, employeeId: r.employeeId, date: { in: days }, checkIn: { not: null } }, select: { date: true } });
    if (worked) throw fail(409, `${worked.date} has a clock-in. Correct that day first, or reject this request.`);
    /* Approved WFH or on duty on one of the days: the same rule as the other way round (requests.ts refuses WFH over approved leave). */
    const onDuty = part
      ? null
      : await peoplePrisma.attendanceRequest.findFirst({ where: { orgId, employeeId: r.employeeId, kind: { in: ['WFH', 'ON_DUTY'] }, status: 'APPROVED', date: { lte: days[days.length - 1] }, OR: [{ toDate: null, date: { in: days } }, { toDate: { gte: days[0] } }] }, select: { kind: true, date: true, toDate: true } });
    if (onDuty) throw fail(409, `${onDuty.kind === 'WFH' ? 'Work from home' : 'On duty'} is approved for ${onDuty.toDate && onDuty.toDate !== onDuty.date ? `${dayWords(onDuty.date)} to ${dayWords(onDuty.toDate)}` : dayWords(onDuty.date)}. Cancel it first, or reject this request.`, 'ON_DUTY');
    const count = round(days.reduce((a, d) => a + weightOn(r, d), 0));
    if (type.isPaid) {
      const { balances } = await balancesFor(accountId, orgId, [r.employeeId], await leaveYearOf(orgId, r.fromDate), r.fromDate > today() ? r.fromDate : undefined);
      const bal = balances.get(r.employeeId)!.get(type.id)!;
      /* Locked by probation since it was asked (or asked before the lock was set): it cannot be approved, advance or not. */
      if (bal.locked) throw fail(409, `${type.name} cannot be taken until confirmed${bal.lockedUntil ? ` (${dayWords(bal.lockedUntil)})` : ''}.`, 'NO_BALANCE');
      /* This request is in "pending" already; what matters is what is left without it. */
      const left = (bal.available ?? Infinity) + r.days + type.negativeDays;
      if (count > left) throw fail(409, `Only ${round(left)} days of ${type.name} are left this year; this is ${count}.`, 'NO_BALANCE');
    }
    /* Checked before any day is written, so an approval never stops halfway through a closed month. */
    const shut = await closedMonths(orgId, days.map((d) => d.slice(0, 7)));
    if (shut.size) throw fail(409, `${[...shut].sort().join(', ')} ${shut.size === 1 ? 'is' : 'are'} closed in Attendance. Reopen it to approve leave in it.`, 'ATTENDANCE_MONTH_CLOSED');
    /* Nor where Payroll has already taken the days (every mode, People-only included). */
    for (const d of days) {
      const taken = await payrollTaken(orgId, r.employeeId, d);
      if (taken) throw new PayrollTakenError(taken.period, taken.state);
    }
    return { r, employee, type, days, count };
  });
}

/**
 * Approve a pending request: count its working days again, check nothing was
 * worked on them, the balance, and that no month is closed, then write the
 * days. Throws `fail` errors (sendError or the public API answer them).
 */
/** `chain: false`: leave already taken, imported from a list, is not waiting on anybody's step. */
export async function approveLeave(accountId: string, orgId: string, r: any, userId: string, note: string | null, opts: { chain?: boolean; auto?: boolean } = {}) {
  return peopleWrite(orgId, async () => {
    const checked = await approvable(accountId, orgId, r, opts);
    r = checked.r;
    const { employee, type, days, count } = checked;
    if (partOfDay(r, r.fromDate)) {
      /* The day keeps its punches; it is worked out with half of it, or the hours, as leave (writeDay's halfDayLeave and leaveHours rules). */
      const day = days[0];
      const half = halfOn(r, day);
      const what = half ? `${half === 'FIRST' ? 'first' : 'second'} half` : `${r.fromTime} to ${r.toTime}`;
      const existing = await peoplePrisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: r.employeeId, date: day } } });
      await writeDay({
        accountId, orgId, userId, employee, date: day,
        checkIn: existing?.checkIn ?? null, checkOut: existing?.checkOut ?? null,
        source: existing?.source && existing.source !== 'LEAVE' ? existing.source : 'DEVICE',
        leaveRequestId: r.id, halfDayLeave: half, leaveHours: !half && r.minutes ? { fromTime: r.fromTime, toTime: r.toTime, minutes: r.minutes } : null,
        /* A private type's name and reason stay off the day record, which attendance staff read. */
        note: type.isPrivate ? `${PRIVATE_LABEL}, ${what}` : `${type.name}, ${what}: ${r.reason}`.slice(0, 500),
      });
    } else {
      for (const date of days) {
        await writeDay({
          accountId,
          orgId,
          userId,
          employee,
          date,
          checkIn: null,
          checkOut: null,
          statusOverride: 'ON_LEAVE',
          source: 'LEAVE',
          leaveRequestId: r.id,
          note: type.isPrivate ? PRIVATE_LABEL : `${type.name}: ${r.reason}`.slice(0, 500),
        });
      }
    }
    /* Only while still pending: a second approval at the same moment rolls this whole transaction back (A-13). */
    const claimed = await peoplePrisma.leaveRequest.updateMany({
      where: { id: r.id, status: 'PENDING' },
      data: { status: 'APPROVED', days: count, reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: note, autoApproved: Boolean(opts.auto), history: withHistory(r, { by: userId, what: opts.auto ? 'AUTO_APPROVED' : 'APPROVED', note }) },
    });
    if (claimed.count !== 1) throw fail(409, 'This request is no longer pending.');
    const updated = await peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } });
    return announce(orgId, updated);
  });
}

export async function rejectLeave(orgId: string, r: any, userId: string, note: string | null) {
  return peopleWrite(orgId, async () => {
    const current = await peoplePrisma.leaveRequest.findFirst({ where: { id: r.id, orgId } });
    if (!current || current.status !== 'PENDING') throw fail(409, 'This request is no longer pending.');
    const updated = await peoplePrisma.leaveRequest.update({
      where: { id: r.id },
      data: { status: 'REJECTED', reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: note, history: withHistory(current, { by: userId, what: 'REJECTED', note }) },
    });
    return announce(orgId, updated);
  });
}

/**
 * A decision on a request, and on every other waiting part of the same leave
 * split at the period end, in one transaction: what the person asked for was
 * one leave, so it is approved or refused as one.
 */
/** `opts.chain: false`: the approval engine decided who approves (leave on the engine); the chain's own turn is not asked again. */
export async function decideLeave(accountId: string, orgId: string, r: any, userId: string, note: string | null, approve: boolean, opts: { chain?: boolean; auto?: boolean } = {}) {
  const out = await decideLeaveParts(accountId, orgId, r, userId, note, approve, opts);
  /* After the decision is written: telemetry never decides whether it stands. */
  const decision = approve ? 'approved' : 'rejected';
  void trackFirst(orgId, userId, 'leave_decided', { decision, channel: String(userId).startsWith('portal:') ? 'app' : 'web' }, { decision });
  return out;
}

async function decideLeaveParts(accountId: string, orgId: string, r: any, userId: string, note: string | null, approve: boolean, opts: { chain?: boolean; auto?: boolean } = {}) {
  return peopleWrite(orgId, async () => {
    const parts = r.groupId ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: r.groupId, status: 'PENDING', id: { not: r.id } }, orderBy: { fromDate: 'asc' } }) : [];
    const first = approve ? await approveLeave(accountId, orgId, r, userId, note, opts) : await rejectLeave(orgId, r, userId, note);
    for (const x of parts) {
      if (approve) await approveLeave(accountId, orgId, x, userId, note, opts);
      else await rejectLeave(orgId, x, userId, note);
    }
    return first;
  });
}

/**
 * The manager's step under "manager, then HR": recorded on the request (and
 * its other parts), which stays waiting for HR. From the employee app or,
 * for a manager with a CLOR sign-in, from People.
 */
/** `actor`: whoever took the step when it was not the manager themselves (their stand-in): recorded as theirs, so the story is true and they cannot take HR's step after it. */
export async function managerStep(orgId: string, r: any, managerId: string, note: string | null, actor?: { employeeId: string; userId?: string | null }) {
  return peopleWrite(orgId, async () => {
    const ids = r.groupId ? (await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: r.groupId, status: 'PENDING' }, select: { id: true } })).map((x) => x.id) : [r.id];
    const actorId = actor?.employeeId || managerId;
    const stoodIn = actorId !== managerId;
    const manager = await peoplePrisma.employee.findFirst({ where: { id: managerId, orgId }, select: { name: true, userId: true } });
    const by = stoodIn ? actor?.userId || `portal:${actorId}` : manager?.userId || `portal:${managerId}`;
    const said = stoodIn ? `${note ? `${note} ` : ''}(stood in for ${manager?.name || 'the manager'})` : note;
    const changed = await peoplePrisma.leaveRequest.updateMany({ where: { id: { in: ids }, orgId, status: 'PENDING', managerApprovedAt: null }, data: { managerApprovedAt: new Date(), managerApprovedById: actorId, managerNote: said } });
    if (!changed.count) throw fail(409, 'This request is no longer waiting for the manager.');
    for (const id of ids) {
      const row = await peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id } });
      await peoplePrisma.leaveRequest.update({ where: { id }, data: { history: withHistory(row, { by, what: 'MANAGER_APPROVED', note: said }) } });
    }
    const row = await peoplePrisma.leaveRequest.findFirstOrThrow({ where: { id: r.id } });
    return announce(orgId, row);
  });
}

/**
 * The request with names, sent to webhooks as the event its status is, and to
 * the people it concerns: the notice is queued on the outbox in the caller's
 * transaction (every caller is inside peopleWrite), so it commits with the
 * change and is tried again until it is sent. `approvedBy`: who approved it,
 * read before a cancellation wrote over reviewedByUserId.
 */
async function announce(orgId: string, row: any, extra: { approvedBy?: string | null } = {}) {
  /* Decided or withdrawn anywhere but the engine's own steps: its engine request, if it has one, closes to match. */
  await syncLeaveDecision(orgId, row);
  /* Away all of today, or back: the leave they decide on the engine goes up, or comes back, and whoever has it now is told. */
  const day = today();
  /* After the approval commits, never inside it: each request is brought up to date in its own transaction and lock. */
  if ((row.status === 'APPROVED' || row.status === 'CANCELLED') && row.fromDate <= day && row.toDate >= day && !row.halfDay && !row.fromTime) {
    afterPeopleCommit(() => {
      void refreshForPerson(row.accountId, orgId, row.employeeId).catch((e) => console.error(`[leave-engine] ${orgId}: steps not moved after a leave for today:`, e instanceof Error ? e.message : e));
    });
  }
  const shaped = (await withTypes(orgId, [row]))[0];
  const event = leaveEventFor(row.status);
  if (event) afterPeopleCommit(() => emitWebhook(orgId, event, leaveEvent(shaped)));
  await queueLeaveNotice(orgId, shaped, extra);
  return shaped;
}

/** What a leave notice needs of the request, as it is now. */
const leaveSnapshot = (r: any) => ({
  id: r.id, accountId: r.accountId, employeeId: r.employeeId, groupId: r.groupId ?? null, status: r.status,
  fromDate: r.fromDate, toDate: r.toDate, days: r.days, halfDay: r.halfDay ?? null, leaveTypeId: r.leaveTypeId, leaveTypeName: r.leaveTypeName, isPrivate: Boolean(r.isPrivate),
  managerApprovedAt: r.managerApprovedAt ?? null, managerApprovedById: r.managerApprovedById ?? null,
  requestedByUserId: r.requestedByUserId ?? null, reviewedByUserId: r.reviewedByUserId ?? null, reviewNote: r.reviewNote ?? null,
  ruleId: r.ruleId ?? null, ruleStep: r.ruleStep ?? null, stepUserIds: r.stepUserIds ?? [],
});

async function queueLeaveNotice(orgId: string, shaped: any, extra: { approvedBy?: string | null } = {}) {
  /* On the approval engine, sent up past a manager who is away: who it went to, as it is now (the notice is delivered later). */
  const engine = shaped.status === 'PENDING' && !shaped.ruleId ? await engineStepOf(orgId, shaped) : null;
  /* ...or past a manager's step nobody could take (a manager who can sign in nowhere): straight to HR's step. */
  const pastManager = engine?.preset === 'MANAGER_THEN_HR' && engine.order === 2 && !shaped.managerApprovedAt;
  /* ...or the company's leave rule, whose step's people are told as its own walker told them; or a step handed on. */
  const handedUp = engine && (engine.how === 'AWAY_HANDED_UP' || engine.how === 'HANDED_ON' || pastManager || engine.preset === 'RULE') ? { handedUpTo: engine.candidates, handedUpNote: engine.preset === 'RULE' ? null : engine.comment, ...(engine.preset === 'RULE' ? { engineStep: engine.order } : {}) } : {};
  await queueNotice({ accountId: shaped.accountId, orgId }, 'leave', { request: { ...leaveSnapshot(shaped), ...handedUp }, rev: revisionOf(shaped.history), approvedBy: extra.approvedBy ?? null }, { employeeId: shaped.employeeId, correlationId: `leave_request_${shaped.id}` });
}

/**
 * Who may act on a waiting request now: those who approve leave, narrowed to
 * whoever's scope holds the person (a team lead hears only of their team).
 */
export async function approversOf(accountId: string, orgId: string, employeeId: string) {
  const users = await usersWithPermission(accountId, orgId, 'ATTENDANCE::Leave Requests::APPROVE');
  const out: string[] = [];
  for (const userId of users) {
    const access = await resolveAccess(accountId, orgId, userId);
    if (!access.ownDocumentsOnly || inScope(await leaveScope({ ownDocumentsOnly: true, tenant: { orgId }, auth: { userId } } as any), employeeId)) out.push(userId);
  }
  return out;
}

/** A notice's second line: how much leave, naming the half of a half day (#80 QA: the bell said only "0.5 days"). */
export const leaveNoticeBody = (r: { halfDay?: string | null }, days: number) =>
  days === 0.5 && (r.halfDay === 'FIRST' || r.halfDay === 'SECOND') ? `Half a day, ${r.halfDay === 'FIRST' ? 'first' : 'second'} half` : `${days} ${days === 1 ? 'day' : 'days'}`;

/**
 * One notice per leave, never per part of a leave split at the period end
 * (the first part speaks for the whole span): a new request goes to whoever
 * acts on it next (the manager when the company asks the manager first, else
 * those who approve leave for that person); the manager's step tells HR; a
 * decision or a cancellation goes to the person unless they made it, and a
 * cancelled approved leave tells whoever approved it. Private leave says
 * "leave", not its type, outside the person's own notice.
 */
export async function tellAboutLeave(orgId: string, r: any, ctx: { approvedBy?: string | null; rev?: number } = {}) {
  let from = r.fromDate;
  let to = r.toDate;
  let days = r.days;
  if (r.groupId) {
    const group = await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: r.groupId }, orderBy: { fromDate: 'asc' }, select: { id: true, fromDate: true, toDate: true, days: true, status: true } });
    if (group[0] && group[0].id !== r.id) return;
    const same = group.filter((x) => x.status === r.status);
    from = same[0]?.fromDate || from;
    to = same[same.length - 1]?.toDate || to;
    days = round(same.reduce((a, x) => a + x.days, 0));
  }
  const emp = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { accountId: true, name: true, code: true, userId: true } });
  if (!emp) return;
  const when = from === to ? dayWords(from) : `${dayWords(from)} to ${dayWords(to)}`;
  const what = r.isPrivate ? 'leave' : r.leaveTypeName;
  const who = `${emp.name}${emp.code ? ` (${emp.code})` : ''}`;
  const app = (await isFeatureEnabled(emp.accountId, orgId, 'people')) ? 'people' : 'attendance';
  const link = { app, screen: 'leaveRequests', params: { id: r.id } };
  const byPerson = (u: string | null | undefined) => Boolean(u) && (u === emp.userId || u === `portal:${r.employeeId}`);
  if (r.status === 'PENDING') {
    /* Which "asks for" this is: new, after the manager, or handed on; and after how many changes. A retry has the same key; a real change does not. */
    if (r.ruleId && r.ruleStep) {
      /* Under the leave rule: whoever the step waiting now names, with a CLOR sign-in (a manager in the employee app sees it in their queue there). */
      const to = (r.stepUserIds || []).filter((u: string) => !u.startsWith('portal:'));
      const title = r.ruleStep > 1 ? `${who}'s ${what}, ${when}, waits for you (step ${r.ruleStep})` : `${who} asks for ${what}, ${when}`;
      /* People's Approvals: where a named person or a role decides, with or without the leave screens. */
      const stepLink = app === 'people' ? { app, screen: 'approvals' } : link;
      if (to.length) await sendNotice(emp.accountId, orgId, to, { kind: 'attendance.leave_asked', title, body: leaveNoticeBody(r, days), link: stepLink }, { except: r.requestedByUserId, dedupeKey: `leave-asked:${r.id}:step${r.ruleStep}:${ctx.rev ?? 0}`, subjectKey: `leave:${r.id}` });
      return;
    }
    const stage = r.managerApprovedAt ? (r.managerApprovedById ? 'manager' : 'handed') : 'new';
    const dedupeKey = `leave-asked:${r.id}:${stage}:${ctx.rev ?? 0}`;
    /* On the approval engine, sent up past a manager who is away: whoever it was sent to is told, not the manager. */
    if (Array.isArray(r.handedUpTo)) {
      const to = (r.handedUpTo as string[]).filter((u) => !u.startsWith('portal:'));
      const step = Number(r.engineStep) || 0;
      const title = step > 1 ? `${who}'s ${what}, ${when}, waits for you (step ${step})` : `${who} asks for ${what}, ${when}`;
      const stepLink = step && app === 'people' ? { app, screen: 'approvals' } : link;
      if (to.length) await sendNotice(emp.accountId, orgId, to, { kind: 'attendance.leave_asked', title, body: [leaveNoticeBody(r, days), r.handedUpNote].filter(Boolean).join('. '), link: stepLink }, { except: r.requestedByUserId, dedupeKey: step ? `leave-asked:${r.id}:step${step}:${ctx.rev ?? 0}` : dedupeKey, subjectKey: `leave:${r.id}` });
      return;
    }
    const chain = await leaveChainFor(orgId, r.leaveTypeId);
    const manager = chain !== 'HR' && !r.managerApprovedAt ? await activeManagerOf(orgId, r.employeeId) : null;
    if (manager) {
      /* The manager acts first — or their stand-in while they are away: in People with a sign-in, else in the employee app's queue (no notice there). */
      const managerUser = (await peoplePrisma.employee.findFirst({ where: { id: await deciderFor(orgId, manager.id, undefined, 'LEAVE'), orgId }, select: { userId: true } }))?.userId;
      if (managerUser) await sendNotice(emp.accountId, orgId, [managerUser], { kind: 'attendance.leave_asked', title: `${who} asks for ${what}, ${when}`, body: leaveNoticeBody(r, days), link }, { except: r.requestedByUserId, dedupeKey, subjectKey: `leave:${r.id}` });
      return;
    }
    const title = r.managerApprovedAt ? (r.managerApprovedById ? `${who}'s ${what}, ${when}, is approved by the manager and waits for you` : `${who}'s ${what}, ${when}, waited too long for the manager and now waits for you`) : `${who} asks for ${what}, ${when}`;
    await sendNotice(emp.accountId, orgId, await approversOf(emp.accountId, orgId, r.employeeId), { kind: 'attendance.leave_asked', title, body: leaveNoticeBody(r, days), link }, { except: r.requestedByUserId, dedupeKey, subjectKey: `leave:${r.id}` });
    return;
  }
  if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status)) return;
  /*
   * Withdrawn while waiting, or HR cancelled it while it waited: the approvers' "waiting for you" notices say so, or
   * go (Company choices, SPEC 3.6). The person withdrawing needs nothing more; HR cancelling still tells the person.
   */
  if (r.status === 'CANCELLED' && !ctx.approvedBy) {
    const own = byPerson(r.reviewedByUserId);
    await retireNotices(orgId, `leave:${r.id}`, (await choicesFor(orgId)).withdrawnNotices, link, own ? 'Withdrawn' : 'Cancelled');
    if (own) return;
  }
  const word = ({ APPROVED: 'approved', REJECTED: 'not approved', CANCELLED: 'cancelled' } as Record<string, string>)[r.status];
  if (emp.userId && !byPerson(r.reviewedByUserId)) {
    await sendNotice(emp.accountId, orgId, [emp.userId], { kind: 'attendance.leave_decided', title: `Your ${r.leaveTypeName}, ${when}, is ${word}`, body: r.reviewNote || null, link: { app, screen: 'myLeave' } }, { except: r.reviewedByUserId, dedupeKey: `leave-decided:${r.id}:${r.status}` });
  }
  /*
   * The person took back leave that was approved: whoever approved it plans
   * around it. The approver is read from the request before the cancellation
   * (ctx.approvedBy); a manager who approved in the employee app is reached
   * through their own sign-in, and leave the rule approved goes to those who
   * approve for this person.
   */
  if (r.status === 'CANCELLED' && byPerson(r.reviewedByUserId) && ctx.approvedBy) {
    const to = await approverUsers(orgId, ctx.approvedBy, () => approversOf(emp.accountId, orgId, r.employeeId));
    await sendNotice(emp.accountId, orgId, to, { kind: 'attendance.leave_decided', title: `${who} cancelled ${what}, ${when}`, link }, { except: emp.userId, dedupeKey: `leave-withdrawn:${r.id}` });
  }
}

/**
 * Requests waiting on this reader, not on someone before them: inside their
 * scope, not their own, and not still with the person's manager when the
 * company asks the manager first. One definition for the overview and Home.
 */
export async function waitingForReader(orgId: string, scope: TeamScope, userId: string) {
  const inScopeRows = await peoplePrisma.leaveRequest.findMany({ where: { orgId, status: 'PENDING', ...scopeRows(scope) }, orderBy: { createdAt: 'asc' }, take: 2000 });
  /* Under the leave rule a request waits on whoever its step names, inside the reader's scope or not; it is nobody else's yet. */
  const named = await peoplePrisma.leaveRequest.findMany({ where: { orgId, status: 'PENDING', ruleId: { not: null }, stepUserIds: { has: userId } }, orderBy: { createdAt: 'asc' }, take: 2000 });
  /* On the approval engine (2c), the same: whoever its step names now, plus, where HR can step in, whoever approves leave for the person. */
  const engineNamed = await engineLeaveNaming(orgId, [userId]);
  const leadIds = new Set(engineNamed);
  const namedEngine = engineNamed.size ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, status: 'PENDING', id: { in: [...engineNamed] } } }) : [];
  const namedGroups = namedEngine.filter((r) => r.groupId).map((r) => r.groupId as string);
  const namedParts = [...namedEngine.filter((r) => !r.groupId), ...(namedGroups.length ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, status: 'PENDING', groupId: { in: namedGroups } } }) : [])];
  const seenIds = new Set(inScopeRows.map((r) => r.id));
  /* Each part's first part (a leave split at the period end is one request on the engine), in one pass. */
  const firstOfGroup = new Map<string, { id: string; fromDate: string }>();
  for (const r of [...inScopeRows, ...namedParts]) {
    if (!r.groupId) continue;
    const f = firstOfGroup.get(r.groupId);
    if (!f || r.fromDate < f.fromDate) firstOfGroup.set(r.groupId, { id: r.id, fromDate: r.fromDate });
  }
  const leadOf = new Map<string, string>();
  for (const r of [...inScopeRows, ...namedParts]) leadOf.set(r.id, r.groupId ? firstOfGroup.get(r.groupId)!.id : r.id);
  const queue = await engineQueue(orgId, [...new Set(leadOf.values())]);
  const approvesLeave = queue.size ? (await usersWithPermission(inScopeRows[0]?.accountId || namedParts[0]?.accountId || '', orgId, permKey(ATTENDANCE_MODULE, R.leave, 'APPROVE'))).includes(userId) : false;
  const ownIds = new Set((await peoplePrisma.employee.findMany({ where: { orgId, userId }, select: { id: true } })).map((e) => e.id));
  const engineMine = (r: { id: string; employeeId: string }) => {
    const q = queue.get(leadOf.get(r.id) || r.id);
    if (!q) return null;
    /* Named on the step: someone who approves leave sees it; anyone else (a manager or stand-in by record) only while they may still decide it, checked live below. */
    if (q.candidates.includes(userId)) return approvesLeave ? true : 'LIVE';
    /* Whoever approves leave for the person, also one who started since the step opened: HR stepping in, or HR's own step (after the manager, and on the leave rule: company-wide, never who took the manager's step). Deciding is checked live. */
    if (!approvesLeave || !inScope(scope, r.employeeId) || ownIds.has(r.employeeId)) return false;
    if (q.stepIn === 'HR') return true;
    if (q.preset === 'RULE') return q.hrStep && Boolean(scope.all) && !q.tookFirst.includes(userId);
    return q.hrStep && (q.preset !== 'MANAGER_THEN_HR' || q.step !== 2 || (scope.all && !q.tookFirst.includes(userId)));
  };
  /* The queue shows only what this reader may still decide: a stand-in whose dates ended, a manager handed past, are not shown it. */
  const liveFor = new Map<string, boolean>();
  for (const r of [...inScopeRows, ...namedParts]) {
    if (engineMine(r) !== 'LIVE' || liveFor.has(r.id)) continue;
    liveFor.set(r.id, await decidesNow(r.accountId, orgId, r, userId));
  }
  const engineSees = (r: { id: string; employeeId: string }) => { const e = engineMine(r); return e === 'LIVE' ? Boolean(liveFor.get(r.id)) : e; };
  const rows = [
    ...inScopeRows.filter((r) => { const e = engineSees(r); return e === null ? !r.ruleId || r.stepUserIds.includes(userId) : e; }),
    ...named.filter((r) => !seenIds.has(r.id)),
    ...namedParts.filter((r) => !seenIds.has(r.id) && !named.some((n) => n.id === r.id) && engineSees(r)),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const r of rows) if (queue.has(leadOf.get(r.id) || r.id)) leadIds.add(r.id);
  if (!rows.length) return rows;
  const company = await chainFor(orgId, 'leave');
  const typeChains = new Map((await peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, approval: true } })).map((t) => [t.id, t.approval && (CHAINS as string[]).includes(t.approval) ? (t.approval as Chain) : company]));
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, userId: true, reportingManagerId: true } });
  const of = new Map(people.map((p) => [p.id, p]));
  const managerIds = [...new Set(people.map((p) => p.reportingManagerId).filter(Boolean) as string[])];
  const managers = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: managerIds } }, select: { id: true, status: true, userId: true } })).map((m) => [m.id, m]));
  /* While a manager is away, their stand-in holds their queue. */
  const me = await peoplePrisma.employee.findFirst({ where: { orgId, userId }, select: { id: true } });
  const covers = new Set(me ? await standingInFor(orgId, me.id, undefined, 'LEAVE') : []);
  /*
   * The reader's own leave is somebody else's to decide, unless the company's
   * maker-checker lets them decide it (makerChecker.ts): AUTO when nobody else
   * can approve leave (a one-person company), or ALLOW. Then it waits on them
   * like any other, marked so the inbox says why, and the decision is audited
   * as SELF_APPROVED by reviewLeave's ownWorkRefusal.
   */
  const ownRow = rows.find((r) => !r.ruleId && of.get(r.employeeId)?.userId === userId);
  const self = ownRow ? await selfDecisionAllowed(ownRow.accountId, orgId, userId, permKey(ATTENDANCE_MODULE, R.leave, 'APPROVE')) : null;
  if (self?.allowed) {
    const access = await resolveAccess(ownRow!.accountId, orgId, userId);
    if (!access.isAdmin && !access.permissions.has(permKey(ATTENDANCE_MODULE, R.leave, 'APPROVE'))) self.allowed = false;
  }
  return rows.filter((r) => {
    if (r.ruleId || leadIds.has(r.id)) return true;
    const p = of.get(r.employeeId);
    const own = Boolean(p?.userId && p.userId === userId);
    const m = p?.reportingManagerId ? managers.get(p.reportingManagerId) : null;
    const activeManager = m && m.status !== 'LEFT' && m.status !== 'SUSPENDED' ? m : null;
    /* The manager's own queue: still theirs while their step is open. Not even a stand-in takes it on their own request (managerStepBy), and my own waits on my manager before it can wait on me. */
    if ((typeChains.get(r.leaveTypeId) || company) === 'MANAGER_THEN_HR' && !r.managerApprovedAt && activeManager) {
      if (own) return false;
      return activeManager.userId === userId || covers.has(activeManager.id);
    }
    if (own) {
      if (!self?.allowed) return false;
      Object.assign(r, { ownDecision: self.mode === 'ALLOW' ? 'ALLOWED' : 'ONLY_APPROVER' });
    }
    return true;
  });
}

/** Queue a notice to whoever acts next on a request now (the hand-on job, in the transaction that moves a request on to HR). */
export async function tellWaiting(orgId: string, requestId: string) {
  const row = await peoplePrisma.leaveRequest.findFirst({ where: { id: requestId, orgId } });
  if (!row) return;
  await queueLeaveNotice(orgId, (await withTypes(orgId, [row]))[0]);
}

/** An audit row for leave actions that have no CLOR request behind them (the employee app, imports). */
export async function leaveAudit(who: { accountId: string; orgId: string; userId: string }, entry: { entityId: string; action: string; message: string; metadata?: Record<string, unknown> }) {
  try {
    await platformPrisma.auditLog.create({ data: { accountId: who.accountId, orgId: who.orgId, branchId: '', entity: 'LeaveRequest', entityId: entry.entityId, action: entry.action, message: entry.message.slice(0, 500), metadata: entry.metadata ? JSON.stringify(entry.metadata).slice(0, 20_000) : null, createdByUserId: who.userId, correlationId: null } });
  } catch (e) {
    console.error('[leave] audit not recorded:', e instanceof Error ? e.message : e);
  }
}

const noteOf = (req: any) => String(req.body?.note || '').trim().slice(0, 500) || null;

/** An error from the leave engine as the status and body a route sends; anything unexpected still throws. */
const asOutcome = (e: any): { status: number; body: any } => {
  if (e?.status) return { status: e.status, body: { error: e.message, ...(e.code ? { code: e.code } : {}) } };
  if (String(e?.code) === 'P2002') return { status: 409, body: { error: 'That already exists.' } };
  throw e;
};

/**
 * One decision on one leave request, as the single routes and the bulk route
 * take it: scope, the manager's step under manager-then-HR, HR's second pair
 * of eyes (HR_STEP), the manager first (MANAGER_FIRST) and maker-checker on
 * your own leave. Answers the status and body the route sends.
 */
async function reviewLeave(req: any, id: string, approve: boolean, note: string | null): Promise<{ status: number; body: any }> {
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id, accountId, orgId } });
  const scope = await leaveScope(req);
  /* Someone a step of the leave rule names decides that step, whatever their own view of the team (a named person, a role). */
  const stepper = Boolean(r && takesStep(r, [req.auth!.userId]));
  const engineStep = r && r.status === 'PENDING' && !r.ruleId ? await engineStepOf(orgId, r) : null;
  /* Outside the reader's team, only someone who may decide it now (worked out live) finds it. */
  if (!r || (!inScope(scope, r.employeeId) && !stepper && !(engineStep && (await decidesNow(accountId, orgId, r, req.auth!.userId))))) return { status: 404, body: { error: 'No such request.' } };
  if (r.status !== 'PENDING') return { status: 409, body: { error: `This request was already ${r.status.toLowerCase()}.` } };
  /* On the approval engine (workflow engine 2c): its steps say who decides; the leave is decided as before. */
  if (engineStep) {
    try {
      const out = await decideLeaveOnEngine({ accountId, orgId, row: r, ids: [req.auth!.userId], approve, note, channel: 'web' });
      if (out) {
        const span = r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`;
        const request = out.request;
        if (!approve) await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'REJECT', message: `Rejected ${request.employeeName}'s ${request.leaveTypeName}, ${span}${note ? `: ${note}` : ''}`, metadata: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, engineRequestId: engineStep.requestId } });
        else if (out.stage) await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'MANAGER_APPROVE', message: `Manager approved ${request.employeeName}'s leave, ${r.fromDate} to ${r.toDate}; now with HR`, metadata: { employeeId: r.employeeId, engineRequestId: engineStep.requestId } });
        else await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'APPROVE', message: `Approved ${request.employeeName}'s ${request.leaveTypeName}, ${span} (${request.days} days)`, metadata: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, days: request.days, engineRequestId: engineStep.requestId } });
        return { status: 200, body: { request: masked([request], await readsPrivateLeave(req))[0], ...(out.stage ? { stage: out.stage } : {}) } };
      }
    } catch (e) {
      return asOutcome(e);
    }
  }
  if (r.ruleId) {
    if (!stepper) {
      const names = await actorNames(orgId, r.stepUserIds);
      const who = r.stepUserIds.map((u: string) => names.get(u)).filter(Boolean).join(', ');
      return { status: 403, body: { error: `Step ${r.ruleStep} of the leave approval rule waits for ${who || 'someone else'}.`, code: 'NOT_YOUR_STEP' } };
    }
    try {
      const out = await decideRuleLeave(accountId, orgId, r, req.auth!.userId, note, approve);
      const what = !approve ? 'REJECT' : out.stage ? 'STEP_APPROVE' : 'APPROVE';
      const words = !approve ? 'Rejected' : out.stage ? `Approved step ${r.ruleStep} of` : 'Approved';
      await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: what, message: `${words} ${out.request.employeeName}'s ${out.request.leaveTypeName}, ${r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`}${note ? `: ${note}` : ''}`, metadata: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, step: r.ruleStep } });
      return { status: 200, body: { request: masked([out.request], await readsPrivateLeave(req))[0], ...(out.stage ? { stage: out.stage } : {}) } };
    } catch (e) {
      return asOutcome(e);
    }
  }
  const chain = await leaveChainFor(orgId, r.leaveTypeId);
  const me = await peoplePrisma.employee.findFirst({ where: { orgId, userId: req.auth!.userId }, select: { id: true } });
  const firstByUser = async () => (r.managerApprovedById ? (await peoplePrisma.employee.findFirst({ where: { id: r.managerApprovedById, orgId }, select: { userId: true } }))?.userId : null);
  if (!approve) {
    /* Once the manager has passed it to HR, it is HR's to decide either way: not the manager's again, nor a team-scoped role's (closure audit). */
    if (r.managerApprovedAt && chain === 'MANAGER_THEN_HR') {
      const firstBy = await firstByUser();
      if ((firstBy && firstBy === req.auth!.userId) || (me && r.managerApprovedById === me.id) || !scope.all) return { status: 403, body: { error: 'The manager has passed this to HR; HR decides it now.', code: 'HR_STEP' } };
    }
    try {
      const request = await decideLeave(accountId, orgId, r, req.auth!.userId, note, false);
      await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'REJECT', message: `Rejected ${request.employeeName}'s ${request.leaveTypeName}, ${r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`}${note ? `: ${note}` : ''}`, metadata: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId } });
      return { status: 200, body: { request: masked([request], await readsPrivateLeave(req))[0] } };
    } catch (e) {
      return asOutcome(e);
    }
  }
  if (chain === 'MANAGER_THEN_HR') {
    const manager = await activeManagerOf(orgId, r.employeeId);
    /* The manager's own step, taken in People — or their stand-in's: recorded, and the request goes on to HR. */
    const asManager = manager && me ? await managerStepBy(orgId, me.id, r.employeeId, undefined, 'LEAVE') : null;
    if (!r.managerApprovedAt && asManager) {
      try {
        const request = await managerStep(orgId, r, asManager, note, { employeeId: me!.id, userId: req.auth!.userId });
        await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'MANAGER_APPROVE', message: `Manager approved ${request.employeeName}'s leave, ${r.fromDate} to ${r.toDate}; now with HR`, metadata: { employeeId: r.employeeId } });
        return { status: 200, body: { request: masked([request], await readsPrivateLeave(req))[0], stage: 'HR' } };
      } catch (e) {
        return asOutcome(e);
      }
    }
    /* HR's step is a second pair of eyes: not the manager who took the first, and someone who decides for the whole company. */
    if (r.managerApprovedAt) {
      const firstBy = await firstByUser();
      if ((firstBy && firstBy === req.auth!.userId) || (me && r.managerApprovedById === me.id) || !scope.all) return { status: 403, body: { error: 'HR approves after the manager; the manager cannot take both steps.', code: 'HR_STEP' } };
    }
  }
  const turn = await hrMayDecide(orgId, 'leave', r, chain);
  if (!turn.ok) return { status: 409, body: { error: turn.error, code: 'MANAGER_FIRST' } };
  /* A-13: your own leave is approved by somebody else, as the company's maker-checker setting decides (a one-person company still can). */
  const own = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { userId: true } });
  const refused = await ownWorkRefusal(req, { makers: [own?.userId], module: ATTENDANCE_MODULE, resource: R.leave, entity: 'ATTENDANCE_LEAVE_REQUEST', entityId: r.id, what: 'leave request' });
  if (refused) return { status: refused.status, body: refused.body };
  try {
    const request = await decideLeave(accountId, orgId, r, req.auth!.userId, note, true);
    await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'APPROVE', message: `Approved ${request.employeeName}'s ${request.leaveTypeName}, ${r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`} (${request.days} days)`, metadata: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, days: request.days } });
    return { status: 200, body: { request: masked([request], await readsPrivateLeave(req))[0] } };
  } catch (e) {
    return asOutcome(e);
  }
}

leaveRouter.post(`${base}/requests/:id/approve`, canOrStep(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const out = await reviewLeave(req, String(req.params.id), true, noteOf(req));
  res.status(out.status).json(out.body);
});

leaveRouter.post(`${base}/requests/:id/reject`, canOrStep(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const out = await reviewLeave(req, String(req.params.id), false, noteOf(req));
  res.status(out.status).json(out.body);
});

/**
 * Approve or reject several waiting leave requests at once (G14): each goes
 * through the same decision as one (reviewLeave), so the manager's step,
 * HR's step and maker-checker hold per request, and one refused never stops
 * the rest. Rejecting needs one note, which every person reads with the
 * decision. A part of a leave split at the period end that its first part
 * already decided counts as done.
 */
leaveRouter.post(`${base}/requests/bulk-review`, canOrStep(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const ids: string[] = Array.isArray(req.body?.ids) ? [...new Set<string>(req.body.ids.map(String))].slice(0, 200) : [];
  const approve = req.body?.approve !== false;
  const note = noteOf(req);
  if (!ids.length) return res.status(400).json({ error: 'Choose the requests.' });
  if (!approve && !note) return res.status(400).json({ error: 'Say why. They see this with the decision.' });
  const { orgId } = req.tenant!;
  const decided = new Set<string>();
  const results: Array<{ id: string; ok: boolean; error?: string; code?: string }> = [];
  let handedOn = 0;
  for (const id of ids) {
    if (decided.has(id)) { results.push({ id, ok: true }); continue; }
    let out: { status: number; body: any };
    try {
      out = await reviewLeave(req, id, approve, note);
    } catch (e) {
      console.error('[leave] bulk decision failed:', e instanceof Error ? e.message : e);
      out = { status: 500, body: { error: 'Something went wrong.' } };
    }
    if (out.status === 200) {
      if (out.body.stage === 'HR') handedOn += 1;
      results.push({ id, ok: true });
      const groupId = out.body.request?.groupId;
      if (groupId) for (const x of await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId }, select: { id: true } })) decided.add(x.id);
    } else {
      results.push({ id, ok: false, error: out.body.error || 'Not done.', ...(out.body.code ? { code: out.body.code } : {}) });
    }
  }
  res.json({ done: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, handedOn, results: results.filter((x) => !x.ok) });
});

export async function cancelLeaveRequest(accountId: string, orgId: string, id: string, userId: string) {
  return peopleWrite(orgId, async () => {
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id, accountId, orgId } });
    if (!r || !OPEN.includes(r.status)) throw fail(409, 'This request is no longer open.');
    /* Parts of one leave across a period end are cancelled together: what the person asked for was one leave. */
    const parts = r.groupId ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: r.groupId, status: { in: OPEN }, id: { not: r.id } } }) : [];
    let first = null;
    for (const x of [r, ...parts]) {
      const updated = await peoplePrisma.leaveRequest.update({ where: { id: x.id }, data: { status: 'CANCELLED', reviewedByUserId: userId, reviewedAt: new Date(), history: withHistory(x, { by: userId, what: x.status === 'APPROVED' ? 'CANCELLED' : 'WITHDRAWN' }) } });
      if (x.status === 'APPROVED') await clearLeaveDays(orgId, x.id);
      /* Who approved it, before the cancellation wrote over it: they are told (tellAboutLeave). */
      const shaped = await announce(orgId, updated, { approvedBy: x.status === 'APPROVED' ? x.reviewedByUserId || 'system' : null });
      first = first || shaped;
    }
    return first;
  });
}

leaveRouter.post(`${base}/requests/:id/cancel`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { employeeId: true, fromDate: true, toDate: true } });
    if (!r || !inScope(await leaveScope(req), r.employeeId)) return res.status(404).json({ error: 'No such request.' });
    const request = await cancelLeaveRequest(accountId, orgId, String(req.params.id), req.auth!.userId);
    await recordAudit(req, { entity: 'LeaveRequest', entityId: String(req.params.id), action: 'CANCEL', message: `Cancelled ${request.employeeName}'s ${request.leaveTypeName}, ${r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`}`, metadata: { employeeId: r.employeeId } });
    res.json({ request: masked([request], await readsPrivateLeave(req))[0] });
  } catch (e) { return sendError(res, e); }
});

// ---------------------------------------------------------------------------
// Adjustments and the ledger (People → Time Off → Balances)
// ---------------------------------------------------------------------------

const adjustmentSchema = z.object({
  employeeId: z.string().min(1, 'Choose the person.'),
  leaveTypeId: z.string().min(1, 'Choose the leave type.'),
  year: z.coerce.number().int().min(2000).max(2100),
  /** ADJUST: positive adds, negative takes away. ENCASH: the days paid out, as a positive number. */
  days: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) <= 366, 'Give the days, not zero.'),
  kind: z.enum(['ADJUST', 'ENCASH']).default('ADJUST'),
  reason: z.string().trim().min(3, 'Say why.').max(300),
});

/**
 * Grant leave to many (owner, 29 Oct 2026, from ERPNext's Leave Control
 * Panel): the same days of one paid type for one period to everyone in the
 * company, or to some departments or employment types, as one HR change per
 * person with the same reason. Left out, and said so: people who have left,
 * those the type is not for, and the one granting (their own balance is
 * somebody else's to change). `preview` answers who it would go to and
 * writes nothing. Company-wide roles only; sent twice in a minute, the
 * second is refused.
 */
const bulkGrantSchema = z.object({
  leaveTypeId: z.string().min(1, 'Choose the leave type.'),
  year: z.coerce.number().int().min(2000).max(2100),
  days: z.coerce.number().refine((n) => n > 0 && n <= 366 && Math.round(n * 2) === n * 2, 'Give the days: more than zero, in halves.'),
  reason: z.string().trim().min(3, 'Say why.').max(300),
  departmentIds: z.array(z.string().max(60)).max(500).default([]),
  employeeTypeIds: z.array(z.string().max(60)).max(500).default([]),
  preview: z.boolean().optional(),
});

leaveRouter.post(`${base}/adjustments/bulk`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = bulkGrantSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the grant.' });
  const b = parsed.data;
  const type = await peoplePrisma.leaveType.findFirst({ where: { id: b.leaveTypeId, accountId, orgId, isActive: true } });
  if (!type) return res.status(400).json({ error: 'No such leave type.' });
  if (!type.isPaid) return res.status(400).json({ error: `${type.name} is unpaid and has no balance to add to.` });
  const people = await peoplePrisma.employee.findMany({
    where: { orgId, anonymisedAt: null, ...(b.departmentIds.length ? { departmentId: { in: b.departmentIds } } : {}), ...(b.employeeTypeIds.length ? { employeeTypeId: { in: b.employeeTypeIds } } : {}) },
    select: { id: true, name: true, status: true, userId: true, gender: true, employeeTypeId: true, departmentId: true, branchId: true, gradeId: true, dateOfLeaving: true },
    orderBy: { name: 'asc' },
  });
  const t0 = today();
  const to: typeof people = [];
  const skipped: Array<{ employeeId: string; name: string; why: string }> = [];
  for (const p of people) {
    if (p.status === 'LEFT' || (p.dateOfLeaving && p.dateOfLeaving < t0)) skipped.push({ employeeId: p.id, name: p.name, why: 'has left' });
    else if (!eligibleFor(type as any, p as any)) skipped.push({ employeeId: p.id, name: p.name, why: `${type.name} is not for them` });
    else if (p.userId && p.userId === req.auth!.userId) skipped.push({ employeeId: p.id, name: p.name, why: 'your own balance: somebody else grants it' });
    else to.push(p);
  }
  if (b.preview) return res.json({ count: to.length, names: to.slice(0, 12).map((p) => p.name), skipped });
  if (!to.length) return res.status(400).json({ error: 'Nobody to grant it to: change who it is for.' });
  try {
    const granted = await peopleWrite(orgId, async () => {
      const recent = await peoplePrisma.leaveAdjustment.count({ where: { orgId, leaveTypeId: type.id, year: b.year, reason: b.reason, days: b.days, createdByUserId: req.auth!.userId, createdAt: { gte: new Date(Date.now() - 60_000) } } });
      if (recent) throw fail(409, 'This was just granted. Look at the balances before granting it again.', 'ALREADY_GRANTED');
      const out = await peoplePrisma.leaveAdjustment.createMany({ data: to.map((p) => ({ accountId, orgId, employeeId: p.id, leaveTypeId: type.id, year: b.year, days: b.days, kind: 'ADJUST', reason: b.reason, createdByUserId: req.auth!.userId })) });
      return out.count;
    });
    await recordAudit(req, { entity: 'LeaveAdjustment', entityId: type.id, action: 'CREATE', message: `Added ${b.days} days of ${type.name} (${b.year}) for ${granted} people: ${b.reason}`, metadata: { leaveTypeId: type.id, year: b.year, days: b.days, employeeIds: to.map((p) => p.id), skipped: skipped.length } });
    res.status(201).json({ granted, skipped });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.get(`${base}/adjustments`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employeeId = String(req.query.employeeId || '').trim();
  const rows = await peoplePrisma.leaveAdjustment.findMany({
    where: { accountId, orgId, reversedAt: null, year: await yearParam(orgId, req.query.year), ...(employeeId ? { employeeId } : {}), ...scopeRows(await leaveScope(req)) },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  /* A private type's adjustments are not shown to those who may not read private leave. */
  const reads = await readsPrivateLeave(req);
  res.json({ adjustments: (await withTypes(orgId, rows)).filter((a: any) => reads || !a.isPrivate) });
});

leaveRouter.post(`${base}/adjustments`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = adjustmentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the adjustment.' });
  const b = parsed.data;
  try {
    const employee = await employeeIn(orgId, accountId, b.employeeId);
    await scopedOr404(req, employee.id);
    if (await ownBalanceRefused(req, res, employee, b.kind === 'ENCASH' ? 'pay-out' : 'adjustment')) return;
    const type = await peoplePrisma.leaveType.findFirst({ where: { id: b.leaveTypeId, accountId, orgId } });
    if (!type) return res.status(400).json({ error: 'No such leave type.' });
    if (!type.isPaid) return res.status(400).json({ error: `${type.name} is unpaid and has no balance to adjust.` });
    const row = await peopleWrite(orgId, async () => {
      let days = b.days;
      if (b.kind === 'ENCASH') {
        if (!type.encashable) throw fail(400, `${type.name} is not paid out. Turn on encashment in its policy first.`);
        if (days < 0) throw fail(400, 'Give the days paid out as a positive number.');
        const paidOut = -((await peoplePrisma.leaveAdjustment.aggregate({ where: { orgId, employeeId: employee.id, leaveTypeId: type.id, year: b.year, kind: 'ENCASH', reversedAt: null }, _sum: { days: true } }))._sum.days ?? 0);
        if (type.maxEncashDays != null && paidOut + days > type.maxEncashDays) {
          throw fail(400, `At most ${type.maxEncashDays} days of ${type.name} are paid out a year; ${paidOut} already are.`);
        }
        const { balances } = await balancesFor(accountId, orgId, [employee.id], b.year);
        const left = balances.get(employee.id)!.get(type.id)!.available ?? 0;
        if (days > left) throw fail(400, `Only ${left} days of ${type.name} are left to pay out.`, 'NO_BALANCE');
        days = -days;
      }
      return peoplePrisma.leaveAdjustment.create({
        data: { accountId, orgId, employeeId: employee.id, leaveTypeId: type.id, year: b.year, days, kind: b.kind, reason: b.reason, createdByUserId: req.auth!.userId },
      });
    });
    const days = row.days;
    await recordAudit(req, {
      entity: 'LeaveAdjustment',
      entityId: row.id,
      action: 'CREATE',
      message: `${b.kind === 'ENCASH' ? 'Paid out' : days > 0 ? 'Added' : 'Took away'} ${Math.abs(days)} days of ${type.name} for ${employee.name} (${b.year}): ${b.reason}`,
      metadata: { employeeId: employee.id, leaveTypeId: type.id, year: b.year, days, kind: b.kind },
    });
    /* Days paid out are valued on the policy's pay base and handed to Payroll as a draft earning (time depth, gap 19). */
    const payout = b.kind === 'ENCASH' ? await sendEncashmentToPayroll(req, row, type) : undefined;
    res.status(201).json({ adjustment: (await withTypes(orgId, [row]))[0], ...(payout ? { payout } : {}) });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.delete(`${base}/adjustments/:id`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const row = await peopleWrite(orgId, async () => {
    const row = await peoplePrisma.leaveAdjustment.findFirst({ where: { id: String(req.params.id), accountId, orgId, reversedAt: null } });
    if (!row || !inScope(await leaveScope(req), row.employeeId)) throw fail(404, 'No such adjustment.');
    const earning = row.kind === 'ENCASH' ? await payrollPrisma.payrollAdjustment.findUnique({ where: { id: `leave-encash:${row.id}` } }) : null;
    if (row.paidInRunId || (earning && earning.status !== 'CANCELLED')) throw fail(409, 'This encashment is linked to payroll. Cancel its unconsumed earning first, or use a correcting adjustment.');
    await deleteToBin(req, 'leaveAdjustment', row);
    return row;
  });
  const before = { employeeId: row.employeeId, leaveTypeId: row.leaveTypeId, year: row.year, days: row.days, kind: row.kind, reason: row.reason, workedOn: row.workedOn };
  await recordAudit(req, { entity: 'LeaveAdjustment', entityId: row.id, action: 'DELETE', message: `Removed ${row.kind === 'ENCASH' ? 'a pay-out of' : 'an adjustment of'} ${Math.abs(row.days)} days (${row.year}): ${row.reason}`.slice(0, 500), metadata: { employeeId: row.employeeId, before, after: null } });
  res.json({ ok: true });
});

const n2 = (n: number) => String(Math.round(n * 100) / 100);
const workedWords = (w: Worked) => (w.source === 'RECORD' ? 'from the attendance record (present 1, half day 0.5)' : 'from working days by the working week and holidays, less leave taken: there is no attendance record (People only)');

/**
 * "How is this worked out?" for the statutory rules on a type, in the words the ledger shows. Empty for a type
 * on none of them, so nothing changes for the others.
 */
export function explainOf(t: any, bal: any, period: LeavePeriod, year: number): string[] {
  const out: string[] = [];
  if (t.isPaid && t.accrualBasis === 'PER_DAYS_WORKED') {
    const per = Number(t.perDaysWorked) || 0;
    const min = Number(t.minDaysWorked) || 0;
    out.push(`One day for every ${n2(per)} days worked in ${periodLabel(period, year - 1)}${min ? `, once the days worked that period reach ${n2(min)}` : ''}; credited on the first day of ${periodLabel(period, year)}. A half day or more of a fraction is a whole day.`);
    const prev: Worked | null = bal.worked?.previous ?? null;
    if (prev) {
      const c = workedCredit(t, prev)!;
      out.push(`${periodLabel(period, year - 1)}: ${n2(prev.worked)} days worked, ${workedWords(prev)}. Towards the ${n2(min)} needed, paid leave counts as worked: ${n2(prev.eligible)}.`);
      out.push(c.eligible ? `${n2(prev.worked)} ÷ ${n2(per)} = ${n2(prev.worked / per)}, so ${c.days} ${c.days === 1 ? 'day' : 'days'}.` : `${n2(prev.eligible)} is under ${n2(min)}, so nothing is earned for ${periodLabel(period, year - 1)}.`);
    }
    const cur: Worked | null = bal.worked?.current ?? null;
    if (cur) out.push(`${periodLabel(period, year)} so far: ${n2(cur.worked)} days worked (${n2(cur.eligible)} towards the ${n2(min)}); what they earn is credited next period.`);
  }
  if (t.isPaid && t.oshCarry) {
    out.push(`Carries up to ${n2(Number(t.carryForwardMax) || 0)} days, plus the days asked for and refused this period${bal.refused ? ` (${n2(bal.refused)})` : ''}: up to ${n2(bal.carryLimit ?? 0)}. What is over is paid out by the year end.`);
  }
  if (t.isPaid && t.carryExpiresAfterDays && (bal.carriedIn || bal.lapsed)) {
    out.push(`Days carried in are used first and must be used by ${dayWords(addDays(periodStart(period, year), t.carryExpiresAfterDays - 1))}${bal.lapsed ? `; ${n2(bal.lapsed)} of them were not and lapsed` : ''}.`);
  }
  if (t.countsCalendarDays) out.push('Every date in a request is a leave day, weekly offs and holidays included.');
  return out;
}

/**
 * One person's year, line by line for each type: carried in, earned,
 * adjustments, leave taken and waiting — the answer to "why is my balance this?".
 */
leaveRouter.get(`${base}/ledger`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const employee = await employeeIn(orgId, accountId, String(req.query.employeeId || ''));
    await scopedOr404(req, employee.id);
    const year = await yearParam(orgId, req.query.year);
    /* ?asOf=YYYY-MM-DD: the balance as it will stand on that day (credits landed by then); the period end projects the year. */
    const asOf = ISO_DATE.test(String(req.query.asOf || '')) ? String(req.query.asOf) : undefined;
    const { types, balances, period } = await balancesFor(accountId, orgId, [employee.id], year, asOf);
    const bounds = periodBounds(period, year);
    const t0 = today();
    const [requests, adjustments] = await Promise.all([
      peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: employee.id, status: { in: OPEN }, fromDate: { gte: bounds.from, lte: bounds.to } }, orderBy: { fromDate: 'asc' } }),
      peoplePrisma.leaveAdjustment.findMany({ where: { orgId, employeeId: employee.id, year, reversedAt: null }, orderBy: { createdAt: 'asc' } }),
    ]);
    const mine = balances.get(employee.id)!;
    const own = Boolean(req.auth?.userId) && (await peoplePrisma.employee.findFirst({ where: { id: employee.id, orgId }, select: { userId: true } }))?.userId === req.auth!.userId;
    const reads = own || (await readsPrivateLeave(req));
    const out = types
      .filter((t) => reads || !t.isPrivate)
      .filter((t) => t.isActive || requests.some((r) => r.leaveTypeId === t.id) || adjustments.some((a) => a.leaveTypeId === t.id))
      .map((t) => {
        const bal = mine.get(t.id)!;
        const entries: Array<{ date: string; kind: string; days: number; note: string; id?: string }> = [];
        if (t.isPaid) {
          if (bal.carriedIn) entries.push({ date: bounds.from, kind: 'CARRIED', days: bal.carriedIn, note: `Carried from ${periodLabel(period, year - 1)}` });
          if (bal.allocationId) entries.push({ date: bounds.from, kind: 'ALLOCATED', days: round((bal.allocated ?? 0) - (bal.adjusted ?? 0)), note: 'Set for this person this period' });
          /* Each credit on its own date, as the policy lands it; those still to come are shown, not counted. */
          else for (const c of bal.credits || []) {
            entries.push({ date: c.date, kind: c.date <= t0 ? 'CREDIT' : 'UPCOMING', days: c.days, note: c.from === bounds.from && c.to === bounds.to ? 'This period’s days' : `For ${spanWords(c.from, c.to)}` });
          }
          for (const a of adjustments.filter((x) => x.leaveTypeId === t.id)) {
            entries.push({ id: a.id, date: a.createdAt.toISOString().slice(0, 10), kind: a.kind, days: a.days, note: a.reason });
          }
        }
        for (const r of requests.filter((x) => x.leaveTypeId === t.id)) {
          entries.push({ id: r.id, date: r.fromDate, kind: r.status === 'APPROVED' ? 'TAKEN' : 'PENDING', days: -r.days, note: r.fromDate === r.toDate ? dayWords(r.fromDate) : `${dayWords(r.fromDate)} to ${dayWords(r.toDate)}` });
        }
        entries.sort((a, b) => a.date.localeCompare(b.date));
        /* Projected to the period end: every credit landed, every booked day taken. */
        const projected = t.isPaid && bal.fullYear != null ? { allocated: bal.fullYear, available: round(bal.fullYear - bal.used - bal.pending) } : null;
        return { type: { id: t.id, name: t.name, code: t.code, color: t.color, isPaid: t.isPaid, encashable: t.encashable, accrualBasis: t.accrualBasis, oshCarry: t.oshCarry, countsCalendarDays: t.countsCalendarDays }, balance: bal, projected, entries, explain: explainOf(t, bal, period, year) };
      });
    res.json({ employee: { id: employee.id, name: employee.name }, year, period: bounds, asOf: asOf || null, types: out });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// The leave period, and the register (People → Leave)
// ---------------------------------------------------------------------------

leaveRouter.get(`${base}/settings`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const period = await leavePeriodOf(orgId);
  const year = periodOf(period, today());
  res.json({ ...period, current: periodBounds(period, year), next: periodBounds(period, year + 1), previous: periodBounds(period, year - 1) });
});

leaveRouter.put(`${base}/settings`, can(PermissionAction.EDIT, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z
    .object({
      startMonth: z.coerce.number().int().min(1).max(12),
      startDay: z.coerce.number().int().min(1, 'A day from 1 to 28.').max(28, 'A day from 1 to 28, so every month has it.'),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the leave period.' });
  const data = { leavePeriodStartMonth: parsed.data.startMonth, leavePeriodStartDay: parsed.data.startDay };
  const old = await peopleWrite(orgId, async () => {
    const old = await leavePeriodOf(orgId);
    if (old.startMonth !== data.leavePeriodStartMonth || old.startDay !== data.leavePeriodStartDay) {
      const counts = await Promise.all([
        peoplePrisma.leaveRequest.count({ where: { orgId } }),
        peoplePrisma.leaveAllocation.count({ where: { orgId } }),
        peoplePrisma.leaveAdjustment.count({ where: { orgId, reversedAt: null } }),
      ]);
      if (counts.some(Boolean)) throw fail(409, 'Leave periods cannot change after balances or requests have been recorded. Migrate the existing balances before changing the period.', 'LEAVE_PERIOD_IN_USE');
    }
    await peoplePrisma.attendanceSettings.upsert({ where: { orgId }, update: data, create: { accountId, orgId, ...data, updatedByUserId: req.auth!.userId } as any });
    return old;
  });
  await recordAudit(req, { entity: 'LeaveSettings', entityId: orgId, action: 'UPDATE', message: `Leave period starts on day ${parsed.data.startDay} of month ${parsed.data.startMonth}`, metadata: { ...parsed.data, before: { startMonth: old.startMonth, startDay: old.startDay }, after: parsed.data } });
  const period = await leavePeriodOf(orgId);
  res.json({ ...period, current: periodBounds(period, periodOf(period, today())) });
});

/**
 * The leave register: for one leave period, each person and type — opening
 * (carried in), credited, changed by HR, taken, paid out, waiting, lapsed at
 * the period end and what is left. Worked out from the policy and the
 * records, so it is never out of date and nobody runs it.
 */
leaveRouter.get(`${base}/register`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = await yearParam(orgId, req.query.year);
  const typeId = String(req.query.leaveTypeId || '').trim();
  const period = await leavePeriodOf(orgId);
  const bounds = periodBounds(period, year);
  const scope = await leaveScope(req);
  const people = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, ...(scope.all ? {} : { id: { in: scope.ids } }), OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: bounds.from } }], AND: [{ OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: bounds.to } }] }] },
    select: { id: true, name: true, code: true, department: true, status: true },
    orderBy: { name: 'asc' },
  });
  const ids = people.map((p) => p.id);
  const [{ types, balances }, adjustments] = await Promise.all([
    balancesFor(accountId, orgId, ids, year),
    peoplePrisma.leaveAdjustment.findMany({ where: { orgId, year, reversedAt: null, employeeId: { in: ids } }, select: { employeeId: true, leaveTypeId: true, days: true, kind: true } }),
  ]);
  const ended = today() > bounds.to;
  const reads = await readsPrivateLeave(req);
  const shown = types.filter((t) => (reads || !t.isPrivate) && (!typeId || t.id === typeId) && (t.isActive || [...balances.values()].some((m) => (m.get(t.id)?.used || 0) > 0)));
  const rows = [];
  for (const p of people) {
    for (const t of shown) {
      const b = balances.get(p.id)?.get(t.id);
      if (!b) continue;
      const adj = adjustments.filter((a) => a.employeeId === p.id && a.leaveTypeId === t.id);
      const encashed = round(-adj.filter((a) => a.kind === 'ENCASH').reduce((x, a) => x + a.days, 0));
      const changed = round(adj.filter((a) => a.kind !== 'ENCASH').reduce((x, a) => x + a.days, 0));
      if (!t.isPaid) {
        if (b.used || b.pending) rows.push({ employeeId: p.id, name: p.name, code: p.code, department: p.department, leaveTypeId: t.id, leaveType: t.name, isPaid: false, opening: null, credited: null, changed: null, taken: b.used, encashed: null, pending: b.pending, lapsed: null, closing: null });
        continue;
      }
      const closing = round((b.allocated ?? 0) - b.used - b.pending);
      /* At the period end, what the type does not carry forward lapses. */
      const carry = Math.min(b.carryLimit ?? carryLimitOf(t), Math.max(0, round((b.allocated ?? 0) - b.used)));
      rows.push({
        employeeId: p.id, name: p.name, code: p.code, department: p.department, leaveTypeId: t.id, leaveType: t.name, isPaid: true,
        opening: b.carriedIn ?? 0,
        credited: b.allocationId ? round((b.allocated ?? 0) - (b.adjusted ?? 0)) : b.earned ?? 0,
        changed, taken: b.used, encashed, pending: b.pending,
        lapsed: ended ? round(Math.max(0, (b.allocated ?? 0) - b.used) - carry) : null,
        closing,
      });
    }
  }
  res.json({ period: bounds, ended, types: shown.map((t) => ({ id: t.id, name: t.name, isPaid: t.isPaid, color: t.color })), rows });
});

/**
 * The leave register in a prescribed form, one worker at a time (TIME-LEAVE-MARKET-RESEARCH.md G2): days worked in
 * the period, and for each leave type the opening balance, leave earned, leave availed with its dates, leave asked
 * for and refused, paid out, lapsed and the closing balance. The layout follows OSH (Central) Rules 2026 Form XX and
 * Factories Rules Form 15 as the research describes them (secondary sources; the forms' own columns were not read),
 * so the screen says "format based on". Same scope and privacy as the register.
 */
leaveRouter.get(`${base}/register/book`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = await yearParam(orgId, req.query.year);
  const only = String(req.query.employeeId || '').trim();
  const period = await leavePeriodOf(orgId);
  const bounds = periodBounds(period, year);
  const scope = await leaveScope(req);
  if (only && !inScope(scope, only)) return res.status(404).json({ error: 'No such employee.' });
  const people = await peoplePrisma.employee.findMany({
    where: { accountId, orgId, ...(only ? { id: only } : scope.all ? {} : { id: { in: scope.ids } }), OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: bounds.from } }], AND: [{ OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: bounds.to } }] }] },
    select: { id: true, name: true, code: true, department: true, designation: true, dateOfJoining: true, dateOfLeaving: true, branchId: true, areaId: true },
    orderBy: { name: 'asc' },
    take: 500,
  });
  const ids = people.map((p) => p.id);
  const [{ types, balances }, adjustments, requests, worked] = await Promise.all([
    balancesFor(accountId, orgId, ids, year),
    peoplePrisma.leaveAdjustment.findMany({ where: { orgId, year, reversedAt: null, employeeId: { in: ids } }, select: { employeeId: true, leaveTypeId: true, days: true, kind: true } }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: { in: ids }, status: { in: ['APPROVED', 'REJECTED'] }, fromDate: { gte: bounds.from, lte: bounds.to } }, select: { employeeId: true, leaveTypeId: true, fromDate: true, toDate: true, days: true, status: true, reviewNote: true, reviewedByUserId: true }, orderBy: { fromDate: 'asc' } }),
    daysWorkedByPeriod(accountId, orgId, people, period, year, year),
  ]);
  const ended = today() > bounds.to;
  const reads = await readsPrivateLeave(req);
  const shown = types.filter((t) => reads || !t.isPrivate);
  const workers = people.map((p) => {
    const w = worked.get(p.id)?.get(String(year)) ?? null;
    const leave = [];
    for (const t of shown) {
      const b = balances.get(p.id)?.get(t.id);
      const mine = requests.filter((r) => r.employeeId === p.id && r.leaveTypeId === t.id);
      const availed = mine.filter((r) => r.status === 'APPROVED').map((r) => ({ from: r.fromDate, to: r.toDate, days: r.days }));
      /* Refused: rejected by HR or the manager, not by the system. */
      const refused = mine.filter((r) => r.status === 'REJECTED' && r.reviewedByUserId !== 'system').map((r) => ({ from: r.fromDate, to: r.toDate, days: r.days }));
      if (!b) continue;
      if (!t.isPaid) {
        if (availed.length || refused.length) leave.push({ leaveTypeId: t.id, leaveType: t.name, code: t.code, isPaid: false, opening: null, earned: null, changed: null, availed, availedDays: round(availed.reduce((a, r) => a + r.days, 0)), refused, refusedDays: round(refused.reduce((a, r) => a + r.days, 0)), encashed: null, lapsed: null, closing: null });
        continue;
      }
      if (!t.isActive && !availed.length && !b.allocated) continue;
      const adj = adjustments.filter((a) => a.employeeId === p.id && a.leaveTypeId === t.id);
      const encashed = round(-adj.filter((a) => a.kind === 'ENCASH').reduce((x, a) => x + a.days, 0));
      const changed = round(adj.filter((a) => a.kind !== 'ENCASH').reduce((x, a) => x + a.days, 0));
      const carry = Math.min(b.carryLimit ?? carryLimitOf(t), Math.max(0, round((b.allocated ?? 0) - b.used)));
      leave.push({
        leaveTypeId: t.id, leaveType: t.name, code: t.code, isPaid: true,
        opening: b.carriedIn ?? 0,
        earned: b.allocationId ? round((b.allocated ?? 0) - (b.adjusted ?? 0)) : b.earned ?? 0,
        changed, availed, availedDays: b.used, refused, refusedDays: round(refused.reduce((a, r) => a + r.days, 0)), encashed,
        lapsed: ended ? round(Math.max(0, (b.allocated ?? 0) - b.used) - carry) : null,
        closing: round((b.allocated ?? 0) - b.used),
      });
    }
    return { employeeId: p.id, name: p.name, code: p.code, department: p.department, designation: p.designation, dateOfJoining: p.dateOfJoining, dateOfLeaving: p.dateOfLeaving, daysWorked: w ? { worked: w.worked, withPaidLeave: w.eligible, source: w.source } : null, leave };
  });
  res.json({ period: bounds, ended, format: 'Based on OSH (Central) Rules 2026 Form XX and Factories Rules Form 15', workers });
});

// ---------------------------------------------------------------------------
// Time & Leave (People): preview, one request's story, the overview, a
// policy tried on real people, the working week
// ---------------------------------------------------------------------------

/** Who else is away (or waiting to be) on these dates, inside the reader's scope; private leave masked. */
async function alsoAway(req: any, orgId: string, employeeId: string, from: string, to: string, reads: boolean) {
  const scope = await leaveScope(req);
  const rows = await peoplePrisma.leaveRequest.findMany({
    where: { orgId, status: { in: OPEN }, employeeId: { not: employeeId, ...(scope.all ? {} : { in: scope.ids }) }, fromDate: { lte: to }, toDate: { gte: from } },
    orderBy: { fromDate: 'asc' },
    take: 50,
  });
  return masked(await withTypes(orgId, rows), reads).map((r: any) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employeeName, department: r.department, leaveTypeName: r.leaveTypeName, leaveTypeColor: r.leaveTypeColor, fromDate: r.fromDate, toDate: r.toDate, status: r.status }));
}

/**
 * A preview as the screens show it: the plan and its problems; for HR and
 * managers (`req`), who else is away. Someone asking for themselves sees
 * their own days only, never colleagues'.
 */
export async function previewOut(req: any | null, accountId: string, orgId: string, employee: Asker & { name?: string; departmentId?: string | null }, body: any, onBehalf: boolean) {
  const parsed = requestSchema.safeParse(body || {});
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0]?.message || 'Check the request.' } };
  /* `editing`: the request being changed, left out of the overlap check; its own waiting days come back to the balance. */
  const editing = String(body?.editing || '').trim();
  const mine = editing ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, employeeId: employee.id, status: 'PENDING', OR: [{ id: editing }, { groupId: (await peoplePrisma.leaveRequest.findFirst({ where: { id: editing, orgId }, select: { groupId: true } }))?.groupId || '__none__' }] }, select: { id: true, days: true, leaveTypeId: true } }) : [];
  const plan = await planLeave(accountId, orgId, employee, parsed.data, onBehalf, mine.map((x) => x.id));
  if (!('error' in plan) && mine.length && mine[0].leaveTypeId === plan.type.id) {
    const back = mine.reduce((a, x) => a + x.days, 0);
    for (const part of plan.parts) if (part.balance.before != null) { part.balance.before = round(part.balance.before + back); part.balance.after = round((part.balance.after ?? 0) + back); }
    plan.problems.splice(0, plan.problems.length, ...plan.problems.filter((x) => x.code !== 'NO_BALANCE' || plan.parts.some((part) => (part.balance.locked && part.days > 0) || (part.balance.after != null && part.balance.after < -part.balance.negativeDays))));
  }
  if ('error' in plan) return { status: 200, body: { ok: false, problems: [{ code: 'INPUT', message: plan.error }], parts: [], total: 0 } };
  /* The reason is the asker's to give; the preview does not hold a draft to it. */
  const own = { ok: !plan.problems.some((p) => p.code !== 'REASON' && p.code !== 'DOCUMENT'), type: { id: plan.type.id, name: plan.type.name, isPaid: plan.type.isPaid, isPrivate: plan.type.isPrivate, allowHalfDay: plan.type.allowHalfDay, sandwich: plan.type.sandwich, negativeDays: plan.type.negativeDays, unit: plan.type.unit, hoursPerDay: plan.type.hoursPerDay ?? null, overBalance: plan.type.overBalance }, total: plan.total, split: plan.split,
    parts: plan.parts.map((p) => ({ year: p.year, label: p.label, from: p.from, to: p.to, days: p.days, balance: p.balance, dates: p.dates, rows: p.rows, overflow: p.overflow ? { typeName: p.overflow.typeName, from: p.overflow.from, to: p.overflow.rows[p.overflow.rows.length - 1].to, days: p.overflow.days } : null })),
    problems: plan.problems.filter((p) => p.code !== 'REASON' && p.code !== 'DOCUMENT'),
    /* Not stopping it: serving notice (WARN), days over the balance as loss of pay. */
    warnings: plan.warnings,
    hours: plan.hours ? { fromTime: plan.hours.fromTime, toTime: plan.hours.toTime, minutes: plan.hours.minutes } : null,
    reasonNeeded: !plan.type.isPrivate, documentNeeded: documentNeeded(plan.type, plan.asked), documentAfterDays: plan.type.attachmentAfterDays ?? null };
  if (!req) return { status: 200, body: own };
  const reads = await readsPrivateLeave(req);
  const away = await alsoAway(req, orgId, employee.id, parsed.data.fromDate, parsed.data.toDate, reads);
  const dept = (employee as any).departmentId ?? (await peoplePrisma.employee.findFirst({ where: { id: employee.id, orgId }, select: { departmentId: true } }))?.departmentId ?? null;
  const deptPeople = dept ? new Set((await peoplePrisma.employee.findMany({ where: { orgId, departmentId: dept, status: { not: 'LEFT' } }, select: { id: true } })).map((x) => x.id)) : null;
  return {
    status: 200,
    body: { ...own, alsoAway: away.slice(0, 20), alsoAwayCount: away.length, sameDepartment: deptPeople ? away.filter((a) => deptPeople.has(a.employeeId)).length : null },
  };
}

leaveRouter.post(`${base}/requests/preview`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const employee = await employeeIn(orgId, accountId, String(req.body?.employeeId || ''));
    await scopedOr404(req, employee.id);
    const out = await previewOut(req, accountId, orgId, employee, req.body, true);
    res.status(out.status).json(out.body);
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post('/orgs/:orgId/attendance/me/leave/preview', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const out = await previewOut(null, accountId, orgId, me, req.body, false);
    res.status(out.status).json(out.body);
  } catch (e) {
    return sendError(res, e);
  }
});

/** Names for the user ids a request carries: CLOR users, the employee app's `portal:<employee>`, the API, CLOR itself. */
export async function actorNames(orgId: string, ids: Array<string | null | undefined>) {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  const users = list.filter((x) => !x.includes(':') && x !== 'system');
  const portal = list.filter((x) => x.startsWith('portal:')).map((x) => x.slice(7));
  const [u, e] = await Promise.all([
    users.length ? platformPrisma.user.findMany({ where: { id: { in: users } }, select: { id: true, fullName: true } }) : [],
    portal.length ? peoplePrisma.employee.findMany({ where: { orgId, id: { in: portal } }, select: { id: true, name: true } }) : [],
  ]);
  const out = new Map<string, string>();
  for (const x of u) out.set(x.id, x.fullName);
  for (const x of e) out.set(`portal:${x.id}`, x.name);
  for (const x of list) if (!out.has(x)) out.set(x, x === 'system' ? 'CLOR' : x.startsWith('api:') ? 'An outside system (API)' : 'Someone');
  return out;
}

/** Where a request under the leave rule stands: the rule, its steps, the one waiting, who it waits for, and whether it is this reader's. */
async function stepView(orgId: string, r: any, userId: string) {
  if (!r.ruleId) return null;
  const rule = await peoplePrisma.approvalRule.findUnique({ where: { id: r.ruleId }, select: { name: true, version: true, steps: true } });
  const names = r.status === 'PENDING' && r.stepUserIds?.length ? await actorNames(orgId, r.stepUserIds) : new Map<string, string>();
  return {
    rule: rule ? `${rule.name} (v${rule.version})` : 'Leave approval rule',
    of: Array.isArray(rule?.steps) ? (rule!.steps as unknown[]).length : null,
    current: r.status === 'PENDING' ? r.ruleStep : null,
    waitingFor: r.status === 'PENDING' ? (r.stepUserIds || []).map((u: string) => names.get(u)).filter(Boolean) : [],
    dueAt: r.status === 'PENDING' ? r.stepDueAt : null,
    yours: takesStep(r, [userId]),
  };
}

/** The document sent with a request, for whoever may open the request and read what it is for (a private type's reason). */
leaveRouter.get(`${base}/requests/:id/document`, canOrStep(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  const stepper = Boolean(r && (takesStep(r, [req.auth!.userId]) || (await engineStepper(accountId, orgId, r, req.auth!.userId))));
  if (!r || (!inScope(await leaveScope(req), r.employeeId) && !stepper) || !r.attachmentDocId) return res.status(404).json({ error: 'No document with this request.' });
  const type = await peoplePrisma.leaveType.findFirst({ where: { id: r.leaveTypeId, orgId }, select: { isPrivate: true } });
  if (type?.isPrivate && !stepper && !(await readsPrivateLeave(req))) return res.status(404).json({ error: 'No document with this request.' });
  const d = await peoplePrisma.employeeDocument.findFirst({ where: { id: r.attachmentDocId, orgId } });
  if (!d) return res.status(404).json({ error: 'The document was removed from the person’s file.' });
  if (d.classification === 'CONFIDENTIAL') await peoplePrisma.accessLog.create({ data: { accountId, orgId, what: 'DOC_CONFIDENTIAL', entityId: d.id, employeeId: d.employeeId, userId: req.auth!.userId } });
  res.json({ document: { id: d.id, title: d.title, mime: d.mime, size: d.size, dataUrl: `data:${d.mime};base64,${Buffer.from(d.data).toString('base64')}` } });
});

/**
 * One request's story (TL-045): who asked, for whom, the manager's step, the
 * decision and its note, a cancellation; the days charged and skipped; the
 * balance with and without it; who else is away; the other parts of a leave
 * split at the period end.
 */
leaveRouter.get(`${base}/requests/:id`, canOrStep(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  const stepper = Boolean(r && (takesStep(r, [req.auth!.userId]) || (await engineStepper(accountId, orgId, r, req.auth!.userId))));
  if (!r || (!inScope(await leaveScope(req), r.employeeId) && !stepper)) return res.status(404).json({ error: 'No such request.' });
  try {
    /* Whoever decides a step reads what they decide on, a private type's reason included. */
    const reads = (await readsPrivateLeave(req)) || stepper;
    const [shaped] = masked(await withTypes(orgId, [r]), reads);
    const employee = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { id: true, name: true, userId: true, branchId: true, areaId: true, reportingManagerId: true } });
    const type = await peoplePrisma.leaveType.findFirst({ where: { id: r.leaveTypeId, orgId } });
    const stored = (Array.isArray(r.history) ? r.history : []) as HistoryEntry[];
    const names = await actorNames(orgId, [r.requestedByUserId, r.reviewedByUserId, ...stored.map((h) => h.by)]);
    const manager = r.managerApprovedById ? await peoplePrisma.employee.findFirst({ where: { id: r.managerApprovedById, orgId }, select: { name: true } }) : null;
    const own = Boolean(employee?.userId && r.requestedByUserId === employee.userId) || r.requestedByUserId === `portal:${r.employeeId}`;
    const WORDS: Record<string, string> = { ASKED: 'Asked', ENTERED: `Entered for ${employee?.name || 'them'}`, MANAGER_APPROVED: 'Approved by the manager', HANDED_ON: 'Handed on to HR', APPROVED: 'Approved', AUTO_APPROVED: 'Approved by the leave rule', REJECTED: 'Rejected', CANCELLED: 'Cancelled', WITHDRAWN: 'Withdrawn', EDITED: 'Changed', REASON_EDITED: 'Changed the reason', SHORTENED: 'Came back early', STEP_APPROVED: 'Approved a step', STEP_SKIPPED: 'Step skipped', STEP_WAITING: 'Step sent on', STEP_HANDED_ON: 'Step handed on', RULE_SKIPPED: 'Not approved by the rule' };
    /* The request's own history where it has one (every change since the advanced build); the fields it carried before otherwise. */
    const history: Array<{ at: Date; what: string; by: string | null; note?: string | null; from?: string | null; to?: string | null }> = stored.length
      ? stored.map((h) => ({ at: new Date(h.at), what: WORDS[h.what] || h.what, by: h.by === 'system' ? null : names.get(h.by || '') || null, note: shaped.reasonHidden ? null : h.note ?? null, from: h.from ?? null, to: h.to ?? null }))
      : [{ at: r.createdAt, what: own ? 'Asked' : `Entered for ${employee?.name || 'them'}`, by: names.get(r.requestedByUserId) || null }];
    if (!stored.length && r.managerApprovedAt) history.push({ at: r.managerApprovedAt, what: r.managerApprovedById ? 'Approved by the manager' : 'Handed on to HR', by: manager?.name || null, note: shaped.reasonHidden ? null : r.managerNote });
    if (!stored.length && r.reviewedAt && r.status !== 'PENDING') history.push({ at: r.reviewedAt, what: ({ APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' } as Record<string, string>)[r.status] || r.status, by: names.get(r.reviewedByUserId || '') || null, note: shaped.reviewNote });
    const dates = employee && type ? await dayPlan(orgId, employee, r.fromDate, r.toDate, type, r) : [];
    let balance = null;
    if (type?.isPaid && !shaped.reasonHidden) {
      const year = await leaveYearOf(orgId, r.fromDate);
      const { balances } = await balancesFor(accountId, orgId, [r.employeeId], year, r.fromDate > today() ? r.fromDate : undefined);
      const b = balances.get(r.employeeId)!.get(type.id)!;
      /* "Without" adds this request back while it still holds days (waiting or approved). */
      const holds = OPEN.includes(r.status);
      balance = { year, label: periodLabel(await leavePeriodOf(orgId), year), allocated: b.allocated, available: b.available, without: b.available == null ? null : round(b.available + (holds ? r.days : 0)), with: b.available == null ? null : round(holds ? b.available : b.available - r.days) };
    }
    const parts = r.groupId ? masked(await withTypes(orgId, await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: r.groupId }, orderBy: { fromDate: 'asc' } })), reads) : [];
    const turn = r.status === 'PENDING' && !r.ruleId ? await hrMayDecide(orgId, 'leave', r, await leaveChainFor(orgId, r.leaveTypeId)) : { ok: true as const };
    /* The manager (or their stand-in) reading it is not waiting on anyone: Approve takes their step, as it does on the Approvals row. */
    const reader = turn.ok ? null : await peoplePrisma.employee.findFirst({ where: { orgId, userId: req.auth!.userId }, select: { id: true } });
    const takesManagerStep = Boolean(reader && (await managerStepBy(orgId, reader.id, r.employeeId, undefined, 'LEAVE')));
    /* Leave that ran over the balance into loss of pay is changed by withdrawing it and asking again (editLeave refuses it). */
    const linkedLop = Boolean(r.overflowOfId) || (r.groupId ? Boolean(await peoplePrisma.leaveRequest.findFirst({ where: { orgId, groupId: r.groupId, overflowOfId: { not: null } }, select: { id: true } })) : false);
    const editable = r.status === 'PENDING' && !linkedLop && (await readsPrivateLeave(req) || !shaped.reasonHidden);
    res.json({
      request: shaped,
      history,
      dates,
      balance,
      canEdit: editable,
      canShorten: r.status === 'APPROVED' && !r.halfDay && r.fromDate <= today() && r.toDate > today(),
      parts: parts.map((p: any) => ({ id: p.id, fromDate: p.fromDate, toDate: p.toDate, days: p.days, halfDay: p.halfDay ?? null, status: p.status, leaveTypeName: p.leaveTypeName, overflowOfId: p.overflowOfId ?? null })),
      alsoAway: await alsoAway(req, orgId, r.employeeId, r.fromDate, r.toDate, reads),
      waitingForManager: turn.ok || takesManagerStep ? null : turn.error,
      ownRequest: Boolean(employee?.userId && employee.userId === req.auth!.userId),
      step: r.ruleId ? await stepView(orgId, r, req.auth!.userId) : await engineStepView(accountId, orgId, r, req.auth!.userId),
      document: r.attachmentDocId && reads ? await peoplePrisma.employeeDocument.findFirst({ where: { id: r.attachmentDocId, orgId }, select: { id: true, title: true, mime: true, size: true } }) : null,
      documentNeeded: Boolean(type && documentNeeded(type, r.days)),
    });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * Approved work from home and on duty overlapping a range, inside a scope:
 * the people working but not at the office. Shown beside leave with their
 * own mark, never counted as leave.
 */
export async function workingAway(orgId: string, scope: TeamScope, from: string, to: string) {
  const rows = await peoplePrisma.attendanceRequest.findMany({
    where: { orgId, status: 'APPROVED', kind: { in: ['WFH', 'ON_DUTY'] }, date: { lte: to }, OR: [{ toDate: null, date: { gte: from } }, { toDate: { gte: from } }], ...scopeRows(scope) },
    orderBy: [{ date: 'asc' }],
    take: 2000,
  });
  return (await withNames(orgId, rows)).map((r: any) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employeeName, employeeCode: r.employeeCode, department: r.department, photoUrl: r.photoUrl, kind: r.kind, fromDate: r.date, toDate: r.toDate || r.date, halfDay: r.halfDay, place: r.kind === 'ON_DUTY' ? r.place : null }));
}

/** The calendar's other marks: approved work from home and on duty in a month or range. */
leaveRouter.get(`${base}/working-away`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : '';
  const from = month ? `${month}-01` : ISO_DATE.test(String(req.query.from || '')) ? String(req.query.from) : today();
  const to = month ? `${month}-31` : ISO_DATE.test(String(req.query.to || '')) ? String(req.query.to) : from;
  if (to < from) return res.status(400).json({ error: 'The end is before the start.' });
  res.json({ from, to, rows: await workingAway(req.tenant!.orgId, await leaveScope(req), from, to) });
});

/**
 * A month's payable and loss-of-pay days per person (Time & Leave →
 * Attendance), from the calculation Payroll takes them with
 * (services/attendance/payableDays.ts): Attendance's month summary when it is
 * on, approved leave alone when it is not. Inside the reader's team.
 */
leaveRouter.get('/orgs/:orgId/attendance/payable-days', requirePermission(ATTENDANCE_MODULE, PermissionAction.VIEW as any, R.records), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : today().slice(0, 7);
  const scope = await teamScope(req);
  const { payableMonth } = await import('../services/attendance/payableDays.js');
  const out = await payableMonth(accountId, orgId, month, scope.all ? null : scope.ids);
  /* Once a payroll run has taken the month, say when: the figures are then the ones paid. */
  const periods = await payrollPrisma.payrollPeriod.findMany({ where: { orgId, startDate: { lte: `${month}-31` }, endDate: { gte: `${month}-01` } }, select: { id: true, name: true } });
  const run = periods.length ? await payrollPrisma.payrollRun.findFirst({ where: { orgId, periodId: { in: periods.map((p) => p.id) }, status: { in: ['APPROVED', 'LOCKED', 'PAID', 'POSTED'] } }, orderBy: { updatedAt: 'desc' }, select: { periodId: true, status: true, updatedAt: true } }) : null;
  const payrollTook = run ? { period: periods.find((p) => p.id === run.periodId)?.name || month, state: run.status, on: new Date(run.updatedAt.getTime() + 330 * 60_000).toISOString().slice(0, 10) } : null;
  res.json({ month, source: out.source, rows: out.rows, payrollTaken: payrollTook });
});

/**
 * The Time & Leave overview: who is away today, what is waiting (oldest
 * first, and how long), who comes back this week, who is away in the next
 * seven days, and days that lapse at the period end. Inside the reader's scope.
 */
leaveRouter.get(`${base}/overview`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const scope = await leaveScope(req);
  const reads = await readsPrivateLeave(req);
  const t0 = today();
  const week = addDays(t0, 7);
  const sc = scopeRows(scope);
  const [awayRows, waitingAll, upcomingRows] = await Promise.all([
    peoplePrisma.leaveRequest.findMany({ where: { orgId, ...sc, status: 'APPROVED', fromDate: { lte: t0 }, toDate: { gte: t0 } }, orderBy: { toDate: 'asc' }, take: 200 }),
    waitingForReader(orgId, scope, req.auth!.userId),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, ...sc, status: { in: OPEN }, fromDate: { gt: t0, lte: week } }, orderBy: { fromDate: 'asc' }, take: 50 }),
  ]);
  const waitingRows = waitingAll.slice(0, 8);
  const waitingCount = waitingAll.length;
  const oldWaiting = waitingAll.filter((r) => r.createdAt.getTime() < Date.now() - 3 * 86_400_000).length;
  const shape = async (rows: any[]) => masked(await withTypes(orgId, rows), reads).map((r: any) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employeeName, employeeCode: r.employeeCode, department: r.department, photoUrl: r.photoUrl, leaveTypeName: r.leaveTypeName, leaveTypeColor: r.leaveTypeColor, fromDate: r.fromDate, toDate: r.toDate, days: r.days, halfDay: r.halfDay, fromTime: r.fromTime ?? null, toTime: r.toTime ?? null, overflowOfId: r.overflowOfId ?? null, status: r.status, createdAt: r.createdAt, managerApprovedAt: r.managerApprovedAt }));
  /* Days that lapse: within 60 days of the period end, what is left above what the type carries forward. */
  const period = await leavePeriodOf(orgId);
  const year = periodOf(period, t0);
  const end = periodEnd(period, year);
  let lapsing: Array<{ employeeId: string; employeeName: string; leaveTypeName: string; days: number }> = [];
  if (addDays(t0, 60) >= end) {
    const people = await peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' }, ...(scope.all ? {} : { id: { in: scope.ids } }) }, select: { id: true, name: true }, take: 2000 });
    const { types, balances } = await balancesFor(accountId, orgId, people.map((p) => p.id), year, end);
    for (const p of people) for (const t of types.filter((x) => x.isPaid && x.isActive && (reads || !x.isPrivate))) {
      const b = balances.get(p.id)?.get(t.id);
      if (!b || b.available == null) continue;
      const carry = b.carryLimit ?? carryLimitOf(t);
      const lapse = round(b.available - carry);
      if (lapse > 0) lapsing.push({ employeeId: p.id, employeeName: p.name, leaveTypeName: t.name, days: lapse });
    }
    lapsing = lapsing.sort((a, b) => b.days - a.days).slice(0, 20);
  }
  res.json({
    today: t0,
    /* A reader who sees a team, not the company: two of the team away the same day is a clash, whatever their departments (M4). */
    team: !scope.all,
    awayToday: await shape(awayRows),
    /* Working, but not at the office: approved work from home and on duty, their own mark, never leave (HR view audit 3.3). */
    workingAwayToday: await workingAway(orgId, scope, t0, t0),
    waiting: { count: waitingCount, olderThan3Days: oldWaiting, oldest: await shape(waitingRows) },
    upcoming: await shape(upcomingRows),
    lapsing: { periodEnd: end, label: periodLabel(period, year), rows: lapsing },
  });
});

/**
 * A leave type tried on five real people before it is saved (TLA-015): what
 * each gets this period, credited when, and whether the type is open to them.
 * Nothing is written. People are picked to show the edges: the newest
 * joiner, the longest serving, someone who joined mid-period, and two more.
 */
leaveRouter.post(`${base}/types/preview`, can(PermissionAction.VIEW, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = typeSchema.safeParse({ name: 'Preview', ...(req.body || {}) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the leave type.' });
  const policy = await policyOf(orgId, req.body);
  if ('error' in policy) return res.status(400).json({ error: policy.error });
  const t = { ...parsed.data, ...policy.data } as any;
  const period = await leavePeriodOf(orgId);
  const year = periodOf(period, today());
  const bounds = periodBounds(period, year);
  const scope = await leaveScope(req);
  const all = await peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' }, ...(scope.all ? {} : { id: { in: scope.ids } }) }, select: { id: true, name: true, code: true, gender: true, employeeTypeId: true, dateOfJoining: true }, orderBy: { dateOfJoining: 'asc' }, take: 5000 });
  const joined = all.filter((p) => p.dateOfJoining);
  const picks = new Map<string, { person: (typeof all)[number]; why: string }>();
  const add = (p: (typeof all)[number] | undefined, why: string) => { if (p && !picks.has(p.id) && picks.size < 5) picks.set(p.id, { person: p, why }); };
  add(joined[joined.length - 1], 'Newest joiner');
  add(joined[0], 'Longest serving');
  add(joined.find((p) => p.dateOfJoining! > bounds.from && p.dateOfJoining! <= bounds.to), 'Joined this period');
  for (const p of all) add(p, '');
  const accrualType = { id: 'preview', annualDays: t.annualDays, accrual: t.accrual, prorateForJoiners: t.prorateForJoiners, carryForwardMax: t.carryForwardMax ?? null, createdAt: new Date(`${bounds.from}T00:00:00Z`), creditOn: t.creditOn ?? 'START', creditDay: t.creditDay ?? null, accrualBasis: t.accrualBasis ?? 'CALENDAR', perDaysWorked: t.perDaysWorked ?? null, minDaysWorked: t.minDaysWorked ?? null, oshCarry: Boolean(t.oshCarry) };
  const t0 = today();
  const full = all.length ? new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...picks.keys()] } }, select: { id: true, employeeTypeId: true, dateOfJoining: true, dateOfLeaving: true, probationEndDate: true, confirmedOn: true, branchId: true, areaId: true } })).map((p) => [p.id, p])) : new Map();
  /* Earned by days worked: the five people's days worked last period and this one. */
  const worked = t.isPaid && t.accrualBasis === 'PER_DAYS_WORKED' && full.size ? await daysWorkedByPeriod(accountId, orgId, [...full.values()], period, year - 1, year) : new Map<string, Map<string, Worked>>();
  const rows = [...picks.values()].map(({ person, why }) => {
    const problem = policyProblem({ name: 'This type', allowHalfDay: true, minNoticeDays: null, maxDaysPerRequest: null, backdatedDays: null, gender: t.gender ?? null, employeeTypeIds: t.employeeTypeIds || [], availableAfterDays: t.availableAfterDays ?? null, availableAfterBasis: t.availableAfterBasis ?? 'JOINING' }, person, { fromDate: t0 > (person.dateOfJoining || '') ? t0 : person.dateOfJoining!, halfDay: null, days: 0 }, t0, true);
    if (!t.isPaid) return { employeeId: person.id, name: person.name, code: person.code, why, dateOfJoining: person.dateOfJoining, open: !problem, note: problem, fullPeriod: null, soFar: null, credits: [] };
    const p = full.get(person.id) || person;
    const joined = p.dateOfJoining || null;
    const entitled = entitledDays({ annualDays: t.annualDays, entitlements: t.entitlements }, p, joined && joined > bounds.from ? joined : bounds.from);
    const probation = probationOf({ probationRule: t.probationRule }, p, t0);
    const b = balanceFor({ ...accrualType, annualDays: entitled }, year, probation.joinedForLeave, t0 > bounds.to ? bounds.to : t0, new Map(), new Map(), { period, workedIn: (y) => worked.get(person.id)?.get(String(y)) ?? null });
    return { employeeId: person.id, name: person.name, code: person.code, why, dateOfJoining: person.dateOfJoining, open: !problem, note: problem ?? (probation.locked ? `Locked until confirmed${probation.until ? ` (${dayWords(probation.until)})` : ''}` : null), entitled: t.accrualBasis === 'PER_DAYS_WORKED' ? b.fullYear : entitled, fullPeriod: b.fullYear ?? null, soFar: b.earned, credits: (b.credits || []).slice(0, 12).map((c: any) => ({ date: c.date, days: c.days })) };
  });
  res.json({ period: bounds, rows, carry: t.carryForwardMax ?? null });
});

const WEEKDAY = /^([0-6](,[0-6])*)?$/;
/** The company's working week: weekly offs for anyone no shift covers (People-only companies set only this). */
leaveRouter.get(`${base}/working-week`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const s = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { weeklyOffDays: true, offSaturdays: true, defaultShiftId: true, restrictedHolidayQuota: true, compOffLeaveTypeId: true, workingWeekEarlier: true } });
  /* What the schedule engine really reads (schedule.ts resolveShift), Attendance on or not: anyone on a shift follows it. */
  const [assigned, rotating, departments, temporary, guard] = await Promise.all([
    peoplePrisma.shiftAssignment.count({ where: { orgId } }),
    peoplePrisma.rotationAssignment.count({ where: { orgId } }),
    peoplePrisma.departmentSchedule.count({ where: { orgId } }),
    peoplePrisma.temporarySchedule.count({ where: { orgId } }),
    scheduleGuard(orgId),
  ]);
  const earlier = earlierWeeks(s?.workingWeekEarlier);
  res.json({
    weeklyOffDays: s?.weeklyOffDays ?? '0',
    /* The date this week applies from (null = always), and the first date a change may start from while months are closed. */
    effectiveFrom: earlier.length ? earlier[earlier.length - 1].until : null,
    firstOpenDate: guard.latest ? dayAfterMonth(guard.latest) : null,
    offSaturdays: s?.offSaturdays ?? '',
    restrictedHolidayQuota: s?.restrictedHolidayQuota ?? 0,
    compOffLeaveTypeId: s?.compOffLeaveTypeId ?? null,
    /* A default shift replaces the working week for everyone not on another shift. */
    defaultShift: Boolean(s?.defaultShiftId),
    shiftsDecide: Boolean(s?.defaultShiftId) || assigned + rotating + departments + temporary > 0,
  });
});

leaveRouter.put(`${base}/working-week`, can(PermissionAction.EDIT, R.leaveTypes), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({
    weeklyOffDays: z.string().regex(WEEKDAY, 'Weekly offs are day numbers 0–6.'),
    offSaturdays: z.string().regex(/^([1-5](,[1-5])*)?$/, 'Saturdays are 1st to 5th.').default(''),
    /** Restricted holidays a person may pick a year from the optional list. */
    restrictedHolidayQuota: z.coerce.number().int().min(0).max(20).optional(),
    /** The leave type comp-off is credited to (null = comp-off off). */
    compOffLeaveTypeId: z.string().min(1).nullable().optional(),
    /**
     * The first date the new week applies on; earlier dates keep the week they
     * had. Omitted: the new week applies to every date, which a closed month
     * refuses (O-05).
     */
    effectiveFrom: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.').nullable().optional().or(z.literal('')),
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the working week.' });
  const offs = [...new Set(parsed.data.weeklyOffDays.split(',').filter(Boolean))].sort().join(',');
  if (offs.split(',').filter(Boolean).length >= 7) return res.status(400).json({ error: 'At least one day of the week is a working day.' });
  const sats = offs.split(',').includes('6') ? '' : [...new Set(parsed.data.offSaturdays.split(',').filter(Boolean))].sort().join(',');
  if (parsed.data.compOffLeaveTypeId && !(await peoplePrisma.leaveType.findFirst({ where: { id: parsed.data.compOffLeaveTypeId, orgId, isPaid: true }, select: { id: true } }))) return res.status(400).json({ error: 'Choose a paid leave type for comp-off.' });
  /*
   * A closed month's weekly offs are final (O-05): a new week either starts
   * after the last closed month, or waits for the month to be reopened. A
   * change from a date keeps the weeks before it, so those dates do not move.
   */
  const current = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { weeklyOffDays: true, offSaturdays: true, workingWeekEarlier: true } });
  const was = { weeklyOffDays: current?.weeklyOffDays ?? '0', offSaturdays: current?.offSaturdays ?? '' };
  const from = parsed.data.effectiveFrom || null;
  const weekChanged = offs !== was.weeklyOffDays || sats !== was.offSaturdays;
  let history: { workingWeekEarlier?: EarlierWeek[] | typeof PeoplePrisma.DbNull } = {};
  if (weekChanged) {
    const refused = (await scheduleGuard(orgId)).refusal([{ from, to: null }], (month, latest) =>
      from
        ? `${month} is closed in Attendance, and a new working week from ${from} would work its days out again. Start it from ${dayAfterMonth(latest)} or later, or reopen the month.`
        : `${month} is closed in Attendance, and a new working week would work its days out again. Set the date it starts from, ${dayAfterMonth(latest)} or later.`);
    if (refused) return sendError(res, refused);
    const kept = from ? weeksBefore(earlierWeeks(current?.workingWeekEarlier), was, from) : [];
    history = { workingWeekEarlier: kept.length ? kept : PeoplePrisma.DbNull };
  }
  const data = { weeklyOffDays: offs, offSaturdays: sats, ...(parsed.data.restrictedHolidayQuota != null ? { restrictedHolidayQuota: parsed.data.restrictedHolidayQuota } : {}), ...(parsed.data.compOffLeaveTypeId !== undefined ? { compOffLeaveTypeId: parsed.data.compOffLeaveTypeId, compOffEnabled: Boolean(parsed.data.compOffLeaveTypeId) } : {}) };
  /* Both: the dated history (O-05) and before/after in one transaction (audit). */
  const fields = { weeklyOffDays: true, offSaturdays: true, restrictedHolidayQuota: true, compOffLeaveTypeId: true, compOffEnabled: true } as const;
  const { before, after } = await peopleWrite(orgId, async () => {
    const before = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: fields });
    const after = await peoplePrisma.attendanceSettings.upsert({ where: { orgId }, update: { ...data, ...history } as any, create: { accountId, orgId, ...data, ...history, updatedByUserId: req.auth!.userId } as any, select: fields });
    return { before, after };
  });
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  await recordAudit(req, { entity: 'WorkingWeek', entityId: orgId, action: 'UPDATE', message: `Working week: ${offs ? offs.split(',').map((d) => names[Number(d)]).join(', ') : 'no day'} off${sats ? `; Saturdays ${sats} off` : ''}${weekChanged && from ? `, from ${from}` : ''}`, metadata: { ...data, before, after, effectiveFrom: weekChanged ? from : undefined } });
  const kept = history.workingWeekEarlier !== undefined ? earlierWeeks(history.workingWeekEarlier) : earlierWeeks(current?.workingWeekEarlier);
  res.json({ ...data, effectiveFrom: kept.length ? kept[kept.length - 1].until : null });
});

// ---------------------------------------------------------------------------
// Edit, come back early, comp-off, stand-ins, restricted holidays, year end
// ---------------------------------------------------------------------------

/**
 * Change a waiting request (dates, half day, reason, type): the same plan as
 * a new one, the person's own days left out of the overlap and balance
 * checks. The first row keeps its id; other parts of a split are replaced.
 * The manager's step starts again, since what they approved has changed.
 */
export async function editLeave(accountId: string, orgId: string, r: any, body: unknown, by: string, onBehalf: boolean) {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) throw fail(400, parsed.error.issues[0]?.message || 'Check the request.');
  const b: typeof parsed.data & { hasDocument?: boolean } = parsed.data;
  return peopleWrite(orgId, async () => {
    await peoplePrisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave:${r.employeeId}`}))`;
    const current = await peoplePrisma.leaveRequest.findFirst({ where: { id: r.id, accountId, orgId } });
    if (!current || current.status !== 'PENDING') throw fail(409, 'Only a waiting request can be changed.');
    const employee = await employeeIn(orgId, accountId, current.employeeId);
    const group = current.groupId ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: current.groupId, status: 'PENDING' } }) : [current];
    b.hasDocument = Boolean(current.attachmentDocId);
    const file = b.attachment?.data ? decodeDocument(b.attachment.data, b.attachment.mime) : null;
    if (file && 'error' in file) throw fail(400, file.error, 'DOCUMENT');
    const period = await leavePeriodOf(orgId);
    /* Its own waiting days come back to the balance they were charged to: the same type, the same period. A change of type gives nothing back to the new one. */
    const ownDaysFor = (part: { year: number }) => round(group.filter((x) => x.leaveTypeId === b.leaveTypeId && periodOf(period, x.fromDate) === part.year).reduce((a, x) => a + x.days, 0));
    const plan = await planLeave(accountId, orgId, employee, b, onBehalf, group.map((x) => x.id));
    if ('error' in plan) throw fail(400, String(plan.error));
    const blocking = plan.problems.filter((p) => p.code !== 'NO_BALANCE' && p.code !== 'REASON' || (p.code === 'REASON' && !plan.type.isPrivate));
    const closedNow = plan.problems.find((p) => p.code === 'ATTENDANCE_MONTH_CLOSED');
    if (closedNow) throw new MonthClosedError(closedNow.month!, closedNow.message, closedNow.months);
    if (blocking.length) throw fail(blocking[0].code === 'OVERLAP' ? 409 : 400, blocking[0].message, blocking[0].code);
    /* The balance check counted this request's own waiting days; they come back before the new ones are charged. */
    /* Leave that ran over the balance into loss of pay is paid and unpaid rows together; changing them would leave the split wrong. */
    if (group.some((x) => x.overflowOfId)) throw fail(409, 'This leave runs over the balance into loss of pay. Withdraw it and ask again with the new dates.', 'LOSS_OF_PAY_EDIT');
    for (const part of plan.parts) {
      const ownDays = ownDaysFor(part);
      const asked = round(part.days + (part.overflow?.days || 0));
      if (part.balance.before != null && part.balance.before - asked + ownDays < -plan.type.negativeDays) {
        if (part.overflow) throw fail(409, 'The new dates run over the balance into loss of pay. Withdraw this request and ask again.', 'LOSS_OF_PAY_EDIT');
        throw fail(400, `Only ${round((part.balance.before ?? 0) + ownDays)} days of ${plan.type.name} are left; this is ${part.days}.`, 'NO_BALANCE');
      }
    }
    if (plan.split && !b.split) throw fail(400, `Leave stays inside one leave period. Split it at ${plan.parts[0].to}.`, 'CROSSES_PERIOD');
    /* Its own days came back, so what the plan put over the balance fits: all of it is this type's. */
    const parts = plan.parts.flatMap((x) => [...x.rows, ...(x.overflow?.rows || [])]);
    const hours = { fromTime: plan.hours?.fromTime ?? null, toTime: plan.hours?.toTime ?? null };
    /*
     * Only the reason changed: the same type, days and half. Nothing the
     * approver decides on moved, so the manager's step stands and nobody is
     * asked again (closure audit O-07); the history says the reason changed.
     */
    const spanFrom = group.reduce((a, x) => (x.fromDate < a ? x.fromDate : a), current.fromDate);
    const spanTo = group.reduce((a, x) => (x.toDate > a ? x.toDate : a), current.toDate);
    const halvesOf = (rows: Array<{ fromDate?: string; from?: string; halfDay: string | null }>) => rows.map((x) => `${x.fromDate ?? x.from}:${x.halfDay ?? ''}`).sort().join(',');
    const sameHours = (current.fromTime ?? null) === hours.fromTime && (current.toTime ?? null) === hours.toTime;
    if (plan.type.id === current.leaveTypeId && b.fromDate === spanFrom && b.toDate === spanTo && halvesOf(group) === halvesOf(parts) && sameHours) {
      if (plan.reason !== current.reason) {
        for (const x of group) await peoplePrisma.leaveRequest.update({ where: { id: x.id }, data: { reason: plan.reason, history: withHistory(x, { by, what: 'REASON_EDITED', note: null }) } });
      }
      return (await withTypes(orgId, [await peoplePrisma.leaveRequest.findUniqueOrThrow({ where: { id: current.id } })]))[0];
    }
    const groupId = parts.length > 1 ? current.groupId || `lg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : null;
    /* Found before the parts are rewritten: on the approval engine, its request is asked again below. */
    const engine = await engineRequestOf(orgId, current);
    if (file) {
      const docId = await keepLeaveDocument(accountId, orgId, current.employeeId, plan.type, { fromDate: b.fromDate, toDate: b.toDate }, file, b.attachment?.name, by);
      await peoplePrisma.leaveRequest.updateMany({ where: { id: { in: group.map((x) => x.id) } }, data: { attachmentDocId: docId } });
      current.attachmentDocId = docId;
    }
    const change = { from: `${current.fromDate} to ${current.toDate}`, to: `${b.fromDate} to ${b.toDate}` };
    const entry = { by, what: 'EDITED', note: null, ...change };
    const first = await peoplePrisma.leaveRequest.update({
      where: { id: current.id },
      data: { leaveTypeId: plan.type.id, fromDate: parts[0].from, toDate: parts[0].to, days: parts[0].days, halfDay: parts[0].halfDay, ...hours, minutes: parts[0].minutes ?? null, reason: plan.reason, groupId, managerApprovedAt: null, managerApprovedById: null, managerNote: null, history: withHistory(current, entry) },
    });
    await peoplePrisma.leaveRequest.deleteMany({ where: { orgId, id: { in: group.map((x) => x.id).filter((id) => id !== current.id) } } });
    for (const part of parts.slice(1)) {
      await peoplePrisma.leaveRequest.create({ data: { accountId, orgId, employeeId: current.employeeId, leaveTypeId: plan.type.id, fromDate: part.from, toDate: part.to, days: part.days, halfDay: part.halfDay, ...hours, minutes: part.minutes ?? null, reason: plan.reason, groupId, requestedByUserId: current.requestedByUserId, createdAt: current.createdAt, attachmentDocId: current.attachmentDocId, history: withHistory(current, entry) } });
    }
    /* A changed request starts the approval again: under the rule, from its first step. */
    const edited = groupId ? await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId }, orderBy: { fromDate: 'asc' } }) : [first];
    const ruled = onEngineNow(engine) ? edited : await startRule(accountId, orgId, edited);
    await restartLeaveOnEngine(accountId, orgId, engine, ruled, by);
    const now = await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: ruled.map((x: any) => x.id) } } });
    return announce(orgId, now.find((x: any) => x.id === first.id) || first);
  });
}

/**
 * Came back early: an approved leave that has started ends on an earlier
 * day; the days after it go back to the balance and off the attendance
 * record. The person can do it themselves (they are at work, the punches
 * show it); HR as well. Whoever approved the leave is told.
 */
/**
 * `opts.self`: the person shortening their own leave. They may end it today
 * or later, never on a day already gone: days already taken off are taken,
 * and handing them back to the balance with nobody approving it would be a
 * refund of leave used. HR correcting the record may end it on any day.
 */
export async function shortenLeave(accountId: string, orgId: string, r: any, toDate: string, by: string, opts: { self?: boolean } = {}) {
  if (!ISO_DATE.test(toDate)) throw fail(400, 'Dates are YYYY-MM-DD.');
  return peopleWrite(orgId, async () => {
    const current = await peoplePrisma.leaveRequest.findFirst({ where: { id: r.id, accountId, orgId } });
    if (!current || current.status !== 'APPROVED') throw fail(409, 'Only approved leave can be shortened.');
    if (current.halfDay || current.minutes) throw fail(400, `${current.minutes ? 'Hourly leave' : 'A half day'} cannot be shortened; cancel it instead.`);
    const earliest = opts.self && today() > current.fromDate ? today() : current.fromDate;
    if (earliest >= current.toDate) throw fail(400, 'This leave ends today or has ended; there is nothing left to shorten. Ask HR to correct it.');
    if (toDate < earliest || toDate >= current.toDate) throw fail(400, `Choose a day from ${dayWords(earliest)} to ${dayWords(addDays(current.toDate, -1))}.`);
    const employee = await employeeIn(orgId, accountId, current.employeeId);
    const type = await peoplePrisma.leaveType.findFirst({ where: { id: current.leaveTypeId, orgId } });
    const plan = await dayPlan(orgId, employee, current.fromDate, toDate, type ?? false);
    const days = plan.filter((d) => d.counted).length;
    if (!days) throw fail(400, 'That leaves no working day; cancel the leave instead.');
    const gone = await peoplePrisma.attendanceRecord.findMany({ where: { orgId, leaveRequestId: current.id, date: { gt: toDate } } });
    for (const d of gone) await assertMonthOpen(orgId, d.date, d.employeeId);
    await peoplePrisma.attendanceRecord.deleteMany({ where: { orgId, leaveRequestId: current.id, date: { gt: toDate }, status: 'ON_LEAVE', checkIn: null } });
    for (const d of gone) await logDayChange({ accountId, orgId, employeeId: d.employeeId, date: d.date, recordId: d.id, action: 'LEAVE_CANCELLED', before: d, after: null, userId: by, reason: 'Came back early' });
    const updated = await peoplePrisma.leaveRequest.update({ where: { id: current.id }, data: { toDate, days, history: withHistory(current, { by, what: 'SHORTENED', from: current.toDate, to: toDate }) } });
    /* Later parts of a split leave are cancelled outright: the person is back. */
    if (current.groupId) {
      const later = await peoplePrisma.leaveRequest.findMany({ where: { orgId, groupId: current.groupId, status: { in: OPEN }, fromDate: { gt: toDate } } });
      for (const x of later) {
        await peoplePrisma.leaveRequest.update({ where: { id: x.id }, data: { status: 'CANCELLED', reviewedByUserId: by, reviewedAt: new Date(), history: withHistory(x, { by, what: 'CANCELLED', note: 'Came back early' }) } });
        if (x.status === 'APPROVED') await clearLeaveDays(orgId, x.id);
      }
    }
    const shaped = (await withTypes(orgId, [updated]))[0];
    await queueNotice({ accountId, orgId }, 'leave-shortened', { request: leaveSnapshot(shaped), by }, { employeeId: shaped.employeeId, correlationId: `leave_request_${shaped.id}` });
    return shaped;
  });
}

/** Delivered from the outbox (services/attendance/notices.ts). */
export async function tellShortened(orgId: string, r: any, by: string) {
  const emp = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { accountId: true, name: true, code: true, userId: true } });
  if (!emp) return;
  const app = (await isFeatureEnabled(emp.accountId, orgId, 'people')) ? 'people' : 'attendance';
  const byPerson = by === emp.userId || by === `portal:${r.employeeId}`;
  const dedupeKey = `leave-shortened:${r.id}:${r.toDate}`;
  if (byPerson) {
    /* Shortening leaves reviewedByUserId as it was: the approver. */
    const to = await approverUsers(orgId, r.reviewedByUserId, () => approversOf(emp.accountId, orgId, r.employeeId));
    await sendNotice(emp.accountId, orgId, to, { kind: 'attendance.leave_decided', title: `${emp.name}${emp.code ? ` (${emp.code})` : ''} came back early: ${r.isPrivate ? 'leave' : r.leaveTypeName} now ends ${dayWords(r.toDate)}`, link: { app, screen: 'leaveRequests', params: { id: r.id } } }, { except: emp.userId, dedupeKey });
  } else if (emp.userId) {
    await sendNotice(emp.accountId, orgId, [emp.userId], { kind: 'attendance.leave_decided', title: `Your ${r.leaveTypeName} now ends ${dayWords(r.toDate)}`, link: { app, screen: 'myLeave' } }, { except: by, dedupeKey });
  }
}

leaveRouter.put(`${base}/requests/:id`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r || !inScope(await leaveScope(req), r.employeeId)) return res.status(404).json({ error: 'No such request.' });
  try {
    const ownFile = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { userId: true } });
    const request = await editLeave(accountId, orgId, r, req.body, req.auth!.userId, ownFile?.userId !== req.auth!.userId);
    await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'UPDATE', message: `Changed ${request.employeeName}'s leave from ${r.fromDate} to ${r.toDate} into ${request.fromDate} to ${request.toDate}`, metadata: { employeeId: r.employeeId } });
    res.json({ request: masked([request], await readsPrivateLeave(req))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post(`${base}/requests/:id/shorten`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId } });
  if (!r || !inScope(await leaveScope(req), r.employeeId)) return res.status(404).json({ error: 'No such request.' });
  try {
    /* HR may end someone's leave on a past day (correcting the record); their own leave is held to today, as in the person's own screens. */
    const ownFile = await peoplePrisma.employee.findFirst({ where: { id: r.employeeId, orgId }, select: { userId: true } });
    const request = await shortenLeave(accountId, orgId, r, String(req.body?.toDate || ''), req.auth!.userId, { self: ownFile?.userId === req.auth!.userId });
    await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'SHORTEN', message: `${request.employeeName}'s leave now ends ${request.toDate} (was ${r.toDate})`, metadata: { employeeId: r.employeeId } });
    res.json({ request: masked([request], await readsPrivateLeave(req))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * Comp-off granted by HR for a date worked (a holiday, a weekly off), for a
 * company where nobody punches: a credit of the comp-off leave type, with
 * the date it was earned, lapsing as that type's carry-forward says.
 */
leaveRouter.post(`${base}/comp-off`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({ employeeId: z.string().min(1, 'Choose the person.'), workedOn: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'), days: z.coerce.number().refine((n) => n === 0.5 || n === 1, 'Half a day or one day.'), reason: z.string().trim().min(3, 'Say what was worked.').max(300) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the comp-off.' });
  const b = parsed.data;
  try {
    const employee = await employeeIn(orgId, accountId, b.employeeId);
    await scopedOr404(req, employee.id);
    if (await ownBalanceRefused(req, res, employee, 'comp-off grant')) return;
    const settings = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { compOffLeaveTypeId: true } });
    const type = settings?.compOffLeaveTypeId ? await peoplePrisma.leaveType.findFirst({ where: { id: settings.compOffLeaveTypeId, orgId } }) : null;
    if (!type) return res.status(409).json({ error: 'Choose the comp-off leave type first, under Settings → Working week.', code: 'COMP_OFF_TYPE' });
    if (b.workedOn > today()) return res.status(400).json({ error: 'Comp-off is for a day already worked.' });
    const twice = await peoplePrisma.leaveAdjustment.findFirst({ where: { orgId, employeeId: employee.id, leaveTypeId: type.id, workedOn: b.workedOn, reversedAt: null } });
    if (twice) return res.status(409).json({ error: `Comp-off for ${dayWords(b.workedOn)} is already granted.` });
    const year = await leaveYearOf(orgId, b.workedOn);
    const row = await peoplePrisma.leaveAdjustment.create({ data: { accountId, orgId, employeeId: employee.id, leaveTypeId: type.id, year, days: b.days, kind: 'ADJUST', reason: `Comp-off for ${dayWords(b.workedOn)}: ${b.reason}`, workedOn: b.workedOn, expiresOn: compOffExpiresOn(type.compOffValidDays, b.workedOn, today()), createdByUserId: req.auth!.userId } });
    await recordAudit(req, { entity: 'LeaveAdjustment', entityId: row.id, action: 'CREATE', message: `Comp-off ${b.days} for ${employee.name}, worked ${b.workedOn}: ${b.reason}`, metadata: { employeeId: employee.id, workedOn: b.workedOn, days: b.days } });
    res.status(201).json({ adjustment: (await withTypes(orgId, [row]))[0] });
  } catch (e) {
    return sendError(res, e);
  }
});

// Stand-ins: who decides for a manager while they are away. One StandIn table
// since the stand-in merge (workflow engine phase 2b), shared with People
// approval stand-ins; the retired ApprovalStandIn is read as a fallback.
leaveRouter.get(`${base}/stand-ins`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const scope = await leaveScope(req);
  /* Only stand-ins that hand on leave or attendance: a People-only one is the manager's own, on the People list. */
  const rows = (await listStandIns(orgId, addDays(today(), -30), today(), scope.all ? undefined : { userIds: [], employeeIds: [scope.selfId || '__none__'] }))
    .filter((r) => covers(r.requestTypes, 'TIME') && (scope.all ? Boolean(r.employeeId) : r.employeeId === (scope.selfId || '__none__')));
  res.json({ standIns: rows, today: today() });
});

/* Naming a stand-in hands an approval on, so it takes the right to approve. */
leaveRouter.post(`${base}/stand-ins`, can(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const parsed = z.object({
    managerEmployeeId: z.string().min(1).optional(), standInEmployeeId: z.string().min(1, 'Choose who stands in.'),
    fromDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'), toDate: z.string().regex(ISO_DATE, 'Dates are YYYY-MM-DD.'),
    requestTypes: z.array(z.string()).max(40).optional(), note: z.string().trim().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the stand-in.' });
  const b = parsed.data;
  if (b.toDate < b.fromDate) return res.status(400).json({ error: 'The last day is before the first.' });
  /* What is handed on: leave and attendance unless told otherwise, as a leave delegate always was. */
  const types = b.requestTypes === undefined ? LEAVE_DELEGATE_TYPES : cleanTypes(b.requestTypes);
  if (!types) return res.status(400).json({ error: 'Choose what they decide.' });
  const scope = await leaveScope(req);
  /* HR names a stand-in for any manager; a manager names one for themselves. */
  const me = await peoplePrisma.employee.findFirst({ where: { orgId, userId: req.auth!.userId }, select: { id: true } });
  const managerId = scope.all ? b.managerEmployeeId || me?.id : me?.id;
  if (!managerId) return res.status(400).json({ error: 'Choose the manager.' });
  if (!scope.all && b.managerEmployeeId && b.managerEmployeeId !== me?.id) return res.status(403).json({ error: 'You can name a stand-in for yourself only.' });
  if (b.standInEmployeeId === managerId) return res.status(400).json({ error: 'Someone else stands in.' });
  const [manager, standIn] = await Promise.all([managerId, b.standInEmployeeId].map((id) => peoplePrisma.employee.findFirst({ where: { id, orgId, status: { not: 'LEFT' } }, select: { id: true, name: true, userId: true } })));
  if (!manager || !standIn) return res.status(400).json({ error: 'Choose people who work here.' });
  /* More than leave and attendance is the manager's own to hand on, to someone who signs in and may approve. */
  if (coversPeople(types)) {
    if (manager.id !== me?.id) return res.status(403).json({ error: `Only ${manager.name} can hand on their other approvals, from their own sign-in.` });
    if (!standIn.userId) return res.status(400).json({ error: `${standIn.name} has no CLOR sign-in, so they cannot decide requests. Link one on their record first.` });
    if (!(await deciders(accountId, orgId, types)).has(standIn.userId)) return res.status(400).json({ error: 'They cannot approve requests here, so they cannot decide in your place. Choose someone who can.' });
  }
  const row = await nameStandIn({ accountId, orgId, createdByUserId: req.auth!.userId, userId: manager.userId, employeeId: manager.id, standInUserId: standIn.userId, standInEmployeeId: standIn.id, fromDate: b.fromDate, toDate: b.toDate, requestTypes: types, note: b.note || null });
  /* Audited under the name the People audit list already shows for stand-ins. */
  await recordAudit(req, { entity: 'ApprovalStandIn', entityId: row.id, action: 'CREATE', message: `${standIn.name} stands in for ${manager.name}, ${b.fromDate} to ${b.toDate}`, metadata: { ...b, requestTypes: types } });
  /* Leave already waiting on the engine: its steps take the stand-in in (or out) now. */
  await refreshLeaveSteps(accountId, orgId, { inline: true });
  res.status(201).json({ standIn: { ...row, managerEmployeeId: manager.id, managerName: manager.name, standInName: standIn.name } });
});

leaveRouter.delete(`${base}/stand-ins/:id`, can(PermissionAction.APPROVE, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const row = await findStandIn(orgId, String(req.params.id));
  if (!row || !covers(row.requestTypes, 'TIME')) return res.status(404).json({ error: 'No such stand-in.' });
  const scope = await leaveScope(req);
  if (!scope.all && row.employeeId !== scope.selfId) return res.status(404).json({ error: 'No such stand-in.' });
  /* One that also hands on People requests is the manager's own: HR removes leave and attendance ones only. */
  const mine = (await peoplePrisma.employee.findFirst({ where: { orgId, userId: req.auth!.userId }, select: { id: true } }))?.id;
  if (coversPeople(row.requestTypes) && row.employeeId !== mine) return res.status(403).json({ error: 'This one also hands on their other approvals, so only they can remove it.' });
  await removeStandIn(orgId, row);
  await refreshLeaveSteps(req.tenant!.accountId, orgId, { inline: true });
  await recordAudit(req, { entity: 'ApprovalStandIn', entityId: row.id, action: 'DELETE', message: `Stand-in removed (${row.fromDate} to ${row.toDate})`, metadata: { managerEmployeeId: row.employeeId } });
  res.json({ ok: true });
});

/** Restricted holidays: the optional list for a person, what they picked, the quota (HR's view of anyone; the employee app has its own). */
export async function restrictedHolidaysFor(orgId: string, employee: { id: string; branchId: string | null; areaId?: string | null }, year: number) {
  const [settings, holidays, picks] = await Promise.all([
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { restrictedHolidayQuota: true } }),
    peoplePrisma.holiday.findMany({
      where: { orgId, isOptional: true, date: { gte: `${year}-01-01`, lte: `${year}-12-31` }, AND: [{ OR: [{ branchId: null }, ...(employee.branchId ? [{ branchId: employee.branchId }] : [])] }, { OR: [{ areaId: null }, ...(employee.areaId ? [{ areaId: employee.areaId }] : [])] }] },
      orderBy: { date: 'asc' },
    }),
    peoplePrisma.holidayPick.findMany({ where: { orgId, employeeId: employee.id, year }, select: { holidayId: true } }),
  ]);
  const picked = new Set(picks.map((p) => p.holidayId));
  const quota = settings?.restrictedHolidayQuota ?? 0;
  return { year, quota, picked: picked.size, left: Math.max(0, quota - picked.size), holidays: holidays.map((h) => ({ id: h.id, date: h.date, name: h.name, picked: picked.has(h.id), past: h.date < today() })) };
}

export async function pickRestrictedHoliday(accountId: string, orgId: string, employee: { id: string }, holidayId: string, on: boolean) {
  return peopleWrite(orgId, async () => {
    const h = await peoplePrisma.holiday.findFirst({ where: { id: holidayId, orgId, isOptional: true } });
    if (!h) throw fail(404, 'No such restricted holiday.');
    if (h.date < today()) throw fail(409, 'That day has passed.');
    const year = Number(h.date.slice(0, 4));
    await assertMonthOpen(orgId, h.date);
    if (!on) {
      await peoplePrisma.holidayPick.deleteMany({ where: { orgId, employeeId: employee.id, holidayId } });
      return { ok: true, picked: false };
    }
    const settings = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { restrictedHolidayQuota: true } });
    const quota = settings?.restrictedHolidayQuota ?? 0;
    const have = await peoplePrisma.holidayPick.count({ where: { orgId, employeeId: employee.id, year } });
    if (await peoplePrisma.holidayPick.findFirst({ where: { employeeId: employee.id, holidayId } })) return { ok: true, picked: true };
    if (have >= quota) throw fail(409, quota ? `You have picked your ${quota} restricted ${quota === 1 ? 'holiday' : 'holidays'} for ${year}.` : 'Your company does not give restricted holidays.');
    await peoplePrisma.holidayPick.create({ data: { accountId, orgId, employeeId: employee.id, holidayId, year } });
    return { ok: true, picked: true };
  });
}

/**
 * Who picked which restricted holiday in a year (time depth, gap 22): HR's
 * view across the company (a team-scoped reader, their team), each optional
 * holiday with the people who took it, and each person with how many of the
 * quota they have used, so HR sees who is out on the day and who has not
 * picked yet.
 */
leaveRouter.get(`${base}/holidays/restricted/picks`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = /^\d{4}$/.test(String(req.query.year || '')) ? Number(req.query.year) : Number(today().slice(0, 4));
  const scope = await leaveScope(req);
  const [settings, holidays, picks] = await Promise.all([
    peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { restrictedHolidayQuota: true } }),
    peoplePrisma.holiday.findMany({ where: { orgId, isOptional: true, date: { gte: `${year}-01-01`, lte: `${year}-12-31` } }, orderBy: { date: 'asc' }, select: { id: true, date: true, name: true, branchId: true, areaId: true } }),
    peoplePrisma.holidayPick.findMany({ where: { orgId, year, ...(scope.all ? {} : { employeeId: { in: scope.ids } }) }, select: { employeeId: true, holidayId: true } }),
  ]);
  const people = await peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' }, ...(scope.all ? {} : { id: { in: scope.ids } }) }, select: { id: true, name: true, code: true, department: true }, orderBy: { name: 'asc' } });
  const who = new Map(people.map((p) => [p.id, p]));
  const quota = settings?.restrictedHolidayQuota ?? 0;
  const count = new Map<string, number>();
  for (const p of picks) count.set(p.employeeId, (count.get(p.employeeId) || 0) + 1);
  res.json({
    year,
    quota,
    holidays: holidays.map((h) => ({ id: h.id, date: h.date, name: h.name, people: picks.filter((p) => p.holidayId === h.id && who.has(p.employeeId)).map((p) => ({ employeeId: p.employeeId, name: who.get(p.employeeId)!.name, code: who.get(p.employeeId)!.code })) })),
    people: people.map((p) => ({ employeeId: p.id, name: p.name, code: p.code, department: p.department, picked: count.get(p.id) || 0, left: Math.max(0, quota - (count.get(p.id) || 0)) })),
  });
});

leaveRouter.get(`${base}/holidays/restricted`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const employee = await employeeIn(orgId, accountId, String(req.query.employeeId || ''));
    await scopedOr404(req, employee.id);
    res.json(await restrictedHolidaysFor(orgId, employee, Number(req.query.year) || Number(today().slice(0, 4))));
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.get('/orgs/:orgId/attendance/me/holidays/restricted', can(PermissionAction.VIEW, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    res.json(await restrictedHolidaysFor(orgId, me, Number(req.query.year) || Number(today().slice(0, 4))));
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post('/orgs/:orgId/attendance/me/holidays/restricted/:holidayId', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const out = await pickRestrictedHoliday(accountId, orgId, me, String(req.params.holidayId), req.body?.picked !== false);
    await recordAudit(req, { entity: 'HolidayPick', entityId: String(req.params.holidayId), action: out.picked ? 'CREATE' : 'DELETE', message: `${me.name} ${out.picked ? 'picked' : 'dropped'} a restricted holiday`, metadata: { employeeId: me.id } });
    res.json(out);
  } catch (e) {
    return sendError(res, e);
  }
});

/**
 * Year end (TIME-LEAVE-DECISIONS.md, advanced build). The engine already
 * carries forward and lapses by itself; what a run adds is the pay-out of
 * days that would lapse, for the types that allow it, as adjustments Payroll
 * lists for the next run. Previewed per person first; undone until Payroll
 * takes any of it.
 */
export async function yearEndPreview(accountId: string, orgId: string, year: number, onlyEmployeeIds?: string[]) {
  const period = await leavePeriodOf(orgId);
  const bounds = periodBounds(period, year);
  const people = await peoplePrisma.employee.findMany({ where: { accountId, orgId, ...(onlyEmployeeIds ? { id: { in: onlyEmployeeIds } } : {}), OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: bounds.from } }] }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
  const ids = people.map((p) => p.id);
  const [{ types, balances }, encashed] = await Promise.all([
    balancesFor(accountId, orgId, ids, year, bounds.to),
    peoplePrisma.leaveAdjustment.findMany({ where: { orgId, year, kind: 'ENCASH', reversedAt: null, employeeId: { in: ids } }, select: { employeeId: true, leaveTypeId: true, days: true } }),
  ]);
  const rows: Array<{ employeeId: string; name: string; code: string | null; leaveTypeId: string; leaveType: string; closing: number; carry: number; lapse: number; payOut: number }> = [];
  for (const p of people) for (const t of types.filter((x) => x.isPaid)) {
    const b = balances.get(p.id)?.get(t.id);
    if (!b || b.allocated == null) continue;
    /* Leave still waiting is spoken for, as on the register: paying it out too would pay the same days twice once it is approved. */
    const closing = round((b.allocated ?? 0) - b.used - b.pending);
    if (closing <= 0) continue;
    /* Under the OSH rule the limit is the cap plus the days refused this period, and everything over it is paid out (s.32, G3). */
    const carry = Math.min(b.carryLimit ?? carryLimitOf(t), closing);
    const lapse = round(closing - carry);
    const already = -encashed.filter((e) => e.employeeId === p.id && e.leaveTypeId === t.id).reduce((a, e) => a + e.days, 0);
    const room = t.oshCarry ? lapse : t.encashable ? (t.maxEncashDays == null ? lapse : Math.max(0, t.maxEncashDays - already)) : 0;
    const payOut = round(Math.min(lapse, room));
    rows.push({ employeeId: p.id, name: p.name, code: p.code, leaveTypeId: t.id, leaveType: t.name, closing, carry, lapse, payOut });
  }
  return { period: bounds, ended: today() > bounds.to, rows, totals: { carry: round(rows.reduce((a, r) => a + r.carry, 0)), lapse: round(rows.reduce((a, r) => a + r.lapse, 0)), payOut: round(rows.reduce((a, r) => a + r.payOut, 0)) } };
}

leaveRouter.get(`${base}/year-end`, can(PermissionAction.VIEW, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = Number(req.query.year) || (await leaveYearOf(orgId)) - 1;
  const [preview, runs] = await Promise.all([yearEndPreview(accountId, orgId, year), peoplePrisma.leaveYearEnd.findMany({ where: { orgId, year }, orderBy: { ranAt: 'desc' } })]);
  const names = await actorNames(orgId, runs.flatMap((r) => [r.ranByUserId, r.undoneByUserId]));
  res.json({ year, ...preview, runs: runs.map((r) => ({ id: r.id, ranAt: r.ranAt, ranBy: names.get(r.ranByUserId) || null, undoneAt: r.undoneAt, summary: JSON.parse(r.summaryJson) })) });
});

leaveRouter.post(`${base}/year-end`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const year = Number(req.body?.year);
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Which leave period?' });
  try {
    const out = await peopleWrite(orgId, async () => {
      const preview = await yearEndPreview(accountId, orgId, year);
      if (!preview.ended) throw fail(409, `${preview.period.label} has not ended yet.`);
      if (await peoplePrisma.leaveYearEnd.findFirst({ where: { orgId, year, undoneAt: null } })) throw fail(409, `The year end for ${preview.period.label} has already been run. Undo it first to run it again.`);
      const run = await peoplePrisma.leaveYearEnd.create({ data: { accountId, orgId, year, summaryJson: JSON.stringify({ totals: preview.totals, people: preview.rows.length, paidOut: preview.rows.filter((r) => r.payOut > 0).length }), ranByUserId: req.auth!.userId } });
      let paid = 0;
      for (const r of preview.rows.filter((x) => x.payOut > 0)) {
        await peoplePrisma.leaveAdjustment.create({ data: { accountId, orgId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year, days: -r.payOut, kind: 'ENCASH', reason: `Year end ${preview.period.label}: paid out instead of lapsing`, yearEndId: run.id, createdByUserId: req.auth!.userId } });
        paid += 1;
      }
      return { run, paid, totals: preview.totals };
    });
    await recordAudit(req, { entity: 'LeaveYearEnd', entityId: out.run.id, action: 'CREATE', message: `Leave year end ${year}: ${out.paid} pay-outs, ${out.totals.payOut} days; ${out.totals.carry} carried, ${out.totals.lapse - out.totals.payOut} lapsed`, metadata: out.totals });
    res.status(201).json({ run: out.run, paidOut: out.paid, totals: out.totals });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post(`${base}/year-end/:id/undo`, can(PermissionAction.EDIT, R.leave), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  if (!(await wholeCompany(req, res))) return;
  const { orgId } = req.tenant!;
  try {
    const reversed = await peopleWrite(orgId, async () => {
      const run = await peoplePrisma.leaveYearEnd.findFirst({ where: { id: String(req.params.id), orgId } });
      if (!run || run.undoneAt) throw fail(404, 'No such run.');
      const made = await peoplePrisma.leaveAdjustment.findMany({ where: { orgId, yearEndId: run.id, reversedAt: null }, select: { id: true, paidInRunId: true, employeeId: true, leaveTypeId: true, days: true, year: true, kind: true } });
      if (made.some((a) => a.paidInRunId)) throw fail(409, 'Payroll has already paid some of these days out; the run cannot be undone.');
      /* Listed for the next run but not paid yet: the same guard as deleting one encashment by hand. */
      const listed = await payrollPrisma.payrollAdjustment.count({ where: { orgId, id: { in: made.map((a) => `leave-encash:${a.id}`) }, status: { not: 'CANCELLED' } } });
      if (listed) throw fail(409, `Payroll has already listed ${listed === 1 ? 'one of these pay-outs' : `${listed} of these pay-outs`} for its next run. Cancel ${listed === 1 ? 'that earning' : 'those earnings'} there first.`);
      /* Reversed, not deleted: the pay-outs stay on record with when and by whom they were taken back. Every reader skips them. */
      const now = new Date();
      await peoplePrisma.leaveAdjustment.updateMany({ where: { orgId, yearEndId: run.id, reversedAt: null }, data: { reversedAt: now, reversedByUserId: req.auth!.userId } });
      await peoplePrisma.leaveYearEnd.update({ where: { id: run.id }, data: { undoneAt: now, undoneByUserId: req.auth!.userId } });
      return made;
    });
    const rows = reversed.map((a) => ({ id: a.id, employeeId: a.employeeId, leaveTypeId: a.leaveTypeId, kind: a.kind, days: a.days, year: a.year }));
    await recordAudit(req, {
      entity: 'LeaveYearEnd',
      entityId: String(req.params.id),
      action: 'DELETE',
      message: `Leave year end undone: ${rows.length} ${rows.length === 1 ? 'pay-out' : 'pay-outs'} reversed`,
      metadata: { reversed: rows, before: { undone: false, payOuts: rows.length }, after: { undone: true, payOuts: 0 } },
    });
    res.json({ ok: true });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.put('/orgs/:orgId/attendance/me/leave/:id', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId, employeeId: me.id } });
    if (!r) return res.status(404).json({ error: 'No such request.' });
    const request = await editLeave(accountId, orgId, r, req.body, req.auth!.userId, false);
    await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'UPDATE', message: `${me.name} changed their leave request to ${request.fromDate} to ${request.toDate}`, metadata: { employeeId: me.id } });
    res.json({ request });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post('/orgs/:orgId/attendance/me/leave/:id/shorten', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id: String(req.params.id), accountId, orgId, employeeId: me.id } });
    if (!r) return res.status(404).json({ error: 'No such request.' });
    const request = await shortenLeave(accountId, orgId, r, String(req.body?.toDate || ''), req.auth!.userId, { self: true });
    await recordAudit(req, { entity: 'LeaveRequest', entityId: r.id, action: 'SHORTEN', message: `${me.name} came back early: leave now ends ${request.toDate}`, metadata: { employeeId: me.id } });
    res.json({ request });
  } catch (e) {
    return sendError(res, e);
  }
});

// ---------------------------------------------------------------------------
// My leave
// ---------------------------------------------------------------------------

/**
 * Whether a person may ask for a type at all: its gender rule and the
 * employee types it is for. The person's own leave screens list only these,
 * plus any type they already have requests under (closure audit, 27 Oct 2026:
 * a woman saw "Paternity leave: 15 left" in the employee app).
 */
export function eligibleFor(type: { name?: string; gender?: string | null; employeeTypeIds?: unknown; departmentIds?: unknown; branchIds?: unknown; gradeIds?: unknown }, person: { gender?: string | null; employeeTypeId?: string | null; departmentId?: string | null; branchId?: string | null; gradeId?: string | null }) {
  if (type.gender && person.gender && type.gender !== person.gender) return false;
  const only = Array.isArray(type.employeeTypeIds) ? (type.employeeTypeIds as string[]) : [];
  if (only.length && !(person.employeeTypeId && only.includes(person.employeeTypeId))) return false;
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
  return !placeProblem({ name: type.name || '', departmentIds: list(type.departmentIds), branchIds: list(type.branchIds), gradeIds: list(type.gradeIds) }, person);
}

leaveRouter.get('/orgs/:orgId/attendance/me/leave', can(PermissionAction.VIEW, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const year = await yearParam(orgId, req.query.year);
    const { types, balances } = await balancesFor(accountId, orgId, [me.id], year);
    const mine = balances.get(me.id)!;
    /* Comp-off days that expire, soonest first, for the balance's "expires on" (compOff.ts). */
    const grants = (await compOffGrants(orgId, [me.id])).get(me.id);
    const requests = await peoplePrisma.leaveRequest.findMany({
      where: { accountId, orgId, employeeId: me.id, fromDate: { gte: periodStart(await leavePeriodOf(orgId), year), lte: periodEnd(await leavePeriodOf(orgId), year) } },
      orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({
      employee: { id: me.id, name: me.name },
      year,
      today: today(),
      types: types.filter((t) => t.isActive && (eligibleFor(t as any, me as any) || requests.some((r) => r.leaveTypeId === t.id))).map((t) => { const b = mine.get(t.id)!; return { id: t.id, name: t.name, code: t.code, isPaid: t.isPaid, isPrivate: t.isPrivate, allowHalfDay: t.allowHalfDay, unit: t.unit, hoursPerDay: t.hoursPerDay ?? null, ...b, projectedAvailable: t.isPaid && b.fullYear != null ? round(b.fullYear - b.used - b.pending) : null, expiring: expiringOf(grants?.get(t.id), b.available, today()) }; }),
      requests: await withTypes(orgId, requests),
    });
  } catch (e) {
    return sendError(res, e);
  }
});

leaveRouter.post('/orgs/:orgId/attendance/me/leave', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  try {
    const me = await myEmployee(req.tenant!.accountId, req.tenant!.orgId, req.auth!.userId);
    await createLeave(req, res, me);
    if (res.statusCode === 201) await recordAudit(req, { entity: 'LeaveRequest', entityId: me.id, action: 'CREATE', message: `${me.name} asked for leave, ${req.body?.fromDate} to ${req.body?.toDate || req.body?.fromDate}`, metadata: { employeeId: me.id, leaveTypeId: req.body?.leaveTypeId } });
    return;
  } catch (e) {
    return sendError(res, e);
  }
});

/** One's own request: a pending one any time, an approved one only before it starts. */
export async function cancelOwnLeave(accountId: string, orgId: string, employeeId: string, id: string): Promise<{ status: number; body: any }> {
  return peopleWrite(orgId, async () => {
    const r = await peoplePrisma.leaveRequest.findFirst({ where: { id, accountId, orgId, employeeId } });
    if (!r) return { status: 404, body: { error: 'No such request.' } };
    if (!OPEN.includes(r.status)) return { status: 409, body: { error: `This request was already ${r.status.toLowerCase()}.` } };
    const started = r.groupId
      ? await peoplePrisma.leaveRequest.findFirst({ where: { orgId, groupId: r.groupId, status: 'APPROVED', fromDate: { lte: today() } }, select: { id: true } })
      : r.status === 'APPROVED' && r.fromDate <= today();
    if (started) return { status: 409, body: { error: 'This leave has started. Ask your manager to cancel it.' } };
    return { status: 200, body: { request: await cancelLeaveRequest(accountId, orgId, r.id, `portal:${employeeId}`) } };
  });
}

leaveRouter.post('/orgs/:orgId/attendance/me/leave/:id/cancel', can(PermissionAction.CREATE, R.self), async (req, res) => {
  if (!(await hrOrAttendanceRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const me = await myEmployee(accountId, orgId, req.auth!.userId);
    const out = await cancelOwnLeave(accountId, orgId, me.id, String(req.params.id));
    if (out.status === 200) await recordAudit(req, { entity: 'LeaveRequest', entityId: String(req.params.id), action: 'CANCEL', message: `${me.name} cancelled their own leave`, metadata: { employeeId: me.id } });
    res.status(out.status).json(out.body);
  } catch (e) {
    return sendError(res, e);
  }
});
