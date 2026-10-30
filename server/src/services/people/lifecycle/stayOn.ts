import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { recordChanges } from '../employmentHistory.js';
import { updateEmployee } from '../employees.js';

/**
 * Leaving withdrawn while on notice (Workforce audit O11): a resignation
 * taken back, a termination reversed before the day. Active again, the
 * leaving date and reason cleared (the usual update event tells other apps), and the open leaving
 * tasks closed as not needed (kept, so the plan shows what happened).
 */
type Who = { accountId: string; orgId: string; userId: string | null };

/** How a step closed by a withdrawal is told from one really done (a "Final wages paid" step closed this way paid nothing). */
export const LEAVING_WITHDRAWN_NOTE = 'Not needed: leaving withdrawn.';
/** The kind a withdrawn leaving's steps move to: out of every leaving plan, board and clock, still on the record. */
export const LEAVING_WITHDRAWN_KIND = 'LEAVING_WITHDRAWN';

export class StayOnError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function cancelLeaving(who: Who, employeeId: string, reason: string | null) {
  const { accountId, orgId } = who;
  const existing = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId } });
  if (!existing) throw new StayOnError('No such employee.', 404);
  if (existing.status !== 'ON_NOTICE') throw new StayOnError(existing.status === 'LEFT' ? `${existing.name} has already left. Use Rehire to bring them back.` : `${existing.name} is not on notice.`, 409);
  const lastDay = existing.dateOfLeaving;
  const actor = { accountId, orgId, userId: who.userId, source: 'FORM' as const, correlationId: `stay_${existing.id}_${lastDay}`, reason: `Leaving withdrawn${reason ? `: ${reason}` : ''}` };
  const { row: employee } = await updateEmployee(actor, existing as any, { status: 'ACTIVE', dateOfLeaving: null, leavingType: null, leavingReason: null, resignedOn: null, noticeWaived: false } as any, {
    afterWrite: async (tx, row) => {
      await tx.checklistTask.updateMany({ where: { orgId, employeeId: row.id, kind: 'LEAVING', doneAt: null }, data: { doneAt: new Date(), doneByUserId: who.userId, note: LEAVING_WITHDRAWN_NOTE } });
      /* This leaving's steps, done or not, are kept on the record under their own kind: a later leaving starts a fresh plan, not "8 of 16 done". */
      await tx.checklistTask.updateMany({ where: { orgId, employeeId: row.id, kind: 'LEAVING', ...(existing.dateOfJoining ? { createdAt: { gte: new Date(`${existing.dateOfJoining}T00:00:00+05:30`) } } : {}) }, data: { kind: LEAVING_WITHDRAWN_KIND } });
      /* The no-dues lines and the exit interview of this stint end with it: nobody signs or is reminded for someone who stays. */
      const thisStint = { orgId, employeeId: row.id, leavingDate: { gte: existing.dateOfJoining || '' } };
      await tx.clearanceLine.updateMany({ where: { ...thisStint, status: { not: 'WITHDRAWN' } }, data: { status: 'WITHDRAWN' } });
      await tx.exitInterview.updateMany({ where: { ...thisStint, outcome: null }, data: { outcome: 'RETAINED', outcomeByUserId: who.userId, outcomeAt: new Date() } });
      await tx.exitInterview.updateMany({ where: { ...thisStint, withdrawnAt: null }, data: { withdrawnAt: new Date() } });
    },
  });
  await recordChanges({ accountId, orgId, userId: who.userId }, existing as any, employee as any, { source: 'FORM', effectiveDate: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10), note: `Leaving withdrawn${reason ? `: ${reason}` : ''}` });
  return employee;
}
