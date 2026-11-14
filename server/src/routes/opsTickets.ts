import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { PRIORITIES, STATUSES, staffReply, staffTicket, ticketCode } from '../services/support/tickets.js';
import { audit } from './ops.js';

/**
 * Customer tickets on the operator console (Ops plan P1). Every operator can
 * read them; Support answers and changes them, with a fresh authenticator
 * code like every console change. A reply is written as the operator (their
 * own identity), shown to the customer as "CLOR support".
 */
export const opsTicketsRouter = Router();
opsTicketsRouter.use('/ops/tickets', requireAuth, requireOperator);

const listQuery = z.object({
  status: z.enum(['active', ...STATUSES]).optional(),
  accountId: z.string().trim().max(64).optional(),
  mine: z.enum(['1']).optional(),
  q: z.string().trim().max(120).optional(),
});

/** Oldest waiting first among the active ones, so nobody is left the longest. */
opsTicketsRouter.get('/ops/tickets', (req, res) =>
  outsideTenant('ops: tickets', async () => {
    const q = listQuery.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Check the filters.' });
    const { status = 'active', accountId, mine, q: text } = q.data;
    const where: any = {};
    if (status === 'active') where.status = { in: ['OPEN', 'WAITING'] };
    else where.status = status;
    if (accountId) where.accountId = accountId;
    if (mine) where.assignedOperatorId = req.auth!.userId;
    if (text) {
      const n = Number(text.replace(/^t-?/i, ''));
      where.OR = [{ subject: { contains: text, mode: 'insensitive' } }, ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : [])];
    }
    const rows = await platformPrisma.supportTicket.findMany({ where, orderBy: status === 'active' ? [{ updatedAt: 'asc' }] : [{ updatedAt: 'desc' }], take: 200 });
    const [open, waiting, mineOpen] = await Promise.all([
      platformPrisma.supportTicket.count({ where: { status: 'OPEN' } }),
      platformPrisma.supportTicket.count({ where: { status: 'WAITING' } }),
      platformPrisma.supportTicket.count({ where: { status: 'OPEN', assignedOperatorId: req.auth!.userId } }),
    ]);
    res.json({ tickets: await Promise.all(rows.map((t) => staffTicket(t))), counts: { open, waiting, mine: mineOpen } });
  }),
);

opsTicketsRouter.get('/ops/tickets/:id', (req, res) =>
  outsideTenant('ops: one ticket', async () => {
    const t = await platformPrisma.supportTicket.findUnique({ where: { id: String(req.params.id) }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!t) return res.status(404).json({ error: 'No such ticket.' });
    res.json({ ticket: await staffTicket(t) });
  }),
);

const replySchema = z.object({
  body: z.string().trim().min(1, 'Write a reply.').max(8000),
  internal: z.boolean().optional(),
  solve: z.boolean().optional(),
  /* The saved reply it started from, if any (routes/opsSavedReplies.ts): counted, so the list puts the useful ones first. */
  savedReplyId: z.string().trim().max(64).optional(),
});

opsTicketsRouter.post('/ops/tickets/:id/reply', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: answer a ticket', async () => {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const t = await platformPrisma.supportTicket.findUnique({ where: { id: String(req.params.id) } });
    if (!t) return res.status(404).json({ error: 'No such ticket.' });
    if (t.status === 'CLOSED' && !parsed.data.internal) return res.status(409).json({ error: 'This ticket is closed. Add an internal note, or open it again first.' });
    const internal = Boolean(parsed.data.internal);
    const r = await staffReply(t, req.auth!.userId, parsed.data.body, internal, !internal && Boolean(parsed.data.solve));
    if (parsed.data.savedReplyId) await platformPrisma.supportSavedReply.updateMany({ where: { id: parsed.data.savedReplyId }, data: { usedCount: { increment: 1 } } });
    await audit(req, internal ? 'TICKET_NOTE' : 'TICKET_REPLIED', { accountId: t.accountId }, { ticket: ticketCode(t.number), solved: Boolean(parsed.data.solve), told: r.told }, { customerLog: false });
    const fresh = await platformPrisma.supportTicket.findUnique({ where: { id: t.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    res.json({ ticket: await staffTicket(fresh), told: r.told });
  }),
);

const changeSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    /** An operator's user id, or null to unassign. */
    assignedOperatorId: z.string().trim().max(64).nullable().optional(),
  })
  .refine((v) => v.status || v.priority || v.assignedOperatorId !== undefined, 'Nothing to change.');

opsTicketsRouter.patch('/ops/tickets/:id', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: change a ticket', async () => {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
    const t = await platformPrisma.supportTicket.findUnique({ where: { id: String(req.params.id) } });
    if (!t) return res.status(404).json({ error: 'No such ticket.' });
    const d = parsed.data;
    if (d.assignedOperatorId) {
      const op = await platformPrisma.platformOperator.findUnique({ where: { userId: d.assignedOperatorId }, select: { active: true } });
      if (!op?.active) return res.status(400).json({ error: 'That person is not active CLOR staff.' });
    }
    const data: any = {};
    if (d.status) {
      data.status = d.status;
      data.solvedAt = d.status === 'SOLVED' || d.status === 'CLOSED' ? t.solvedAt || new Date() : null;
    }
    if (d.priority) data.priority = d.priority;
    if (d.assignedOperatorId !== undefined) data.assignedOperatorId = d.assignedOperatorId;
    const updated = await platformPrisma.supportTicket.update({ where: { id: t.id }, data, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    await audit(req, 'TICKET_CHANGED', { accountId: t.accountId }, { ticket: ticketCode(t.number), from: { status: t.status, priority: t.priority, assigned: t.assignedOperatorId }, to: d }, { customerLog: false });
    res.json({ ticket: await staffTicket(updated) });
  }),
);
