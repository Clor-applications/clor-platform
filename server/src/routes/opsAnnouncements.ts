import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { ANNOUNCEMENT_APPS, AUDIENCES, KINDS, statusOf } from '../services/announcements.js';
import { audit } from './ops.js';

/**
 * Announcements on the operator console (Ops plan P1, item 4). Every operator
 * can read them; Support writes, publishes and ends them, each with a fresh
 * authenticator code and an audit line under the operator's own name.
 * Customers see live ones through routes/announcements.ts.
 */
export const opsAnnouncementsRouter = Router();
opsAnnouncementsRouter.use('/ops/announcements', requireAuth, requireOperator);

const when = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));

const fields = z.object({
  title: z.string().trim().min(4, 'Give it a short title.').max(120),
  body: z.string().trim().min(10, 'Say a little more: what, when, and what people should do.').max(600),
  kind: z.enum(KINDS).default('info'),
  apps: z
    .array(z.string())
    .max(10)
    .default([])
    .refine((a) => a.every((x) => (ANNOUNCEMENT_APPS as string[]).includes(x)), 'Pick apps from the list.')
    .transform((a) => [...new Set(a)]),
  audience: z.enum(AUDIENCES).default('everyone'),
  startsAt: when.nullable().optional(),
  endsAt: when.nullable().optional(),
});

/** The optional "why" from the console, kept in the audit line. */
const why = (req: any) => (typeof req.body?.reason === 'string' && req.body.reason.trim() ? { reason: req.body.reason.trim().slice(0, 300) } : {});

const timesOk = (startsAt: Date, endsAt: Date | null | undefined) => !endsAt || endsAt > startsAt;
const TIMES = 'The end must come after the start.';

const shape = (a: any, names: Map<string, string>, now = new Date()) => ({
  id: a.id,
  title: a.title,
  body: a.body,
  kind: a.kind,
  apps: a.apps,
  audience: a.audience,
  startsAt: a.startsAt,
  endsAt: a.endsAt,
  publishedAt: a.publishedAt,
  endedAt: a.endedAt,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  status: statusOf(a, now),
  closedBy: a._count?.dismissals ?? 0,
  writtenBy: names.get(a.createdByUserId) || 'CLOR staff',
});

const names = async (rows: Array<{ createdByUserId: string }>) => {
  const ids = [...new Set(rows.map((r) => r.createdByUserId))];
  const users = ids.length ? await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } }) : [];
  return new Map(users.map((u) => [u.id, u.fullName || u.email]));
};

const one = (id: string) => platformPrisma.announcement.findUnique({ where: { id }, include: { _count: { select: { dismissals: true } } } });

/** Newest first; the console splits them into live, scheduled, drafts and ended. */
opsAnnouncementsRouter.get('/ops/announcements', (req, res) =>
  outsideTenant('ops: announcements', async () => {
    const rows = await platformPrisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { _count: { select: { dismissals: true } } } });
    const n = await names(rows);
    const now = new Date();
    const list = rows.map((r) => shape(r, n, now));
    const counts = { live: 0, scheduled: 0, draft: 0, ended: 0 } as Record<string, number>;
    for (const a of list) counts[a.status] += 1;
    res.json({ announcements: list, counts, apps: ANNOUNCEMENT_APPS });
  }),
);

/** A new draft. Nobody sees it until it is published. */
opsAnnouncementsRouter.post('/ops/announcements', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: write an announcement', async () => {
    const p = fields.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the announcement.' });
    const startsAt = p.data.startsAt || new Date();
    if (!timesOk(startsAt, p.data.endsAt)) return res.status(400).json({ error: TIMES });
    const a = await platformPrisma.announcement.create({
      data: { title: p.data.title, body: p.data.body, kind: p.data.kind, apps: p.data.apps, audience: p.data.audience, startsAt, endsAt: p.data.endsAt ?? null, createdByUserId: req.auth!.userId },
      include: { _count: { select: { dismissals: true } } },
    });
    await audit(req, 'ANNOUNCEMENT_WRITTEN', {}, { title: a.title, kind: a.kind }, { customerLog: false });
    res.status(201).json({ announcement: shape(a, await names([a])) });
  }),
);

/** Change the words or times. An ended announcement stays as it was. */
opsAnnouncementsRouter.patch('/ops/announcements/:id', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: change an announcement', async () => {
    const was = await one(String(req.params.id));
    if (!was) return res.status(404).json({ error: 'No such announcement.' });
    if (statusOf(was) === 'ended') return res.status(409).json({ error: 'It has ended. Write a new one instead.' });
    const p = fields.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Check the announcement.' });
    const startsAt = p.data.startsAt === undefined ? was.startsAt : p.data.startsAt || new Date();
    const endsAt = p.data.endsAt === undefined ? was.endsAt : p.data.endsAt;
    if (!timesOk(startsAt, endsAt)) return res.status(400).json({ error: TIMES });
    const { startsAt: _s, endsAt: _e, ...rest } = p.data;
    const a = await platformPrisma.announcement.update({
      where: { id: was.id },
      data: { ...rest, startsAt, endsAt, updatedByUserId: req.auth!.userId },
      include: { _count: { select: { dismissals: true } } },
    });
    await audit(req, 'ANNOUNCEMENT_CHANGED', {}, { title: a.title, status: statusOf(a) }, { customerLog: false });
    res.json({ announcement: shape(a, await names([a])) });
  }),
);

/** Publish a draft: it shows from its start time. */
opsAnnouncementsRouter.post('/ops/announcements/:id/publish', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: publish an announcement', async () => {
    const was = await one(String(req.params.id));
    if (!was) return res.status(404).json({ error: 'No such announcement.' });
    if (was.publishedAt) return res.status(409).json({ error: 'It is already published.' });
    if (was.endsAt && was.endsAt <= new Date()) return res.status(409).json({ error: 'Its end time has passed. Change the times first.' });
    /* Conditional, so two people publishing at once cannot both count. */
    const done = await platformPrisma.announcement.updateMany({ where: { id: was.id, publishedAt: null }, data: { publishedAt: new Date(), updatedByUserId: req.auth!.userId } });
    if (!done.count) return res.status(409).json({ error: 'It is already published.' });
    const a = (await one(was.id))!;
    await audit(req, 'ANNOUNCEMENT_PUBLISHED', {}, { ...{ title: a.title, kind: a.kind, apps: a.apps.join(', ') || 'all apps', audience: a.audience }, ...why(req) }, { customerLog: false });
    res.json({ announcement: shape(a, await names([a])) });
  }),
);

/** Take it down now, for everyone. */
opsAnnouncementsRouter.post('/ops/announcements/:id/end', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: end an announcement', async () => {
    const was = await one(String(req.params.id));
    if (!was) return res.status(404).json({ error: 'No such announcement.' });
    if (!was.publishedAt) return res.status(409).json({ error: 'A draft is not showing. Delete it instead.' });
    if (statusOf(was) === 'ended') return res.status(409).json({ error: 'It has already ended.' });
    const a = await platformPrisma.announcement.update({ where: { id: was.id }, data: { endedAt: new Date(), updatedByUserId: req.auth!.userId }, include: { _count: { select: { dismissals: true } } } });
    await audit(req, 'ANNOUNCEMENT_ENDED', {}, { ...{ title: a.title }, ...why(req) }, { customerLog: false });
    res.json({ announcement: shape(a, await names([a])) });
  }),
);

/** Only a draft can be deleted; anything customers saw stays on record. */
opsAnnouncementsRouter.delete('/ops/announcements/:id', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: delete a draft announcement', async () => {
    const was = await one(String(req.params.id));
    if (!was) return res.status(404).json({ error: 'No such announcement.' });
    if (was.publishedAt) return res.status(409).json({ error: 'Customers have seen it. End it instead.' });
    await platformPrisma.announcement.delete({ where: { id: was.id } });
    await audit(req, 'ANNOUNCEMENT_DELETED', {}, { ...{ title: was.title }, ...why(req) }, { customerLog: false });
    res.json({ deleted: true });
  }),
);
