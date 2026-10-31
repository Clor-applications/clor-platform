import { Prisma } from '../../generated/payroll/index.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { daysBetween, daysOfMonth, periodContext, periodRows } from '../attendance/days.js';
import { isWeeklyOff } from '../attendance/compute.js';
import { isFeatureEnabled } from '../features.js';

/**
 * Provisional days (closure audit O-11, TLA-004; feature
 * `payrollProvisionalDays`, off by default).
 *
 * A company that pays on the 25th does not know the 26th to the 30th when it
 * runs payroll. With the feature on, the days after the cut-off are paid as
 * present for everyone not on approved leave for them; approved unpaid leave
 * on those dates is still loss of pay. The run stores, per person, what it
 * assumed for each of those days. The next month's pull compares each with
 * what happened and adds a correction to that run: a deduction for a day that
 * turned out absent, a payment for unpaid leave that was withdrawn and worked.
 *
 * The correction is a payroll adjustment (PayrollAdjustment), not extra days
 * on next month's inputs: it is priced at the day rate of the month the day
 * belongs to (next month's salary may differ), it can pay as well as deduct
 * (next month's payable days cannot go past its working days), and it reaches
 * the payslip as its own line with its own words.
 */

export const FEATURE = 'payrollProvisionalDays';
export const DEFAULT_CUTOFF_DAY = 25;
/** The id prefix (and reference) of a correction adjustment: `provisional:<runId>:<employeeId>`. */
export const CORRECTION_PREFIX = 'provisional:';

const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 1st, 2nd, 3rd, 4th … 21st, 22nd, 23rd, 25th. */
export const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th';
  return `${n}${suffix}`;
};

/** "26–30 Sep", or "30 Sep" for one day, or "29 Sep–1 Oct" across a month. */
export function dateRange(from: string, to: string) {
  const d = (x: string) => Number(x.slice(8, 10));
  const m = (x: string) => MONTHS[Number(x.slice(5, 7)) - 1];
  if (from === to) return `${d(from)} ${m(from)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${d(from)}–${d(to)} ${m(to)}`;
  return `${d(from)} ${m(from)}–${d(to)} ${m(to)}`;
}

const dayWord = (n: number, word = 'day') => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The run screen's sentence: "Days after the 25th counted as present: 3 people, 12 days; corrected next month." */
export function provisionalMessage(p: { cutoffDate: string; people: number; days: number }) {
  return `Days after the ${ordinal(Number(p.cutoffDate.slice(8, 10)))} counted as present: ${p.people} ${p.people === 1 ? 'person' : 'people'}, ${dayWord(p.days)}; corrected next month.`;
}

/** Whether the company counts days after a cut-off as present, and the cut-off day. */
export async function provisionalSetting(accountId: string, orgId: string) {
  const [enabled, row] = await Promise.all([
    isFeatureEnabled(accountId, orgId, FEATURE),
    payrollPrisma.payrollSetting.findUnique({ where: { orgId }, select: { provisionalCutoffDay: true } }),
  ]);
  return { enabled, cutoffDay: row?.provisionalCutoffDay ?? DEFAULT_CUTOFF_DAY };
}

/**
 * The cut-off date for a pay period: the cut-off day of the month the period
 * ends in, when it falls inside the period and before its last day. Null when
 * there is nothing after it to assume.
 */
export function cutoffDateFor(period: { startDate: string; endDate: string }, cutoffDay: number) {
  const month = period.endDate.slice(0, 7);
  const cutoff = `${month}-${String(cutoffDay).padStart(2, '0')}`;
  if (cutoff < period.startDate || cutoff >= period.endDate) return null;
  return cutoff;
}

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** What was assumed for one day after the cut-off. `paid` is the fraction of the day paid; `provisional` the part assumed worked. */
export type AssumedDay = { date: string; paid: number; provisional: number };

type Ctx = Awaited<ReturnType<typeof periodContext>>;

/** Approved leave requests behind the day records in a context, with their type's paid flag. */
async function approvedLeave(orgId: string, ctx: Ctx) {
  const ids = [...new Set(ctx.records.filter((r) => r.leaveRequestId).map((r) => r.leaveRequestId!))];
  if (!ids.length) return new Map<string, { isPaid: boolean }>();
  const reqs = await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: ids }, status: 'APPROVED' }, select: { id: true, leaveTypeId: true } });
  const types = new Map((await peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, isPaid: true } })).map((t) => [t.id, t.isPaid]));
  return new Map(reqs.map((q) => [q.id, { isPaid: types.get(q.leaveTypeId) !== false }]));
}

/**
 * The days after the cut-off, assumed. Per person: a day on approved leave
 * is what the leave says (unpaid is loss of pay, a half day's other half is
 * assumed worked); a holiday or weekly off is paid as always and assumes
 * nothing; any other day is present, provisionally.
 */
async function assumeWindow(accountId: string, orgId: string, from: string, to: string) {
  const ctx = await periodContext(accountId, orgId, from, to);
  const leave = await approvedLeave(orgId, ctx);
  const out = new Map<string, { name: string; code: string | null; department: string | null; lop: number; unpaidLeave: number; provisional: number; overtimeMinutes: number; dates: AssumedDay[] }>();
  for (const p of ctx.people) {
    const span = ctx.spanOf(p);
    if (!span.length) continue;
    const recs = ctx.recordsOf.get(p.id) || new Map();
    const holidays = ctx.holidaysFor(p);
    const row = { name: p.name, code: p.code ?? null, department: p.department ?? null, lop: 0, unpaidLeave: 0, provisional: 0, overtimeMinutes: 0, dates: [] as AssumedDay[] };
    for (const date of span) {
      const r: any = recs.get(date);
      if (r?.overtimeApproved) row.overtimeMinutes += Number(r.overtimeMinutes) || 0;
      const onLeave = r?.leaveRequestId ? leave.get(r.leaveRequestId) : undefined;
      if (onLeave) {
        /* ON_LEAVE is a whole day of leave; anything else on a leave day is a half day (services/attendance/payableDays.ts). */
        const leaveShare = r.status === 'ON_LEAVE' ? 1 : 0.5;
        const unpaid = onLeave.isPaid ? 0 : leaveShare;
        const provisional = 1 - leaveShare;
        row.lop += unpaid;
        row.unpaidLeave += unpaid;
        row.provisional += provisional;
        row.dates.push({ date, paid: 1 - unpaid, provisional });
        continue;
      }
      const restDay = holidays.has(date) || isWeeklyOff(ctx.shiftOn(p.id, date).rule, date);
      if (restDay) continue;
      row.provisional += 1;
      row.dates.push({ date, paid: 1, provisional: 1 });
    }
    out.set(p.id, row);
  }
  return out;
}

/**
 * A pay period's attendance rows with the days after the cut-off assumed:
 * the same shape as periodRows (what the from-attendance pull and the
 * loss-of-pay check read), plus `provisionalDays` and `provisionalDates`.
 * Days up to the cut-off are Attendance's own figures; overtime approved
 * after it is kept.
 */
export async function provisionalPeriodRows(accountId: string, orgId: string, startDate: string, endDate: string, cutoffDate: string) {
  const windowFrom = nextDay(cutoffDate);
  const [before, window] = await Promise.all([
    periodRows(accountId, orgId, daysBetween(startDate, cutoffDate)),
    assumeWindow(accountId, orgId, windowFrom, endDate),
  ]);
  /* Employed days over the whole period, as periodRows counts them. */
  const people = await peoplePrisma.employee.findMany({
    where: { orgId, id: { in: [...new Set([...before.map((r) => r.employeeId), ...window.keys()])] } },
    select: { id: true, dateOfJoining: true, dateOfLeaving: true },
  });
  const all = daysBetween(startDate, endDate);
  const spanOf = new Map(people.map((p) => [p.id, all.filter((d) => (!p.dateOfJoining || d >= p.dateOfJoining) && (!p.dateOfLeaving || d <= p.dateOfLeaving)).length]));
  const byId = new Map<string, any>(before.map((r) => [r.employeeId, r]));
  const rows: any[] = [];
  for (const id of new Set([...byId.keys(), ...window.keys()])) {
    const b = byId.get(id);
    const w = window.get(id);
    const lossOfPayDays = r2((Number(b?.lossOfPayDays) || 0) + (w?.lop || 0));
    rows.push({
      ...(b || { employeeId: id, name: w!.name, code: w!.code, department: w!.department, absent: 0, halfDays: 0, incompleteDays: 0, latePenaltyDays: 0, present: 0, leave: 0, holidays: 0, weeklyOffs: 0, lateCount: 0 }),
      employeeId: id,
      totalDays: spanOf.get(id) ?? (Number(b?.totalDays) || 0),
      unpaidLeaveDays: r2((Number(b?.unpaidLeaveDays) || 0) + (w?.unpaidLeave || 0)),
      approvedOvertimeMinutes: (Number(b?.approvedOvertimeMinutes) || 0) + (w?.overtimeMinutes || 0),
      /* Days still to come up to the cut-off only; those after it are provisional. */
      notYet: Number(b?.notYet) || 0,
      lossOfPayDays,
      provisionalDays: r2(w?.provisional || 0),
      provisionalDates: w?.dates || [],
    });
  }
  return { rows, windowFrom, windowTo: endDate };
}

/** What happened on a day, as a fraction paid and the words for what was lost. */
type Outcome = { paid: number; absent: number; half: number; unpaidLeave: number; noCheckOut: number };

/**
 * What actually happened on given dates, per person, counted the way
 * monthSummary counts a day: absent (or no record on a past working day) and
 * a day with no check-out lose the whole day, a half day loses half, approved
 * unpaid leave loses its share on top. Never more than the day.
 */
async function outcomes(accountId: string, orgId: string, from: string, to: string) {
  const ctx = await periodContext(accountId, orgId, from, to);
  const leave = await approvedLeave(orgId, ctx);
  const out = new Map<string, Map<string, Outcome>>();
  for (const p of ctx.people) {
    const recs = ctx.recordsOf.get(p.id) || new Map();
    const holidays = ctx.holidaysFor(p);
    const days = new Map<string, Outcome>();
    for (const date of ctx.spanOf(p)) {
      const r: any = recs.get(date);
      const restDay = holidays.has(date) || isWeeklyOff(ctx.shiftOn(p.id, date).rule, date);
      const o: Outcome = { paid: 1, absent: 0, half: 0, unpaidLeave: 0, noCheckOut: 0 };
      const lv = r?.leaveRequestId ? leave.get(r.leaveRequestId) : undefined;
      if (lv && !lv.isPaid) o.unpaidLeave = r.status === 'ON_LEAVE' ? 1 : 0.5;
      if (r?.status === 'PRESENT' && r.checkIn && !r.checkOut && date < ctx.today && !restDay) o.noCheckOut = 1;
      else if (!r) o.absent = restDay || date > ctx.today ? 0 : 1;
      else if (r.status === 'ABSENT') o.absent = 1;
      else if (r.status === 'HALF_DAY') o.half = 0.5;
      o.paid = Math.max(0, 1 - Math.min(1, o.absent + o.half + o.noCheckOut + o.unpaidLeave));
      days.set(date, o);
    }
    out.set(p.id, days);
  }
  return out;
}

/** "2 days absent, 1 half day" — what a correction is for. */
function lostWords(t: { absent: number; half: number; unpaidLeave: number; noCheckOut: number; paidBack: number }) {
  return [
    t.absent ? `${dayWord(t.absent)} absent` : '',
    t.half ? `${dayWord(t.half, 'half day')}` : '',
    t.unpaidLeave ? `${dayWord(t.unpaidLeave)} unpaid leave` : '',
    t.noCheckOut ? `${dayWord(t.noCheckOut)} without check-out` : '',
    t.paidBack ? `${dayWord(t.paidBack)} worked, paid back` : '',
  ].filter(Boolean).join(', ');
}

/**
 * A day's pay on a payslip: the full (unprorated) amount of the earnings that
 * prorate, over the working days the slip was calculated on. That is exactly
 * what one day of loss of pay took off that payslip.
 */
function dayRateOf(slip: { inputSnapshotJson: string; structureSnapshotJson: string; lines: Array<{ type: string; componentCode: string; amount: any; fullAmount: any; displayOrder: number }> }) {
  let input: any = {};
  let structure: any = {};
  try { input = JSON.parse(slip.inputSnapshotJson || '{}'); } catch { /* an empty snapshot prices nothing */ }
  try { structure = JSON.parse(slip.structureSnapshotJson || '{}'); } catch { /* falls back to every structure earning */ }
  const workingDays = Number(input.workingDays) || Number(input.periodDays) || 0;
  if (workingDays <= 0) return 0;
  const comps: any[] = Array.isArray(structure.components) ? structure.components : [];
  const prorates = new Map(comps.map((c) => [String(c.code || '').toUpperCase(), c.prorate !== false]));
  const full = slip.lines
    /* Adjustments and recoveries (900+) are not part of the day's pay. */
    .filter((l) => l.type === 'EARNING' && l.displayOrder < 900 && (prorates.size ? prorates.get(String(l.componentCode).toUpperCase()) !== false : true))
    .reduce((s, l) => s + Number(l.fullAmount ?? l.amount ?? 0), 0);
  return full / workingDays;
}

const CORRECTION_COMPONENTS = {
  EARNING: { code: 'PROVISIONAL_CORR_PAY', name: 'Attendance correction', description: 'Days paid after a cut-off that need paying back: added by the next month’s pull from Attendance.' },
  DEDUCTION: { code: 'PROVISIONAL_CORR_DED', name: 'Attendance correction', description: 'Days paid as present after a cut-off that turned out not worked: added by the next month’s pull from Attendance.' },
} as const;

/** The two components a correction is booked against, created the first time one is needed. */
async function correctionComponent(accountId: string, orgId: string, type: 'EARNING' | 'DEDUCTION', userId: string) {
  const def = CORRECTION_COMPONENTS[type];
  const had = await payrollPrisma.salaryComponent.findFirst({ where: { orgId, code: def.code }, select: { id: true } });
  if (had) return had.id;
  const made = await payrollPrisma.salaryComponent.upsert({
    where: { orgId_code: { orgId, code: def.code } },
    update: {},
    create: {
      accountId, orgId, code: def.code, name: def.name, description: def.description, type,
      calculationMethod: 'VARIABLE', appliesTo: 'STRUCTURE', prorate: false, isVariable: true,
      isTaxable: true, displayOrder: 900, createdByUserId: userId,
    },
    select: { id: true },
  });
  return made.id;
}

export type Correction = { employeeId: string; name: string; fromRunId: string; days: number; type: 'EARNING' | 'DEDUCTION' | null; amount: number; reason: string; status: string };

/** Runs whose figures went out: an assumption in one of these is owed a correction. */
const SETTLED_RUN = ['APPROVED', 'LOCKED', 'PAID', 'POSTED'];

/**
 * Compares the days an earlier run assumed with what happened, for the people
 * in this run, and books the difference as an adjustment in this run's
 * period. Called by the from-attendance pull. Idempotent: pulling again
 * recomputes the same correction (one per earlier run and person), and a
 * correction this pull no longer needs is cancelled. One already paid by a
 * payslip is left alone.
 */
export async function correctProvisionalDays(opts: { accountId: string; orgId: string; run: { id: string; periodId: string }; period: { startDate: string }; employeeIds: string[]; userId: string }): Promise<Correction[]> {
  const { accountId, orgId, run, period, employeeIds, userId } = opts;
  if (!employeeIds.length) return [];
  const candidates = await payrollPrisma.payrollInput.findMany({
    where: { orgId, employeeId: { in: employeeIds }, runId: { not: run.id }, provisionalDates: { not: Prisma.DbNull } },
    select: { id: true, runId: true, employeeId: true, provisionalDates: true, provisionalSettledByRunId: true },
  });
  const assumed = candidates.filter((c) => Array.isArray(c.provisionalDates) && (c.provisionalDates as unknown[]).length);
  if (!assumed.length) return [];
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, id: { in: [...new Set(assumed.map((c) => c.runId))] } }, select: { id: true, status: true, periodId: true } });
  const periods = new Map((await payrollPrisma.payrollPeriod.findMany({ where: { orgId, id: { in: runs.map((r) => r.periodId) } }, select: { id: true, endDate: true } })).map((p) => [p.id, p]));
  /* Earlier periods only, from runs that were approved (the assumption was paid). */
  const eligibleRuns = new Map(runs.filter((r) => SETTLED_RUN.includes(r.status) && (periods.get(r.periodId)?.endDate || '9999') < period.startDate).map((r) => [r.id, r]));
  /* A settlement by a run since cancelled does not count. */
  const settledBy = [...new Set(assumed.map((c) => c.provisionalSettledByRunId).filter(Boolean) as string[])];
  const live = new Set((await payrollPrisma.payrollRun.findMany({ where: { orgId, id: { in: settledBy }, status: { not: 'CANCELLED' } }, select: { id: true } })).map((r) => r.id));
  const open = assumed.filter((c) => eligibleRuns.has(c.runId) && (!c.provisionalSettledByRunId || c.provisionalSettledByRunId === run.id || !live.has(c.provisionalSettledByRunId)));
  if (!open.length) return [];

  const allDates = open.flatMap((c) => (c.provisionalDates as AssumedDay[]).map((d) => d.date)).sort();
  const happened = await outcomes(accountId, orgId, allDates[0], allDates[allDates.length - 1]);
  const slips = await payrollPrisma.salarySlip.findMany({
    where: { orgId, OR: open.map((c) => ({ runId: c.runId, employeeId: c.employeeId })) },
    select: { runId: true, employeeId: true, inputSnapshotJson: true, structureSnapshotJson: true, lines: { select: { type: true, componentCode: true, amount: true, fullAmount: true, displayOrder: true } } },
  });
  const slipOf = new Map(slips.map((s) => [`${s.runId}:${s.employeeId}`, s]));
  const names = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: open.map((c) => c.employeeId) } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));

  const out: Correction[] = [];
  for (const c of open) {
    const dates = (c.provisionalDates as AssumedDay[]).slice().sort((a, b) => a.date.localeCompare(b.date));
    const days = happened.get(c.employeeId);
    const t = { absent: 0, half: 0, unpaidLeave: 0, noCheckOut: 0, paidBack: 0 };
    let delta = 0;
    let unknown = false;
    for (const d of dates) {
      const o = days?.get(d.date);
      if (!o) {
        /* Not employed that day after all, or still to come: nothing to compare yet. */
        unknown = true;
        continue;
      }
      const diff = o.paid - d.paid;
      if (Math.abs(diff) < 1e-9) continue;
      delta += diff;
      if (diff < 0) {
        /* Lost more than was assumed: say what for, never more than was lost. */
        let left = -diff;
        const take = (k: 'absent' | 'noCheckOut' | 'unpaidLeave', v: number) => {
          const n = Math.min(left, v);
          if (n > 0) { t[k] += n; left -= n; }
        };
        take('absent', o.absent);
        take('noCheckOut', o.noCheckOut);
        take('unpaidLeave', Math.max(0, o.unpaidLeave - (1 - d.paid)));
        /* A half day is said as a day ("1 half day"), whatever it cost. */
        if (left > 1e-9 && o.half) {
          t.half += 1;
          left = Math.max(0, left - o.half);
        }
        if (left > 1e-9) t.absent += left;
      } else {
        t.paidBack += diff;
      }
    }
    delta = r2(delta);
    for (const k of Object.keys(t) as Array<keyof typeof t>) t[k] = r2(t[k]);
    const id = `${CORRECTION_PREFIX}${c.runId}:${c.employeeId}`;
    const existing = await payrollPrisma.payrollAdjustment.findUnique({ where: { id } });
    if (existing?.status === 'CONSUMED' && existing.consumedByRunId && existing.consumedByRunId !== run.id) continue;
    const range = dateRange(dates[0].date, dates[dates.length - 1].date);
    const reason = `Correction for ${range}: ${lostWords(t)}`.slice(0, 240);
    const name = names.get(c.employeeId) || '';
    const slip = slipOf.get(`${c.runId}:${c.employeeId}`);
    const amount = slip ? Math.round(Math.abs(delta) * dayRateOf(slip)) : 0;
    if (!delta || !amount) {
      /* Nothing to correct (or nothing to price it on): a correction from an earlier pull of this run goes. */
      if (existing && existing.status !== 'CONSUMED' && existing.status !== 'CANCELLED') await payrollPrisma.payrollAdjustment.update({ where: { id }, data: { status: 'CANCELLED' } });
      if (!unknown) await payrollPrisma.payrollInput.update({ where: { id: c.id }, data: { provisionalSettledByRunId: run.id } });
      out.push({ employeeId: c.employeeId, name, fromRunId: c.runId, days: delta, type: null, amount: 0, reason: delta ? `${reason} (no payslip to price it on; add it by hand)` : '', status: 'NONE' });
      continue;
    }
    const type = delta < 0 ? 'DEDUCTION' : 'EARNING';
    const componentId = await correctionComponent(accountId, orgId, type, userId);
    /* Approved as it is made: it is arithmetic on Attendance's days, like the days themselves, and the run it lands in is approved as a whole. */
    const data = { componentId, periodId: run.periodId, type, amount, reason, reference: `${CORRECTION_PREFIX}${c.runId}`, status: 'APPROVED', approvedAt: new Date(), approvedByUserId: null, consumedByRunId: null };
    if (existing) await payrollPrisma.payrollAdjustment.update({ where: { id }, data });
    else await payrollPrisma.payrollAdjustment.create({ data: { id, accountId, orgId, employeeId: c.employeeId, createdByUserId: userId, ...data } });
    await payrollPrisma.payrollInput.update({ where: { id: c.id }, data: { provisionalSettledByRunId: run.id } });
    out.push({ employeeId: c.employeeId, name, fromRunId: c.runId, days: delta, type, amount, reason, status: 'APPROVED' });
  }
  return out;
}

/** The id prefix of a late-mark penalty caught up after a cut-off: `late-penalty:<month>:<employeeId>`. */
export const LATE_PENALTY_PREFIX = 'late-penalty:';
export const isLatePenalty = (adj: { id?: string | null }) => String(adj.id || '').startsWith(LATE_PENALTY_PREFIX);
/** The reference a catch-up penalty gets when the pull itself cancels it (waived, taken from leave): unlike a person's cancel, a later pull may revive it. */
const LATE_PENALTY_OFF = 'late-penalty-off:';

const MONTH_WORDS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWords = (month: string) => `${MONTH_WORDS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/**
 * Months whose late-mark penalty an earlier run never charged, for the people
 * in this run.
 *
 * People charges a month's late-mark penalty in the run holding the month's
 * last day (attendance/markRules.ts penaltiesOver). A run paid before the
 * month ends reads Attendance only up to its cut-off, so when the month's last
 * day fell after the cut-off, that month's penalty was charged by nobody:
 * this run's days begin after it. Each such month, per person whose days that
 * run took from Attendance, is owed once, here.
 */
export async function lateMarkMonthsOwed(orgId: string, period: { startDate: string }, employeeIds: string[]) {
  if (!employeeIds.length) return [] as Array<{ month: string; runId: string; employeeIds: string[] }>;
  const runs = await payrollPrisma.payrollRun.findMany({
    where: { orgId, status: { in: SETTLED_RUN }, provisionalDays: { not: Prisma.DbNull } },
    select: { id: true, periodId: true, provisionalDays: true },
  });
  if (!runs.length) return [];
  const periods = new Map((await payrollPrisma.payrollPeriod.findMany({ where: { orgId, id: { in: runs.map((r) => r.periodId) } }, select: { id: true, endDate: true } })).map((p) => [p.id, p]));
  const out: Array<{ month: string; runId: string; employeeIds: string[] }> = [];
  for (const r of runs) {
    const end = periods.get(r.periodId)?.endDate;
    if (!end || end >= period.startDate) continue;
    const w = r.provisionalDays as { from?: string; to?: string } | null;
    if (!w?.from || !w.to) continue;
    const months = [...new Set(daysBetween(w.from, w.to).map((d) => d.slice(0, 7)))].filter((m) => {
      const last = daysOfMonth(m).at(-1)!;
      return last >= w.from! && last <= w.to!;
    });
    if (!months.length) continue;
    const inputs = await payrollPrisma.payrollInput.findMany({ where: { orgId, runId: r.id, employeeId: { in: employeeIds }, source: 'ATTENDANCE' }, select: { employeeId: true } });
    if (!inputs.length) continue;
    for (const month of months) out.push({ month, runId: r.id, employeeIds: inputs.map((i) => i.employeeId) });
  }
  return out;
}

export type LatePenaltyCatchUp = { employeeId: string; name: string; month: string; days: number; amount: number; reason: string; status: string };

/**
 * Charge the late-mark penalties an earlier run's cut-off left uncharged
 * (lateMarkMonthsOwed), as a deduction in this run's period priced at that
 * run's day rate, the way a provisional correction is. Once only: keyed by
 * month and person, and left alone once a live run has paid it. Called by the
 * from-attendance pull after it has refused undecided months.
 */
export async function catchUpLatePenalties(opts: { accountId: string; orgId: string; run: { id: string; periodId: string }; period: { startDate: string }; employeeIds: string[]; userId: string }): Promise<LatePenaltyCatchUp[]> {
  const { accountId, orgId, run, period, employeeIds, userId } = opts;
  const owed = await lateMarkMonthsOwed(orgId, period, employeeIds);
  if (!owed.length) return [];
  const { penaltiesOver } = await import('../attendance/markRules.js');
  const names = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: employeeIds } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]));
  const out: LatePenaltyCatchUp[] = [];
  for (const o of owed) {
    const rows = await penaltiesOver(accountId, orgId, daysOfMonth(o.month), { employeeIds: o.employeeIds });
    const slips = await payrollPrisma.salarySlip.findMany({
      where: { orgId, runId: o.runId, employeeId: { in: o.employeeIds } },
      select: { employeeId: true, inputSnapshotJson: true, structureSnapshotJson: true, lines: { select: { type: true, componentCode: true, amount: true, fullAmount: true, displayOrder: true } } },
    });
    const slipOf = new Map(slips.map((x) => [x.employeeId, x]));
    for (const employeeId of o.employeeIds) {
      const id = `${LATE_PENALTY_PREFIX}${o.month}:${employeeId}`;
      const existing = await payrollPrisma.payrollAdjustment.findUnique({ where: { id } });
      /* Paid once: a live run that consumed it keeps it. */
      if (existing?.status === 'CONSUMED' && existing.consumedByRunId && existing.consumedByRunId !== run.id) {
        const consumer = await payrollPrisma.payrollRun.findFirst({ where: { orgId, id: existing.consumedByRunId }, select: { status: true } });
        if (consumer && consumer.status !== 'CANCELLED') continue;
      }
      /* A person decided it in Payroll: cancelled there, or the amount edited (back to draft, approved by somebody). Theirs stands. */
      if (existing && ((existing.status === 'CANCELLED' && !String(existing.reference || '').startsWith(LATE_PENALTY_OFF)) || existing.status === 'DRAFT' || existing.approvedByUserId)) {
        continue;
      }
      const row = rows.get(employeeId);
      const days = Math.round((row?.lossOfPayDays || 0) * 100) / 100;
      const slip = slipOf.get(employeeId);
      const amount = slip && days > 0 ? Math.round(days * dayRateOf(slip)) : 0;
      const name = names.get(employeeId) || '';
      const reason = `Late-mark penalty for ${monthWords(o.month)}: ${dayWord(days)} (paid before the month ended)`.slice(0, 240);
      if (!amount) {
        /* Waived, taken from leave, or nothing to price it on: a charge from an earlier pull goes. */
        /* This run's own charge (CONSUMED by this run included) goes, marked as ours so a later pull may charge it again if the waiver is undone. */
        if (existing && existing.status !== 'CANCELLED') await payrollPrisma.payrollAdjustment.update({ where: { id }, data: { status: 'CANCELLED', consumedByRunId: null, reference: `${LATE_PENALTY_OFF}${o.runId}` } });
        if (days > 0) out.push({ employeeId, name, month: o.month, days, amount: 0, reason: `${reason} (no payslip to price it on; add it by hand)`, status: 'NONE' });
        continue;
      }
      const componentId = await correctionComponent(accountId, orgId, 'DEDUCTION', userId);
      const data = { componentId, periodId: run.periodId, type: 'DEDUCTION', amount, reason, reference: `${LATE_PENALTY_PREFIX}${o.runId}`, status: 'APPROVED', approvedAt: new Date(), approvedByUserId: null, consumedByRunId: null };
      if (existing) await payrollPrisma.payrollAdjustment.update({ where: { id }, data });
      else await payrollPrisma.payrollAdjustment.create({ data: { id, accountId, orgId, employeeId, createdByUserId: userId, ...data } });
      out.push({ employeeId, name, month: o.month, days, amount, reason, status: 'APPROVED' });
    }
  }
  return out;
}

/** The correction adjustment's line on a payslip carries its own words ("Correction for 26–30 Sep: 2 days absent"). */
export const isCorrection = (adj: { id?: string | null; reference?: string | null }) => String(adj.id || '').startsWith(CORRECTION_PREFIX) || String(adj.reference || '').startsWith(CORRECTION_PREFIX);
