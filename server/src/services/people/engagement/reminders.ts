import { peoplePrisma } from '../../../utils/peoplePrisma.js';
import { platformPrisma } from '../../../utils/platformPrisma.js';
import { resolveAccess } from '../../access.js';
import { sendTemplate } from '../../mailer.js';
import { sendNotice, usersWithPermission } from '../../notifications.js';
import { teamScope } from '../scope.js';
import { registerRecipe } from './automations.js';

/**
 * The ready-made automations that remind (WORKFLOW-GAP-RESEARCH-2026-10-30 4.7), each reusing what CLOR
 * already knows rather than a rule engine:
 *  - leave waiting N days: the leave inbox's own "waiting for this reader" (routes/leave.ts), so a manager
 *    hears about exactly what their Approvals shows them;
 *  - accept a policy after N days: the acknowledgement rows policies already keep, one reminder each;
 *  - the joiner's first-day plan the day before: their joining steps that are theirs, who they report to.
 * Each runs once a company a day under the automations job's claim; notices carry a key per day besides.
 */

const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

registerRecipe('leaveWaiting', async ({ accountId, orgId, today, n, now }) => {
  const days = n ?? 2;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const { waitingForReader } = await import('../../../routes/leave.js');
  const approvers = await usersWithPermission(accountId, orgId, 'ATTENDANCE::Leave Requests::APPROVE');
  const users = new Map((await platformPrisma.user.findMany({ where: { id: { in: approvers } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  let count = 0;
  const told: string[] = [];
  for (const userId of approvers) {
    const access = await resolveAccess(accountId, orgId, userId);
    const scope = await teamScope({ ownDocumentsOnly: access.ownDocumentsOnly, tenant: { orgId }, auth: { userId } } as any);
    const old = (await waitingForReader(orgId, scope, userId)).filter((r) => r.createdAt <= cutoff);
    if (!old.length) continue;
    const sent = await sendNotice(accountId, orgId, [userId], {
      kind: 'people.leave_waiting',
      title: `${old.length} leave ${old.length === 1 ? 'request has' : 'requests have'} waited ${days} days or more`,
      body: 'Approve or reject them so people can plan.',
      link: { app: 'people', screen: 'approvals', params: { kind: 'LEAVE' } },
    }, { dedupeKey: `leave-waiting:${today}` });
    count += sent;
    if (sent) told.push(users.get(userId) || 'An approver');
  }
  return { count, recipients: told };
});

registerRecipe('policyAccept', async ({ accountId, orgId, today, n, now }) => {
  const days = n ?? 3;
  const rows = await peoplePrisma.acknowledgement.findMany({ where: { orgId, targetType: 'POLICY_VERSION', acceptedAt: null, remindedAt: null, askedAt: { lte: new Date(now.getTime() - days * 86_400_000) } }, select: { id: true, employeeId: true, targetId: true } });
  if (!rows.length) return { count: 0, recipients: [] };
  /* Claimed first: a reminder sent by HR by hand, or a second run, finds remindedAt set. */
  const claimed = await peoplePrisma.acknowledgement.updateMany({ where: { id: { in: rows.map((r) => r.id) }, remindedAt: null }, data: { remindedAt: now, remindCount: { increment: 1 } } });
  if (!claimed.count) return { count: 0, recipients: [] };
  const [people, versions] = await Promise.all([
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: rows.map((r) => r.employeeId) }, status: { not: 'LEFT' } }, select: { id: true, name: true, userId: true } }),
    peoplePrisma.policyVersion.findMany({ where: { orgId, id: { in: [...new Set(rows.map((r) => r.targetId))] } }, select: { id: true, policy: { select: { title: true } } } }),
  ]);
  const title = new Map(versions.map((v) => [v.id, v.policy.title]));
  const of = new Map(people.map((p) => [p.id, p]));
  for (const r of rows) {
    const p = of.get(r.employeeId);
    if (!p?.userId) continue;
    await sendNotice(accountId, orgId, [p.userId], { kind: 'people.acknowledge', title: `Reminder: please read and accept ${title.get(r.targetId) || 'a policy'}`, body: 'Open it in the employee app, under Me, and accept.', link: { app: 'people', screen: 'overview' } }, { dedupeKey: `policy-accept:${r.id}` }).catch(() => 0);
  }
  /* People without a CLOR sign-in see it waiting in the employee app, where it already shows. */
  return { count: people.length, recipients: people.map((p) => p.name) };
});

registerRecipe('firstDayPlan', async ({ accountId, orgId, today }) => {
  const tomorrow = plusDays(today, 1);
  const joiners = await peoplePrisma.employee.findMany({ where: { orgId, dateOfJoining: tomorrow, status: { not: 'LEFT' } }, select: { id: true, name: true, email: true, personalEmail: true, userId: true, reportingManagerId: true, designation: true } });
  if (!joiners.length) return { count: 0, recipients: [] };
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } }).catch(() => null);
  let count = 0;
  const told: string[] = [];
  for (const j of joiners) {
    const [steps, manager] = await Promise.all([
      peoplePrisma.checklistTask.findMany({ where: { orgId, employeeId: j.id, kind: 'JOINING', owner: 'EMPLOYEE', doneAt: null }, orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }], select: { title: true } }),
      j.reportingManagerId ? peoplePrisma.employee.findFirst({ where: { id: j.reportingManagerId, orgId }, select: { name: true, userId: true } }) : null,
    ]);
    const lines = [
      `You start tomorrow, ${longDay(tomorrow)}${j.designation ? `, as ${j.designation}` : ''}.`,
      manager ? `You report to ${manager.name}.` : null,
      steps.length ? `Before or on your first day:\n${steps.map((s) => `- ${s.title}`).join('\n')}` : 'Bring an ID proof, your PAN card and your bank details.',
    ].filter(Boolean).join('\n\n');
    const to = j.email || j.personalEmail;
    let sent = 0;
    if (to) {
      await sendTemplate({ templateKey: 'people.automation', to, toName: j.name, accountId, orgId, relatedType: 'Employee', relatedId: j.id, data: { name: j.name, orgName: org?.name || 'Your company', headline: 'Your first day tomorrow', body: lines } }).then(() => { sent = 1; }).catch(() => undefined);
    }
    if (j.userId) sent += await sendNotice(accountId, orgId, [j.userId], { kind: 'people.first_day', title: 'Your first day is tomorrow', body: lines, link: null }, { dedupeKey: `first-day:${j.id}:${tomorrow}` }).catch(() => 0);
    /* The manager hears too, so someone is ready for them. */
    if (manager?.userId) await sendNotice(accountId, orgId, [manager.userId], { kind: 'people.first_day', title: `${j.name} starts tomorrow`, body: 'Plan their first day: a desk, a buddy, their first task.', link: { app: 'people', screen: 'joiners' } }, { dedupeKey: `first-day-manager:${j.id}:${tomorrow}` }).catch(() => 0);
    if (sent) {
      count += 1;
      told.push(j.name);
    }
  }
  return { count, recipients: told };
});
