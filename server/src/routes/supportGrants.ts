import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { PermissionAction } from '../constants/enums.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { requirePermission } from '../middleware/rbac.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import {
  DEFAULT_HOURS,
  MAX_HOURS,
  SupportGrantError,
  approveGrant,
  endGrant,
  grantAudit,
  listGrants,
  requestGrant,
  stateOf,
} from '../services/supportGrants.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { audit } from './ops.js';

/**
 * Support grants (docs/workspace/SUPPORT_GRANTS.md): CLOR staff ask on the
 * console, the customer answers in Workspace. Both sides go through the
 * service, so the rules — one open ask, the clock starting on approval, the
 * customer only narrowing the scope — hold whichever door is used.
 */

const fail = (res: Response, e: unknown) => {
  if (e instanceof SupportGrantError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

/* ---------------------------------------------------------------- customer */

export const supportGrantsRouter = Router();
const base = '/orgs/:orgId/support-grants';
supportGrantsRouter.use(base, requireAuth, requireTenantContext);

/* Whoever may manage the company's users answers: letting someone in is the same decision. */
const VIEW = requirePermission('SETTINGS', PermissionAction.VIEW, 'Users');
const EDIT = requirePermission('SETTINGS', PermissionAction.EDIT, 'Users');

const orgOk = (req: Request, res: Response) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};

supportGrantsRouter.get(base, VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  res.json({ grants: await listGrants(req.tenant!.orgId), defaultHours: DEFAULT_HOURS, maxHours: MAX_HOURS });
});

supportGrantsRouter.post(`${base}/:id/approve`, EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  try {
    const g = await approveGrant({ orgId: req.tenant!.orgId, id: String(req.params.id), byUserId: req.auth!.userId, hours: req.body?.hours, scope: req.body?.scope });
    await grantAudit({
      accountId: req.tenant!.accountId,
      orgId: req.tenant!.orgId,
      grantId: g!.id,
      action: 'APPROVED',
      byUserId: req.auth!.userId,
      message: `Let CLOR support in, ${g!.scope === 'READ_WRITE' ? 'to read and change' : 'to read only'}, until ${g!.expiresAt!.toISOString()}`,
    });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

/** Refuse a request, or end a live grant early. Either way nothing opens again without a new ask. */
supportGrantsRouter.post(`${base}/:id/end`, EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  try {
    const g = await endGrant({ orgId: req.tenant!.orgId, id: String(req.params.id), byUserId: req.auth!.userId, reason: req.body?.reason });
    await grantAudit({
      accountId: req.tenant!.accountId,
      orgId: req.tenant!.orgId,
      grantId: g!.id,
      action: g!.status === 'REVOKED' ? 'REFUSED' : 'ENDED',
      byUserId: req.auth!.userId,
      message: g!.status === 'REVOKED' ? 'Refused CLOR support access' : 'Ended CLOR support access',
    });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

/* -------------------------------------------------------------------- ops */

export const opsSupportGrantsRouter = Router();
opsSupportGrantsRouter.use(['/ops/support-grants', '/ops/accounts/:accountId/support-grants'], requireAuth, requireOperator);

const askSchema = z.object({
  orgId: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(10, 'Say why you need to look, in a sentence the customer will read.').max(500),
  ticketRef: z.string().trim().max(60).optional(),
  scope: z.enum(['READ_ONLY', 'READ_WRITE']).optional(),
});

/** Support asks; nothing opens until an owner or admin of the account says yes. */
opsSupportGrantsRouter.post('/ops/accounts/:accountId/support-grants', requireOperatorRole('SUPPORT'), requireOperatorStepUp, async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  const accountId = String(req.params.accountId);
  try {
    const g = await requestGrant({
      accountId,
      orgId: parsed.data.orgId,
      operatorUserId: req.auth!.userId,
      requestedByUserId: req.auth!.userId,
      reason: parsed.data.reason,
      ticketRef: parsed.data.ticketRef,
      scope: parsed.data.scope,
    });
    await audit(req, 'SUPPORT_GRANT_REQUESTED', { accountId }, { orgId: g.orgId, scope: g.scope, reason: g.reason, ticket: g.ticketRef });
    await grantAudit({ accountId, orgId: g.orgId, grantId: g.id, action: 'REQUESTED', byUserId: req.auth!.userId, message: `CLOR support asked to look: ${g.reason}` });
    res.status(201).json({ grant: { id: g.id, state: g.status, scope: g.scope } });
  } catch (e) {
    fail(res, e);
  }
});

/** Grants on one account, for the account page: what is asked, what is open, and which are the caller's own. */
opsSupportGrantsRouter.get('/ops/accounts/:accountId/support-grants', (req, res) =>
  outsideTenant('ops: support grants on an account', async () => {
    const now = new Date();
    const rows = await platformPrisma.supportGrant.findMany({ where: { accountId: String(req.params.accountId) }, orderBy: { requestedAt: 'desc' }, take: 50 });
    const staff = await platformPrisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.operatorUserId))] } }, select: { id: true, fullName: true, email: true } });
    const names = new Map(staff.map((u) => [u.id, u.fullName || u.email]));
    res.json({
      grants: rows.map((r) => ({
        id: r.id,
        orgId: r.orgId,
        state: stateOf(r, now),
        scope: r.scope,
        reason: r.reason,
        ticketRef: r.ticketRef,
        staff: names.get(r.operatorUserId) || 'CLOR support',
        mine: r.operatorUserId === req.auth!.userId,
        requestedAt: r.requestedAt,
        approvedAt: r.approvedAt,
        expiresAt: r.expiresAt,
        endedAt: r.endedAt,
      })),
    });
  }),
);

/** The signed-in operator's own grants, newest first: where they may look right now. */
opsSupportGrantsRouter.get('/ops/support-grants', (req, res) =>
  outsideTenant('ops: my support grants', async () => {
    const now = new Date();
    const rows = await platformPrisma.supportGrant.findMany({ where: { operatorUserId: req.auth!.userId }, orderBy: { requestedAt: 'desc' }, take: 50 });
    const orgs = await platformPrisma.org.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.orgId))] } }, select: { id: true, name: true, accountId: true } });
    const byId = new Map(orgs.map((o) => [o.id, o]));
    res.json({
      grants: rows.map((r) => ({
        id: r.id,
        state: stateOf(r, now),
        scope: r.scope,
        reason: r.reason,
        ticketRef: r.ticketRef,
        orgId: r.orgId,
        accountId: r.accountId,
        company: byId.get(r.orgId)?.name || 'A company',
        requestedAt: r.requestedAt,
        approvedAt: r.approvedAt,
        expiresAt: r.expiresAt,
        endedAt: r.endedAt,
      })),
    });
  }),
);

/** Done early: staff close their own grant rather than leave it open to the end. */
opsSupportGrantsRouter.post('/ops/support-grants/:id/end', async (req, res) => {
  const row = await outsideTenant('ops: whose grant is this', () =>
    platformPrisma.supportGrant.findFirst({ where: { id: String(req.params.id), operatorUserId: req.auth!.userId }, select: { id: true, orgId: true, accountId: true } }),
  );
  if (!row) return res.status(404).json({ error: 'No such grant.' });
  try {
    const g = await endGrant({ orgId: row.orgId, id: row.id, byUserId: req.auth!.userId, reason: req.body?.reason || 'Finished' });
    await audit(req, 'SUPPORT_GRANT_ENDED', { accountId: row.accountId }, { orgId: row.orgId });
    await grantAudit({ accountId: row.accountId, orgId: row.orgId, grantId: row.id, action: g!.status === 'REVOKED' ? 'WITHDRAWN' : 'ENDED', byUserId: req.auth!.userId, message: 'CLOR support finished and closed their access' });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});
