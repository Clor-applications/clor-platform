import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { DealError } from '../services/pricing/deals.js';
import { EXPIRES_HOURS, STATUS_WORDS, approvalSettings, saveApprovalSettings, statusOf } from '../services/ops/approvals.js';
import { accountNames, applyDeal, dealBody } from './opsDeals.js';
import { audit } from './ops.js';

/**
 * Approvals on the operator console: what a colleague asked for that needs a
 * second person (services/ops/approvals.ts). Everyone on the console reads.
 * Billing and the owner approve or turn down, never their own request, each
 * with a fresh authenticator code; the person who asked can withdraw it. Only
 * the owner changes the limit.
 */
export const opsApprovalsRouter = Router();
opsApprovalsRouter.use('/ops/approvals', requireAuth, requireOperator);

const note = z.string().trim().max(500).optional();
const SHOWN = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'FAILED'];

opsApprovalsRouter.get('/ops/approvals', (req, res) =>
  outsideTenant('ops: approvals', async () => {
    const want = typeof req.query.status === 'string' ? req.query.status : 'PENDING';
    const now = new Date();
    const where =
      want === 'PENDING'
        ? { status: 'PENDING', expiresAt: { gt: now } }
        : want === 'EXPIRED'
          ? { OR: [{ status: 'EXPIRED' }, { status: 'PENDING', expiresAt: { lte: now } }] }
          : want === 'DONE'
            ? { status: { in: ['APPROVED', 'REJECTED', 'CANCELLED', 'FAILED'] } }
            : SHOWN.includes(want)
              ? { status: want }
              : {};
    const rows = await platformPrisma.opsApproval.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const people = [...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy]).filter(Boolean) as string[])];
    const [users, names, settings, waiting] = await Promise.all([
      platformPrisma.user.findMany({ where: { id: { in: people } }, select: { id: true, fullName: true, email: true } }),
      accountNames(rows.map((r) => r.accountId)),
      approvalSettings(),
      platformPrisma.opsApproval.count({ where: { status: 'PENDING', expiresAt: { gt: now } } }),
    ]);
    const who = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    const me = req.auth!.userId;
    const role = res.locals.operatorRole as string;
    const canDecide = role === 'SUPER_ADMIN' || role === 'BILLING';
    res.json({
      limit: settings.discountPercent,
      expiresHours: EXPIRES_HOURS,
      waiting,
      canChangeLimit: role === 'SUPER_ADMIN',
      approvals: rows.map((r) => {
        const status = statusOf(r, now);
        return {
          id: r.id,
          kind: r.kind,
          accountId: r.accountId,
          customer: r.accountId ? names.get(r.accountId) || 'A customer' : null,
          summary: r.summary,
          discountPercent: r.discountPercent,
          reason: r.reason,
          status,
          statusWord: STATUS_WORDS[status] || status,
          askedBy: who.get(r.requestedBy) || 'A colleague',
          mine: r.requestedBy === me,
          decidedBy: r.decidedBy ? who.get(r.decidedBy) || 'A colleague' : null,
          decidedAt: r.decidedAt,
          decisionNote: r.decisionNote,
          result: r.result,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
          canDecide: status === 'PENDING' && canDecide && r.requestedBy !== me,
          canWithdraw: status === 'PENDING' && (r.requestedBy === me || role === 'SUPER_ADMIN'),
        };
      }),
    });
  }),
);

/** The request, if it can still be decided; otherwise the plain reason it cannot. */
type Opened = { error: string; status: number } | { a: NonNullable<Awaited<ReturnType<typeof platformPrisma.opsApproval.findUnique>>>; self: boolean };
async function open(id: string, me: string): Promise<Opened> {
  const a = await platformPrisma.opsApproval.findUnique({ where: { id } });
  if (!a) return { error: 'No such request.', status: 404 };
  const s = statusOf(a);
  if (s === 'EXPIRED') {
    if (a.status === 'PENDING') await platformPrisma.opsApproval.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    return { error: `This request waited more than ${EXPIRES_HOURS} hours and has expired. Ask again, with the prices as they are now.`, status: 409 };
  }
  if (s !== 'PENDING') return { error: `This request is already ${(STATUS_WORDS[s] || s).toLowerCase()}.`, status: 409 };
  return { a, self: a.requestedBy === me };
}

opsApprovalsRouter.post('/ops/approvals/:id/approve', requireOperatorRole('BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: approve a request', async () => {
    const me = req.auth!.userId;
    const p = z.object({ note }).safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ error: 'The note is at most 500 characters.' });
    const o = await open(String(req.params.id), me);
    if ('error' in o) return res.status(o.status).json({ error: o.error });
    if (o.self) return res.status(403).json({ error: 'Someone other than the person who asked must approve it.', code: 'SAME_PERSON' });
    const a = o.a;
    /* Take the request first, so two approvers cannot both apply it. */
    const taken = await platformPrisma.opsApproval.updateMany({ where: { id: a.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedBy: me, decidedAt: new Date(), decisionNote: p.data.note || null } });
    if (!taken.count) return res.status(409).json({ error: 'Someone decided this a moment ago. Open Approvals again.' });
    const asker = await platformPrisma.user.findUnique({ where: { id: a.requestedBy }, select: { fullName: true, email: true } });
    const askedBy = asker?.fullName || asker?.email || a.requestedBy;
    try {
      const body = dealBody.parse(a.payload);
      if (!a.accountId) throw new DealError('The request names no customer.', 409);
      const r = await applyDeal(a.accountId, body, me);
      await platformPrisma.opsApproval.update({ where: { id: a.id }, data: { result: { invoiceId: r.invoiceId } } });
      await audit(req, 'APPROVAL_GRANTED', { accountId: a.accountId }, { approvalId: a.id, what: a.summary, askedBy, note: p.data.note || undefined }, { customerLog: false });
      await audit(req, 'SUBSCRIPTION_DEAL_SET', { accountId: a.accountId }, { ...r.record, askedBy, approvedAfterRequest: a.id });
      res.json({ status: 'APPROVED', deal: r.deal, invoiceId: r.invoiceId });
    } catch (e) {
      const why = e instanceof DealError ? e.message : e instanceof z.ZodError ? 'The request could not be read.' : null;
      if (!why) {
        await platformPrisma.opsApproval.update({ where: { id: a.id }, data: { status: 'FAILED', result: { error: 'Something went wrong while applying it.' } } });
        throw e;
      }
      await platformPrisma.opsApproval.update({ where: { id: a.id }, data: { status: 'FAILED', result: { error: why } } });
      await audit(req, 'APPROVAL_FAILED', { accountId: a.accountId }, { approvalId: a.id, what: a.summary, reason: why }, { customerLog: false });
      res.status(409).json({ error: `Approved, but it could not be applied: ${why} Ask again with a deal that works now.` });
    }
  }),
);

opsApprovalsRouter.post('/ops/approvals/:id/reject', requireOperatorRole('BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: turn down a request', async () => {
    const me = req.auth!.userId;
    const p = z.object({ note: z.string().trim().min(3, 'Say why, in a sentence.').max(500) }).safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message || 'Say why, in a sentence.' });
    const o = await open(String(req.params.id), me);
    if ('error' in o) return res.status(o.status).json({ error: o.error });
    if (o.self) return res.status(403).json({ error: 'You asked for this. Withdraw it instead.', code: 'SAME_PERSON' });
    const done = await platformPrisma.opsApproval.updateMany({ where: { id: o.a.id, status: 'PENDING' }, data: { status: 'REJECTED', decidedBy: me, decidedAt: new Date(), decisionNote: p.data.note } });
    if (!done.count) return res.status(409).json({ error: 'Someone decided this a moment ago. Open Approvals again.' });
    await audit(req, 'APPROVAL_REJECTED', { accountId: o.a.accountId }, { approvalId: o.a.id, what: o.a.summary, note: p.data.note }, { customerLog: false });
    res.json({ status: 'REJECTED' });
  }),
);

opsApprovalsRouter.post('/ops/approvals/:id/withdraw', (req, res) =>
  outsideTenant('ops: withdraw a request', async () => {
    const me = req.auth!.userId;
    const o = await open(String(req.params.id), me);
    if ('error' in o) return res.status(o.status).json({ error: o.error });
    if (!o.self && res.locals.operatorRole !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Only the person who asked can withdraw it.' });
    const done = await platformPrisma.opsApproval.updateMany({ where: { id: o.a.id, status: 'PENDING' }, data: { status: 'CANCELLED', decidedBy: me, decidedAt: new Date() } });
    if (!done.count) return res.status(409).json({ error: 'Someone decided this a moment ago. Open Approvals again.' });
    await audit(req, 'APPROVAL_WITHDRAWN', { accountId: o.a.accountId }, { approvalId: o.a.id, what: o.a.summary }, { customerLog: false });
    res.json({ status: 'CANCELLED' });
  }),
);

/** The limit: a deal taking off more than this share of the list price needs a second person. Owner only. */
opsApprovalsRouter.put('/ops/approvals/settings', requireOperatorRole('SUPER_ADMIN'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: approval limit', async () => {
    const p = z.object({ discountPercent: z.number().int().min(0).max(90), reason: z.string().trim().min(3, 'Say why, in a sentence.').max(500) }).safeParse(req.body ?? {});
    if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.path[0] === 'reason' ? 'Say why, in a sentence.' : 'The limit is a whole percent from 0 to 90.' });
    const before = await approvalSettings();
    const after = await saveApprovalSettings(p.data.discountPercent, req.auth!.userId);
    await audit(req, 'APPROVAL_LIMIT_CHANGED', {}, { from: `${before.discountPercent}%`, to: `${after.discountPercent}%`, reason: p.data.reason });
    res.json(after);
  }),
);
