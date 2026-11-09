import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { setSubscription } from '../services/subscriptions.js';

/*
 * People plan, 8 Nov 2026, end to end: an account that bought Attendance and
 * not People adds, lists and opens its staff through Attendance's People
 * section, while People's own pages still say "not on the subscription".
 */
const { buildApp } = await import('../app.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);

describe('Attendance without People', () => {
  it('keeps its staff list and structure, and People-only pages stay closed', async () => {
    const email = `att.only.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Att Only ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c = { token: signup.body.token as string, orgId: setup.body.company.orgId as string, branchId: setup.body.branch.id as string };
    const at = { Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId };
    await setSubscription((jwt.decode(c.token) as { accountId: string }).accountId, { apps: [{ appCode: 'attendance' }] });
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at).send({ features: { attendance: true } }).expect(200);

    const base = `/api/orgs/${c.orgId}/people`;
    const dept = await request(app).post(`${base}/structure/departments`).set(at).send({ name: 'Stores' }).expect(201);
    const made = await request(app).post(`${base}/employees`).set(at).send({ firstName: 'Ravi', lastName: 'Kumar', dateOfJoining: '2026-04-01', departmentId: dept.body.id ?? dept.body.item?.id }).expect(201);
    const id = made.body.employee?.id ?? made.body.id;
    const list = await request(app).get(`${base}/employees`).set(at).expect(200);
    expect(JSON.stringify(list.body)).toContain('Ravi');
    await request(app).get(`${base}/employees/${id}`).set(at).expect(200);
    await request(app).get(`${base}/structure/departments`).set(at).expect(200);

    expect((await request(app).get(`${base}/home`).set(at).expect(402)).body.code).toBe('APP_NOT_SUBSCRIBED');
    expect((await request(app).get(`${base}/inbox`).set(at)).status).toBe(402);
  }, 60_000);
});
