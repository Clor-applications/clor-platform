import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { writeChangeLog, type Actor } from '../changeLog.js';
import { updateEmployee } from '../employees.js';

/**
 * What a person's leaving (or removal) closes, so nothing acts on them
 * afterwards (Workforce final audit W1, W4, W12): dated changes still
 * waiting are cancelled, their open requests other than the leaving itself
 * are withdrawn, their direct reports move up to the leaver's own manager
 * (as delete already did), anyone who had them as a secondary manager loses
 * that line, and their position on a team is freed. Each step is logged.
 */
export async function closeOutFor(actor: Actor, employeeId: string) {
  const { orgId } = actor;
  /* A deleted person is already in the bin (delete moves their team itself): their changes and requests still close. */
  const person = (await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true, name: true, reportingManagerId: true, seatId: true } })) || { id: employeeId, name: 'The person', reportingManagerId: null, seatId: null, gone: true as const };
  const now = new Date();
  const cancelled = await peoplePrisma.scheduledChange.updateMany({ where: { orgId, employeeId, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: now } });
  const open = await peoplePrisma.approvalRequest.findMany({ where: { orgId, subjectEmployeeId: employeeId, status: { in: ['WAITING', 'MORE_INFO'] }, requestType: { not: 'LEAVING' } }, select: { id: true, status: true } });
  for (const r of open) {
    await peoplePrisma.$transaction(async (tx) => {
      await tx.approvalStep.updateMany({ where: { requestId: r.id, status: 'WAITING' }, data: { status: 'WITHDRAWN', comment: `${person.name} left` } });
      await tx.approvalRequest.update({ where: { id: r.id }, data: { status: 'WITHDRAWN' } });
      await writeChangeLog(tx, { ...actor, reason: `${person.name} left` }, { kind: 'ApprovalRequest', id: r.id, employeeId }, [{ field: 'status', before: r.status, after: 'WITHDRAWN', redacted: false }]);
    });
  }
  if ('gone' in person) return { cancelled: cancelled.count, withdrawn: open.length, moved: 0 };
  /* Their team moves up one line, through the one write path, so each person's history says why. */
  const reports = await peoplePrisma.employee.findMany({ where: { orgId, reportingManagerId: employeeId, status: { not: 'LEFT' } } });
  const up = { ...actor, reason: `${person.name} left; reports to the next manager up` };
  for (const r of reports) await updateEmployee(up, r, { reportingManagerId: person.reportingManagerId ?? null });
  const dotted = await peoplePrisma.employee.findMany({ where: { orgId, dottedManagerId: employeeId, status: { not: 'LEFT' } } });
  for (const r of dotted) await updateEmployee({ ...actor, reason: `${person.name} left` }, r, { dottedManagerId: null });
  if (person.seatId) await peoplePrisma.employee.updateMany({ where: { id: employeeId, orgId }, data: { seatId: null } });
  return { cancelled: cancelled.count, withdrawn: open.length, moved: reports.length };
}
