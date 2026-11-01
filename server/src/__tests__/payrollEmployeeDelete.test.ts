import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * A-39: deleting an employee checked only payslips and salary assignments,
 * then deleted them — loans, adjustments, revisions, tax declarations, bank
 * changes and the rest were left pointing at nobody, and the check and the
 * delete were separate steps, so an assignment made in between survived.
 */
const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function company(): Promise<Ctx> {
  const email = `ped.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'PED owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `PED Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true } }).expect(200);
  return c;
}

const employee = async (c: Ctx) =>
  (await request(app).post(`/api/orgs/${c.orgId}/payroll/employees`).set(at(c)).send({ name: `Person ${rnd()}`, code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE' }).expect(201)).body.employee.id as string;

const del = (c: Ctx, id: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll/employees/${id}`).set(at(c));
const rows = (orgId: string, employeeId: string) =>
  outsideTenant('test: count payroll rows', async () => ({
    loans: await payrollPrisma.payrollLoan.count({ where: { orgId, employeeId } }),
    statutory: await payrollPrisma.employeeStatutoryConfig.count({ where: { orgId, employeeId } }),
    profile: await payrollPrisma.employeePayrollProfile.count({ where: { orgId, employeeId } }),
  }));

describe('deleting an employee', () => {
  it('is refused while they have any payroll history, not only payslips', async () => {
    const c = await company();
    const id = await employee(c);
    await outsideTenant('test: a loan', () =>
      payrollPrisma.payrollLoan.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `LN-${rnd()}`, employeeId: id, startDate: '2026-02-01', createdByUserId: c.userId } as any })
    );
    const res = await del(c, id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMPLOYEE_IN_USE');
    expect(res.body.error).toMatch(/loans/);
    expect(await outsideTenant('test', () => peoplePrisma.employee.count({ where: { id } }))).toBe(1);
  });

  it('takes their payroll setup with them, leaving nothing behind', async () => {
    const c = await company();
    const id = await employee(c);
    await outsideTenant('test: a statutory scheme', () =>
      payrollPrisma.employeeStatutoryConfig.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: id, schemeCode: 'PF', createdByUserId: c.userId } as any })
    );
    await del(c, id).expect(200);
    expect(await rows(c.orgId, id)).toEqual({ loans: 0, statutory: 0, profile: 0 });
  });

  it('never leaves a salary made for them in the same moment pointing at nobody', async () => {
    const c = await company();
    const p = (path: string, b: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(b as any);
    const basic = (await p('/components', { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }).expect(201)).body.component;
    const structure = (await p('/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: [{ componentId: basic.id, displayOrder: 1 }] }).expect(201)).body.structure;
    let raced = 0;
    for (let i = 0; i < 6; i += 1) {
      const id = await employee(c);
      const [made, gone] = await Promise.all([
        p('/assignments', { employeeId: id, structureId: structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 }),
        del(c, id),
      ]);
      const stillThere = await outsideTenant('test', () => peoplePrisma.employee.count({ where: { id } }));
      const assignments = await outsideTenant('test', () => payrollPrisma.salaryAssignment.count({ where: { orgId: c.orgId, employeeId: id } }));
      /* Exactly one wins: the salary (and the delete is refused), or the delete (and no salary exists). */
      if (stillThere) {
        expect(made.status).toBe(201);
        expect(gone.status).toBe(409);
        expect(assignments).toBe(1);
      } else {
        expect(gone.status).toBe(200);
        expect(assignments).toBe(0);
        expect(made.status).not.toBe(201);
      }
      if (made.status === 201 || gone.status === 200) raced += 1;
    }
    expect(raced).toBe(6);
  }, 90_000);
});

describe('removing someone in People', () => {
  it('is refused while they have payroll history, even with no payroll profile', async () => {
    const c = await company();
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true } }).expect(200);
    const emp = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Ravi', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    await outsideTenant('test: a loan', () =>
      payrollPrisma.payrollLoan.create({ data: { accountId: c.accountId, orgId: c.orgId, number: `LN-${rnd()}`, employeeId: emp.id, startDate: '2026-02-01', createdByUserId: c.userId } as any })
    );
    const res = await request(app).delete(`/api/orgs/${c.orgId}/people/employees/${emp.id}`).set(at(c));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMPLOYEE_IN_PAYROLL');
  });
});
