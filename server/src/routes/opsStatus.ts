import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { operatorRole, operatorUserIds, requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { INCIDENT_STATES, MAINTENANCE_STATES, STATUS_PARTS, closingState, publicIncidents } from '../services/statusIncidents.js';
import { audit } from './ops.js';

/**
 * Incidents and planned maintenance on clor.in/status (OPS_PORTAL_GAPS #2).
 *
 * The status page checks the four stores by itself; it cannot know that
 * e-invoices are failing at the government portal, or that Payroll goes down
 * for ten minutes tonight. Support posts that here, adds updates as it goes,
 * and resolves it. Every operator reads; Support writes, with a fresh
 * authenticator code, because the page is public.
 *
 * Two things stay inside Ops and never reach the public page: who at CLOR is
 * handling it, and which customers are known to be hit. Those customers' pages
 * in Ops show the open incident, so whoever picks up their call knows.
 */
export const opsStatusRouter = Router();
opsStatusRouter.use('/ops/status-incidents', requireAuth, requireOperator);

const when = z.string().datetime({ offset: true }).transform((s) => new Date(s));
const opening = z
  .object({
    title: z.string().trim().min(4, 'Give it a short title.').max(120),
    kind: z.enum(['INCIDENT', 'MAINTENANCE']).default('INCIDENT'),
    parts: z.array(z.enum(STATUS_PARTS)).max(4).default([]).transform((a) => [...new Set(a)]),
    impact: z.enum(['MINOR', 'MAJOR', 'OUTAGE']).default('MINOR'),
    body: z.string().trim().min(10, 'Say what customers see and what to do.').max(1000),
    startsAt: when.optional(),
    endsAt: when.nullable().optional(),
    ownerUserId: z.string().trim().min(1).nullable().optional(),
    accountIds: z.array(z.string().trim().min(1)).max(200, 'At most 200 customers on one post.').optional(),
  })
  .refine((v) => !v.endsAt || !v.startsAt || v.endsAt > v.startsAt, { message: 'The end must come after the start.', path: ['endsAt'] });

const update = z.object({
  state: z.string().trim(),
  body: z.string().trim().min(4, 'Write the update.').max(1000),
  impact: z.enum(['MINOR', 'MAJOR', 'OUTAGE']).optional(),
});

const assigning = z.object({
  ownerUserId: z.string().trim().min(1).nullable().optional(),
  accountIds: z.array(z.string().trim().min(1)).max(200, 'At most 200 customers on one post.').optional(),
});

/** The handler must be CLOR staff and every customer must exist; says what is wrong, or null. */
async function internalProblem(ownerUserId: string | null | undefined, accountIds: string[] | undefined): Promise<string | null> {
  if (ownerUserId && !(await operatorRole(ownerUserId))) return 'That person is not active CLOR staff.';
  if (accountIds?.length) {
    const found = await platformPrisma.account.count({ where: { id: { in: accountIds } } });
    if (found !== new Set(accountIds).size) return 'One of those customers was not found.';
  }
  return null;
}

/** Names for the handler and the customers of many posts, in two reads. */
async function internalNames(rows: Array<{ ownerUserId: string | null; affectedAccountIds: string[] }>) {
  const userIds = [...new Set(rows.map((r) => r.ownerUserId).filter((x): x is string => Boolean(x)))];
  const accountIds = [...new Set(rows.flatMap((r) => r.affectedAccountIds))];
  const [users, accounts] = await Promise.all([
    userIds.length ? platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }) : [],
    accountIds.length ? platformPrisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, code: true } }) : [],
  ]);
  return { user: new Map(users.map((u) => [u.id, u.fullName || u.email])), account: new Map(accounts.map((a) => [a.id, a])) };
}
type Names = Awaited<ReturnType<typeof internalNames>>;

/** Everybody who can be given a post to handle: active staff, and the owners named in the environment. */
async function staffList() {
  const rows = await platformPrisma.platformOperator.findMany({ where: { active: true }, select: { userId: true } });
  const ids = [...new Set([...operatorUserIds(), ...rows.map((r) => r.userId)])];
  const users = await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true }, orderBy: { fullName: 'asc' } });
  return users.map((u) => ({ userId: u.id, name: u.fullName || u.email }));
}

const shape = (i: any, names: Names) => ({
  owner: i.ownerUserId ? { userId: i.ownerUserId, name: names.user.get(i.ownerUserId) || 'Somebody who has left' } : null,
  accounts: (i.affectedAccountIds as string[])
    .filter((id) => names.account.has(id))
    .map((id) => ({ id, name: names.account.get(id)!.name, code: names.account.get(id)!.code })),
  id: i.id,
  title: i.title,
  kind: i.kind,
  parts: i.parts,
  impact: i.impact,
  state: i.state,
  startsAt: i.startsAt,
  endsAt: i.endsAt,
  resolvedAt: i.resolvedAt,
  createdAt: i.createdAt,
  updates: (i.updates || []).map((u: any) => ({ id: u.id, state: u.state, body: u.body, createdAt: u.createdAt })),
});

const withUpdates = { updates: { orderBy: { createdAt: 'desc' as const } } };

/** Open ones first, then the last 50 resolved. */
opsStatusRouter.get('/ops/status-incidents', (_req, res) =>
  outsideTenant('ops: status incidents', async () => {
    const [open, closed] = await Promise.all([
      platformPrisma.statusIncident.findMany({ where: { resolvedAt: null }, orderBy: { startsAt: 'desc' }, include: withUpdates }),
      platformPrisma.statusIncident.findMany({ where: { resolvedAt: { not: null } }, orderBy: { resolvedAt: 'desc' }, take: 50, include: withUpdates }),
    ]);
    const names = await internalNames([...open, ...closed]);
    res.json({ open: open.map((i) => shape(i, names)), resolved: closed.map((i) => shape(i, names)), staff: await staffList(), public: await publicIncidents() });
  }),
);

opsStatusRouter.post('/ops/status-incidents', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: post a status incident', async () => {
    const parsed = opening.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields.', code: 'INVALID' });
    const v = parsed.data;
    const state = v.kind === 'MAINTENANCE' ? 'SCHEDULED' : 'INVESTIGATING';
    if (v.kind === 'MAINTENANCE' && !v.endsAt) return res.status(400).json({ error: 'Say when the maintenance ends.', code: 'INVALID' });
    const accountIds = [...new Set(v.accountIds || [])];
    const problem = await internalProblem(v.ownerUserId, accountIds);
    if (problem) return res.status(400).json({ error: problem, code: 'INVALID' });
    const made = await platformPrisma.statusIncident.create({
      data: {
        title: v.title,
        kind: v.kind,
        parts: v.parts,
        impact: v.impact,
        state,
        startsAt: v.startsAt ?? new Date(),
        endsAt: v.endsAt ?? null,
        createdByUserId: req.auth!.userId,
        /* Whoever posts it handles it, until it is handed to somebody else. */
        ownerUserId: v.ownerUserId === undefined ? req.auth!.userId : v.ownerUserId,
        affectedAccountIds: accountIds,
        updates: { create: { state, body: v.body, authorUserId: req.auth!.userId } },
      },
      include: withUpdates,
    });
    await audit(req, 'STATUS_INCIDENT_POSTED', {}, { incidentId: made.id, title: made.title, kind: made.kind });
    res.status(201).json({ incident: shape(made, await internalNames([made])) });
  }),
);

opsStatusRouter.post('/ops/status-incidents/:id/updates', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: update a status incident', async () => {
    const parsed = update.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Write the update.', code: 'INVALID' });
    const inc = await platformPrisma.statusIncident.findUnique({ where: { id: req.params.id } });
    if (!inc) return res.status(404).json({ error: 'No such incident.' });
    if (inc.resolvedAt) return res.status(409).json({ error: 'This one is resolved already.', code: 'RESOLVED' });
    const states: readonly string[] = inc.kind === 'MAINTENANCE' ? MAINTENANCE_STATES : INCIDENT_STATES;
    if (!states.includes(parsed.data.state)) return res.status(400).json({ error: 'Pick a state from the list.', code: 'INVALID' });
    const closes = parsed.data.state === closingState(inc.kind);
    const now = new Date();
    const saved = await platformPrisma.statusIncident.update({
      where: { id: inc.id },
      data: {
        state: parsed.data.state,
        ...(parsed.data.impact ? { impact: parsed.data.impact } : {}),
        ...(closes ? { resolvedAt: now } : {}),
        updates: { create: { state: parsed.data.state, body: parsed.data.body, authorUserId: req.auth!.userId } },
      },
      include: withUpdates,
    });
    await audit(req, closes ? 'STATUS_INCIDENT_RESOLVED' : 'STATUS_INCIDENT_UPDATED', {}, { incidentId: inc.id, state: parsed.data.state });
    res.json({ incident: shape(saved, await internalNames([saved])) });
  }),
);

/**
 * Who handles it and which customers it hits. Nothing here shows on the public
 * page, so it needs Support and no fresh code; it is audited all the same.
 */
opsStatusRouter.patch('/ops/status-incidents/:id', requireOperatorRole('SUPPORT'), (req, res) =>
  outsideTenant('ops: assign a status incident', async () => {
    const parsed = assigning.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields.', code: 'INVALID' });
    const inc = await platformPrisma.statusIncident.findUnique({ where: { id: req.params.id } });
    if (!inc) return res.status(404).json({ error: 'No such incident.' });
    if (inc.resolvedAt) return res.status(409).json({ error: 'This one is resolved already.', code: 'RESOLVED' });
    const accountIds = parsed.data.accountIds ? [...new Set(parsed.data.accountIds)] : undefined;
    const problem = await internalProblem(parsed.data.ownerUserId, accountIds);
    if (problem) return res.status(400).json({ error: problem, code: 'INVALID' });
    const saved = await platformPrisma.statusIncident.update({
      where: { id: inc.id },
      data: {
        ...(parsed.data.ownerUserId !== undefined ? { ownerUserId: parsed.data.ownerUserId } : {}),
        ...(accountIds ? { affectedAccountIds: accountIds } : {}),
      },
      include: withUpdates,
    });
    await audit(req, 'STATUS_INCIDENT_ASSIGNED', {}, { incidentId: inc.id, ownerUserId: saved.ownerUserId, accounts: saved.affectedAccountIds.length });
    res.json({ incident: shape(saved, await internalNames([saved])) });
  }),
);

/** A post made by mistake: removed, only while it is open. */
opsStatusRouter.delete('/ops/status-incidents/:id', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: remove a status incident', async () => {
    const inc = await platformPrisma.statusIncident.findUnique({ where: { id: req.params.id } });
    if (!inc) return res.status(404).json({ error: 'No such incident.' });
    if (inc.resolvedAt) return res.status(409).json({ error: 'A resolved one stays in the history.', code: 'RESOLVED' });
    await platformPrisma.statusIncident.delete({ where: { id: inc.id } });
    await audit(req, 'STATUS_INCIDENT_REMOVED', {}, { incidentId: inc.id, title: inc.title });
    res.json({ ok: true });
  }),
);
