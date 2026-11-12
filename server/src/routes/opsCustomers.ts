import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { clearAccessCache } from '../utils/accessCache.js';
import { clientIp, issuePasswordResetToken, revokeAllSessions } from '../services/auth.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { getSubscription, setSubscription, syncAccountEntitlement } from '../services/subscriptions.js';
import { InvitationError, resendInvitation } from '../services/accountInvitations.js';
import { deliver, sendTemplate } from '../services/mailer.js';
import { SELLABLE_APP_CODES } from '../constants/appCatalog.js';
import { operatorActionLabel } from '../constants/operatorActions.js';
import { audit } from './ops.js';
import { accountTimeline } from '../services/ops/timeline.js';
import { ticketCode } from '../services/support/tickets.js';

/**
 * One page per customer (operator console, Customers; roadmap item 13): the
 * parts of a customer's page that are not on GET /ops/accounts/:id — their
 * payments, their requests, their users and everything that happened — and
 * what CLOR staff may do from it.
 *
 * Account metadata only, as everywhere in the console: never a customer's
 * books, people or payroll. Every change needs a fresh authenticator code, a
 * reason, and is written to the operator record and to the customer's own
 * security log (ops.ts audit()).
 */
export const opsCustomersRouter = Router();
opsCustomersRouter.use('/ops/accounts', requireAuth, requireOperator);

const reasonBody = z.object({ reason: z.string().trim().min(3).max(500) });
const SAY_WHY = 'Say why, in a sentence.';

const accountOr404 = async (id: string) => platformPrisma.account.findUnique({ where: { id }, select: { id: true, name: true } });

/* ---------------------------------------------------------- subscription */

const appsBody = reasonBody.extend({ apps: z.array(z.string()).min(1).max(20) });

/** Change which apps the plan carries. Apps kept keep their tier and seats; an app added comes in free until priced. */
opsCustomersRouter.post('/ops/accounts/:id/apps', requireOperatorRole('BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: change apps', async () => {
    const id = String(req.params.id);
    const parsed = appsBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose at least one app, and say why.' });
    if (!(await accountOr404(id))) return res.status(404).json({ error: 'No such customer' });
    const unknown = parsed.data.apps.filter((a) => !SELLABLE_APP_CODES.includes(a));
    if (unknown.length) return res.status(400).json({ error: `These apps cannot be sold yet: ${unknown.join(', ')}.` });
    const sub = await getSubscription(id);
    if (!sub) return res.status(409).json({ error: 'This customer has no plan yet. Use Set a plan first.' });
    const keep = new Map(sub.items.map((i) => [i.appCode, i]));
    const before = sub.items.map((i) => i.appCode).sort();
    const apps = [...new Set(parsed.data.apps)].map((appCode) => {
      const k = keep.get(appCode);
      return k ? { appCode, tier: k.tier, seats: k.seats, priceModel: k.priceModel, unitAmount: k.unitAmount } : { appCode, priceModel: 'free' };
    });
    const after = await setSubscription(id, { apps, status: sub.status });
    clearAccessCache();
    await audit(req, 'SUBSCRIPTION_APPS_CHANGED', { accountId: id }, { from: before, to: (after?.items || []).map((i) => i.appCode).sort(), reason: parsed.data.reason });
    res.json({ apps: (after?.items || []).map((i) => i.appCode).sort() });
  }),
);

/** Cancel the subscription: the apps stop for every company in the account. The account and its data stay. */
opsCustomersRouter.post('/ops/accounts/:id/cancel', requireOperatorRole('BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: cancel subscription', async () => {
    const id = String(req.params.id);
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: SAY_WHY });
    const sub = await platformPrisma.subscription.findUnique({ where: { accountId: id }, select: { status: true } });
    if (!sub) return res.status(409).json({ error: 'This customer has no subscription to cancel.' });
    if (sub.status === 'cancelled') return res.status(409).json({ error: 'Already cancelled.' });
    await platformPrisma.subscription.update({ where: { accountId: id }, data: { status: 'cancelled', cancelAtPeriodEnd: false } });
    await syncAccountEntitlement(id);
    clearAccessCache();
    await audit(req, 'SUBSCRIPTION_CANCELLED', { accountId: id }, { from: sub.status, reason: parsed.data.reason });
    res.json({ status: 'cancelled' });
  }),
);

/** Undo a cancellation: back on trial if the trial has days left, else active. */
opsCustomersRouter.post('/ops/accounts/:id/reopen', requireOperatorRole('BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: reopen subscription', async () => {
    const id = String(req.params.id);
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: SAY_WHY });
    const sub = await platformPrisma.subscription.findUnique({ where: { accountId: id }, select: { status: true, trialEndsAt: true } });
    if (!sub) return res.status(409).json({ error: 'This customer has no subscription.' });
    if (sub.status !== 'cancelled') return res.status(409).json({ error: 'Only a cancelled subscription can be reopened.' });
    const status = sub.trialEndsAt && sub.trialEndsAt.getTime() > Date.now() ? 'trialing' : 'active';
    await platformPrisma.subscription.update({ where: { accountId: id }, data: { status } });
    await syncAccountEntitlement(id);
    clearAccessCache();
    await audit(req, 'SUBSCRIPTION_REOPENED', { accountId: id }, { to: status, reason: parsed.data.reason });
    res.json({ status });
  }),
);

/* ---------------------------------------------------- invoices, payments */

/**
 * What the payment side knows about this customer. Today that is the payment
 * events a gateway sent; invoices and payments recorded in the console join
 * it once payments are switched on.
 */
opsCustomersRouter.get('/ops/accounts/:id/payments', (req, res) =>
  outsideTenant('ops: customer payments', async () => {
    const id = String(req.params.id);
    if (!(await accountOr404(id))) return res.status(404).json({ error: 'No such customer' });
    const events = await platformPrisma.paymentEvent.findMany({
      where: { accountId: id },
      orderBy: { receivedAt: 'desc' },
      take: 100,
      select: { id: true, gateway: true, type: true, processed: true, receivedAt: true },
    });
    res.json({ invoices: [], payments: events.map((e) => ({ id: e.id, gateway: e.gateway, type: e.type, applied: e.processed, at: e.receivedAt })) });
  }),
);

/* --------------------------------------------------------------- requests */

/** Demo requests from this customer (by the account it made, or any of its people's addresses). */
opsCustomersRouter.get('/ops/accounts/:id/requests', (req, res) =>
  outsideTenant('ops: customer requests', async () => {
    const id = String(req.params.id);
    if (!(await accountOr404(id))) return res.status(404).json({ error: 'No such customer' });
    const users = await platformPrisma.user.findMany({ where: { accountId: id }, select: { email: true } });
    const emails = [...new Set(users.map((u) => u.email.toLowerCase()))];
    const demos = await platformPrisma.demoRequest.findMany({
      where: { OR: [{ accountId: id }, { email: { in: emails } }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, name: true, company: true, email: true, status: true, apps: true, message: true, createdAt: true },
    });
    const tickets = await platformPrisma.supportTicket.findMany({
      where: { accountId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, number: true, subject: true, status: true, priority: true, createdAt: true, updatedAt: true },
    });
    res.json({ demoRequests: demos, support: tickets.map((t) => ({ ...t, code: ticketCode(t.number) })) });
  }),
);

/* ------------------------------------------------------------------ users */

const memberOr404 = async (accountId: string, userId: string) => {
  const m = await platformPrisma.accountMembership.findUnique({ where: { accountId_userId: { accountId, userId } }, select: { role: true } });
  if (!m) return null;
  return platformPrisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, fullName: true, accountId: true, isActive: true } });
};

/** Everybody in the account, their sign-in state, and invitations not yet taken up. */
opsCustomersRouter.get('/ops/accounts/:id/users', (req, res) =>
  outsideTenant('ops: customer users', async () => {
    const id = String(req.params.id);
    if (!(await accountOr404(id))) return res.status(404).json({ error: 'No such customer' });
    const members = await platformPrisma.accountMembership.findMany({ where: { accountId: id }, select: { userId: true, role: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
    const ids = members.map((m) => m.userId);
    const [users, sessions, invites] = await Promise.all([
      platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, fullName: true, isActive: true, lastLoginAt: true, totpEnabledAt: true, emailVerifiedAt: true, failedLoginCount: true, lockedUntil: true } }),
      platformPrisma.session.groupBy({ by: ['userId'], where: { userId: { in: ids }, revokedAt: null, expiresAt: { gt: new Date() } }, _count: true }),
      platformPrisma.accountInvitation.findMany({ where: { accountId: id, status: { in: ['PENDING', 'EXPIRED'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, accountRole: true, status: true, expiresAt: true, lastSentAt: true, sendCount: true } }),
    ]);
    const userBy = new Map(users.map((u) => [u.id, u]));
    const sessionsBy = new Map(sessions.map((s) => [s.userId, Number(s._count) || 0]));
    res.json({
      users: members.map((m) => {
        const u = userBy.get(m.userId);
        return {
          userId: m.userId,
          name: u?.fullName || null,
          email: u?.email || null,
          role: m.role,
          status: m.status === 'SUSPENDED' || !u?.isActive ? 'off' : 'active',
          lastLoginAt: u?.lastLoginAt || null,
          authenticator: Boolean(u?.totpEnabledAt),
          emailConfirmed: Boolean(u?.emailVerifiedAt),
          signedInOn: sessionsBy.get(m.userId) || 0,
          lockedUntil: u?.lockedUntil && u.lockedUntil.getTime() > Date.now() ? u.lockedUntil : null,
          wrongPasswords: u?.failedLoginCount || 0,
        };
      }),
      invitations: invites.map((i) => ({ ...i, expired: i.status === 'EXPIRED' || i.expiresAt.getTime() < Date.now() })),
    });
  }),
);

const APP_URL = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Mail the person a link to set a new password. CLOR never sees the link or the password. */
opsCustomersRouter.post('/ops/accounts/:id/users/:userId/reset-link', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: send reset link', async () => {
    const id = String(req.params.id);
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: SAY_WHY });
    const user = await memberOr404(id, String(req.params.userId));
    if (!user) return res.status(404).json({ error: 'This person is not in this account.' });
    if (!user.isActive) return res.status(409).json({ error: 'This person’s sign-in is switched off. Their own owner switches it back on first.' });
    const token = await issuePasswordResetToken({ id: user.id, accountId: user.accountId }, clientIp(req));
    const sent = await sendTemplate({
      templateKey: 'auth.password_reset',
      to: user.email,
      accountId: user.accountId,
      transactional: true,
      relatedType: 'User',
      relatedId: user.id,
      data: { userName: user.fullName || user.email, resetUrl: `${APP_URL()}/?reset=${token}` },
    });
    await audit(req, 'USER_RESET_LINK_SENT', { accountId: id, userId: user.id }, { email: user.email, reason: parsed.data.reason });
    res.json({ sent: sent?.status === 'SENT', status: sent?.status || null, email: user.email });
  }),
);

/** End every session the person has, on every device. */
opsCustomersRouter.post('/ops/accounts/:id/users/:userId/sign-out', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: sign out everywhere', async () => {
    const id = String(req.params.id);
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: SAY_WHY });
    const user = await memberOr404(id, String(req.params.userId));
    if (!user) return res.status(404).json({ error: 'This person is not in this account.' });
    const r = await revokeAllSessions(user.id, 'OPERATOR_SIGN_OUT');
    await audit(req, 'USER_SIGNED_OUT_EVERYWHERE', { accountId: id, userId: user.id }, { email: user.email, sessions: r.count, reason: parsed.data.reason });
    res.json({ sessionsEnded: r.count });
  }),
);

/** Let a person in again after too many wrong passwords. The password itself is not touched. */
opsCustomersRouter.post('/ops/accounts/:id/users/:userId/unlock', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: unlock sign-in', async () => {
    const id = String(req.params.id);
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: SAY_WHY });
    const user = await memberOr404(id, String(req.params.userId));
    if (!user) return res.status(404).json({ error: 'This person is not in this account.' });
    const before = await platformPrisma.user.findUnique({ where: { id: user.id }, select: { failedLoginCount: true, lockedUntil: true } });
    const locked = Boolean(before?.lockedUntil && before.lockedUntil.getTime() > Date.now());
    if (!locked && !before?.failedLoginCount) return res.status(409).json({ error: 'This person is not locked out.' });
    await platformPrisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await audit(req, 'USER_UNLOCKED', { accountId: id, userId: user.id }, { email: user.email, wasLocked: locked, wrongPasswords: before?.failedLoginCount || 0, reason: parsed.data.reason });
    res.json({ unlocked: true });
  }),
);

/**
 * Take a lost authenticator off a person, so they can sign in with their
 * password and set up a new one. Owner-level staff only: whoever does this
 * removes a second factor, so every session is ended too and the person is
 * told by email. (Two-person approval for this comes with the approvals work.)
 */
opsCustomersRouter.post('/ops/accounts/:id/users/:userId/reset-authenticator', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: reset authenticator', async () => {
    const id = String(req.params.id);
    const parsed = reasonBody.extend({ reason: z.string().trim().min(10).max(500) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say why, in a sentence: who asked, and how you checked it was them.' });
    const user = await memberOr404(id, String(req.params.userId));
    if (!user) return res.status(404).json({ error: 'This person is not in this account.' });
    if (user.id === req.auth?.userId) return res.status(409).json({ error: 'You cannot take your own authenticator off from here.' });
    const staff = await platformPrisma.platformOperator.findUnique({ where: { userId: user.id }, select: { active: true } });
    if (staff?.active) return res.status(409).json({ error: 'This person is CLOR staff. Their authenticator is changed under Staff, not here.' });
    const u = await platformPrisma.user.findUnique({ where: { id: user.id }, select: { totpEnabledAt: true } });
    if (!u?.totpEnabledAt) return res.status(409).json({ error: 'This person has no authenticator set up.' });
    await platformPrisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryJson: null } });
    const r = await revokeAllSessions(user.id, 'OPERATOR_AUTHENTICATOR_RESET');
    const sent = await sendTemplate({
      templateKey: 'auth.authenticator_removed',
      to: user.email,
      accountId: user.accountId,
      transactional: true,
      relatedType: 'User',
      relatedId: user.id,
      data: { userName: user.fullName || user.email, appUrl: APP_URL() },
    }).catch(() => null);
    await audit(req, 'USER_AUTHENTICATOR_RESET', { accountId: id, userId: user.id }, { email: user.email, sessions: r.count, told: sent?.status || 'NOT_SENT', reason: parsed.data.reason });
    res.json({ reset: true, sessionsEnded: r.count, told: sent?.status === 'SENT' });
  }),
);

/** Send again every email that failed for this customer in the last week (at most 50). */
opsCustomersRouter.post('/ops/accounts/:id/emails/retry', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: retry failed emails', async () => {
    const id = String(req.params.id);
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: SAY_WHY });
    if (!(await accountOr404(id))) return res.status(404).json({ error: 'No such customer' });
    const rows = await platformPrisma.emailOutbox.findMany({
      where: { accountId: id, status: 'FAILED', createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, accountId: true, orgId: true },
    });
    let sent = 0;
    for (const r of rows) {
      const after = await deliver(r.id, r.accountId, r.orgId).catch(() => null);
      if ((after as any)?.status === 'SENT') sent += 1;
    }
    await audit(req, 'EMAILS_RETRIED', { accountId: id }, { tried: rows.length, sent, reason: parsed.data.reason });
    res.json({ tried: rows.length, sent, stillFailing: rows.length - sent });
  }),
);

/** Send an invitation again: a new link, seven more days; the old link stops working. */
opsCustomersRouter.post('/ops/accounts/:id/invitations/:invitationId/resend', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: resend invitation', async () => {
    const id = String(req.params.id);
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: SAY_WHY });
    try {
      const inv = await resendInvitation(req, String(req.params.invitationId), { accountId: id });
      await audit(req, 'USER_INVITE_RESENT', { accountId: id }, { email: inv.email, invitationId: inv.id, reason: parsed.data.reason });
      res.json({ invitation: inv });
    } catch (e) {
      if (e instanceof InvitationError) return res.status(e.status).json({ error: e.message, code: e.code });
      throw e;
    }
  }),
);

/* --------------------------------------------------------------- activity */

/** The customer's timeline, newest first; `before` (an ISO time from `older`) pages back. Business records stay out (services/ops/timeline.ts). */
opsCustomersRouter.get('/ops/accounts/:id/activity', (req, res) =>
  outsideTenant('ops: customer timeline', async () => {
    const id = String(req.params.id);
    const raw = typeof req.query.before === 'string' ? new Date(req.query.before) : undefined;
    if (raw && Number.isNaN(raw.getTime())) return res.status(400).json({ error: 'That date is not readable.' });
    const t = await accountTimeline(id, raw);
    if (!t) return res.status(404).json({ error: 'No such customer' });
    res.json(t);
  }),
);
