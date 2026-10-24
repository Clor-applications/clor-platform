import { Router, type Request } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE, peopleRouteOk } from '../services/people/guards.js';
import { correlationOf } from '../services/people/employees.js';
import type { Actor, ChangeSource } from '../services/people/changeLog.js';
import { INVITE_STATUSES, InviteError, checkInvite, createInvite, invitesOf } from '../services/people/lifecycle/invites.js';

/**
 * Invites before day one (docs/people/02-PRD.md LIFE-01), HR's side: send,
 * list, check. The joiner's own route is public (routes/peopleJoin.ts).
 */
export const peopleInvitesRouter = Router();
peopleInvitesRouter.use(requireAuth, requireTenantContext);

const { lifecycle: LIFECYCLE } = PEOPLE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const base = '/orgs/:orgId/people';
const actorOf = (req: Request, source: ChangeSource = 'FORM', reason: string | null = null): Actor => ({
  accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth?.userId || null, source, correlationId: correlationOf(req as any), reason,
});
const sendError = (res: any, e: unknown) => {
  if (e instanceof InviteError) return res.status(e.status).json({ error: e.message });
  console.error('[people-invites]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: 'Something went wrong.' });
};

peopleInvitesRouter.post(`${base}/employees/:id/invites`, can(PermissionAction.CREATE, LIFECYCLE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const r = await createInvite(actorOf(req), String(req.params.id), { channel: req.body?.channel, sentTo: req.body?.sentTo, message: req.body?.message });
    res.status(201).json(r);
  } catch (e) {
    sendError(res, e);
  }
});

peopleInvitesRouter.get(`${base}/employees/:id/invites`, can(PermissionAction.VIEW, LIFECYCLE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  const employee = await peoplePrisma.employee.findFirst({ where: { id: String(req.params.id), accountId, orgId }, select: { id: true } });
  if (!employee) return res.status(404).json({ error: 'No such employee.' });
  res.json({ invites: await invitesOf(orgId, { employeeId: employee.id }) });
});

peopleInvitesRouter.get(`${base}/invites`, can(PermissionAction.VIEW, LIFECYCLE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const status = String(req.query.status || '').toUpperCase();
  if (status && !INVITE_STATUSES.includes(status as any)) return res.status(400).json({ error: 'Unknown status.' });
  res.json({ invites: await invitesOf(req.tenant!.orgId, { status: status || undefined }) });
});

/** HR checks what the joiner sent, with any corrections in `fields`; it goes on the record. */
peopleInvitesRouter.post(`${base}/invites/:id/check`, can(PermissionAction.EDIT, LIFECYCLE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const overrides = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
    res.json(await checkInvite(actorOf(req, 'FORM', typeof req.body?.note === 'string' ? req.body.note : null), String(req.params.id), overrides));
  } catch (e) {
    sendError(res, e);
  }
});
