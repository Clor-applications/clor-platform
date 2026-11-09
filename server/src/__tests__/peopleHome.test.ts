import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * People → Home (founder, 22 Oct 2026): only what needs someone today, most
 * urgent first, each with the screen that does it.
 */
const { buildApp } = await import('../app.js');

const app = buildApp().listen(0, '127.0.0.1');
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
    await people('post', '/desk', { employeeId: a.id, category: 'PAYROLL', subject: 'Salary not credited', description: 'October salary missing', urgency: 'URGENT' }).expect(201);
    const job = (await people('post', '/talent/openings', { title: 'Accountant', status: 'OPEN' }).expect(201)).body.opening;
    await people('post', '/talent/candidates', { openingId: job.id, name: 'Meera K', email: 'meera@example.com' }).expect(201);
    await people('post', '/workspace/assets', { title: 'Laptop', status: 'ASSIGNED', employeeId: r.id, details: { assetTag: 'LT-01' } }).expect(201);
    await people('post', `/employees/${r.id}/resign`, { lastDay: plus(-1), leavingType: 'RESIGNED' }).expect(200);
    /* Five days ahead, moved off a Sunday: leave on a weekly off has nothing to take. */
    const workday = new Date(`${plus(5)}T00:00:00Z`).getUTCDay() === 0 ? plus(6) : plus(5);
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/requests`).set(at(c)).send({ employeeId: a.id, leaveTypeId: type.id, fromDate: workday, toDate: workday, reason: 'Family function' }).expect(201);

    const todos = (await people('get', '/home').expect(200)).body.todos;
    const by = (k: string) => todos.find((t: any) => t.key === k);
    expect(by('helpdesk')).toMatchObject({ tone: 'urgent', screen: 'helpdesk', count: 1 });
    expect(by('assets')).toMatchObject({ tone: 'urgent', screen: 'assets', count: 1 });
    expect(by('probation')).toMatchObject({ count: 1, screen: 'employees' });
    expect(by('leave')).toMatchObject({ count: 1, screen: 'approvals', params: { kind: 'LEAVE' } });
    expect(by('candidates')).toMatchObject({ count: 1, screen: 'candidates' });
    expect(by('checklists')?.screen).toBe('checklists');
    /* Urgent first. */
    const tones = todos.map((t: any) => t.tone);
    expect(tones.indexOf('info')).toBeGreaterThan(tones.lastIndexOf('urgent'));
  }, 60_000);

  it("says one waiting number, the inbox's own, and this week's joiners, last days, holidays, probation and month close", async () => {
    const email = `glance.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Glance Co ${rnd()}`, state: 'Karnataka' }).expect(200);
    const c: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
    const people = (m: 'get' | 'post' | 'put', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any);
    const { weekOf } = await import('../services/people/home.js');
    const today = plus(0);
    const week = weekOf(today);

    const a = (await people('post', '/employees', { name: 'Asha', code: 'G1', dateOfJoining: plus(-60), probationEndDate: plus(10) }).expect(201)).body.employee;
    const late = (await people('post', '/employees', { name: 'Bina', code: 'G2', dateOfJoining: plus(-200), probationEndDate: plus(-3) }).expect(201)).body.employee;
    await people('post', '/employees', { name: 'Chetan', code: 'G3', dateOfJoining: plus(-200), probationEndDate: plus(45) }).expect(201);
    const joiner = (await people('post', '/employees', { name: 'Dev', code: 'G4', dateOfJoining: week.from }).expect(201)).body.employee;
    const leaver = (await people('post', '/employees', { name: 'Esha', code: 'G5', dateOfJoining: plus(-400) }).expect(201)).body.employee;
    await people('post', `/employees/${leaver.id}/resign`, { lastDay: week.to, leavingType: 'RESIGNED' }).expect(200);
    await request(app).post(`/api/orgs/${c.orgId}/attendance/holidays`).set(at(c)).send({ date: week.to, name: 'Festival' }).expect(201);
    /* Two kinds waiting: a leave request and a help desk case. */
    const workday = new Date(`${plus(5)}T00:00:00Z`).getUTCDay() === 0 ? plus(6) : plus(5);
    const type = (await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/types`).set(at(c)).send({ name: 'Casual', annualDays: 12 }).expect(201)).body.type;
    await request(app).post(`/api/orgs/${c.orgId}/attendance/leave/requests`).set(at(c)).send({ employeeId: a.id, leaveTypeId: type.id, fromDate: workday, toDate: workday, reason: 'Family function' }).expect(201);
    await people('post', '/desk', { employeeId: a.id, category: 'PAYROLL', subject: 'Payslip', description: 'Where is it', urgency: 'NORMAL' }).expect(201);

    const home = (await people('get', '/home').expect(200)).body;
    const inbox = (await people('get', '/inbox').expect(200)).body;
    /* Home's subtitle and card, the rail badge, the bell and the Inbox tabs: one number from one place (requests to approve plus the reader's own open tasks). */
    expect(home.waiting).toBe(inbox.counts.waiting);
    expect(inbox.counts.waiting).toBe(inbox.counts.all + inbox.counts.TASK);
    expect(inbox.counts.all).toBeGreaterThanOrEqual(2);

    expect(home.probation.map((p: any) => p.id)).toEqual([late.id, a.id]);
    expect(home.probation[0]).toMatchObject({ over: true, endsOn: plus(-3) });
    expect(home.week).toMatchObject({ from: week.from, to: week.to });
    expect(home.week.joining.map((p: any) => p.id)).toContain(joiner.id);
    expect(home.week.leaving).toEqual([{ id: leaver.id, name: 'Esha', on: week.to }]);
    expect(home.week.holidays).toEqual([{ date: week.to, name: 'Festival', optional: false }]);
    /* Attendance is on and the owner closes months: last month's close, not closed yet. */
    expect(home.monthClose).toMatchObject({ closedAt: null });
    expect(home.monthClose.month).toMatch(/^\d{4}-\d{2}$/);
  }, 90_000);
});
