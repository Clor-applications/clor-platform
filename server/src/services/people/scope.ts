import type { Request } from 'express';
import { peoplePrisma } from '../../utils/peoplePrisma.js';

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

/** The `where` fragment for an employee query under this scope. */
export const scopeWhere = (scope: TeamScope): Record<string, unknown> => (scope.all ? {} : { id: { in: scope.ids } });

/** Whether one person is inside the scope. */
export const inScope = (scope: TeamScope, employeeId: string) => scope.all || scope.ids.includes(employeeId);
