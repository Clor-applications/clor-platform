import { Router, urlencoded } from 'express';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { enterTenant, outsideTenant } from '../utils/tenantScope.js';
import { ownPlanRefusal, readTaskDoneToken, tickRefusal } from '../services/people/checklists.js';

/**
 * The link in a task e-mail (docs/people/02-PRD.md LIFE-07): signed, for one
 * task and its named owner, good for thirty days. No sign-in, so it looks its
 * token up outside any company and then enters the task's own.
 *
 * Opening the link changes nothing (JCL-A10): mail scanners and link previews
 * open links too. The page names the task and has a Mark done button; only
 * that POST ticks it. A task that needs a note, or that CLOR closes itself,
 * is done in People instead.
 */
export const peopleTaskLinksRouter = Router();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (title: string, body: string, opts: { ok?: boolean; form?: string } = {}) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>` +
  `<body style="font-family:Inter,system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#18181b">` +
  `<h1 style="font-size:1.25rem">${opts.ok ? '✓ ' : ''}${esc(title)}</h1><p style="color:#52525b">${body}</p>${opts.form || ''}</body>`;

type Found = { kind: 'page'; status: number; html: string } | { kind: 'task'; task: NonNullable<Awaited<ReturnType<typeof peoplePrisma.checklistTask.findFirst>>>; userId: string | null };

async function find(token: string): Promise<Found> {
  const claims = readTaskDoneToken(token);
  if (!claims) return { kind: 'page', status: 400, html: page('This link does not work', 'It may be too old, or not meant for you. Open People to tick the task there.') };
  const task = await outsideTenant('task link: find the task', () => peoplePrisma.checklistTask.findFirst({ where: { id: claims.taskId, orgId: claims.orgId } }));
  if (!task) return { kind: 'page', status: 404, html: page('No such task', 'It may have been removed. Open People to check.') };
  enterTenant(task.orgId);
  if (task.ownerUserId !== claims.userId) return { kind: 'page', status: 403, html: page('This link is not yours', 'The task is on somebody else\'s name now. Open People to check.') };
  if (task.doneAt) return { kind: 'page', status: 200, html: page('Already done', `${esc(task.title)} was ticked earlier.`, { ok: true }) };
  if (tickRefusal(task, { done: true, note: null })) return { kind: 'page', status: 409, html: page(task.title, task.system ? 'CLOR closes this one itself when it is confirmed. Open People to see where it stands.' : 'This one needs a note to close, for example a payment reference. Open People to close it there.') };
  if (claims.userId && (await ownPlanRefusal({ accountId: task.accountId, orgId: task.orgId, userId: claims.userId }, task))) return { kind: 'page', status: 403, html: page(task.title, 'This task is on your own plan: someone else closes it.') };
  return { kind: 'task', task, userId: claims.userId };
}

peopleTaskLinksRouter.get('/people/task-links/:token', async (req, res) => {
  const found = await find(String(req.params.token || ''));
  if (found.kind === 'page') return res.status(found.status).type('html').send(found.html);
  const { task } = found;
  /* Entered here too: a tenant entered inside `find` does not carry back to this handler. */
  enterTenant(task.orgId);
  const person = await peoplePrisma.employee.findFirst({ where: { id: task.employeeId, orgId: task.orgId }, select: { name: true } });
  const due = task.dueDate ? ` Due ${esc(task.dueDate)}.` : '';
  const form = `<form method="post"><button type="submit" style="font:inherit;padding:.6rem 1.1rem;border-radius:8px;border:0;background:#18181b;color:#fff;cursor:pointer">Mark done</button></form>`;
  res.type('html').send(page(task.title, `For ${esc(person?.name || 'a colleague')}.${due}`, { form }));
});

peopleTaskLinksRouter.post('/people/task-links/:token', urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
  const found = await find(String(req.params.token || ''));
  if (found.kind === 'page') return res.status(found.status).type('html').send(found.html);
  const { task, userId } = found;
  enterTenant(task.orgId);
  /* Once, even when the button is pressed twice. */
  const r = await peoplePrisma.checklistTask.updateMany({ where: { id: task.id, doneAt: null }, data: { doneAt: new Date(), doneByUserId: userId, note: task.note ? `${task.note} (ticked from e-mail)` : 'Ticked from e-mail.' } });
  if (!r.count) return res.type('html').send(page('Already done', `${esc(task.title)} was ticked earlier.`, { ok: true }));
  await peoplePrisma.changeLog.create({ data: { accountId: task.accountId, orgId: task.orgId, entity: 'ChecklistTask', entityId: task.id, employeeId: task.employeeId, field: 'done', before: 'no', after: 'yes', source: 'API', actorUserId: userId, correlationId: `tasklink_${task.id}` } });
  res.type('html').send(page('Done', `${esc(task.title)} is ticked. Thank you.`, { ok: true }));
});
