import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { workspaceWaiting } from '../services/workspace/waiting.js';
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
