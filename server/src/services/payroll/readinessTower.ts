import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { monthReadiness } from '../attendance/readiness.js';
import { daysBetween, periodRows } from '../attendance/days.js';
import { lastOfMonth, leaveLossOfPay, payableMonth } from '../attendance/payableDays.js';
import { dataHealth } from '../people/dataHealth.js';
import { isFeatureEnabled } from '../features.js';

/**
 * Payroll readiness, the HR research's "Workforce Control Tower": one answer
 * to "what is wrong, why, what money is at risk, and who fixes it" for a
 * month, across Attendance (open days, waiting approvals, unmatched punches)
 * and People / Payroll data (Data Health checks that block a pay run).
 *
 * Money is an estimate, said as one: a day's pay is the person's monthly CTC
 * over the days in the month, so a day with no record or no check-out is the
 * pay that would be cut as loss of pay if nobody fixes it. Only for someone
 * allowed to see salaries; everyone else gets the counts.
 */

type Issue = {
  key: string;
  source: 'Attendance' | 'People' | 'Payroll' | 'Leave';
  title: string;
  why: string;
  owner: string;
  count: number;
  /** Rupees at stake, or null when it cannot be priced (or the viewer may not see pay). */
  money: number | null;
  screen: string;
  app: 'attendance' | 'payroll';
  blocks: boolean;
};

/* Who fixes each attendance issue. */
const OWNER: Record<string, string> = {
  missingOut: 'The employee asks for a correction; their manager approves',
  corrections: 'Approvers (managers, then HR)',
  leave: 'Approvers (managers, then HR)',
  unmatched: 'HR: map the reader ID to a person',
  noRecord: 'HR checks with the employee: leave, on duty or absent',
  overtime: 'Managers approve or reject',
  unvalidated: 'HR validates the days',
  readers: 'Whoever looks after the readers',
  trustCheck: 'HR looks at the punches (reader trust)',
};

const rupees = (n: number) => Math.round(n);

export async function payrollReadiness(accountId: string, orgId: string, month: string, opts: { pay: boolean }) {
  const [att, health, payrollOn] = await Promise.all([
    monthReadiness(accountId, orgId, month),
    dataHealth(accountId, orgId, { payroll: opts.pay }),
    isFeatureEnabled(accountId, orgId, 'payroll'),
  ]);
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

  /* A day's pay per person, from the salary in force for the month. */
  const dayPay = new Map<string, number>();
  if (opts.pay && payrollOn && att.people.length) {
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`;
    const assignments = await payrollPrisma.salaryAssignment.findMany({
      where: { orgId, employeeId: { in: att.people.map((p) => p.employeeId) }, status: 'ACTIVE', effectiveFrom: { lte: monthEnd } },
      orderBy: { effectiveFrom: 'desc' },
      select: { employeeId: true, monthlyCtc: true, annualCtc: true },
    });
    for (const a of assignments) {
      if (dayPay.has(a.employeeId)) continue;
      const monthly = Number(a.monthlyCtc) || Number(a.annualCtc) / 12;
      if (monthly > 0) dayPay.set(a.employeeId, monthly / daysInMonth);
    }
  }
  const priced = (employeeId: string, days: number) => (dayPay.has(employeeId) ? dayPay.get(employeeId)! * days : null);
  const sumMoney = (vals: Array<number | null>) => (vals.some((v) => v != null) ? rupees(vals.reduce<number>((s, v) => s + (v || 0), 0)) : null);

  const issues: Issue[] = [];
  for (const c of att.checks) {
    if (!c.count) continue;
    const money =
      c.key === 'missingOut' ? sumMoney(att.people.map((p) => priced(p.employeeId, p.missingOut)))
      : c.key === 'noRecord' ? sumMoney(att.people.map((p) => priced(p.employeeId, p.noRecord)))
      : null;
    issues.push({ key: `attendance:${c.key}`, source: 'Attendance', title: c.label, why: c.hint, owner: OWNER[c.key] || 'HR', count: c.count, money, screen: c.screen, app: 'attendance', blocks: c.severity === 'block' });
  }
  for (const c of health.checks) {
    if (c.severity !== 'BLOCKS_PAYROLL') continue;
    issues.push({ key: `data:${c.id}`, source: c.area === 'Payroll' ? 'Payroll' : c.area === 'Leave' ? 'Leave' : 'People', title: c.title, why: c.why, owner: c.area === 'Payroll' ? 'Payroll admin' : 'HR', count: c.count, money: null, screen: c.screen, app: c.area === 'Payroll' ? 'payroll' : 'attendance', blocks: true });
  }
  issues.sort((a, b) => Number(b.blocks) - Number(a.blocks) || (b.money ?? -1) - (a.money ?? -1) || b.count - a.count);

  /* The people in the way of closing, worst first. */
  const dataBlocked = new Map<string, string[]>();
  for (const c of health.checks) {
    if (c.severity !== 'BLOCKS_PAYROLL') continue;
    for (const p of c.people) if (p.id) dataBlocked.set(p.id, [...(dataBlocked.get(p.id) || []), c.title]);
  }
  const people = att.people
    .map((p) => {
      const problems = [
        ...(p.missingOut ? [`${p.missingOut} day${p.missingOut === 1 ? '' : 's'} without check-out`] : []),
        ...(p.noRecord ? [`${p.noRecord} working day${p.noRecord === 1 ? '' : 's'} with no record`] : []),
        ...(p.unapprovedOvertime ? [`${p.unapprovedOvertime} day${p.unapprovedOvertime === 1 ? '' : 's'} of overtime to approve`] : []),
        ...(dataBlocked.get(p.employeeId) || []),
      ];
      const money = priced(p.employeeId, p.missingOut + p.noRecord);
      return { employeeId: p.employeeId, name: p.name, code: p.code, problems, money: money == null ? null : rupees(money), blocking: p.missingOut > 0 || p.noRecord > 0 || dataBlocked.has(p.employeeId) };
    })
    .filter((p) => p.problems.length)
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || (b.money ?? 0) - (a.money ?? 0) || b.problems.length - a.problems.length);

  const total = att.people.length;
  const blockingPeople = people.filter((p) => p.blocking).length;
  return {
    month,
    closed: att.closed,
    ended: att.ended,
    /* Share of people with nothing in the way, and whether any issue blocks the month. */
    score: total ? Math.round(((total - blockingPeople) / total) * 100) : 100,
    ready: !issues.some((i) => i.blocks),
    people: { total, blocking: blockingPeople },
    moneyAtRisk: opts.pay ? sumMoney(issues.map((i) => i.money)) : null,
    payVisible: opts.pay,
    issues,
    blockers: people.slice(0, 50),
  };
}

// ---------------------------------------------------------------- loss of pay, three ways

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

export type LopMismatch = {
  employeeId: string;
  name: string;
  code: string | null;
  /** Approved unpaid leave in the pay period, from the leave requests. */
  leaveDays: number;
  /** The unpaid-leave part of the day records (what approval wrote on the days). */
  recordsLeaveDays: number;
  /** Loss of pay from the day records, as Payroll takes it (Attendance's month summary, or leave alone). */
  recordsLossOfPay: number;
  /** Loss of pay on the run, or null when nothing was entered for the person. */
  inputLwpDays: number | null;
  /** Where the run's figure came from: MANUAL, ATTENDANCE, LEAVE, or null. */
  inputSource: string | null;
  problems: string[];
};

/**
 * The loss-of-pay cross-check before a run is locked (closure audit O-06):
 * per person, approved unpaid leave from the leave requests, loss of pay from
 * the day records (services/attendance/payableDays.ts, the figures Payroll
 * takes), and the loss of pay on the run. A mismatch is one of:
 *
 * - the days do not carry the unpaid leave that was approved (leave and the
 *   register have drifted);
 * - the run's figure was taken from the days and the days now say otherwise
 *   (something changed after the pull);
 * - a figure typed on the run pays approved unpaid leave, or, without
 *   Attendance (where the days are the leave), does not match the days.
 *
 * Days typed by hand with Attendance on are a decision about absence and are
 * not second-guessed beyond the unpaid leave they must at least cover.
 */
export async function runLopCheck(accountId: string, orgId: string, runId: string) {
  const none = { checked: 0, source: null as 'ATTENDANCE' | 'LEAVE' | null, mismatches: [] as LopMismatch[] };
  const run = await payrollPrisma.payrollRun.findFirst({ where: { id: runId, orgId }, select: { id: true, periodId: true } });
  const period = run ? await payrollPrisma.payrollPeriod.findFirst({ where: { orgId, id: run.periodId }, select: { startDate: true, endDate: true } }) : null;
  if (!run || !period) return none;
  const { startDate: from, endDate: to } = period;
  const members = (await payrollPrisma.payrollRunEmployee.findMany({ where: { orgId, runId, inclusion: 'INCLUDED' }, select: { employeeId: true } })).map((m) => m.employeeId);
  if (!members.length) return none;
  const inRun = new Set(members);
  const attendanceOn = await isFeatureEnabled(accountId, orgId, 'attendance');

  /* 1. The leave requests: approved, on an unpaid type, the part inside the period. */
  const unpaidTypes = await peoplePrisma.leaveType.findMany({ where: { orgId, isPaid: false }, select: { id: true, sandwich: true, countsCalendarDays: true } });
  const requests = unpaidTypes.length
    ? await peoplePrisma.leaveRequest.findMany({
        where: { orgId, status: 'APPROVED', employeeId: { in: members }, leaveTypeId: { in: unpaidTypes.map((t) => t.id) }, fromDate: { lte: to }, toDate: { gte: from } },
        select: { employeeId: true, leaveTypeId: true, fromDate: true, toDate: true, days: true },
      })
    : [];
  const leave = new Map<string, number>();
  for (const q of requests) {
    let days = q.days;
    if (q.fromDate < from || q.toDate > to) {
      /* Across the period edge: the request's charged dates inside the period, counted as the request counted them. */
      const { dayPlan } = await import('../../routes/leave.js');
      const person = await peoplePrisma.employee.findFirst({ where: { orgId, id: q.employeeId }, select: { id: true, branchId: true, areaId: true } });
      const type = unpaidTypes.find((t) => t.id === q.leaveTypeId);
      const plan = person ? await dayPlan(orgId, person, q.fromDate, q.toDate, { sandwich: type?.sandwich, countsCalendarDays: type?.countsCalendarDays }) : [];
      days = plan.filter((d) => d.counted && d.date >= from && d.date <= to).length;
    }
    leave.set(q.employeeId, (leave.get(q.employeeId) || 0) + days);
  }

  /* 2. The day records, the way Payroll takes them: whole months through payableMonth, a part-month period directly. */
  const records = new Map<string, { name: string; code: string | null; lop: number; leave: number }>();
  const add = (id: string, name: string, code: string | null, lop: number, lv: number) => {
    const had = records.get(id) || { name, code, lop: 0, leave: 0 };
    had.lop += lop;
    had.leave += lv;
    records.set(id, had);
  };
  const months = [...new Set(daysBetween(from, to).map((d) => d.slice(0, 7)))];
  if (months.every((m) => `${m}-01` >= from && lastOfMonth(m) <= to)) {
    for (const m of months) {
      const { rows } = await payableMonth(accountId, orgId, m, members);
      for (const r of rows) add(r.employeeId, r.name, r.code, r.lossOfPayDays, r.unpaidLeaveDays);
    }
  } else if (attendanceOn) {
    for (const r of await periodRows(accountId, orgId, daysBetween(from, to))) {
      if (inRun.has(r.employeeId)) add(r.employeeId, r.name, r.code ?? null, Number(r.lossOfPayDays) || 0, Number(r.unpaidLeaveDays) || 0);
    }
  } else {
    for (const [id, u] of await leaveLossOfPay(orgId, members, from, to)) add(id, '', null, u.days, u.leaveDays);
  }

  /* 3. The run. */
  const inputs = new Map((await payrollPrisma.payrollInput.findMany({ where: { orgId, runId }, select: { employeeId: true, lwpDays: true, source: true } })).map((i) => [i.employeeId, i]));
  const names = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: members } }, select: { id: true, name: true, code: true } })).map((e) => [e.id, e]));

  const mismatches: LopMismatch[] = [];
  for (const id of members) {
    const rec = records.get(id);
    const leaveDays = r2(leave.get(id) || 0);
    const recordsLeaveDays = r2(rec?.leave || 0);
    const recordsLossOfPay = r2(rec?.lop || 0);
    const input = inputs.get(id);
    const inputLwpDays = input ? r2(Number(input.lwpDays)) : null;
    const inputSource = input?.source || null;
    const onRun = inputLwpDays ?? 0;
    const problems: string[] = [];
    if (leaveDays !== recordsLeaveDays) problems.push(`Approved unpaid leave is ${dayWord(leaveDays)}, but the days carry ${recordsLeaveDays}.`);
    const taken = inputSource === 'ATTENDANCE' || inputSource === 'LEAVE';
    if (taken || !attendanceOn) {
      if (onRun !== recordsLossOfPay) problems.push(`The run has ${dayWord(onRun)} of loss of pay; the days say ${recordsLossOfPay}.${taken ? ' Take the days again.' : ''}`);
    } else if (onRun < leaveDays) {
      problems.push(`The run has ${dayWord(onRun)} of loss of pay, less than the ${leaveDays} of approved unpaid leave.`);
    }
    if (!problems.length) continue;
    const who = names.get(id);
    mismatches.push({ employeeId: id, name: who?.name || rec?.name || '', code: who?.code ?? rec?.code ?? null, leaveDays, recordsLeaveDays, recordsLossOfPay, inputLwpDays, inputSource, problems });
  }
  mismatches.sort((a, b) => a.name.localeCompare(b.name));
  return { checked: members.length, source: attendanceOn ? ('ATTENDANCE' as const) : ('LEAVE' as const), mismatches };
}
