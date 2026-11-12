/**
 * One customer's story, newest first, for CLOR staff (Ops plan P1, item 3).
 *
 * How the account started, companies added, people joining, CLOR invoices and
 * payments, support tickets, demo requests, alerts, what CLOR staff did and
 * what the account's own people did, and sign-ins. Only facts about the
 * account and its subscription: never the customer's business records
 * (ledgers, employees, payslips).
 */
import { platformPrisma } from '../../utils/platformPrisma.js';
import { operatorActionLabel } from '../../constants/operatorActions.js';
import { auditSummary } from '../../routes/ops.js';
import { ticketCode } from '../support/tickets.js';

/** What a line is about; the console filters on it. */
export type TimelineKind = 'account' | 'money' | 'support' | 'clor' | 'people' | 'sign-in';

export type TimelineLine = {
  id: string;
  kind: TimelineKind;
  at: Date;
  what: string;
  who?: string;
  detail?: string;
  /** Paise, shown as rupees by the console. */
  amount?: number;
  tone?: 'good' | 'bad';
  link?: { page: string; id?: string };
};

export type UpcomingLine = { id: string; at: Date; what: string; tone?: 'bad'; link?: { page: string; id?: string } };

const SECURITY_WORDS: Record<string, string> = {
  LOGIN_SUCCESS: 'Signed in',
  LOGIN_FAILED: 'Sign-in failed',
  LOCKED_OUT: 'Locked out after wrong passwords',
  LOGOUT: 'Signed out',
  PASSWORD_RESET_REQUESTED: 'Asked for a password reset',
  PASSWORD_RESET: 'Set a new password',
  SESSION_REVOKED: 'A session was ended',
};

const ROLE_WORDS: Record<string, string> = { OWNER: 'owner', ADMIN: 'administrator', BILLING_ADMIN: 'billing administrator', MEMBER: 'member' };
const APP_WORDS: Record<string, string> = { accounting: 'Books', payroll: 'Payroll', people: 'People', attendance: 'Attendance', projects: 'Projects' };

/** Lines per page; each source reads one more than this so the page knows whether older lines exist. */
export const PAGE = 120;

/**
 * The page of lines older than `before` (or the newest), and, on the first
 * page only, what is coming up: trial end, renewal or plan end, invoices due.
 */
export async function accountTimeline(accountId: string, before?: Date, now = new Date()) {
  const at = before ? { lt: before } : undefined;
  const emails = [...new Set((await platformPrisma.user.findMany({ where: { accountId }, select: { email: true } })).map((u) => u.email.toLowerCase()))];
  const take = PAGE + 1;
  /* Few per account: read whole, never what cuts a page. */
  const all = 500;
  const [account, trial, orgs, members, invoices, payments, tickets, demos, alerts, ops, own, security, sub] = await Promise.all([
    platformPrisma.account.findUnique({ where: { id: accountId }, select: { createdAt: true, suspendedAt: true, suspendedReason: true } }),
    platformPrisma.trialSignup.findUnique({ where: { accountId }, select: { confirmedAt: true, createdAt: true, apps: true, app: true, email: true } }),
    platformPrisma.org.findMany({ where: { accountId, createdAt: at }, orderBy: { createdAt: 'desc' }, take: all, select: { id: true, name: true, createdAt: true } }),
    platformPrisma.accountMembership.findMany({ where: { accountId, createdAt: at }, orderBy: { createdAt: 'desc' }, take, select: { userId: true, role: true, createdAt: true, addedByUserId: true } }),
    platformPrisma.billingInvoice.findMany({
      where: { accountId, status: { not: 'DRAFT' }, ...(before ? { OR: [{ issueDate: at }, { paidAt: at }, { voidedAt: at }, { dueDate: at }] } : {}) },
      orderBy: { issueDate: 'desc' },
      take: all,
      select: { id: true, number: true, status: true, issueDate: true, dueDate: true, total: true, paidAt: true, paidAmount: true, voidedAt: true, voidReason: true },
    }),
    platformPrisma.paymentEvent.findMany({ where: { accountId, receivedAt: at }, orderBy: { receivedAt: 'desc' }, take, select: { id: true, status: true, amount: true, reference: true, detail: true, receivedAt: true, gateway: true } }),
    platformPrisma.supportTicket.findMany({
      where: { accountId, ...(before ? { OR: [{ createdAt: at }, { solvedAt: at }] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: all,
      select: { id: true, number: true, subject: true, priority: true, createdAt: true, solvedAt: true, openedByUserId: true },
    }),
    platformPrisma.demoRequest.findMany({ where: { OR: [{ accountId }, { email: { in: emails } }], createdAt: at }, orderBy: { createdAt: 'desc' }, take: all, select: { id: true, name: true, company: true, createdAt: true } }),
    platformPrisma.opsAlert.findMany({
      where: { accountId, ...(before ? { OR: [{ firstSeenAt: at }, { resolvedAt: at }] } : {}) },
      orderBy: { firstSeenAt: 'desc' },
      take: all,
      select: { id: true, title: true, severity: true, firstSeenAt: true, resolvedAt: true },
    }),
    platformPrisma.operatorAuditEvent.findMany({ where: { targetAccountId: accountId, at }, orderBy: { at: 'desc' }, take }),
    platformPrisma.accountAuditEvent.findMany({ where: { accountId, createdAt: at }, orderBy: { createdAt: 'desc' }, take, select: { id: true, action: true, message: true, actorUserId: true, createdAt: true } }),
    platformPrisma.authEvent.findMany({
      where: { accountId, createdAt: at, NOT: { eventType: { startsWith: 'OPERATOR_' } } },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, eventType: true, email: true, createdAt: true },
    }),
    before ? null : platformPrisma.subscription.findUnique({ where: { accountId }, select: { status: true, trialEndsAt: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } }),
  ]);
  if (!account) return null;

  const userIds = new Set<string>();
  for (const m of members) {
    userIds.add(m.userId);
    if (m.addedByUserId) userIds.add(m.addedByUserId);
  }
  for (const o of ops) userIds.add(o.operatorUserId);
  for (const a of own) if (a.actorUserId) userIds.add(a.actorUserId);
  for (const t of tickets) if (t.openedByUserId) userIds.add(t.openedByUserId);
  const people = userIds.size ? await platformPrisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, fullName: true, email: true } }) : [];
  const name = new Map(people.map((p) => [p.id, p.fullName || p.email]));
  const who = (id: string | null | undefined) => (id && name.get(id)) || '';

  const lines: TimelineLine[] = [];
  const add = (l: TimelineLine | null | false | undefined) => {
    if (l && l.at && (!before || l.at < before)) lines.push(l);
  };

  /* How it began: from the free trial on clor.in, or made by CLOR staff (that act is in the staff lines too). */
  if (trial?.confirmedAt) {
    const apps = (trial.apps?.length ? trial.apps : trial.app ? [trial.app] : []).map((a) => APP_WORDS[a] || a);
    add({ id: 'start', kind: 'account', at: trial.confirmedAt, what: `Started a free trial on clor.in${apps.length ? ` (${apps.join(', ')})` : ''}`, who: trial.email || '' });
  } else {
    add({ id: 'start', kind: 'account', at: account.createdAt, what: 'Account created' });
  }
  if (account.suspendedAt) add({ id: 'suspended', kind: 'account', at: account.suspendedAt, what: 'Account suspended', detail: account.suspendedReason || '', tone: 'bad' });
  for (const o of orgs) add({ id: `org-${o.id}`, kind: 'account', at: o.createdAt, what: `Company added: ${o.name}` });
  for (const m of members)
    add({ id: `mem-${m.userId}`, kind: 'account', at: m.createdAt, what: `${who(m.userId) || 'Someone'} joined as ${ROLE_WORDS[m.role] || m.role.toLowerCase()}`, who: m.addedByUserId && m.addedByUserId !== m.userId ? `added by ${who(m.addedByUserId) || 'an administrator'}` : '' });

  for (const i of invoices) {
    const no = i.number || 'Invoice';
    const link = { page: 'invoices', id: i.id };
    add(i.issueDate && { id: `inv-${i.id}`, kind: 'money', at: i.issueDate, what: `Invoice ${no} issued`, amount: i.total, link });
    add(i.paidAt && { id: `inv-paid-${i.id}`, kind: 'money', at: i.paidAt, what: `Invoice ${no} paid`, amount: i.paidAmount ?? i.total, tone: 'good', link });
    add(i.voidedAt && { id: `inv-void-${i.id}`, kind: 'money', at: i.voidedAt, what: `Invoice ${no} cancelled`, detail: i.voidReason || '', link });
    /* Overdue is a moment too: the day after it fell due without payment (or before it was paid late). */
    if (i.dueDate && i.status !== 'CANCELLED') {
      const lateFrom = new Date(i.dueDate.getTime() + 24 * 3600 * 1000);
      const paidLate = i.paidAt && i.paidAt > lateFrom;
      if ((i.status === 'ISSUED' && lateFrom <= now) || paidLate) add({ id: `inv-late-${i.id}`, kind: 'money', at: lateFrom, what: `Invoice ${no} became overdue`, amount: i.total, tone: 'bad', link });
    }
  }
  for (const p of payments) {
    const failed = p.status === 'FAILED';
    const refused = p.status === 'REJECTED';
    add({
      id: `pay-${p.id}`,
      kind: 'money',
      at: p.receivedAt,
      what: failed ? 'Payment failed' : refused ? 'Payment not accepted' : 'Payment received',
      amount: p.amount ?? undefined,
      detail: [p.reference, failed || refused ? p.detail : ''].filter(Boolean).join(' · '),
      tone: failed || refused ? 'bad' : 'good',
      link: { page: 'payments' },
    });
  }

  for (const t of tickets) {
    const link = { page: 'tickets', id: t.id };
    add({ id: `tk-${t.id}`, kind: 'support', at: t.createdAt, what: `Asked for help: ${ticketCode(t.number)} ${t.subject}`, who: who(t.openedByUserId), detail: t.priority === 'URGENT' ? 'Urgent' : '', link });
    add(t.solvedAt && { id: `tk-solved-${t.id}`, kind: 'support', at: t.solvedAt, what: `${ticketCode(t.number)} solved`, tone: 'good', link });
  }
  for (const d of demos) add({ id: `demo-${d.id}`, kind: 'support', at: d.createdAt, what: 'Asked for a demo', who: `${d.name}, ${d.company}`, link: { page: 'demos', id: d.id } });
  /* Alert titles start with the customer's name, which this page already shows. */
  const plain = (title: string) => title.replace(/^[^:]{1,120}: /, '');
  for (const a of alerts) {
    add({ id: `al-${a.id}`, kind: 'support', at: a.firstSeenAt, what: `Alert: ${plain(a.title)}`, tone: a.severity === 'critical' ? 'bad' : undefined, link: { page: 'alerts' } });
    add(a.resolvedAt && { id: `al-done-${a.id}`, kind: 'support', at: a.resolvedAt, what: `Alert cleared: ${plain(a.title)}`, link: { page: 'alerts' } });
  }

  for (const o of ops) {
    const d = (o.detail || {}) as Record<string, unknown>;
    /* Taking on an alert reads as what it was about, not its internal key. */
    const onIt = o.action === 'ALERT_ACKNOWLEDGED' && typeof d.title === 'string';
    add({ id: `op-${o.id}`, kind: 'clor', at: o.at, who: `${who(o.operatorUserId) || 'Staff'}, CLOR`, what: onIt ? `On it: ${plain(String(d.title))}` : typeof d.feature === 'string' ? `${operatorActionLabel(o.action)}: ${d.feature}` : operatorActionLabel(o.action), detail: onIt ? '' : auditSummary(o.detail) });
  }
  for (const a of own) add({ id: `ac-${a.id}`, kind: 'people', at: a.createdAt, who: who(a.actorUserId), what: a.message || operatorActionLabel(a.action) });
  for (const s of security) add({ id: `se-${s.id}`, kind: 'sign-in', at: s.createdAt, who: s.email || '', what: SECURITY_WORDS[s.eventType] || operatorActionLabel(s.eventType) });

  lines.sort((a, b) => b.at.getTime() - a.at.getTime());
  /*
   * Each source was cut at PAGE + 1. Lines older than the newest cut-off of
   * any full source may be missing, so the page stops there and "older"
   * continues from it.
   */
  const fullSources = [members, payments, ops, own, security].filter((s) => s.length === take);
  const oldestOf = (s: unknown[]) => {
    const last = s[s.length - 1] as Record<string, unknown>;
    const d = (last.at || last.createdAt || last.receivedAt) as Date | undefined;
    return d ? d.getTime() : 0;
  };
  const cut = fullSources.length ? Math.max(...fullSources.map(oldestOf)) : 0;
  let page = cut ? lines.filter((l) => l.at.getTime() >= cut) : lines;
  let more = Boolean(cut);
  if (page.length > PAGE) {
    page = page.slice(0, PAGE);
    more = true;
  }
  const older = more && page.length ? page[page.length - 1].at.toISOString() : null;

  const upcoming: UpcomingLine[] = [];
  if (sub) {
    if (sub.status === 'trialing' && sub.trialEndsAt && sub.trialEndsAt > now) upcoming.push({ id: 'trial-end', at: sub.trialEndsAt, what: 'Trial ends' });
    if (sub.status === 'active' && sub.currentPeriodEnd && sub.currentPeriodEnd > now)
      upcoming.push({ id: 'period-end', at: sub.currentPeriodEnd, what: sub.cancelAtPeriodEnd ? 'Plan ends (will not renew)' : 'Plan renews', tone: sub.cancelAtPeriodEnd ? 'bad' : undefined });
    for (const i of invoices)
      if (i.status === 'ISSUED' && i.dueDate && i.dueDate.getTime() + 24 * 3600 * 1000 > now.getTime())
        upcoming.push({ id: `due-${i.id}`, at: i.dueDate, what: `Invoice ${i.number || ''} due`.replace('  ', ' '), link: { page: 'invoices', id: i.id } });
    upcoming.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  return { lines: page, older, upcoming };
}
