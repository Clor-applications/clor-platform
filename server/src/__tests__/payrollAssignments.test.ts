import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * What one person is paid, from a date.
 *
 * The whole point of an assignment being dated rather than edited is that a
 * payroll run for March still finds March's salary however many raises have
 * happened since. So the tests that matter here are about time: that a raise
 * closes the salary before it, that the two never overlap, and that asking
 * "what was this person on, on that day" keeps answering the same thing.
 *
 * The other half is the sensitive data. A bank account number and a PAN are
 * masked by the server, not the screen — a mask applied in the browser is not a
 * mask, because the full value already crossed the network.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;
let structureId = '';
let earlierStructureId = '';

const at = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `assign.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Payroll owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Assign Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

const employees = {
  list: (c: Ctx, q = '') => request(app).get(`/api/orgs/${c.orgId}/payroll/employees${q}`).set(at(c)),
  get: (c: Ctx, id: string) => request(app).get(`/api/orgs/${c.orgId}/payroll/employees/${id}`).set(at(c)),
  create: (c: Ctx, body: Record<string, unknown>) =>
    request(app).post(`/api/orgs/${c.orgId}/payroll/employees`).set(at(c)).send(body),
  update: (c: Ctx, id: string, body: Record<string, unknown>) =>
    request(app).put(`/api/orgs/${c.orgId}/payroll/employees/${id}`).set(at(c)).send(body),
  destroy: (c: Ctx, id: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll/employees/${id}`).set(at(c)),
};

const assignments = {
  list: (c: Ctx, q = '') => request(app).get(`/api/orgs/${c.orgId}/payroll/assignments${q}`).set(at(c)),
  create: (c: Ctx, body: Record<string, unknown>) =>
    request(app).post(`/api/orgs/${c.orgId}/payroll/assignments`).set(at(c)).send(body),
  update: (c: Ctx, id: string, body: Record<string, unknown>) =>
    request(app).put(`/api/orgs/${c.orgId}/payroll/assignments/${id}`).set(at(c)).send(body),
  destroy: (c: Ctx, id: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll/assignments/${id}`).set(at(c)),
  effective: (c: Ctx, employeeId: string, on: string) =>
    request(app).get(`/api/orgs/${c.orgId}/payroll/assignments/effective?employeeId=${employeeId}&on=${on}`).set(at(c)),
};

const newEmployee = (over: Record<string, unknown> = {}) => ({
  name: `Person ${rnd()}`,
  code: `EMP${rnd().toUpperCase()}`,
  dateOfJoining: '2025-01-01',
  status: 'ACTIVE',
  ...over,
});

beforeAll(async () => {
  owner = await makeOwner();

  const comp = await request(app)
    .post(`/api/orgs/${owner.orgId}/payroll/components`)
    .set(at(owner))
    .send({
      name: 'Basic', code: 'BASIC', type: 'EARNING',
      calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC',
    })
    .expect(201);

  const made = await request(app)
    .post(`/api/orgs/${owner.orgId}/payroll/structures`)
    .set(at(owner))
    .send({
      name: `Staff ${rnd()}`,
      frequency: 'MONTHLY',
      effectiveFrom: '2025-01-01',
      status: 'ACTIVE',
      components: [{ componentId: comp.body.component.id, displayOrder: 1 }],
    })
    .expect(201);
  structureId = made.body.structure.id;

  const earlier = await request(app)
    .post(`/api/orgs/${owner.orgId}/payroll/structures`)
    .set(at(owner))
    .send({
      name: `Later start ${rnd()}`,
      frequency: 'MONTHLY',
      effectiveFrom: '2026-06-01',
      status: 'ACTIVE',
      components: [{ componentId: comp.body.component.id, displayOrder: 1 }],
    })
    .expect(201);
  earlierStructureId = earlier.body.structure.id;
});

describe('the people payroll pays', () => {
  it('records one with a payroll profile', async () => {
    const made = await employees
      .create(owner, {
        ...newEmployee({ name: 'Asha Menon', designation: 'Accountant' }),
        payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', bankAccountNumber: '123456784821', pan: 'ABCDE1234F' },
      })
      .expect(201);
    expect(made.body.employee).toMatchObject({ name: 'Asha Menon', designation: 'Accountant' });
    expect(made.body.employee.payroll.payrollStatus).toBe('IN_PAYROLL');
  });

  it('refuses a second employee with the same code', async () => {
    const code = `DUP${rnd().toUpperCase()}`;
    await employees.create(owner, newEmployee({ code })).expect(201);
    await employees.create(owner, newEmployee({ code })).expect(409);
  });

  it('refuses somebody who left before they joined', async () => {
    const bad = await employees.create(owner, newEmployee({ dateOfJoining: '2026-01-01', dateOfLeaving: '2025-01-01' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/before they joined/i);
  });

  it('finds people by name or code', async () => {
    await employees.create(owner, newEmployee({ name: 'Findable Person', code: `FIND${rnd().toUpperCase()}` })).expect(201);
    const found = await employees.list(owner, '?q=Findable').expect(200);
    expect(found.body.employees.some((e: any) => e.name === 'Findable Person')).toBe(true);
  });
});

describe('a bank account number and a PAN', () => {
  let employeeId = '';

  beforeAll(async () => {
    const made = await employees
      .create(owner, {
        ...newEmployee({ name: 'Sensitive Person' }),
        payroll: { taxRegime: 'NEW', bankAccountNumber: '998877665544', pan: 'ZYXWV9876A' },
      })
      .expect(201);
    employeeId = made.body.employee.id;
  });

  it('comes back in full to an owner, who holds the level', async () => {
    /* The account this test runs as is the organisation's owner, and an admin
       role carries every field level — so the unmasked path is the one under
       test here. */
    const got = await employees.get(owner, employeeId).expect(200);
    expect(got.body.sensitiveVisible).toBe(true);
    expect(got.body.employee.payroll.bankAccountNumber).toBe('998877665544');
    expect(got.body.employee.payroll.pan).toBe('ZYXWV9876A');
  });

  it('is stored as typed, so a mask is never what is saved', async () => {
    const stored = await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId: owner.orgId, employeeId } });
    expect(stored?.bankAccountNumber).toBe('998877665544');
    expect(stored?.pan).toBe('ZYXWV9876A');
  });

  it('survives an edit that does not mention it', async () => {
    /* The form sends the whole profile back. A caller who could not see the
       number must not blank it by saving — and one who could must not lose it
       either. */
    await employees
      .update(owner, employeeId, {
        ...newEmployee({ name: 'Sensitive Person renamed' }),
        payroll: { taxRegime: 'OLD', bankAccountNumber: '998877665544', pan: 'ZYXWV9876A' },
      })
      .expect(200);
    const stored = await payrollPrisma.employeePayrollProfile.findFirst({ where: { orgId: owner.orgId, employeeId } });
    expect(stored?.bankAccountNumber).toBe('998877665544');
    expect(stored?.taxRegime).toBe('OLD');
  });
});

describe('putting somebody on a salary', () => {
  let employeeId = '';

  beforeAll(async () => {
    const made = await employees.create(owner, newEmployee({ name: 'Paid Person' })).expect(201);
    employeeId = made.body.employee.id;
  });

  it('records the salary and works out the per-period figure', async () => {
    const made = await assignments
      .create(owner, { employeeId, structureId, effectiveFrom: '2025-04-01', annualCtc: 1_200_000 })
      .expect(201);
    expect(made.body.assignment.monthlyCtc).toBe(100000);
    expect(made.body.assignment.status).toBe('ACTIVE');
  });

  it('refuses a salary starting before the person joined', async () => {
    const other = await employees.create(owner, newEmployee({ dateOfJoining: '2026-01-01' })).expect(201);
    const bad = await assignments.create(owner, {
      employeeId: other.body.employee.id,
      structureId,
      effectiveFrom: '2025-06-01',
      annualCtc: 600000,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/joined on/i);
  });

  it('refuses a salary starting before its structure exists', async () => {
    const other = await employees.create(owner, newEmployee()).expect(201);
    const bad = await assignments.create(owner, {
      employeeId: other.body.employee.id,
      structureId: earlierStructureId,
      effectiveFrom: '2026-01-01',
      annualCtc: 600000,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/only takes effect/i);
  });

  it('refuses two salaries starting on the same day', async () => {
    const clash = await assignments.create(owner, {
      employeeId,
      structureId,
      effectiveFrom: '2025-04-01',
      annualCtc: 1_500_000,
    });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('ASSIGNMENT_EXISTS');
  });
});

describe('a raise', () => {
  let employeeId = '';
  let first = '';
  let second = '';

  beforeAll(async () => {
    const made = await employees.create(owner, newEmployee({ name: 'Raised Person' })).expect(201);
    employeeId = made.body.employee.id;
    first = (
      await assignments.create(owner, { employeeId, structureId, effectiveFrom: '2025-04-01', annualCtc: 800_000 }).expect(201)
    ).body.assignment.id;
    second = (
      await assignments.create(owner, { employeeId, structureId, effectiveFrom: '2026-04-01', annualCtc: 1_000_000 }).expect(201)
    ).body.assignment.id;
  });

  it('writes a new salary and does not touch the old figure', async () => {
    const rows = (await assignments.list(owner, `?employeeId=${employeeId}`).expect(200)).body.assignments;
    const older = rows.find((a: any) => a.id === first);
    expect(older.annualCtc).toBe(800000);
    expect(rows.find((a: any) => a.id === second).annualCtc).toBe(1000000);
  });

  it('closes the previous salary the day before the new one starts', async () => {
    /* Two open salaries would be two salaries for the same day, and the run
       would take whichever it read first. */
    const rows = (await assignments.list(owner, `?employeeId=${employeeId}`).expect(200)).body.assignments;
    const older = rows.find((a: any) => a.id === first);
    expect(older.effectiveTo).toBe('2026-03-31');
    expect(older.status).toBe('SUPERSEDED');
  });

  it('still answers the old salary for a day inside the old period', async () => {
    /* The property the whole design exists for. */
    const before = await assignments.effective(owner, employeeId, '2025-09-30').expect(200);
    expect(before.body.assignment.annualCtc).toBe(800000);

    const after = await assignments.effective(owner, employeeId, '2026-09-30').expect(200);
    expect(after.body.assignment.annualCtc).toBe(1000000);
  });

  it('answers the boundary days the way the dates read', async () => {
    const lastOld = await assignments.effective(owner, employeeId, '2026-03-31').expect(200);
    expect(lastOld.body.assignment.annualCtc).toBe(800000);

    const firstNew = await assignments.effective(owner, employeeId, '2026-04-01').expect(200);
    expect(firstNew.body.assignment.annualCtc).toBe(1000000);
  });

  it('answers nothing for a day before anybody was paid', async () => {
    const none = await assignments.effective(owner, employeeId, '2024-01-01').expect(200);
    expect(none.body.assignment).toBeNull();
  });

  it('reopens the earlier salary if the raise is deleted', async () => {
    const made = await employees.create(owner, newEmployee({ name: 'Undo Person' })).expect(201);
    const id = made.body.employee.id;
    await assignments.create(owner, { employeeId: id, structureId, effectiveFrom: '2025-04-01', annualCtc: 500_000 }).expect(201);
    const raise = await assignments
      .create(owner, { employeeId: id, structureId, effectiveFrom: '2026-04-01', annualCtc: 700_000 })
      .expect(201);

    await assignments.destroy(owner, raise.body.assignment.id).expect(200);

    /* Without reopening, the person would have no salary at all on a day they
       were employed. */
    const now = await assignments.effective(owner, id, '2026-09-30').expect(200);
    expect(now.body.assignment.annualCtc).toBe(500000);
    expect(now.body.assignment.effectiveTo).toBeNull();
  });
});

describe('a salary somebody has been paid on', () => {
  let employeeId = '';
  let assignmentId = '';

  beforeAll(async () => {
    const made = await employees.create(owner, newEmployee({ name: 'Already Paid' })).expect(201);
    employeeId = made.body.employee.id;
    assignmentId = (
      await assignments.create(owner, { employeeId, structureId, effectiveFrom: '2025-04-01', annualCtc: 900_000 }).expect(201)
    ).body.assignment.id;

    const run = await payrollPrisma.payrollRun.create({
      data: {
        accountId: 'acct-test', orgId: owner.orgId, number: `RUN-${rnd()}`,
        periodId: `period-${rnd()}`, payrollDate: '2025-04-30', createdByUserId: 'user-test',
      },
    });
    await payrollPrisma.salarySlip.create({
      data: {
        accountId: 'acct-test', orgId: owner.orgId, number: `SLIP-${rnd()}`,
        runId: run.id, employeeId, periodId: run.periodId, payrollDate: '2025-04-30',
        assignmentSnapshotJson: JSON.stringify({ assignmentId, annualCtc: 900000 }),
        createdByUserId: 'user-test',
      },
    });
  });

  it('can no longer be edited', async () => {
    const refused = await assignments.update(owner, assignmentId, {
      employeeId,
      structureId,
      effectiveFrom: '2025-04-01',
      annualCtc: 1_100_000,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ASSIGNMENT_PAID');
  });

  it('cannot be deleted', async () => {
    const refused = await assignments.destroy(owner, assignmentId);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ASSIGNMENT_PAID');
  });

  it('keeps the employee record too', async () => {
    const refused = await employees.destroy(owner, employeeId);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('EMPLOYEE_IN_USE');
  });
});

describe('a salary nobody has been paid on', () => {
  it('can still be corrected the same afternoon', async () => {
    const made = await employees.create(owner, newEmployee({ name: 'Typo Person' })).expect(201);
    const id = made.body.employee.id;
    const a = await assignments
      .create(owner, { employeeId: id, structureId, effectiveFrom: '2025-04-01', annualCtc: 100_000 })
      .expect(201);

    const fixed = await assignments
      .update(owner, a.body.assignment.id, { employeeId: id, structureId, effectiveFrom: '2025-04-01', annualCtc: 1_000_000 })
      .expect(200);
    expect(fixed.body.assignment.annualCtc).toBe(1000000);
    expect(fixed.body.assignment.monthlyCtc).toBe(83333.33);
  });

  it('cannot be moved to another person', async () => {
    const a = await employees.create(owner, newEmployee()).expect(201);
    const b = await employees.create(owner, newEmployee()).expect(201);
    const made = await assignments
      .create(owner, { employeeId: a.body.employee.id, structureId, effectiveFrom: '2025-04-01', annualCtc: 600_000 })
      .expect(201);

    const moved = await assignments.update(owner, made.body.assignment.id, {
      employeeId: b.body.employee.id,
      structureId,
      effectiveFrom: '2025-04-01',
      annualCtc: 600_000,
    });
    expect(moved.status).toBe(400);
    expect(moved.body.error).toMatch(/another person/i);
  });
});

describe('the boundary', () => {
  it('shows one organisation nothing of another’s people', async () => {
    const other = await makeOwner();
    const theirs = await employees.list(other).expect(200);
    expect(theirs.body.employees).toHaveLength(0);
  });
});
