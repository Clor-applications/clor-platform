import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { isFeatureEnabled } from '../features.js';
import { periodRows } from './days.js';
import { eachDay } from '../../utils/istDate.js';

/**
 * Loss of pay and payable days, as Payroll takes them. One calculation for
 * Payroll's run inputs (routes/payrollRuns.ts from-leave and from-attendance)
 * and for People's month view (Time & Leave → Attendance), so HR can check a
 * month before payroll against the very numbers payroll will use (HR view
 * audit, gap 6).
 */

export type LeaveLoss = { days: number; leaveDays: number; names: Set<string> };

/**
 * Without Attendance, from approved leave alone: per person, the leave
 * fraction lost on an unpaid type (0.5 for a half day, 1 for a whole one)
 * plus the unworked other half of a linked half day when the person clocked
 * in and fell short. Nobody need clock in at all: a half day of paid leave
 * with no punches is half leave and half an ordinary working day, not half
 * a day's loss of pay (Time & Leave audit, 27 Oct 2026).
 */
export async function leaveLossOfPay(orgId: string, employeeIds: string[], from: string, to: string): Promise<Map<string, LeaveLoss>> {
  const unpaid = new Map<string, LeaveLoss>();
  if (!employeeIds.length) return unpaid;
  const days = await peoplePrisma.attendanceRecord.findMany({
    where: { orgId, employeeId: { in: employeeIds }, date: { gte: from, lte: to }, leaveRequestId: { not: null } },
    select: { employeeId: true, status: true, leaveRequestId: true, checkIn: true },
  });
  if (!days.length) return unpaid;
  const requests = await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: [...new Set(days.map((d) => d.leaveRequestId!))] } }, select: { id: true, leaveTypeId: true } });
  const types = new Map((await peoplePrisma.leaveType.findMany({ where: { orgId }, select: { id: true, name: true, isPaid: true } })).map((t) => [t.id, t]));
  const typeOf = new Map(requests.map((r) => [r.id, types.get(r.leaveTypeId)]));
  for (const d of days) {
    const t = typeOf.get(d.leaveRequestId!);
    if (!t) continue;
    const onLeave = d.status === 'ON_LEAVE';
    const leaveFraction = t.isPaid ? 0 : onLeave ? 1 : 0.5;
    const loss = leaveFraction + (d.status === 'HALF_DAY' && d.checkIn ? 0.5 : 0);
    if (!loss) continue;
    const u = unpaid.get(d.employeeId) || { days: 0, leaveDays: 0, names: new Set<string>() };
    u.days += loss;
    u.leaveDays += leaveFraction;
    if (leaveFraction) u.names.add(`${t.name}${onLeave ? '' : ' half'}`);
    unpaid.set(d.employeeId, u);
  }
  return unpaid;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export type PayableRow = {
  employeeId: string;
  name: string;
  code: string | null;
  department: string | null;
  /** The days payroll counts the month on: every day of it. */
  totalDays: number;
  unpaidLeaveDays: number;
  /** Working days with no attendance (Attendance on only; without it nobody is marked absent). */
  absentDays: number;
  lossOfPayDays: number;
  payableDays: number;
  /** What the figures come from: ATTENDANCE (the month summary) or LEAVE (approved leave alone). */
  source: 'ATTENDANCE' | 'LEAVE';
  why: string;
};

/**
 * A month's payable and loss-of-pay days per person, the way Payroll will
 * take them: from Attendance's month summary when Attendance is on
 * (from-attendance), else from leave alone (from-leave). `employeeIds` limits
 * it to a scope.
 */
export async function payableMonth(accountId: string, orgId: string, month: string, employeeIds: string[] | null = null): Promise<{ source: 'ATTENDANCE' | 'LEAVE'; rows: PayableRow[] }> {
  const dates = eachDay(`${month}-01`, lastOfMonth(month));
  const keep = employeeIds ? new Set(employeeIds) : null;
  if (await isFeatureEnabled(accountId, orgId, 'attendance')) {
    const rows = (await periodRows(accountId, orgId, dates)).filter((r) => !keep || keep.has(r.employeeId));
    return {
      source: 'ATTENDANCE',
      rows: rows.map((r: any) => {
        const lop = Number(r.lossOfPayDays) || 0;
        const parts = [r.absent ? `${r.absent} absent` : '', r.halfDays ? `${r.halfDays} half` : '', r.incompleteDays ? `${r.incompleteDays} no check-out` : '', r.unpaidLeaveDays ? `${r.unpaidLeaveDays} unpaid leave` : '', r.latePenaltyDays ? `${r.latePenaltyDays} late penalty` : ''].filter(Boolean);
        return {
          employeeId: r.employeeId, name: r.name, code: r.code ?? null, department: r.department ?? null,
          totalDays: r.totalDays, unpaidLeaveDays: r2(Number(r.unpaidLeaveDays) || 0), absentDays: Number(r.absent) || 0,
          lossOfPayDays: r2(lop), payableDays: r2(Math.max(0, r.totalDays - lop)), source: 'ATTENDANCE' as const,
          why: parts.join(', '),
        };
      }),
    };
  }
  const people = await peoplePrisma.employee.findMany({
    where: {
      accountId, orgId,
      ...(keep ? { id: { in: [...keep] } } : {}),
      AND: [{ OR: [{ dateOfLeaving: null }, { dateOfLeaving: { gte: dates[0] } }] }, { OR: [{ dateOfJoining: null }, { dateOfJoining: { lte: dates[dates.length - 1] } }] }],
    },
    select: { id: true, name: true, code: true, department: true },
    orderBy: { name: 'asc' },
  });
  const unpaid = await leaveLossOfPay(orgId, people.map((p) => p.id), dates[0], dates[dates.length - 1]);
  return {
    source: 'LEAVE',
    rows: people.map((p) => {
      const u = unpaid.get(p.id);
      const lop = u ? r2(u.days) : 0;
      return {
        employeeId: p.id, name: p.name, code: p.code ?? null, department: p.department ?? null,
        totalDays: dates.length, unpaidLeaveDays: u ? r2(u.leaveDays) : 0, absentDays: 0,
        lossOfPayDays: lop, payableDays: r2(Math.max(0, dates.length - lop)), source: 'LEAVE' as const,
        why: u ? [...u.names].join(', ') : '',
      };
    }),
  };
}

export const lastOfMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
