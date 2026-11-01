import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The Workforce automation audit: reminders that stay "once" after they are
 * read, reminder jobs that page past a backlog, parked outbox events kept out
 * of the queue, overdue approvals reminded again, an approval whose effect
 * fails closed (not stuck), a manager who has left or is suspended treated
 * as no manager, one task e-mail per person and none to whoever made the
 * plan, review tasks from a transfer's own work sites, and bulk transfers
 * through the one bulk path.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { notifyPermissionOnce } = await import('../services/notifications.js');
const { runDocumentReminders, runEndDateReminders, dueDocumentsWhere } = await import('../services/people/documentReminders.js');
const { deliverOutbox, RETRY_MINUTES } = await import('../services/people/outbox.js');
const { onApproved, resolveApprover, runApprovalDues } = await import('../services/people/approvals/engine.js');
const { resolveOwners } = await import('../services/people/checklists.js');
const { hrMayDecide } = await import('../services/attendance/approvalChain.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; accountId: string; branchId: string; userId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `auto.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Asha Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Auto Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, accountId: '', branchId: setup.body.branch.id, userId: '', email };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  ctx.userId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200)).body.user.id;
  ctx.accountId = (await platformPrisma.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { accountId: true } })).accountId;
  return ctx;
}
async function colleague(boss: Ctx, name: string, permissions: string[], ownOnly = false): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [], ownDocumentsOnly: ownOnly }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `${name.toLowerCase()}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: name, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, accountId: boss.accountId, branchId: boss.branchId, userId: user.body.user.id, email };
}
const people = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
});
const file = (text: string) => ({ data: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, mime: 'text/plain' });
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const plus = (days: number, from = new Date()) => ist(new Date(from.getTime() + days * 86_400_000));
const tenant = <T>(c: Ctx, fn: () => Promise<T>) => runInTenant(c.orgId, fn);
const MANAGER_PERMS = ['PEOPLE::Employees::VIEW', 'PEOPLE::Requests::VIEW', 'PEOPLE::Requests::CREATE', 'PEOPLE::Requests::APPROVE'];

let hr: Ctx;
beforeAll(async () => {
  hr = await owner();
}, 60_000);

describe('reminders said once stay once', () => {
  it('a contract-end reminder is not raised again after it has been read; an unread-only notice still may be', async () => {
    const e = (await people(hr).post('/employees', { name: 'Ritu Contract', code: 'AU-1' }).expect(201)).body.employee;
    await tenant(hr, () => peoplePrisma.employee.update({ where: { id: e.id }, data: { contractEndDate: plus(5) } }));
    const mine = () => platformPrisma.notification.findMany({ where: { orgId: hr.orgId, kind: 'people.contract_ending', title: { contains: 'Ritu Contract' } } });
    await runEndDateReminders();
    expect(await mine()).toHaveLength(1);
    await platformPrisma.notification.updateMany({ where: { orgId: hr.orgId, kind: 'people.contract_ending' }, data: { readAt: new Date() } });
    await runEndDateReminders();
    await runEndDateReminders(new Date(Date.now() + 86_400_000));
    expect(await mine()).toHaveLength(1);

    /* Without `ever`, "once" is once while unread (a reader that stays down). */
    const notice = { kind: 'reader.alert', title: `Reader down ${rnd()}`, dedupeKey: `offline:${rnd()}` };
    expect(await notifyPermissionOnce(hr.accountId, hr.orgId, 'PEOPLE::Employees::EDIT', notice)).toBe(1);
    expect(await notifyPermissionOnce(hr.accountId, hr.orgId, 'PEOPLE::Employees::EDIT', notice)).toBe(0);
    await platformPrisma.notification.updateMany({ where: { orgId: hr.orgId, title: notice.title }, data: { readAt: new Date() } });
    expect(await notifyPermissionOnce(hr.accountId, hr.orgId, 'PEOPLE::Employees::EDIT', notice)).toBe(1);
    await platformPrisma.notification.updateMany({ where: { orgId: hr.orgId, title: notice.title }, data: { readAt: new Date() } });
    expect(await notifyPermissionOnce(hr.accountId, hr.orgId, 'PEOPLE::Employees::EDIT', notice, { ever: true })).toBe(0);
  });
});

describe('document reminders read only what is due, a page at a time', () => {
  it('skips documents at the last stage and people who have left in the query, and reaches every due one across pages', async () => {
    const a = (await people(hr).post('/employees', { name: 'Pager One', code: 'AU-2' }).expect(201)).body.employee;
    const gone = (await people(hr).post('/employees', { name: 'Pager Gone', code: 'AU-3' }).expect(201)).body.employee;
    const due: string[] = [];
    for (let i = 0; i < 3; i += 1) due.push((await people(hr).post(`/employees/${a.id}/documents`, { title: `Licence ${i}`, kind: 'CONTRACT', expiresOn: plus(5), ...file(`l${i}`) }).expect(201)).body.document.id);
    const stale = (await people(hr).post(`/employees/${a.id}/documents`, { title: 'Old pass', kind: 'CONTRACT', expiresOn: plus(-400), ...file('old') }).expect(201)).body.document;
    await tenant(hr, () => peoplePrisma.employeeDocument.update({ where: { id: stale.id }, data: { expiryStage: 0 } }));
    const left = (await people(hr).post(`/employees/${gone.id}/documents`, { title: 'Gone pass', kind: 'CONTRACT', expiresOn: plus(5), ...file('g') }).expect(201)).body.document;
    await tenant(hr, () => peoplePrisma.employee.update({ where: { id: gone.id }, data: { status: 'LEFT' } }));

    const now = new Date();
    const matched = await tenant(hr, () => peoplePrisma.employeeDocument.findMany({ where: { orgId: hr.orgId, ...dueDocumentsWhere(now) } as any, select: { id: true } }));
    expect(matched.map((m) => m.id).sort()).toEqual([...due].sort());

    /* One row a page: all three are still reached. */
    await runDocumentReminders(now, 1);
    const rows = await tenant(hr, () => peoplePrisma.employeeDocument.findMany({ where: { id: { in: [...due, stale.id, left.id] } }, select: { id: true, expiryStage: true } }));
    const stage = Object.fromEntries(rows.map((r) => [r.id, r.expiryStage]));
    for (const id of due) expect(stage[id]).toBe(7);
    expect(stage[left.id]).toBeNull();
    /* Nothing new is due after that run. */
    expect(await tenant(hr, () => peoplePrisma.employeeDocument.count({ where: { orgId: hr.orgId, ...dueDocumentsWhere(now) } as any }))).toBe(0);
  });
});

describe('the outbox', () => {
  it('a parked event is not tried again on every run and does not take a place in the queue', async () => {
    const e = (await people(hr).post('/employees', { name: 'Parked Pat', code: 'AU-4' }).expect(201)).body.employee;
    const parkedAttempts = RETRY_MINUTES.length + 1;
    await tenant(hr, () => peoplePrisma.outboxEvent.createMany({ data: Array.from({ length: 3 }, () => ({ accountId: hr.accountId, orgId: hr.orgId, name: 'people.employee.updated.v1', employeeId: e.id, correlationId: `parked_${rnd()}`, payload: {}, attempts: parkedAttempts, nextAttemptAt: null, lastError: 'consumer down', occurredAt: new Date('2020-01-01T00:00:00Z') })) }));
    await deliverOutbox(new Date(), 5000);
    const rows = await tenant(hr, () => peoplePrisma.outboxEvent.findMany({ where: { orgId: hr.orgId, correlationId: { startsWith: 'parked_' } } }));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.deliveredAt === null && r.attempts === parkedAttempts && r.lastError === 'consumer down')).toBe(true);
    /* A fresh event behind them is still delivered. */
    await people(hr).put(`/employees/${e.id}`, { city: 'Mysuru' }).expect(200);
    await deliverOutbox(new Date(), 5000);
    const fresh = await tenant(hr, () => peoplePrisma.outboxEvent.findFirstOrThrow({ where: { orgId: hr.orgId, employeeId: e.id, name: 'people.employee.updated.v1', correlationId: { not: { startsWith: 'parked_' } } } }));
    expect(fresh.deliveredAt).toBeTruthy();
  });
});

describe('approvals', () => {
  let manager: Ctx;
  let managerEmp: any;
  let staff: any;
  beforeAll(async () => {
    manager = await colleague(hr, 'Ravi', MANAGER_PERMS);
    managerEmp = (await people(hr).post('/employees', { name: 'Ravi Manager', code: 'AU-10' }).expect(201)).body.employee;
    await tenant(hr, () => peoplePrisma.employee.update({ where: { id: managerEmp.id }, data: { userId: manager.userId } }));
    staff = (await people(hr).post('/employees', { name: 'Sita Staff', code: 'AU-11', reportingManagerId: managerEmp.id }).expect(201)).body.employee;
  }, 60_000);

  it('an overdue step on a "remind" rule is reminded again every three working days, not every run', async () => {
    await people(hr).post('/approval-rules', { requestType: 'SEAT_REQUEST', name: 'Seats', steps: [{ approver: { kind: 'USER', id: manager.userId }, dueDays: 1, overdue: { action: 'REMIND' } }] }).expect(201);
    const title = `Seat ${rnd()}`;
    const r = (await people(hr).post('/requests', { requestType: 'SEAT_REQUEST', subjectEmployeeId: staff.id, title, payload: {} }).expect(201)).body.request;
    const step = await tenant(hr, () => peoplePrisma.approvalStep.findFirstOrThrow({ where: { requestId: r.id, status: 'WAITING' } }));
    const count = () => platformPrisma.notification.count({ where: { orgId: hr.orgId, title: `Overdue: ${title}` } });
    const past = new Date(step.dueAt.getTime() + 3_600_000);
    await runApprovalDues(past);
    expect(await count()).toBe(1);
    await runApprovalDues(new Date(past.getTime() + 86_400_000));
    expect(await count()).toBe(1);
    await runApprovalDues(new Date(past.getTime() + 5 * 86_400_000));
    expect(await count()).toBe(2);
    await runApprovalDues(new Date(past.getTime() + 5 * 86_400_000 + 3_600_000));
    expect(await count()).toBe(2);
  });

  it('an approval whose effect fails is closed as not applied, with the reason, and the requester is told', async () => {
    onApproved('DESK_ESCALATION', async () => {
      throw new Error('The record changed since this was asked');
    });
    await people(hr).post('/approval-rules', { requestType: 'DESK_ESCALATION', name: 'Desk', steps: [{ approver: { kind: 'USER', id: manager.userId }, dueDays: 2 }] }).expect(201);
    const title = `Escalate ${rnd()}`;
    const r = (await people(hr).post('/requests', { requestType: 'DESK_ESCALATION', subjectEmployeeId: staff.id, title, payload: {} }).expect(201)).body.request;
    const res = await people(manager).post(`/requests/${r.id}/approve`, {}).expect(409);
    expect(res.body.error).toMatch(/could not be applied: The record changed since this was asked\./);
    const shaped = (await people(hr).get(`/requests/${r.id}`).expect(200)).body.request;
    expect(shaped.status).toBe('REJECTED');
    expect(shaped.steps.map((s: any) => s.status).sort()).toEqual(['APPROVED', 'REJECTED']);
    expect(shaped.steps.find((s: any) => s.status === 'REJECTED').comment).toBe('Could not apply: The record changed since this was asked.');
    expect(shaped.outcome).toEqual({ notApplied: 'The record changed since this was asked.' });
    const told = await platformPrisma.notification.findFirst({ where: { orgId: hr.orgId, userId: hr.userId, title: `Approved but not applied: ${title}` } });
    expect(told?.body).toMatch(/Could not apply/);
    /* Nothing is left waiting. */
    expect(await tenant(hr, () => peoplePrisma.approvalStep.count({ where: { requestId: r.id, status: 'WAITING' } }))).toBe(0);
  });

  it('a manager who has left or is suspended is no manager: approvals, plan tasks and Attendance go to HR', async () => {
    const who = { accountId: hr.accountId, orgId: hr.orgId };
    expect((await resolveApprover(who, { kind: 'MANAGER' }, staff.id)).primary).toEqual([manager.userId]);
    const owners = async () => resolveOwners({ ...who, userId: null }, { id: staff.id, reportingManagerId: managerEmp.id });
    expect((await owners()).MANAGER).toBe(manager.userId);
    await tenant(hr, () => peoplePrisma.attendanceSettings.upsert({ where: { orgId: hr.orgId }, create: { accountId: hr.accountId, orgId: hr.orgId, leaveApproval: 'MANAGER_THEN_HR', updatedByUserId: hr.userId }, update: { leaveApproval: 'MANAGER_THEN_HR' } }));
    expect((await tenant(hr, () => hrMayDecide(hr.orgId, 'leave', { employeeId: staff.id, managerApprovedAt: null }))).ok).toBe(false);

    for (const status of ['SUSPENDED', 'LEFT']) {
      await tenant(hr, () => peoplePrisma.employee.update({ where: { id: managerEmp.id }, data: { status } }));
      const primary = (await resolveApprover(who, { kind: 'MANAGER' }, staff.id)).primary;
      expect(primary).not.toContain(manager.userId);
      expect(primary).toContain(hr.userId);
      expect((await owners()).MANAGER).toBe(hr.userId);
      expect((await tenant(hr, () => hrMayDecide(hr.orgId, 'leave', { employeeId: staff.id, managerApprovedAt: null }))).ok).toBe(true);
    }
    await tenant(hr, () => peoplePrisma.employee.update({ where: { id: managerEmp.id }, data: { status: 'ACTIVE' } }));
  });
});

describe('plan e-mails', () => {
  it('an owner hiring alone gets no e-mail about their own tasks; someone else gets one e-mail listing all of theirs', async () => {
    const solo = await owner();
    const joiner = (await people(solo).post('/employees', { name: 'Solo Joiner', code: 'S-1' }).expect(201)).body.employee;
    const plan = (await people(solo).get(`/employees/${joiner.id}/checklist`).expect(200)).body.joining;
    expect(plan.tasks.length).toBeGreaterThan(3);
    expect(plan.tasks.map((t: any) => t.title)).not.toContain('Probation review');
    expect(await platformPrisma.emailOutbox.count({ where: { orgId: solo.orgId, templateKey: 'people.task_assigned' } })).toBe(0);
    expect(await platformPrisma.notification.count({ where: { orgId: solo.orgId, kind: 'people.task' } })).toBe(0);

    const it2 = await colleague(solo, 'Imran', ['PEOPLE::Assets::EDIT', 'PEOPLE::Employees::VIEW']);
    await request(app).put(`/api/orgs/${solo.orgId}/people/checklist-templates/JOINING`).set(at(solo)).send({ items: [
      { title: 'Laptop ready', owner: 'IT', dueDays: 0 },
      { title: 'Email account made', owner: 'IT', dueDays: 1 },
      { title: 'Collect ID proof', owner: 'HR', dueDays: 0 },
    ] }).expect(200);
    await people(solo).post('/employees', { name: 'Second Joiner', code: 'S-2' }).expect(201);
    const mails = await platformPrisma.emailOutbox.findMany({ where: { orgId: solo.orgId, templateKey: 'people.task_assigned' } });
    expect(mails.map((m) => m.toEmail)).toEqual([it2.email]);
    expect(mails[0].subject).toMatch(/^2 joining tasks — Second Joiner/);
    expect(mails[0].bodyText).toMatch(/Laptop ready \(due [\d-]+\):\n\S+\/api\/people\/task-links\//);
    expect(mails[0].bodyText).toMatch(/Email account made \(due [\d-]+\):\n\S+\/api\/people\/task-links\//);
  });
});

describe('review tasks after a transfer', () => {
  it('a location-only move does not bring back the state differences of an earlier work-site move', async () => {
    const entity = (await people(hr).post('/structure/legal-entities', { name: `Auto Pvt Ltd ${rnd()}` }).expect(201)).body.item;
    const blr = (await people(hr).post('/structure/establishments', { name: 'Bengaluru office', kind: 'OFFICE', state: 'Karnataka', legalEntityId: entity.id }).expect(201)).body.item;
    const pune = (await people(hr).post('/structure/establishments', { name: 'Pune shop', kind: 'SHOP', state: 'Maharashtra', legalEntityId: entity.id }).expect(201)).body.item;
    const area = (await people(hr).post('/structure/areas', { name: `Floor ${rnd()}` }).expect(201)).body.item;
    const e = (await people(hr).post('/employees', { name: 'Mover Mani', code: 'AU-20', establishmentId: blr.id }).expect(201)).body.employee;
    await people(hr).put(`/employees/${e.id}`, { establishmentId: pune.id }).expect(200);
    await deliverOutbox(new Date(), 5000);
    const changeTasks = () => tenant(hr, () => peoplePrisma.checklistTask.findMany({ where: { orgId: hr.orgId, employeeId: e.id, kind: 'CHANGE' } }));
    expect(await changeTasks()).toHaveLength(2);
    /* HR deals with them. */
    await tenant(hr, () => peoplePrisma.checklistTask.updateMany({ where: { orgId: hr.orgId, employeeId: e.id, kind: 'CHANGE' }, data: { doneAt: new Date() } }));
    /* Now only the location changes. */
    await people(hr).put(`/employees/${e.id}`, { areaId: area.id }).expect(200);
    const moved = await tenant(hr, () => peoplePrisma.outboxEvent.findMany({ where: { orgId: hr.orgId, employeeId: e.id, name: 'people.employee.transferred.v1' } }));
    expect(moved).toHaveLength(2);
    await deliverOutbox(new Date(), 5000);
    expect(await changeTasks()).toHaveLength(2);
  });
});

describe('bulk transfer (Attendance → Transfers)', () => {
  it('goes through the bulk path: team scope, the approval rule, the change log, a later date waits', async () => {
    const co = await owner();
    const stores = (await people(co).post('/structure/departments', { name: 'Stores' }).expect(201)).body.item;
    const packing = (await people(co).post('/structure/departments', { name: 'Packing' }).expect(201)).body.item;
    const lead = await colleague(co, 'Lata', ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT'], true);
    const leadEmp = (await people(co).post('/employees', { name: 'Lata Lead', code: 'T-1' }).expect(201)).body.employee;
    await runInTenant(co.orgId, () => peoplePrisma.employee.update({ where: { id: leadEmp.id }, data: { userId: lead.userId } }));
    const mine = (await people(co).post('/employees', { name: 'In Team', code: 'T-2', reportingManagerId: leadEmp.id }).expect(201)).body.employee;
    const other = (await people(co).post('/employees', { name: 'Not In Team', code: 'T-3' }).expect(201)).body.employee;

    /* A team lead moves only their own team. */
    const r = (await people(lead).post('/employees/transfer', { employeeIds: [mine.id, other.id], field: 'departmentId', targetId: stores.id, note: 'Season' }).expect(200)).body;
    expect(r).toMatchObject({ moved: 1, changed: 1, notFound: 1 });
    const after = await runInTenant(co.orgId, () => peoplePrisma.employee.findMany({ where: { id: { in: [mine.id, other.id] } }, select: { id: true, departmentId: true, department: true, version: true } }));
    const byId = Object.fromEntries(after.map((x) => [x.id, x]));
    expect(byId[mine.id]).toMatchObject({ departmentId: stores.id, department: 'Stores' });
    expect(byId[mine.id].version).toBeGreaterThan(mine.version ?? 0);
    expect(byId[other.id].departmentId).toBeNull();
    /* Logged and announced like any change. */
    expect(await runInTenant(co.orgId, () => peoplePrisma.changeLog.count({ where: { entity: 'Employee', entityId: mine.id, field: 'departmentId' } }))).toBe(1);
    expect(await runInTenant(co.orgId, () => peoplePrisma.outboxEvent.count({ where: { orgId: co.orgId, employeeId: mine.id, name: 'people.employment.changed.v1' } }))).toBeGreaterThanOrEqual(1);

    /* A later date waits for that day. */
    const later = plus(20);
    const s = (await people(co).post('/employees/transfer', { employeeIds: [other.id], field: 'departmentId', targetId: packing.id, effectiveDate: later }).expect(200)).body;
    expect(s).toMatchObject({ moved: 0, scheduled: 1, effectiveFrom: later });
    expect((await runInTenant(co.orgId, () => peoplePrisma.employee.findUniqueOrThrow({ where: { id: other.id } }))).departmentId).toBeNull();
    expect(await runInTenant(co.orgId, () => peoplePrisma.scheduledChange.count({ where: { orgId: co.orgId, employeeId: other.id, field: 'departmentId', effectiveOn: later, status: 'PENDING' } }))).toBe(1);

    /* With a job-change approval rule in force, it is refused, not slipped past the approvers. */
    await people(co).post('/approval-rules', { requestType: 'JOB_CHANGE', name: 'Job changes', steps: [{ approver: { kind: 'HR' }, dueDays: 2 }] }).expect(201);
    const refused = await people(co).post('/employees/transfer', { employeeIds: [mine.id], field: 'departmentId', targetId: packing.id }).expect(409);
    expect(refused.body.code).toBe('RULE_IN_FORCE');
  });
});
