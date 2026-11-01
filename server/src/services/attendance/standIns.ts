import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { managersCoveredBy, standInEmployeeFor } from '../people/approvals/standIns.js';
import { today } from './days.js';

/**
 * Stand-ins (TIME-LEAVE-DECISIONS.md, advanced build): while a manager is
 * away, another person decides their team's leave and attendance requests
 * as they would, between two dates. Set by HR or by the manager themselves.
 * The stand-in decides as the manager, never more: the manager's reportees
 * only, the manager's step only.
 *
 * Since the stand-in merge (workflow engine phase 2b) these read the one
 * `StandIn` table, and the retired `ApprovalStandIn` as a fallback
 * (services/people/approvals/standIns.ts). `type` says which request is being
 * decided, so a stand-in for leave only does not decide attendance: `LEAVE`,
 * `ATTENDANCE` (attendance requests, overtime, field punches), or `TIME` for a
 * queue that holds both.
 */
export type TimeType = 'LEAVE' | 'ATTENDANCE' | 'TIME';

/** The employee who decides for this manager on `date`: the manager themselves, or their stand-in that day. */
export async function deciderFor(orgId: string, managerEmployeeId: string, date = today(), type: TimeType = 'TIME') {
  return (await standInEmployeeFor(orgId, managerEmployeeId, date, type)) || managerEmployeeId;
}

/** The managers this person stands in for today, so their queue shows those teams too. */
export async function standingInFor(orgId: string, employeeId: string, date = today(), type: TimeType = 'TIME') {
  return managersCoveredBy(orgId, employeeId, date, type);
}

/**
 * Whether `actor` may take the manager's step on a request from `employeeId`:
 * they are the person's manager, or stand in for them today. Returns the
 * manager it counts as, or null.
 */
export async function managerStepBy(orgId: string, actorEmployeeId: string, employeeId: string, date = today(), type: TimeType = 'TIME') {
  /* Nobody takes the manager's step on their own request, even standing in for their own manager (closure audit, 27 Oct 2026). */
  if (actorEmployeeId === employeeId) return null;
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { reportingManagerId: true } });
  if (!e?.reportingManagerId) return null;
  if (e.reportingManagerId === actorEmployeeId) return actorEmployeeId;
  const covers = await standingInFor(orgId, actorEmployeeId, date, type);
  return covers.includes(e.reportingManagerId) ? e.reportingManagerId : null;
}

/** Everyone whose requests this person decides today: their own reportees and those of the managers they stand in for. */
export async function teamDecidedBy(orgId: string, employeeId: string, date = today(), type: TimeType = 'TIME') {
  const managers = [employeeId, ...(await standingInFor(orgId, employeeId, date, type))];
  return peoplePrisma.employee.findMany({ where: { orgId, reportingManagerId: { in: managers }, status: { not: 'LEFT' }, id: { not: employeeId } }, select: { id: true, name: true, code: true, reportingManagerId: true } });
}
