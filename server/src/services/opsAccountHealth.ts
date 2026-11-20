import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * How a customer is doing, for CLOR staff (Ops: the accounts list and the account page).
 *
 * Not a score. Three plain signals, each with the reason in words and what to do about it; the
 * account's level is the worst of the three. A colour with its reasons can be argued with; a
 * number alone cannot.
 *
 *   payment  a plan that is overdue, an invoice past its due date, a payment that failed this week
 *   support  an urgent ticket, or any ticket still with CLOR
 *   usage    how long since anybody in the account signed in
 *
 * Connections (readers, e-invoicing, sign-on) are not judged here yet: that state lives per customer
 * in the app databases, and the account page's Connections tab shows it.
 */
export type HealthLevel = 'good' | 'watch' | 'risk';
export type HealthReason = { key: 'payment' | 'support' | 'usage'; level: HealthLevel; text: string; action: string | null };
export type AccountHealth = { level: HealthLevel; reasons: HealthReason[] };

export type HealthFacts = {
  /** suspended | cancelled | no-plan | legacy | trialing | active | past_due … (the list's own `plan`). */
  plan: string;
  trialEndsAt: Date | null;
  createdAt: Date;
  lastActiveAt: Date | null;
  overdueInvoices: number;
  failedPayments: number;
  openTickets: number;
  urgentTickets: number;
};

const DAY = 86_400_000;
const RANK: Record<HealthLevel, number> = { good: 0, watch: 1, risk: 2 };
const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Accounts nobody is expected to be using: there is nothing to judge. */
const NOT_JUDGED = new Set(['suspended', 'cancelled', 'no-plan']);

export function accountHealth(f: HealthFacts, now = Date.now()): AccountHealth | null {
  if (NOT_JUDGED.has(f.plan)) return null;
  const trialRanOut = f.plan === 'trialing' && f.trialEndsAt != null && f.trialEndsAt.getTime() < now;

  const payment: HealthReason =
    f.plan === 'past_due'
      ? { key: 'payment', level: 'risk', text: 'Payment is overdue', action: 'Call the owner about the payment' }
      : f.overdueInvoices
        ? { key: 'payment', level: 'risk', text: `${n(f.overdueInvoices, 'invoice is', 'invoices are')} past the due date`, action: 'Send the invoice again and call the owner' }
        : trialRanOut
          ? { key: 'payment', level: 'risk', text: 'The trial has ended with no plan chosen', action: 'Ask whether to extend the trial or start a plan' }
          : f.failedPayments
            ? { key: 'payment', level: 'watch', text: `${n(f.failedPayments, 'payment', 'payments')} failed this week`, action: 'Check the payment in Payments' }
            : { key: 'payment', level: 'good', text: f.plan === 'trialing' ? 'On trial, nothing due' : 'Nothing overdue', action: null };

  const support: HealthReason = f.urgentTickets
    ? { key: 'support', level: 'risk', text: `${n(f.urgentTickets, 'urgent ticket is', 'urgent tickets are')} open`, action: 'Answer the urgent ticket' }
    : f.openTickets
      ? { key: 'support', level: 'watch', text: `${n(f.openTickets, 'ticket is', 'tickets are')} waiting for CLOR`, action: 'Answer the ticket' }
      : { key: 'support', level: 'good', text: 'No ticket waiting', action: null };

  const quietDays = f.lastActiveAt ? Math.floor((now - f.lastActiveAt.getTime()) / DAY) : null;
  const ageDays = Math.floor((now - f.createdAt.getTime()) / DAY);
  const usage: HealthReason =
    quietDays == null
      ? ageDays >= 7
        ? { key: 'usage', level: 'risk', text: 'Nobody has ever signed in', action: 'Call the owner and offer a walk-through' }
        : { key: 'usage', level: 'good', text: 'New: nobody has signed in yet', action: null }
      : quietDays >= 30
        ? { key: 'usage', level: 'risk', text: `Nobody has signed in for ${quietDays} days`, action: 'Call the owner before the renewal' }
        : quietDays >= 14
          ? { key: 'usage', level: 'watch', text: `Nobody has signed in for ${quietDays} days`, action: 'Send a check-in message' }
          : { key: 'usage', level: 'good', text: quietDays === 0 ? 'Used today' : `Used ${n(quietDays, 'day', 'days')} ago`, action: null };

  const reasons = [payment, support, usage];
  const level = reasons.reduce<HealthLevel>((worst, r) => (RANK[r.level] > RANK[worst] ? r.level : worst), 'good');
  return { level, reasons };
}

/** Worst first: at risk, then watch, then good, then the accounts not judged. */
export const healthRank = (h: AccountHealth | null | undefined) => (h ? RANK[h.level] : -1);

/** The counts the health needs, for many accounts in three reads. */
export async function healthCounts(accountIds: string[], now = Date.now()) {
  const empty = { overdue: new Map<string, number>(), failed: new Map<string, number>(), open: new Map<string, number>(), urgent: new Map<string, number>() };
  if (!accountIds.length) return empty;
  const inIds = { in: accountIds };
  const [overdue, failed, tickets] = await Promise.all([
    platformPrisma.billingInvoice.groupBy({ by: ['accountId'], where: { accountId: inIds, status: 'ISSUED', dueDate: { lt: new Date(now) } }, _count: true }),
    platformPrisma.paymentEvent.groupBy({ by: ['accountId'], where: { accountId: inIds, status: 'FAILED', receivedAt: { gte: new Date(now - 7 * DAY) } }, _count: true }),
    platformPrisma.supportTicket.groupBy({ by: ['accountId', 'priority'], where: { accountId: inIds, status: 'OPEN' }, _count: true }),
  ]);
  const count = (g: { _count: unknown }) => Number(g._count) || 0;
  for (const g of overdue) empty.overdue.set(g.accountId, count(g));
  for (const g of failed) if (g.accountId) empty.failed.set(g.accountId, count(g));
  for (const g of tickets) {
    if (!g.accountId) continue;
    empty.open.set(g.accountId, (empty.open.get(g.accountId) || 0) + count(g));
    if (g.priority === 'URGENT') empty.urgent.set(g.accountId, (empty.urgent.get(g.accountId) || 0) + count(g));
  }
  return empty;
}
