import type { Request } from 'express';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { authorize } from '../../middleware/rbac.js';
import { PermissionAction } from '../../constants/enums.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../attendance/guards.js';
import { PAYROLL_MODULE, PAYROLL_RESOURCE } from '../payroll/guards.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from './guards.js';
import { openTasks } from './checklists.js';
import { dataHealth } from './dataHealth.js';
import { calendar } from './compliance.js';

/**
 * People → Home: what needs someone today, not a wall of charts (founder,
 * 22 Oct 2026: simpler than the HR apps on the market). Each item is one
 * thing to act on, with how many, how urgent, and the screen that does it.
 * Only what this person may open; nothing at all when everything is done.
 */

export type Todo = { key: string; title: string; detail: string; count: number; tone: 'urgent' | 'soon' | 'info'; screen: string };

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function homeTodos(req: Request): Promise<Todo[]> {
  const { accountId, orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const may = async (module: string, resource: string) => !(await authorize(req, module, PermissionAction.VIEW as any, resource));
  const [employees, leave, cases, hiring, payrollProfiles] = await Promise.all([
    may(PEOPLE_MODULE, PEOPLE_RESOURCE.employees),
    may(ATTENDANCE_MODULE, ATTENDANCE_RESOURCE.leave),
    may(PEOPLE_MODULE, 'HR Cases'),
    may(PEOPLE_MODULE, 'Recruitment'),
    may(PAYROLL_MODULE, PAYROLL_RESOURCE.profile),
  ]);
  const today = todayIst();
  const week = plusDays(today, 7);
  const month = plusDays(today, 30);
  const out: Todo[] = [];

  if (employees) {
    const [tasks, health, compliance, docs, people, assetsOut] = await Promise.all([
      openTasks(orgId, 500),
      dataHealth(accountId, orgId, { payroll: payrollProfiles }),
      calendar({ accountId, orgId, userId }),
      peoplePrisma.employeeDocument.count({ where: { accountId, orgId, expiresOn: { gte: today, lte: month } } }),
      peoplePrisma.employee.findMany({ where: { accountId, orgId, status: { not: 'LEFT' } }, select: { probationEndDate: true, contractEndDate: true } }),
      /* Company property still with someone who has left: the exit checklist's question, asked of the asset register. */
      peoplePrisma.peopleRecord.findMany({ where: { accountId, orgId, kind: 'assets', status: 'ASSIGNED', employeeId: { not: null } }, select: { employeeId: true } }),
    ]);
    const late = tasks.filter((t) => t.overdue).length;
    const dueSoon = tasks.filter((t) => !t.overdue && t.dueDate && t.dueDate <= week).length;
    if (late || dueSoon) out.push({ key: 'checklists', title: 'Onboarding & exit items', detail: [late && `${late} late`, dueSoon && `${dueSoon} due this week`].filter(Boolean).join(' · '), count: late + dueSoon, tone: late ? 'urgent' : 'soon', screen: 'checklists' });
    if (health.blocking) out.push({ key: 'dataHealth', title: 'Details that would stop payroll', detail: `${plural(health.blocking, 'person', 'people')} to fix: missing PAN, UAN, bank, joining date…`, count: health.blocking, tone: 'urgent', screen: 'dataHealth' });
    const cLate = compliance.summary.overdue;
    const cSoon = compliance.summary.dueSoon;
    if (cLate || cSoon) out.push({ key: 'compliance', title: 'Statutory deadlines', detail: [cLate && `${cLate} late`, cSoon && `${cSoon} due this week`].filter(Boolean).join(' · '), count: cLate + cSoon, tone: cLate ? 'urgent' : 'soon', screen: 'complianceCalendar' });
    if (docs) out.push({ key: 'documents', title: 'Documents expiring', detail: `${plural(docs, 'document')} expire in the next 30 days`, count: docs, tone: 'soon', screen: 'documents' });
    const probation = people.filter((p) => p.probationEndDate && p.probationEndDate >= today && p.probationEndDate <= month).length;
    if (probation) out.push({ key: 'probation', title: 'Probation ending', detail: `${plural(probation, 'person', 'people')} in the next 30 days: confirm or extend`, count: probation, tone: 'soon', screen: 'employees' });
    const contracts = people.filter((p) => p.contractEndDate && p.contractEndDate >= today && p.contractEndDate <= month).length;
    if (contracts) out.push({ key: 'contracts', title: 'Contracts ending', detail: `${plural(contracts, 'contract')} end in the next 30 days: renew or record leaving`, count: contracts, tone: 'soon', screen: 'employees' });
    if (assetsOut.length) {
      const left = await peoplePrisma.employee.count({ where: { orgId, id: { in: assetsOut.map((a) => a.employeeId!) }, status: 'LEFT' } });
      if (left) out.push({ key: 'assets', title: 'Company property with people who left', detail: `${plural(left, 'person', 'people')} who left still hold assets`, count: left, tone: 'urgent', screen: 'assets' });
    }
  }
  if (leave) {
    const waiting = await peoplePrisma.leaveRequest.count({ where: { accountId, orgId, status: 'PENDING' } });
    if (waiting) out.push({ key: 'leave', title: 'Leave waiting for a decision', detail: `${plural(waiting, 'request')} to approve or reject`, count: waiting, tone: 'soon', screen: 'leaveRequests' });
  }
  if (cases) {
    const open = await peoplePrisma.deskRequest.findMany({ where: { accountId, orgId, status: { in: ['OPEN', 'REOPENED', 'WAITING_EMPLOYEE'] } }, select: { urgency: true, resolveBy: true, replyBy: true, firstReplyAt: true } });
    if (open.length) {
      const now = new Date();
      const urgent = open.filter((c) => c.urgency === 'URGENT' || c.resolveBy < now || (!c.firstReplyAt && c.replyBy < now)).length;
      out.push({ key: 'helpdesk', title: 'Help desk requests open', detail: urgent ? `${urgent} urgent or late, ${open.length} open in all` : `${plural(open.length, 'request')} open`, count: open.length, tone: urgent ? 'urgent' : 'info', screen: 'helpdesk' });
    }
  }
  if (hiring) {
    const toReview = await peoplePrisma.peopleRecord.count({ where: { accountId, orgId, kind: 'candidates', status: { in: ['APPLIED', 'SHORTLISTED'] } } });
    if (toReview) out.push({ key: 'candidates', title: 'Candidates to review', detail: `${plural(toReview, 'candidate')} applied or shortlisted`, count: toReview, tone: 'info', screen: 'candidates' });
  }
  const order = { urgent: 0, soon: 1, info: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone] || b.count - a.count);
}
