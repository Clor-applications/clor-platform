import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { exclusive, leaseFor } from '../services/jobLease.js';
import { registerJob } from '../services/jobRegistry.js';
import { sendTemplate } from '../services/mailer.js';
import { periodEnd } from '../services/pricing/deals.js';
import { rupees } from '../services/pricing/engine.js';
import { SYSTEM_OPERATOR } from '../routes/ops.js';
import { autoSend } from './booksConnector.js';
import { createDraft, dealLine, issueInvoice } from './invoices.js';
import { invoicing } from './invoicing.js';

/**
 * Renewal invoices. A few days before a paid period ends (Money, Invoice
 * settings, Renewals: on, and how many days), CLOR drafts the next period's
 * invoice from the subscription's deal, issues it with the next number, sends
 * it to CLOR Books when that is on, and emails the account owner. The offer's
 * price is used while the offer lasts, the list price for a period that starts
 * after it ends.
 *
 * Only subscriptions with a price CLOR staff set (routes/opsDeals.ts), active,
 * not cancelling at the period end. One renewal per account and period (a
 * unique index on BillingInvoice.renewalFor), so a second run or a second
 * server changes nothing. A period that ended more than PAST_DAYS ago is left
 * to staff: that customer needs a person, not an invoice.
 */
const EVERY_MS = 6 * 3600_000;
const PAST_DAYS = 30;

/** A date as the day it is in India, YYYY-MM-DD. */
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const words = (iso: string) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';

export type RenewalRun = { issued: number; skipped: number; failed: Array<{ accountId: string; reason: string }> };

/** The subscriptions whose next period should be invoiced now. */
export async function dueRenewals(now = new Date(), daysBefore = 7, only?: string[]) {
  return platformPrisma.subscription.findMany({
    where: {
      ...(only ? { accountId: { in: only } } : {}),
      status: 'active',
      cancelAtPeriodEnd: false,
      periodAmount: { not: null },
      billingInterval: { in: ['month', 'year'] },
      currentPeriodEnd: { lte: new Date(now.getTime() + daysBefore * 86_400_000), gt: new Date(now.getTime() - PAST_DAYS * 86_400_000) },
    },
    orderBy: { currentPeriodEnd: 'asc' },
    take: 500,
  });
}

async function tellOwner(accountId: string, inv: { id: string; number: string | null; total: number; dueDate: Date | null; periodStart: string | null; periodEnd: string | null }) {
  const owner = await platformPrisma.accountMembership.findFirst({ where: { accountId, role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
  const user = owner ? await platformPrisma.user.findUnique({ where: { id: owner.userId }, select: { email: true, fullName: true, isActive: true } }) : null;
  if (!user?.email || !user.isActive) return false;
  const app = (process.env.APP_URL || 'https://app.clor.in').replace(/\/$/, '');
  await sendTemplate({
    templateKey: 'billing.renewal_invoice',
    to: user.email,
    toName: user.fullName ?? undefined,
    accountId,
    transactional: true,
    relatedType: 'BillingInvoice',
    relatedId: inv.id,
    data: {
      userName: user.fullName || user.email,
      number: inv.number || '',
      amount: rupees(inv.total),
      period: inv.periodStart && inv.periodEnd ? `${words(inv.periodStart)} to ${words(inv.periodEnd)}` : 'the next period',
      renewsOn: inv.periodStart ? words(inv.periodStart) : '',
      dueOn: inv.dueDate ? words(istDay(inv.dueDate)) : '',
      billingUrl: `${app}/`,
    },
  }).catch(() => null);
  return true;
}

/** One pass: invoice every subscription that is due (`only`: just these accounts, for tests). */
export async function runRenewals(now = new Date(), only?: string[]): Promise<RenewalRun> {
  return outsideTenant('billing: renewal invoices', async () => {
    const settings = await invoicing();
    const out: RenewalRun = { issued: 0, skipped: 0, failed: [] };
    if (!settings.renewals.on) return out;
    for (const sub of await dueRenewals(now, settings.renewals.daysBefore, only)) {
      const startIso = istDay(sub.currentPeriodEnd!);
      if (await platformPrisma.billingInvoice.findFirst({ where: { accountId: sub.accountId, renewalFor: startIso }, select: { id: true } })) {
        out.skipped += 1;
        continue;
      }
      const start = utcDay(startIso);
      /* The offer's price only if it lasts beyond the moment the paid period ends. */
      const line = dealLine(sub, sub.currentPeriodEnd!);
      if (!line || line.amount <= 0) {
        out.skipped += 1;
        continue;
      }
      const period = sub.billingInterval === 'year' ? 'YEARLY' : 'MONTHLY';
      const lastIso = new Date(periodEnd(start, period).getTime() - 86_400_000).toISOString().slice(0, 10);
      let draftId: string | null = null;
      try {
        const draft = await createDraft(
          { accountId: sub.accountId, lines: [line], periodStart: startIso, periodEnd: lastIso, months: period === 'YEARLY' ? 12 : 1, note: 'Renewal of your CLOR subscription.' },
          null,
          { source: 'RENEWAL', renewalFor: startIso },
        );
        draftId = draft.id;
        const inv = await issueInvoice(draft.id, null);
        await platformPrisma.operatorAuditEvent.create({
          data: { operatorUserId: SYSTEM_OPERATOR, action: 'INVOICE_RENEWAL_ISSUED', targetAccountId: sub.accountId, detail: { invoiceId: inv.id, number: inv.number, total: rupees(inv.total), period: `${startIso} to ${lastIso}` } as any },
        });
        await autoSend(inv.id).catch(() => null);
        await tellOwner(sub.accountId, inv);
        out.issued += 1;
      } catch (e) {
        if (isUnique(e)) {
          out.skipped += 1;
          continue;
        }
        /* A draft that could not be issued stays for Billing to look at, under Invoices, Drafts. */
        const reason = `${draftId ? 'Drafted, not issued' : 'Not drafted'}: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
        out.failed.push({ accountId: sub.accountId, reason });
        await platformPrisma.operatorAuditEvent
          .create({ data: { operatorUserId: SYSTEM_OPERATOR, action: 'INVOICE_RENEWAL_FAILED', targetAccountId: sub.accountId, detail: { invoiceId: draftId, period: `${startIso} to ${lastIso}`, reason } as any } })
          .catch(() => null);
      }
    }
    return out;
  });
}

export function startRenewals({ intervalMs = EVERY_MS, startupDelayMs = 180_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () =>
    exclusive('billing.renewals', leaseFor(intervalMs), () => runRenewals(), { idempotent: true })
      .then((r) => r && (r.issued || r.failed.length) && console.log('[billing.renewals]', JSON.stringify(r)))
      .catch((e) => console.error('[billing.renewals] failed:', e instanceof Error ? e.message : e));
  registerJob('billing.renewals', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
