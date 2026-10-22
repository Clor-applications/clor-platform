import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requireOperator } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { APP_CATALOG } from '../constants/appCatalog.js';
import { PLAN_CATALOG } from '../constants/planCatalog.js';
import { getSubscription, appAccess, setSubscription, applyGatewayEvent } from '../services/subscriptions.js';
import { getGateway } from '../billing/gateway.js';

export const billingRouter = Router();
/** CLOR operators acting on an account from outside it. See app.ts for where it is mounted. */
export const billingOperatorRouter = Router();

/**
 * The webhook is mounted PUBLIC and BEFORE auth. It is a no-op under the manual
 * gateway (no provider, no webhooks); a real gateway adapter will verify the
 * signature here. NOTE: signature verification needs the raw body — when a real
 * gateway is wired, add an express.raw() body parser on this exact path ahead of
 * the global express.json().
 */
billingRouter.post('/billing/webhook', async (req, res) => {
  const gw = getGateway();
  const ev = gw.verifyWebhook(JSON.stringify(req.body ?? {}), req.headers as Record<string, unknown>);
  if (!ev) return res.status(202).json({ ignored: true });
  const r = await applyGatewayEvent(ev);
  res.json(r);
});

const setSchema = z.object({
  apps: z
    .array(
      z.object({
        appCode: z.string(),
        tier: z.string().nullish(),
        seats: z.number().int().positive().nullish(),
        priceModel: z.enum(['free', 'per_seat', 'per_app', 'flat']).nullish(),
        unitAmount: z.number().int().nonnegative().nullish(),
      }),
    )
    .min(1),
  status: z.enum(['trialing', 'active', 'past_due', 'paused', 'cancelled']).optional(),
  billingInterval: z.enum(['month', 'year']).nullish(),
  trialDays: z.number().int().positive().nullish(),
});

/**
 * Set/replace an account's subscription by hand: free grants and offline/
 * invoice deals. CLOR operators only (CLOR_OPERATOR_USER_IDS) — the
 * subscription decides which apps every company in the account may open and
 * switches them on, so a customer's own owner or admin must never reach it.
 * The operator is not a member of the account they act on, so the account is
 * named in the path and this router is mounted ahead of every router that
 * demands tenant headers (app.ts). The gateway path (webhook ->
 * applyGatewayEvent) is the only other writer.
 */
billingOperatorRouter.post('/billing/accounts/:accountId/subscription', requireAuth, requireOperator, async (req, res) => {
  const accountId = String(req.params.accountId || '');
  const account = await platformPrisma.account.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!account) return res.status(404).json({ error: 'No such account' });
  const parsed = setSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid subscription', details: parsed.error.flatten() });
  const sub = await setSubscription(accountId, parsed.data);
  res.json({ subscription: sub });
});

// Everything else is tenant-scoped.
billingRouter.use(requireAuth, requireTenantContext);

/** The catalog: which apps can be bought and the accounting plans. Pricing TBD. */
billingRouter.get('/billing/catalog', (_req, res) => {
  res.json({ apps: APP_CATALOG, accountingPlans: PLAN_CATALOG, gateway: getGateway().name });
});

/** This account's subscription + the apps it may currently open. */
billingRouter.get('/billing/subscription', async (req, res) => {
  const accountId = req.tenant!.accountId;
  const [sub, access] = await Promise.all([getSubscription(accountId), appAccess(accountId)]);
  res.json({ subscription: sub, ...access, subscribedApps: access.entitledApps });
});

/**
 * A customer cannot set their own subscription — read it above, buy through the
 * gateway, or ask CLOR. Answered explicitly so the old route does not fall
 * through to whatever is mounted next.
 */
billingRouter.post('/billing/subscription', (_req, res) => {
  res.status(403).json({ error: 'Only CLOR can change a subscription by hand.', code: 'OPERATOR_ONLY' });
});
