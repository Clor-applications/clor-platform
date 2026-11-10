import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { REQUEST_ID } from '../utils/log.js';
import { accountsByPhone } from '../services/ops/phoneSearch.js';
import { accountConnections, systemHealth } from '../services/ops/systemHealth.js';
import { customerTitle } from './ops.js';

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
