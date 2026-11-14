import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
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
  })
  .refine((v) => !v.endsAt || !v.startsAt || v.endsAt > v.startsAt, { message: 'The end must come after the start.', path: ['endsAt'] });

const update = z.object({
  state: z.string().trim(),
  body: z.string().trim().min(4, 'Write the update.').max(1000),
  impact: z.enum(['MINOR', 'MAJOR', 'OUTAGE']).optional(),
});

const shape = (i: any) => ({
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
    res.json({ open: open.map(shape), resolved: closed.map(shape), public: await publicIncidents() });
  }),
);

opsStatusRouter.post('/ops/status-incidents', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: post a status incident', async () => {
    const parsed = opening.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields.', code: 'INVALID' });
    const v = parsed.data;
    const state = v.kind === 'MAINTENANCE' ? 'SCHEDULED' : 'INVESTIGATING';
    if (v.kind === 'MAINTENANCE' && !v.endsAt) return res.status(400).json({ error: 'Say when the maintenance ends.', code: 'INVALID' });
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
        updates: { create: { state, body: v.body, authorUserId: req.auth!.userId } },
      },
      include: withUpdates,
    });
    await audit(req, 'STATUS_INCIDENT_POSTED', {}, { incidentId: made.id, title: made.title, kind: made.kind });
    res.status(201).json({ incident: shape(made) });
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
    res.json({ incident: shape(saved) });
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
