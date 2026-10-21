import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { recordAudit } from '../services/auditTrail.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { ClosureError, cancelClosure, closureStatus, lastFullExport, noticeDays, scheduleClosure } from '../services/companyClosure.js';

/**
 * Closing a company (LX-07 part 2): status, ask, cancel. Owner only (checked
 * in the service); the deletion itself is the daily job after the notice
 * period. Policy: docs/compliance/DATA_DELETION_AND_CLOSURE.md.
 */
export const companyClosureRouter = Router();
companyClosureRouter.use('/orgs/:orgId/closure', requireAuth, requireTenantContext);

const sameOrg = (req: any, res: any) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    res.status(403).json({ error: 'orgId mismatch' });
    return false;
  }
  return true;
};
const fail = (res: any, e: unknown) => {
  if (e instanceof ClosureError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

companyClosureRouter.get('/orgs/:orgId/closure', async (req, res) => {
  if (!sameOrg(req, res)) return;
  const { orgId } = req.tenant!;
  const [closure, exported, org] = await Promise.all([closureStatus(orgId), lastFullExport(orgId), platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true, createdByUserId: true } })]);
  res.json({ closure, orgName: org?.name || '', isOwner: org?.createdByUserId === req.auth!.userId, lastFullExportAt: exported?.createdAt || null, noticeDays: noticeDays() });
});

companyClosureRouter.post('/orgs/:orgId/closure', async (req, res) => {
  if (!sameOrg(req, res)) return;
  const { accountId, orgId } = req.tenant!;
  try {
    const closure = await scheduleClosure({ accountId, orgId, userId: req.auth!.userId, confirmName: req.body?.confirmName, reason: req.body?.reason });
    await recordAudit(req, { entity: 'Company', entityId: orgId, action: 'CLOSURE_SCHEDULED', message: `Closure scheduled; data deleted after ${closure.deleteAfter.toISOString().slice(0, 10)}`, metadata: { reason: closure.reason } });
    res.status(201).json({ closure });
  } catch (e) {
    fail(res, e);
  }
});

companyClosureRouter.delete('/orgs/:orgId/closure', async (req, res) => {
  if (!sameOrg(req, res)) return;
  const { orgId } = req.tenant!;
  try {
    const closure = await cancelClosure({ orgId, userId: req.auth!.userId });
    await recordAudit(req, { entity: 'Company', entityId: orgId, action: 'CLOSURE_CANCELLED', message: 'Closure cancelled; nothing will be deleted' });
    res.json({ closure });
  } catch (e) {
    fail(res, e);
  }
});
