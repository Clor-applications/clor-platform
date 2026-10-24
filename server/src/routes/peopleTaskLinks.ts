import { Router } from 'express';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { enterTenant, outsideTenant } from '../utils/tenantScope.js';
import { readTaskDoneToken } from '../services/people/checklists.js';

/**
 * The link in a task e-mail (docs/people/02-PRD.md LIFE-07): signed, for one
 * task and its named owner, good for thirty days. Opening it ticks the task
 * and says so in plain words; a used or wrong link says that instead. No
 * sign-in, so it looks its token up outside any company and then enters the
 * task's own.
 */
export const peopleTaskLinksRouter = Router();

const page = (title: string, body: string, ok = true) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font-family:Inter,system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#18181b">` +
  `<h1 style="font-size:1.25rem">${ok ? '✓ ' : ''}${title}</h1><p style="color:#52525b">${body}</p></body>`;

peopleTaskLinksRouter.get('/people/task-links/:token', async (req, res) => {
  const claims = readTaskDoneToken(String(req.params.token || ''));
  if (!claims) return res.status(400).type('html').send(page('This link does not work', 'It may be too old, or not meant for you. Open People to tick the task there.', false));
  const task = await outsideTenant('task link: find the task', () => peoplePrisma.checklistTask.findFirst({ where: { id: claims.taskId, orgId: claims.orgId } }));
  if (!task) return res.status(404).type('html').send(page('No such task', 'It may have been removed. Open People to check.', false));
  enterTenant(task.orgId);
  if (task.ownerUserId !== claims.userId) return res.status(403).type('html').send(page('This link is not yours', 'The task is on somebody else\'s name now. Open People to check.', false));
  if (task.doneAt) return res.type('html').send(page('Already done', `${task.title} was ticked earlier.`));
  await peoplePrisma.checklistTask.update({ where: { id: task.id }, data: { doneAt: new Date(), doneByUserId: claims.userId, note: task.note ? `${task.note} (ticked from e-mail)` : 'Ticked from e-mail.' } });
  await peoplePrisma.changeLog.create({ data: { accountId: task.accountId, orgId: task.orgId, entity: 'ChecklistTask', entityId: task.id, employeeId: task.employeeId, field: 'done', before: 'no', after: 'yes', source: 'API', actorUserId: claims.userId, correlationId: `tasklink_${task.id}` } });
  res.type('html').send(page('Done', `${task.title} is ticked. Thank you.`));
});
