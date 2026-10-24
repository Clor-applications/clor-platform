import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { updateEmployee } from '../employees.js';
import { scheduleChanges } from '../effectiveDating.js';
import { leaveEmployee } from '../lifecycle/leaving.js';
import { applyOutcome } from '../lifecycle/probation.js';
import { registerChangeReviewTasks } from '../lifecycle/changes.js';
import { onApproved, type Payload } from './engine.js';

/**
 * What an approved request does (contract §5.3). Registered once at start-up
 * by the module that owns each request type. Every effect goes through the
 * one write path, so the change log and the outbox see an approved change
 * exactly like one made by hand, with the request id on the lines.
 */

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

let reviewTasksOn = false;
export function registerPeopleEffects() {
  if (!reviewTasksOn) { registerChangeReviewTasks(); reviewTasksOn = true; }
  /* A job or profile change: dated in the future, it waits; otherwise it is applied now. */
  const applyChange = async ({ request, actor }: Parameters<Parameters<typeof onApproved>[1]>[0]) => {
    const p = (request.payload || {}) as Payload & { effectiveOn?: string | null; reason?: string | null; data?: Record<string, unknown> };
    if (!request.subjectEmployeeId) return;
    const existing = await peoplePrisma.employee.findFirst({ where: { id: request.subjectEmployeeId, orgId: request.orgId } });
    if (!existing) return { skipped: 'The person is no longer here.' };
    const fields = Object.fromEntries(Object.entries(p.fields || {}).map(([k, v]) => [k, v.after == null ? null : String(v.after)]));
    const who = { ...actor, reason: p.reason ?? actor.reason ?? null };
    if (p.effectiveOn && p.effectiveOn > todayIst()) {
      const rows = await scheduleChanges(who, existing as any, fields, p.effectiveOn);
      return { scheduled: rows.map((r) => r.id), effectiveOn: p.effectiveOn };
    }
    const data: Record<string, unknown> = { ...fields, ...(p.data || {}) };
    if (fields.departmentId !== undefined) data.department = fields.departmentId ? (await peoplePrisma.department.findFirst({ where: { id: fields.departmentId, orgId: request.orgId }, select: { name: true } }))?.name ?? null : null;
    if (fields.jobPositionId !== undefined) data.designation = fields.jobPositionId ? (await peoplePrisma.jobPosition.findFirst({ where: { id: fields.jobPositionId, orgId: request.orgId }, select: { name: true } }))?.name ?? null : null;
    const { changes } = await updateEmployee(who, existing, data as any, { effectiveDate: p.effectiveOn || null });
    return { applied: changes.map((c) => c.field) };
  };
  onApproved('JOB_CHANGE', applyChange);
  onApproved('PROFILE_CHANGE', applyChange);

  /* Probation: the outcome the request carried, applied as HR would by hand. */
  onApproved('PROBATION', async ({ request, actor }) => {
    const p = (request.payload || {}) as { outcome?: 'CONFIRM' | 'EXTEND' | 'END'; newEndDate?: string | null; note?: string | null; lastDay?: string | null };
    if (!request.subjectEmployeeId || !p.outcome) return;
    return applyOutcome(actor, request.subjectEmployeeId, p.outcome, { newEndDate: p.newEndDate ?? null, note: p.note ?? null, lastDay: p.lastDay ?? null, requestId: request.id });
  });

  /* Leaving: recorded as HR would record it by hand. */
  onApproved('LEAVING', async ({ request, actor }) => {
    const p = (request.payload || {}) as { lastDay?: string; leavingType?: string; reason?: string | null };
    if (!request.subjectEmployeeId || !p.lastDay || !p.leavingType) return;
    const existing = await peoplePrisma.employee.findFirst({ where: { id: request.subjectEmployeeId, orgId: request.orgId } });
    if (!existing || existing.status === 'LEFT') return { skipped: 'Already left.' };
    const r = await leaveEmployee({ accountId: actor.accountId, orgId: actor.orgId, userId: actor.userId }, existing, { lastDay: p.lastDay, leavingType: p.leavingType, reason: p.reason ?? null });
    return { left: true, readers: r.readers };
  });
}
