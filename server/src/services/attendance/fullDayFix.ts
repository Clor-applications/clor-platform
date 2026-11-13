import { peoplePrisma, peopleWrite, afterPeopleCommit } from '../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { todayIst } from '../../utils/istDate.js';
import { isFeatureEnabled } from '../features.js';
import { currentLease, exclusive, leaseFor } from '../jobLease.js';
import { registerJob } from '../jobRegistry.js';
import { computeDay, istTime, type ShiftRule } from './compute.js';
import { FINAL_RUN, MonthClosedError, PayrollTakenError, assertMonthOpen, isHoliday } from './days.js';
import { logDayChange } from './history.js';
import { halfOn } from './leaveHalves.js';
import { loadSchedule, resolveShift } from './schedule.js';
import { emit as emitWebhook } from './webhooks.js';

/**
 * Days already written under the old full-day rule (attendance audit 7 Nov 2026, P0; PR #141).
 *
 * Before the fix a working day was PRESENT only at `fullDayMinutes`, so
 * someone in within the late grace, or on a night shift shorter than eight
 * hours net, got a HALF_DAY (or ABSENT) for a day worked as scheduled.
 * compute.ts now also counts the shift worked as scheduled, and every new
 * write uses it. This is a one-time fix of the days last scored before the
 * release: both punches, stored HALF_DAY or ABSENT, scored the same minutes
 * today, not a holiday, and PRESENT under the rule now. The only change is to
 * PRESENT; the minutes stay as they are.
 *
 * The release is when the migration ran (AttendanceFullDayFixMeta, set to
 * now() at deploy). A day was last scored when its history last has a WRITE
 * or BULK, the only actions that score a day (writeDay, and this fix).
 * Validating it, approving its overtime or a trust update are logged apart
 * (VALIDATE, OVERTIME) or not at all, so they never make a day look scored by
 * the new rule; `updatedAt` is not used. A day scored after the release was
 * scored by the new rule; a later change to its shift (a longer grace) is a
 * recalculation for the owner, never this.
 *
 * Which of those days change, and which are only listed ("held"):
 * - MONTH_CLOSED: a closed Attendance month. Never changed.
 * - PAYROLL_TAKEN: an approved, locked, paid or posted pay run took the day
 *   for this person. Never changed; paid as a Payroll adjustment.
 * - PAYROLL_PENDING: a pay run still being worked on (draft, calculated, in
 *   review) has already pulled this person's days for the period. Not
 *   changed under it: the owner saves the day again and pulls the days again.
 * - BEFORE_PAYROLL: on or before the end of the latest final pay run for this
 *   person (or, if none paid them, for the company), but not paid by one.
 *   A run's end is the earlier of its period's end and its provisional
 *   cut-off: a day after the cut-off was assumed present, and the next run's
 *   true-up pays it, so it is corrected.
 * - OLD: before last month, when the company has no final pay run or its
 *   latest ended more than two months ago.
 * Everything after that is corrected: set to PRESENT, made to need
 * validating again, with a history entry and the day webhook. Each one is
 * re-checked under the company's write lock (month open, no final run, its
 * status, punches and minutes as they were read, no scoring write since the
 * release, still eligible on the row as it is).
 *
 * What was corrected and what was held is kept (AttendanceFullDayReview, with
 * the status, punches and minutes as held), so the owner sees both on Data
 * health, a day is never weighed twice, and the log names a held day once.
 * Held days are looked at again on each run: a month reopened or a run
 * deleted lets them be corrected; a day deleted or scored again since (status,
 * punches or minutes changed) is settled as RECORD_CHANGED, while validating
 * it or approving its overtime leaves it held; someone can mark one PAID
 * ("Paid the difference") and undo that.
 *
 * Rest days (HOLIDAY / WEEKLY_OFF) are not touched: paid either way. Days
 * with a half-day leave are left: the half-day rule did not change.
 *
 * Runs once shortly after boot and daily after, on one instance under a
 * lease; also for a company right after a month is reopened, and before a
 * month is closed (routes/attendance.ts), which then refuses to close over a
 * day it should have corrected.
 */

/* The history actions that score a day: what it was written as. VALIDATE, OVERTIME, DELETE and LEAVE_CANCELLED do not. */
const SCORING = ['WRITE', 'BULK'];

/** The release, as the migration recorded it at deploy; none (the migration not run) means nothing is fixed. */
async function releasedAt(given?: Date) {
  if (given) return given;
  const row = await outsideTenant('full-day fix: the release', () => peoplePrisma.attendanceFullDayFixMeta.findUnique({ where: { id: 'release' }, select: { releasedAt: true } }));
  return row?.releasedAt ?? null;
}

export type HeldReason = 'MONTH_CLOSED' | 'PAYROLL_TAKEN' | 'PAYROLL_PENDING' | 'BEFORE_PAYROLL' | 'OLD';
export type FullDayRow = {
  recordId: string;
  employeeId: string;
  date: string;
  from: string;
  to: 'PRESENT';
  workedMinutes: number;
  checkIn: Date | null;
  checkOut: Date | null;
  held: HeldReason | null;
};
type Company = { accountId: string; orgId: string };
type Rec = { id: string; employeeId: string; date: string; shiftId: string | null; status: string; workedMinutes: number; leaveRequestId: string | null; checkIn: Date | null; checkOut: Date | null };
type Leave = { fromDate: string; toDate: string; halfDay: string | null; minutes: number | null };

const PENDING_RUN = ['DRAFT', 'CALCULATED', 'REVIEW'];
const SCANNED = 'SCANNED';
const select = { id: true, employeeId: true, date: true, shiftId: true, status: true, workedMinutes: true, leaveRequestId: true, checkIn: true, checkOut: true } as const;

/** What a day was scored as: its status, punches and minutes. Anything else (validated, overtime approved, trust, a note) is not a change to it. */
type Score = { status: string; workedMinutes: number; checkIn: Date | null; checkOut: Date | null };
const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);
const sameScore = (a: Score, b: Score) => a.status === b.status && a.workedMinutes === b.workedMinutes && ms(a.checkIn) === ms(b.checkIn) && ms(a.checkOut) === ms(b.checkOut);

/** Of these days, the ones last scored before the release: their latest WRITE or BULK is earlier, or they have none (older than the history). */
async function scoredBefore(orgId: string, ids: string[], release: Date) {
  const after = new Set<string>();
  for (let i = 0; i < ids.length; i += 5000) {
    const last = await peoplePrisma.attendanceRecordHistory.groupBy({
      by: ['recordId'],
      where: { orgId, recordId: { in: ids.slice(i, i + 5000) }, action: { in: SCORING } },
      _max: { at: true },
    });
    for (const l of last) if (l.recordId && l._max.at && l._max.at.getTime() >= release.getTime()) after.add(l.recordId);
  }
  return new Set(ids.filter((id) => !after.has(id)));
}

/** Days in India's calendar: the first of last month (the bound with no recent pay run), and two months before today. */
const istDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const bounds = () => {
  const [y, m, d] = todayIst().split('-').map(Number);
  return { lastMonthStart: istDay(y, m - 2, 1), twoMonthsAgo: istDay(y, m - 3, Math.min(d, 28)) };
};

/** Is this day, last scored before the release, one the rule now makes PRESENT, as the row stands? */
async function eligible(orgId: string, r: Rec, rule: ShiftRule, leave: Leave | null | undefined, place: { branchId: string | null; areaId: string | null } | undefined) {
  if (!['HALF_DAY', 'ABSENT'].includes(r.status) || !r.checkIn || !r.checkOut) return false;
  if (leave && halfOn(leave as any, r.date)) return false;
  if ((r.workedMinutes || 0) + (leave?.minutes || 0) >= rule.fullDayMinutes) return false;
  try {
    const now = computeDay({ date: r.date, shift: rule, checkIn: r.checkIn, checkOut: r.checkOut });
    /* Scored the same minutes as when written; otherwise the shift changed since, and a recalculation is the owner's call. */
    if (now.workedMinutes !== r.workedMinutes || now.status !== 'PRESENT') return false;
  } catch {
    return false;
  }
  /* A holiday worked short is a holiday, not a day the new rule makes present: asked last, only of the few left. */
  return !(await isHoliday(orgId, r.date, place?.branchId ?? null, place?.areaId ?? null, r.employeeId));
}

/** The pay-run facts every day of a company is weighed against: a few queries, not a few per day. */
async function payrollFacts(orgId: string) {
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, status: { in: [...FINAL_RUN, ...PENDING_RUN] } }, select: { id: true, status: true, periodId: true, provisionalDays: true } });
  const periods = runs.length ? await payrollPrisma.payrollPeriod.findMany({ where: { orgId, id: { in: [...new Set(runs.map((r) => r.periodId))] } }, select: { id: true, startDate: true, endDate: true } }) : [];
  const final = runs.filter((r) => FINAL_RUN.includes(r.status));
  const pending = runs.filter((r) => PENDING_RUN.includes(r.status));
  const [members, pulled] = await Promise.all([
    final.length ? payrollPrisma.payrollRunEmployee.findMany({ where: { orgId, runId: { in: final.map((r) => r.id) }, inclusion: 'INCLUDED' }, select: { runId: true, employeeId: true } }) : [],
    pending.length ? payrollPrisma.payrollInput.findMany({ where: { orgId, runId: { in: pending.map((r) => r.id) }, source: 'ATTENDANCE' }, select: { runId: true, employeeId: true } }) : [],
  ]);
  const periodOf = new Map(periods.map((p) => [p.id, p]));
  const inRun = new Set(members.map((m) => `${m.runId}|${m.employeeId}`));
  const pulledFor = new Set(pulled.map((m) => `${m.runId}|${m.employeeId}`));
  const covers = (r: { periodId: string }, date: string) => {
    const p = periodOf.get(r.periodId);
    return Boolean(p && p.startDate <= date && p.endDate >= date);
  };
  /* The last day a run took: its period's end, or its provisional cut-off when earlier (the days after were assumed, and the next run trues them up). */
  const runEnd = (r: (typeof final)[number]) => {
    const end = periodOf.get(r.periodId)?.endDate;
    const cutoff = (r.provisionalDays as { cutoffDate?: string } | null)?.cutoffDate;
    return end && cutoff && cutoff < end ? cutoff : end;
  };
  const lastEnd = new Map<string, string>();
  let companyEnd: string | null = null;
  for (const r of final) {
    const end = runEnd(r);
    if (!end) continue;
    if (!companyEnd || end > companyEnd) companyEnd = end;
    for (const m of members) if (m.runId === r.id && (!lastEnd.get(m.employeeId) || end > lastEnd.get(m.employeeId)!)) lastEnd.set(m.employeeId, end);
  }
  return {
    /* Every final run of the period, as days.ts payrollTaken; a day after a run's cut-off was assumed, not taken. */
    taken: (employeeId: string, date: string) =>
      final.some((r) => {
        const end = runEnd(r);
        return covers(r, date) && Boolean(end && date <= end) && inRun.has(`${r.id}|${employeeId}`);
      }),
    pending: (employeeId: string, date: string) => pending.some((r) => covers(r, date) && pulledFor.has(`${r.id}|${employeeId}`)),
    lastEnd: (employeeId: string) => lastEnd.get(employeeId) || companyEnd,
  };
}

async function classifier(orgId: string) {
  const [locks, pay] = await Promise.all([peoplePrisma.attendanceMonthLock.findMany({ where: { orgId }, select: { month: true } }), payrollFacts(orgId)]);
  const closed = new Set(locks.map((l) => l.month));
  const { lastMonthStart, twoMonthsAgo } = bounds();
  return (employeeId: string, date: string): HeldReason | null => {
    if (closed.has(date.slice(0, 7))) return 'MONTH_CLOSED';
    if (pay.taken(employeeId, date)) return 'PAYROLL_TAKEN';
    if (pay.pending(employeeId, date)) return 'PAYROLL_PENDING';
    const end = pay.lastEnd(employeeId);
    if (end && date <= end) return 'BEFORE_PAYROLL';
    /* No final run, or none for over two months: this month and last only. */
    if ((!end || end < twoMonthsAgo) && date < lastMonthStart) return 'OLD';
    return null;
  };
}

async function rulesFor(orgId: string, rows: Rec[]) {
  const people = [...new Set(rows.map((r) => r.employeeId))];
  const dates = rows.map((r) => r.date).sort();
  const schedule = await loadSchedule(orgId, people, dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null);
  const places = new Map(
    people.length ? (await peoplePrisma.employee.findMany({ where: { orgId, id: { in: people } }, select: { id: true, branchId: true, areaId: true } })).map((e) => [e.id, e]) : [],
  );
  const leaveIds = [...new Set(rows.map((r) => r.leaveRequestId).filter((x): x is string => Boolean(x)))];
  const leaves = new Map(
    leaveIds.length ? (await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: leaveIds } }, select: { id: true, fromDate: true, toDate: true, halfDay: true, minutes: true } })).map((l) => [l.id, l]) : [],
  );
  return {
    /* The shift the day was scored on; a day with none was on the schedule's rule for that date. */
    rule: (r: Rec): ShiftRule => (r.shiftId && schedule.shifts.get(r.shiftId)?.rule) || resolveShift(schedule, r.employeeId, r.date).rule,
    leave: (r: Rec) => (r.leaveRequestId ? leaves.get(r.leaveRequestId) : null),
    /* The person's branch and area, for their holidays (isHoliday moves them to where they were on the day). */
    place: (r: Rec) => places.get(r.employeeId),
  };
}

/**
 * Days not yet looked at: short, both punches, last scored before the
 * release; after the first scan, closed months are left out. A day created
 * since the release was scored by the new rule, so the scan starts there.
 */
async function scan(orgId: string, release: Date, opts: { closedMonths?: string[]; month?: string } = {}) {
  const rows = (await peoplePrisma.attendanceRecord.findMany({
    where: {
      orgId,
      status: { in: ['HALF_DAY', 'ABSENT'] },
      createdAt: { lt: release },
      checkIn: { not: null },
      checkOut: { not: null },
      ...(opts.month ? { date: { startsWith: opts.month } } : {}),
      ...(opts.closedMonths?.length ? { NOT: opts.closedMonths.map((m) => ({ date: { startsWith: m } })) } : {}),
    },
    select,
    orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
  })) as Rec[];
  if (!rows.length) return rows;
  const before = await scoredBefore(orgId, rows.map((r) => r.id), release);
  return rows.filter((r) => before.has(r.id));
}

const REASON = 'Full-day rule fix (7 Nov 2026): the shift worked as scheduled, within its grace, is a full day. The day needs validating again.';

/** Correct one day under the company's write lock, re-checking it on the row as it is now. */
async function correct(company: Company, row: FullDayRow, release: Date): Promise<'CORRECTED' | 'CHANGED' | HeldReason> {
  const { accountId, orgId } = company;
  try {
    return await peopleWrite(orgId, async () => {
      await assertMonthOpen(orgId, row.date, row.employeeId);
      const rec = (await peoplePrisma.attendanceRecord.findFirst({ where: { id: row.recordId, orgId }, select: { ...select, lateMinutes: true, earlyOutMinutes: true, overtimeMinutes: true, source: true, validated: true, overtimeApproved: true, note: true } })) as any;
      /* Scored again since it was read (a new status, punches or minutes, or a scoring write since the release): the rule as it is now scored it.
         Validated, overtime approved or a trust update in the meantime is not that, and the day is still corrected. */
      if (!rec || !sameScore(rec, { ...row, status: row.from }) || !(await scoredBefore(orgId, [rec.id], release)).has(rec.id)) return 'CHANGED';
      const facts = await rulesFor(orgId, [rec]);
      if (!(await eligible(orgId, rec, facts.rule(rec), facts.leave(rec), facts.place(rec)))) return 'CHANGED';
      /* A pay run that pulled this person's days in the meantime: not changed under it. */
      if ((await payrollFacts(orgId)).pending(rec.employeeId, rec.date)) return 'PAYROLL_PENDING';
      const changed = await peoplePrisma.attendanceRecord.updateMany({
        where: { id: rec.id, orgId, status: rec.status, workedMinutes: rec.workedMinutes, checkIn: rec.checkIn, checkOut: rec.checkOut },
        data: { status: 'PRESENT', validated: false, validatedByUserId: null, validatedAt: null },
      });
      if (!changed.count) return 'CHANGED';
      const after = { ...rec, status: 'PRESENT', validated: false };
      await logDayChange({ accountId, orgId, employeeId: rec.employeeId, date: rec.date, recordId: rec.id, action: 'BULK', before: rec, after, userId: 'system', reason: REASON });
      await peoplePrisma.attendanceFullDayReview.upsert({
        where: { recordId: rec.id },
        create: { accountId, orgId, employeeId: rec.employeeId, date: rec.date, recordId: rec.id, fromStatus: rec.status, toStatus: 'PRESENT', workedMinutes: rec.workedMinutes, checkIn: rec.checkIn, checkOut: rec.checkOut, outcome: 'CORRECTED' },
        update: { outcome: 'CORRECTED', reason: null, fromStatus: rec.status, workedMinutes: rec.workedMinutes, checkIn: rec.checkIn, checkOut: rec.checkOut },
      });
      afterPeopleCommit(() => emitWebhook(orgId, 'day', {
        employeeId: rec.employeeId,
        date: rec.date,
        status: 'PRESENT',
        checkIn: rec.checkIn ? istTime(rec.checkIn) : null,
        checkOut: rec.checkOut ? istTime(rec.checkOut) : null,
        workedMinutes: rec.workedMinutes,
        lateMinutes: rec.lateMinutes,
        earlyOutMinutes: rec.earlyOutMinutes,
        overtimeMinutes: rec.overtimeMinutes,
        source: rec.source,
      }));
      return 'CORRECTED';
    });
  } catch (e) {
    if (e instanceof MonthClosedError) return 'MONTH_CLOSED';
    if (e instanceof PayrollTakenError) return 'PAYROLL_TAKEN';
    throw e;
  }
}

/**
 * One company. Weighs the days not looked at before, and the held days again;
 * corrects what may change and records what was held. Returns what it did,
 * and which held days are new (the job logs only those).
 *
 * `apply: false` weighs and returns without writing anything.
 * `releasedAt` overrides the release the migration recorded, for tests.
 * `beforeCorrect` is for tests: it runs between the scan and the write.
 */
export async function fixFullDays(company: Company, opts: { apply?: boolean; releasedAt?: Date; beforeCorrect?: (row: FullDayRow) => Promise<void> } = {}) {
  const { accountId, orgId } = company;
  const apply = opts.apply !== false;
  const release = await releasedAt(opts.releasedAt);
  if (!release) return { corrected: [] as FullDayRow[], held: [] as FullDayRow[], open: [] as FullDayRow[], newlyHeld: [] as FullDayRow[], settled: 0 };
  return runInTenant(orgId, async () => {
    const reviews = await peoplePrisma.attendanceFullDayReview.findMany({
      where: { orgId },
      select: { id: true, recordId: true, outcome: true, reason: true, settledAt: true, fromStatus: true, workedMinutes: true, checkIn: true, checkOut: true },
    });
    const seen = new Map(reviews.map((r) => [r.recordId, r]));
    const scanned = reviews.some((r) => r.outcome === SCANNED);
    const closedMonths = scanned ? (await peoplePrisma.attendanceMonthLock.findMany({ where: { orgId }, select: { month: true } })).map((l) => l.month) : [];
    const fresh = await scan(orgId, release, { closedMonths });
    const openHeld = reviews.filter((r) => r.outcome === 'HELD' && !r.settledAt);
    const again = openHeld.length ? ((await peoplePrisma.attendanceRecord.findMany({ where: { orgId, id: { in: openHeld.map((r) => r.recordId) } }, select })) as Rec[]) : [];
    /* A held day is weighed again only while it is as it was held (status, punches, minutes) and still last scored before the release. */
    const current = new Map(again.map((r) => [r.id, r]));
    const stillOld = again.length ? await scoredBefore(orgId, again.map((r) => r.id), release) : new Set<string>();
    const asHeld = (h: (typeof openHeld)[number]) => {
      const r = current.get(h.recordId);
      return Boolean(r && stillOld.has(r.id) && sameScore(r, { status: h.fromStatus, workedMinutes: h.workedMinutes, checkIn: h.checkIn, checkOut: h.checkOut }));
    };
    const keep = new Set(openHeld.filter(asHeld).map((h) => h.recordId));
    const rows = [...fresh.filter((r) => !seen.has(r.id)), ...again.filter((r) => keep.has(r.id))];

    const facts = await rulesFor(orgId, rows);
    const holdOf = await classifier(orgId);
    const candidates: FullDayRow[] = [];
    for (const r of rows) {
      if (!(await eligible(orgId, r, facts.rule(r), facts.leave(r), facts.place(r)))) continue;
      candidates.push({ recordId: r.id, employeeId: r.employeeId, date: r.date, from: r.status, to: 'PRESENT', workedMinutes: r.workedMinutes, checkIn: r.checkIn, checkOut: r.checkOut, held: holdOf(r.employeeId, r.date) });
    }
    /* A held day deleted, or scored again since (its status, punches or minutes changed, or a scoring write since the release): settled as
       changed, it leaves the list. Validated, overtime approved, a trust update or a note is not a change: it stays held. */
    const settled = openHeld.filter((r) => !keep.has(r.recordId));
    const corrected: FullDayRow[] = [];
    const held: FullDayRow[] = [];
    const newlyHeld: FullDayRow[] = [];
    if (!apply) return { corrected, held: candidates.filter((c) => c.held), open: candidates.filter((c) => !c.held), newlyHeld, settled: settled.length };

    if (settled.length) await peoplePrisma.attendanceFullDayReview.updateMany({ where: { orgId, id: { in: settled.map((s) => s.id) } }, data: { settledAs: 'RECORD_CHANGED', settledAt: new Date() } });
    for (const c of candidates) {
      if (currentLease()?.signal.aborted) break;
      let outcome: 'CORRECTED' | 'CHANGED' | HeldReason | null = c.held;
      if (!outcome) {
        if (opts.beforeCorrect) await opts.beforeCorrect(c);
        outcome = await correct(company, c, release);
      }
      if (outcome === 'CORRECTED') {
        corrected.push(c);
        continue;
      }
      if (outcome === 'CHANGED') continue;
      const row = { ...c, held: outcome };
      held.push(row);
      const before = seen.get(c.recordId);
      if (!before || before.reason !== outcome) newlyHeld.push(row);
      await peoplePrisma.attendanceFullDayReview.upsert({
        where: { recordId: c.recordId },
        create: { accountId, orgId, employeeId: c.employeeId, date: c.date, recordId: c.recordId, fromStatus: c.from, toStatus: 'PRESENT', workedMinutes: c.workedMinutes, checkIn: c.checkIn, checkOut: c.checkOut, outcome: 'HELD', reason: outcome },
        update: { outcome: 'HELD', reason: outcome, fromStatus: c.from, workedMinutes: c.workedMinutes, checkIn: c.checkIn, checkOut: c.checkOut },
      });
    }
    if (!scanned) {
      await peoplePrisma.attendanceFullDayReview.upsert({
        where: { recordId: `${SCANNED}:${orgId}` },
        create: { accountId, orgId, employeeId: '', date: todayIst(), recordId: `${SCANNED}:${orgId}`, fromStatus: '', toStatus: '', workedMinutes: 0, outcome: SCANNED },
        update: {},
      });
    }
    return { corrected, held, open: [] as FullDayRow[], newlyHeld, settled: settled.length };
  });
}

/**
 * Read only, for a month about to close, under its lock: the days the fix
 * would correct there now. The close refuses while any is left (the fix just
 * before it failed, or a day was restored since).
 */
export async function fullDaysToCorrect(company: Company, month: string, opts: { releasedAt?: Date } = {}) {
  const { orgId } = company;
  const release = await releasedAt(opts.releasedAt);
  if (!release) return [];
  const rows = await scan(orgId, release, { month });
  if (!rows.length) return [];
  const facts = await rulesFor(orgId, rows);
  const holdOf = await classifier(orgId);
  const out: Rec[] = [];
  for (const r of rows) if ((await eligible(orgId, r, facts.rule(r), facts.leave(r), facts.place(r))) && !holdOf(r.employeeId, r.date)) out.push(r);
  return out;
}

/* Held days someone can mark paid: a pay run took them, a closed month holds them, or they fall before the last pay run. */
const PAYABLE: HeldReason[] = ['PAYROLL_TAKEN', 'BEFORE_PAYROLL', 'MONTH_CLOSED'];

/** Mark held days settled: someone paid the difference. Returns how many changed. A team lead only for their own team. */
export async function settleFullDays(orgId: string, ids: string[], userId: string, note: string | null, onlyEmployees?: string[]) {
  const r = await peoplePrisma.attendanceFullDayReview.updateMany({
    where: { orgId, id: { in: ids }, outcome: 'HELD', settledAt: null, reason: { in: PAYABLE }, ...(onlyEmployees ? { employeeId: { in: onlyEmployees } } : {}) },
    data: { settledAs: 'PAID', settledByUserId: userId, settledAt: new Date(), note },
  });
  return r.count;
}

/** Undo "Paid the difference": the days are held again. Only days marked paid; a team lead only for their own team. */
export async function unsettleFullDays(orgId: string, ids: string[], onlyEmployees?: string[]) {
  const r = await peoplePrisma.attendanceFullDayReview.updateMany({
    where: { orgId, id: { in: ids }, outcome: 'HELD', settledAs: 'PAID', ...(onlyEmployees ? { employeeId: { in: onlyEmployees } } : {}) },
    data: { settledAs: null, settledByUserId: null, settledAt: null, note: null },
  });
  return r.count;
}

/** Every company with Attendance on, once. Logs counts, and each held day only the first time it is held for that reason. */
export async function fixFullDaysEverywhere() {
  const orgs = await outsideTenant('full-day fix: every company', () => platformPrisma.org.findMany({ select: { id: true, accountId: true } }));
  const totals = { companies: 0, corrected: 0, held: 0, newlyHeld: 0 };
  for (const o of orgs) {
    if (currentLease()?.signal.aborted) break;
    try {
      if (!(await isFeatureEnabled(o.accountId, o.id, 'attendance'))) continue;
      const { corrected, held, newlyHeld } = await fixFullDays({ accountId: o.accountId, orgId: o.id });
      if (!corrected.length && !newlyHeld.length) continue;
      totals.companies += 1;
      totals.corrected += corrected.length;
      totals.held += held.length;
      totals.newlyHeld += newlyHeld.length;
      console.log(`[full-day] ${o.id}: ${corrected.length} day(s) set to present, ${newlyHeld.length} newly held`); // eslint-disable-line no-console
      for (const h of newlyHeld) console.log(`[full-day] ${o.id} held ${h.held}: employee ${h.employeeId} ${h.date} ${h.from} -> ${h.to} (${h.workedMinutes} min)`); // eslint-disable-line no-console
    } catch (e) {
      console.error(`[full-day] ${o.id}:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
    }
  }
  return totals;
}

/** For tests: make the next route-run fix fail, to prove a failure never fails the request. */
export const fullDayFixTesting = { failNext: false };

/** The fix for one company from a route (a month reopened or about to close): never fails the request. */
export async function fixFullDaysQuietly(company: Company) {
  try {
    if (fullDayFixTesting.failNext) {
      fullDayFixTesting.failNext = false;
      throw new Error('full-day fix failed (test)');
    }
    return await fixFullDays(company);
  } catch (e) {
    console.error(`[full-day] ${company.orgId}:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
    return null;
  }
}

export function startFullDayFix({ delayMs = 120_000, intervalMs = 24 * 3_600_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () =>
    exclusive('attendance.fullDayFix', leaseFor(intervalMs), async () => {
      console.log('[full-day] fix:', JSON.stringify(await fixFullDaysEverywhere())); // eslint-disable-line no-console
    }, { idempotent: true }).catch((e) => console.error('[full-day] fix failed:', e instanceof Error ? e.message : e)); // eslint-disable-line no-console
  registerJob('startFullDayFix', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, delayMs);
  t.unref?.();
  return () => clearTimeout(t);
}
