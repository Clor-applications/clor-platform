import { Router, type Request } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { authorize, requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { inScope, teamScope } from '../services/people/scope.js';
import { changes, joiners, leavers, overview, taskQueue } from '../services/people/lifecycle/board.js';
import { seesLeavingReason, seesLeavings } from '../services/people/companyChoices.js';

/**
 * Joining & Leaving (docs/people/design-v1/JOINING-LEAVING-DECISIONS.md):
 * the overview, the joining, changes and leaving lists, and the task queue.
 * Reads only; ticking and handing on tasks stay on
 * `PATCH /people/checklist-tasks/:id`, the steps on `/people/checklist-templates`.
 *
 * Every list is cut to the caller's team scope. The task queue is open to
 * anyone with a task: without the Employees right a person sees only their
 * own, whatever view they ask for.
 */
export const peopleLifecycleRouter = Router();
peopleLifecycleRouter.use('/orgs/:orgId/people/lifecycle', requireAuth, requireTenantContext);

const { employees: EMPLOYEES } = PEOPLE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const base = '/orgs/:orgId/people/lifecycle';

async function ctxOf(req: Request) {
  return {
    orgId: req.tenant!.orgId,
    scope: await teamScope(req),
    /* Why someone leaves is HR's to read (JCL-009); others with the Lifecycle right only when the company says so (SPEC 3.5). */
    privateOk: await seesLeavingReason(req),
    leavingsOk: await seesLeavings(req),
    userId: req.auth!.userId,
    mineOnly: Boolean(await authorize(req, PEOPLE_MODULE, PermissionAction.VIEW, EMPLOYEES)),
    /* Closes and hands on anyone's task in scope (the PATCH route checks the same). */
    hr: !(await authorize(req, PEOPLE_MODULE, PermissionAction.EDIT, EMPLOYEES)),
  };
}
const paging = (req: Request) => ({ view: String(req.query.view || ''), q: String(req.query.q || '').slice(0, 100), limit: Number(req.query.limit) || 25, offset: Number(req.query.offset) || 0 });

peopleLifecycleRouter.get(`${base}/overview`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json(await overview(await ctxOf(req)));
});

peopleLifecycleRouter.get(`${base}/joiners`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json(await joiners(await ctxOf(req), paging(req)));
});

peopleLifecycleRouter.get(`${base}/leavers`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json(await leavers(await ctxOf(req), paging(req)));
});

peopleLifecycleRouter.get(`${base}/changes`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json(await changes(await ctxOf(req), paging(req)));
});

/** The task queue: anyone signed in to the company sees their own; the Employees right widens it to their scope. */
peopleLifecycleRouter.get(`${base}/tasks`, async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const ctx = await ctxOf(req);
  const employeeId = req.query.employeeId ? String(req.query.employeeId) : undefined;
  if (employeeId && !inScope(ctx.scope, employeeId)) return res.status(404).json({ error: 'No such employee.' });
  res.json({ ...(await taskQueue(ctx, { ...paging(req), kind: String(req.query.kind || ''), employeeId })), mineOnly: ctx.mineOnly });
});

/**
 * Before recording a leaving (pack A06): who reports to them now and who they
 * will report to after the last day (the next manager up), what they hold
 * from the asset register.
 */
peopleLifecycleRouter.get(`${base}/leaving-preview/:id`, can(PermissionAction.VIEW, EMPLOYEES), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { orgId } = req.tenant!;
  const scope = await teamScope(req);
  const person = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), orgId }, select: { id: true, name: true, reportingManagerId: true } });
  if (!person || !inScope(scope, person.id)) return res.status(404).json({ error: 'No such employee.' });
  const [reports, next, assets] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, reportingManagerId: person.id, status: { not: 'LEFT' } }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' }, take: 200 }),
    person.reportingManagerId ? peoplePrisma.employee.findFirst({ where: { id: person.reportingManagerId, orgId }, select: { id: true, name: true, status: true } }) : null,
    peoplePrisma.peopleRecord.findMany({ where: { orgId, kind: 'assets', status: 'ASSIGNED', employeeId: person.id }, select: { id: true, title: true, details: true } }),
  ]);
  res.json({
    reports,
    nextManager: next && next.status !== 'LEFT' ? { id: next.id, name: next.name } : null,
    assets: assets.map((a) => ({ id: a.id, title: a.title, tag: (a.details as any)?.assetTag || null })),
  });
});
