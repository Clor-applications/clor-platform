import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { monthReadiness } from '../attendance/readiness.js';
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
