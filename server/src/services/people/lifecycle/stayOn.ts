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
  const { row: employee } = await updateEmployee(actor, existing as any, { status: 'ACTIVE', dateOfLeaving: null, leavingType: null, leavingReason: null }, {
    afterWrite: async (tx, row) => {
      await tx.checklistTask.updateMany({ where: { orgId, employeeId: row.id, kind: 'LEAVING', doneAt: null }, data: { doneAt: new Date(), doneByUserId: who.userId, note: 'Not needed: leaving withdrawn.' } });
    },
  });
  await recordChanges({ accountId, orgId, userId: who.userId }, existing as any, employee as any, { source: 'FORM', effectiveDate: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10), note: `Leaving withdrawn${reason ? `: ${reason}` : ''}` });
  return employee;
}
