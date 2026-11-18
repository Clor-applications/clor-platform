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
import { invoiceSends, lastSends, recipientFor, sendInvoiceEmail, type SendKind, type SendResult } from '../billing/invoiceEmail.js';
import { dueRenewals, runRenewals } from '../billing/renewals.js';
import { reminderForecast } from '../billing/invoiceReminders.js';
import { changesFor, saveSelfServe, selfServeSettings, takeBack } from '../billing/selfServe.js';
import { accountNames } from './opsDeals.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { audit } from './ops.js';
import { certificateReceived, certificatesDue, listVendorDocuments, proformaToInvoice, recentProformas, removeVendorDocument, saveVendorDocument, vendorDocumentFile } from '../billing/round67.js';

/**
 * CLOR's invoices to its customers, in the operator console (Money,
 * Invoices), and how they are numbered and where they go (Money, Invoice
 * settings: numbering, wording, the CLOR Books connector).
 *
 * Reading is for any operator. Every change is for the BILLING role with a
 * fresh authenticator code (step-up), and goes on the operator log. Test
 * connection is BILLING without step-up: it writes nothing.
 *
 * Emailing an invoice to the customer (billing/invoiceEmail.ts) is a change
 * like the others: issuing sends the first email when the console asks for it, and
 * Send again and Remind are their own routes. Issuing never fails because the
 * email did: the answer says `emailed: false` and why.
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
  /* Who the last email went to, and who the next one would go to (null: no email on the invoice and no owner to tell). */
  const last = (await lastSends([inv.id])).get(inv.id);
  const emailTo = inv.status === 'PAID' || inv.status === 'VOID' ? null : ((await recipientFor(inv))?.email ?? null);
  return { ...inv, payTo, account, overdue: isOverdue(inv), sentTo: last?.sentTo ?? null, lastSentAt: last?.lastSentAt ?? null, emailTo };
}

/** What an attempt to email an invoice came to, in the words the console shows. Never throws. */
async function emailOutcome(req: Request, id: string, kind: SendKind): Promise<{ emailed: boolean; emailedTo: string | null; emailError: string | null; email: SendResult | null }> {
  try {
    const r = await sendInvoiceEmail(id, { kind, userId: req.auth!.userId, audit: (action, accountId, detail) => audit(req, action, { accountId }, detail) });
    if (!r.sent) return { emailed: false, emailedTo: r.to, emailError: r.skipped === 'ALREADY_SENT' ? 'This invoice was emailed already.' : 'Reminders are turned off for this invoice.', email: r };
    /* The mail server refused it for now: the outbox tries again by itself, so it is not sent a second time here. */
    if (r.delivery === 'FAILED') return { emailed: false, emailedTo: r.to, emailError: 'The mail server did not take it just now. CLOR tries again by itself; see Email, Log before sending another.', email: r };
    return { emailed: true, emailedTo: r.to, emailError: null, email: r };
  } catch (e) {
    if (e instanceof PaymentsError) return { emailed: false, emailedTo: null, emailError: e.message, email: null };
    console.error('[ops.invoices] email failed:', e instanceof Error ? e.message : e);
    return { emailed: false, emailedTo: null, emailError: 'The email could not be sent. Send it again from the invoice.', email: null };
  }
}

opsInvoicesRouter.get('/ops/invoices', (req, res) =>
  outsideTenant('ops: invoices', async () => {
    const q = req.query as Record<string, string | undefined>;
    const list = await listInvoices({ status: q.status, accountId: q.accountId, before: q.before });
    /* The emails about each invoice on this page: who the last went to, and where its reminders stand. */
    const ids = list.invoices.map((i) => i.id);
    const [last, state] = await Promise.all([lastSends(ids), ids.length ? platformPrisma.billingInvoice.findMany({ where: { id: { in: ids } }, select: { id: true, lastRemindedAt: true, reminderCount: true, remindersOff: true } }) : []]);
    const stateOf = new Map(state.map((x) => [x.id, x]));
    const invoices = list.invoices.map((i) => ({
      ...i,
      sentTo: last.get(i.id)?.sentTo ?? null,
      lastSentAt: last.get(i.id)?.lastSentAt ?? null,
      lastRemindedAt: stateOf.get(i.id)?.lastRemindedAt ?? null,
      reminderCount: stateOf.get(i.id)?.reminderCount ?? 0,
      remindersOff: stateOf.get(i.id)?.remindersOff ?? false,
    }));
    res.json({ ...list, invoices, statuses: INVOICE_STATUSES });
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

/**
 * Issue, and email the customer when `email` is true. Asked for, never assumed: a console that
 * does not send the field (the one live before the drawer had its box) must not start mailing
 * customers the day this is deployed. The email failing never undoes or fails the issue.
 */
const issueBody = z.object({ email: z.boolean().optional() });
opsInvoicesRouter.post('/ops/invoices/:id/issue', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: issue an invoice', async () => {
    const parsed = issueBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Say whether to email the customer: yes or no.' });
    try {
      const inv = await issueInvoice(String(req.params.id), req.auth!.userId);
      await audit(req, 'INVOICE_ISSUED', { accountId: inv.accountId }, { invoiceId: inv.id, number: inv.number, total: inv.total });
      const books = await autoSend(inv.id);
      const mail = parsed.data.email !== true ? { emailed: false, emailedTo: null, emailError: null } : await emailOutcome(req, inv.id, 'ISSUED').then(({ email: _r, ...m }) => m);
      res.json({ ...(await full(inv.id)), books, ...mail });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** Send the invoice to the customer again (a copy of the first email), or remind them to pay. Only while it is issued and unpaid. */
const byHand = (kind: 'RESEND' | 'REMINDER') => (req: Request, res: Response) =>
  outsideTenant('ops: email an invoice', async () => {
    try {
      const id = String(req.params.id);
      const r = await sendInvoiceEmail(id, { kind, userId: req.auth!.userId, audit: (action, accountId, detail) => audit(req, action, { accountId }, detail) });
      /* By hand, nothing is skipped: it is sent, or refused above with the reason. */
      if (!r.sent) return res.status(409).json({ error: 'This was sent already.' });
      const failed = r.delivery === 'FAILED';
      res.json({
        ...(await full(id)),
        emailed: !failed,
        emailedTo: r.to,
        emailError: failed ? 'The mail server did not take it just now. CLOR tries again by itself; see Email, Log before sending another.' : null,
        send: { id: r.sendId, kind: r.kind, template: r.template, outboxId: r.outboxId, delivery: r.delivery },
      });
    } catch (e) {
      return refused(res, e);
    }
  });
opsInvoicesRouter.post('/ops/invoices/:id/send', ...BILLING, byHand('RESEND'));
opsInvoicesRouter.post('/ops/invoices/:id/remind', ...BILLING, byHand('REMINDER'));

/**
 * Stop, or start again, the automatic reminders for one invoice (billing/invoiceReminders.ts).
 * A reminder sent by hand is not stopped by it.
 */
const remindersBody = z.object({ off: z.boolean() }).strict();
opsInvoicesRouter.post('/ops/invoices/:id/reminders', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: an invoice’s automatic reminders', async () => {
    const parsed = remindersBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say whether reminders are off for this invoice: yes or no.' });
    try {
      const inv = await getInvoice(String(req.params.id));
      await platformPrisma.billingInvoice.update({ where: { id: inv.id }, data: { remindersOff: parsed.data.off } });
      await audit(req, parsed.data.off ? 'INVOICE_REMINDERS_STOPPED' : 'INVOICE_REMINDERS_RESUMED', { accountId: inv.accountId }, { invoiceId: inv.id, number: inv.number, off: parsed.data.off });
      res.json(await full(inv.id));
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** Every email about this invoice, newest first. */
opsInvoicesRouter.get('/ops/invoices/:id/sends', (req, res) =>
  outsideTenant('ops: an invoice’s emails', async () => {
    try {
      const inv = await getInvoice(String(req.params.id));
      res.json({ sends: await invoiceSends(inv.id), lastRemindedAt: inv.lastRemindedAt, reminderCount: inv.reminderCount, remindersOff: inv.remindersOff });
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
  /* Round 67: tax the customer deducted at source, in paise. */
  tdsDeducted: z.number().int().min(0).max(1_00_00_000_00).nullish(),
});
opsInvoicesRouter.post('/ops/invoices/:id/mark-paid', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: mark an invoice paid', async () => {
    const parsed = paidBody.safeParse(req.body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] || '');
      const say: Record<string, string> = { reference: 'Enter the UTR or bank reference: 6 to 40 letters and digits.', paidOn: 'Enter the date the money arrived.', amount: 'Enter the amount received, in rupees.', tdsDeducted: 'Enter the TDS deducted, in rupees.' };
      return res.status(400).json({ error: say[field] || 'Check the payment details.' });
    }
    const paidOn = new Date(`${parsed.data.paidOn}T00:00:00+05:30`);
    if (paidOn.getTime() > Date.now() + 86400000) return res.status(400).json({ error: 'The date the money arrived cannot be in the future.' });
    try {
      const r = await markInvoicePaid(String(req.params.id), { reference: parsed.data.reference, paidOn, amount: parsed.data.amount ?? null, tdsDeducted: parsed.data.tdsDeducted ?? null }, req.auth!.userId);
      await audit(req, 'INVOICE_MARKED_PAID', { accountId: r.invoice.accountId }, { invoiceId: r.invoice.id, number: r.invoice.number, amount: r.invoice.paidAmount, tdsDeducted: r.invoice.tdsDeducted ?? null, reference: r.invoice.paymentReference, paidUntil: r.paidUntil });
      res.json({ ...(await full(r.invoice.id)), paidUntil: r.paidUntil, paymentDetail: r.detail });
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
      /* Automatic reminders, and how many invoices they would mail today: as saved, and if they were on. */
      reminders: s.reminders,
      /* Seats customers add themselves (billing/selfServe.ts): off until switched on here. */
      selfServe: await selfServeSettings(),
      ...(await reminderForecast(s.reminders)),
      online: await onlinePayment(),
      books: { ...s.books, accountName: booksAccount?.name || null, accountCode: booksAccount?.code || null, companyName: booksOrg?.name || null, branchName: booksBranch?.branchName || null },
    });
  }),
);

const settingsBody = z.object({ prefix: z.string().max(10).optional(), dueDays: z.number().int().optional(), footer: z.string().max(600).nullish(), address: z.string().max(400).nullish(), nextNumber: z.number().int().nullish(), renewalsOn: z.boolean().optional(),
  renewalDaysBefore: z.number().int().optional(),
  /* The lists and the cap are checked in saveInvoicing, which says what is wrong in a sentence. */
  remindersOn: z.boolean().optional(),
  reminderDaysBefore: z.array(z.number()).max(50).optional(),
  reminderOnDueDate: z.boolean().optional(),
  reminderDaysAfter: z.array(z.number()).max(50).optional(),
  reminderCap: z.number().optional(),
});
opsInvoicesRouter.put('/ops/invoicing', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: save invoice settings', async () => {
    const parsed = settingsBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the invoice settings.' });
    try {
      const saved = await saveInvoicing(parsed.data, req.auth!.userId);
      /* Switching the automatic reminders on or off is on the log in so many words: it decides whether customers are written to. */
      await audit(req, 'INVOICE_SETTINGS_CHANGED', {}, { changed: Object.keys(parsed.data), ...(parsed.data.remindersOn !== undefined ? { remindersOn: saved.reminders.on, remindersSince: saved.reminders.since } : {}) });
      res.json({ ok: true });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/* ------------------------------------------- Seats customers add themselves */

const selfServeBody = z.object({ on: z.boolean().optional(), maxPerChange: z.number().int().optional(), payDays: z.number().int().optional() });
opsInvoicesRouter.put('/ops/self-serve', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: save self-serve seats', async () => {
    const parsed = selfServeBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the settings.' });
    try {
      const was = await selfServeSettings();
      const saved = await saveSelfServe(parsed.data, req.auth!.userId);
      /* Switching it on lets customers raise invoices to themselves: on the log in so many words. */
      await audit(req, 'SELF_SERVE_SEATS_CHANGED', {}, { on: saved.on, maxPerChange: saved.maxPerChange, payDays: saved.payDays, ...(was.on !== saved.on ? { switched: saved.on ? 'on' : 'off' } : {}) });
      res.json({ selfServe: saved });
    } catch (e) {
      return refused(res, e);
    }
  }),
);

/** The seats this customer added themselves, newest first. */
opsInvoicesRouter.get('/ops/accounts/:id/seat-changes', (req, res) =>
  outsideTenant('ops: seat changes', async () => {
    res.json({ changes: await changesFor(String(req.params.id), 50) });
  }),
);

/** Take back seats a customer added and has not paid for: the invoice is cancelled and the count goes back down. */
opsInvoicesRouter.post('/ops/seat-changes/:id/cancel', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: take seats back', async () => {
    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < 3) return res.status(400).json({ error: 'Say why, for the customer’s record.' });
    const c = await platformPrisma.subscriptionChange.findUnique({ where: { id: String(req.params.id) } });
    if (!c) return res.status(404).json({ error: 'No such change.' });
    if (c.status !== 'OPEN') return res.status(409).json({ error: 'Only seats waiting to be paid can be taken back.' });
    try {
      const done = await takeBack(c.id, 'CANCELLED', `Taken back by CLOR: ${reason}`.slice(0, 500), req.auth!.userId);
      if (!done) return res.status(409).json({ error: 'The invoice was paid a moment ago, so the seats stay.' });
      await audit(req, 'SEATS_TAKEN_BACK', { accountId: c.accountId }, { seats: c.added, reason });
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

/* ------------------------------------------------ round 67: TDS, proformas, vendor documents */

/** Paid invoices whose TDS certificate has not come in: the console chases them until it does. */
opsInvoicesRouter.get('/ops/invoicing/tds-due', (_req, res) => outsideTenant('ops: TDS certificates due', async () => res.json({ invoices: await certificatesDue() })));

const certBody = z.object({ receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });
opsInvoicesRouter.post('/ops/invoices/:id/tds-certificate', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: TDS certificate received', async () => {
    const parsed = certBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Enter the date the certificate came in.' });
    try {
      const on = parsed.data.receivedOn ? new Date(`${parsed.data.receivedOn}T00:00:00+05:30`) : new Date();
      const inv = await certificateReceived(String(req.params.id), on);
      await audit(req, 'INVOICE_TDS_CERTIFICATE', { accountId: inv.accountId }, { invoiceId: inv.id, number: inv.number, tdsDeducted: inv.tdsDeducted });
      res.json(await full(inv.id));
    } catch (e) {
      return refused(res, e);
    }
  }),
);

opsInvoicesRouter.get('/ops/invoicing/proformas', (_req, res) => outsideTenant('ops: proformas', async () => res.json({ proformas: await recentProformas() })));

opsInvoicesRouter.post('/ops/invoicing/proformas/:id/invoice', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: proforma to invoice', async () => {
    try {
      const draft = await proformaToInvoice(String(req.params.id), req.auth!.userId);
      await audit(req, 'PROFORMA_TO_INVOICE', { accountId: draft.accountId }, { proformaId: String(req.params.id), invoiceId: draft.id });
      res.status(201).json(await full(draft.id));
    } catch (e) {
      return refused(res, e);
    }
  }),
);

opsInvoicesRouter.get('/ops/invoicing/vendor-documents', (_req, res) => outsideTenant('ops: vendor documents', async () => res.json({ documents: await listVendorDocuments() })));

opsInvoicesRouter.post('/ops/invoicing/vendor-documents', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: add a vendor document', async () => {
    try {
      const doc = await saveVendorDocument(req.body ?? {}, req.auth!.userId);
      await audit(req, 'VENDOR_DOCUMENT_ADDED', {}, { id: doc.id, kind: doc.kind, title: doc.title });
      res.status(201).json(doc);
    } catch (e) {
      return refused(res, e);
    }
  }),
);

opsInvoicesRouter.delete('/ops/invoicing/vendor-documents/:id', ...BILLING, (req: Request, res) =>
  outsideTenant('ops: remove a vendor document', async () => {
    try {
      await removeVendorDocument(String(req.params.id));
      await audit(req, 'VENDOR_DOCUMENT_REMOVED', {}, { id: String(req.params.id) });
      res.status(204).end();
    } catch (e) {
      return refused(res, e);
    }
  }),
);

opsInvoicesRouter.get('/ops/invoicing/vendor-documents/:id/file', (req, res) =>
  outsideTenant('ops: a vendor document file', async () => {
    try {
      const d = await vendorDocumentFile(String(req.params.id));
      /* As a data URL in JSON: the browser saves it through a link, with the session's own headers on the request. */
      res.json({ fileName: d.fileName, contentType: d.contentType, dataUrl: `data:${d.contentType};base64,${Buffer.from(d.content).toString('base64')}` });
    } catch (e) {
      return refused(res, e);
    }
  }),
);
