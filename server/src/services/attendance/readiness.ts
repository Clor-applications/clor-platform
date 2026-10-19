import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { isWeeklyOff, istInstant } from './compute.js';
import { clashingTemporaries } from './conflicts.js';
import { daysBetween, daysOfMonth, monthRows, periodContext } from '../../routes/attendance.js';

/**
 * What is still unsettled in a stretch of days, person by person.
 *
 * Shared by the month-close checklist (Payroll readiness) and the Exception
 * Center, so the two can never count differently. Nothing here changes a
 * day: it reads the records, the schedule, the holidays and the queues.
 */

export type PersonIssues = {
  employeeId: string;
  name: string;
  code: string | null;
  missingOut: Array<{ id: string; date: string }>;
  noRecord: string[];
  unvalidated: Array<{ id: string; date: string }>;
  unapprovedOvertime: Array<{ id: string; date: string; minutes: number }>;
};

export async function scanDays(accountId: string, orgId: string, from: string, to: string) {
  const ctx = await periodContext(accountId, orgId, from, to);
  const people: PersonIssues[] = [];
  for (const p of ctx.people) {
    if (p.status === 'LEFT' && !p.dateOfLeaving) continue;
    const span = ctx.spanOf(p);
    const recs = ctx.recordsOf.get(p.id) || new Map();
    const holidays = ctx.holidaysFor(p);
    const issue: PersonIssues = { employeeId: p.id, name: p.name, code: p.code, missingOut: [], noRecord: [], unvalidated: [], unapprovedOvertime: [] };
    for (const d of span) {
      if (d >= ctx.today) continue; /* only days that have ended */
      const r = recs.get(d);
      if (!r) {
        const rule = ctx.shiftOn(p.id, d).rule;
        if (!holidays.has(d) && !isWeeklyOff(rule, d)) issue.noRecord.push(d);
        continue;
      }
      if (r.checkIn && !r.checkOut) issue.missingOut.push({ id: r.id, date: d });
      if (!r.validated) issue.unvalidated.push({ id: r.id, date: d });
      if (r.overtimeMinutes > 0 && !r.overtimeApproved) issue.unapprovedOvertime.push({ id: r.id, date: d, minutes: r.overtimeMinutes });
    }
    people.push(issue);
  }
  return { people, today: ctx.today };
}

/** Queues that are not about one day of one person's record. */
export async function scanQueues(orgId: string, from: string, to: string) {
  const fromAt = istInstant(from, '00:00');
  const toAt = istInstant(to, '00:00', 1);
  const [corrections, leave, unmatched, alerts, temporaries] = await Promise.all([
    peoplePrisma.attendanceRequest.findMany({ where: { orgId, status: 'PENDING', date: { gte: from, lte: to } }, orderBy: { date: 'asc' } }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, status: 'PENDING', fromDate: { lte: to }, toDate: { gte: from } }, orderBy: { fromDate: 'asc' } }),
    peoplePrisma.devicePunch.groupBy({ by: ['pin'], where: { orgId, employeeId: null, at: { gte: fromAt, lt: toAt } }, _count: { _all: true }, _min: { at: true }, _max: { at: true } }),
    peoplePrisma.readerAlert.findMany({ where: { orgId, resolvedAt: null }, orderBy: { openedAt: 'desc' } }),
    peoplePrisma.temporarySchedule.findMany({ where: { orgId, fromDate: { lte: to }, toDate: { gte: from } } }),
  ]);
  /* Two temporary schedules for the same person on the same days with different shifts. */
  const byPerson = new Map<string, Array<{ id: string; shiftId: string; from: string; to: string | null }>>();
  for (const t of temporaries) {
    const list = byPerson.get(t.employeeId) || [];
    list.push({ id: t.id, shiftId: t.shiftId, from: t.fromDate, to: t.toDate });
    byPerson.set(t.employeeId, list);
  }
  const clashes: Array<{ employeeId: string; a: any; b: any; from: string; to: string | null }> = [];
  for (const [employeeId, list] of byPerson) for (const c of clashingTemporaries(list)) clashes.push({ employeeId, ...c });
  return { corrections, leave, unmatched, alerts, clashes };
}

/** The month-close checklist: every item, its severity, and whether the month is ready. */
export async function monthReadiness(accountId: string, orgId: string, month: string) {
  const days = daysOfMonth(month);
  const from = days[0];
  const to = days[days.length - 1];
  const [{ people }, queues, lock, snapshots] = await Promise.all([
    scanDays(accountId, orgId, from, to),
    scanQueues(orgId, from, to),
    peoplePrisma.attendanceMonthLock.findUnique({ where: { orgId_month: { orgId, month } } }),
    peoplePrisma.attendanceMonthSnapshot.findMany({ where: { orgId, month }, orderBy: { version: 'desc' }, select: { version: true, createdAt: true, createdByUserId: true } }),
  ]);
  const sum = (f: (p: PersonIssues) => number) => people.reduce((s, p) => s + f(p), 0);
  const checks = [
    { key: 'missingOut', label: 'Days with a check-in and no check-out', severity: 'block', count: sum((p) => p.missingOut.length), screen: 'records', hint: 'Not paid until corrected.' },
    { key: 'corrections', label: 'Correction requests waiting', severity: 'block', count: queues.corrections.length, screen: 'requests', hint: 'Approve or reject so the days are final.' },
    { key: 'leave', label: 'Leave requests waiting', severity: 'block', count: queues.leave.length, screen: 'leaveRequests', hint: 'Pending leave is not on the days yet.' },
    { key: 'unmatched', label: 'Reader IDs with punches but no employee', severity: 'block', count: queues.unmatched.length, screen: 'unmatched', hint: 'Their punches are not on anybody’s days.' },
    { key: 'noRecord', label: 'Working days with no record', severity: 'check', count: sum((p) => p.noRecord.length), screen: 'register', hint: 'They count as absent (loss of pay).' },
    { key: 'overtime', label: 'Overtime not yet approved', severity: 'check', count: sum((p) => p.unapprovedOvertime.length), screen: 'records', hint: 'Unapproved overtime is not paid.' },
    { key: 'unvalidated', label: 'Days not validated', severity: 'check', count: sum((p) => p.unvalidated.length), screen: 'records', hint: 'Payable days are worked out from validated and unvalidated days alike.' },
    { key: 'readers', label: 'Reader problems open now', severity: 'check', count: queues.alerts.length, screen: 'readerHealth', hint: 'Punches may be missing from these readers.' },
  ];
  const perPerson = people
    .map((p) => ({ employeeId: p.employeeId, name: p.name, code: p.code, missingOut: p.missingOut.length, noRecord: p.noRecord.length, unvalidated: p.unvalidated.length, unapprovedOvertime: p.unapprovedOvertime.length }))
    .map((p) => ({ ...p, ready: p.missingOut === 0 }))
    .sort((a, b) => b.missingOut - a.missingOut || b.noRecord - a.noRecord || a.name.localeCompare(b.name));
  const blocking = checks.filter((c) => c.severity === 'block' && c.count > 0).length;
  const toCheck = checks.filter((c) => c.severity === 'check' && c.count > 0).length;
  return {
    month,
    ended: to < new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
    closed: lock ? { at: lock.lockedAt, byUserId: lock.lockedByUserId } : null,
    ready: blocking === 0,
    blocking,
    toCheck,
    checks,
    people: perPerson,
    snapshots,
  };
}

/** Freeze what Payroll takes from a month, as a new version. */
export async function snapshotMonth(accountId: string, orgId: string, month: string, userId: string, readiness: unknown) {
  const rows = await monthRows(accountId, orgId, month);
  const last = await peoplePrisma.attendanceMonthSnapshot.findFirst({ where: { orgId, month }, orderBy: { version: 'desc' }, select: { version: true } });
  return peoplePrisma.attendanceMonthSnapshot.create({
    data: { accountId, orgId, month, version: (last?.version || 0) + 1, rowsJson: JSON.stringify(rows), readinessJson: JSON.stringify(readiness ?? null), createdByUserId: userId },
  });
}

export { daysBetween };
