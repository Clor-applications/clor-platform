import { peoplePrisma, peopleWrite, afterPeopleCommit } from '../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { todayIst } from '../../utils/istDate.js';
import { isFeatureEnabled } from '../features.js';
import { currentLease, exclusive, leaseFor } from '../jobLease.js';
import { registerJob } from '../jobRegistry.js';
import { computeDay, istTime, type ShiftRule } from './compute.js';
import { FINAL_RUN, MonthClosedError, PayrollTakenError, assertMonthOpen } from './days.js';
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
 * write uses it. This weighs the days written before: both punches, stored
 * HALF_DAY or ABSENT, scored the same minutes today, and PRESENT under the
 * rule now. The only change is to PRESENT; the minutes stay as they are.
 *
 * Which of those days change, and which are only listed ("held"):
 * - MONTH_CLOSED: a closed Attendance month. Never changed.
 * - PAYROLL_TAKEN: an approved, locked, paid or posted pay run took the day
 *   for this person. Never changed; paid as a Payroll adjustment.
 * - PAYROLL_PENDING: a pay run still being worked on (draft, calculated, in
 *   review) has already pulled this person's days for the period. Not
 *   changed under it: the owner saves the day again and pulls the days again.
 * - BEFORE_PAYROLL: on or before the end of the latest final pay run's
 *   period for this person (or, if none paid them, for the company).
 * - OLD: the company has no final pay run, and the day is before last month.
 * Everything after that is corrected: set to PRESENT, made to need
 * validating again, with a history entry and the day webhook. Each one is
 * re-checked under the company's write lock (month open, no final run, the
 * record unchanged since it was read, still eligible on the row as it is).
 *
 * What was corrected and what was held is kept (AttendanceFullDayReview), so
 * the owner sees both on Data health, a day is never weighed twice, and the
 * log names a held day once. Held days are looked at again on each run: a
 * month reopened or a run deleted lets them be corrected; a day saved again
 * since is settled as RECORD_CHANGED; someone can mark one PAID.
 *
 * Rest days (HOLIDAY / WEEKLY_OFF) are not touched: paid either way. Days
 * with a half-day leave are left: the half-day rule did not change.
 *
 * Runs once shortly after boot and daily after, on one instance under a
 * lease; also for a company right after a month is reopened, and before a
 * month is closed (routes/attendance.ts), so no window is left between them.
 */

export type HeldReason = 'MONTH_CLOSED' | 'PAYROLL_TAKEN' | 'PAYROLL_PENDING' | 'BEFORE_PAYROLL' | 'OLD';
export type FullDayRow = {
  recordId: string;
  employeeId: string;
  date: string;
  from: string;
  to: 'PRESENT';
  workedMinutes: number;
  updatedAt: Date;
  held: HeldReason | null;
};
type Company = { accountId: string; orgId: string };
type Rec = { id: string; employeeId: string; date: string; shiftId: string | null; status: string; workedMinutes: number; leaveRequestId: string | null; checkIn: Date | null; checkOut: Date | null; updatedAt: Date };

const PENDING_RUN = ['DRAFT', 'CALCULATED', 'REVIEW'];
const SCANNED = 'SCANNED';
const select = { id: true, employeeId: true, date: true, shiftId: true, status: true, workedMinutes: true, leaveRequestId: true, checkIn: true, checkOut: true, updatedAt: true } as const;

/** First day of last month, India's calendar: with no final pay run, only this month and last are corrected. */
const lastMonthStart = () => {
  const [y, m] = todayIst().split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
};

/** Is this day one the rule now makes PRESENT, as the row stands? */
function eligible(r: Rec, rule: ShiftRule, leave: { fromDate: string; toDate: string; halfDay: string | null; minutes: number | null } | null | undefined) {
  if (!['HALF_DAY', 'ABSENT'].includes(r.status) || !r.checkIn || !r.checkOut) return false;
  if (leave && halfOn(leave as any, r.date)) return false;
  if ((r.workedMinutes || 0) + (leave?.minutes || 0) >= rule.fullDayMinutes) return false;
  try {
    const now = computeDay({ date: r.date, shift: rule, checkIn: r.checkIn, checkOut: r.checkOut });
    /* Scored the same minutes as when written; otherwise the shift changed since, and a recalculation is the owner's call. */
    return now.workedMinutes === r.workedMinutes && now.status === 'PRESENT';
  } catch {
    return false;
  }
}

/** The pay-run facts every day of a company is weighed against: three or four queries, not three per day. */
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
  /* The end of the latest final period, for the person and for the company. */
  const lastEnd = new Map<string, string>();
  let companyEnd: string | null = null;
  for (const r of final) {
    const end = periodOf.get(r.periodId)?.endDate;
    if (!end) continue;
    if (!companyEnd || end > companyEnd) companyEnd = end;
    for (const m of members) if (m.runId === r.id && (!lastEnd.get(m.employeeId) || end > lastEnd.get(m.employeeId)!)) lastEnd.set(m.employeeId, end);
  }
  return {
    /* Every final run of the period, as days.ts payrollTaken; a day after a run's cut-off was assumed, not taken. */
    taken: (employeeId: string, date: string) =>
      final.some((r) => {
        const cutoff = (r.provisionalDays as { cutoffDate?: string } | null)?.cutoffDate;
        return covers(r, date) && !(cutoff && date > cutoff) && inRun.has(`${r.id}|${employeeId}`);
      }),
    pending: (employeeId: string, date: string) => pending.some((r) => covers(r, date) && pulledFor.has(`${r.id}|${employeeId}`)),
    cutoff: (employeeId: string) => lastEnd.get(employeeId) || companyEnd,
    anyFinal: final.length > 0,
  };
}

async function classifier(orgId: string) {
  const [locks, pay] = await Promise.all([peoplePrisma.attendanceMonthLock.findMany({ where: { orgId }, select: { month: true } }), payrollFacts(orgId)]);
  const closed = new Set(locks.map((l) => l.month));
  const oldBefore = lastMonthStart();
  return (employeeId: string, date: string): HeldReason | null => {
    if (closed.has(date.slice(0, 7))) return 'MONTH_CLOSED';
    if (pay.taken(employeeId, date)) return 'PAYROLL_TAKEN';
    if (pay.pending(employeeId, date)) return 'PAYROLL_PENDING';
    if (pay.anyFinal) {
      const cut = pay.cutoff(employeeId);
      if (cut && date <= cut) return 'BEFORE_PAYROLL';
    } else if (date < oldBefore) return 'OLD';
    return null;
  };
}

async function rulesFor(orgId: string, rows: Rec[]) {
  const schedule = await loadSchedule(orgId, [...new Set(rows.map((r) => r.employeeId))]);
  const leaveIds = [...new Set(rows.map((r) => r.leaveRequestId).filter((x): x is string => Boolean(x)))];
  const leaves = new Map(
    leaveIds.length ? (await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: leaveIds } }, select: { id: true, fromDate: true, toDate: true, halfDay: true, minutes: true } })).map((l) => [l.id, l]) : [],
  );
  return {
    /* The shift the day was scored on; a day with none was on the schedule's rule for that date. */
    rule: (r: Rec): ShiftRule => (r.shiftId && schedule.shifts.get(r.shiftId)?.rule) || resolveShift(schedule, r.employeeId, r.date).rule,
    leave: (r: Rec) => (r.leaveRequestId ? leaves.get(r.leaveRequestId) : null),
  };
}

const REASON = 'Full-day rule fix (7 Nov 2026): the shift worked as scheduled, within its grace, is a full day. The day needs validating again.';

/** Correct one day under the company's write lock, re-checking it on the row as it is now. */
async function correct(company: Company, row: FullDayRow): Promise<'CORRECTED' | 'CHANGED' | HeldReason> {
  const { accountId, orgId } = company;
  try {
    return await peopleWrite(orgId, async () => {
      await assertMonthOpen(orgId, row.date, row.employeeId);
      const rec = (await peoplePrisma.attendanceRecord.findFirst({ where: { id: row.recordId, orgId }, select: { ...select, lateMinutes: true, earlyOutMinutes: true, overtimeMinutes: true, source: true, validated: true, overtimeApproved: true, note: true } })) as any;
      /* Rewritten since it was read: it was scored by the rule as it is now. */
      if (!rec || rec.updatedAt.getTime() !== row.updatedAt.getTime()) return 'CHANGED';
      const facts = await rulesFor(orgId, [rec]);
      if (!eligible(rec, facts.rule(rec), facts.leave(rec))) return 'CHANGED';
      /* A pay run that pulled this person's days in the meantime: not changed under it. */
      if ((await payrollFacts(orgId)).pending(rec.employeeId, rec.date)) return 'PAYROLL_PENDING';
      const changed = await peoplePrisma.attendanceRecord.updateMany({
        where: { id: rec.id, orgId, status: rec.status, updatedAt: rec.updatedAt },
        data: { status: 'PRESENT', validated: false, validatedByUserId: null, validatedAt: null },
      });
      if (!changed.count) return 'CHANGED';
      const after = { ...rec, status: 'PRESENT', validated: false };
      await logDayChange({ accountId, orgId, employeeId: rec.employeeId, date: rec.date, recordId: rec.id, action: 'BULK', before: rec, after, userId: 'system', reason: REASON });
      await peoplePrisma.attendanceFullDayReview.upsert({
        where: { recordId: rec.id },
        create: { accountId, orgId, employeeId: rec.employeeId, date: rec.date, recordId: rec.id, fromStatus: rec.status, toStatus: 'PRESENT', workedMinutes: rec.workedMinutes, outcome: 'CORRECTED' },
        update: { outcome: 'CORRECTED', reason: null, fromStatus: rec.status },
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
 * `beforeCorrect` is for tests: it runs between the scan and the write.
 */
export async function fixFullDays(company: Company, opts: { apply?: boolean; beforeCorrect?: (row: FullDayRow) => Promise<void> } = {}) {
  const { accountId, orgId } = company;
  const apply = opts.apply !== false;
  return runInTenant(orgId, async () => {
    const reviews = await peoplePrisma.attendanceFullDayReview.findMany({ where: { orgId }, select: { id: true, recordId: true, outcome: true, reason: true, settledAt: true, fromStatus: true } });
    const seen = new Map(reviews.map((r) => [r.recordId, r]));
    const scanned = reviews.some((r) => r.outcome === SCANNED);
    /* After the first scan, closed months are left out: their days were weighed then, or just before they closed. */
    const closedMonths = scanned ? (await peoplePrisma.attendanceMonthLock.findMany({ where: { orgId }, select: { month: true } })).map((l) => l.month) : [];
    const fresh = (await peoplePrisma.attendanceRecord.findMany({
      where: {
        orgId,
        status: { in: ['HALF_DAY', 'ABSENT'] },
        checkIn: { not: null },
        checkOut: { not: null },
        ...(closedMonths.length ? { NOT: closedMonths.map((m) => ({ date: { startsWith: m } })) } : {}),
      },
      select,
      orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
    })) as Rec[];
    const heldIds = reviews.filter((r) => r.outcome === 'HELD' && !r.settledAt).map((r) => r.recordId);
    const again = heldIds.length ? ((await peoplePrisma.attendanceRecord.findMany({ where: { orgId, id: { in: heldIds } }, select })) as Rec[]) : [];
    const rows = [...fresh.filter((r) => !seen.has(r.id)), ...again];

    /* A held day saved again since (or deleted) is no longer short: settled, it leaves the list. */
    const stillThere = new Set(again.map((r) => r.id));
    const settled = reviews.filter((r) => r.outcome === 'HELD' && !r.settledAt && (!stillThere.has(r.recordId) || again.find((a) => a.id === r.recordId)!.status !== r.fromStatus));

    const facts = await rulesFor(orgId, rows);
    const holdOf = await classifier(orgId);
    const candidates: FullDayRow[] = [];
    for (const r of rows) {
      if (!eligible(r, facts.rule(r), facts.leave(r))) continue;
      candidates.push({ recordId: r.id, employeeId: r.employeeId, date: r.date, from: r.status, to: 'PRESENT', workedMinutes: r.workedMinutes, updatedAt: r.updatedAt, held: holdOf(r.employeeId, r.date) });
    }
    const corrected: FullDayRow[] = [];
    const held: FullDayRow[] = [];
    const newlyHeld: FullDayRow[] = [];
    if (!apply) return { corrected, held: candidates.filter((c) => c.held), open: candidates.filter((c) => !c.held), newlyHeld, settled: settled.length };

    for (const id of settled.map((s) => s.id)) {
      await peoplePrisma.attendanceFullDayReview.update({ where: { id }, data: { settledAs: 'RECORD_CHANGED', settledAt: new Date() } });
    }
    for (const c of candidates) {
      if (currentLease()?.signal.aborted) break;
      let outcome: 'CORRECTED' | 'CHANGED' | HeldReason | null = c.held;
      if (!outcome) {
        if (opts.beforeCorrect) await opts.beforeCorrect(c);
        outcome = await correct(company, c);
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
        create: { accountId, orgId, employeeId: c.employeeId, date: c.date, recordId: c.recordId, fromStatus: c.from, toStatus: 'PRESENT', workedMinutes: c.workedMinutes, outcome: 'HELD', reason: outcome },
        update: { outcome: 'HELD', reason: outcome },
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

/** Mark held days settled: someone paid the difference (or decided it was right). Returns how many changed. */
export async function settleFullDays(orgId: string, ids: string[], userId: string, note: string | null, onlyEmployees?: string[]) {
  /* Only days paid short (a pay run took them, or a closed month); a team lead only for their own team. */
  const r = await peoplePrisma.attendanceFullDayReview.updateMany({
    where: { orgId, id: { in: ids }, outcome: 'HELD', settledAt: null, reason: { in: ['PAYROLL_TAKEN', 'BEFORE_PAYROLL', 'MONTH_CLOSED'] }, ...(onlyEmployees ? { employeeId: { in: onlyEmployees } } : {}) },
    data: { settledAs: 'PAID', settledByUserId: userId, settledAt: new Date(), note },
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

/** The fix for one company from a route (a month reopened or about to close): never fails the request. */
export async function fixFullDaysQuietly(company: Company) {
  try {
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
