import type { Prisma } from '../../generated/people/index.js';
import { trackFirst } from '../productEvents.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { type Actor, diffEmployee, writeChangeLog } from './changeLog.js';
import { writeEvent } from './outbox.js';
import { ensureFirstEpisode } from './episodes.js';
import { recordChanges, recordJoined, TRACKED } from './employmentHistory.js';
import { employeeStatusChanged } from '../portalSessions.js';
import type { Actor as CredentialActor } from '../credentials.js';
import { todayIst } from '../../utils/istDate.js';

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
  await firstInStateOf(actor, row);
  void trackFirst(actor.orgId, actor.userId, 'employee_added', { source: actor.source.toLowerCase(), app: 'people' });
  return row;
}

/** First person in a new state: HR's registration task (services/people/organization.ts). Never fails the write. */
async function firstInStateOf(actor: Actor, row: Row) {
  const { firstInState } = await import('./organization.js');
  await firstInState({ accountId: actor.accountId, orgId: actor.orgId, userId: actor.userId }, row as any).catch((e) => console.error('[organization] first in state:', e instanceof Error ? e.message : e));
}

/** The record moved on since the editor loaded it (409 STALE). */
export class StaleEmployeeError extends Error {
  constructor(public current: Row) { super('STALE'); }
}

export async function updateEmployee(
  actor: Actor,
  existing: Row,
  data: Prisma.EmployeeUncheckedUpdateInput,
  opts: { effectiveDate?: string | null; expectedVersion?: number; afterWrite?: (tx: Prisma.TransactionClient, row: Row) => Promise<void> } = {},
): Promise<{ row: Row; changes: ReturnType<typeof diffEmployee> }> {
  /* Moved into a department that works a night shift: a woman needs her consent to night work (people/nightConsent.ts). */
  const toDept = (data as { departmentId?: unknown }).departmentId;
  if (typeof toDept === 'string' && toDept && toDept !== existing.departmentId) {
    const t = todayIst();
    const sched = await peoplePrisma.departmentSchedule.findMany({ where: { orgId: actor.orgId, departmentId: toDept, OR: [{ effectiveTo: null }, { effectiveTo: { gte: t } }] }, select: { shiftId: true } });
    if (sched.length) {
      const { assertNightConsent } = await import('./nightConsent.js');
      await assertNightConsent(actor.orgId, [{ employeeId: existing.id, shiftIds: sched.map((x) => x.shiftId) }]);
    }
  }
  const result = await peoplePrisma.$transaction(async (tx) => {
    /* Every write moves the version on, so an edit made against an older copy is refused (People design v1, 409 STALE). */
    /*
     * Compare against the row as it is now, read under the row lock, not the
     * copy the caller loaded: an approval that applied a change a moment ago
     * (a rule whose only approver is the requester) must not be logged again
     * by the rest of the same form.
     */
    const current = ((await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Employee" WHERE id = ${existing.id} FOR UPDATE`).length
      ? await tx.employee.findUnique({ where: { id: existing.id } })
      : null) || existing;
    /* Checked under the lock: two saves made from the same copy cannot both pass. */
    if (opts.expectedVersion !== undefined && (current as Row).version !== opts.expectedVersion) throw new StaleEmployeeError(current as Row);
    const updated = await tx.employee.update({ where: { id: existing.id }, data: { ...(data as Record<string, unknown>), version: { increment: 1 } } as Prisma.EmployeeUncheckedUpdateInput });
    const changes = diffEmployee(current as unknown as Record<string, unknown>, updated as unknown as Record<string, unknown>);
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
    return { row: updated, changes, before: current as Row };
  });
  /* Employment history compares against the same locked row, or an approval applied a moment ago is recorded twice. */
  await recordChanges({ accountId: actor.accountId, orgId: actor.orgId, userId: actor.userId }, result.before, result.row, {
    source: actor.source === 'IMPORT' ? 'IMPORT' : actor.source === 'SCHEDULED' || actor.source === 'APPROVAL' || actor.source === 'BULK' ? 'TRANSFER' : 'FORM',
    effectiveDate: opts.effectiveDate ?? null,
    note: actor.reason ?? null,
  });
  /* A-33: suspended or gone, their employee-app sign-ins end — on every path through here, not only the form. */
  await employeeStatusChanged(result.row, result.before.status, result.row.status, credentialActor(actor));
  /* Someone placed in a state nobody else works in: HR gets the registrations to do. */
  if (result.changes.some((c) => c.field === 'branchId')) await firstInStateOf(actor, result.row);
  /* A new manager takes over the requests waiting on the old one, on every path that changes the manager (form, bulk, dated, approval). */
  if (result.changes.some((c) => c.field === 'reportingManagerId')) {
    const { rerouteManagerSteps } = await import('./approvals/engine.js');
    await rerouteManagerSteps(actor, result.row.id).catch((e) => console.error('[approvals] reroute after manager change:', e instanceof Error ? e.message : e));
    /* Their leave waiting on the engine: the new manager takes it, in leave's words, and is told (workflow engine 2c). */
    await (await import('../attendance/leaveEngine.js')).refreshLeaveSteps(actor.accountId, actor.orgId, { employeeId: result.row.id });
  }
  return { row: result.row, changes: result.changes };
}

/** The actor as the credentials registry names one: a signed-in user, or the system (a job, an approval effect). */
export const credentialActor = (actor: Pick<Actor, 'userId' | 'source'>): CredentialActor => (actor.userId ? { type: 'USER', id: actor.userId } : { type: 'SYSTEM', label: actor.source.toLowerCase() });

/** The correlation id for a request: the request id the log middleware gave it, or a fresh one. */
export const correlationOf = (req: { id?: unknown } & Record<string, unknown>): string => String((req as any).id || `corr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/**
 * An employee row as it may leave the server: the reader PIN and the employee
 * app's password and set-up hashes stay behind, with flags saying whether each
 * is set (as routes/people.ts withMeta does for its rows). For a route that
 * answers with the raw row (security audit, 3 Nov 2026: resign, stay and rehire
 * sent the PIN in clear and the password hash).
 */
export function withoutSecrets<T extends Record<string, any>>(row: T) {
  const { devicePassword, portalPasswordHash, portalSetupHash, portalSetupExpires, ...rest } = row;
  return {
    ...rest,
    hasDevicePassword: Boolean(devicePassword),
    hasPortalPassword: Boolean(portalPasswordHash),
    portalSetupPending: Boolean(portalSetupHash && portalSetupExpires && new Date(portalSetupExpires) > new Date()),
  };
}
