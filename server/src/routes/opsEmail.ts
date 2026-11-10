import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator, requireOperatorRole } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { requireOperatorStepUp } from '../services/stepUp.js';
import { SENDER_PURPOSES, deliver, resolveTransport, sendTemplate, senderPurposeFor } from '../services/mailer.js';
import { plainMailFailure } from '../services/mailWords.js';
import { EMAIL_TEMPLATES, TEMPLATE_BY_KEY, render } from '../constants/emailTemplates.js';
import { audit } from './ops.js';

/**
 * Email on the operator console (roadmap item 14): the addresses CLOR's own
 * mail goes out from, the wording of every template, and the log of every
 * message the product tried to send, with Resend for one that failed.
 *
 * Owners change addresses and wording; anybody but Read-only sends a test;
 * Support and Finance resend. Every change and every test is on the record.
 */
export const opsEmailRouter = Router();
opsEmailRouter.use('/ops/email', requireAuth, requireOperator);

const SENDER_WORDS: Record<string, { label: string; uses: string }> = {
  sales: { label: 'Sales', uses: 'Demo requests and Explore links' },
  support: { label: 'Support', uses: 'Replies to customers who need help' },
  billing: { label: 'Billing', uses: 'Trials, plans, invoices and payments' },
  'no-reply': { label: 'No-reply', uses: 'Sign-in, password and invitation mail, and everything else' },
};

const opEmail = async (userId: string) => (await platformPrisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email || '';

/** Every sender address, set or not, and the address mail uses where none is set. */
opsEmailRouter.get('/ops/email/senders', (_req, res) =>
  outsideTenant('ops: email senders', async () => {
    const rows = await platformPrisma.emailSender.findMany();
    const by = new Map(rows.map((r) => [r.purpose, r]));
    const transport = await resolveTransport(null, null);
    res.json({
      serverFrom: transport.from,
      /* Capture: the server records mail without sending it (no mail server set up), as on a developer's machine. */
      sending: transport.kind === 'smtp',
      senders: SENDER_PURPOSES.map((p) => {
        const r = by.get(p);
        return { purpose: p, ...SENDER_WORDS[p], name: r?.name || '', email: r?.email || '', replyTo: r?.replyTo || '', set: Boolean(r), updatedAt: r?.updatedAt || null };
      }),
    });
  }),
);

const senderBody = z.object({
  name: z.string().trim().min(1, 'Enter the name people see.').max(80),
  email: z.string().trim().toLowerCase().email('That is not an email address.'),
  replyTo: z.union([z.literal(''), z.string().trim().toLowerCase().email('The reply-to is not an email address.')]).optional(),
  reason: z.string().trim().min(3, 'Say why, in a sentence.').max(500),
});

opsEmailRouter.put('/ops/email/senders/:purpose', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: set email sender', async () => {
    const purpose = String(req.params.purpose);
    if (!(SENDER_PURPOSES as readonly string[]).includes(purpose)) return res.status(404).json({ error: 'No such sender address.' });
    const parsed = senderBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the address.' });
    const before = await platformPrisma.emailSender.findUnique({ where: { purpose } });
    const data = { name: parsed.data.name, email: parsed.data.email, replyTo: parsed.data.replyTo || null, updatedByUserId: req.auth!.userId };
    const row = await platformPrisma.emailSender.upsert({ where: { purpose }, create: { purpose, ...data }, update: data });
    await audit(req, 'EMAIL_SENDER_CHANGED', {}, { purpose, from: before ? `${before.name} <${before.email}>` : null, to: `${row.name} <${row.email}>`, reason: parsed.data.reason });
    res.json({ sender: row });
  }),
);

const testBody = z.object({ to: z.string().trim().toLowerCase().email('That is not an email address.').optional() });

/** What a message's outcome means, in words. */
const outcome = (row: { status: string; lastError: string | null; toEmail: string } | null) => {
  if (!row) return { sent: false, status: null, message: 'Nothing was sent.' };
  if (row.status === 'SENT') return { sent: true, status: row.status, message: `Sent to ${row.toEmail}. Check that inbox.` };
  return { sent: false, status: row.status, message: plainMailFailure(row.lastError, row.status) || 'Not sent.' };
};

opsEmailRouter.post('/ops/email/senders/:purpose/test', requireOperatorRole('SALES', 'SUPPORT', 'BILLING'), (req, res) =>
  outsideTenant('ops: test email sender', async () => {
    const purpose = String(req.params.purpose);
    if (!(SENDER_PURPOSES as readonly string[]).includes(purpose)) return res.status(404).json({ error: 'No such sender address.' });
    const parsed = testBody.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the address.' });
    const to = parsed.data.to || (await opEmail(req.auth!.userId));
    const s = await platformPrisma.emailSender.findUnique({ where: { purpose } });
    const row = await sendTemplate({
      templateKey: 'ops.sender_test',
      to,
      transactional: true,
      relatedType: 'EmailSenderTest',
      relatedId: purpose,
      data: { senderEmail: s?.email || 'the server’s default address', purpose: SENDER_WORDS[purpose].label.toLowerCase() },
    });
    await audit(req, 'EMAIL_SENDER_TESTED', {}, { purpose, to, status: row?.status });
    res.json(outcome(row));
  }),
);

/* -------------------------------------------------------------- templates */

/* Example values for a preview or a test, so the wording reads as the customer will see it. */
const SAMPLE: Record<string, string> = {
  userName: 'Asha Rao',
  name: 'Asha Rao',
  email: 'asha@raotextiles.in',
  orgName: 'Rao Textiles',
  companyName: 'Rao Textiles',
  accountName: 'Rao Textiles',
  inviterName: 'Ravi Kumar',
  appName: 'CLOR',
  appUrl: 'https://app.clor.in',
  opsUrl: 'https://ops.clor.in',
  role: 'Support',
  expiresOn: '2026-11-17',
  period: 'October 2026',
  amount: '₹ 12,500.00',
  senderEmail: 'sales@clor.in',
  purpose: 'sales',
};
const sampleFor = (fields: string[]) =>
  Object.fromEntries(fields.map((f) => [f, SAMPLE[f] ?? (/url$/i.test(f) ? 'https://app.clor.in/…' : /date|on$/i.test(f) ? '17 Nov 2026' : `[${f}]`)]));

const placeholders = (text: string) => [...String(text).matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((m) => m[1]);

opsEmailRouter.get('/ops/email/templates', (_req, res) =>
  outsideTenant('ops: email templates', async () => {
    const overrides = new Map((await platformPrisma.emailTemplateOverride.findMany()).map((o) => [o.key, o]));
    res.json({
      templates: EMAIL_TEMPLATES.map((t) => {
        const o = overrides.get(t.key);
        return {
          key: t.key,
          label: t.label,
          description: t.description,
          fields: [...new Set([...t.fields, 'appName', 'appUrl'])],
          transactional: Boolean(t.transactional),
          sender: senderPurposeFor(t.key),
          changed: Boolean(o),
          changedAt: o?.updatedAt || null,
          subject: o?.subject ?? t.subject,
          body: o?.body ?? t.body,
          defaultSubject: t.subject,
          defaultBody: t.body,
        };
      }),
    });
  }),
);

const wordingBody = z.object({
  subject: z.string().trim().min(1, 'Write a subject.').max(300),
  body: z.string().trim().min(1, 'Write the message.').max(10_000),
  reason: z.string().trim().min(3, 'Say why, in a sentence.').max(500).optional(),
});

/** A placeholder the template does not fill would reach the customer as a blank. */
function unknownPlaceholders(key: string, subject: string, body: string) {
  const t = TEMPLATE_BY_KEY.get(key)!;
  const known = new Set([...t.fields, 'appName', 'appUrl']);
  return [...new Set([...placeholders(subject), ...placeholders(body)])].filter((p) => !known.has(p));
}

opsEmailRouter.put('/ops/email/templates/:key', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: change email template', async () => {
    const key = String(req.params.key);
    if (!TEMPLATE_BY_KEY.has(key)) return res.status(404).json({ error: 'No such email.' });
    const parsed = wordingBody.required({ reason: true }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the wording.' });
    const unknown = unknownPlaceholders(key, parsed.data.subject, parsed.data.body);
    if (unknown.length) return res.status(400).json({ error: `This email cannot fill ${unknown.map((u) => `{{${u}}}`).join(', ')}. Use only the placeholders listed.`, code: 'UNKNOWN_PLACEHOLDER' });
    const data = { subject: parsed.data.subject, body: parsed.data.body, updatedByUserId: req.auth!.userId };
    await platformPrisma.emailTemplateOverride.upsert({ where: { key }, create: { key, ...data }, update: data });
    await audit(req, 'EMAIL_TEMPLATE_CHANGED', {}, { key, subject: parsed.data.subject, reason: parsed.data.reason });
    res.json({ saved: true });
  }),
);

opsEmailRouter.delete('/ops/email/templates/:key', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: reset email template', async () => {
    const key = String(req.params.key);
    if (!TEMPLATE_BY_KEY.has(key)) return res.status(404).json({ error: 'No such email.' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (reason.length < 3) return res.status(400).json({ error: 'Say why, in a sentence.' });
    const done = await platformPrisma.emailTemplateOverride.deleteMany({ where: { key } });
    if (!done.count) return res.status(409).json({ error: 'This email already uses the default wording.' });
    await audit(req, 'EMAIL_TEMPLATE_RESET', {}, { key, reason });
    res.json({ reset: true });
  }),
);

/** The wording as typed, filled with example values. Changes nothing. */
opsEmailRouter.post('/ops/email/templates/:key/preview', (req, res) => {
  const key = String(req.params.key);
  const t = TEMPLATE_BY_KEY.get(key);
  if (!t) return res.status(404).json({ error: 'No such email.' });
  const subject = typeof req.body?.subject === 'string' ? req.body.subject : t.subject;
  const body = typeof req.body?.body === 'string' ? req.body.body : t.body;
  const data = sampleFor([...t.fields, 'appName', 'appUrl']);
  res.json({ subject: render(subject, data), body: render(body, data), unknown: unknownPlaceholders(key, subject, body) });
});

/** The saved wording, with example values, to the operator's own inbox (or the address given). */
opsEmailRouter.post('/ops/email/templates/:key/test', requireOperatorRole('SALES', 'SUPPORT', 'BILLING'), (req, res) =>
  outsideTenant('ops: test email template', async () => {
    const key = String(req.params.key);
    const t = TEMPLATE_BY_KEY.get(key);
    if (!t) return res.status(404).json({ error: 'No such email.' });
    const parsed = testBody.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Check the address.' });
    const to = parsed.data.to || (await opEmail(req.auth!.userId));
    const row = await sendTemplate({ templateKey: key, to, transactional: true, relatedType: 'EmailTemplateTest', relatedId: key, data: sampleFor(t.fields) });
    await audit(req, 'EMAIL_TEMPLATE_TESTED', {}, { key, to, status: row?.status });
    res.json(outcome(row));
  }),
);

/* -------------------------------------------------------------------- log */

const logQuery = z.object({
  status: z.enum(['all', 'SENT', 'FAILED', 'QUEUED', 'SUPPRESSED']).optional(),
  q: z.string().trim().max(120).optional(),
  template: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(0).max(10_000).optional(),
});
const LOG_PAGE = 50;

/** Every message the product tried to send, newest first. The message body is not shown: it may hold a customer's data. */
opsEmailRouter.get('/ops/email/log', (req, res) =>
  outsideTenant('ops: email log', async () => {
    const parsed = logQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Those filters are not right.' });
    const { status = 'all', q = '', template, page = 0 } = parsed.data;
    const where: any = {};
    if (status !== 'all') where.status = status;
    if (template) where.templateKey = template;
    if (q) where.OR = [{ toEmail: { contains: q, mode: 'insensitive' } }, { subject: { contains: q, mode: 'insensitive' } }];
    const [total, rows, failedWeek] = await Promise.all([
      platformPrisma.emailOutbox.count({ where }),
      platformPrisma.emailOutbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page * LOG_PAGE,
        take: LOG_PAGE,
        select: { id: true, accountId: true, templateKey: true, toEmail: true, subject: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
      }),
      platformPrisma.emailOutbox.count({ where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    ]);
    const accounts = await platformPrisma.account.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.accountId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
    const acct = new Map(accounts.map((a) => [a.id, a.name]));
    res.json({
      total,
      page,
      pageSize: LOG_PAGE,
      failedThisWeek: failedWeek,
      messages: rows.map((r) => ({
        id: r.id,
        to: r.toEmail,
        template: r.templateKey,
        templateLabel: TEMPLATE_BY_KEY.get(r.templateKey)?.label || r.templateKey,
        subject: r.subject,
        status: r.status,
        attempts: r.attempts,
        reason: plainMailFailure(r.lastError, r.status),
        accountId: r.accountId,
        accountName: r.accountId ? acct.get(r.accountId) || null : null,
        at: r.createdAt,
        sentAt: r.sentAt,
      })),
    });
  }),
);

/** Try a failed (or stuck) message again, as it was. A sent one is not sent twice: its links were taken out after sending. */
opsEmailRouter.post('/ops/email/log/:id/resend', requireOperatorRole('SUPPORT', 'BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: resend email', async () => {
    const id = String(req.params.id);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (reason.length < 3) return res.status(400).json({ error: 'Say why, in a sentence.' });
    const row = await platformPrisma.emailOutbox.findUnique({ where: { id }, select: { id: true, status: true, accountId: true, orgId: true, toEmail: true, templateKey: true } });
    if (!row) return res.status(404).json({ error: 'No such message.' });
    if (row.status === 'SENT') return res.status(409).json({ error: 'This one was sent. Its links were taken out after sending, so it cannot go again; send a fresh one from where it started.' });
    if (row.status === 'SUPPRESSED') return res.status(409).json({ error: 'This one was held back on purpose and is not sent.' });
    const after = await deliver(row.id, row.accountId, row.orgId);
    await audit(req, 'EMAIL_RESENT', { accountId: row.accountId }, { messageId: row.id, to: row.toEmail, template: row.templateKey, status: after?.status, reason });
    res.json(outcome(after as any));
  }),
);
