import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { outsideTenant, runInTenant } from '../../../utils/tenantScope.js';
import { notifyPermission } from '../../notifications.js';
import { READER_ACCESS_ITEM, startChecklist } from '../checklists.js';

/**
 * Reader removal is done when the readers say so (JCL-A02, JCL-077): leaving
 * queues delete commands; the leaving task waits on those command ids and is
 * closed by CLOR only when every reader has confirmed (DeviceCommand DONE).
 * A refusal, a removed command, or a reader that has not collected it within
 * a day marks the task Failed: HR is told once, and a person closes it with a
 * note after doing it at the reader by hand.
 */
const STALE_MS = 24 * 3_600_000;
type Who = { accountId: string; orgId: string; userId: string | null };

/** Right after leaving: the task waits on these commands, or closes at once when no reader held the person. */
export async function settleReaderTask(who: Who, employee: { id: string; dateOfLeaving?: string | null }, removed: { readers: number; commandIds: number[] }) {
  const { orgId } = who;
  const find = () => peoplePrisma.checklistTask.findFirst({ where: { orgId, employeeId: employee.id, kind: 'LEAVING', doneAt: null, OR: [{ system: 'READERS' }, { title: READER_ACCESS_ITEM }] }, orderBy: { createdAt: 'desc' } });
  let task = await find();
  if (!task && removed.commandIds.length) {
    /* The company's own leaving steps dropped the item, but readers still have to confirm: it goes on the plan. */
    await startChecklist(who, employee, 'LEAVING', employee.dateOfLeaving, { items: [{ title: READER_ACCESS_ITEM, owner: 'HR', dueDays: 0, system: 'READERS' }] });
    task = await find();
  }
  if (!task) return null;
  if (!removed.commandIds.length) {
    return peoplePrisma.checklistTask.update({ where: { id: task.id }, data: { system: 'READERS', systemState: 'NONE', doneAt: new Date(), doneByUserId: null, note: 'No reader held them: nothing to remove. Their employee-app sign-ins ended.' } });
  }
  return peoplePrisma.checklistTask.update({ where: { id: task.id }, data: { system: 'READERS', systemState: 'WAITING', systemRefs: removed.commandIds as any, note: `Sent to ${removed.readers === 1 ? 'one reader' : `${removed.readers} readers`}; waiting for each to confirm.` } });
}

/** One task: confirmed, failed, or still waiting. */
async function checkOne(task: { id: string; accountId: string; orgId: string; employeeId: string; systemRefs: unknown }, now: Date) {
  const ids = (Array.isArray(task.systemRefs) ? task.systemRefs : []).map(Number).filter(Number.isInteger);
  const commands = await peoplePrisma.deviceCommand.findMany({ where: { orgId: task.orgId, id: { in: ids } }, select: { id: true, deviceId: true, status: true, createdAt: true, lastError: true } });
  const byId = new Map(commands.map((c) => [c.id, c]));
  const missing = ids.filter((id) => !byId.has(id)).length;
  const refused = commands.filter((c) => c.status === 'FAILED' || c.status === 'CANCELLED');
  const stale = commands.filter((c) => (c.status === 'PENDING' || c.status === 'SENT') && now.getTime() - c.createdAt.getTime() > STALE_MS);
  if (ids.length && commands.length === ids.length && commands.every((c) => c.status === 'DONE')) {
    const readers = new Set(commands.map((c) => c.deviceId)).size;
    await peoplePrisma.checklistTask.updateMany({ where: { id: task.id, doneAt: null }, data: { systemState: 'CONFIRMED', doneAt: now, doneByUserId: null, note: `Every reader confirmed the removal (${readers === 1 ? 'one reader' : `${readers} readers`}).` } });
    return 'CONFIRMED';
  }
  if (!missing && !refused.length && !stale.length) return 'WAITING';
  const bad = [...refused, ...stale].map((c) => c.deviceId);
  const names = (await peoplePrisma.attendanceDevice.findMany({ where: { orgId: task.orgId, id: { in: [...new Set(bad)] } }, select: { name: true, serialNumber: true } })).map((d) => d.name || d.serialNumber);
  const why = [refused.length ? `refused by ${names.join(', ') || 'a reader'}` : '', stale.length ? 'not collected within a day (the reader may be offline)' : '', missing ? 'removed from the queue before it was sent' : ''].filter(Boolean).join('; ');
  const r = await peoplePrisma.checklistTask.updateMany({ where: { id: task.id, doneAt: null, systemState: 'WAITING' }, data: { systemState: 'FAILED', note: `Not confirmed: ${why}. They may still open the door. Remove them at the reader by hand, then close this with a note.` } });
  if (r.count) {
    const person = await peoplePrisma.employee.findFirst({ where: { id: task.employeeId, orgId: task.orgId }, select: { name: true } });
    await notifyPermission(task.accountId, task.orgId, 'PEOPLE::Employees::EDIT', { kind: 'people.task', title: `Readers did not confirm removing ${person?.name || 'a leaver'}`, body: `${why[0].toUpperCase()}${why.slice(1)}. Remove them by hand.`, link: { app: 'people', screen: 'leavers' } as any }).catch(() => undefined);
  }
  return 'FAILED';
}

/** Every waiting reader task, in every company. Returns what changed. */
export async function checkReaderTasks(now = new Date()) {
  const waiting = await outsideTenant('job: reader removals', () => peoplePrisma.checklistTask.findMany({ where: { system: 'READERS', systemState: 'WAITING', doneAt: null }, select: { id: true, accountId: true, orgId: true, employeeId: true, systemRefs: true }, take: 500 }));
  const out = { confirmed: 0, failed: 0 };
  for (const t of waiting) {
    try {
      const state = await runInTenant(t.orgId, () => checkOne(t, now));
      if (state === 'CONFIRMED') out.confirmed += 1;
      if (state === 'FAILED') out.failed += 1;
    } catch (e) {
      console.error(`[readers-done] ${t.orgId} ${t.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
