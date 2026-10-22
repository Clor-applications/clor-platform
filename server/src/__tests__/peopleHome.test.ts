import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * People → Home (founder, 22 Oct 2026): only what needs someone today, most
 * urgent first, each with the screen that does it.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const plus = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);

describe('People home', () => {
  it('lists what needs doing, urgent first, and nothing when all is done', async () => {
    const email = `home.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Home Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
    const people = (m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);

    /* A brand-new company: nothing but the joining checklists of nobody. */
    expect((await people('get', '/home').expect(200)).body.todos).toEqual([]);

    const a = (await people('post', '/employees', { name: 'Asha', code: 'H1', dateOfJoining: plus(-60), probationEndDate: plus(10) }).expect(201)).body.employee;
    const r = (await people('post', '/employees', { name: 'Ravi', code: 'H2', dateOfJoining: plus(-400) }).expect(201)).body.employee;
    await people('post', `/employees/${a.id}/documents`, { kind: 'ID_PROOF', title: 'Passport', expiresOn: plus(20), file: `data:application/pdf;base64,${Buffer.from('%PDF-1.4').toString('base64')}` });
    await people('post', '/workspace/helpdesk', { title: 'Salary not credited', status: 'OPEN', employeeId: a.id, details: { category: 'PAYROLL', priority: 'URGENT', description: 'October salary missing' } }).expect(201);
    const job = (await people('post', '/workspace/recruitment', { title: 'Accountant', status: 'OPEN', details: { openings: 1 } }).expect(201)).body.record;
    await people('post', '/workspace/candidates', { title: 'Meera K', status: 'APPLIED', details: { jobId: job.id, email: 'meera@example.com' } }).expect(201);
    await people('post', '/workspace/assets', { title: 'Laptop', status: 'ASSIGNED', employeeId: r.id, details: { assetTag: 'LT-01' } }).expect(201);
    await people('post', `/employees/${r.id}/resign`, { lastDay: plus(-1), leavingType: 'RESIGNED' }).expect(200);
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/requests`).set(at(c)).send({ employeeId: a.id, leaveTypeId: type.id, fromDate: plus(5), toDate: plus(5), reason: 'Family function' }).expect(201);

    const todos = (await people('get', '/home').expect(200)).body.todos;
    const by = (k: string) => todos.find((t: any) => t.key === k);
    expect(by('helpdesk')).toMatchObject({ tone: 'urgent', screen: 'helpdesk', count: 1 });
    expect(by('assets')).toMatchObject({ tone: 'urgent', screen: 'assets', count: 1 });
    expect(by('probation')).toMatchObject({ count: 1, screen: 'employees' });
    expect(by('leave')).toMatchObject({ count: 1, screen: 'leaveRequests' });
    expect(by('candidates')).toMatchObject({ count: 1, screen: 'candidates' });
    expect(by('checklists')?.screen).toBe('checklists');
    /* Urgent first. */
    const tones = todos.map((t: any) => t.tone);
    expect(tones.indexOf('info')).toBeGreaterThan(tones.lastIndexOf('urgent'));
  }, 60_000);
});
