import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { ticketCode } from '../services/support/tickets.js';
import { audit } from './ops.js';

/**
 * Saved replies for support tickets (OPS_PORTAL_GAPS #3): the answers Support
 * gives again and again, kept once and picked in the reply box. {name} becomes
 * the customer's first name and {ticket} the ticket's code. Every operator
 * reads them; Support writes them.
 */
export const opsSavedRepliesRouter = Router();
opsSavedRepliesRouter.use('/ops/saved-replies', requireAuth, requireOperator);

export const SAVED_REPLY_APPS = ['accounting', 'people', 'attendance', 'payroll', 'workspace'] as const;
const fields = z.object({
  title: z.string().trim().min(3, 'Give it a short title.').max(80),
  body: z.string().trim().min(10, 'Write the reply.').max(4000),
  app: z.enum(SAVED_REPLY_APPS).nullable().optional(),
});

/** {name} and {ticket} filled in for one ticket; left as they are without one. */
export function fillReply(body: string, who: { name?: string | null; ticket?: string | null }) {
  const first = String(who.name || '').trim().split(/\s+/)[0] || 'there';
  return body.replace(/\{name\}/g, first).replace(/\{ticket\}/g, who.ticket || 'your ticket');
}

const shape = (r: any, filled?: string) => ({ id: r.id, title: r.title, body: r.body, app: r.app, usedCount: r.usedCount, updatedAt: r.updatedAt, ...(filled !== undefined ? { filled } : {}) });

/** Most used first. With ?ticket=<id>, each also comes filled in for that ticket, and the ticket's app ones lead. */
opsSavedRepliesRouter.get('/ops/saved-replies', (req, res) =>
  outsideTenant('ops: saved replies', async () => {
    const rows = await platformPrisma.supportSavedReply.findMany({ orderBy: [{ usedCount: 'desc' }, { title: 'asc' }], take: 300 });
    const ticketId = typeof req.query.ticket === 'string' ? req.query.ticket : '';
    if (!ticketId) return res.json({ replies: rows.map((r) => shape(r)) });
    const t = await platformPrisma.supportTicket.findUnique({ where: { id: ticketId }, select: { number: true, app: true, openedByUserId: true } });
    if (!t) return res.status(404).json({ error: 'No such ticket.' });
    const who = await platformPrisma.user.findUnique({ where: { id: t.openedByUserId }, select: { fullName: true } });
    const fits = (r: { app: string | null }) => (r.app && r.app === t.app ? 0 : r.app ? 2 : 1);
    const sorted = [...rows].sort((a, b) => fits(a) - fits(b));
    res.json({ replies: sorted.map((r) => shape(r, fillReply(r.body, { name: who?.fullName, ticket: ticketCode(t.number) }))) });
  }),
);

const taken = (err: any) => String(err?.code || '') === 'P2002';
const TAKEN = { error: 'A saved reply has this title already.', code: 'TITLE_TAKEN' };

opsSavedRepliesRouter.post('/ops/saved-replies', requireOperatorRole('SUPPORT'), (req, res) =>
  outsideTenant('ops: add a saved reply', async () => {
    const parsed = fields.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields.', code: 'INVALID' });
    try {
      const r = await platformPrisma.supportSavedReply.create({ data: { ...parsed.data, app: parsed.data.app ?? null, createdByUserId: req.auth!.userId, updatedByUserId: req.auth!.userId } });
      await audit(req, 'SAVED_REPLY_ADDED', {}, { id: r.id, title: r.title });
      res.status(201).json({ reply: shape(r) });
    } catch (err) {
      if (taken(err)) return res.status(409).json(TAKEN);
      throw err;
    }
  }),
);

opsSavedRepliesRouter.patch('/ops/saved-replies/:id', requireOperatorRole('SUPPORT'), (req, res) =>
  outsideTenant('ops: change a saved reply', async () => {
    const parsed = fields.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields.', code: 'INVALID' });
    const had = await platformPrisma.supportSavedReply.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!had) return res.status(404).json({ error: 'No such saved reply.' });
    try {
      const r = await platformPrisma.supportSavedReply.update({ where: { id: had.id }, data: { ...parsed.data, updatedByUserId: req.auth!.userId } });
      await audit(req, 'SAVED_REPLY_CHANGED', {}, { id: r.id, title: r.title });
      res.json({ reply: shape(r) });
    } catch (err) {
      if (taken(err)) return res.status(409).json(TAKEN);
      throw err;
    }
  }),
);

opsSavedRepliesRouter.delete('/ops/saved-replies/:id', requireOperatorRole('SUPPORT'), (req, res) =>
  outsideTenant('ops: remove a saved reply', async () => {
    const had = await platformPrisma.supportSavedReply.findUnique({ where: { id: req.params.id }, select: { id: true, title: true } });
    if (!had) return res.status(404).json({ error: 'No such saved reply.' });
    await platformPrisma.supportSavedReply.delete({ where: { id: had.id } });
    await audit(req, 'SAVED_REPLY_REMOVED', {}, { id: had.id, title: had.title });
    res.json({ ok: true });
  }),
);
