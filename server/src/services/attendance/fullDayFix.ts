import { peoplePrisma, peopleWrite, afterPeopleCommit } from '../../utils/peoplePrisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { registerJob } from '../jobRegistry.js';
import { fullDayNeeded, istTime, type ShiftRule } from './compute.js';
import { FINAL_RUN, MonthClosedError, PayrollTakenError, assertMonthOpen } from './days.js';
import { logDayChange } from './history.js';
import { halfOn } from './leaveHalves.js';
import { loadSchedule, resolveShift } from './schedule.js';
import { emit as emitWebhook } from './webhooks.js';

/**
 * Days already written under the old full-day rule (audit 7 Nov 2026, P0).
 *
 * Before the fix a day was PRESENT only at `fullDayMinutes` (480 by default),
 * so someone in within the late grace, or anyone on a shift shorter than
 * eight hours net, got a HALF_DAY (or ABSENT) for a day worked as scheduled.
 * compute.ts now measures against the shift itself (`fullDayNeeded`), and
 * every new write uses it. This finds the days written before:
 *
 *   both punches, stored HALF_DAY or ABSENT, worked minutes short of the
 *   shift's `fullDayMinutes` (so the old rule decided it) but at least
 *   `fullDayNeeded` (so the new rule makes it PRESENT).
 *
 * The only possible change is to PRESENT: worked, late, early-out and
 * overtime minutes are the same under both rules, so only the status moves,
 * and never against the employee.
 *
 * - In an open month that no final pay run (approved, locked, paid, posted)
 *   has taken, the day is set to PRESENT, with a history entry and the day
 *   webhook, as any other write. A draft pay run picks it up when recalculated.
 * - In a closed Attendance month, or a day a final pay run took, the day is
 *   never changed. It is listed instead (employee, date, old → new), on
 *   People → Data health and in the job's log, so the owner can pay the
 *   difference as a payroll adjustment, or reopen the month.
 *
 * Days on a rest day (HOLIDAY / WEEKLY_OFF) are left: both are paid either
 * way. Days with a half-day leave are decided by the half-day rule, which did
 * not change; hourly leave counts its hours, as days.ts writeDay does.
 *
 * Idempotent: a fixed day no longer matches, so running again changes
 * nothing. Run once shortly after boot and daily after (a month reopened
 * later has its days fixed then), on one instance under a lease.
 */

export type FullDayHeld = 'MONTH_CLOSED' | 'PAYROLL_TAKEN';
export type FullDayRow = {
  recordId: string;
  employeeId: string;
  date: string;
  from: string;
  to: 'PRESENT';
  workedMinutes: number;
  neededMinutes: number;
  held: FullDayHeld | null;
};

type Company = { accountId: string; orgId: string };

/** Which days a final pay run has taken, worked out with three queries rather than three per day (days.ts payrollTaken, batched). */
async function payrollTakenLookup(orgId: string) {
  const runs = await payrollPrisma.payrollRun.findMany({ where: { orgId, status: { in: FINAL_RUN } }, select: { id: true, periodId: true, provisionalDays: true } });
  if (!runs.length) return () => false;
  const [periods, members] = await Promise.all([
    payrollPrisma.payrollPeriod.findMany({ where: { orgId, id: { in: [...new Set(runs.map((r) => r.periodId))] } }, select: { id: true, startDate: true, endDate: true } }),
    payrollPrisma.payrollRunEmployee.findMany({ where: { orgId, runId: { in: runs.map((r) => r.id) }, inclusion: 'INCLUDED' }, select: { runId: true, employeeId: true } }),
  ]);
  const periodOf = new Map(periods.map((p) => [p.id, p]));
  const inRun = new Set(members.map((m) => `${m.runId}|${m.employeeId}`));
  return (employeeId: string, date: string) =>
    runs.some((r) => {
      const p = periodOf.get(r.periodId);
      if (!p || p.startDate > date || p.endDate < date) return false;
      /* A day after the run's cut-off was assumed present, not taken (payrollTaken). */
      const cutoff = (r.provisionalDays as { cutoffDate?: string } | null)?.cutoffDate;
      if (cutoff && date > cutoff) return false;
      return inRun.has(`${r.id}|${employeeId}`);
    });
}

/** The days the old rule scored short that the new rule makes present, each marked open or held. Read only; call inside the company's scope. */
export async function fullDayDays({ accountId, orgId }: Company): Promise<FullDayRow[]> {
  const records = await peoplePrisma.attendanceRecord.findMany({
    where: { accountId, orgId, status: { in: ['HALF_DAY', 'ABSENT'] }, checkIn: { not: null }, checkOut: { not: null } },
    select: { id: true, employeeId: true, date: true, shiftId: true, status: true, workedMinutes: true, leaveRequestId: true },
    orderBy: [{ date: 'asc' }, { employeeId: 'asc' }],
  });
  if (!records.length) return [];
  const schedule = await loadSchedule(orgId, [...new Set(records.map((r) => r.employeeId))]);
  const leaveIds = [...new Set(records.map((r) => r.leaveRequestId).filter((x): x is string => Boolean(x)))];
  const leaves = new Map(
    leaveIds.length
      ? (await peoplePrisma.leaveRequest.findMany({ where: { orgId, id: { in: leaveIds } }, select: { id: true, fromDate: true, toDate: true, halfDay: true, minutes: true } })).map((l) => [l.id, l])
      : [],
  );
  const out: FullDayRow[] = [];
  for (const r of records) {
    /* The shift the day was scored on; a day with none was on the schedule's rule for that date. */
    const rule: ShiftRule = (r.shiftId && schedule.shifts.get(r.shiftId)?.rule) || resolveShift(schedule, r.employeeId, r.date).rule;
    const leave = r.leaveRequestId ? leaves.get(r.leaveRequestId) : null;
    if (leave && halfOn(leave as any, r.date)) continue;
    const counted = (r.workedMinutes || 0) + (leave?.minutes || 0);
    const needed = fullDayNeeded(rule);
    if (counted >= rule.fullDayMinutes || counted < needed) continue;
    out.push({ recordId: r.id, employeeId: r.employeeId, date: r.date, from: r.status, to: 'PRESENT', workedMinutes: counted, neededMinutes: needed, held: null });
  }
  if (!out.length) return out;
  const closed = new Set((await peoplePrisma.attendanceMonthLock.findMany({ where: { orgId }, select: { month: true } })).map((l) => l.month));
  const taken = await payrollTakenLookup(orgId);
  for (const row of out) row.held = closed.has(row.date.slice(0, 7)) ? 'MONTH_CLOSED' : taken(row.employeeId, row.date) ? 'PAYROLL_TAKEN' : null;
  return out;
}

const REASON = 'Full-day rule fix (7 Nov 2026): the shift worked as scheduled, within its grace, is a full day.';

/**
 * One company: set the open days to PRESENT and return what was fixed and what
 * was held. Each day is re-checked under the company's write lock (month still
 * open, no final run, record unchanged since it was read), so a month closed
 * or a day rewritten meanwhile is not touched.
 */
export async function fixFullDays(company: Company, opts: { apply?: boolean } = { apply: true }) {
  const { accountId, orgId } = company;
  return runInTenant(orgId, async () => {
    const rows = await fullDayDays(company);
    const fixed: FullDayRow[] = [];
    const held: FullDayRow[] = rows.filter((r) => r.held);
    if (opts.apply) {
      for (const row of rows.filter((r) => !r.held)) {
        try {
          const done = await peopleWrite(orgId, async () => {
            await assertMonthOpen(orgId, row.date, row.employeeId);
            const before = await peoplePrisma.attendanceRecord.findFirst({ where: { id: row.recordId, orgId, status: row.from } });
            if (!before) return false;
            /* Only while it still says what was read: a day rewritten since was scored by the new rule already. */
            const changed = await peoplePrisma.attendanceRecord.updateMany({ where: { id: row.recordId, orgId, status: row.from, updatedAt: before.updatedAt }, data: { status: 'PRESENT' } });
            if (!changed.count) return false;
            const after = { ...before, status: 'PRESENT' };
            await logDayChange({ accountId, orgId, employeeId: before.employeeId, date: before.date, recordId: before.id, action: 'BULK', before, after, userId: 'system', reason: REASON });
            afterPeopleCommit(() => emitWebhook(orgId, 'day', {
              employeeId: before.employeeId,
              date: before.date,
              status: 'PRESENT',
              checkIn: before.checkIn ? istTime(before.checkIn) : null,
              checkOut: before.checkOut ? istTime(before.checkOut) : null,
              workedMinutes: before.workedMinutes,
              lateMinutes: before.lateMinutes,
              earlyOutMinutes: before.earlyOutMinutes,
              overtimeMinutes: before.overtimeMinutes,
              source: before.source,
            }));
            return true;
          });
          if (done) fixed.push(row);
        } catch (e) {
          /* Closed, or taken by a pay run, between the read and the write: held, never changed. */
          if (e instanceof MonthClosedError) held.push({ ...row, held: 'MONTH_CLOSED' });
          else if (e instanceof PayrollTakenError) held.push({ ...row, held: 'PAYROLL_TAKEN' });
          else throw e;
        }
      }
    }
    return { fixed, held, open: rows.filter((r) => !r.held).length };
  });
}

/** Every company, once. Logs per company what was fixed and, by id, what was held for the owner (employee, date, old → new). */
export async function fixFullDaysEverywhere(opts: { apply?: boolean } = { apply: true }) {
  const orgs = await outsideTenant('full-day fix: every company', () => platformPrisma.org.findMany({ select: { id: true, accountId: true } }));
  const totals = { companies: 0, fixed: 0, held: 0 };
  for (const o of orgs) {
    try {
      const { fixed, held } = await fixFullDays({ accountId: o.accountId, orgId: o.id }, opts);
      if (!fixed.length && !held.length) continue;
      totals.companies += 1;
      totals.fixed += fixed.length;
      totals.held += held.length;
      console.log(`[full-day] ${o.id}: ${fixed.length} day(s) set to present, ${held.length} held`); // eslint-disable-line no-console
      for (const h of held) console.log(`[full-day] ${o.id} held ${h.held}: employee ${h.employeeId} ${h.date} ${h.from} -> ${h.to} (${h.workedMinutes} of ${h.neededMinutes} min)`); // eslint-disable-line no-console
    } catch (e) {
      console.error(`[full-day] ${o.id}:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
    }
  }
  return totals;
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
