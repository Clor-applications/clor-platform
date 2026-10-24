import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { outsideTenant, runInTenant } from '../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../jobLease.js';
import type { Actor } from './changeLog.js';
import { updateEmployee } from './employees.js';
import { TRACKED } from './employmentHistory.js';

/**
 * Effective-dated changes (docs/people/02-PRD.md FND-02, FND-03).
 *
 * A change to where or how someone works may be dated in the future. It is
 * stored as a ScheduledChange, shown on the record as "Changes on <date>",
 * and applied on that day by the job below, once: the job's run id is
 * written on the row, so a second run of the same day is a no-op. Applying
 * goes through the one write path (employees.ts), so it leaves the same
 * change log, history and event as a change made by hand.
 *
 * Reading "as of" a past date rolls the job fields back through the
 * history (EmploymentEvent carries from and to for each change), so the
 * directory, the org chart and a profile can be read as they were.
 */

/** Fields a change may be dated for: the job fields history tracks, plus status. */
export const SCHEDULABLE_FIELDS = new Set([...Object.keys(TRACKED), 'establishmentId', 'status']);

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The name behind an id, for the labels a scheduled change shows. */
async function labelFor(orgId: string, field: string, value: string | null): Promise<string | null> {
  if (!value) return null;
  const by = { where: { id: value, orgId }, select: { name: true } } as const;
  switch (field) {
    case 'departmentId': return (await peoplePrisma.department.findFirst(by))?.name ?? value;
    case 'jobPositionId': return (await peoplePrisma.jobPosition.findFirst(by))?.name ?? value;
    case 'jobRoleId': return (await peoplePrisma.jobRole.findFirst(by))?.name ?? value;
    case 'areaId': return (await peoplePrisma.area.findFirst(by))?.name ?? value;
    case 'establishmentId': return (await peoplePrisma.establishment.findFirst(by))?.name ?? value;
    case 'reportingManagerId': return (await peoplePrisma.employee.findFirst(by))?.name ?? value;
    case 'employeeTypeId': return (await peoplePrisma.employeeType.findFirst(by))?.name ?? value;
    case 'workTypeId': return (await peoplePrisma.workType.findFirst(by))?.name ?? value;
    case 'gradeId': return (await peoplePrisma.grade.findFirst(by))?.name ?? value;
    case 'costCenterId': return (await peoplePrisma.costCenter.findFirst(by))?.name ?? value;
    case 'businessUnitId': return (await peoplePrisma.businessUnit.findFirst(by))?.name ?? value;
    case 'contractorId': return (await peoplePrisma.contractor.findFirst(by))?.name ?? value;
    default: return value;
  }
}

/** Store the changes for a future date instead of applying them. One row per field. */
export async function scheduleChanges(actor: Actor, employee: { id: string } & Record<string, unknown>, fields: Record<string, string | null>, effectiveOn: string) {
  const rows = [];
  for (const [field, toValue] of Object.entries(fields)) {
    if (!SCHEDULABLE_FIELDS.has(field)) continue;
    const fromValue = (employee[field] as string | null | undefined) ?? null;
    if (fromValue === toValue) continue;
    /* One pending change per field per date: sending the form twice does not queue it twice. */
    const existing = await peoplePrisma.scheduledChange.findFirst({ where: { orgId: actor.orgId, employeeId: employee.id, field, effectiveOn, status: 'PENDING' } });
    const data = {
      accountId: actor.accountId, orgId: actor.orgId, employeeId: employee.id, field, fromValue, toValue,
      fromLabel: await labelFor(actor.orgId, field, fromValue), toLabel: await labelFor(actor.orgId, field, toValue),
      /* The same form sent again without its note keeps the note it had. */
      effectiveOn, reason: actor.reason ?? existing?.reason ?? null, requestId: actor.requestId ?? existing?.requestId ?? null, requestedByUserId: actor.userId, correlationId: actor.correlationId,
    };
    rows.push(existing ? await peoplePrisma.scheduledChange.update({ where: { id: existing.id }, data }) : await peoplePrisma.scheduledChange.create({ data }));
  }
  return rows;
}

export const pendingChangesOf = (orgId: string, employeeId: string) =>
  peoplePrisma.scheduledChange.findMany({ where: { orgId, employeeId, status: 'PENDING' }, orderBy: [{ effectiveOn: 'asc' }, { createdAt: 'asc' }] });

export async function cancelScheduledChange(orgId: string, id: string) {
  const r = await peoplePrisma.scheduledChange.updateMany({ where: { id, orgId, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  return r.count === 1;
}

/**
 * Apply every pending change whose date has come, grouped per person so one
 * date's changes land as one write. Idempotent: a row is claimed with the run
 * id before it is applied, and only the claimer applies it.
 */
export async function applyDueChanges(today = todayIst(), runId = `run_${Date.now().toString(36)}`) {
  const due = await outsideTenant('job: scheduled changes', () =>
    peoplePrisma.scheduledChange.findMany({ where: { status: 'PENDING', effectiveOn: { lte: today } }, orderBy: [{ effectiveOn: 'asc' }, { createdAt: 'asc' }] }),
  );
  const byPerson = new Map<string, typeof due>();
  for (const r of due) byPerson.set(`${r.orgId}:${r.employeeId}`, [...(byPerson.get(`${r.orgId}:${r.employeeId}`) || []), r]);
  let applied = 0;
  let skipped = 0;
  for (const rows of byPerson.values()) {
    const { orgId, accountId, employeeId } = rows[0];
    await runInTenant(orgId, async () => {
      const claimed = await peoplePrisma.scheduledChange.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: 'PENDING' }, data: { status: 'APPLIED', appliedAt: new Date(), appliedRunId: runId } });
      if (!claimed.count) {
        skipped += rows.length;
        return;
      }
      const mine = await peoplePrisma.scheduledChange.findMany({ where: { id: { in: rows.map((r) => r.id) }, appliedRunId: runId } });
      const existing = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId } });
      if (!existing) return;
      const data: Record<string, string | null> = {};
      for (const c of mine) data[c.field] = c.toValue;
      if (data.departmentId !== undefined) data.department = (await labelFor(orgId, 'departmentId', data.departmentId)) ?? null;
      if (data.jobPositionId !== undefined) data.designation = (await labelFor(orgId, 'jobPositionId', data.jobPositionId)) ?? null;
      const actor: Actor = { accountId, orgId, userId: mine[0].requestedByUserId, source: 'SCHEDULED', correlationId: mine[0].correlationId, reason: mine[0].reason, requestId: mine[0].requestId };
      await updateEmployee(actor, existing, data as any, { effectiveDate: mine[0].effectiveOn });
      applied += mine.length;
    });
  }
  return { due: due.length, applied, skipped };
}

/** Every ten minutes, under a lease. */
export function startScheduledChanges({ intervalMs = 10 * 60_000, startupDelayMs = 30_000 } = {}) {
  if (String(process.env.PEOPLE_SCHEDULED_CHANGES || '').toLowerCase() === 'off') return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await exclusive('people.scheduled-changes', leaseFor(intervalMs), () => applyDueChanges());
      // eslint-disable-next-line no-console
      if (r && r.applied) console.log(`[people-scheduled] applied ${r.applied} change(s)`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[people-scheduled] run failed:', e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const startup = setTimeout(tick, startupDelayMs);
  const timer = setInterval(tick, intervalMs);
  startup.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(startup);
    clearInterval(timer);
  };
}

/**
 * The job fields as they were on a date, from the history: a change that took
 * effect after the date is undone (its "from" put back), someone who joined
 * after it is left out, and someone who left after it is shown as they were.
 */
export async function asOf<T extends { id: string; status: string; dateOfJoining?: string | null; [k: string]: unknown }>(orgId: string, rows: T[], date: string): Promise<T[]> {
  if (!ISO_DAY.test(date) || !rows.length) return rows;
  const events = await peoplePrisma.employmentEvent.findMany({
    where: { orgId, employeeId: { in: rows.map((r) => r.id) }, effectiveDate: { gt: date } },
    orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
  });
  const byEmployee = new Map<string, typeof events>();
  for (const e of events) byEmployee.set(e.employeeId, [...(byEmployee.get(e.employeeId) || []), e]);
  const out: T[] = [];
  for (const row of rows) {
    const mine = byEmployee.get(row.id) || [];
    if (mine.some((e) => e.kind === 'JOINED')) continue;
    if (row.dateOfJoining && row.dateOfJoining > date && !mine.length) continue;
    const view: Record<string, unknown> = { ...row, asOf: date };
    for (const e of mine) {
      if (e.kind === 'LEFT') { view.status = 'ACTIVE'; view.dateOfLeaving = null; }
      else if (e.kind === 'REHIRED') { view.status = 'LEFT'; }
      else if (e.field) {
        view[e.field] = e.fromId;
        if (e.field === 'departmentId') view.department = e.fromLabel;
        if (e.field === 'jobPositionId') view.designation = e.fromLabel;
      }
    }
    out.push(view as T);
  }
  return out;
}
