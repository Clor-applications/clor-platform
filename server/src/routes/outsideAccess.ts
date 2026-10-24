import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import {
  OUTSIDE_APPS,
  OutsideAccessError,
  changeOutsideAccess,
  listOutsideAccess,
  setOutsideAccessStatus,
} from '../services/outsideAccess.js';

/**
 * GAP-006: Workspace → Outside access. The people from other accounts this
 * company has let in — accountants, auditors — what each may use, until when,
 * who granted it; and pausing, changing or ending it. Managed by whoever may
 * manage the company's users; never by the outside person themselves.
 */
export const outsideAccessRouter = Router();
const base = '/orgs/:orgId/outside-access';
outsideAccessRouter.use(base, requireAuth, requireTenantContext);

const VIEW = requirePermission('SETTINGS', PermissionAction.VIEW, 'Users');
const EDIT = requirePermission('SETTINGS', PermissionAction.EDIT, 'Users');

const orgOk = (req: Request, res: Response) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};
const fail = (res: Response, e: unknown) => {
  if (e instanceof OutsideAccessError) return res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  throw e;
};

outsideAccessRouter.get(base, VIEW, async (req, res) => {
  if (!orgOk(req, res)) return;
  res.json({ outsideAccess: await listOutsideAccess(req.tenant!.orgId), apps: OUTSIDE_APPS });
});

outsideAccessRouter.patch(`${base}/:id`, EDIT, async (req, res) => {
  if (!orgOk(req, res)) return;
  const body = req.body || {};
  const patch: { apps?: unknown; expiresAt?: unknown } = {};
  if ('apps' in body) patch.apps = body.apps;
  if ('expiresAt' in body) patch.expiresAt = body.expiresAt;
  try {
    await changeOutsideAccess(req.tenant!.orgId, String(req.params.id), req.auth!.userId, patch);
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

const setStatus = (to: 'ACTIVE' | 'SUSPENDED' | 'REVOKED') => async (req: Request, res: Response) => {
  if (!orgOk(req, res)) return;
  try {
    await setOutsideAccessStatus(req.tenant!.orgId, String(req.params.id), req.auth!.userId, to, req.body?.reason);
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
};
outsideAccessRouter.post(`${base}/:id/suspend`, EDIT, setStatus('SUSPENDED'));
outsideAccessRouter.post(`${base}/:id/resume`, EDIT, setStatus('ACTIVE'));
/* Final for this grant: the person, their roles and the history stay; adding them again is a fresh grant. */
outsideAccessRouter.post(`${base}/:id/revoke`, EDIT, setStatus('REVOKED'));
