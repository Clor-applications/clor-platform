import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { paymentTestLimiter } from '../middleware/rateLimit.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { PaymentsError } from '../billing/providers.js';
import { taxSetting } from '../services/pricing/settings.js';
import { createDraft, deleteDraft, getInvoice, isOverdue, issueInvoice, listInvoices, markInvoicePaid, payToFor, suggestedLines, buyerFor, updateDraft, voidInvoice, INVOICE_STATUSES } from '../billing/invoices.js';
import { financialYear, formatNumber, invoicing, saveBooksLink, saveInvoicing } from '../billing/invoicing.js';
import { autoSend, booksChoices, sendToBooks, testBooks } from '../billing/booksConnector.js';
import { onlinePayment } from '../billing/payLinks.js';
import { dueRenewals, runRenewals } from '../billing/renewals.js';
import { accountNames } from './opsDeals.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { audit } from './ops.js';

/**
 * CLOR's invoices to its customers, in the operator console (Money,
 * Invoices), and how they are numbered and where they go (Money, Invoice
 * settings: numbering, wording, the CLOR Books connector).
 *
 * Reading is for any operator. Every change is for the BILLING role with a
 * fresh authenticator code (step-up), and goes on the operator log. Test
 * connection is BILLING without step-up: it writes nothing.
 */
export const opsInvoicesRouter = Router();
opsInvoicesRouter.use(['/ops/invoices', '/ops/invoicing'], requireAuth, requireOperator);

const refused = (res: Response, e: unknown) => {
  if (!(e instanceof PaymentsError)) throw e;
  return res.status(e.status).json({ error: e.message, problems: e.problems });
};
const BILLING = [requireOperatorRole('BILLING'), requireOperatorStepUp] as const;

/** The whole of one invoice for the console, with the account's name and what may be done next. */
async function full(id: string) {
  const inv = await getInvoice(id);
  const account = await outsideTenant('ops: an invoice’s account', () => platformPrisma.account.findUnique({ where: { id: inv.accountId }, select: { id: true, name: true, code: true } }));
  /* A draft shows the way to pay it would carry, from today's Payments settings. */
  const payTo = inv.status === 'DRAFT' ? await payToFor(inv.total, 'Draft') : inv.payTo;
  return { ...inv, payTo, account, overdue: isOverdue(inv) };
}

opsInvoicesRouter.get('/ops/invoices', (req, res) =>
  outsideTenant('ops: invoices', async () => {
    const q = req.query as Record<string, string | undefined>;
    res.json({ ...(await listInvoices({ status: q.status, accountId: q.accountId, before: q.before })), statuses: INVOICE_STATUSES });
  }),
);

/** To start a draft: who it is to and the lines the subscription suggests. */
opsInvoicesRouter.get('/ops/invoices/start', (req, res) =>
  outsideTenant('ops: start an invoice', async () => {
    const accountId = String(req.query.accountId || '');
    try {
      const [buyer, lines, gst] = await Promise.all([buyerFor(accountId), suggestedLines(accountId), taxSetting()]);
      res.json({ buyer, lines, gstRegistered: gst.registered });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

opsInvoicesRouter.get('/ops/invoices/:id', (req, res) =>
  outsideTenant('ops: an invoice', async () => {
    try {
      res.json(await full(String(req.params.id)));
    } catch (e) {
      return refused(res, e);
    }
  }),
);

const line = z.object({ description: z.string().max(200), appCode: z.string().max(20).nullish(), quantity: z.number(), unitAmount: z.number() });
const buyer = z.object({ name: z.string().max(160).nullish(), gstin: z.string().max(20).nullish(), state: z.string().max(60).nullish(), address: z.string().max(400).nullish(), email: z.string().max(160).nullish() });
const draftBody = z.object({
  accountId: z.string().max(40).optional(),
  lines: z.array(line).max(30).optional(),
  buyer: buyer.optional(),
  periodStart: z.string().max(10).nullish(),
  periodEnd: z.string().max(10).nullish(),
  note: z.string().max(600).nullish(),
  months: z.number().int().optional(),
});
const badBody = (res: Response) => res.status(400).json({ error: 'Check the invoice.', problems: ['Some of the details are too long or in the wrong form.'] });

opsInvoicesRouter.post('/ops/invoices', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: new invoice', async () => {
    const parsed = draftBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.accountId) return badBody(res);
    try {
      const inv = await createDraft(parsed.data, req.auth!.userId);
      await audit(req, 'INVOICE_DRAFTED', { accountId: inv.accountId }, { invoiceId: inv.id, total: inv.total });
      res.status(201).json(await full(inv.id));
    } catch (e) {
      return refused(res, e);
    }
  }),
);

opsInvoicesRouter.patch('/ops/invoices/:id', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: change an invoice draft', async () => {
    const parsed = draftBody.safeParse(req.body);
    if (!parsed.success) return badBody(res);
    try {
      const inv = await updateDraft(String(req.params.id), parsed.data);
      await audit(req, 'INVOICE_DRAFT_CHANGED', { accountId: inv.accountId }, { invoiceId: inv.id, total: inv.total });
      res.json(await full(inv.id));
    } catch (e) {
      return refused(res, e);
    }
  }),
);

opsInvoicesRouter.delete('/ops/invoices/:id', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: discard an invoice draft', async () => {
    try {
      const inv = await getInvoice(String(req.params.id));
      await deleteDraft(inv.id);
      await audit(req, 'INVOICE_DRAFT_DISCARDED', { accountId: inv.accountId }, { invoiceId: inv.id });
      res.json({ ok: true });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

opsInvoicesRouter.post('/ops/invoices/:id/issue', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: issue an invoice', async () => {
    try {
      const inv = await issueInvoice(String(req.params.id), req.auth!.userId);
      await audit(req, 'INVOICE_ISSUED', { accountId: inv.accountId }, { invoiceId: inv.id, number: inv.number, total: inv.total });
      const books = await autoSend(inv.id);
      res.json({ ...(await full(inv.id)), books });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

const paidBody = z.object({
  reference: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9/-]{6,40}$/),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int().positive().max(1_00_00_000_00).nullish(),
});
opsInvoicesRouter.post('/ops/invoices/:id/mark-paid', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: mark an invoice paid', async () => {
    const parsed = paidBody.safeParse(req.body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] || '');
      const say: Record<string, string> = { reference: 'Enter the UTR or bank reference: 6 to 40 letters and digits.', paidOn: 'Enter the date the money arrived.', amount: 'Enter the amount received, in rupees.' };
      return res.status(400).json({ error: say[field] || 'Check the payment details.' });
    }
    const paidOn = new Date(`${parsed.data.paidOn}T00:00:00+05:30`);
    if (paidOn.getTime() > Date.now() + 86400000) return res.status(400).json({ error: 'The date the money arrived cannot be in the future.' });
    try {
      const r = await markInvoicePaid(String(req.params.id), { reference: parsed.data.reference, paidOn, amount: parsed.data.amount ?? null }, req.auth!.userId);
      await audit(req, 'INVOICE_MARKED_PAID', { accountId: r.invoice.accountId }, { invoiceId: r.invoice.id, number: r.invoice.number, amount: r.invoice.paidAmount, reference: r.invoice.paymentReference, paidUntil: r.paidUntil });
      res.json({ ...(await full(r.invoice.id)), paidUntil: r.paidUntil });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

const voidBody = z.object({ reason: z.string().trim().min(3).max(300) });
opsInvoicesRouter.post('/ops/invoices/:id/void', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: cancel an invoice', async () => {
    const parsed = voidBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say why it is cancelled, in a few words.' });
    try {
      const inv = await voidInvoice(String(req.params.id), parsed.data.reason, req.auth!.userId);
      await audit(req, 'INVOICE_CANCELLED', { accountId: inv.accountId }, { invoiceId: inv.id, number: inv.number, reason: parsed.data.reason });
      res.json(await full(inv.id));
    } catch (e) {
      return refused(res, e);
    }
  }),
);

opsInvoicesRouter.post('/ops/invoices/:id/books', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: send an invoice to Books', async () => {
    try {
      const r = await sendToBooks(String(req.params.id));
      const inv = await getInvoice(String(req.params.id));
      await audit(req, 'INVOICE_SENT_TO_BOOKS', { accountId: inv.accountId }, { invoiceId: inv.id, number: inv.number, ok: r.ok });
      res.json({ ...(await full(inv.id)), books: r });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/* ------------------------------------------------------- Invoice settings */

opsInvoicesRouter.get('/ops/invoicing', (_req, res) =>
  outsideTenant('ops: invoice settings', async () => {
    const [s, gst] = await Promise.all([invoicing(), taxSetting()]);
    const fy = financialYear(new Date());
    const manual = await platformPrisma.paymentProvider.findUnique({ where: { code: 'manual' }, select: { enabled: true } });
    const booksOrg = s.books.orgId ? await platformPrisma.org.findUnique({ where: { id: s.books.orgId }, select: { name: true } }) : null;
    const booksAccount = s.books.accountId ? await platformPrisma.account.findUnique({ where: { id: s.books.accountId }, select: { name: true, code: true } }) : null;
    const booksBranch = s.books.branchId ? await platformPrisma.branch.findUnique({ where: { id: s.books.branchId }, select: { branchName: true } }) : null;
    res.json({
      prefix: s.prefix,
      dueDays: s.dueDays,
      footer: s.footer,
      address: s.address,
      financialYear: fy,
      nextNumber: formatNumber(s.prefix, fy, (s.counters[fy] || 0) + 1),
      nextNumberValue: (s.counters[fy] || 0) + 1,
      gst: { registered: gst.registered, gstin: gst.gstin, legalName: gst.legalName, sac: gst.sac, ratePercent: gst.ratePercent },
      manualPayments: Boolean(manual?.enabled),
      renewals: s.renewals,
      online: await onlinePayment(),
      books: { ...s.books, accountName: booksAccount?.name || null, accountCode: booksAccount?.code || null, companyName: booksOrg?.name || null, branchName: booksBranch?.branchName || null },
    });
  }),
);

const settingsBody = z.object({ prefix: z.string().max(10).optional(), dueDays: z.number().int().optional(), footer: z.string().max(600).nullish(), address: z.string().max(400).nullish(), nextNumber: z.number().int().nullish(), renewalsOn: z.boolean().optional(), renewalDaysBefore: z.number().int().optional() });
opsInvoicesRouter.put('/ops/invoicing', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: save invoice settings', async () => {
    const parsed = settingsBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the invoice settings.' });
    try {
      await saveInvoicing(parsed.data, req.auth!.userId);
      await audit(req, 'INVOICE_SETTINGS_CHANGED', {}, { changed: Object.keys(parsed.data) });
      res.json({ ok: true });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** Renewals coming up in the next 30 days, and whether each one's invoice is out yet. */
opsInvoicesRouter.get('/ops/invoicing/renewals', (_req, res) =>
  outsideTenant('ops: renewals coming up', async () => {
    const s = await invoicing();
    const subs = await dueRenewals(new Date(), 30);
    const ids = subs.map((x) => x.accountId);
    const [accounts, titles, done] = await Promise.all([
      platformPrisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true } }),
      accountNames(ids),
      platformPrisma.billingInvoice.findMany({ where: { accountId: { in: ids }, source: 'RENEWAL', renewalFor: { not: null } }, select: { accountId: true, renewalFor: true, id: true, number: true, status: true } }),
    ]);
    const name = new Map(accounts.map((a) => [a.id, a]));
    const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    res.json({
      renewals: s.renewals,
      upcoming: subs.map((x) => {
        const starts = istDay(x.currentPeriodEnd!);
        const inv = done.find((d) => d.accountId === x.accountId && d.renewalFor === starts);
        return {
          accountId: x.accountId,
          name: titles.get(x.accountId) || name.get(x.accountId)?.name || 'A customer',
          code: name.get(x.accountId)?.code || null,
          planName: x.planName,
          interval: x.billingInterval,
          renewsOn: starts,
          invoice: inv ? { id: inv.id, number: inv.number, status: inv.status } : null,
          dueNow: x.currentPeriodEnd!.getTime() <= Date.now() + s.renewals.daysBefore * 86_400_000,
        };
      }),
    });
  }),
);

/** Issue the renewal invoices that are due now, without waiting for the next run (every six hours). */
opsInvoicesRouter.post('/ops/invoicing/renewals/run', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: issue renewal invoices now', async () => {
    const s = await invoicing();
    if (!s.renewals.on) return res.status(409).json({ error: 'Renewal invoices are turned off. Turn them on in Invoice settings first.' });
    const r = await runRenewals();
    await audit(req, 'INVOICE_RENEWALS_RUN', {}, { issued: r.issued, skipped: r.skipped, failed: r.failed.length });
    res.json(r);
  }),
);

opsInvoicesRouter.get('/ops/invoicing/books/choices', (req, res) =>
  outsideTenant('ops: Books companies', async () => {
    res.json({ accounts: await booksChoices(String(req.query.q || '')) });
  }),
);

const booksBody = z.object({ enabled: z.boolean().optional(), accountId: z.string().max(40).nullish(), orgId: z.string().max(40).nullish(), branchId: z.string().max(40).nullish(), autoSend: z.boolean().optional() });
opsInvoicesRouter.put('/ops/invoicing/books', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: save the CLOR Books connector', async () => {
    const parsed = booksBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the connector settings.' });
    try {
      const s = await saveBooksLink(parsed.data as any, req.auth!.userId);
      await audit(req, 'BOOKS_CONNECTOR_CHANGED', {}, { enabled: s.books.enabled, autoSend: s.books.autoSend, orgId: s.books.orgId });
      res.json({ ok: true });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

opsInvoicesRouter.post('/ops/invoicing/books/test', requireOperatorRole('BILLING'), ...paymentTestLimiter, (req: Request, res) =>
  outsideTenant('ops: test the CLOR Books connector', async () => {
    const r = await testBooks();
    await audit(req, 'BOOKS_CONNECTOR_TESTED', {}, { ok: r.ok });
    res.json(r);
  }),
);
