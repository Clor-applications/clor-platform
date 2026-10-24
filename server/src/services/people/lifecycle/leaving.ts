import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { revokeFromReaders } from '../../attendance/readerSync.js';
import { closeEpisode } from '../episodes.js';
import { recordChanges } from '../employmentHistory.js';
import { READER_ACCESS_ITEM, startChecklist } from '../checklists.js';
import { writeEvent } from '../outbox.js';

/**
 * Someone leaves (docs/people/02-PRD.md LIFE-05): the last day, how and why.
 * One function for the form and for an approved leaving request: status
 * Left, the stint closed, history, the leaving checklist started, door
 * access ended, and the events other apps act on (Payroll starts the final
 * settlement from `people.employee.separated.v1`).
 */
type Who = { accountId: string; orgId: string; userId: string | null };
export const LEAVING_TYPES = ['RESIGNED', 'TERMINATED', 'RETIRED', 'ABSCONDED', 'CONTRACT_ENDED', 'DECEASED'] as const;

export async function leaveEmployee(who: Who, existing: { id: string; status: string; code: string | null; devicePin: string | null; currentEpisodeSeq?: number | null; dateOfJoining?: string | null; createdAt?: Date | null } & Record<string, unknown>, input: { lastDay: string; leavingType: string; reason: string | null }) {
  const { accountId, orgId } = who;
  const employee = await peoplePrisma.$transaction(async (tx) => {
    const row = await tx.employee.update({
      where: { id: existing.id },
      data: { status: 'LEFT', dateOfLeaving: input.lastDay, leavingType: input.leavingType, leavingReason: input.reason },
    });
    await closeEpisode({ accountId, orgId }, existing, { endDate: input.lastDay, endType: input.leavingType, endReason: input.reason }, tx);
    await writeEvent(tx, { accountId, orgId, correlationId: `leave_${row.id}_${input.lastDay}` }, 'people.employee.separated.v1', { lastWorkingDay: input.lastDay, type: input.leavingType, settlementRequested: true, employee: { id: row.id, code: row.code, name: row.name } }, row.id);
    return row;
  });
  await recordChanges({ accountId, orgId, userId: who.userId }, existing, employee, { source: 'RESIGNATION', effectiveDate: input.lastDay, note: input.reason || input.leavingType.replace(/_/g, ' ').toLowerCase() });
  const removed = await revokeFromReaders(orgId, existing, who.userId);
  await startChecklist({ accountId, orgId, userId: who.userId }, employee, 'LEAVING', input.lastDay, { done: [READER_ACCESS_ITEM] });
  return { employee, readers: removed.readers };
}
