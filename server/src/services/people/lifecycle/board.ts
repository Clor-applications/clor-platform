import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import type { TeamScope } from '../scope.js';
import { NO_SETTLEMENT } from './leaving.js';
import { TRACKED } from '../employmentHistory.js';

/**
 * Joining & Leaving lists (docs/people/design-v1/JOINING-LEAVING-DECISIONS.md).
 * Projections of what already exists: the employee row, its tasks, its
 * joining-form invite, its dated changes and requests. No case table: a
 * joiner is a person with a joining date and a joining plan; a leaver is a
 * person on notice or recently left with a leaving plan.
 *
 * Every list is cut to the caller's team scope first. The leaving type and
 * reason are private: only a caller with the Lifecycle right gets them.
 * Someone who has left is on Leaving, not Joining, whatever steps are open.
 * Small companies have tens of people, so a list is built in memory from at
 * most a few thousand rows and paged after.
 */

const DAY = 86_400_000;
export const todayIst = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const RECENT_DAYS = 60;
const CAP = 2000;

/** privateOk: reads the reason typed for leaving. leavingsOk: false when the company keeps the Leaving list from read-only users (companyChoices.ts). */
type Ctx = { orgId: string; scope: TeamScope; privateOk: boolean; leavingsOk?: boolean; now?: Date };
const scoped = (scope: TeamScope) => (scope.all ? {} : { id: { in: scope.ids } });
const scopedEmployee = (scope: TeamScope) => (scope.all ? {} : { employeeId: { in: scope.ids } });

type Task = { id: string; employeeId: string; kind: string; title: string; owner: string; ownerUserId: string | null; dueDate: string | null; doneAt: Date | null; needsNote: boolean; system: string | null; systemState: string | null; note: string | null; workingDays: boolean };

async function namesOf(ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter(Boolean))] as string[];
  if (!want.length) return new Map<string, string>();
  const users = await platformPrisma.user.findMany({ where: { id: { in: want } }, select: { id: true, fullName: true, email: true } });
  return new Map(users.map((u) => [u.id, u.fullName || u.email]));
}

const OWNER_WORD: Record<string, string> = { HR: 'HR', MANAGER: 'Manager', PAYROLL: 'Payroll', IT: 'IT', EMPLOYEE: 'Employee' };

function progress(tasks: Task[], today: string, names: Map<string, string>) {
  const open = tasks.filter((t) => !t.doneAt).sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
  const next = open[0];
  return {
    done: tasks.length - open.length,
    total: tasks.length,
    late: open.filter((t) => t.dueDate && t.dueDate < today).length,
    next: next ? { id: next.id, title: next.title, owner: next.owner, ownerWord: OWNER_WORD[next.owner] || next.owner, ownerName: next.ownerUserId ? names.get(next.ownerUserId) || '' : '', dueDate: next.dueDate, late: Boolean(next.dueDate && next.dueDate < today) } : null,
  };
}

/** Pages a built list. */
type Paging = { limit?: number; offset?: number; /** Internal callers only (the overview): every row. */ every?: boolean };
function page<T>(rows: T[], q: Paging) {
  if (q.every) return { rows, total: rows.length, limit: rows.length, offset: 0 };
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 25));
  const offset = Math.max(0, Number(q.offset) || 0);
  return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
}
const matches = (q: string | undefined, ...words: (string | null | undefined)[]) => {
  const needle = String(q || '').trim().toLowerCase();
  return !needle || words.some((w) => String(w || '').toLowerCase().includes(needle));
};

/* ------------------------------------------------------------------ joining */

export const JOIN_VIEWS = ['preparing', 'week', 'joined', 'done', 'all'] as const;
export type JoinView = (typeof JOIN_VIEWS)[number];
const JOIN_STAGE: Record<string, string> = { CHECK: 'Details to check', PREPARING: 'Preparing', READY: 'Ready for day one', JOINED: 'Joined, tasks open', DONE: 'Done', NO_PLAN: 'Plan not started' };

export async function joiners(ctx: Ctx, q: { view?: string; q?: string } & Paging = {}) {
  const today = todayIst(ctx.now);
  const since = plus(today, -RECENT_DAYS);
  const withOpen = await peoplePrisma.checklistTask.findMany({ where: { orgId: ctx.orgId, kind: 'JOINING', doneAt: null, ...scopedEmployee(ctx.scope) }, select: { employeeId: true }, distinct: ['employeeId'], take: CAP });
  const people = await peoplePrisma.employee.findMany({
    where: { orgId: ctx.orgId, anonymisedAt: null, dateOfJoining: { not: null }, status: { not: 'LEFT' }, ...scoped(ctx.scope), OR: [{ dateOfJoining: { gte: since } }, { id: { in: withOpen.map((w) => w.employeeId) } }] },
    select: { id: true, name: true, code: true, designation: true, department: true, dateOfJoining: true, status: true, createdAt: true },
    orderBy: [{ dateOfJoining: 'desc' }],
    take: CAP,
  });
  const ids = people.map((p) => p.id);
  const [tasks, invites] = await Promise.all([
    peoplePrisma.checklistTask.findMany({ where: { orgId: ctx.orgId, kind: 'JOINING', employeeId: { in: ids } } }),
    peoplePrisma.joinInvite.findMany({ where: { orgId: ctx.orgId, employeeId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { employeeId: true, status: true, returnedAt: true, expiresAt: true } }),
  ]);
  const names = await namesOf(tasks.filter((t) => !t.doneAt).map((t) => t.ownerUserId));
  const inviteOf = new Map<string, (typeof invites)[number]>();
  for (const i of invites) if (!inviteOf.has(i.employeeId)) inviteOf.set(i.employeeId, i);
  const all = people.map((p) => {
    const mine = tasks.filter((t) => t.employeeId === p.id) as Task[];
    const doj = String(p.dateOfJoining);
    const before = doj > today;
    const invite = inviteOf.get(p.id);
    const prog = progress(mine, today, names);
    const readyByDay = mine.filter((t) => !t.dueDate || t.dueDate <= doj);
    const stage = !mine.length ? 'NO_PLAN'
      : before ? (invite?.status === 'RETURNED' ? 'CHECK' : readyByDay.length && readyByDay.every((t) => t.doneAt) ? 'READY' : 'PREPARING')
      : prog.done < prog.total ? 'JOINED' : 'DONE';
    return {
      id: p.id, name: p.name, code: p.code, designation: p.designation, department: p.department, dateOfJoining: doj, status: p.status,
      stage, stageLabel: JOIN_STAGE[stage], beforeDayOne: before,
      invite: invite ? { status: invite.status === 'SENT' && invite.expiresAt < new Date() ? 'EXPIRED' : invite.status, returnedAt: invite.returnedAt } : null,
      ...prog,
    };
  });
  const inView = (r: (typeof all)[number], v: string) =>
    v === 'preparing' ? r.beforeDayOne
      : v === 'week' ? r.dateOfJoining >= today && r.dateOfJoining <= plus(today, 7)
        : v === 'joined' ? !r.beforeDayOne && (r.stage === 'JOINED' || r.stage === 'NO_PLAN')
          : v === 'done' ? r.stage === 'DONE'
            : true;
  const view = (JOIN_VIEWS as readonly string[]).includes(String(q.view)) ? String(q.view) : 'preparing';
  const counts = Object.fromEntries(JOIN_VIEWS.map((v) => [v, all.filter((r) => inView(r, v)).length]));
  /* Soonest first before day one; most recent first after it. */
  const rows = all.filter((r) => inView(r, view) && matches(q.q, r.name, r.code, r.designation, r.department))
    .sort((a, b) => (view === 'preparing' || view === 'week' ? a.dateOfJoining.localeCompare(b.dateOfJoining) : b.dateOfJoining.localeCompare(a.dateOfJoining)));
  return { ...page(rows, q), counts, view };
}

/* ------------------------------------------------------------------ leaving */

export const LEAVE_VIEWS = ['notice', 'clearing', 'done', 'all'] as const;
const LEAVE_STAGE: Record<string, string> = { NOTICE: 'On notice', LAST_DAY: 'Last day today', CLEARING: 'Clearing', DONE: 'Done', NO_PLAN: 'Plan not started' };
const READER_WORD: Record<string, string> = { WAITING: 'Waiting for readers', CONFIRMED: 'Confirmed', FAILED: 'Not confirmed', MANUAL: 'Removed by hand', NONE: 'No readers', PENDING: 'On the last day' };

export async function leavers(ctx: Ctx, q: { view?: string; q?: string } & Paging = {}) {
  const today = todayIst(ctx.now);
  /* The company keeps who is leaving from read-only users and IT administrators (SPEC 3.5). */
  if (ctx.leavingsOk === false) {
    const view = (LEAVE_VIEWS as readonly string[]).includes(String(q.view)) ? String(q.view) : 'notice';
    return { ...page([] as Array<any>, q), counts: Object.fromEntries(LEAVE_VIEWS.map((v) => [v, 0])), view, hidden: true };
  }
  const since = plus(today, -RECENT_DAYS);
  const withOpen = await peoplePrisma.checklistTask.findMany({ where: { orgId: ctx.orgId, kind: 'LEAVING', doneAt: null, ...scopedEmployee(ctx.scope) }, select: { employeeId: true }, distinct: ['employeeId'], take: CAP });
  const people = await peoplePrisma.employee.findMany({
    where: {
      orgId: ctx.orgId, anonymisedAt: null, ...scoped(ctx.scope),
      OR: [{ status: 'ON_NOTICE' }, { status: 'LEFT', dateOfLeaving: { gte: since } }, { id: { in: withOpen.map((w) => w.employeeId) } }],
      NOT: { leavingType: { in: [...NO_SETTLEMENT] } },
    },
    select: { id: true, name: true, code: true, designation: true, department: true, dateOfLeaving: true, status: true, leavingType: true, leavingReason: true, userId: true, reportingManagerId: true },
    take: CAP,
  });
  const ids = people.map((p) => p.id);
  const tasks = (await peoplePrisma.checklistTask.findMany({ where: { orgId: ctx.orgId, kind: 'LEAVING', employeeId: { in: ids } } })) as Task[];
  const names = await namesOf(tasks.filter((t) => !t.doneAt).map((t) => t.ownerUserId));
  const all = people.map((p) => {
    const mine = tasks.filter((t) => t.employeeId === p.id);
    const last = p.dateOfLeaving || '';
    const prog = progress(mine, today, names);
    const stage = !mine.length ? 'NO_PLAN' : p.status === 'ON_NOTICE' ? (last === today ? 'LAST_DAY' : 'NOTICE') : prog.done < prog.total ? 'CLEARING' : 'DONE';
    const readers = mine.find((t) => t.system === 'READERS');
    const wages = mine.find((t) => t.title === 'Final wages paid') || mine.find((t) => /final (wages|settlement)/i.test(t.title));
    const signIn = mine.find((t) => t.title.startsWith('Turn off'));
    return {
      id: p.id, name: p.name, code: p.code, designation: p.designation, department: p.department, dateOfLeaving: last, status: p.status,
      /* Private: why someone leaves is HR's to read (JCL-009). */
      ...(ctx.privateOk ? { leavingType: p.leavingType, leavingReason: p.leavingReason } : {}),
      stage, stageLabel: LEAVE_STAGE[stage],
      readers: readers ? (() => { const state = readers.doneAt && (!readers.systemState || readers.systemState === 'WAITING' || readers.systemState === 'FAILED') ? 'MANUAL' : readers.systemState || 'PENDING'; return { state, word: READER_WORD[state], taskId: readers.id }; })() : null,
      wages: wages ? { taskId: wages.id, title: wages.title, dueDate: wages.dueDate, paid: Boolean(wages.doneAt), late: !wages.doneAt && Boolean(wages.dueDate && wages.dueDate < today) } : null,
      signIn: p.userId ? (signIn ? { open: !signIn.doneAt, taskId: signIn.id } : { open: p.status !== 'LEFT', taskId: null }) : null,
      ...prog,
    };
  });
  const inView = (r: (typeof all)[number], v: string) => (v === 'notice' ? r.status === 'ON_NOTICE' : v === 'clearing' ? r.status === 'LEFT' && (r.stage === 'CLEARING' || r.stage === 'NO_PLAN') : v === 'done' ? r.stage === 'DONE' : true);
  const view = (LEAVE_VIEWS as readonly string[]).includes(String(q.view)) ? String(q.view) : 'notice';
  const counts = Object.fromEntries(LEAVE_VIEWS.map((v) => [v, all.filter((r) => inView(r, v)).length]));
  const rows = all.filter((r) => inView(r, view) && matches(q.q, r.name, r.code, r.designation, r.department))
    .sort((a, b) => (view === 'notice' ? a.dateOfLeaving.localeCompare(b.dateOfLeaving) : b.dateOfLeaving.localeCompare(a.dateOfLeaving)));
  return { ...page(rows, q), counts, view };
}

/* ------------------------------------------------------------------ changes */

export const CHANGE_VIEWS = ['scheduled', 'approval', 'probation', 'contracts', 'applied'] as const;

export async function changes(ctx: Ctx, q: { view?: string; q?: string } & Paging = {}) {
  const today = todayIst(ctx.now);
  const ahead = plus(today, 30);
  const { orgId, scope } = ctx;
  const [scheduled, requests, probation, contracts, applied] = await Promise.all([
    peoplePrisma.scheduledChange.findMany({ where: { orgId, status: 'PENDING', ...scopedEmployee(scope) }, orderBy: { effectiveOn: 'asc' }, take: CAP }),
    peoplePrisma.approvalRequest.findMany({ where: { orgId, status: { in: ['WAITING', 'MORE_INFO'] }, requestType: { in: ['JOB_CHANGE', 'PROBATION'] }, subjectEmployeeId: scope.all ? { not: null } : { in: scope.ids } }, orderBy: { createdAt: 'asc' }, take: CAP }),
    peoplePrisma.employee.findMany({ where: { orgId, anonymisedAt: null, status: { in: ['ACTIVE', 'SUSPENDED'] }, confirmedOn: null, probationEndDate: { not: null, lte: ahead }, ...scoped(scope) }, select: { id: true }, take: CAP }),
    peoplePrisma.employee.findMany({ where: { orgId, anonymisedAt: null, status: { in: ['ACTIVE', 'SUSPENDED', 'ON_NOTICE'] }, contractEndDate: { not: null, lte: ahead }, ...scoped(scope) }, select: { id: true }, take: CAP }),
    peoplePrisma.employmentEvent.findMany({ where: { orgId, kind: { in: ['TRANSFERRED', 'CHANGED'] }, effectiveDate: { gte: plus(today, -30), lte: today }, ...scopedEmployee(scope) }, orderBy: { effectiveDate: 'desc' }, take: CAP }),
  ]);
  const ids = [...new Set([...scheduled.map((s) => s.employeeId), ...requests.map((r) => r.subjectEmployeeId!), ...probation.map((p) => p.id), ...contracts.map((c) => c.id), ...applied.map((a) => a.employeeId)])];
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true, code: true, designation: true, probationEndDate: true, contractEndDate: true, status: true } })).map((p) => [p.id, p]));
  const person = (id: string) => { const p = people.get(id); return p ? { id: p.id, name: p.name, code: p.code, designation: p.designation } : null; };
  const label = (f: string) => TRACKED[f]?.label || ({ status: 'Status' } as Record<string, string>)[f] || f;
  const lists = {
    scheduled: scheduled.map((s) => ({ id: s.id, kind: 'SCHEDULED', employee: person(s.employeeId), what: label(s.field), from: s.fromLabel, to: s.toLabel, date: s.effectiveOn, reason: s.reason })),
    approval: requests.map((r) => ({ id: r.id, kind: 'APPROVAL', employee: person(r.subjectEmployeeId!), what: r.requestType === 'PROBATION' ? 'Probation decision' : r.title.replace(/^[^:]*:\s*/, ''), from: null, to: null, date: r.createdAt.toISOString().slice(0, 10), reason: null, status: r.status })),
    probation: probation.map((p) => { const e = people.get(p.id)!; return { id: `probation_${p.id}`, kind: 'PROBATION', employee: person(p.id), what: 'Probation ends', from: null, to: null, date: e.probationEndDate!, reason: null, late: e.probationEndDate! < today }; }),
    contracts: contracts.map((c) => { const e = people.get(c.id)!; return { id: `contract_${c.id}`, kind: 'CONTRACT', employee: person(c.id), what: 'Contract ends', from: null, to: null, date: e.contractEndDate!, reason: null, late: e.contractEndDate! < today }; }),
    applied: applied.map((a) => ({ id: a.id, kind: 'APPLIED', employee: person(a.employeeId), what: a.field ? label(a.field) : a.kind, from: a.fromLabel, to: a.toLabel, date: a.effectiveDate, reason: a.note })),
  } as Record<string, Array<{ employee: ReturnType<typeof person>; what: string; date: string } & Record<string, unknown>>>;
  for (const k of Object.keys(lists)) lists[k] = lists[k].filter((r) => r.employee);
  const view = (CHANGE_VIEWS as readonly string[]).includes(String(q.view)) ? String(q.view) : 'scheduled';
  const counts = Object.fromEntries(CHANGE_VIEWS.map((v) => [v, lists[v].length]));
  const rows = lists[view].filter((r) => matches(q.q, r.employee!.name, r.employee!.code, r.what, r.to as string));
  return { ...page(rows, q), counts, view };
}

/* -------------------------------------------------------------------- tasks */

export const TASK_VIEWS = ['mine', 'late', 'nobody', 'open', 'done'] as const;
export const TASK_KINDS = ['JOINING', 'LEAVING', 'CHANGE', 'PROBATION', 'RENEWAL', 'LETTER'] as const;

/**
 * The task queue (JCL-059, JCL-070): mine, late, nobody's, everyone's open
 * and done, in the caller's scope. Someone without the Employees grant sees
 * only their own (`mineOnly`), whatever view they ask for.
 */
export async function taskQueue(ctx: Ctx & { userId: string; mineOnly: boolean; hr?: boolean }, q: { view?: string; kind?: string; q?: string; employeeId?: string } & Paging = {}) {
  const today = todayIst(ctx.now);
  const view = (TASK_VIEWS as readonly string[]).includes(String(q.view)) ? String(q.view) : 'mine';
  const kind = (TASK_KINDS as readonly string[]).includes(String(q.kind)) ? String(q.kind) : null;
  const base = { orgId: ctx.orgId, ...(ctx.mineOnly ? { ownerUserId: ctx.userId } : scopedEmployee(ctx.scope)), ...(kind ? { kind } : {}), ...(q.employeeId ? { employeeId: String(q.employeeId) } : {}) };
  const doneSince = new Date(Date.now() - 90 * DAY);
  const where: Record<string, Record<string, unknown>> = {
    mine: { ...base, ownerUserId: ctx.userId, doneAt: null },
    late: { ...base, doneAt: null, dueDate: { lt: today } },
    nobody: { ...base, doneAt: null, ownerUserId: null },
    open: { ...base, doneAt: null },
    done: { ...base, doneAt: { gte: doneSince } },
  };
  const [counts, rows] = await Promise.all([
    Promise.all(TASK_VIEWS.map(async (v) => [v, await peoplePrisma.checklistTask.count({ where: where[v] as any })] as const)),
    peoplePrisma.checklistTask.findMany({ where: where[view] as any, orderBy: view === 'done' ? [{ doneAt: 'desc' }] : [{ dueDate: 'asc' }, { sortOrder: 'asc' }], take: CAP }),
  ]);
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId: ctx.orgId, id: { in: [...new Set(rows.map((t) => t.employeeId))] } }, select: { id: true, name: true, code: true, userId: true } })).map((p) => [p.id, p]));
  const names = await namesOf(rows.flatMap((t) => [t.ownerUserId, t.doneByUserId]));
  const shaped = rows.filter((t) => people.has(t.employeeId)).map((t) => {
    const p = people.get(t.employeeId)!;
    const ownPlan = Boolean(p.userId && p.userId === ctx.userId && t.owner !== 'EMPLOYEE');
    return {
      id: t.id, kind: t.kind, title: t.title, owner: t.owner, ownerWord: OWNER_WORD[t.owner] || t.owner, ownerUserId: t.ownerUserId, ownerName: t.ownerUserId ? names.get(t.ownerUserId) || '' : '',
      dueDate: t.dueDate, workingDays: t.workingDays, late: !t.doneAt && Boolean(t.dueDate && t.dueDate < today), done: Boolean(t.doneAt), doneAt: t.doneAt, doneBy: t.doneByUserId ? names.get(t.doneByUserId) || '' : t.doneAt ? 'CLOR' : '',
      note: t.note, needsNote: t.needsNote, system: t.system, systemState: t.systemState,
      /* Your own plan's tasks are someone else's to close (JCL-007). */
      ownPlan,
      /* Whether this caller may close it: their own, or HR's to close; never their own plan's. */
      canClose: !ownPlan && (t.ownerUserId === ctx.userId || Boolean(ctx.hr)),
      employee: { id: p.id, name: p.name, code: p.code },
    };
  });
  const filtered = shaped.filter((t) => matches(q.q, t.title, t.employee.name, t.employee.code, t.ownerName));
  return { ...page(filtered, q), counts: Object.fromEntries(counts), view, kind };
}

/* ----------------------------------------------------------------- overview */

/** What needs doing now, and what is coming up (JCL-068). Every count opens the list behind it. */
export async function overview(ctx: Ctx & { userId: string; mineOnly: boolean; hr?: boolean }) {
  const today = todayIst(ctx.now);
  const week = plus(today, 7);
  const [join, leave, scheduled, probation, contracts, tasks] = await Promise.all([
    joiners(ctx, { view: 'all', every: true }),
    leavers(ctx, { view: 'all', every: true }),
    changes(ctx, { view: 'scheduled', every: true }),
    changes(ctx, { view: 'probation', every: true }),
    changes(ctx, { view: 'contracts', every: true }),
    taskQueue(ctx, { view: 'late', limit: 10 }),
  ]);
  const joinAll = join.rows;
  const leaveAll = leave.rows;
  const counts = {
    startingThisWeek: joinAll.filter((r) => r.dateOfJoining >= today && r.dateOfJoining <= week).length,
    detailsToCheck: joinAll.filter((r) => r.stage === 'CHECK').length,
    lastDaysThisWeek: leaveAll.filter((r) => r.status === 'ON_NOTICE' && r.dateOfLeaving >= today && r.dateOfLeaving <= week).length,
    lateTasks: tasks.counts.late,
    myTasks: tasks.counts.mine,
    readersNotConfirmed: leaveAll.filter((r) => r.readers && (r.readers.state === 'WAITING' || r.readers.state === 'FAILED')).length,
    readersFailed: leaveAll.filter((r) => r.readers?.state === 'FAILED').length,
    wagesDue: leaveAll.filter((r) => r.wages && !r.wages.paid && r.wages.dueDate && r.wages.dueDate <= plus(today, 2)).length,
    wagesLate: leaveAll.filter((r) => r.wages?.late).length,
    plansMissing: joinAll.filter((r) => r.stage === 'NO_PLAN').length + leaveAll.filter((r) => r.stage === 'NO_PLAN').length,
  };
  const ahead = plus(today, 30);
  const comingUp = [
    ...joinAll.filter((r) => r.dateOfJoining >= today && r.dateOfJoining <= ahead).map((r) => ({ kind: 'JOINING', date: r.dateOfJoining, employee: { id: r.id, name: r.name, code: r.code }, what: `Joins${r.designation ? ` as ${r.designation}` : ''}`, detail: r.stageLabel })),
    ...leaveAll.filter((r) => r.status === 'ON_NOTICE' && r.dateOfLeaving >= today && r.dateOfLeaving <= ahead).map((r) => ({ kind: 'LEAVING', date: r.dateOfLeaving, employee: { id: r.id, name: r.name, code: r.code }, what: 'Last working day', detail: `${r.done} of ${r.total} tasks done` })),
    ...scheduled.rows.filter((r) => r.date <= ahead).map((r) => ({ kind: 'CHANGE', date: r.date, employee: r.employee, what: `${r.what}${r.to ? ` to ${r.to}` : ''}`, detail: 'Dated change' })),
    ...probation.rows.map((r) => ({ kind: 'PROBATION', date: r.date, employee: r.employee, what: 'Probation ends', detail: r.date < today ? 'Review is late' : 'Review due' })),
    ...contracts.rows.map((r) => ({ kind: 'CONTRACT', date: r.date, employee: r.employee, what: 'Contract ends', detail: r.date < today ? 'Ended: renew or record leaving' : 'Renew or end' })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 40);
  return { counts: { ...counts, probationDue: probation.total, contractsEnding: contracts.total }, late: tasks.rows, comingUp, today };
}
