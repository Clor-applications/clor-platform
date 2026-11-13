import { createHash } from 'node:crypto';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { isWeeklyOff, istInstant } from './compute.js';
import { clashingTemporaries } from './conflicts.js';
import { daysOfMonth, monthRows, periodContext } from './days.js';
import { overtimeDaysOver } from './overtimeFigures.js';
import { readerTrustOn } from './trust.js';
import { eachDay, todayIst } from '../../utils/istDate.js';
import type { TeamScope } from '../people/scope.js';

/** The people a scope reaches, as a list to filter on; undefined is everyone. */
const idsOf = (scope?: TeamScope) => (scope && !scope.all ? scope.ids : undefined);

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
  /** `overCap`: the part of the day's overtime over the company's caps, in words ("1 h over the cap of 2 h a day"), or null. */
  unapprovedOvertime: Array<{ id: string; date: string; minutes: number; overCapMinutes: number; overCap: string | null }>;
};

export async function scanDays(accountId: string, orgId: string, from: string, to: string, scope?: TeamScope) {
  const ctx = await periodContext(accountId, orgId, from, to, { employeeIds: idsOf(scope) });
  const people: PersonIssues[] = [];
  const overtime = await overtimeDaysOver(ctx, orgId);
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
        /* Before the company kept attendance on CLOR: never tracked, so neither absent nor "no record" (#5). */
        if (ctx.untracked(p.id, d)) continue;
        const rule = ctx.shiftOn(p.id, d).rule;
        if (!holidays.has(d) && !isWeeklyOff(rule, d)) issue.noRecord.push(d);
        continue;
      }
      if (r.checkIn && !r.checkOut) issue.missingOut.push({ id: r.id, date: d });
      if (!r.validated) issue.unvalidated.push({ id: r.id, date: d });
      if (r.overtimeMinutes > 0 && !r.overtimeApproved) {
        const day = overtime.days.get(p.id)?.get(d);
        issue.unapprovedOvertime.push({ id: r.id, date: d, minutes: r.overtimeMinutes, overCapMinutes: day?.overCapMinutes || 0, overCap: day?.overCap || null });
      }
    }
    people.push(issue);
  }
  return { people, today: ctx.today };
}

/**
 * Queues that are not about one day of one person's record. Under a team
 * scope only that team's requests and schedules count; reader IDs that match
 * nobody and reader problems belong to no team, so a team sees none of them.
 */
export async function scanQueues(orgId: string, from: string, to: string, scope?: TeamScope) {
  const fromAt = istInstant(from, '00:00');
  const toAt = istInstant(to, '00:00', 1);
  const ids = idsOf(scope);
  const mine = ids ? { employeeId: { in: ids } } : {};
  const [corrections, leave, unmatched, alerts, temporaries, held] = await Promise.all([
    peoplePrisma.attendanceRequest.findMany({ where: { orgId, status: 'PENDING', date: { gte: from, lte: to }, ...mine }, orderBy: { date: 'asc' } }),
    peoplePrisma.leaveRequest.findMany({ where: { orgId, status: 'PENDING', fromDate: { lte: to }, toDate: { gte: from }, ...mine }, orderBy: { fromDate: 'asc' } }),
    ids ? Promise.resolve([] as any[]) : peoplePrisma.devicePunch.groupBy({ by: ['pin'], where: { orgId, employeeId: null, at: { gte: fromAt, lt: toAt } }, _count: { _all: true }, _min: { at: true }, _max: { at: true } }),
    ids ? Promise.resolve([] as any[]) : peoplePrisma.readerAlert.findMany({ where: { orgId, resolvedAt: null }, orderBy: { openedAt: 'desc' } }),
    peoplePrisma.temporarySchedule.findMany({ where: { orgId, fromDate: { lte: to }, toDate: { gte: from }, ...mine } }),
    /* Reader punches held for a look (#11), by the time the reader put on them (the same set the held list and Count take; punches.ts takeableHeld): on nobody's day until Count or Discard. Matched ones only: a held punch nobody's ID matches is under `unmatched` already. */
    peoplePrisma.devicePunch.findMany({ where: { orgId, reviewStatus: 'HELD', employeeId: { not: null }, localTime: { gte: `${from} 00:00:00`, lte: `${to} 23:59:59` }, ...mine }, select: { id: true, employeeId: true, localTime: true } }),
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
  return { corrections, leave, unmatched, alerts, clashes, held };
}

/**
 * The month-close checklist: every item, its severity, and whether the month
 * is ready. A team scope narrows every count to that team; closing the month
 * reads it unscoped, for the whole company.
 */
export async function monthReadiness(accountId: string, orgId: string, month: string, scope?: TeamScope) {
  const days = daysOfMonth(month);
  const from = days[0];
  const to = days[days.length - 1];
  const [{ people }, queues, lock, snapshots, trustOn] = await Promise.all([
    scanDays(accountId, orgId, from, to, scope),
    scanQueues(orgId, from, to, scope),
    peoplePrisma.attendanceMonthLock.findUnique({ where: { orgId_month: { orgId, month } } }),
    peoplePrisma.attendanceMonthSnapshot.findMany({ where: { orgId, month }, orderBy: { version: 'desc' }, select: { version: true, createdAt: true, createdByUserId: true } }),
    readerTrustOn(accountId, orgId),
  ]);
  /* Reader trust (O-11): days whose punches need a look. Worth a look, never a blocker. */
  const trustCheck = trustOn ? await peoplePrisma.attendanceRecord.count({ where: { accountId, orgId, date: { gte: from, lte: to }, trust: 'CHECK', ...(idsOf(scope) ? { employeeId: { in: idsOf(scope) } } : {}) } }) : 0;
  /* Late-mark penalties nobody decided (markRules.ts): a part to come from leave must be applied before payroll takes the month. */
  const { penaltiesOver } = await import('./markRules.js');
  const due = [...(await penaltiesOver(accountId, orgId, days, { employeeIds: idsOf(scope) })).values()].filter((p) => p.status === 'DUE');
  const dueFromLeave = due.some((p) => p.fromLeave.length > 0);
  const sum = (f: (p: PersonIssues) => number) => people.reduce((s, p) => s + f(p), 0);
  const overCapDays = sum((p) => p.unapprovedOvertime.filter((o) => o.overCapMinutes > 0).length);
  const checks = [
    { key: 'missingOut', label: 'Days with a check-in and no check-out', severity: 'block', count: sum((p) => p.missingOut.length), screen: 'records', hint: 'Not paid until corrected.' },
    { key: 'corrections', label: 'Correction requests waiting', severity: 'block', count: queues.corrections.length, screen: 'requests', hint: 'Approve or reject so the days are final.' },
    { key: 'leave', label: 'Leave requests waiting', severity: 'block', count: queues.leave.length, screen: 'leaveRequests', hint: 'Pending leave is not on the days yet.' },
    /* Review of #144: a held punch dated in the month is on nobody's day; Count or Discard it before the month is final. */
    { key: 'held', label: 'Reader punches held for this month', severity: 'block', count: queues.held.length, screen: 'unmatched', hint: 'The reader’s clock was ahead. Count or discard each under Held for a look.' },
    { key: 'unmatched', label: 'Reader IDs with punches but no employee', severity: 'block', count: queues.unmatched.length, screen: 'unmatched', hint: 'Their punches are not on anybody’s days.' },
    /*
     * Not a quiet "worth a look" (audit 7 Nov 2026, #5): each of these days is docked from pay as an unpaid
     * absence once the month closes. The month closes over them only when someone confirms them, by count.
     */
    { key: 'noRecord', label: 'Working days with no record', severity: 'confirm', count: sum((p) => p.noRecord.length), screen: 'register', hint: 'Each is docked as an unpaid absence (loss of pay) when the month closes.' },
    { key: 'overtime', label: 'Overtime not yet approved', severity: 'check', count: sum((p) => p.unapprovedOvertime.length), screen: 'records', hint: overCapDays ? `Unapproved overtime is not paid. ${overCapDays} of these ${overCapDays === 1 ? 'days has' : 'days have'} hours over the overtime cap.` : 'Unapproved overtime is not paid.' },
    { key: 'unvalidated', label: 'Days not validated', severity: 'check', count: sum((p) => p.unvalidated.length), screen: 'records', hint: 'Payable days are worked out from validated and unvalidated days alike.' },
    { key: 'readers', label: 'Reader problems open now', severity: 'check', count: queues.alerts.length, screen: 'readerHealth', hint: 'Punches may be missing from these readers.' },
    ...(due.length ? [{ key: 'penalties', label: 'Late-mark penalties not applied or waived', severity: 'block', count: due.length, screen: 'lateMarks', hint: dueFromLeave ? 'Part comes from leave: apply them so the leave is taken before payroll.' : 'Payroll waits for them: apply or waive them in People, Late marks.' }] : []),
    ...(trustOn ? [{ key: 'trustCheck', label: 'Days whose punches need a look', severity: 'check', count: trustCheck, screen: 'records', hint: 'A punch arrived late, a reader was offline or its clock was out, a phone punch was outside the work sites, or a reader is not registered.' }] : []),
  ];
  const perPerson = people
    .map((p) => ({ employeeId: p.employeeId, name: p.name, code: p.code, missingOut: p.missingOut.length, noRecord: p.noRecord.length, noRecordDates: p.noRecord, unvalidated: p.unvalidated.length, unapprovedOvertime: p.unapprovedOvertime.length }))
    .map((p) => ({ ...p, ready: p.missingOut === 0 }))
    .sort((a, b) => b.missingOut - a.missingOut || b.noRecord - a.noRecord || a.name.localeCompare(b.name));
  const blocking = checks.filter((c) => c.severity === 'block' && c.count > 0).length;
  const toCheck = checks.filter((c) => c.severity === 'check' && c.count > 0).length;
  /* Days that would be docked as unpaid absence: closing asks for this exact number back (routes/attendance.ts). */
  const lossOfPayDays = sum((p) => p.noRecord.length);
  /*
   * What the closer confirms: the exact days, not only how many (review of #144). Another set of days
   * with the same count (a day corrected, another one gone missing) gives another token.
   */
  const noRecordToken = lossOfPayDays
    ? createHash('sha256').update(people.flatMap((p) => p.noRecord.map((d) => `${p.employeeId}:${d}`)).sort().join('\n')).digest('hex').slice(0, 24)
    : null;
  const settings = await peoplePrisma.attendanceSettings.findUnique({ where: { orgId }, select: { attendanceStartDate: true } });
  return {
    month,
    ended: to < todayIst(),
    closed: lock ? { at: lock.lockedAt, byUserId: lock.lockedByUserId } : null,
    /* Not ready while days would be docked as unpaid absence: closing over them is a decision, not an all clear. */
    ready: blocking === 0 && lossOfPayDays === 0,
    blocking,
    toCheck,
    /* `ready` says nothing blocks; with these above nought it is not "all clear" either. */
    noRecordDays: lossOfPayDays,
    noRecordToken,
    /* Sent back as is with the close (routes/attendance.ts). */
    noRecordConfirm: lossOfPayDays ? { confirmNoRecordDays: lossOfPayDays, confirmNoRecordToken: noRecordToken } : {},
    noRecordPeople: people.filter((p) => p.noRecord.length > 0).length,
    attendanceStartDate: settings?.attendanceStartDate ?? null,
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

/** The latest close of a month: its version and the rows Payroll takes, or null if it was never closed. */
export async function getMonthSnapshot(orgId: string, month: string) {
  const snap = await peoplePrisma.attendanceMonthSnapshot.findFirst({ where: { orgId, month }, orderBy: { version: 'desc' } });
  if (!snap) return null;
  return { month, version: snap.version, createdAt: snap.createdAt, rows: JSON.parse(snap.rowsJson || '[]') as any[] };
}

