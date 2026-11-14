import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { allSwitches, setSwitch, SWITCH_NAMES, type SwitchName } from '../services/platformSwitches.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { audit } from './ops.js';

/**
 * Insights and platform switches on the operator console (OPS_PORTAL_GAPS #4, #5).
 *
 * Insights: how the business is doing, from what is stored — recurring
 * revenue from the subscriptions staff priced, customers by state and by app,
 * and twelve months of sign-ups, money collected and cancellations. Every
 * operator may read it.
 *
 * Switches: pause new trials or demo requests from clor.in. The owner only,
 * with a fresh authenticator code, audited.
 */
export const opsInsightsRouter = Router();
opsInsightsRouter.use('/ops/insights', requireAuth, requireOperator);
opsInsightsRouter.use('/ops/switches', requireAuth, requireOperator);

const MONTHS = 12;
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** The last twelve calendar months, oldest first, as YYYY-MM. */
export function lastMonths(now = new Date(), n = MONTHS) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
}

/** What one subscription brings in a month, in paise: a yearly price spread over twelve. */
export function monthlyPaise(s: { periodAmount: number | null; billingInterval: string | null }) {
  if (!s.periodAmount || s.periodAmount <= 0) return 0;
  return s.billingInterval === 'year' ? Math.round(s.periodAmount / 12) : s.periodAmount;
}

opsInsightsRouter.get('/ops/insights', (_req, res) =>
  outsideTenant('ops: insights', async () => {
    const now = new Date();
    const months = lastMonths(now);
    const since = new Date(`${months[0]}-01T00:00:00.000Z`);
    const [subs, accounts, paid, cancelled] = await Promise.all([
      platformPrisma.subscription.findMany({ select: { status: true, periodAmount: true, billingInterval: true, planName: true, trialEndsAt: true, items: { select: { appCode: true } } } }),
      platformPrisma.account.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      platformPrisma.billingInvoice.findMany({ where: { paidAt: { gte: since }, voidedAt: null }, select: { paidAt: true, paidAmount: true, total: true } }),
      platformPrisma.operatorAuditEvent.findMany({ where: { action: 'SUBSCRIPTION_CANCELLED', at: { gte: since } }, select: { at: true } }),
    ]);

    const byState: Record<string, number> = { trialing: 0, active: 0, past_due: 0, paused: 0, cancelled: 0 };
    const byApp: Record<string, { customers: number; mrr: number }> = {};
    const byPlan: Record<string, { customers: number; mrr: number }> = {};
    let mrr = 0;
    let paying = 0;
    let trialsEndingSoon = 0;
    for (const s of subs) {
      byState[s.status] = (byState[s.status] || 0) + 1;
      if (s.status === 'trialing' && s.trialEndsAt && s.trialEndsAt.getTime() - now.getTime() < 7 * 86_400_000 && s.trialEndsAt > now) trialsEndingSoon += 1;
      const live = s.status === 'active' || s.status === 'past_due';
      const m = live ? monthlyPaise(s) : 0;
      if (m) {
        mrr += m;
        paying += 1;
        const plan = s.planName || 'Priced by hand';
        byPlan[plan] = { customers: (byPlan[plan]?.customers || 0) + 1, mrr: (byPlan[plan]?.mrr || 0) + m };
      }
      if (!live && s.status !== 'trialing') continue;
      /* A subscription's money is shared evenly across its apps: there is no price per app on a bundle. */
      const apps = [...new Set(s.items.map((i) => i.appCode))];
      for (const app of apps) {
        byApp[app] = { customers: (byApp[app]?.customers || 0) + 1, mrr: (byApp[app]?.mrr || 0) + (apps.length ? Math.round(m / apps.length) : 0) };
      }
    }

    const series = months.map((month) => ({ month, signups: 0, collected: 0, cancellations: 0 }));
    const at = new Map(series.map((r) => [r.month, r]));
    for (const a of accounts) {
      const r = at.get(monthKey(a.createdAt));
      if (r) r.signups += 1;
    }
    for (const p of paid) {
      const r = p.paidAt && at.get(monthKey(p.paidAt));
      if (r) r.collected += p.paidAmount ?? p.total;
    }
    for (const c of cancelled) {
      const r = at.get(monthKey(c.at));
      if (r) r.cancellations += 1;
    }

    res.json({
      currency: 'INR',
      mrr,
      arr: mrr * 12,
      paying,
      averagePerCustomer: paying ? Math.round(mrr / paying) : 0,
      trialsEndingSoon,
      byState,
      byApp: Object.entries(byApp).map(([app, v]) => ({ app, ...v })).sort((a, b) => b.customers - a.customers),
      byPlan: Object.entries(byPlan).map(([plan, v]) => ({ plan, ...v })).sort((a, b) => b.mrr - a.mrr),
      months: series,
      asOf: now.toISOString(),
    });
  }),
);

opsInsightsRouter.get('/ops/switches', async (_req, res) => {
  res.json({ switches: await allSwitches() });
});

const switchBody = z.object({
  open: z.boolean(),
  message: z.string().trim().max(300, 'Keep the message under 300 characters.').nullable().optional(),
});

opsInsightsRouter.put('/ops/switches/:name', requireOperatorRole(), requireOperatorStepUp, async (req, res) => {
  const name = String(req.params.name) as SwitchName;
  if (!SWITCH_NAMES.includes(name)) return res.status(404).json({ error: 'No such switch.' });
  const parsed = switchBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the fields.', code: 'INVALID' });
  await setSwitch(name, parsed.data.open, parsed.data.message ?? null, req.auth!.userId);
  await outsideTenant('ops: audit a switch', () => audit(req, parsed.data.open ? 'SWITCH_OPENED' : 'SWITCH_PAUSED', {}, { switch: name, message: parsed.data.message || null }));
  res.json({ switches: await allSwitches() });
});
