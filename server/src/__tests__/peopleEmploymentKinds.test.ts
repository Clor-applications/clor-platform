import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Employment type, hours and probation are three different things
 * (Workforce, 27 Oct 2026): a type the company names maps to a kind CLOR
 * acts on; hours are full-time or part-time; probation is a period from the
 * dates. A consultant is paid on an invoice, so not being in payroll is right.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { runEndDateReminders } = await import('../services/people/documentReminders.js');
const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
let c: Ctx;
const api = {
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
};
beforeAll(async () => {
  const signup = await request(app).post('/api/auth/signup').send({ email: `ek.${Date.now()}.${rnd()}@example.com`, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Kinds Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, payroll: true, attendance: true } }).expect(200);
}, 60_000);

describe('employment type, hours and probation', () => {
  it('a new company starts with the standard types, each with its kind; reading again adds nothing', async () => {
    const first = (await api.get('/structure/employee-types').expect(200)).body.items.map((t: any) => [t.name, t.category]);
    expect(first).toEqual(expect.arrayContaining([['Permanent', 'PERMANENT'], ['Fixed-term contract', 'FIXED_TERM'], ['Trainee', 'TRAINEE'], ['Intern', 'INTERN'], ['Consultant', 'CONSULTANT']]));
    expect((await api.get('/structure/employee-types').expect(200)).body.items).toHaveLength(first.length);
    /* A type of the company's own, with a kind; an unknown kind is refused. */
    const own = (await api.post('/structure/employee-types', { name: 'Security agency staff', category: 'AGENCY' }).expect(201)).body.item;
    expect(own.category).toBe('AGENCY');
    await api.post('/structure/employee-types', { name: 'Odd', category: 'SOMETHING' }).expect(400);
  });

  it('hours are saved, logged in words and filterable; part-time is not counted as full-time', async () => {
    const pt = (await api.post('/employees', { name: 'Part Timer', code: `H-${rnd()}`, hours: 'PART_TIME' }).expect(201)).body.employee;
    const ft = (await api.post('/employees', { name: 'Full Timer', code: `H-${rnd()}` }).expect(201)).body.employee;
    expect(pt.hours).toBe('PART_TIME');
    await api.post('/employees', { name: 'Bad Hours', hours: 'SOMETIMES' }).expect(400);
    const part = (await api.get('/employees?hours=PART_TIME&status=ALL').expect(200)).body.employees.map((e: any) => e.id);
    const full = (await api.get('/employees?hours=FULL_TIME&status=ALL').expect(200)).body.employees.map((e: any) => e.id);
    expect(part).toContain(pt.id);
    expect(part).not.toContain(ft.id);
    expect(full).toContain(ft.id);
    expect(full).not.toContain(pt.id);
    await api.put(`/employees/${ft.id}`, { hours: 'PART_TIME' }).expect(200);
    const journey = (await api.get(`/employees/${ft.id}/journey`).expect(200)).body.entries;
    expect(JSON.stringify(journey)).toContain('Part-time');
  });

  it('On probation lists everyone not yet confirmed, a passed date included; a confirmed person is not', async () => {
    const on = (await api.post('/employees', { name: 'On Probation', code: `P-${rnd()}`, dateOfJoining: '2026-01-01', probationEndDate: '2099-01-01' }).expect(201)).body.employee;
    const over = (await api.post('/employees', { name: 'Probation Over', code: `P-${rnd()}`, dateOfJoining: '2025-01-01', probationEndDate: '2025-07-01' }).expect(201)).body.employee;
    const done = (await api.post('/employees', { name: 'Confirmed One', code: `P-${rnd()}`, dateOfJoining: '2025-01-01', probationEndDate: '2025-07-01' }).expect(201)).body.employee;
    await api.post(`/employees/${done.id}/probation/decide`, { outcome: 'CONFIRM' }).expect(200);
    const ids = (await api.get('/employees?probation=on&status=ALL').expect(200)).body.employees.map((e: any) => e.id);
    expect(ids).toEqual(expect.arrayContaining([on.id, over.id]));
    expect(ids).not.toContain(done.id);
    /* The passed one is on Data Health until someone decides. */
    const health = (await api.get('/data-health').expect(200)).body.checks;
    expect(health.find((c: any) => c.id === 'probation-due').people.map((p: any) => p.id)).toContain(over.id);
  });

  it('a contract that ended with the person still working is flagged, filtered and on the home list', async () => {
    const ended = (await api.post('/employees', { name: 'Ended Contract', code: `CE-${rnd()}`, dateOfJoining: '2025-01-01', contractEndDate: '2026-01-31' }).expect(201)).body.employee;
    const far = (await api.post('/employees', { name: 'Long Contract', code: `CE-${rnd()}`, dateOfJoining: '2025-01-01', contractEndDate: '2099-01-31' }).expect(201)).body.employee;
    const ids = (await api.get('/employees?contract=ending').expect(200)).body.employees.map((e: any) => e.id);
    expect(ids).toContain(ended.id);
    expect(ids).not.toContain(far.id);
    const health = (await api.get('/data-health').expect(200)).body.checks;
    expect(health.find((c: any) => c.id === 'contract-ended').people.map((p: any) => p.id)).toContain(ended.id);
    const todos = (await api.get('/home').expect(200)).body.todos;
    expect(todos.find((t: any) => t.key === 'contracts')).toMatchObject({ title: 'Contracts ended', tone: 'urgent', params: { contract: 'ending' } });
  });

  it('the end-date job tells HR once per stage and puts one decision task on the plan', async () => {
    const day = (n: number) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
    const e = (await api.post('/employees', { name: `Ending Soon ${rnd()}`, code: `ES-${rnd()}`, dateOfJoining: '2025-01-01', contractEndDate: day(20) }).expect(201)).body.employee;
    await runEndDateReminders();
    await runEndDateReminders();
    const bell = await platformPrisma.notification.count({ where: { orgId: c.orgId, kind: 'people.contract_ending', title: { contains: e.name } } });
    expect(bell).toBeGreaterThanOrEqual(1);
    const once = bell;
    await runEndDateReminders();
    expect(await platformPrisma.notification.count({ where: { orgId: c.orgId, kind: 'people.contract_ending', title: { contains: e.name } } })).toBe(once);
    const tasks = await runInTenant(c.orgId, () => peoplePrisma.checklistTask.findMany({ where: { orgId: c.orgId, employeeId: e.id, kind: 'RENEWAL' } }));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toContain('Renew or end');
  });

  it('a rehire starts with new terms; last stint\'s probation and contract dates do not carry over', async () => {
    const e = (await api.post('/employees', { name: 'Comes Back', code: `RH-${rnd()}`, dateOfJoining: '2024-01-01', probationEndDate: '2024-07-01', contractEndDate: '2024-12-31' }).expect(201)).body.employee;
    await api.post(`/employees/${e.id}/resign`, { lastDay: '2025-01-15', leavingType: 'CONTRACT_ENDED' }).expect(200);
    const back = (await api.post(`/employees/${e.id}/rehire`, { rejoinDate: '2026-02-01', probationEndDate: '2026-08-01' }).expect(200)).body.employee;
    expect(String(back.probationEndDate).slice(0, 10)).toBe('2026-08-01');
    expect(back.contractEndDate).toBeNull();
    expect(back.confirmedOn).toBeNull();
    await api.post(`/employees/${e.id}/rehire`, { rejoinDate: '2026-02-01' }).expect(409);
  });

  it('a consultant is not flagged as missing from payroll; a permanent employee is', async () => {
    const types = (await api.get('/structure/employee-types').expect(200)).body.items;
    const consultantType = types.find((t: any) => t.category === 'CONSULTANT');
    const permanentType = types.find((t: any) => t.category === 'PERMANENT');
    const consultant = (await api.post('/employees', { name: 'Advisor', code: `C-${rnd()}`, dateOfJoining: '2026-01-01', employeeTypeId: consultantType.id }).expect(201)).body.employee;
    const staff = (await api.post('/employees', { name: 'Staffer', code: `S-${rnd()}`, dateOfJoining: '2026-01-01', employeeTypeId: permanentType.id }).expect(201)).body.employee;
    const checkIds = async (id: string) => (await api.get(`/employees/${id}/readiness`).expect(200)).body.checks.map((x: any) => x.id);
    expect(await checkIds(consultant.id)).not.toContain('not-in-payroll');
    expect(await checkIds(staff.id)).toContain('not-in-payroll');
    void runInTenant; void peoplePrisma;
  });

  it('a type made without a kind, by hand or by an import, takes the kind its name means', async () => {
    expect((await api.post('/structure/employee-types', { name: `Summer intern ${rnd()}` }).expect(201)).body.item.category).toBe('INTERN');
    expect((await api.post('/structure/employee-types', { name: `Retainer ${rnd()}` }).expect(201)).body.item.category).toBe('CONSULTANT');
    const typeName = `Apprentice ${rnd()}`;
    await api.post('/employees/import', { rows: [{ name: 'Import Apprentice', code: `IA-${rnd()}`, employeeType: typeName }] }).expect(200);
    const made = (await api.get('/structure/employee-types').expect(200)).body.items.find((t: any) => t.name === typeName);
    expect(made.category).toBe('TRAINEE');
  });

  it('import reads hours the way people write them and refuses anything else; end dates come in too', async () => {
    const code = `IH-${rnd()}`;
    const r = (await api.post('/employees/import', { rows: [
      { name: 'Import Part', code, hours: 'part time', contractEndDate: '2027-03-31', probationEndDate: '2026-12-31' },
      { name: 'Import Bad', code: `IB-${rnd()}`, hours: 'weekends' },
    ] }).expect(200)).body;
    const [ok, bad] = r.results;
    expect(ok.ok).toBe(true);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('Full-time or Part-time');
    const e = (await api.get(`/employees/${ok.id}`).expect(200)).body.employee;
    expect(e.hours).toBe('PART_TIME');
    expect(String(e.contractEndDate).slice(0, 10)).toBe('2027-03-31');
    expect(String(e.probationEndDate).slice(0, 10)).toBe('2026-12-31');
  });
});
