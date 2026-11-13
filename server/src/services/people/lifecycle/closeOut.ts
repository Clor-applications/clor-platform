import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import type { Actor } from '../changeLog.js';
import { updateEmployee } from '../employees.js';
import { withdrawForLeaver } from '../approvals/engine.js';

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
  const open = await peoplePrisma.approvalRequest.findMany({ where: { orgId, subjectEmployeeId: employeeId, status: { in: ['WAITING', 'MORE_INFO'] }, requestType: { not: 'LEAVING' }, sourceKind: null }, select: { id: true } });
  /* Each through the engine's locked withdraw: one approved or being applied a moment ago stays as it is, and a shift swap closes with its request. */
  let withdrawn = 0;
  for (const r of open) if (await withdrawForLeaver(actor, r.id, `${person.name} left`)) withdrawn += 1;
  if ('gone' in person) return { cancelled: cancelled.count, withdrawn, moved: 0 };
  /* Their team moves up one line, through the one write path, so each person's history says why. */
  const reports = await peoplePrisma.employee.findMany({ where: { orgId, reportingManagerId: employeeId, status: { not: 'LEFT' } } });
  const up = { ...actor, reason: `${person.name} left; reports to the next manager up` };
  for (const r of reports) await updateEmployee(up, r, { reportingManagerId: person.reportingManagerId ?? null });
  const dotted = await peoplePrisma.employee.findMany({ where: { orgId, dottedManagerId: employeeId, status: { not: 'LEFT' } } });
  for (const r of dotted) await updateEmployee({ ...actor, reason: `${person.name} left` }, r, { dottedManagerId: null });
  if (person.seatId) await peoplePrisma.employee.updateMany({ where: { id: employeeId, orgId }, data: { seatId: null } });
  return { cancelled: cancelled.count, withdrawn, moved: reports.length };
}
