import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../../jobLease.js';
import { registerJob } from '../../jobRegistry.js';
import { sendTemplate } from '../../mailer.js';
import { sendNotice, usersWithPermission } from '../../notifications.js';
import { startChecklist } from '../checklists.js';
import { NO_SETTLEMENT } from './leaving.js';
import { checkReaderTasks } from './readersDone.js';

/**
 * The Joining & Leaving job (every 15 minutes, woken by Cloud Scheduler on
 * Cloud Run; services/jobRegistry.ts):
 *
 * 1. Reader removals confirmed or failed (lifecycle/readersDone.ts).
 * 2. Plans that never started are started (JCL-A01): a joiner from the last
 *    30 days with no joining tasks, someone on notice or left in the last
 *    30 days with no leaving tasks. `startChecklist` takes a lock per person
 *    and kind, so a re-run never doubles a plan.
 * 3. From 9 am IST, one digest a day to each owner (JCL-060, JCL-061): what
 *    is due today or late, on the bell and by e-mail; HR's also lists tasks
 *    three or more days late on someone else's name. One per person per day
 *    (the notice dedupe key, and `remindedOn` on each task).
 */
const todayIst = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const istHour = (now: Date) => new Date(now.getTime() + 330 * 60_000).getUTCHours();
const ESCALATE_AFTER = 3;

export async function startMissingPlans(now = new Date()) {
  const since = plus(todayIst(now), -30);
  const settled = new Date(now.getTime() - 10 * 60_000);
  const [joinList, leavers] = await outsideTenant('job: missing plans', () => Promise.all([
    peoplePrisma.employee.findMany({ where: { anonymisedAt: null, status: { not: 'LEFT' }, dateOfJoining: { gte: since }, createdAt: { lt: settled } }, select: { id: true, accountId: true, orgId: true, dateOfJoining: true }, take: 500 }),
    peoplePrisma.employee.findMany({ where: { anonymisedAt: null, OR: [{ status: 'ON_NOTICE' }, { status: 'LEFT', dateOfLeaving: { gte: since } }], NOT: { leavingType: { in: [...NO_SETTLEMENT] } } }, select: { id: true, accountId: true, orgId: true, dateOfLeaving: true }, take: 500 }),
  ]));
  let started = 0;
  /* A plan from an earlier stint (before a rehire) does not count: only one made within a year of this date. */
  const has = async (orgId: string, employeeId: string, kind: string, date: string | null) => (await peoplePrisma.checklistTask.count({ where: { orgId, employeeId, kind, createdAt: { gte: new Date(Date.parse(`${date || todayIst(now)}T00:00:00Z`) - 365 * 86_400_000) } } })) > 0;
  for (const e of joinList) {
    try {
      await runInTenant(e.orgId, async () => {
        if (await has(e.orgId, e.id, 'JOINING', e.dateOfJoining)) return;
        if (await startChecklist({ accountId: e.accountId, orgId: e.orgId, userId: null }, e, 'JOINING', e.dateOfJoining)) started += 1;
      });
    } catch (err) {
      console.error(`[lifecycle] joining plan ${e.orgId} ${e.id}:`, err instanceof Error ? err.message : err);
    }
  }
  for (const e of leavers) {
    try {
      await runInTenant(e.orgId, async () => {
        if (await has(e.orgId, e.id, 'LEAVING', e.dateOfLeaving)) return;
        if (await startChecklist({ accountId: e.accountId, orgId: e.orgId, userId: null }, e, 'LEAVING', e.dateOfLeaving)) started += 1;
      });
    } catch (err) {
      console.error(`[lifecycle] leaving plan ${e.orgId} ${e.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return started;
}

type DueTask = { id: string; accountId: string; orgId: string; employeeId: string; title: string; dueDate: string | null; ownerUserId: string | null; owner: string };

/** One company's digest for the day. */
async function digestFor(accountId: string, orgId: string, today: string) {
  const due = (await peoplePrisma.checklistTask.findMany({ where: { orgId, doneAt: null, dueDate: { lte: today }, OR: [{ remindedOn: null }, { remindedOn: { lt: today } }] }, orderBy: { dueDate: 'asc' }, take: 1000 })) as DueTask[];
  if (!due.length) return 0;
  const people = new Map((await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(due.map((t) => t.employeeId))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const line = (t: DueTask) => `- ${t.title} — ${people.get(t.employeeId) || 'someone'}${t.dueDate && t.dueDate < today ? ` (late since ${t.dueDate})` : ' (today)'}`;
  const byOwner = new Map<string, DueTask[]>();
  for (const t of due) if (t.ownerUserId) byOwner.set(t.ownerUserId, [...(byOwner.get(t.ownerUserId) || []), t]);
  /* Escalation: late by three or more days on someone else's name, or on nobody's, goes to HR too. */
  const cutoff = plus(today, -ESCALATE_AFTER);
  const hr = await usersWithPermission(accountId, orgId, 'PEOPLE::Employees::EDIT').catch(() => [] as string[]);
  const stuck = due.filter((t) => t.dueDate && t.dueDate <= cutoff);
  const recipients = new Set([...byOwner.keys(), ...(stuck.length ? hr : [])]);
  if (!recipients.size) return 0;
  const users = new Map((await platformPrisma.user.findMany({ where: { id: { in: [...recipients] } }, select: { id: true, email: true, fullName: true } })).map((u) => [u.id, u]));
  let sent = 0;
  for (const userId of recipients) {
    const mine = byOwner.get(userId) || [];
    const others = hr.includes(userId) ? stuck.filter((t) => t.ownerUserId !== userId) : [];
    if (!mine.length && !others.length) continue;
    const count = mine.length + others.length;
    const n = await sendNotice(accountId, orgId, [userId], {
      kind: 'people.task',
      title: mine.length ? `${mine.length} joining and leaving task${mine.length === 1 ? '' : 's'} due or late` : `${others.length} task${others.length === 1 ? '' : 's'} late on others' names`,
      body: [...mine, ...others].slice(0, 5).map(line).join('\n'),
      link: { app: 'people', screen: 'checklists', params: { view: mine.length ? 'mine' : 'late' } } as any,
    }, { dedupeKey: `lifecycle-digest:${userId}:${today}` }).catch(() => 0);
    if (!n) continue;
    sent += 1;
    const u = users.get(userId);
    if (u?.email) {
      await sendTemplate({
        templateKey: 'people.task_digest', to: u.email, toName: u.fullName, accountId, orgId, relatedType: 'ChecklistTask', relatedId: (mine[0] || others[0]).id,
        data: { count: String(count), lines: mine.map(line).join('\n') || '- Nothing of your own.', others: others.length ? `\nLate by ${ESCALATE_AFTER} days or more on someone else's name, or nobody's:\n${others.map((t) => `${line(t)}`).join('\n')}\n` : '' },
      }).catch(() => undefined);
    }
  }
  await peoplePrisma.checklistTask.updateMany({ where: { id: { in: due.map((t) => t.id) } }, data: { remindedOn: today } });
  return sent;
}

export async function runDigests(now = new Date()) {
  if (istHour(now) < 9) return 0;
  const today = todayIst(now);
  const orgs = await outsideTenant('job: lifecycle digest', () => peoplePrisma.checklistTask.findMany({ where: { doneAt: null, dueDate: { lte: today }, OR: [{ remindedOn: null }, { remindedOn: { lt: today } }] }, select: { accountId: true, orgId: true }, distinct: ['orgId'], take: 1000 }));
  let sent = 0;
  for (const o of orgs) {
    try {
      sent += await runInTenant(o.orgId, () => digestFor(o.accountId, o.orgId, today));
    } catch (e) {
      console.error(`[lifecycle] digest ${o.orgId}:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

export async function runLifecycle(now = new Date()) {
  const readers = await checkReaderTasks(now);
  const plans = await startMissingPlans(now);
  const digests = await runDigests(now);
  return { readers, plans, digests };
}

export function startLifecycle({ intervalMs = 15 * 60_000, startupDelayMs = 150_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () => exclusive('people.lifecycle', leaseFor(intervalMs), () => runLifecycle()).catch((e) => console.error('[lifecycle] failed:', e instanceof Error ? e.message : e));
  registerJob('startLifecycle', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
