import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';

/**
 * Reading the audit trail.
 *
 * The trail has been written since the invoice routes were built — seven write
 * sites across invoices, users, permissions and feature settings — and there
 * was no way to read a single row of it. An accounting product that records who
 * changed what and cannot show anyone is not keeping an audit trail; it is
 * filling a table.
 *
 * Read-only on purpose, and not by omission: an audit trail that its own
 * product can edit is evidence of nothing. There is no route here that writes,
 * updates or deletes a row, and there should never be one.
 */
export const auditRouter = Router();
auditRouter.use(requireAuth, requireTenantContext);

const AUDIT_VIEW = requirePermission('SETTINGS', PermissionAction.VIEW, 'Audit trail');

const querySchema = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
  action: z.string().max(40).optional(),
  userId: z.string().max(60).optional(),
  /** ISO dates, inclusive. `to` covers the whole day, not midnight. */
  from: z.string().max(30).optional(),
  to: z.string().max(30).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(60).optional(),
});

auditRouter.get('/orgs/:orgId/audit', AUDIT_VIEW, async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    return res.status(403).json({ error: 'orgId mismatch' });
  }
  const { accountId, orgId } = req.tenant!;
  const q = querySchema.parse(req.query);
  const limit = q.limit ?? 50;

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (q.from) {
    const d = new Date(`${q.from}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) createdAt.gte = d;
  }
  if (q.to) {
    // The whole of the closing day. Without this, "to = today" returns nothing
    // that happened today, which reads as a missing entry rather than a filter.
    const d = new Date(`${q.to}T23:59:59.999Z`);
    if (!Number.isNaN(d.getTime())) createdAt.lte = d;
  }

  const where = {
    accountId,
    orgId,
    ...(q.entity ? { entity: q.entity } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.action ? { action: q.action } : {}),
    ...(q.userId ? { createdByUserId: q.userId } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(q.q ? { message: { contains: q.q } } : {}),
  };

  /*
   * One row more than asked for, to know whether there is another page without
   * a second count query over a table that only grows.
   */
  const rows = await platformPrisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: { createdBy: { select: { id: true, fullName: true, email: true } } },
  });

  const page = rows.slice(0, limit);
  res.json({
    entries: page.map((r) => {
      let metadata: unknown = null;
      try {
        metadata = r.metadata ? JSON.parse(r.metadata) : null;
      } catch {
        // A row whose metadata will not parse still says who did what and when,
        // and those are the parts an auditor asks about.
        metadata = null;
      }
      return {
        id: r.id,
        entity: r.entity,
        entityId: r.entityId,
        action: r.action,
        message: r.message || '',
        metadata,
        at: r.createdAt,
        by: r.createdBy ? { id: r.createdBy.id, name: r.createdBy.fullName, email: r.createdBy.email } : null,
      };
    }),
    nextCursor: rows.length > limit ? page[page.length - 1]?.id || null : null,
  });
});

/** What the filters can offer, taken from the rows that actually exist. */
auditRouter.get('/orgs/:orgId/audit/facets', AUDIT_VIEW, async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) {
    return res.status(403).json({ error: 'orgId mismatch' });
  }
  const { accountId, orgId } = req.tenant!;
  /*
   * groupBy rather than findMany with `distinct`.
   *
   * The trail only grows, and a distinct read of it is a read of all of it —
   * the filter dropdown would get slower every month and eventually be the
   * heaviest query on the screen. A group-by is answered by the database
   * rather than by fetching rows and reducing them here.
   */
  const [entities, actions] = await Promise.all([
    platformPrisma.auditLog.groupBy({ by: ['entity'], where: { accountId, orgId } }),
    platformPrisma.auditLog.groupBy({ by: ['action'], where: { accountId, orgId } }),
  ]);
  res.json({
    entities: entities.map((e) => e.entity).sort(),
    actions: actions.map((a) => a.action).sort(),
  });
});

export default auditRouter;
