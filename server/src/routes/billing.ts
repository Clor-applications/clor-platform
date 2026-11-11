import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { authorize } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { APP_CATALOG } from '../constants/appCatalog.js';
import { PLAN_CATALOG } from '../constants/planCatalog.js';
import { getSubscription, appAccess, setSubscription, lapseReason } from '../services/subscriptions.js';
import { applyGatewayEvent, recordRejected } from '../billing/events.js';
import { activeGateway, isCode, manualPayTo, webhookGateway } from '../billing/providers.js';
import { rawText } from '../billing/webhookKit.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { clientIp, recordAuthEvent } from '../services/auth.js';
import { acrossCompanies } from '../utils/tenantScope.js';
import { publishedBook } from '../services/pricing/books.js';
import { taxSetting } from '../services/pricing/settings.js';
import { publicPricing } from './pricing.js';
import { invoiceForAccount, invoicesForAccount } from '../billing/invoices.js';
import { checkPayLink, onlinePayment, payLinkFor } from '../billing/payLinks.js';
import { PaymentsError } from '../billing/providers.js';

export const billingRouter = Router();
/** CLOR operators acting on an account from outside it. See app.ts for where it is mounted. */
export const billingOperatorRouter = Router();
/* A CLOR operator acts on a customer's account, not inside one of its companies (A-35). */
billingOperatorRouter.use(acrossCompanies('billing operator: a customer account, across its companies'));

/**
 * The payment gateway's webhook (A-16).
 *
 * The comment here said "mounted PUBLIC and BEFORE auth", but it was mounted
 * on billingRouter after routers that put requireAuth on everything under
 * /api, so a gateway's call got 401 and never arrived. It is now its own
 * handler, mounted in app.ts on its exact path ahead of every router and of
 * the global JSON parser, with the raw body — what a signature is computed
 * over. Under the manual gateway it still does nothing (202 ignored); a real
 * gateway adapter verifies the signature in verifyWebhook.
 */
const rawBody = (req: Request) => (Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})));

export async function billingWebhook(req: Request, res: Response) {
  const raw = rawBody(req);
  const ev = (await activeGateway()).verifyWebhook(raw, req.headers as Record<string, unknown>);
  if (!ev) return res.status(202).json({ ignored: true });
  const r = await applyGatewayEvent(ev);
  res.json({ applied: r.applied });
}

/**
 * One provider's webhook: POST /api/billing/webhook/cashfree or /razorpay,
 * the address the operator console shows with a Copy button. The signature is
 * checked over the exact bytes received, with that provider's saved secret.
 * A refused event is kept (with why) for the Payments log and answered 400,
 * so it shows as failed in the provider's dashboard too. A replay is answered
 * 200 and changes nothing. An event kept but not applied is answered 200: it
 * waits in the Payments log for Retry, and the provider need not resend it.
 */
export async function providerWebhook(req: Request, res: Response) {
  const code = String(req.params.provider || '');
  if (!isCode(code) || code === 'manual') return res.status(404).json({ error: 'No such payment provider.' });
  const raw = rawBody(req);
  const found = await webhookGateway(code);
  if ('reason' in found) {
    await recordRejected(code, found.reason, rawText(raw));
    return res.status(400).json({ error: found.reason });
  }
  const check = found.gateway.checkWebhook
    ? found.gateway.checkWebhook(raw, req.headers as Record<string, unknown>)
    : ((ev) => (ev ? { ok: true as const, event: ev } : { ok: false as const, reason: 'The signature did not match.' }))(found.gateway.verifyWebhook(raw, req.headers as Record<string, unknown>));
  if (!check.ok) {
    await recordRejected(code, check.reason, rawText(raw));
    return res.status(400).json({ error: check.reason });
  }
  const r = await applyGatewayEvent(check.event);
  res.json({ received: true, duplicate: Boolean(r.duplicate) });
}

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
  reason: z.string().trim().max(500).optional(),
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
billingOperatorRouter.post('/billing/accounts/:accountId/subscription', requireAuth, requireOperator, requireOperatorRole('BILLING'), requireOperatorStepUp, async (req, res) => {
  const accountId = String(req.params.accountId || '');
  const account = await platformPrisma.account.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!account) return res.status(404).json({ error: 'No such account' });
  const parsed = setSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid subscription', details: parsed.error.flatten() });
  const before = await getSubscription(accountId);
  const sub = await setSubscription(accountId, parsed.data);
  /*
   * A-17: what CLOR changed on a customer's account, by whom, from what to
   * what — recorded against the customer's account, where their own security
   * activity is listed, and against nothing they can edit.
   */
  const shape = (s: any) => (s ? { status: s.status, apps: (s.items || []).map((i: any) => i.appCode).sort() } : null);
  await recordAuthEvent({
    accountId,
    userId: req.auth!.userId,
    eventType: 'OPERATOR_SUBSCRIPTION_SET',
    ip: clientIp(req),
    userAgent: req.headers['user-agent'] as string | undefined,
    detail: JSON.stringify({ before: shape(before), after: shape(sub) }).slice(0, 1000),
  });
  /* And on CLOR's own operator record, with everything else operators do (Audit log). */
  await platformPrisma.operatorAuditEvent.create({
    data: { operatorUserId: req.auth!.userId, action: 'SUBSCRIPTION_SET', targetAccountId: accountId, detail: { before: shape(before), after: shape(sub), reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined } as any, ip: clientIp(req) ?? null },
  });
  res.json({ subscription: sub });
});

// Everything else is tenant-scoped.
billingRouter.use(requireAuth, requireTenantContext);

/** The catalog: which apps can be bought, the accounting plans, and the published price list (services/pricing/). */
billingRouter.get('/billing/catalog', async (_req, res) => {
  const [book, gst, gateway] = await Promise.all([publishedBook(), taxSetting(), activeGateway()]);
  /* With manual payments active, how to pay: CLOR's UPI ID, a QR and the bank account. */
  const payTo = gateway.name === 'manual' ? await manualPayTo(gateway) : null;
  res.json({ apps: APP_CATALOG, accountingPlans: PLAN_CATALOG, gateway: gateway.name, payTo, pricing: book ? publicPricing(book, gst) : null });
});

/** This account's subscription + the apps it may currently open. */
billingRouter.get('/billing/subscription', async (req, res) => {
  const accountId = req.tenant!.accountId;
  const [sub, access] = await Promise.all([getSubscription(accountId), appAccess(accountId)]);
  /*
   * Everybody's shell needs which apps the account has and its standing. The
   * plan itself — line items, amounts, the payment gateway's customer and
   * subscription ids — is for whoever looks after the account (A-22), and the
   * gateway ids are for nobody's browser.
   */
  const mayViewPlan = !(await authorize(req, 'SETTINGS', PermissionAction.VIEW, 'Company Profile'));
  const plan = mayViewPlan && sub ? (({ gatewayCustomerId: _c, gatewaySubscriptionId: _s, ...rest }) => rest)(sub) : null;
  /* `reason`: why the apps are read-only when they are (a trial that ended), in the sentence the shell shows. */
  res.json({ subscription: plan, ...access, subscribedApps: access.entitledApps, reason: lapseReason(sub) });
});

/**
 * A customer cannot set their own subscription — read it above, buy through the
 * gateway, or ask CLOR. Answered explicitly so the old route does not fall
 * through to whatever is mounted next.
 */
billingRouter.post('/billing/subscription', (_req, res) => {
  res.status(403).json({ error: 'Only CLOR can change a subscription by hand.', code: 'OPERATOR_ONLY' });
});

/**
 * This account's invoices from CLOR (roadmap item 8): issued, paid and
 * cancelled, never a draft. An unpaid one carries how to pay it: a UPI QR
 * with the amount and invoice number, and CLOR's bank account. For whoever
 * may see the plan.
 */
billingRouter.get('/billing/invoices', async (req, res) => {
  if (await authorize(req, 'SETTINGS', PermissionAction.VIEW, 'Company Profile')) return res.status(403).json({ error: 'Only the people who look after this account see its invoices.' });
  const [invoices, online] = await Promise.all([invoicesForAccount(req.tenant!.accountId), onlinePayment()]);
  res.json({ invoices, payOnline: online.available });
});

billingRouter.get('/billing/invoices/:id', async (req, res) => {
  if (await authorize(req, 'SETTINGS', PermissionAction.VIEW, 'Company Profile')) return res.status(403).json({ error: 'Only the people who look after this account see its invoices.' });
  try {
    const [inv, online] = await Promise.all([invoiceForAccount(req.tenant!.accountId, String(req.params.id)), onlinePayment()]);
    res.json({ ...inv, payOnline: online.available && inv.status === 'ISSUED' });
  } catch (e) {
    if (e instanceof PaymentsError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

/**
 * Pay online: the active gateway's page for exactly this invoice's total
 * (billing/payLinks.ts). Answers the address to send the customer to; the
 * provider sends them back to `returnTo` when it is CLOR's own page.
 */
billingRouter.post('/billing/invoices/:id/pay', async (req, res) => {
  if (await authorize(req, 'SETTINGS', PermissionAction.VIEW, 'Company Profile')) return res.status(403).json({ error: 'Only the people who look after this account pay its invoices.' });
  try {
    res.json(await payLinkFor(req.tenant!.accountId, String(req.params.id), { returnTo: req.body?.returnTo, userId: req.auth?.userId ?? null }));
  } catch (e) {
    if (e instanceof PaymentsError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

/** Back from the payment page: whether the invoice is paid now (asks the provider, so it does not wait for the webhook). */
billingRouter.post('/billing/invoices/:id/pay/check', async (req, res) => {
  if (await authorize(req, 'SETTINGS', PermissionAction.VIEW, 'Company Profile')) return res.status(403).json({ error: 'Only the people who look after this account see its invoices.' });
  try {
    res.json(await checkPayLink(req.tenant!.accountId, String(req.params.id)));
  } catch (e) {
    if (e instanceof PaymentsError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});
