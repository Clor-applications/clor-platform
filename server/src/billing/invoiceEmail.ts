import { randomUUID } from 'node:crypto';

import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { sendTemplate } from '../services/mailer.js';
import { rupees } from '../services/pricing/engine.js';
import { SYSTEM_OPERATOR } from '../routes/ops.js';
import { getInvoice, type Buyer } from './invoices.js';
import { onlinePayment, payLinkFor } from './payLinks.js';
import { PaymentsError } from './providers.js';

/**
 * Emailing CLOR's own invoices to the customer: the first email when an
 * invoice is issued, a copy staff send again, and a reminder to pay (the
 * overdue wording once the due date has passed). The mail carries a link to
 * pay online when a gateway is on, CLOR's UPI ID and bank account as frozen on
 * the invoice, and a link to the invoice in Workspace. No PDF is attached.
 *
 * Nothing is sent twice. A BillingInvoiceSend row is written BEFORE the mail
 * goes, with a unique key: `<invoiceId>:issued` for the first email,
 * `<invoiceId>:auto:<step>` for an automatic one, the row's own id for one
 * staff sent by hand. A second writer of the same key sends nothing. If the
 * mail could not be handed to the mailer at all, the row is taken away again
 * so it can be tried once more. Once the mailer has the message the row stays,
 * even when the mail server refused it: the outbox tries that message again by
 * itself (services/emailRetry.ts), so sending another would be a second copy.
 *
 * Only an ISSUED invoice is emailed. A paid or cancelled one has nothing due,
 * and this wording asks for money, so both are refused for every kind,
 * RESEND included: a paid copy would need its own wording ("paid, thank you"),
 * which is not written yet. The status is read again just before the mail
 * goes, after the payment link is made, because making a link can find the
 * invoice was paid a moment ago.
 */

export const SEND_KINDS = ['ISSUED', 'RESEND', 'REMINDER'] as const;
export type SendKind = (typeof SEND_KINDS)[number];
export type Recipient = { email: string; name: string; userId: string | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 86_400_000;
/** A second press of the same button within this long is refused: the first one is still going. */
const SAME_AGAIN_MS = 60_000;
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const words = (iso: string) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';
const appUrl = () => (process.env.APP_URL || 'https://app.clor.in').replace(/\/$/, '');
const db = <T>(fn: () => Promise<T>) => outsideTenant('billing: emailing an invoice', fn);

/**
 * Who an invoice is emailed to: the email on the invoice (its buyer), else the
 * account's first active owner who can still sign in. Null when there is no
 * one. An address that belongs to a person who was deactivated is never used,
 * on the invoice or not: the next owner is told instead.
 */
export async function recipientFor(inv: { accountId: string; buyer: unknown }): Promise<Recipient | null> {
  return db(async () => {
    const buyer = (inv.buyer && typeof inv.buyer === 'object' ? inv.buyer : {}) as Partial<Buyer>;
    const asked = String(buyer.email || '').trim();
    if (asked && EMAIL.test(asked)) {
      const user = await platformPrisma.user.findFirst({ where: { email: { equals: asked, mode: 'insensitive' } }, select: { id: true, fullName: true, isActive: true } });
      if (!user) return { email: asked, name: buyer.name || asked, userId: null };
      if (user.isActive) {
        /* Their own name only if they belong to this account; otherwise the name on the invoice. */
        const member = await platformPrisma.accountMembership.findFirst({ where: { accountId: inv.accountId, userId: user.id, status: 'ACTIVE' }, select: { id: true } });
        return member ? { email: asked, name: user.fullName || buyer.name || asked, userId: user.id } : { email: asked, name: buyer.name || asked, userId: null };
      }
    }
    const owners = await platformPrisma.accountMembership.findMany({ where: { accountId: inv.accountId, role: 'OWNER', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { userId: true }, take: 20 });
    for (const o of owners) {
      const user = await platformPrisma.user.findUnique({ where: { id: o.userId }, select: { id: true, email: true, fullName: true, isActive: true } });
      if (user?.isActive && user.email && EMAIL.test(user.email)) return { email: user.email, name: user.fullName || user.email, userId: user.id };
    }
    return null;
  });
}

type SendRow = { invoiceId: string; accountId: string; kind: SendKind; step: string; auto: boolean; toEmail: string; userId?: string | null };
type Outbox = { id: string; status: string; lastError: string | null } | null | undefined;
export type Recorded = { skipped: true } | { skipped: false; sendId: string; outboxId: string | null; delivery: string; deliveryError: string | null };

/**
 * The record first, then the mail. `send` hands the message to the mailer and
 * returns its outbox row. A key that is already there means this email has
 * gone: nothing is sent. If `send` throws, the record is removed and the error
 * passed on, so the same email can be tried again.
 */
export async function recordedSend(row: SendRow, send: () => Promise<Outbox>): Promise<Recorded> {
  const id = randomUUID();
  const dedupeKey = row.kind === 'ISSUED' ? `${row.invoiceId}:issued` : row.auto ? `${row.invoiceId}:auto:${row.step}` : id;
  try {
    await db(() =>
      platformPrisma.billingInvoiceSend.create({
        data: { id, invoiceId: row.invoiceId, accountId: row.accountId, kind: row.kind, step: row.step.slice(0, 40), auto: row.auto, toEmail: row.toEmail, sentByUserId: row.userId ?? null, dedupeKey },
      }),
    );
  } catch (e) {
    if (isUnique(e)) return { skipped: true };
    throw e;
  }
  let outbox: Outbox;
  try {
    outbox = await send();
  } catch (e) {
    await db(() => platformPrisma.billingInvoiceSend.deleteMany({ where: { id } })).catch(() => null);
    throw e;
  }
  /* The mailer has it. From here nothing takes the record away. */
  if (outbox?.id) await db(() => platformPrisma.billingInvoiceSend.update({ where: { id }, data: { outboxId: outbox!.id } })).catch(() => null);
  return { skipped: false, sendId: id, outboxId: outbox?.id ?? null, delivery: outbox?.status || 'QUEUED', deliveryError: outbox?.lastError ?? null };
}

/** How to pay, in words for a plain-text email: the online link first, then UPI and the bank account frozen on the invoice. */
export function payDetailsText(inv: { number: string | null; payTo: unknown }, payUrl: string | null): string {
  const p = (inv.payTo && typeof inv.payTo === 'object' ? inv.payTo : {}) as { upiId?: string | null; payeeName?: string | null; bank?: { accountName?: string | null; accountNumber?: string | null; ifsc?: string | null; bankName?: string | null; branch?: string | null } | null; instructions?: string | null };
  const out: string[] = [];
  if (payUrl) out.push(`Pay online by card, UPI or netbanking: ${payUrl}`);
  if (p.upiId) out.push(`${payUrl ? 'Or pay' : 'Pay'} by UPI to ${p.upiId}${p.payeeName ? ` (${p.payeeName})` : ''}.`);
  const b = p.bank;
  if (b?.accountNumber && b.ifsc) {
    const bank = [b.accountName, `account ${b.accountNumber}`, `IFSC ${b.ifsc}`, [b.bankName, b.branch].filter(Boolean).join(', ')].filter(Boolean).join(', ');
    out.push(`${out.length ? 'Or by' : 'Pay by'} bank transfer: ${bank}.`);
  }
  if ((p.upiId || (b?.accountNumber && b.ifsc)) && inv.number) out.push(`Give ${inv.number} as the reference when you pay by UPI or bank transfer.`);
  if (p.instructions) out.push(String(p.instructions).slice(0, 400));
  return out.length ? out.join('\n') : 'Reply to this email and we will tell you how to pay.';
}

const refuseStatus = (status: string): never => {
  if (status === 'DRAFT') throw new PaymentsError('Issue the invoice first. A draft is not sent to the customer.', 409);
  if (status === 'PAID') throw new PaymentsError('This invoice is paid. Nothing is due on it, so there is nothing to send.', 409);
  throw new PaymentsError('This invoice is cancelled. Nothing is due on it.', 409);
};

export type SendOpts = {
  kind: SendKind;
  step?: string;
  auto?: boolean;
  userId?: string | null;
  /** How the caller writes the log (a route passes its own, which carries the operator's address); without it the event is written here. */
  audit?: (action: string, accountId: string, detail: Record<string, unknown>) => Promise<unknown>;
};
export type SendResult =
  | { sent: true; to: string; kind: SendKind; template: string; sendId: string; outboxId: string | null; delivery: string; deliveryError: string | null }
  | { sent: false; skipped: 'ALREADY_SENT' | 'REMINDERS_OFF'; to: string | null };

/** Email one invoice. Throws PaymentsError when it may not be sent or has no one to go to; see the note at the top. */
export async function sendInvoiceEmail(invoiceId: string, opts: SendOpts): Promise<SendResult> {
  const { kind, step = 'manual', auto = false, userId = null } = opts;
  if (!(SEND_KINDS as readonly string[]).includes(kind)) throw new PaymentsError('Choose what to send.', 400);
  const inv = await getInvoice(invoiceId);
  if (inv.status !== 'ISSUED') refuseStatus(inv.status);
  /* The switch on the invoice stops the automatic reminders; a person may still send one. */
  if (auto && kind === 'REMINDER' && inv.remindersOff) return { sent: false, skipped: 'REMINDERS_OFF', to: null };
  const to = await recipientFor(inv);
  if (!to) throw new PaymentsError('Add the customer’s email to the invoice first.', 409);
  if (!auto && kind !== 'ISSUED') {
    const justNow = await db(() => platformPrisma.billingInvoiceSend.count({ where: { invoiceId, kind, createdAt: { gt: new Date(Date.now() - SAME_AGAIN_MS) } } }));
    if (justNow) throw new PaymentsError('This was sent a moment ago. Wait a minute before sending it again.', 409);
  }

  let template = 'billing.invoice_issued';
  const r = await recordedSend({ invoiceId, accountId: inv.accountId, kind, step, auto, toEmail: to.email, userId }, async () => {
    /* A link to pay online when a gateway is on. No link is no reason to hold the email: the UPI and bank details go instead. */
    let payUrl: string | null = null;
    if ((await onlinePayment().catch(() => ({ available: false }))).available) {
      payUrl = await payLinkFor(inv.accountId, invoiceId, { userId: to.userId })
        .then((l) => l.url)
        .catch(() => null);
    }
    /* Read again, last thing: it may have been paid or cancelled since, or found paid while the link was made. */
    const now = await getInvoice(invoiceId);
    if (now.status !== 'ISSUED') refuseStatus(now.status);
    const dueIso = now.dueDate ? istDay(now.dueDate) : null;
    /* Overdue from the day after the due date, in India: on the due date itself the mail says it is due, not that it is a day late. */
    const overdue = Boolean(dueIso && istDay(new Date()) > dueIso);
    const late = dueIso ? Math.max(1, Math.round((Date.parse(istDay(new Date())) - Date.parse(dueIso)) / DAY)) : 1;
    template = kind === 'REMINDER' ? (overdue ? 'billing.invoice_overdue' : 'billing.invoice_reminder') : 'billing.invoice_issued';
    return sendTemplate({
      templateKey: template,
      to: to.email,
      toName: to.name,
      accountId: now.accountId,
      transactional: true,
      relatedType: 'BillingInvoice',
      relatedId: now.id,
      data: {
        userName: to.name,
        number: now.number || '',
        amount: rupees(now.total),
        dueOn: dueIso ? words(dueIso) : '',
        daysLate: overdue ? `${late} day${late === 1 ? '' : 's'}` : '',
        payUrl: payUrl || '',
        /* The Workspace's Invoices screen, then this invoice: the shell opens a screen only when the address names the app and the screen. */
        invoiceUrl: `${appUrl()}/?app=admin&open=invoices&invoice=${now.id}`,
        payDetails: payDetailsText(now, payUrl),
      },
    });
  });
  if (r.skipped) return { sent: false, skipped: 'ALREADY_SENT', to: to.email };

  /* The mail is with the mailer: what follows is bookkeeping and never undoes it. */
  if (kind === 'REMINDER') {
    await db(() => platformPrisma.billingInvoice.update({ where: { id: invoiceId }, data: { reminderCount: { increment: 1 }, lastRemindedAt: new Date() } })).catch((e) =>
      console.error('[billing.invoiceEmail] reminder count not saved:', e instanceof Error ? e.message : e),
    );
  }
  const action = kind === 'REMINDER' ? 'INVOICE_REMINDER_SENT' : 'INVOICE_EMAILED';
  const detail = { invoiceId, number: inv.number, to: to.email, kind, step, auto, template, delivery: r.delivery };
  await (opts.audit
    ? opts.audit(action, inv.accountId, detail)
    : db(() => platformPrisma.operatorAuditEvent.create({ data: { operatorUserId: userId || SYSTEM_OPERATOR, action, targetAccountId: inv.accountId, detail: detail as any } }))
  ).catch((e: unknown) => console.error('[billing.invoiceEmail] log not written:', e instanceof Error ? e.message : e));
  return { sent: true, to: to.email, kind, template, sendId: r.sendId, outboxId: r.outboxId, delivery: r.delivery, deliveryError: r.deliveryError };
}

/** Every email about one invoice, newest first, with what the mail server said and who pressed the button. */
export async function invoiceSends(invoiceId: string) {
  return db(async () => {
    const rows = await platformPrisma.billingInvoiceSend.findMany({ where: { invoiceId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const outboxIds = rows.map((r) => r.outboxId).filter((x): x is string => Boolean(x));
    const userIds = [...new Set(rows.map((r) => r.sentByUserId).filter((x): x is string => Boolean(x)))];
    const [mails, users] = await Promise.all([
      outboxIds.length ? platformPrisma.emailOutbox.findMany({ where: { id: { in: outboxIds } }, select: { id: true, status: true, sentAt: true, lastError: true, templateKey: true, subject: true } }) : [],
      userIds.length ? platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }) : [],
    ]);
    const mail = new Map(mails.map((m) => [m.id, m]));
    const who = new Map(users.map((u) => [u.id, u.fullName || u.email]));
    return rows.map((r) => {
      const m = r.outboxId ? mail.get(r.outboxId) : null;
      return {
        id: r.id,
        kind: r.kind,
        step: r.step,
        auto: r.auto,
        toEmail: r.toEmail,
        createdAt: r.createdAt,
        sentByUserId: r.sentByUserId,
        sentByName: r.auto ? null : r.sentByUserId ? who.get(r.sentByUserId) || null : null,
        outboxId: r.outboxId,
        delivery: m?.status || null,
        deliveredAt: m?.sentAt || null,
        deliveryError: m?.lastError || null,
        template: m?.templateKey || null,
        subject: m?.subject || null,
      };
    });
  });
}

/** The latest email about each of these invoices: who it went to and when. */
export async function lastSends(invoiceIds: string[]): Promise<Map<string, { sentTo: string; lastSentAt: Date }>> {
  const out = new Map<string, { sentTo: string; lastSentAt: Date }>();
  if (!invoiceIds.length) return out;
  const rows = await db(() => platformPrisma.billingInvoiceSend.findMany({ where: { invoiceId: { in: invoiceIds } }, orderBy: { createdAt: 'desc' }, distinct: ['invoiceId'], select: { invoiceId: true, toEmail: true, createdAt: true } }));
  for (const r of rows) out.set(r.invoiceId, { sentTo: r.toEmail, lastSentAt: r.createdAt });
  return out;
}
