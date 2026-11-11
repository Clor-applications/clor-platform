import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { REQUEST_ID } from '../utils/log.js';
import { accountsByPhone } from '../services/ops/phoneSearch.js';
import { accountConnections, systemHealth } from '../services/ops/systemHealth.js';
import { audit, customerTitle } from './ops.js';
import { requireOperatorRole } from '../middleware/operator.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { RULES } from '../services/ops/alerts.js';

/**
 * Operator console, Ops P0: system health, one customer's connections, the
 * search box at the top of every page, and the request-ID lookup. All read
 * only: account metadata, counts and names, never a customer's records.
 */
export const opsHealthRouter = Router();
opsHealthRouter.use('/ops', requireAuth, requireOperator);

/** Are the background workers running, and what failed in the last day. */
opsHealthRouter.get('/ops/health', (_req, res) => outsideTenant('ops: system health', async () => res.json(await systemHealth())));

/** One customer's readers, agents, HR and sign-on connections, e-invoice link, and failed mail. */
opsHealthRouter.get('/ops/accounts/:id/connections', (req, res) =>
  outsideTenant('ops: customer connections', async () => {
    const id = String(req.params.id);
    const a = await platformPrisma.account.findUnique({ where: { id }, select: { id: true } });
    if (!a) return res.status(404).json({ error: 'No such customer' });
    res.json(await accountConnections(id));
  }),
);

const searchQuery = z.object({ q: z.string().trim().min(2).max(120) });

/**
 * The search box on every console page: a customer by any name, code, email,
 * GSTIN or phone; one of CLOR's own invoices by number; a request ID.
 */
opsHealthRouter.get('/ops/search', (req, res) =>
  outsideTenant('ops: search', async () => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) return res.json({ customers: [], people: [], invoices: [], requestId: null });
    const q = parsed.data.q;
    const ci = { contains: q, mode: 'insensitive' as const };
    const digits = q.replace(/\D/g, '');
    const phone = digits.length >= 6 ? digits.slice(-10) : null;
    const accountOr: any[] = [
      { name: ci },
      { code: ci },
      { legacyCode: ci },
      { orgs: { some: { OR: [{ name: ci }, { code: ci }, { legacyCode: ci }, { branches: { some: { gstin: ci } } }] } } },
    ];
    const byPhone = phone ? await accountsByPhone(q) : [];
    if (byPhone.length) accountOr.push({ id: { in: byPhone } });
    const userOr: any[] = [{ email: ci }, { fullName: ci }, { code: ci }];
    const [accounts, users, invoices] = await Promise.all([
      platformPrisma.account.findMany({ where: { OR: accountOr }, take: 8, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, code: true, suspendedAt: true, orgs: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } }),
      platformPrisma.user.findMany({ where: { OR: userOr }, take: 8, orderBy: { createdAt: 'desc' }, select: { id: true, fullName: true, email: true, accountId: true } }),
      platformPrisma.billingInvoice.findMany({ where: { number: ci }, take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, number: true, status: true, total: true, accountId: true } }),
    ]);
    /* Every customer named the way the Customers list names it: the business, not the owner. */
    const ids = [...new Set([...accounts.map((a) => a.id), ...users.map((u) => u.accountId)])];
    const [accts, owners] = ids.length
      ? await Promise.all([
          platformPrisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, orgs: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } }),
          platformPrisma.accountMembership.findMany({ where: { accountId: { in: ids }, role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { accountId: true, userId: true } }),
        ])
      : [[], []];
    const ownerUsers = owners.length ? await platformPrisma.user.findMany({ where: { id: { in: owners.map((o) => o.userId) } }, select: { id: true, fullName: true } }) : [];
    const nameOf = new Map(ownerUsers.map((u) => [u.id, u.fullName]));
    const ownerName = new Map<string, string>();
    for (const o of owners) if (!ownerName.has(o.accountId) && nameOf.get(o.userId)) ownerName.set(o.accountId, nameOf.get(o.userId)!);
    const titleOf = new Map(accts.map((a) => [a.id, customerTitle(a.name, ownerName.get(a.id), a.orgs[0]?.name)]));
    res.json({
      customers: accounts.map((a) => ({ id: a.id, title: titleOf.get(a.id) || a.name, code: a.code, suspended: Boolean(a.suspendedAt) })),
      people: users.map((u) => ({ id: u.id, name: u.fullName, email: u.email, accountId: u.accountId, accountName: titleOf.get(u.accountId) || null })),
      invoices,
      requestId: REQUEST_ID.test(q) && /[0-9]/.test(q) && q.length >= 16 ? q : null,
    });
  }),
);

/**
 * A request ID a customer read out (every error page shows one): where to
 * see what happened. The logs live in Google Cloud Logging; CLOR staff open
 * them there with their own Google sign-in, the console does not copy them.
 */
opsHealthRouter.get('/ops/request-lookup', (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!REQUEST_ID.test(id)) return res.status(400).json({ error: 'That does not look like a request ID. It is the code shown under an error, 8 to 80 letters, digits and dashes.' });
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || process.env.OPS_GCP_PROJECT || 'clor-apps-511409';
  const query = `jsonPayload.requestId="${id}" OR trace:"${id}"`;
  const logsUrl = `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(query)};duration=P30D?project=${encodeURIComponent(project)}`;
  res.json({ id, logsUrl });
});

/**
 * Alerts (Ops plan P1): open ones, most serious and oldest first, and those
 * closed in the last week. Everyone on the console sees all of them; `mine`
 * keeps the ones meant for the reader's role.
 */
opsHealthRouter.get('/ops/alerts', (req, res) =>
  outsideTenant('ops: alerts', async () => {
    const role = res.locals.operatorRole as string;
    const [open, closed] = await Promise.all([
      platformPrisma.opsAlert.findMany({ where: { resolvedAt: null }, orderBy: [{ firstSeenAt: 'asc' }], take: 500 }),
      platformPrisma.opsAlert.findMany({ where: { resolvedAt: { gt: new Date(Date.now() - 7 * 86_400_000) } }, orderBy: { resolvedAt: 'desc' }, take: 200 }),
    ]);
    const rank = (a: { severity: string }) => (a.severity === 'critical' ? 0 : 1);
    open.sort((a, b) => rank(a) - rank(b) || a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
    const ackIds = [...new Set(open.map((a) => a.acknowledgedBy).filter(Boolean) as string[])];
    const ackers = ackIds.length ? await platformPrisma.user.findMany({ where: { id: { in: ackIds } }, select: { id: true, fullName: true, email: true } }) : [];
    const name = new Map(ackers.map((u) => [u.id, u.fullName || u.email]));
    const shape = (a: any) => ({ ...a, acknowledgedBy: a.acknowledgedBy ? { id: a.acknowledgedBy, name: name.get(a.acknowledgedBy) || 'Staff' } : null, forMe: role === 'SUPER_ADMIN' || a.audience === role });
    res.json({
      open: open.map(shape),
      closed: closed.map(shape),
      counts: { open: open.length, critical: open.filter((a) => a.severity === 'critical').length, unacknowledged: open.filter((a) => !a.acknowledgedAt).length },
      rules: RULES,
    });
  }),
);

/** "I have seen it and I am on it": stops it counting as new; it stays open until the problem clears. */
opsHealthRouter.post('/ops/alerts/:id/acknowledge', requireOperatorRole('SUPPORT', 'BILLING', 'SALES'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: acknowledge an alert', async () => {
    const a = await platformPrisma.opsAlert.findUnique({ where: { id: String(req.params.id) } });
    if (!a) return res.status(404).json({ error: 'No such alert.' });
    if (a.resolvedAt) return res.status(409).json({ error: 'This alert has already cleared.' });
    const role = res.locals.operatorRole as string;
    if (role !== 'SUPER_ADMIN' && a.audience !== role) return res.status(403).json({ error: 'This alert is for another team.' });
    const updated = await platformPrisma.opsAlert.update({ where: { id: a.id }, data: { acknowledgedAt: new Date(), acknowledgedBy: req.auth!.userId } });
    await audit(req, 'ALERT_ACKNOWLEDGED', { accountId: a.accountId }, { alert: a.key, title: a.title }, { customerLog: false });
    res.json({ alert: updated });
  }),
);
