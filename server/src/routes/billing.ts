import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { APP_CATALOG } from '../constants/appCatalog.js';
import { PLAN_CATALOG } from '../constants/planCatalog.js';
import { getSubscription, appAccess, setSubscription, applyGatewayEvent } from '../services/subscriptions.js';
import { getGateway } from '../billing/gateway.js';

export const billingRouter = Router();

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
 * Set/replace the subscription by hand. The manual path today (free grants,
 * offline/invoice deals) and what a gateway adapter calls after a provider
 * confirms. Admin-gated via Settings edit.
 */
billingRouter.post(
  '/billing/subscription',
  requirePermission('SETTINGS', PermissionAction.EDIT, 'Company Profile'),
  async (req, res) => {
    const parsed = setSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid subscription', details: parsed.error.flatten() });
    const sub = await setSubscription(req.tenant!.accountId, parsed.data);
    res.json({ subscription: sub });
  },
);
