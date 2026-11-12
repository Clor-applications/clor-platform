import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { paymentTestLimiter } from '../middleware/rateLimit.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { EVENT_STATUSES, listEvents, recordManualPayment, retryEvent } from '../billing/events.js';
import { PROVIDER_NAMES, PaymentsError, activate, isCode, providerRows, providerView, readiness, saveProvider, setMode, testProvider, type ProviderCode } from '../billing/providers.js';
import { audit } from './ops.js';

/**
 * Payments in the operator console: how customers pay CLOR, and the log of
 * every payment event. Everything a person needs is a screen here; nothing
 * asks for a file, a command or an environment variable.
 *
 * Reading is for any operator. Every change is for the BILLING role with a
 * fresh authenticator code (step-up) and goes on the operator log, naming the
 * fields changed and never a secret's value. Test connection is BILLING too,
 * without step-up: it changes nothing but the last test result.
 */
export const opsPaymentsRouter = Router();
opsPaymentsRouter.use('/ops/payments', requireAuth, requireOperator);

const refused = (res: Response, e: unknown) => {
  if (!(e instanceof PaymentsError)) throw e;
  return res.status(e.status).json({ error: e.message, problems: e.problems });
};
const codeOf = (req: Request, res: Response): ProviderCode | null => {
  const c = String(req.params.code || '');
  if (isCode(c)) return c;
  res.status(404).json({ error: 'No such payment provider.' });
  return null;
};

async function providersView() {
  const rows = await providerRows();
  return rows.map(({ code, row }) => ({ ...providerView(code, row), missing: readiness(code, row) }));
}

opsPaymentsRouter.get('/ops/payments', (_req, res) =>
  outsideTenant('ops: payment providers', async () => {
    res.json({ providers: await providersView(), statuses: EVENT_STATUSES });
  }),
);

const secret = z.string().max(300).optional();
const keyInput = z.object({ id: z.string().max(120).optional(), secrets: z.record(z.string(), secret).optional() });
const manualInput = z.object({
  upiId: z.string().max(300).nullish(),
  payeeName: z.string().max(120).nullish(),
  qrImage: z.string().max(420_000).nullish(),
  bank: z
    .object({ accountName: z.string().max(120).nullish(), accountNumber: z.string().max(40).nullish(), ifsc: z.string().max(20).nullish(), bankName: z.string().max(120).nullish(), branch: z.string().max(120).nullish() })
    .nullish(),
  instructions: z.string().max(600).nullish(),
});
const providerBody = z.object({ enabled: z.boolean().optional(), test: keyInput.optional(), live: keyInput.optional(), manual: manualInput.optional() });

/** Save a provider: on or off, the keys for Test and Live, or the manual payment details. */
opsPaymentsRouter.put('/ops/payments/providers/:code', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: save a payment provider', async () => {
    const code = codeOf(req, res);
    if (!code) return;
    const parsed = providerBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the details.', problems: ['Some of the details are too long or in the wrong form.'] });
    try {
      const { changed } = await saveProvider(code, parsed.data, req.auth!.userId);
      if (changed.length) await audit(req, 'PAYMENT_PROVIDER_CHANGED', {}, { provider: code, changed });
      res.json({ changed, providers: await providersView() });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** Test or Live. Live asks twice in the console; the body must say LIVE in words as well. */
const modeBody = z.object({ mode: z.enum(['TEST', 'LIVE']), confirm: z.string().optional() });
opsPaymentsRouter.post('/ops/payments/providers/:code/mode', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: payment provider mode', async () => {
    const code = codeOf(req, res);
    if (!code) return;
    const parsed = modeBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose Test or Live.' });
    if (parsed.data.mode === 'LIVE' && parsed.data.confirm !== 'LIVE') return res.status(400).json({ error: 'Type LIVE to confirm. Live mode takes real money.', code: 'CONFIRM_LIVE' });
    try {
      const r = await setMode(code, parsed.data.mode, req.auth!.userId);
      if (r.from !== r.to) await audit(req, 'PAYMENT_PROVIDER_MODE_CHANGED', {}, { provider: code, from: r.from, to: r.to });
      res.json({ ...r, providers: await providersView() });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** Make a provider the one customers pay through. The one before it stops. */
opsPaymentsRouter.post('/ops/payments/providers/:code/activate', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: activate a payment provider', async () => {
    const code = codeOf(req, res);
    if (!code) return;
    try {
      const r = await activate(code, req.auth!.userId);
      await audit(req, 'PAYMENT_PROVIDER_ACTIVATED', {}, { provider: code, previous: r.previous });
      res.json({ ...r, providers: await providersView() });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** Ask the provider whether the saved keys work. Nothing is created or charged. */
opsPaymentsRouter.post('/ops/payments/providers/:code/test', requireOperatorRole('BILLING'), ...paymentTestLimiter, (req: Request, res) =>
  outsideTenant('ops: test a payment provider', async () => {
    const code = codeOf(req, res);
    if (!code) return;
    const r = await testProvider(code);
    await audit(req, 'PAYMENT_PROVIDER_TESTED', {}, { provider: code, mode: r.mode, ok: r.ok });
    res.json({ ...r, providers: await providersView() });
  }),
);

/* ---------------------------------------------------------- Payments log */

opsPaymentsRouter.get('/ops/payments/events', (req, res) =>
  outsideTenant('ops: payments log', async () => {
    const q = req.query as Record<string, string | undefined>;
    const before = q.before && !Number.isNaN(Date.parse(q.before)) ? q.before : undefined;
    const gateway = q.gateway && (isCode(q.gateway) || q.gateway === 'test') ? q.gateway : undefined;
    res.json(await listEvents({ status: q.status, gateway, before }));
  }),
);

opsPaymentsRouter.post('/ops/payments/events/:id/retry', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: retry a payment event', async () => {
    try {
      const r = await retryEvent(String(req.params.id));
      await audit(req, 'PAYMENT_EVENT_RETRIED', {}, { eventId: r.id, gateway: r.gateway, from: r.before, to: r.status });
      res.json(r);
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** Customer accounts by name, for Record a payment. */
opsPaymentsRouter.get('/ops/payments/accounts', (req, res) =>
  outsideTenant('ops: accounts to record a payment for', async () => {
    const q = String(req.query.q || '')
      .trim()
      .slice(0, 80);
    const accounts = await platformPrisma.account.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { startsWith: q } }] } : {},
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
    const subs = await platformPrisma.subscription.findMany({ where: { accountId: { in: accounts.map((a) => a.id) } }, select: { accountId: true, status: true, currentPeriodEnd: true } });
    const subOf = new Map(subs.map((s) => [s.accountId, { status: s.status, currentPeriodEnd: s.currentPeriodEnd }]));
    res.json({ accounts: accounts.map((a) => ({ ...a, subscription: subOf.get(a.id) ?? null })) });
  }),
);

/** "Mark paid": a UPI or bank transfer that reached CLOR's account. */
const manualPayment = z.object({
  accountId: z.string().min(1).max(40),
  amount: z.number().int().positive().max(1_00_00_000_00),
  reference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9/-]{6,40}$/),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  months: z.number().int().min(1).max(36),
  note: z.string().trim().max(300).nullish(),
});
opsPaymentsRouter.post('/ops/payments/manual', requireOperatorRole('BILLING'), requireOperatorStepUp, (req: Request, res) =>
  outsideTenant('ops: record a payment by hand', async () => {
    const parsed = manualPayment.safeParse(req.body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] || '');
      const say: Record<string, string> = {
        accountId: 'Choose the customer account.',
        amount: 'Enter the amount received, in rupees.',
        reference: 'Enter the UTR or bank reference: 6 to 40 letters and digits.',
        paidOn: 'Enter the date the money arrived.',
        months: 'Choose how many months the payment covers.',
      };
      return res.status(400).json({ error: say[field] || 'Check the payment details.' });
    }
    const paidOn = new Date(`${parsed.data.paidOn}T00:00:00+05:30`);
    if (paidOn.getTime() > Date.now() + 86400000) return res.status(400).json({ error: 'The date the money arrived cannot be in the future.' });
    try {
      const r = await recordManualPayment({ ...parsed.data, paidOn, userId: req.auth!.userId });
      await audit(req, 'PAYMENT_RECORDED_BY_HAND', { accountId: parsed.data.accountId }, { eventId: r.id, amount: parsed.data.amount, reference: parsed.data.reference.toUpperCase(), months: parsed.data.months, paidUntil: r.paidUntil });
      res.json(r);
    } catch (e) {
      return refused(res, e);
    }
  }),
);

export { PROVIDER_NAMES };
