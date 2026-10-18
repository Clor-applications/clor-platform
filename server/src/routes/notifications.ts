import { Router } from 'express';
import { z } from 'zod';

import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';

/**
 * The signed-in person's inbox for the organisation on screen. No permission
 * beyond membership: these rows were made for them. Read state is theirs.
 */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, requireTenantContext);

const base = '/orgs/:orgId/notifications/inbox';
const orgOk = (req: any, res: any) => {
  if (String(req.params.orgId) !== String(req.tenant?.orgId)) {
    res.status(403).json({ error: 'Organisation mismatch' });
    return false;
  }
  return true;
};
const shape = (n: { id: string; kind: string; title: string; body: string | null; linkJson: string | null; readAt: Date | null; createdAt: Date }) => {
  let link: unknown = null;
  try {
    link = n.linkJson ? JSON.parse(n.linkJson) : null;
  } catch {
    link = null;
  }
  return { id: n.id, kind: n.kind, title: n.title, body: n.body, link, readAt: n.readAt, createdAt: n.createdAt };
};

notificationsRouter.get(base, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const take = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const [rows, unread] = await Promise.all([
    platformPrisma.notification.findMany({ where: { orgId, userId }, orderBy: { createdAt: 'desc' }, take }),
    platformPrisma.notification.count({ where: { orgId, userId, readAt: null } }),
  ]);
  res.json({ unread, notifications: rows.map(shape) });
});

/** Mark some (or all) read. */
notificationsRouter.post(`${base}/read`, async (req, res) => {
  if (!orgOk(req, res)) return;
  const { orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const p = z.object({ ids: z.array(z.string().min(1)).max(200).optional(), all: z.boolean().optional() }).safeParse(req.body || {});
  if (!p.success) return res.status(400).json({ error: 'Say which notifications.' });
  const where = { orgId, userId, readAt: null, ...(p.data.all ? {} : { id: { in: p.data.ids || [] } }) };
  const r = await platformPrisma.notification.updateMany({ where, data: { readAt: new Date() } });
  const unread = await platformPrisma.notification.count({ where: { orgId, userId, readAt: null } });
  res.json({ marked: r.count, unread });
});

/** Kinds this person muted for this company. */
notificationsRouter.get(`${base}/mutes`, async (req, res) => {
  if (!orgOk(req, res)) return;
  const rows = await platformPrisma.notificationMute.findMany({ where: { orgId: req.tenant!.orgId, userId: req.auth!.userId }, orderBy: { createdAt: 'asc' } });
  res.json({ mutes: rows.map((r) => r.kind) });
});

/** Mute or unmute one kind: { kind, muted }. */
notificationsRouter.post(`${base}/mutes`, async (req, res) => {
  if (!orgOk(req, res)) return;
  const p = z.object({ kind: z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9._-]*$/), muted: z.boolean() }).safeParse(req.body || {});
  if (!p.success) return res.status(400).json({ error: 'Say which kind, and whether muted.' });
  const { accountId, orgId } = req.tenant!;
  const userId = req.auth!.userId;
  if (p.data.muted) await platformPrisma.notificationMute.upsert({ where: { userId_orgId_kind: { userId, orgId, kind: p.data.kind } }, create: { accountId, orgId, userId, kind: p.data.kind }, update: {} });
  else await platformPrisma.notificationMute.deleteMany({ where: { userId, orgId, kind: p.data.kind } });
  const rows = await platformPrisma.notificationMute.findMany({ where: { orgId, userId } });
  res.json({ mutes: rows.map((r) => r.kind) });
});
