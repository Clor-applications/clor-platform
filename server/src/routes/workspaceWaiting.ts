import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { workspaceWaiting } from '../services/workspace/waiting.js';
import { workspaceInbox } from '../services/workspace/inbox.js';
import { workspaceIntegrations } from '../services/workspace/integrations.js';
import { authorize } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { z } from 'zod';
import { check, id } from '../middleware/validate.js';

/**
 * Workspace, Overview: what waits on the signed-in person in each app of this
 * company (services/workspace/waiting.ts). Open to anyone in the company: it
 * counts only what the reader may decide, and says nothing about anyone else.
 * Middleware is on the route, not the router, so it never runs for other paths.
 */
export const workspaceWaitingRouter = Router();

workspaceWaitingRouter.get('/orgs/:orgId/workspace/waiting', requireAuth, requireTenantContext, check({ params: z.object({ orgId: id }) }), async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });
  res.json(await workspaceWaiting(req));
});

/** The list behind that number, and the reader's latest updates (services/workspace/inbox.ts). Same gate: it shows only what the reader may decide. */
workspaceWaitingRouter.get('/orgs/:orgId/workspace/inbox', requireAuth, requireTenantContext, check({ params: z.object({ orgId: id }) }), async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });
  res.json(await workspaceInbox(req));
});

/**
 * Everything connecting this company to the outside, and whether it works
 * (services/workspace/integrations.ts). Readers' names, key labels and mail
 * errors are setup detail, so only someone who may see the company profile
 * gets it, as with the rest of Workspace's company pages.
 */
workspaceWaitingRouter.get('/orgs/:orgId/workspace/integrations', requireAuth, requireTenantContext, check({ params: z.object({ orgId: id }) }), async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) return res.status(403).json({ error: 'orgId mismatch' });
  if (await authorize(req, 'SETTINGS', PermissionAction.VIEW, 'Company Profile')) return res.status(403).json({ error: 'Only someone who can see the company profile can see its integrations.', code: 'NOT_ALLOWED' });
  res.json(await workspaceIntegrations(req));
});
