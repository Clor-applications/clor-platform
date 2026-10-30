import type { Request } from 'express';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { authorize } from '../../middleware/rbac.js';
import { PermissionAction } from '../../constants/enums.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from './guards.js';

/**
 * Team scope (docs/people/03 contract §4; PC-ACC-01). A role marked "own
 * records only" (Role.ownDocumentsOnly, the flag accounting uses for a
 * clerk's own documents) means, in People, "the people who report to me":
 * the person the signed-in user is on the employee list, everyone whose
 * reporting line (solid or dotted) reaches them, and nobody else. Without
 * the flag the scope is the whole company, as before.
 *
 * Resolved per request and applied as a `where` on every People read; a
 * record outside the scope reads as absent, not refused.
 */

export type TeamScope = { all: true } | { all: false; ids: string[]; selfId: string | null };

export async function teamScope(req: Request): Promise<TeamScope> {
  if (!req.ownDocumentsOnly) return { all: true };
  const orgId = req.tenant!.orgId;
  const userId = req.auth?.userId || '';
  const me = userId ? await peoplePrisma.employee.findFirst({ where: { orgId, userId }, select: { id: true } }) : null;
  if (!me) return { all: false, ids: [], selfId: null };
  const ids = new Set<string>([me.id]);
  let frontier = [me.id];
  /* Breadth first down the line; a loop cannot form (checkManager refuses one), but the set guards it anyway. */
  for (let depth = 0; depth < 20 && frontier.length; depth += 1) {
    const next = await peoplePrisma.employee.findMany({ where: { orgId, OR: [{ reportingManagerId: { in: frontier } }, { dottedManagerId: { in: frontier } }] }, select: { id: true } });
    frontier = next.map((r) => r.id).filter((id) => !ids.has(id));
    for (const id of frontier) ids.add(id);
  }
  return { all: false, ids: [...ids], selfId: me.id };
}

/**
 * Whether this user sits above the person on the reporting line (solid or dotted, any number of steps up).
 * Unlike `teamScope` it does not depend on the role: IT reads the whole company and is on nobody's line.
 */
export async function inReportingLine(orgId: string, userId: string, employeeId: string) {
  const me = await peoplePrisma.employee.findFirst({ where: { orgId, userId }, select: { id: true } });
  if (!me || me.id === employeeId) return false;
  const seen = new Set([employeeId]);
  let frontier = [employeeId];
  for (let depth = 0; depth < 20 && frontier.length; depth += 1) {
    const up = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: frontier } }, select: { reportingManagerId: true, dottedManagerId: true } });
    const next = up.flatMap((r) => [r.reportingManagerId, r.dottedManagerId]).filter((id): id is string => Boolean(id) && !seen.has(id as string));
    if (next.includes(me.id)) return true;
    for (const id of next) seen.add(id);
    frontier = [...new Set(next)];
  }
  return false;
}

/** The `where` fragment for an employee query under this scope. */
export const scopeWhere = (scope: TeamScope): Record<string, unknown> => (scope.all ? {} : { id: { in: scope.ids } });

/** Whether one person is inside the scope. */
export const inScope = (scope: TeamScope, employeeId: string) => scope.all || scope.ids.includes(employeeId);

/**
 * Personal details (Workforce audit E4): the date of birth, home address,
 * personal email, family and emergency contacts go to whoever keeps the
 * records (an administrator, anyone who may edit employees or see statutory
 * details). A read-only role (IT, a team lead) gets the work profile.
 */
export async function seesPersonal(req: Request) {
  if (req.isAdmin) return true;
  if (!(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, PEOPLE_RESOURCE.employees))) return true;
  return !(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, PEOPLE_RESOURCE.statutory));
}
