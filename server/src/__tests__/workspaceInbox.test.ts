import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Workspace Inbox (services/workspace/inbox.ts): the list behind the Overview's
 * waiting number. Rows open the app that owns them; only what the reader may
 * decide is shown, and the reader's own updates come with it.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `inbox.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Inbox Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const user = await platformPrisma.user.findFirstOrThrow({ where: { email }, select: { id: true, accountId: true } });
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: user.id, accountId: user.accountId };
}

const inbox = (c: Ctx) => request(app).get(`/api/orgs/${c.orgId}/workspace/inbox`).set(at(c));

describe('the Workspace inbox', () => {
  it('lists a leave request waiting on HR, opening People, with its tasks and updates', async () => {
    const c = await makeOwner();
    const empty = await inbox(c).expect(200);
    expect(empty.body.rows.filter((r: { kind: string }) => r.kind === 'decide')).toEqual([]);
    expect(empty.body.unanswered).toEqual([]);

    const employee = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha Rao', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual leave', code: 'CL', annualDays: 12 }).expect(201)).body.type;
    await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/requests`).set(at(c)).send({ employeeId: employee.id, leaveTypeId: type.id, fromDate: '2026-11-20', toDate: '2026-11-21', reason: 'Family function' }).expect(201);

    const { body } = await inbox(c).expect(200);
    const decide = body.rows.filter((r: { kind: string }) => r.kind === 'decide');
    expect(decide).toHaveLength(1);
    expect(decide[0]).toMatchObject({ app: 'people', title: 'Casual leave', who: 'Asha Rao', open: { app: 'people', screen: 'approvals' } });
    expect(decide[0].detail).toContain('20 Nov to 21 Nov');

    /* Joining tasks on the owner's name, opening the tasks tab. */
    const tasks = body.rows.filter((r: { kind: string }) => r.kind === 'task');
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].open).toEqual({ app: 'people', screen: 'approvals', params: { tab: 'tasks' } });

    /* An update of the reader's own, with its link. */
    await platformPrisma.notification.create({ data: { accountId: c.accountId, orgId: c.orgId, userId: c.userId, kind: 'payroll.bank_change', title: 'Bank details changed', linkJson: JSON.stringify({ app: 'payroll', screen: 'bankChanges' }) } });
    const after = (await inbox(c).expect(200)).body;
    expect(after.updates[0]).toMatchObject({ app: 'payroll', title: 'Bank details changed', read: false, open: { app: 'payroll', screen: 'bankChanges' } });
  });

  it('shows another company nothing, and refuses a company that is not the one in the header', async () => {
    const c = await makeOwner();
    const employee = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Ravi K', dateOfJoining: '2025-01-01' }).expect(201)).body.employee;
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Sick leave', code: 'SL', annualDays: 6 }).expect(201)).body.type;
    await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/requests`).set(at(c)).send({ employeeId: employee.id, leaveTypeId: type.id, fromDate: '2026-11-24', toDate: '2026-11-24', reason: 'Fever' }).expect(201);

    const other = await makeOwner();
    const theirs = (await inbox(other).expect(200)).body;
    expect(theirs.rows.some((r: { who: string }) => r.who === 'Ravi K')).toBe(false);
    expect(theirs.updates).toEqual([]);

    /* Asking for the first company with the second's headers. */
    const crossed = await request(app).get(`/api/orgs/${c.orgId}/workspace/inbox`).set(at(other));
    expect(crossed.status).toBeGreaterThanOrEqual(400);
  });
});
