import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Hire (connected workflows): an offered candidate becomes an employee in one
 * step, in the opening's department, with the joining checklist started.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

describe('hire a candidate', () => {
  it('makes an offered candidate an employee, once', async () => {
    const email = `hire.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Hire Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
    const people = (m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);

    const finance = (await people('post', '/structure/departments', { name: 'Finance' }).expect(201)).body.item;
    /* Hiring lives in Talent (routes/peopleTalent.ts): an opening, a candidate on it, Offer, then Hire. */
    const job = (await people('post', '/talent/openings', { title: 'Accountant', departmentId: finance.id, places: 2, status: 'OPEN' }).expect(201)).body.opening;
    const cand = (await people('post', '/talent/candidates', { openingId: job.id, name: 'Meera K', email: 'meera@example.com', phone: '9800000001' }).expect(201)).body.candidate;

    /* Not before an offer. */
    await people('post', `/talent/candidates/${cand.id}/hire`, { dateOfJoining: '2026-11-02' }).expect(409);
    await people('post', `/talent/candidates/${cand.id}/stage`, { stage: 'OFFER' }).expect(200);
    await people('post', `/talent/candidates/${cand.id}/hire`, {}).expect(400);

    const hired = (await people('post', `/talent/candidates/${cand.id}/hire`, { dateOfJoining: '2026-11-02', code: 'F-21' }).expect(201)).body.employee;
    const file = (await people('get', `/employees/${hired.id}`).expect(200)).body.employee;
    expect(file).toMatchObject({ name: 'Meera K', code: 'F-21', email: 'meera@example.com', phone: '9800000001', dateOfJoining: '2026-11-02', department: 'Finance' });
    const { joining } = (await people('get', `/employees/${hired.id}/checklist`).expect(200)).body;
    expect(joining.total).toBeGreaterThan(0);
    const after = (await people('get', `/talent/candidates/${cand.id}`).expect(200)).body.candidate;
    expect(after).toMatchObject({ stage: 'HIRED', employeeId: hired.id });

    await people('post', `/talent/candidates/${cand.id}/hire`, { dateOfJoining: '2026-11-02' }).expect(409);
    const concurrent = (await people('post', '/talent/candidates', { openingId: job.id, name: 'Concurrent Hire', email: 'concurrent@example.com' }).expect(201)).body.candidate;
    await people('post', `/talent/candidates/${concurrent.id}/stage`, { stage: 'OFFER' }).expect(200);
    const attempts = await Promise.all([people('post', `/talent/candidates/${concurrent.id}/hire`, { dateOfJoining: '2026-11-02' }), people('post', `/talent/candidates/${concurrent.id}/hire`, { dateOfJoining: '2026-11-02' })]);
    expect(attempts.map((a: any) => a.status).sort()).toEqual([201, 409]);
    const directory = (await people('get', '/employees?q=Concurrent').expect(200)).body.employees;
    expect(directory).toHaveLength(1);

  }, 60_000);
});
