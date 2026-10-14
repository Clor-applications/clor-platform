import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * People: the staff directory (after Horilla's employee module).
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
  await payrollPrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };

const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(features: Record<string, boolean> = { people: true }): Promise<Ctx> {
  const email = `people.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'HR owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `People Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  if (Object.keys(features).length) {
    await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  }
  return ctx;
}

const api = (c: Ctx) => ({
  get: (path: string) => request(app).get(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
  post: (path: string, body: unknown) => request(app).post(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  put: (path: string, body: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${path}`).set(at(c)).send(body as any),
  del: (path: string) => request(app).delete(`/api/orgs/${c.orgId}/people${path}`).set(at(c)),
});

let owner: Ctx;
beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('the switch', () => {
  it('is refused while People is off', async () => {
    const off = await makeOwner({});
    const res = await api(off).get('/employees').expect(403);
    expect(res.body.code).toBe('PEOPLE_DISABLED');
  });
});

describe('employee files', () => {
  it('creates a person with their department and position, and keeps the display strings in step', async () => {
    const dept = (await api(owner).post('/structure/departments', { name: 'Finance' }).expect(201)).body.item;
    const pos = (await api(owner).post('/structure/job-positions', { name: 'Accountant', departmentId: dept.id }).expect(201)).body.item;
    const created = await api(owner)
      .post('/employees', { firstName: 'Asha', lastName: 'Rao', code: 'E-1', departmentId: dept.id, jobPositionId: pos.id, dateOfBirth: '1990-04-02' })
      .expect(201);
    expect(created.body.employee.name).toBe('Asha Rao');
    expect(created.body.employee.department).toBe('Finance');
    expect(created.body.employee.designation).toBe('Accountant');

    /* Renaming the department renames what the file shows. */
    await api(owner).put(`/structure/departments/${dept.id}`, { name: 'Finance & Accounts' }).expect(200);
    const after = await api(owner).get(`/employees/${created.body.employee.id}`).expect(200);
    expect(after.body.employee.department).toBe('Finance & Accounts');
  });

  it('refuses a department from another organisation', async () => {
    const other = await makeOwner();
    const foreign = (await api(other).post('/structure/departments', { name: 'Elsewhere' }).expect(201)).body.item;
    const res = await api(owner).post('/employees', { name: 'Stray', departmentId: foreign.id }).expect(400);
    expect(res.body.error).toMatch(/not in this organisation/);
  });

  it('finds people by name, code and department, and filters by tag', async () => {
    const tag = (await api(owner).post('/tags', { name: `Remote-${rnd()}` }).expect(201)).body.tag;
    const p = (await api(owner).post('/employees', { name: 'Bhavna Iyer', code: `BI-${rnd()}`, tagIds: [tag.id] }).expect(201)).body.employee;
    expect((await api(owner).get('/employees?q=bhavna').expect(200)).body.employees.map((e: any) => e.id)).toContain(p.id);
    const byTag = (await api(owner).get(`/employees?tagId=${tag.id}`).expect(200)).body;
    expect(byTag.employees.map((e: any) => e.id)).toEqual([p.id]);
    expect(byTag.employees[0].tags[0].name).toBe(tag.name);
  });

  it('refuses a reporting loop', async () => {
    const boss = (await api(owner).post('/employees', { name: 'Boss' }).expect(201)).body.employee;
    const lead = (await api(owner).post('/employees', { name: 'Lead', reportingManagerId: boss.id }).expect(201)).body.employee;
    const res = await api(owner).put(`/employees/${boss.id}`, { reportingManagerId: lead.id }).expect(400);
    expect(res.body.error).toMatch(/loop/);
    await api(owner).put(`/employees/${boss.id}`, { reportingManagerId: boss.id }).expect(400);
    const chart = (await api(owner).get('/org-chart').expect(200)).body.nodes;
    expect(chart.find((n: any) => n.id === lead.id).reportingManagerId).toBe(boss.id);
  });

  it('refuses someone leaving before they joined', async () => {
    await api(owner).post('/employees', { name: 'Back To Front', dateOfJoining: '2026-05-01', dateOfLeaving: '2026-04-01' }).expect(400);
  });
});

describe('removing people and lists', () => {
  it('moves a removed person’s reports up to their own manager', async () => {
    const top = (await api(owner).post('/employees', { name: 'Top' }).expect(201)).body.employee;
    const mid = (await api(owner).post('/employees', { name: 'Mid', reportingManagerId: top.id }).expect(201)).body.employee;
    const low = (await api(owner).post('/employees', { name: 'Low', reportingManagerId: mid.id }).expect(201)).body.employee;
    await api(owner).del(`/employees/${mid.id}`).expect(200);
    expect((await api(owner).get(`/employees/${low.id}`).expect(200)).body.employee.reportingManagerId).toBe(top.id);
  });

  it('will not delete someone payroll knows; they are marked as having left instead', async () => {
    const p = (await api(owner).post('/employees', { name: 'Paid Once' }).expect(201)).body.employee;
    await payrollPrisma.employeePayrollProfile.create({
      data: { accountId: p.accountId, orgId: owner.orgId, employeeId: p.id, createdByUserId: p.createdByUserId },
    });
    const res = await api(owner).del(`/employees/${p.id}`).expect(409);
    expect(res.body.code).toBe('EMPLOYEE_IN_PAYROLL');
  });

  it('will not delete a department somebody is in', async () => {
    const dept = (await api(owner).post('/structure/departments', { name: `Ops-${rnd()}` }).expect(201)).body.item;
    await api(owner).post('/employees', { name: 'Ops Person', departmentId: dept.id }).expect(201);
    await api(owner).del(`/structure/departments/${dept.id}`).expect(409);
    const list = (await api(owner).get('/structure/departments').expect(200)).body.items;
    expect(list.find((d: any) => d.id === dept.id).employeeCount).toBe(1);
  });
});

describe('import, notes and the overview', () => {
  it('imports rows, creating departments it has not seen, and reports each bad row', async () => {
    const res = await api(owner)
      .post('/employees/import', {
        rows: [
          { name: 'Imported One', department: 'Warehouse', jobPosition: 'Picker', dateOfJoining: new Date().toISOString().slice(0, 10) },
          { name: '', department: 'Warehouse' },
          { name: 'Imported Two', department: 'warehouse' },
        ],
      })
      .expect(200);
    expect(res.body.imported).toBe(2);
    expect(res.body.failed).toBe(1);
    const depts = (await api(owner).get('/structure/departments').expect(200)).body.items.filter((d: any) => d.name.toLowerCase() === 'warehouse');
    expect(depts).toHaveLength(1);
    const overview = (await api(owner).get('/overview').expect(200)).body;
    expect(overview.joinedThisMonth.map((j: any) => j.name)).toContain('Imported One');
    expect(overview.byDepartment.find((d: any) => d.name === 'Warehouse').count).toBe(2);
  });

  it('keeps notes on a person’s file, newest first', async () => {
    const p = (await api(owner).post('/employees', { name: 'Noted' }).expect(201)).body.employee;
    await api(owner).post(`/employees/${p.id}/notes`, { body: 'First' }).expect(201);
    await new Promise((r) => setTimeout(r, 5));
    await api(owner).post(`/employees/${p.id}/notes`, { body: 'Second' }).expect(201);
    const notes = (await api(owner).get(`/employees/${p.id}/notes`).expect(200)).body.notes;
    expect(notes.map((n: any) => n.body)).toEqual(['Second', 'First']);
    await api(owner).del(`/notes/${notes[0].id}`).expect(200);
  });
});
