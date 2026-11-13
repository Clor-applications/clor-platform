import type { Request } from 'express';

import { PermissionAction } from '../../constants/enums.js';
import { authorize } from '../../middleware/rbac.js';
import { prisma } from '../../utils/prisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { resolveRoleIds } from '../access.js';
import { isFeatureEnabled } from '../features.js';
import { isAppEntitled } from '../subscriptions.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE } from '../payroll/guards.js';
import { inboxFor } from '../people/inbox.js';
import { namesFor } from '../people/approvals/engine.js';

/**
 * Workspace Inbox (Workspace plan 11 Nov 2026, P1): every thing waiting on
 * this person, in every app of this company, as one list, and their latest
 * updates beside it.
 *
 * Workspace points, the app decides. A row says what is asked, by whom and
 * since when, and opens the screen that owns it; nothing is approved here, so
 * each app keeps its own maker-checker, step-up and rules.
 *
 * The same gates as the Overview count (waiting.ts): an app is asked only if
 * the account has it and the company has it on, and only for what this reader
 * could decide. An app that fails to answer is named in `unanswered`, never
 * guessed. `waiting.ts` stays the number; this is the list behind it.
 */
export type InboxRow = {
  app: string;
  key: string;
  /** decide: something to approve or answer. task: a job on the reader's own name. */
  kind: 'decide' | 'task';
  /** What it is: "Casual leave", "Invoice to approve", "Payroll for October 2026". */
  title: string;
  /** Who it is about or who asked. */
  who: string | null;
  /** A short detail: dates, amount, the request type. */
  detail: string | null;
  since: string;
  overdue: boolean;
  open: { app: string; screen: string; params?: Record<string, string> };
};

export type InboxUpdate = { id: string; app: string; title: string; body: string | null; at: string; read: boolean; open: { app: string; screen: string; params?: Record<string, string> } | null };

/** Rows per app, so one busy app cannot bury the others. The app's own screen has the rest. */
export const PER_APP = 50;

const iso = (d: Date | string) => new Date(d).toISOString();
const ok = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const dayWords = (from: string | null, to: string | null) => {
  if (!from) return null;
  const f = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return !to || to.slice(0, 10) === from.slice(0, 10) ? f(from) : `${f(from)} to ${f(to)}`;
};

const PEOPLE_KIND: Record<string, string> = { APPROVAL: 'Request', LEAVE: 'Leave', ATTENDANCE: 'Attendance fix', HELPDESK: 'Help desk case', PUNCH: 'Field punch', OVERTIME: 'Overtime' };

async function peopleRows(req: Request): Promise<InboxRow[]> {
  const { accountId, orgId } = req.tenant!;
  const [people, attendance] = await Promise.all([isAppEntitled(accountId, 'people'), isAppEntitled(accountId, 'attendance')]);
  if (!people && !attendance) return [];
  const on = (await isFeatureEnabled(accountId, orgId, 'people')) || (await isFeatureEnabled(accountId, orgId, 'attendance'));
  if (!on) return [];
  const app = people ? 'people' : 'attendance';
  const { items, tasks } = await inboxFor(req);
  const decide: InboxRow[] = items
    .filter((x) => !x.own)
    .slice(0, PER_APP)
    .map((x) => ({
      app,
      key: `people.${x.key}`,
      kind: 'decide',
      title: x.what || PEOPLE_KIND[x.kind] || 'Request',
      who: x.employeeName || null,
      detail: [PEOPLE_KIND[x.kind], dayWords(x.fromDate, x.toDate), x.minutes ? `${Math.round(x.minutes / 6) / 10} h` : null].filter(Boolean).join(' · ') || null,
      since: x.since,
      overdue: Boolean(x.overdue),
      open: { app, screen: 'approvals' },
    }));
  const mine: InboxRow[] = tasks.slice(0, PER_APP).map((t) => ({
    app,
    key: `people.task.${t.id}`,
    kind: 'task',
    title: t.title,
    who: t.employee?.name || null,
    detail: t.dueDate ? `Due ${dayWords(t.dueDate, null)}` : null,
    since: t.dueDate ? `${t.dueDate.slice(0, 10)}T00:00:00.000Z` : new Date().toISOString(),
    overdue: t.overdue,
    open: { app, screen: 'approvals', params: { tab: 'tasks' } },
  }));
  return [...decide, ...mine];
}

async function booksRows(req: Request): Promise<InboxRow[]> {
  const { accountId, orgId, branchId } = req.tenant!;
  if (!(await isAppEntitled(accountId, 'accounting'))) return [];
  const userId = req.auth!.userId;
  const roleIds = await resolveRoleIds(accountId, orgId, userId, branchId);
  if (!roleIds.length) return [];
  const rows = await prisma.approvalRequest.findMany({
    where: { accountId, orgId, status: 'PENDING', requestedByUserId: { not: userId }, rule: { approverRoleId: { in: roleIds } } },
    orderBy: { createdAt: 'asc' },
    take: PER_APP,
    select: { id: true, docType: true, amount: true, requestedByUserId: true, createdAt: true },
  });
  const names = await namesFor(rows.map((r) => r.requestedByUserId), orgId);
  const rupees = (n: unknown) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  return rows.map((r) => ({
    app: 'accounting',
    key: `books.${r.id}`,
    kind: 'decide',
    title: `${sentence(words(r.docType))} to approve`,
    who: names.get(r.requestedByUserId) || null,
    detail: Number(r.amount) ? rupees(r.amount) : null,
    since: iso(r.createdAt),
    overdue: false,
    open: { app: 'accounting', screen: 'approvals' },
  }));
}

async function payrollRows(req: Request): Promise<InboxRow[]> {
  const { accountId, orgId } = req.tenant!;
  if (!(await isAppEntitled(accountId, 'payroll')) || !(await isFeatureEnabled(accountId, orgId, 'payroll'))) return [];
  const userId = req.auth!.userId;
  const may = async (resource: string) => !(await authorize(req, PAYROLL_MODULE, PermissionAction.APPROVE, resource));
  const [runs, revisions] = await Promise.all([may(PAYROLL_RESOURCE.runs), may(PAYROLL_RESOURCE.revisions)]);
  const where = { accountId, orgId };
  const take = PER_APP;
  const [inReview, bank, revs, settlements] = await Promise.all([
    runs ? payrollPrisma.payrollRun.findMany({ where: { ...where, status: 'REVIEW', createdByUserId: { not: userId } }, orderBy: { createdAt: 'asc' }, take, select: { id: true, number: true, periodId: true, submittedAt: true, createdAt: true, createdByUserId: true } }) : [],
    runs ? payrollPrisma.bankDetailChange.findMany({ where: { ...where, status: 'PENDING', requestedByUserId: { not: userId } }, orderBy: { requestedAt: 'asc' }, take, select: { id: true, employeeId: true, requestedAt: true, requestedByUserId: true } }) : [],
    revisions ? payrollPrisma.salaryRevision.findMany({ where: { ...where, status: 'REVIEWED', createdByUserId: { not: userId } }, orderBy: { createdAt: 'asc' }, take, select: { id: true, employeeId: true, effectiveFrom: true, createdAt: true } }) : [],
    runs ? payrollPrisma.finalSettlement.findMany({ where: { ...where, status: 'DRAFT', createdByUserId: { not: userId } }, orderBy: { createdAt: 'asc' }, take, select: { id: true, employeeId: true, createdAt: true } }) : [],
  ]);
  const periods = inReview.length ? await payrollPrisma.payrollPeriod.findMany({ where: { orgId, id: { in: inReview.map((r) => r.periodId) } }, select: { id: true, name: true } }) : [];
  const periodName = new Map(periods.map((p) => [p.id, p.name]));
  const empIds = [...bank, ...revs, ...settlements].map((r) => r.employeeId);
  const emps = empIds.length ? await peoplePrisma.employee.findMany({ where: { orgId, id: { in: empIds } }, select: { id: true, name: true } }) : [];
  const empName = new Map(emps.map((e) => [e.id, e.name]));
  const makers = await namesFor([...inReview.map((r) => r.createdByUserId), ...bank.map((r) => r.requestedByUserId)], orgId);
  const row = (key: string, title: string, who: string | null, detail: string | null, since: Date, screen: string): InboxRow => ({ app: 'payroll', key, kind: 'decide', title, who, detail, since: iso(since), overdue: false, open: { app: 'payroll', screen } });
  return [
    ...inReview.map((r) => row(`payroll.run.${r.id}`, `Payroll ${periodName.get(r.periodId) ? `for ${periodName.get(r.periodId)}` : r.number} to approve`, makers.get(r.createdByUserId) || null, r.number, r.submittedAt || r.createdAt, 'runs')),
    ...bank.map((r) => row(`payroll.bank.${r.id}`, 'Bank detail change to approve', empName.get(r.employeeId) || null, null, r.requestedAt, 'bankChanges')),
    ...revs.map((r) => row(`payroll.revision.${r.id}`, 'Salary revision to approve', empName.get(r.employeeId) || null, r.effectiveFrom ? `From ${dayWords(r.effectiveFrom, null)}` : null, r.createdAt, 'revisions')),
    ...settlements.map((r) => row(`payroll.settlement.${r.id}`, 'Final settlement to approve', empName.get(r.employeeId) || null, null, r.createdAt, 'settlements')),
  ];
}

/** The app a notice belongs to, from its kind's first word (services/notifications.ts kinds). */
const APP_OF_KIND: Record<string, string> = { people: 'people', attendance: 'attendance', payroll: 'payroll', approval: 'accounting', reader: 'attendance', workspace: 'admin', credentials: 'admin', payment: 'admin', scim: 'admin', connector: 'admin', billing: 'admin', support: 'admin' };

async function updates(req: Request): Promise<InboxUpdate[]> {
  const { orgId } = req.tenant!;
  const rows = await platformPrisma.notification.findMany({
    where: { orgId, userId: req.auth!.userId, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, kind: true, title: true, body: true, linkJson: true, readAt: true, createdAt: true },
  });
  return rows.map((n) => {
    let link: { app?: string; screen?: string; params?: Record<string, string> } | null = null;
    try { link = n.linkJson ? JSON.parse(n.linkJson) : null; } catch { link = null; }
    const app = link?.app || APP_OF_KIND[n.kind.split('.')[0]] || 'admin';
    return { id: n.id, app, title: n.title, body: n.body, at: iso(n.createdAt), read: Boolean(n.readAt), open: link?.app && link?.screen ? { app: link.app, screen: link.screen, ...(link.params ? { params: link.params } : {}) } : null };
  });
}

export async function workspaceInbox(req: Request): Promise<{ rows: InboxRow[]; updates: InboxUpdate[]; unanswered: string[] }> {
  const asked = [
    ['people', peopleRows(req)],
    ['accounting', booksRows(req)],
    ['payroll', payrollRows(req)],
  ] as const;
  const [answers, latest] = await Promise.all([Promise.all(asked.map(([, p]) => ok(p))), ok(updates(req))]);
  /* Oldest first: what has waited longest is on top, overdue before that. */
  const rows = answers.flatMap((a) => a || []).sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.since.localeCompare(b.since));
  const unanswered: string[] = asked.filter((_, i) => answers[i] === null).map(([app]) => app);
  if (latest === null) unanswered.push('updates');
  return { rows, updates: latest || [], unanswered };
}
