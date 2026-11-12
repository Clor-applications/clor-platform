import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The "Get started" lists on People's and Attendance's Home
 * (services/people/setup.ts, services/attendance/setup.ts). Every step is
 * worked out from the company's records; nobody can tick one. A list goes
 * away when all is done or when it is hidden, and hiding one app's list
 * leaves the other's alone. Only someone who sets the company up gets it.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { buildAttendanceSteps, weeklyOffWords } = await import('../services/attendance/setup.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function owner(): Promise<Ctx> {
  const email = `gs.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Get Started ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
async function withRole(boss: Ctx, label: string): Promise<Ctx> {
  const roles = (await request(app).get(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).expect(200)).body;
  const role = (roles.roles || roles).find((r: any) => r.name === label);
  expect(role, label).toBeTruthy();
  const email = `${label.toLowerCase().replace(/[^a-z]/g, '')}.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: label, password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId };
}
const call = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
});
const year = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 4);
const doneKeys = (setup: any) => setup.steps.filter((s: any) => s.done).map((s: any) => s.key);
/* The steps that hold the list open (Payroll and documents are optional, and Payroll may be on from the start). */
const requiredDone = (setup: any) => setup.steps.filter((s: any) => s.done && !s.optional).map((s: any) => s.key);

describe('weekly off in words', () => {
  it('says the days the way people say them', () => {
    expect(weeklyOffWords('0')).toBe('Sunday off');
    expect(weeklyOffWords('0,6')).toBe('Saturday and Sunday off');
    expect(weeklyOffWords('0', '2,4')).toBe('Sunday and the 2nd and 4th Saturday off');
    expect(weeklyOffWords('')).toBe('no weekly off');
  });

  it('marks only the steps a person may act on', () => {
    const facts = { year, shifts: [], week: null, holidays: 0, employees: 0, readers: 0, readersHeard: 0, phonePunch: 0, firstDay: null };
    const steps = buildAttendanceSteps(facts, new Set(['holidays']));
    expect(steps.map((s) => s.key)).toEqual(['shift', 'weeklyOff', 'holidays', 'people', 'punch', 'firstDay']);
    expect(steps.filter((s) => s.can).map((s) => s.key)).toEqual(['holidays']);
    expect(steps.every((s) => !s.done)).toBe(true);
  });
});

describe('Attendance: Get started', () => {
  let c: Ctx;
  beforeAll(async () => {
    c = await owner();
  }, 60_000);

  it('starts with nothing done, and refuses a tick from outside', async () => {
    const { setup } = (await call(c).get('/attendance/setup').expect(200)).body;
    expect(setup).toMatchObject({ done: 0, total: 6, show: true });
    expect(setup.steps.every((s: any) => s.can)).toBe(true);
    /* There is no way to say a step is done: only hide and show. */
    await call(c).post('/attendance/setup', { action: 'done', step: 'shift' }).expect(400);
  });

  it('ticks each step from the records, and goes away once all six are there', async () => {
    const shift = (await call(c).post('/attendance/shifts', { name: 'General', startTime: '09:00', endTime: '18:00', weeklyOffDays: '0', offSaturdays: '2,4' }).expect(201)).body.shift;
    let { setup } = (await call(c).get('/attendance/setup').expect(200)).body;
    expect(doneKeys(setup)).toEqual(['shift', 'weeklyOff']);
    expect(setup.steps.find((s: any) => s.key === 'weeklyOff').detail).toBe('General: Sunday and the 2nd and 4th Saturday off');

    await call(c).post('/attendance/holidays', { date: `${year}-10-02`, name: 'Gandhi Jayanti' }).expect(201);
    const asha = (await call(c).post('/people/employees', { name: 'Asha', code: 'E1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    ({ setup } = (await call(c).get('/attendance/setup').expect(200)).body);
    expect(doneKeys(setup)).toEqual(['shift', 'weeklyOff', 'holidays', 'people']);

    /* Phone punch for one person is a way in, as a reader is. */
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: asha.id }, data: { mobilePunch: true } }));
    ({ setup } = (await call(c).get('/attendance/setup').expect(200)).body);
    expect(setup.steps.find((s: any) => s.key === 'punch')).toMatchObject({ done: true, detail: 'No reader added · phone punch on for 1 person' });

    await call(c).put('/attendance/records', { employeeId: asha.id, date: '2026-09-02', checkIn: '09:00', checkOut: '18:00' }).expect(200);
    ({ setup } = (await call(c).get('/attendance/setup').expect(200)).body);
    expect(setup).toMatchObject({ done: 6, total: 6, show: false });
    expect(setup.steps.find((s: any) => s.key === 'firstDay').detail).toBe('First day 2 September 2026');
    expect(shift.id).toBeTruthy();
  });

  it('hides for the company, and leaves People’s list as it was', async () => {
    const d = await owner();
    await call(d).post('/people/setup', { action: 'skip', step: 'documents' }).expect(200);
    const hidden = (await call(d).post('/attendance/setup', { action: 'hide' }).expect(200)).body.setup;
    expect(hidden.show).toBe(false);
    expect(hidden.done).toBe(0);
    const people = (await call(d).get('/people/setup').expect(200)).body.setup;
    expect(people.show).toBe(true);
    expect(people.steps.find((s: any) => s.key === 'documents').skipped).toBe(true);
    /* And the other way round: People's hide does not undo Attendance's. */
    await call(d).post('/people/setup', { action: 'hide' }).expect(200);
    expect((await call(d).get('/attendance/setup').expect(200)).body.setup.show).toBe(false);
    expect((await call(d).post('/attendance/setup', { action: 'show' }).expect(200)).body.setup.show).toBe(true);
  });

  it('is not offered to a team manager', async () => {
    const lead = await withRole(c, 'Team Manager');
    const res = await call(lead).get('/attendance/setup');
    expect(res.status).toBe(403);
  });
});

describe('People: Get started', () => {
  it('a new company is asked for structure and approvers; each ticks from its records', async () => {
    const c = await owner();
    let { setup } = (await call(c).get('/people/setup').expect(200)).body;
    expect(setup.steps.map((s: any) => s.key)).toEqual(['structure', 'people', 'week', 'leave', 'approvers', 'app', 'documents', 'payroll']);
    expect(setup.steps.filter((s: any) => !s.optional).map((s: any) => s.key)).toEqual(['structure', 'people', 'week', 'leave', 'approvers', 'app']);
    expect(setup).toMatchObject({ done: 0, total: 6, show: true });

    await call(c).post('/people/structure/departments', { name: 'Finance' }).expect(201);
    const boss = (await call(c).post('/people/employees', { name: 'Meera', code: 'M1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    ({ setup } = (await call(c).get('/people/setup').expect(200)).body);
    expect(requiredDone(setup)).toEqual(['structure', 'people']);
    expect(setup.steps.find((s: any) => s.key === 'approvers').detail).toMatch(/^HR decides leave · 0 of 1 person has a manager/);

    await call(c).post('/people/employees', { name: 'Ravi', code: 'R1', dateOfJoining: '2026-01-01', reportingManagerId: boss.id }).expect(201);
    ({ setup } = (await call(c).get('/people/setup').expect(200)).body);
    expect(doneKeys(setup)).toContain('approvers');
    expect(setup.steps.find((s: any) => s.key === 'approvers').detail).toMatch(/1 of 2 people have a manager/);
    expect(setup.steps.find((s: any) => s.key === 'documents')).toMatchObject({ done: false, optional: true });
  });

  it('a company that began before these steps is not held to them', async () => {
    const c = await owner();
    /* Someone was added before the list was first looked at: the company had begun. */
    await call(c).post('/people/employees', { name: 'Old hand', code: 'O1', dateOfJoining: '2025-01-01' }).expect(201);
    const { setup } = (await call(c).get('/people/setup').expect(200)).body;
    expect(setup.steps.find((s: any) => s.key === 'structure').optional).toBe(true);
    expect(setup.steps.find((s: any) => s.key === 'approvers').optional).toBe(true);
    expect(setup.total).toBe(4);
    /* The answer is kept: adding a department later does not change it. */
    await call(c).post('/people/structure/departments', { name: 'Stores' }).expect(201);
    expect((await call(c).get('/people/setup').expect(200)).body.setup.total).toBe(4);
  });

  it('skipping takes the new step names', async () => {
    const c = await owner();
    await call(c).post('/people/setup', { action: 'skip', step: 'approvers' }).expect(200);
    const res = await call(c).post('/people/setup', { action: 'skip', step: 'nonsense' }).expect(400);
    expect(res.body.error).toMatch(/structure, people, week, leave, approvers, app, documents, payroll/);
  });
});
