import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { accountRoleOf } from '../services/accountMembership.js';
import { REQUEST_ID } from '../utils/log.js';
import { APPS, CATEGORIES, TicketError, customerReply, customerSolved, customerTicket, openTicket, ticketForCustomer, ticketsFor } from '../services/support/tickets.js';

/**
 * Help and support in the Workspace (Ops plan P1, customer tickets). Anyone
 * signed in to the account may ask CLOR for help and follow their own
 * tickets; the account's owners and administrators follow every ticket the
 * account opened. CLOR answers from ops.clor.in (routes/opsTickets.ts).
 */
export const supportRouter = Router();
supportRouter.use('/support', requireAuth, requireTenantContext);

const wholeAccount = async (req: any) => {
  const role = await accountRoleOf(req.tenant.accountId, req.auth.userId);
  return role === 'OWNER' || role === 'ADMIN';
};

const fail = (res: any, e: unknown) => {
  if (e instanceof TicketError) return res.status(e.status).json({ error: e.message });
  throw e;
};

const openSchema = z.object({
  subject: z.string().trim().min(4, 'Say in a few words what it is about.').max(160),
  body: z.string().trim().min(10, 'Tell us a little more, so we can help first time.').max(8000),
  category: z.enum(CATEGORIES).default('QUESTION'),
  app: z.enum(APPS).nullable().optional(),
  urgent: z.boolean().optional(),
  requestId: z
    .string()
    .trim()
    .max(80)
    .optional()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || REQUEST_ID.test(v), 'That does not look like an error code. Copy it exactly as shown, or leave it empty.'),
});

supportRouter.get('/support/tickets', async (req, res) => {
  const all = await wholeAccount(req);
  const rows = await ticketsFor(req.tenant!.accountId, req.auth!.userId, all);
  res.json({ wholeAccount: all, tickets: await Promise.all(rows.map((t) => customerTicket(t))) });
});

supportRouter.post('/support/tickets', async (req, res) => {
  const parsed = openSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the form.' });
  try {
    const t = await openTicket({ accountId: req.tenant!.accountId, orgId: req.tenant!.orgId || null, userId: req.auth!.userId, ...parsed.data, app: parsed.data.app ?? null, urgent: Boolean(parsed.data.urgent) });
    res.status(201).json({ ticket: await customerTicket(t) });
  } catch (e) {
    fail(res, e);
  }
});

supportRouter.get('/support/tickets/:id', async (req, res) => {
  try {
    const t = await ticketForCustomer(req.tenant!.accountId, req.auth!.userId, await wholeAccount(req), String(req.params.id));
    res.json({ ticket: await customerTicket(t) });
  } catch (e) {
    fail(res, e);
  }
});

const replySchema = z.object({ body: z.string().trim().min(1, 'Write a reply.').max(8000) });

supportRouter.post('/support/tickets/:id/reply', async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });
  try {
    const all = await wholeAccount(req);
    const t = await ticketForCustomer(req.tenant!.accountId, req.auth!.userId, all, String(req.params.id));
    await customerReply(t, req.auth!.userId, parsed.data.body);
    res.json({ ticket: await customerTicket(await ticketForCustomer(req.tenant!.accountId, req.auth!.userId, all, t.id)) });
  } catch (e) {
    fail(res, e);
  }
});

supportRouter.post('/support/tickets/:id/solved', async (req, res) => {
  try {
    const all = await wholeAccount(req);
    const t = await ticketForCustomer(req.tenant!.accountId, req.auth!.userId, all, String(req.params.id));
    await customerSolved(t);
    res.json({ ticket: await customerTicket(await ticketForCustomer(req.tenant!.accountId, req.auth!.userId, all, t.id)) });
  } catch (e) {
    fail(res, e);
  }
});
