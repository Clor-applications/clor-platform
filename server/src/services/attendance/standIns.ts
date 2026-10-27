import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { today } from './days.js';

/**
 * Stand-ins (TIME-LEAVE-DECISIONS.md, advanced build): while a manager is
 * away, another person decides their team's leave and attendance requests
 * as they would, between two dates. Set by HR or by the manager themselves.
 * The stand-in decides as the manager, never more: the manager's reportees
 * only, the manager's step only.
 */

/** The employee who decides for this manager on `date`: the manager themselves, or their stand-in that day. */
export async function deciderFor(orgId: string, managerEmployeeId: string, date = today()) {
  const standIn = await peoplePrisma.approvalStandIn.findFirst({
    where: { orgId, managerEmployeeId, fromDate: { lte: date }, toDate: { gte: date } },
    orderBy: { createdAt: 'desc' },
  });
  return standIn ? standIn.standInEmployeeId : managerEmployeeId;
}

/** The managers this person stands in for today, so their queue shows those teams too. */
export async function standingInFor(orgId: string, employeeId: string, date = today()) {
  const rows = await peoplePrisma.approvalStandIn.findMany({ where: { orgId, standInEmployeeId: employeeId, fromDate: { lte: date }, toDate: { gte: date } }, select: { managerEmployeeId: true } });
  return [...new Set(rows.map((r) => r.managerEmployeeId))];
}

/**
 * Whether `actor` may take the manager's step on a request from `employeeId`:
 * they are the person's manager, or stand in for them today. Returns the
 * manager it counts as, or null.
 */
export async function managerStepBy(orgId: string, actorEmployeeId: string, employeeId: string, date = today()) {
  const e = await peoplePrisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { reportingManagerId: true } });
  if (!e?.reportingManagerId) return null;
  if (e.reportingManagerId === actorEmployeeId) return actorEmployeeId;
  const covers = await standingInFor(orgId, actorEmployeeId, date);
  return covers.includes(e.reportingManagerId) ? e.reportingManagerId : null;
}

/** Everyone whose requests this person decides today: their own reportees and those of the managers they stand in for. */
export async function teamDecidedBy(orgId: string, employeeId: string, date = today()) {
  const managers = [employeeId, ...(await standingInFor(orgId, employeeId, date))];
  return peoplePrisma.employee.findMany({ where: { orgId, reportingManagerId: { in: managers }, status: { not: 'LEFT' } }, select: { id: true, name: true, code: true, reportingManagerId: true } });
}
