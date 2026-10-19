import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { notifyPermissionOnce } from './notifications.js';
import { exclusive, leaseFor } from './jobLease.js';

/**
 * What Accounting's own bell used to work out in the browser — invoices past
 * due, and bills and expenses falling due within a week — now worked out on
 * the server once a day and delivered to the bell every app shares, to the
 * people who look after receivables and payables. One unread reminder of each
 * at a time: a person who has not read yesterday's is not given another.
 */
const istToday = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CLOSED = ['Draft', 'Cancelled', 'Paid', 'Void'];

export async function booksDigestFor(orgId: string, now = new Date()) {
  const today = istToday(now);
  const week = istToday(new Date(now.getTime() + 7 * 86_400_000));
  const [invoices, bills, expenses] = await Promise.all([
    prisma.invoice.findMany({ where: { orgId, status: { notIn: CLOSED }, dueDate: { not: null, lt: today } }, select: { id: true, total: true, paidAmount: true } }),
    prisma.bill.findMany({ where: { orgId, status: { notIn: CLOSED }, dueDate: { not: null, gte: today, lte: week } }, select: { id: true, total: true } }),
    prisma.expense.findMany({ where: { orgId, status: { notIn: CLOSED }, dueDate: { not: null, gte: today, lte: week } }, select: { id: true, total: true } }),
  ]);
  const overdue = invoices.map((i) => Number(i.total) - Number(i.paidAmount || 0)).filter((d) => d > 0.005);
  /* Bills keep what was paid against them as allocations. */
  const billIds = [...bills, ...expenses].map((b) => b.id);
  const paid = billIds.length ? await prisma.paymentAllocation.groupBy({ by: ['docId'], where: { orgId, docId: { in: billIds } }, _sum: { amount: true } }) : [];
  const paidOf = new Map(paid.map((p: any) => [p.docId, Number(p._sum.amount || 0)]));
  const payable = [...bills, ...expenses].map((b) => Number(b.total) - (paidOf.get(b.id) || 0)).filter((d) => d > 0.005);
  return {
    overdue: { count: overdue.length, amount: overdue.reduce((s, n) => s + n, 0) },
    payable: { count: payable.length, amount: payable.reduce((s, n) => s + n, 0) },
  };
}

export async function runBooksDigest(now = new Date()) {
  const orgs = await platformPrisma.org.findMany({ select: { id: true, accountId: true } });
  let sent = 0;
  for (const o of orgs) {
    try {
      const d = await booksDigestFor(o.id, now);
      if (d.overdue.count) {
        sent += await notifyPermissionOnce(o.accountId, o.id, 'SALES::Invoices::VIEW', {
          kind: 'books.overdue',
          title: `${d.overdue.count} invoice${d.overdue.count === 1 ? '' : 's'} overdue`,
          body: `${money(d.overdue.amount)} past due date`,
          link: { app: 'accounting', screen: 'invoices' },
          dedupeKey: 'books.overdue',
        });
      }
      if (d.payable.count) {
        sent += await notifyPermissionOnce(o.accountId, o.id, 'PURCHASE::Bills::VIEW', {
          kind: 'books.payables',
          title: `${d.payable.count} payable${d.payable.count === 1 ? '' : 's'} due this week`,
          body: `${money(d.payable.amount)} to schedule`,
          link: { app: 'accounting', screen: 'bills' },
          dedupeKey: 'books.payables',
        });
      }
    } catch (e) {
      console.error(`[books-digest] ${o.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/** Each morning (and a few minutes after start). */
export function startBooksDigest({ intervalMs = 24 * 3_600_000, startupDelayMs = 300_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () => exclusive('books.digest', leaseFor(intervalMs), () => runBooksDigest()).catch((e) => console.error('[books-digest] failed:', e instanceof Error ? e.message : e));
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
