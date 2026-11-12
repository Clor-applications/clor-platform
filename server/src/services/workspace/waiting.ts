import type { Request } from 'express';

import { PermissionAction } from '../../constants/enums.js';
import { authorize } from '../../middleware/rbac.js';
import { prisma } from '../../utils/prisma.js';
import { payrollPrisma } from '../../utils/payrollPrisma.js';
import { resolveRoleIds } from '../access.js';
import { isFeatureEnabled } from '../features.js';
import { isAppEntitled } from '../subscriptions.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE } from '../payroll/guards.js';
import { waitingFor } from '../people/inbox.js';

/**
 * Workspace, Overview: what waits on this person, in every app, in one list
 * (Workspace plan 11 Nov 2026, P1). Counts and a link to the screen that owns
 * each, never the items themselves: Workspace points, the app decides.
 *
 * Each app is asked only if the account has it and the company has it on,
 * and counts only what this reader could decide:
 *  - People and Attendance: the People inbox's own number (leave, requests,
 *    approvals, help desk, own joining and leaving tasks);
 *  - Books: documents waiting on an approver role the reader holds, not ones
 *    they raised (services/approvals.ts decide);
 *  - Payroll: with the right to approve, payrolls in review, bank detail
 *    changes, salary revisions sent for approval and final settlements, not
 *    ones the reader made (maker-checker).
 * An app that fails to answer is left out, never guessed.
 */
export type WaitingSource = { app: string; key: string; label: string; count: number; open: { app: string; screen: string; params?: Record<string, string> } };

const ok = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

async function peopleSource(req: Request): Promise<WaitingSource[]> {
  const { accountId, orgId } = req.tenant!;
  const [people, attendance] = await Promise.all([isAppEntitled(accountId, 'people'), isAppEntitled(accountId, 'attendance')]);
  if (!people && !attendance) return [];
  const on = (await isFeatureEnabled(accountId, orgId, 'people')) || (await isFeatureEnabled(accountId, orgId, 'attendance'));
  if (!on) return [];
  const w = await waitingFor(req);
  const app = people ? 'people' : 'attendance';
  const out: WaitingSource[] = [];
  if (w.approvals) out.push({ app, key: 'people.approvals', label: w.approvals === 1 ? 'request to approve' : 'requests to approve', count: w.approvals, open: { app, screen: 'approvals' } });
  if (w.tasks) out.push({ app, key: 'people.tasks', label: w.tasks === 1 ? 'task on your name' : 'tasks on your name', count: w.tasks, open: { app, screen: 'approvals', params: { tab: 'tasks' } } });
  return out;
}

async function booksSource(req: Request): Promise<WaitingSource[]> {
  const { accountId, orgId, branchId } = req.tenant!;
  if (!(await isAppEntitled(accountId, 'accounting'))) return [];
  const userId = req.auth!.userId;
  const roleIds = await resolveRoleIds(accountId, orgId, userId, branchId);
  if (!roleIds.length) return [];
  const count = await prisma.approvalRequest.count({
    where: { accountId, orgId, status: 'PENDING', requestedByUserId: { not: userId }, rule: { approverRoleId: { in: roleIds } } },
  });
  return count ? [{ app: 'accounting', key: 'books.approvals', label: count === 1 ? 'document to approve' : 'documents to approve', count, open: { app: 'accounting', screen: 'approvals' } }] : [];
}

async function payrollSource(req: Request): Promise<WaitingSource[]> {
  const { accountId, orgId } = req.tenant!;
  if (!(await isAppEntitled(accountId, 'payroll')) || !(await isFeatureEnabled(accountId, orgId, 'payroll'))) return [];
  const userId = req.auth!.userId;
  const may = async (resource: string) => !(await authorize(req, PAYROLL_MODULE, PermissionAction.APPROVE, resource));
  const [runs, revisions] = await Promise.all([may(PAYROLL_RESOURCE.runs), may(PAYROLL_RESOURCE.revisions)]);
  const where = { accountId, orgId };
  const [inReview, bank, revs, settlements] = await Promise.all([
    runs ? payrollPrisma.payrollRun.count({ where: { ...where, status: 'REVIEW', createdByUserId: { not: userId } } }) : 0,
    runs ? payrollPrisma.bankDetailChange.count({ where: { ...where, status: 'PENDING', requestedByUserId: { not: userId } } }) : 0,
    revisions ? payrollPrisma.salaryRevision.count({ where: { ...where, status: 'REVIEWED', createdByUserId: { not: userId } } }) : 0,
    runs ? payrollPrisma.finalSettlement.count({ where: { ...where, status: 'DRAFT', createdByUserId: { not: userId } } }) : 0,
  ]);
  const one = (key: string, count: number, single: string, many: string, screen: string): WaitingSource | null =>
    count ? { app: 'payroll', key, label: count === 1 ? single : many, count, open: { app: 'payroll', screen } } : null;
  return [
    one('payroll.runs', inReview, 'payroll to approve', 'payrolls to approve', 'runs'),
    one('payroll.bank', bank, 'bank detail change to approve', 'bank detail changes to approve', 'bankChanges'),
    one('payroll.revisions', revs, 'salary revision to approve', 'salary revisions to approve', 'revisions'),
    one('payroll.settlements', settlements, 'final settlement to approve', 'final settlements to approve', 'settlements'),
  ].filter((x): x is WaitingSource => Boolean(x));
}

export async function workspaceWaiting(req: Request): Promise<{ total: number; sources: WaitingSource[]; unanswered: string[] }> {
  const asked = [
    ['people', peopleSource(req)],
    ['accounting', booksSource(req)],
    ['payroll', payrollSource(req)],
  ] as const;
  const answers = await Promise.all(asked.map(([, p]) => ok(p)));
  const sources = answers.flatMap((a) => a || []);
  const unanswered = asked.filter((_, i) => answers[i] === null).map(([app]) => app);
  return { total: sources.reduce((n, s) => n + s.count, 0), sources, unanswered };
}
