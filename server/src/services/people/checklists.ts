import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../auth.js';
import { sendTemplate } from '../mailer.js';
import { notifyUsers, usersHoldingRoles, usersWithPermission } from '../notifications.js';

/**
 * Joining and leaving checklists (HR research, People first release:
 * "onboarding and exit checklists"). A company's template, or CLOR's
 * defaults, becomes one task per item when someone joins or leaves, each with
 * an owner and a due date counted from the joining date or the last working
 * day. What CLOR itself does (taking someone off the readers) is ticked by
 * CLOR, so HR sees it happened.
 */

export type Kind = 'JOINING' | 'LEAVING' | 'CHANGE' | 'PROBATION' | 'RENEWAL' | 'LETTER';
export type Owner = 'HR' | 'MANAGER' | 'PAYROLL' | 'IT' | 'EMPLOYEE';
export type Item = { title: string; owner: Owner; dueDays: number; note?: string };
type Who = { accountId: string; orgId: string; userId: string | null };

export const OWNERS: Owner[] = ['HR', 'MANAGER', 'PAYROLL', 'IT', 'EMPLOYEE'];
export const KINDS: Kind[] = ['JOINING', 'LEAVING'];
export const KIND_LABEL: Record<Kind, string> = { JOINING: 'Joining', LEAVING: 'Leaving', CHANGE: 'Change', PROBATION: 'Probation', RENEWAL: 'Renewal', LETTER: 'Letter' };

/** Marks the item CLOR completes itself when someone leaves. */
export const READER_ACCESS_ITEM = 'Readers and app access removed';

export const DEFAULT_ITEMS: Record<'JOINING' | 'LEAVING', Item[]> = {
  JOINING: [
    { title: 'Collect ID and address proof', owner: 'HR', dueDays: 0 },
    { title: 'Collect PAN, UAN (or apply for one) and bank details for payroll', owner: 'HR', dueDays: 0 },
    { title: 'Set the shift and work site', owner: 'HR', dueDays: 0 },
    { title: 'Give the employee app activation code', owner: 'HR', dueDays: 1 },
    { title: 'Enrol fingerprint or face at a reader', owner: 'HR', dueDays: 1 },
    { title: 'Assign the salary structure', owner: 'PAYROLL', dueDays: 3 },
    { title: 'Signed appointment letter on file', owner: 'HR', dueDays: 7 },
    { title: 'PF nomination (Form 2) and ESIC declaration filed', owner: 'PAYROLL', dueDays: 30 },
    { title: 'Probation review', owner: 'MANAGER', dueDays: 90 },
  ],
  LEAVING: [
    { title: 'Accept the resignation and confirm the last day in writing', owner: 'HR', dueDays: -30 },
    { title: 'Handover plan agreed', owner: 'MANAGER', dueDays: -7 },
    { title: 'Exit interview', owner: 'HR', dueDays: -2 },
    { title: 'Recover laptop, ID card, keys and other company property', owner: 'IT', dueDays: 0 },
    { title: READER_ACCESS_ITEM, owner: 'HR', dueDays: 0 },
    { title: 'Relieving and experience letters issued', owner: 'HR', dueDays: 0 },
    { title: 'Full and final settlement paid', owner: 'PAYROLL', dueDays: 2, note: 'Code on Wages: wages are due within two working days of someone leaving.' },
  ],
};

const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** The items a company uses for a kind: its own template, else the defaults. */
export async function itemsFor(orgId: string, kind: Kind): Promise<{ items: Item[]; custom: boolean }> {
  const t = await peoplePrisma.checklistTemplate.findUnique({ where: { orgId_kind: { orgId, kind } } });
  return t ? { items: t.items as unknown as Item[], custom: true } : { items: DEFAULT_ITEMS[kind as 'JOINING' | 'LEAVING'] || [], custom: false };
}

/**
 * The named person for a task's role (docs/people/02-PRD.md LIFE-02): the
 * manager is the person's "Reports to" when they can sign in; the employee is
 * themself; HR, Payroll and IT are the first person holding that work's
 * grant. Nobody found leaves the task on the role, for HR to pick up.
 */
export async function resolveOwners(who: Who, employee: { id: string; reportingManagerId?: string | null; userId?: string | null }): Promise<Record<Owner, string | null>> {
  const { accountId, orgId } = who;
  const [manager, hr, payroll, it, adminRoles] = await Promise.all([
    employee.reportingManagerId ? peoplePrisma.employee.findFirst({ where: { id: employee.reportingManagerId, orgId }, select: { userId: true } }) : null,
    usersWithPermission(accountId, orgId, 'PEOPLE::Employees::EDIT'),
    usersWithPermission(accountId, orgId, 'PAYROLL::Employee Payroll Profile::EDIT'),
    usersWithPermission(accountId, orgId, 'PEOPLE::Assets::EDIT'),
    platformPrisma.role.findMany({ where: { accountId, orgId, roleType: 'ADMIN' }, select: { id: true } }),
  ]);
  /* Administrators hold every grant; the person whose work it is comes first, an administrator only when nobody else holds it. */
  const admins = new Set(await usersHoldingRoles(accountId, orgId, adminRoles.map((r) => r.id)));
  const first = (ids: string[]) => ids.find((id) => !admins.has(id)) || ids[0] || null;
  const hrUser = first(hr);
  return {
    HR: hrUser,
    MANAGER: manager?.userId || hrUser,
    EMPLOYEE: employee.userId || null,
    PAYROLL: first(payroll) || hrUser,
    IT: first(it) || hrUser,
  };
}

/** A link that ticks one task, for the e-mail: signed, single use, only for its owner (LIFE-07). */
export function taskDoneToken(task: { id: string; orgId: string; ownerUserId: string | null }) {
  return jwt.sign({ typ: 'task-done', taskId: task.id, orgId: task.orgId, userId: task.ownerUserId }, getJwtSecret(), { expiresIn: '30d', issuer: process.env.JWT_ISSUER || 'accounting', audience: 'clor-task-link' });
}
export function readTaskDoneToken(token: string): { taskId: string; orgId: string; userId: string | null } | null {
  try {
    const p = jwt.verify(token, getJwtSecret(), { issuer: process.env.JWT_ISSUER || 'accounting', audience: 'clor-task-link', algorithms: ['HS256'] }) as any;
    return p?.typ === 'task-done' ? { taskId: String(p.taskId), orgId: String(p.orgId), userId: p.userId ? String(p.userId) : null } : null;
  } catch {
    return null;
  }
}

/** Tell each named owner about their open tasks on this plan, on the bell and by e-mail with a done link. */
async function tellOwners(who: Who, employee: { id: string; name: string; code: string | null }, kind: Kind) {
  try {
    const tasks = await peoplePrisma.checklistTask.findMany({ where: { orgId: who.orgId, employeeId: employee.id, kind, doneAt: null, ownerUserId: { not: null } } });
    const byUser = new Map<string, typeof tasks>();
    for (const t of tasks) byUser.set(t.ownerUserId!, [...(byUser.get(t.ownerUserId!) || []), t]);
    if (!byUser.size) return;
    const users = await platformPrisma.user.findMany({ where: { id: { in: [...byUser.keys()] } }, select: { id: true, email: true, fullName: true } });
    for (const u of users) {
      const mine = byUser.get(u.id) || [];
      await notifyUsers(who.accountId, who.orgId, [u.id], { kind: 'people.task', title: `${mine.length === 1 ? mine[0].title : `${mine.length} ${KIND_LABEL[kind].toLowerCase()} tasks`} — ${employee.name}`, body: mine[0].dueDate ? `Due ${mine[0].dueDate}` : null, link: { app: 'people', screen: 'overview' } as any }, { except: who.userId });
      for (const t of mine) {
        await sendTemplate({
          templateKey: 'people.task_assigned', to: u.email, toName: u.fullName, accountId: who.accountId, orgId: who.orgId, relatedType: 'ChecklistTask', relatedId: t.id,
          data: { title: t.title, employeeName: employee.name, employeeCode: employee.code ? ` (${employee.code})` : '', dueDate: t.dueDate || 'no date', kind: KIND_LABEL[kind], doneLink: `${process.env.APP_URL || 'http://localhost:5173'}/api/people/task-links/${taskDoneToken(t)}` },
        }).catch(() => undefined);
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[checklists] owners not told:', e instanceof Error ? e.message : e);
  }
}

/**
 * Starts a checklist for someone. Does nothing when that kind is already
 * under way (so a re-save never doubles it); a finished one may start again
 * (a rehire). `done` titles are ticked by CLOR at once.
 */
export async function startChecklist(who: Who, employee: { id: string }, kind: Kind, baseDate: string | null | undefined, opts: { done?: string[]; items?: Item[] } = {}) {
  try {
    const alreadyOpen = (tx: { checklistTask: typeof peoplePrisma.checklistTask }) => tx.checklistTask.count({ where: { orgId: who.orgId, employeeId: employee.id, kind, doneAt: null } });
    if ((await alreadyOpen(peoplePrisma)) && !opts.items) return 0;
    const person = await peoplePrisma.employee.findFirst({ where: { id: employee.id, orgId: who.orgId }, select: { id: true, name: true, code: true, reportingManagerId: true, userId: true } });
    if (!person) return 0;
    const owners = await resolveOwners(who, person);
    const base = baseDate && ISO.test(String(baseDate).slice(0, 10)) ? String(baseDate).slice(0, 10) : todayIst();
    const { items: template } = await itemsFor(who.orgId, kind);
    /* Leaving: one item per company asset they hold, from the asset register, so nothing walks out unnoticed. */
    const held = kind === 'LEAVING'
      ? await peoplePrisma.peopleRecord.findMany({ where: { orgId: who.orgId, kind: 'assets', status: 'ASSIGNED', employeeId: employee.id }, select: { title: true, details: true } })
      : [];
    const items: Item[] = opts.items ? opts.items : [
      ...template,
      ...held.map((a) => ({ title: `Return ${a.title}${(a.details as any)?.assetTag ? ` (${(a.details as any).assetTag})` : ''}`, owner: 'IT' as Owner, dueDays: 0, note: 'From the asset register: mark the asset Returned there too.' })),
    ];
    const done = new Set(opts.done || []);
    const now = new Date();
    /* A joiner entered after they started is not late on day one: nothing falls due before the day the plan is made. */
    const today = todayIst();
    const due = (n: number) => { const d = plusDays(base, n); return d < today ? today : d; };
    /* Two saves at once (a create and a rehire, two clicks) must not both start one: checked again under a lock per person and kind. */
    const made = await peoplePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checklist:${employee.id}:${kind}`}))`;
      if (!opts.items && (await alreadyOpen(tx))) return false;
      await tx.checklistTask.createMany({
        data: items.map((it, i) => ({
          accountId: who.accountId,
          orgId: who.orgId,
          employeeId: employee.id,
          kind,
          title: it.title.slice(0, 200),
          owner: OWNERS.includes(it.owner) ? it.owner : 'HR',
          ownerUserId: owners[OWNERS.includes(it.owner) ? it.owner : 'HR'],
          dueDate: due(Math.round(Number(it.dueDays) || 0)),
          sortOrder: i,
          note: it.note ? it.note.slice(0, 500) : null,
          ...(done.has(it.title) ? { doneAt: now, note: 'Done by CLOR.' } : {}),
        })),
      });
      return true;
    });
    if (!made) return 0;
    await tellOwners(who, person, kind);
    return items.length;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[checklists] ${kind} not started:`, e instanceof Error ? e.message : e);
    return 0;
  }
}

/** The tasks on my name, open first by due date, with the person each is for (LIFE-07: done from Home). */
export async function myTasks(orgId: string, userId: string, limit = 200) {
  const tasks = await peoplePrisma.checklistTask.findMany({ where: { orgId, ownerUserId: userId }, orderBy: [{ doneAt: 'asc' }, { dueDate: 'asc' }, { sortOrder: 'asc' }], take: limit });
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(tasks.map((t) => t.employeeId))] } }, select: { id: true, name: true, code: true } });
  const byId = new Map(people.map((p) => [p.id, p]));
  const today = todayIst();
  return tasks.filter((t) => byId.has(t.employeeId)).map((t) => ({ id: t.id, kind: t.kind, title: t.title, owner: t.owner, dueDate: t.dueDate, overdue: !t.doneAt && !!t.dueDate && t.dueDate < today, done: !!t.doneAt, doneAt: t.doneAt, note: t.note, employee: byId.get(t.employeeId) }));
}

/** Give a task to someone else in the company. */
export async function reassignTask(orgId: string, taskId: string, ownerUserId: string | null) {
  const r = await peoplePrisma.checklistTask.updateMany({ where: { id: taskId, orgId }, data: { ownerUserId } });
  return r.count === 1;
}

/** Someone's checklists, with who ticked each item. */
export async function checklistOf(orgId: string, employeeId: string) {
  const tasks = await peoplePrisma.checklistTask.findMany({ where: { orgId, employeeId }, orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }, { sortOrder: 'asc' }] });
  const ids = [...new Set(tasks.flatMap((t) => [t.doneByUserId, t.ownerUserId]).filter(Boolean))] as string[];
  const users = ids.length ? await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.fullName || u.email]));
  const today = todayIst();
  const shape = (t: (typeof tasks)[number]) => ({
    id: t.id,
    title: t.title,
    owner: t.owner,
    ownerUserId: t.ownerUserId,
    ownerName: t.ownerUserId ? nameOf.get(t.ownerUserId) || '' : '',
    dueDate: t.dueDate,
    overdue: !t.doneAt && !!t.dueDate && t.dueDate < today,
    done: !!t.doneAt,
    doneAt: t.doneAt,
    doneBy: t.doneByUserId ? nameOf.get(t.doneByUserId) || '' : t.doneAt ? 'CLOR' : '',
    note: t.note,
  });
  const of = (kind: Kind) => {
    const list = tasks.filter((t) => t.kind === kind).map(shape);
    return { tasks: list, done: list.filter((t) => t.done).length, total: list.length };
  };
  return { joining: of('JOINING'), leaving: of('LEAVING'), changes: of('CHANGE'), probation: of('PROBATION'), renewals: of('RENEWAL'), letters: of('LETTER') };
}

/** Open tasks across the company, overdue first: the HR to-do list. */
export async function openTasks(orgId: string, limit = 200) {
  const tasks = await peoplePrisma.checklistTask.findMany({ where: { orgId, doneAt: null }, orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }], take: limit });
  const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(tasks.map((t) => t.employeeId))] } }, select: { id: true, name: true, code: true } });
  const byId = new Map(people.map((p) => [p.id, p]));
  const today = todayIst();
  return tasks
    .filter((t) => byId.has(t.employeeId))
    .map((t) => ({ id: t.id, kind: t.kind, title: t.title, owner: t.owner, ownerUserId: t.ownerUserId, dueDate: t.dueDate, overdue: !!t.dueDate && t.dueDate < today, employee: byId.get(t.employeeId) }));
}

/** Validates a template sent by a company. */
export function cleanItems(raw: unknown): Item[] | string {
  if (!Array.isArray(raw)) return 'Items must be a list.';
  if (raw.length > 40) return 'Up to 40 items.';
  const out: Item[] = [];
  for (const r of raw as any[]) {
    const title = String(r?.title || '').trim();
    if (!title) continue;
    const owner = OWNERS.includes(r?.owner) ? r.owner : 'HR';
    const dueDays = Math.max(-365, Math.min(365, Math.round(Number(r?.dueDays) || 0)));
    out.push({ title: title.slice(0, 200), owner, dueDays, ...(r?.note ? { note: String(r.note).slice(0, 500) } : {}) });
  }
  return out.length ? out : 'Add at least one item.';
}
