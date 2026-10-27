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
import { StatutoryError, approveStatutory, forApproval, pushHeld, rejectStatutory } from '../services/people/lifecycle/joiningStatutory.js';
import { ownRecordRefusal } from '../services/makerChecker.js';
import { AppAccessError, appAccessSends, sendAppAccess } from '../services/people/lifecycle/appAccess.js';
import { stepUpRefusal } from '../services/stepUp.js';

/**
 * Invites before day one (docs/people/02-PRD.md LIFE-01), HR's side: send,
 * list, check. The joiner's own route is public (routes/peopleJoin.ts).
 */
export const peopleInvitesRouter = Router();
peopleInvitesRouter.use(requireAuth, requireTenantContext);

const { lifecycle: LIFECYCLE, statutory: STATUTORY } = PEOPLE_RESOURCE;
const can = (action: string, resource: string) => requirePermission(PEOPLE_MODULE, action as any, resource);
const base = '/orgs/:orgId/people';
const actorOf = (req: Request, source: ChangeSource = 'FORM', reason: string | null = null): Actor => ({
  accountId: req.tenant!.accountId, orgId: req.tenant!.orgId, userId: req.auth?.userId || null, source, correlationId: correlationOf(req as any), reason,
});
const sendError = (res: any, e: unknown) => {
  if (e instanceof InviteError || e instanceof StatutoryError) return res.status(e.status).json({ error: e.message });
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

/* ---------------------------------------------------------------- statutory details at joining (HR-VIEW gap 2) */

const statutoryActor = (req: Request) => ({ ...actorOf(req, 'FORM', typeof req.body?.note === 'string' ? req.body.note : null), branchId: req.tenant!.branchId || null });

/**
 * The approval view: the one place PAN, UAN, ESIC and the bank account are
 * shown in full, and only while they wait for a decision. Needs the
 * Statutory Details grant; every opening is written to the access log.
 */
peopleInvitesRouter.get(`${base}/invites/:id/statutory`, can(PermissionAction.VIEW, STATUTORY), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  const { accountId, orgId } = req.tenant!;
  try {
    /* Full PAN, UAN, ESIC and bank on screen: a fresh authenticator code, as the record's own reveal asks (people.ts statutory/reveal). */
    const refused = await stepUpRefusal(req, 'Showing a joiner’s full identifiers needs an authenticator app. Set one up in your profile first (your name or picture, top right).');
    if (refused) return res.status(refused.status).json(refused.body);
    const statutory = await forApproval(orgId, String(req.params.id));
    if (!statutory.masked) await peoplePrisma.accessLog.create({ data: { accountId, orgId, what: 'STATUTORY', entityId: statutory.id, employeeId: statutory.employeeId, field: 'joining', userId: req.auth!.userId } });
    res.json({ statutory });
  } catch (e) {
    sendError(res, e);
  }
});

/** Approve (with any corrections in `values`): to Payroll's record, or held in People until Payroll is on. */
peopleInvitesRouter.post(`${base}/invites/:id/statutory/approve`, can(PermissionAction.EDIT, STATUTORY), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const own = await peoplePrisma.joinStatutory.findFirst({ where: { orgId: req.tenant!.orgId, inviteId: String(req.params.id) }, select: { employeeId: true } });
    if (own) {
      const refused = await ownRecordRefusal(req, own.employeeId, 'statutory details');
      if (refused) return res.status(refused.status).json(refused.body);
    }
    res.json(await approveStatutory(statutoryActor(req), String(req.params.id), req.body?.values));
  } catch (e) {
    sendError(res, e);
  }
});

peopleInvitesRouter.post(`${base}/invites/:id/statutory/reject`, can(PermissionAction.EDIT, STATUTORY), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json({ statutory: await rejectStatutory(statutoryActor(req), String(req.params.id), req.body?.note) });
  } catch (e) {
    sendError(res, e);
  }
});

/** Payroll has been switched on: approved details held in People go to it. */
peopleInvitesRouter.post(`${base}/joining-statutory/send-held`, can(PermissionAction.EDIT, STATUTORY), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    res.json(await pushHeld(statutoryActor(req)));
  } catch (e) {
    sendError(res, e);
  }
});

/* ---------------------------------------------------------------- employee app access, in bulk (HR-VIEW gap 3) */

/**
 * Selected people get a one-time activation code: by e-mail where there is
 * one (the code is never shown to HR), else once in this response for a
 * printed sheet and a WhatsApp link. Every send is recorded.
 */
peopleInvitesRouter.post(`${base}/app-access/send`, can(PermissionAction.CREATE, LIFECYCLE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  try {
    const ids = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.map(String) : [];
    res.json(await sendAppAccess(actorOf(req), ids));
  } catch (e) {
    if (e instanceof AppAccessError) return res.status(e.status).json({ error: e.message });
    sendError(res, e);
  }
});

/** Who was sent employee app access, how and when (never the code). */
peopleInvitesRouter.get(`${base}/app-access/sends`, can(PermissionAction.VIEW, LIFECYCLE), async (req, res) => {
  if (!(await peopleRouteOk(req, res))) return;
  res.json({ sends: await appAccessSends(req.tenant!.orgId, req.query.employeeId ? String(req.query.employeeId) : undefined) });
});
