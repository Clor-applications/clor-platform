import type { Prisma } from '../../generated/people/index.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { type Actor, diffEmployee, writeChangeLog } from './changeLog.js';
import { writeEvent } from './outbox.js';
import { ensureFirstEpisode } from './episodes.js';
import { recordChanges, recordJoined, TRACKED } from './employmentHistory.js';

/**
 * The one way a person is created or changed (docs/people/02-PRD.md FND-08).
 *
 * The employee form, the import and "Hire" all come through here, so each
 * leaves the same change log lines, the same stint, the same history and the
 * same outbox event. The row, its change log and its event are written in
 * one transaction; history (employmentHistory.ts) is written after, as it
 * always was, and never undoes the change it records.
 */

type Row = Prisma.EmployeeGetPayload<Record<string, never>>;

const JOB_FIELDS = new Set(Object.keys(TRACKED));

/** The summary other apps get: enough to find and place the person, nothing personal. */
export const employeeSummary = (e: Row) => ({
  id: e.id,
  code: e.code,
  name: e.name,
  status: e.status,
  dateOfJoining: e.dateOfJoining,
  firstJoiningDate: e.firstJoiningDate,
  currentEpisodeSeq: e.currentEpisodeSeq,
  departmentId: e.departmentId,
  jobPositionId: e.jobPositionId,
  reportingManagerId: e.reportingManagerId,
  areaId: e.areaId,
  branchId: e.branchId,
  employeeTypeId: e.employeeTypeId,
  contractorId: e.contractorId,
  establishmentId: e.establishmentId,
});

export async function createEmployee(actor: Actor, data: Prisma.EmployeeUncheckedCreateInput, opts: { afterWrite?: (tx: Prisma.TransactionClient, row: Row) => Promise<void> } = {}): Promise<Row> {
  const row = await peoplePrisma.$transaction(async (tx) => {
    const created = await tx.employee.create({ data: { ...data, firstJoiningDate: data.firstJoiningDate ?? data.dateOfJoining ?? null } });
    await ensureFirstEpisode(actor, created, tx);
    await writeChangeLog(tx, actor, { kind: 'Employee', id: created.id, employeeId: created.id }, [{ field: 'record', before: null, after: 'created', redacted: false }]);
    await writeEvent(tx, actor, 'people.employee.created.v1', employeeSummary(created), created.id);
    if (opts.afterWrite) await opts.afterWrite(tx, created);
    return created;
  });
  await recordJoined({ accountId: actor.accountId, orgId: actor.orgId, userId: actor.userId }, row, actor.source === 'IMPORT' ? 'IMPORT' : 'FORM');
  return row;
}

export async function updateEmployee(
  actor: Actor,
  existing: Row,
  data: Prisma.EmployeeUncheckedUpdateInput,
  opts: { effectiveDate?: string | null; afterWrite?: (tx: Prisma.TransactionClient, row: Row) => Promise<void> } = {},
): Promise<{ row: Row; changes: ReturnType<typeof diffEmployee> }> {
  const result = await peoplePrisma.$transaction(async (tx) => {
    const updated = await tx.employee.update({ where: { id: existing.id }, data });
    const changes = diffEmployee(existing as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
    await writeChangeLog(tx, actor, { kind: 'Employee', id: updated.id, employeeId: updated.id }, changes);
    const job = changes.filter((c) => JOB_FIELDS.has(c.field));
    for (const c of job) {
      await writeEvent(tx, actor, 'people.employment.changed.v1', { field: c.field, before: c.before, after: c.after, effectiveOn: opts.effectiveDate || new Date().toISOString().slice(0, 10), employee: employeeSummary(updated) }, updated.id);
    }
    if (job.some((c) => c.field === 'areaId' || c.field === 'branchId' || c.field === 'establishmentId')) {
      const est = job.find((c) => c.field === 'establishmentId');
      const states = est ? await tx.establishment.findMany({ where: { orgId: actor.orgId, id: { in: [est.before, est.after].filter(Boolean) as string[] } }, select: { id: true, state: true } }) : [];
      const stateOf = (id: string | null) => states.find((x) => x.id === id)?.state ?? null;
      await writeEvent(tx, actor, 'people.employee.transferred.v1', {
        fields: job.map((c) => c.field), effectiveOn: opts.effectiveDate || new Date().toISOString().slice(0, 10), employee: employeeSummary(updated),
        fromEstablishmentId: est?.before ?? null, toEstablishmentId: est?.after ?? null, fromState: stateOf(est?.before ?? null), toState: stateOf(est?.after ?? null),
      }, updated.id);
    }
    if (changes.length && changes.length !== job.length) {
      await writeEvent(tx, actor, 'people.employee.updated.v1', { fields: changes.filter((c) => !JOB_FIELDS.has(c.field)).map((c) => c.field), employee: employeeSummary(updated) }, updated.id);
    }
    if (opts.afterWrite) await opts.afterWrite(tx, updated);
    return { row: updated, changes };
  });
  await recordChanges({ accountId: actor.accountId, orgId: actor.orgId, userId: actor.userId }, existing, result.row, {
    source: actor.source === 'IMPORT' ? 'IMPORT' : actor.source === 'SCHEDULED' || actor.source === 'APPROVAL' ? 'TRANSFER' : 'FORM',
    effectiveDate: opts.effectiveDate ?? null,
    note: actor.reason ?? null,
  });
  return result;
}

/** The correlation id for a request: the request id the log middleware gave it, or a fresh one. */
export const correlationOf = (req: { id?: unknown } & Record<string, unknown>): string => String((req as any).id || `corr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
