import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The employee app's failures (audit 7 Nov 2026 #24). The leave explainer,
 * overtime and field-punch decisions and the month review sent `err.message`
 * with a 500, so Prisma or driver text reached the phone and skipped the
 * global masker. A refusal the service chose still reads in its own words; a
 * fault reads plainly, with the request id to quote.
 */
const { buildApp } = await import('../app.js');
const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

let token = '';
let leaveTypeId = '';
beforeAll(async () => {
  const email = `perr.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Errors Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
  const att = (m: 'get' | 'post', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);
  const e = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Imran Patil', code: 'PE-1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  leaveTypeId = (await att('post', '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type.id;
  const companyCode = (await att('get', '/portal-access').expect(200)).body.company.code;
  const code = (await att('post', '/portal-access/codes', { employeeIds: [e.id] }).expect(200)).body.codes[0].activationCode;
  token = (await request(app).post('/api/portal/activate').send({ company: companyCode, employeeCode: 'PE-1', activationCode: code, password: 'app pass 12' }).expect(200)).body.token;
}, 90_000);
const phone = (m: 'get' | 'post', p: string, b?: unknown) => (request(app) as any)[m](`/api/portal${p}`).set('Authorization', `Bearer ${token}`).send(b as any);

describe('what the employee app says when something fails', () => {
  it('a fault inside the explainer reads plainly with a request id, never the database text', async () => {
    /* A year no column can hold: the database refuses it, and that refusal used to be sent as it was. */
    const r = await phone('get', `/leave/explain?leaveTypeId=${leaveTypeId}&year=99999999999`);
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('Something went wrong. Try again in a moment.');
    expect(r.body).toHaveProperty('requestId');
    expect(JSON.stringify(r.body)).not.toMatch(/prisma|invocation|column|integer|range|\.findFirst|\.findMany/i);
  });

  it('a refusal the service chose still reads in its own words', async () => {
    const r = await phone('get', '/leave/explain?leaveTypeId=nope');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('No such leave type or person.');
    const ot = await phone('post', '/approvals/overtime/nope', { decision: 'approve' });
    expect(ot.status).toBe(404);
    expect(ot.body.error).toBeTruthy();
    expect(ot.body.requestId).toBeUndefined();
  });
});
