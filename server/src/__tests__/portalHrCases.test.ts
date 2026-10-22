import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Ask HR from the employee app (connected workflows): the case lands in
 * People → HR Cases with a due date; each employee sees only their own.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

describe('ask HR from the app', () => {
  it('creates a case HR can see, and shows each employee only theirs', async () => {
    const email = `ask.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Ask Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
    const access = await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200);
    const signIn = async (code: string) => {
      const e = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: `Person ${code}`, code, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
      const act = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [e.id] }).expect(200)).body.codes[0].activationCode;
      const token = (await request(app).post('/api/portal/activate').send({ company: access.body.company.code, employeeCode: code, activationCode: act, password: 'mine pass 1' }).expect(200)).body.token;
      return { id: e.id, h: { Authorization: `Bearer ${token}` } };
    };
    const asha = await signIn('A1');
    const ravi = await signIn('A2');

    await request(app).post('/api/portal/hr-cases').set(asha.h).send({ title: '', description: 'x' }).expect(400);
    const made = (await request(app).post('/api/portal/hr-cases').set(asha.h).send({ title: 'October salary short', category: 'PAYROLL', description: 'Two days were cut as loss of pay; I was on approved leave.' }).expect(201)).body.case;
    expect(made).toMatchObject({ status: 'OPEN', category: 'PAYROLL' });

    expect((await request(app).get('/api/portal/hr-cases').set(asha.h).expect(200)).body.cases).toHaveLength(1);
    expect((await request(app).get('/api/portal/hr-cases').set(ravi.h).expect(200)).body.cases).toHaveLength(0);

    const hr = (await request(app).get(`/api/orgs/${c.orgId}/people/workspace/helpdesk`).set(at(c)).expect(200)).body.records;
    expect(hr.find((r: any) => r.id === made.id)).toMatchObject({ employeeId: asha.id, title: 'October salary short', status: 'OPEN', dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  }, 60_000);
});
