import type { Request } from 'express';

import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { authorize } from '../../middleware/rbac.js';
import { PermissionAction } from '../../constants/enums.js';
import { ATTENDANCE_MODULE, ATTENDANCE_RESOURCE } from '../attendance/guards.js';
import { isFeatureEnabled } from '../features.js';
import { PEOPLE_MODULE, PEOPLE_RESOURCE } from './guards.js';
import { teamScope } from './scope.js';

/**
 * One Approvals inbox (HR view audit, gap 1): what waits for this reader from
 * the four places it used to live — People approvals (profile, job, leaving,
 * letters…), leave requests, attendance requests (work from home, on duty,
 * permission, missed punch) and Help Desk cases that need HR's reply. Each
 * source keeps its own rule for "waiting on me" (scope, the manager first,
 * not my own) and its own permission; the reader gets only the sources they
 * may open. Oldest first. Home's to-do counts come from the same lists, so
 * the two never disagree.
 */

export type InboxKind = 'APPROVAL' | 'LEAVE' | 'ATTENDANCE' | 'HELPDESK' | 'PUNCH' | 'OVERTIME';
export const INBOX_KINDS: InboxKind[] = ['APPROVAL', 'LEAVE', 'ATTENDANCE', 'HELPDESK', 'PUNCH', 'OVERTIME'];

export type InboxItem = {
  key: string;
  kind: InboxKind;
  id: string;
  /** What is asked, in a few words: "Casual leave", "Work from home", the request's or case's title. */
  what: string;
  /** The finer kind: a leave type, WFH / ON_DUTY / PERMISSION / MISSED_PUNCH, a People request type, a desk category. */
  subKind: string | null;
  employeeId: string | null;
  employeeName: string;
  employeeCode: string | null;
  photoUrl: string | null;
  /** The dates it is about (leave and attendance requests). */
  fromDate: string | null;
  toDate: string | null;
  days: number | null;
  halfDay: string | null;
  /** Hourly leave's hours; a loss-of-pay row over a balance (overflowOfId). */
  fromTime?: string | null;
  toTime?: string | null;
  overflowOfId?: string | null;
  /** Overtime asked for, in minutes, and the person's reason (OVERTIME). */
  minutes?: number | null;
  reason?: string | null;
  /** Where a field punch was made, as the phone found it, and how close the fix was (PUNCH). */
  place?: string | null;
  accuracy?: number | null;
  /** When it started waiting: the oldest is on top. */
  since: string;
  dueAt: string | null;
  overdue: boolean;
  /** The manager has taken their step and it now waits for HR. */
  managerApproved: boolean;
  /** Leave under the leave approval rule: the step waiting now. */
  step?: number | null;
  /** Can be approved or rejected with others at once. Help desk cases need a written reply. */
  bulk: boolean;
  /**
   * The reader's own leave, theirs to decide under maker-checker (makerChecker.ts):
   * ONLY_APPROVER when nobody else in the company can approve it (AUTO), ALLOWED
   * when the company lets one person do both. Decided one at a time, and audited.
   */
  own?: 'ONLY_APPROVER' | 'ALLOWED' | null;
};

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Which sources this reader may see and decide. */
export async function inboxRights(req: Request) {
  const { accountId, orgId } = req.tenant!;
  const ok = async (module: string, action: string, resource: string) => !(await authorize(req, module, action as any, resource));
  const [people, attendance] = await Promise.all([isFeatureEnabled(accountId, orgId, 'people'), isFeatureEnabled(accountId, orgId, 'attendance')]);
  const timeOn = people || attendance;
  const [approvals, approvalsDecide, leave, leaveDecide, requests, requestsDecide, desk] = await Promise.all([
    ok(PEOPLE_MODULE, PermissionAction.VIEW, PEOPLE_RESOURCE.requests),
    ok(PEOPLE_MODULE, PermissionAction.APPROVE, PEOPLE_RESOURCE.requests),
    ok(ATTENDANCE_MODULE, PermissionAction.VIEW, ATTENDANCE_RESOURCE.leave),
    ok(ATTENDANCE_MODULE, PermissionAction.APPROVE, ATTENDANCE_RESOURCE.leave),
    ok(ATTENDANCE_MODULE, PermissionAction.VIEW, ATTENDANCE_RESOURCE.requests),
    ok(ATTENDANCE_MODULE, PermissionAction.APPROVE, ATTENDANCE_RESOURCE.requests),
    ok(PEOPLE_MODULE, PermissionAction.VIEW, 'HR Cases'),
  ]);
  /* Field punches and overtime (time depth, gap 18): HR decides them with the readers' and the records' edit rights. */
  const [punches, overtime] = await Promise.all([
    ok(ATTENDANCE_MODULE, PermissionAction.EDIT, ATTENDANCE_RESOURCE.devices),
    ok(ATTENDANCE_MODULE, PermissionAction.EDIT, ATTENDANCE_RESOURCE.records),
  ]);
  return {
    PUNCH: { see: timeOn && punches, decide: timeOn && punches },
    OVERTIME: { see: timeOn && overtime, decide: timeOn && overtime },
    APPROVAL: { see: people && approvals, decide: people && approvalsDecide },
    LEAVE: { see: timeOn && leave && leaveDecide, decide: timeOn && leaveDecide },
    ATTENDANCE: { see: timeOn && requests && requestsDecide, decide: timeOn && requestsDecide },
    HELPDESK: { see: people && desk, decide: false },
  } as Record<InboxKind, { see: boolean; decide: boolean }>;
}

/** A joining or leaving task on the reader's own name, open: Inbox › My tasks. */
export type InboxTask = { id: string; kind: string; title: string; owner: string; dueDate: string | null; overdue: boolean; note: string | null; employee: { id: string; name: string; code: string | null } | undefined };

export type InboxCounts = Record<InboxKind | 'all' | 'TASK' | 'waiting', number>;

/**
 * One waiting number (People plan 8 Nov 2026, §3 rule 1): everything in the
 * inbox to approve plus the reader's own open tasks. Home's subtitle and
 * "Waiting for you" card, the rail badge, the bell and the Inbox tabs all
 * read this, so they never disagree.
 */
export async function waitingFor(req: Request): Promise<{ waiting: number; approvals: number; tasks: number; counts: InboxCounts }> {
  const { counts } = await inboxFor(req);
  return { waiting: counts.waiting, approvals: counts.all, tasks: counts.TASK, counts };
}

/**
 * Something waits on this person by name, whatever their role: a leave step
 * that names them, a task on their name, or overtime from someone they manage
 * (or stand in for) under a manager-first chain. Such a person has an inbox.
 */
export async function hasPersonalInbox(orgId: string, userId: string): Promise<boolean> {
  if (await peoplePrisma.leaveRequest.count({ where: { orgId, status: 'PENDING', ruleId: { not: null }, stepUserIds: { has: userId } } })) return true;
  if (await peoplePrisma.checklistTask.count({ where: { orgId, ownerUserId: userId, doneAt: null } })) return true;
  const me = await peoplePrisma.employee.findFirst({ where: { orgId, userId }, select: { id: true } });
  if (!me) return false;
  const { standingInFor } = await import('../attendance/standIns.js');
  const covered = [me.id, ...(await standingInFor(orgId, me.id, undefined, 'ATTENDANCE'))];
  const reports = await peoplePrisma.employee.findMany({ where: { orgId, reportingManagerId: { in: covered } }, select: { id: true } });
  if (!reports.length) return false;
  return (await peoplePrisma.overtimeRequest.count({ where: { orgId, status: 'PENDING', employeeId: { in: reports.map((r) => r.id) } } })) > 0;
}

export async function inboxFor(req: Request): Promise<{ items: InboxItem[]; tasks: InboxTask[]; counts: InboxCounts; rights: Record<InboxKind, { see: boolean; decide: boolean }> }> {
  const { accountId, orgId } = req.tenant!;
  const userId = req.auth!.userId;
  const rights = await inboxRights(req);
  const now = Date.now();
  const items: InboxItem[] = [];

  if (rights.APPROVAL.see) {
    const { waitingFor, shape, namesFor } = await import('./approvals/engine.js');
    const rows = await waitingFor(orgId, userId);
    const names = await namesFor(rows.flatMap((r) => [r.requesterUserId, ...r.steps.flatMap((s) => [s.approverUserId, s.decidedByUserId, s.standInForUserId, ...((s.candidateUserIds as string[]) || [])].filter(Boolean) as string[])]), orgId);
    const subjects = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: rows.map((r) => r.subjectEmployeeId).filter(Boolean) as string[] } }, select: { id: true, name: true, code: true, photoUrl: true } })).map((e) => [e.id, e]));
    for (const r of rows) {
      const s = await shape(r, names);
      const who = r.subjectEmployeeId ? subjects.get(r.subjectEmployeeId) : null;
      items.push({
        key: `APPROVAL:${r.id}`, kind: 'APPROVAL', id: r.id, what: s.title, subKind: s.requestType,
        employeeId: who?.id || null, employeeName: who?.name || s.requesterName || '', employeeCode: who?.code || null, photoUrl: who?.photoUrl || null,
        /* A shift swap is about days (gap 24): they show in the Dates column like leave's. */
        fromDate: r.requestType === 'SHIFT_SWAP' ? String((r.payload as any)?.fromDate || '') || null : null, toDate: r.requestType === 'SHIFT_SWAP' ? String((r.payload as any)?.toDate || '') || null : null, days: null, halfDay: null,
        since: iso(r.createdAt)!, dueAt: iso(s.dueAt), overdue: Boolean(s.overdue), managerApproved: false, bulk: rights.APPROVAL.decide,
      });
    }
  }

  /* A step of the leave rule that names this reader is theirs to decide, whatever else they may do with leave. */
  const namedSteps = await peoplePrisma.leaveRequest.count({ where: { orgId, status: 'PENDING', ruleId: { not: null }, stepUserIds: { has: userId } } });
  if (namedSteps && !rights.LEAVE.see) rights.LEAVE = { see: true, decide: true };
  if (rights.LEAVE.see) {
    const { waitingForReader, leaveScope, withTypes, masked, readsPrivateLeave } = await import('../../routes/leave.js');
    const rows = await waitingForReader(orgId, await leaveScope(req), userId);
    /* A leave split at the period end is one leave: its first part speaks for it. */
    const seen = new Set<string>();
    const firsts = rows.filter((r) => { if (!r.groupId) return true; if (seen.has(r.groupId)) return false; seen.add(r.groupId); return true; });
    const shaped = masked(await withTypes(orgId, firsts), await readsPrivateLeave(req));
    const groupDays = new Map<string, { to: string; days: number }>();
    for (const r of rows) if (r.groupId) { const g = groupDays.get(r.groupId) || { to: r.toDate, days: 0 }; groupDays.set(r.groupId, { to: r.toDate > g.to ? r.toDate : g.to, days: g.days + r.days }); }
    for (const r of shaped) {
      const g = r.groupId ? groupDays.get(r.groupId) : null;
      items.push({
        key: `LEAVE:${r.id}`, kind: 'LEAVE', id: r.id, what: r.leaveTypeName || 'Leave', subKind: r.leaveTypeName || null,
        employeeId: r.employeeId, employeeName: r.employeeName, employeeCode: r.employeeCode, photoUrl: r.photoUrl,
        fromDate: r.fromDate, toDate: g?.to || r.toDate, days: g ? Math.round(g.days * 100) / 100 : r.days, halfDay: r.halfDay || null, fromTime: r.fromTime ?? null, toTime: r.toTime ?? null, overflowOfId: r.overflowOfId ?? null,
        since: iso(r.createdAt)!, dueAt: r.ruleId ? iso(r.stepDueAt) : null, overdue: Boolean(r.ruleId && r.stepDueAt && new Date(r.stepDueAt).getTime() < now), managerApproved: Boolean(r.managerApprovedAt), step: r.ruleStep ?? null, bulk: rights.LEAVE.decide && !r.ownDecision, own: r.ownDecision ?? null,
      });
    }
  }

  if (rights.ATTENDANCE.see) {
    const { requestsWaitingForReader, KIND_WORDS } = await import('../attendance/requests.js');
    const { withNames } = await import('../attendance/days.js');
    const rows = await withNames(orgId, await requestsWaitingForReader(orgId, await teamScope(req), userId));
    for (const r of rows) {
      items.push({
        key: `ATTENDANCE:${r.id}`, kind: 'ATTENDANCE', id: r.id, what: (KIND_WORDS as any)[r.kind]?.name || r.kind, subKind: r.kind,
        employeeId: r.employeeId, employeeName: r.employeeName, employeeCode: r.employeeCode, photoUrl: r.photoUrl,
        fromDate: r.date, toDate: r.toDate || r.date, days: null, halfDay: r.halfDay || null,
        since: iso(r.createdAt)!, dueAt: null, overdue: false, managerApproved: Boolean(r.managerApprovedAt), bulk: rights.ATTENDANCE.decide,
      });
    }
  }

  if (rights.HELPDESK.see) {
    /* Waiting for HR's answer: open or reopened. A case waiting on the employee is not HR's to move. */
    /* A team lead sees only requests from their own people, as on the help desk itself. */
    const scope = await teamScope(req);
    const rows = await peoplePrisma.deskRequest.findMany({ where: { accountId, orgId, status: { in: ['OPEN', 'REOPENED'] }, ...(scope.all ? {} : { employeeId: { in: scope.ids } }) }, include: { employee: { select: { name: true, code: true, photoUrl: true } } }, orderBy: { createdAt: 'asc' }, take: 500 });
    for (const r of rows) {
      const due = r.firstReplyAt ? r.resolveBy : r.replyBy;
      items.push({
        key: `HELPDESK:${r.id}`, kind: 'HELPDESK', id: r.id, what: r.subject, subKind: r.category,
        employeeId: r.employeeId, employeeName: r.employee?.name || '', employeeCode: r.employee?.code || null, photoUrl: r.employee?.photoUrl || null,
        fromDate: null, toDate: null, days: null, halfDay: null,
        since: iso(r.reopenedAt || r.createdAt)!, dueAt: iso(due), overdue: due.getTime() < now, managerApproved: false, bulk: false,
      });
    }
  }

  /* Overtime reaches the step's approver whatever their role (step 2, People plan 8 Nov 2026): the manager's rows are theirs by identity, not by the Records right. */
  const timeOn = rights.PUNCH.see || rights.OVERTIME.see || rights.LEAVE.see || rights.ATTENDANCE.see || (await isFeatureEnabled(accountId, orgId, 'people')) || (await isFeatureEnabled(accountId, orgId, 'attendance'));
  if (timeOn) {
    const timeRows = await timeItems(orgId, userId, await teamScope(req), rights);
    if (timeRows.some((i) => i.kind === 'OVERTIME') && !rights.OVERTIME.see) rights.OVERTIME = { see: true, decide: false };
    items.push(...timeRows);
  }

  items.sort((a, b) => a.since.localeCompare(b.since));
  /* The reader's own open tasks (joining, leaving, probation, letters…), from the same service Tasks › Mine reads. */
  const { myTasks } = await import('./checklists.js');
  const tasks: InboxTask[] = (await myTasks(orgId, userId, 500)).filter((t) => !t.done).map((t) => ({ id: t.id, kind: t.kind, title: t.title, owner: t.owner, dueDate: t.dueDate, overdue: t.overdue, note: t.note, employee: t.employee }));
  /* The number is counted, not the capped list's length: 320 late tasks say 320. */
  const openTasks = await peoplePrisma.checklistTask.count({ where: { orgId, ownerUserId: userId, doneAt: null } });
  const counts = { all: items.length, TASK: openTasks, waiting: items.length + openTasks } as InboxCounts;
  for (const k of INBOX_KINDS) counts[k] = items.filter((i) => i.kind === k).length;
  return { items, tasks, counts, rights };
}

/**
 * Field punches (made outside every work site, waiting while the company's
 * approval switch is on) and overtime or comp-off asked for (time depth,
 * gap 18). The reader's own never wait on them; under a manager-first chain
 * an overtime request waits on the active manager (or whoever stands in for
 * them today) before HR, as attendance requests do.
 */
async function timeItems(orgId: string, userId: string, scope: Awaited<ReturnType<typeof teamScope>>, rights: Record<InboxKind, { see: boolean; decide: boolean }>): Promise<InboxItem[]> {
  const inTeam = scope.all ? {} : { employeeId: { in: scope.ids } };
  /* HR reads every pending overtime in scope; anyone else reads the ones from people they manage (or stand in for), whatever their scope. */
  const me = userId ? await peoplePrisma.employee.findFirst({ where: { orgId, userId }, select: { id: true } }) : null;
  const { standingInFor } = await import('../attendance/standIns.js');
  const covers = new Set(me ? await standingInFor(orgId, me.id, undefined, 'ATTENDANCE') : []);
  const managed = me ? [me.id, ...covers] : [];
  const [punches, asks] = await Promise.all([
    rights.PUNCH.see ? peoplePrisma.devicePunch.findMany({ where: { orgId, outsideSite: true, reviewStatus: 'PENDING', employeeId: { not: null }, ...inTeam }, orderBy: { at: 'asc' }, take: 500 }) : Promise.resolve([]),
    rights.OVERTIME.see
      ? peoplePrisma.overtimeRequest.findMany({ where: { orgId, status: 'PENDING', ...inTeam }, orderBy: { createdAt: 'asc' }, take: 500 })
      : managed.length
        ? peoplePrisma.employee
            .findMany({ where: { orgId, reportingManagerId: { in: managed } }, select: { id: true } })
            .then((reports) => (reports.length ? peoplePrisma.overtimeRequest.findMany({ where: { orgId, status: 'PENDING', employeeId: { in: reports.map((r) => r.id) } }, orderBy: { createdAt: 'asc' }, take: 500 }) : []))
        : Promise.resolve([]),
  ]);
  if (!punches.length && !asks.length) return [];
  const ids = [...new Set([...punches.map((p) => p.employeeId!), ...asks.map((a) => a.employeeId)])];
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true, photoUrl: true, userId: true, reportingManagerId: true } })).map((p) => [p.id, p]));
  const out: InboxItem[] = [];
  const who = (id: string) => { const p = people.get(id); return { employeeId: id, employeeName: p?.name || '', employeeCode: p?.code || null, photoUrl: p?.photoUrl || null }; };
  const mine = (id: string) => Boolean(userId && people.get(id)?.userId === userId);
  for (const p of punches) {
    if (mine(p.employeeId!)) continue;
    const date = p.shiftDate || p.localTime.slice(0, 10);
    out.push({
      key: `PUNCH:${p.id}`, kind: 'PUNCH', id: p.id, what: p.kind === 'OUT' ? 'Field punch out' : p.kind === 'IN' ? 'Field punch in' : 'Field punch', subKind: p.kind || null,
      ...who(p.employeeId!), fromDate: date, toDate: date, days: null, halfDay: null, fromTime: p.localTime.slice(11, 16), toTime: null, place: p.address || null, accuracy: p.accuracyM != null ? Math.round(p.accuracyM) : null,
      since: iso(p.createdAt || p.at)!, dueAt: null, overdue: false, managerApproved: false, bulk: rights.PUNCH.decide,
    });
  }
  if (asks.length) {
    const { overtimeChain } = await import('../attendance/selfService.js');
    const chain = await overtimeChain(orgId);
    const managerIds = [...new Set(asks.map((a) => people.get(a.employeeId)?.reportingManagerId).filter(Boolean) as string[])];
    const managers = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: managerIds } }, select: { id: true, status: true, userId: true } })).map((m) => [m.id, m]));
    /* On the approval engine (workflow engine 2d): the chain each was asked under, and whether the manager's step is closed. */
    const { OVERTIME_SOURCE, engineChains } = await import('../attendance/attendanceEngine.js');
    const engines = await engineChains(orgId, OVERTIME_SOURCE, asks.map((a) => a.id));
    for (const a of asks) {
      if (mine(a.employeeId)) continue;
      const m = managers.get(people.get(a.employeeId)?.reportingManagerId || '');
      const manager = m && m.status !== 'LEFT' && m.status !== 'SUSPENDED' ? m : null;
      const eng = engines.get(a.id);
      const mineToTake = Boolean(manager && (manager.userId === userId || covers.has(manager.id)));
      const managerStepOpen = Boolean(manager && (eng?.chain || chain) !== 'HR' && !a.managerApprovedAt && !(eng && eng.step > 1));
      /* Waiting on the manager first: theirs (or their stand-in's), not HR's yet. */
      if (managerStepOpen && !mineToTake) continue;
      /* Without the Records right, only the step that is theirs: the manager's, while it is open. */
      if (!rights.OVERTIME.see && !(managerStepOpen && mineToTake)) continue;
      out.push({
        key: `OVERTIME:${a.id}`, kind: 'OVERTIME', id: a.id, what: a.kind === 'COMP_OFF' ? 'Comp-off' : 'Overtime', subKind: a.kind,
        ...who(a.employeeId), fromDate: a.date, toDate: a.date, days: a.kind === 'COMP_OFF' ? a.days : null, halfDay: null, minutes: a.kind === 'OVERTIME' ? a.minutes : null, reason: a.reason,
        since: iso(a.createdAt)!, dueAt: null, overdue: false, managerApproved: Boolean(a.managerApprovedAt), bulk: rights.OVERTIME.decide || mineToTake,
      });
    }
  }
  return out;
}
