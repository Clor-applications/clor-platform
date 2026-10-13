import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Salary components, and the boundary they live behind.
 *
 * Two things are being held here. The first is the ordinary one: the rules a
 * component has to satisfy, and the fact that one already used on a payslip
 * stops being free to change its identity.
 *
 * The second is the architecture. Payroll keeps its own database — salaries,
 * bank accounts and PANs are not in the accounting file — and the test for
 * that is not a comment, it is a query: the accounting client is asked for the
 * table and must not find it.
 */

const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;

const at = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `payroll.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Payroll owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Payroll Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

/** Payroll is off by default, and an off module answers nothing. */
const enablePayroll = (c: Ctx) =>
  request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true } });

const list = (c: Ctx) => request(app).get(`/api/orgs/${c.orgId}/payroll/components`).set(at(c));
const create = (c: Ctx, body: Record<string, unknown>) =>
  request(app).post(`/api/orgs/${c.orgId}/payroll/components`).set(at(c)).send(body);
const update = (c: Ctx, id: string, body: Record<string, unknown>) =>
  request(app).put(`/api/orgs/${c.orgId}/payroll/components/${id}`).set(at(c)).send(body);
const destroy = (c: Ctx, id: string) =>
  request(app).delete(`/api/orgs/${c.orgId}/payroll/components/${id}`).set(at(c));

const EARNING = {
  name: 'Basic',
  code: 'BASIC',
  type: 'EARNING',
  calculationMethod: 'PERCENTAGE',
  percentage: 50,
  calculationBase: 'CTC',
};

beforeAll(async () => {
  owner = await makeOwner();
});

describe('the boundary between payroll and the books', () => {
  it('keeps salary data out of the accounting database entirely', async () => {
    /*
     * The strongest guarantee that a sales report cannot leak a salary is that
     * the join which would leak it cannot be written. This asks the accounting
     * client for the table and expects to be told there is no such thing.
     */
    await expect(prisma.$queryRawUnsafe('SELECT 1 FROM "SalaryComponent" LIMIT 1')).rejects.toThrow();
    await expect(prisma.$queryRawUnsafe('SELECT 1 FROM "SalarySlip" LIMIT 1')).rejects.toThrow();
    await expect(prisma.$queryRawUnsafe('SELECT 1 FROM "EmployeePayrollProfile" LIMIT 1')).rejects.toThrow();
  });

  it('holds them in the payroll database, which answers for the same tables', async () => {
    await expect(payrollPrisma.salaryComponent.count()).resolves.toBeGreaterThanOrEqual(0);
    await expect(payrollPrisma.salarySlip.count()).resolves.toBeGreaterThanOrEqual(0);
  });

  it('keeps the person in the people database, not in payroll', async () => {
    /* Five modules will need the same person — payroll, attendance,
       timesheets, leave. One record, owned by none of them, so no two can
       disagree about a name or a joining date. */
    await expect(peoplePrisma.employee.count()).resolves.toBeGreaterThanOrEqual(0);
    await expect(payrollPrisma.$queryRawUnsafe('SELECT 1 FROM "Employee" LIMIT 1')).rejects.toThrow();
    await expect(prisma.$queryRawUnsafe('SELECT 1 FROM "Employee" LIMIT 1')).rejects.toThrow();
  });

  it('keeps what only payroll needs in payroll', async () => {
    /* A bank account and a PAN are payroll's, not a staff directory's. */
    await expect(payrollPrisma.employeePayrollProfile.count()).resolves.toBeGreaterThanOrEqual(0);
    await expect(peoplePrisma.$queryRawUnsafe('SELECT 1 FROM "EmployeePayrollProfile" LIMIT 1')).rejects.toThrow();
  });

  it('still keeps one ledger — payroll adds no journal table of its own', async () => {
    /* Payroll posts into Neev's books through the accounting service. It must
       not have grown a second set of them. */
    await expect(prisma.$queryRawUnsafe('SELECT 1 FROM "JournalEntry" LIMIT 1')).resolves.toBeDefined();
    await expect(payrollPrisma.$queryRawUnsafe('SELECT 1 FROM "JournalEntry" LIMIT 1')).rejects.toThrow();
  });
});

describe('a module that is switched off', () => {
  it('answers nothing until the organisation turns payroll on', async () => {
    const fresh = await makeOwner();
    const refused = await list(fresh).expect(403);
    expect(refused.body.code).toBe('PAYROLL_DISABLED');
    await create(fresh, EARNING).expect(403);
  });
});

describe('what a component has to satisfy', () => {
  beforeAll(async () => {
    await enablePayroll(owner).expect(200);
  });

  it('records an earning and gives it back', async () => {
    const made = await create(owner, EARNING).expect(201);
    expect(made.body.component).toMatchObject({ code: 'BASIC', type: 'EARNING', percentage: 50 });

    const rows = await list(owner).expect(200);
    expect(rows.body.components.map((c: any) => c.code)).toContain('BASIC');
  });

  it('uppercases the code, because a formula refers to it', async () => {
    const made = await create(owner, { ...EARNING, name: 'Conveyance', code: 'conveyance' }).expect(201);
    expect(made.body.component.code).toBe('CONVEYANCE');
  });

  it('refuses a second component with the same code', async () => {
    const clash = await create(owner, { ...EARNING, name: 'Basic again' }).expect(409);
    expect(clash.body.error).toContain('BASIC');
  });

  it('refuses a percentage with nothing to be a percentage of', async () => {
    const bad = await create(owner, { name: 'Bad', code: `BAD${rnd()}`, type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 10 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/percentage of/i);
  });

  it('refuses a formula it cannot read, before it is ever run', async () => {
    /* The engine must never meet a bad expression in the middle of a run of
       six hundred people. */
    const bad = await create(owner, {
      name: 'Hack',
      code: `HACK${rnd()}`,
      type: 'EARNING',
      calculationMethod: 'FORMULA',
      formula: 'process.exit(1)',
    });
    expect(bad.status).toBe(400);
  });

  it('refuses an employer contribution that claims to be part of net pay', async () => {
    const bad = await create(owner, {
      name: 'Wrong',
      code: `WRONG${rnd()}`,
      type: 'EMPLOYER_CONTRIBUTION',
      calculationMethod: 'FIXED',
      amount: 100,
      includeInNetPay: true,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/net pay/i);
  });

  it('refuses a scheme on something that is not statutory', async () => {
    const bad = await create(owner, {
      name: 'Odd',
      code: `ODD${rnd()}`,
      type: 'DEDUCTION',
      calculationMethod: 'FIXED',
      amount: 1,
      statutoryScheme: 'PF',
    });
    expect(bad.status).toBe(400);
  });
});

describe('a component that has been used', () => {
  let componentId = '';

  beforeAll(async () => {
    const made = await create(owner, {
      name: 'Site Allowance',
      code: `SITE${rnd()}`,
      type: 'EARNING',
      calculationMethod: 'FIXED',
      amount: 5000,
    }).expect(201);
    componentId = made.body.component.id;
  });

  it('can be renamed freely while nothing has used it', async () => {
    const saved = await update(owner, componentId, {
      name: 'Site Allowance (North)',
      code: (await list(owner)).body.components.find((c: any) => c.id === componentId).code,
      type: 'EARNING',
      calculationMethod: 'FIXED',
      amount: 5000,
    }).expect(200);
    expect(saved.body.component.name).toBe('Site Allowance (North)');
  });

  it('keeps its code and type once a payslip carries it', async () => {
    /*
     * The payslip stores its own snapshot, so history does not move. What the
     * code protects is the register that groups the same component across
     * twelve months, and what the type protects is which side of the payslip
     * it was on.
     */
    const current = (await list(owner)).body.components.find((c: any) => c.id === componentId);
    /* A slip belongs to a run — that foreign key is real, inside the payroll
       database — so the run comes first. */
    const run = await payrollPrisma.payrollRun.create({
      data: {
        accountId: 'acct-test',
        orgId: owner.orgId,
        number: `RUN-${rnd()}`,
        periodId: `period-${rnd()}`,
        payrollDate: '2026-09-30',
        createdByUserId: 'user-test',
      },
    });
    const slip = await payrollPrisma.salarySlip.create({
      data: {
        accountId: 'acct-test',
        orgId: owner.orgId,
        number: `SLIP-${rnd()}`,
        runId: run.id,
        employeeId: `emp-${rnd()}`,
        periodId: run.periodId,
        payrollDate: '2026-09-30',
        createdByUserId: 'user-test',
      },
    });
    await payrollPrisma.salarySlipLine.create({
      data: {
        accountId: 'acct-test',
        orgId: owner.orgId,
        slipId: slip.id,
        componentId,
        componentCode: current.code,
        componentName: current.name,
        type: 'EARNING',
        amount: 5000,
      },
    });

    const renamed = await update(owner, componentId, { ...current, name: 'Site Allowance (renamed)' }).expect(200);
    expect(renamed.body.component.name).toBe('Site Allowance (renamed)');

    const retyped = await update(owner, componentId, { ...current, type: 'DEDUCTION' });
    expect(retyped.status).toBe(409);
    expect(retyped.body.code).toBe('PAYROLL_COMPONENT_IN_USE');

    const recoded = await update(owner, componentId, { ...current, code: `MOVED${rnd()}` });
    expect(recoded.status).toBe(409);
  });

  it('cannot be deleted out from under a payslip', async () => {
    const refused = await destroy(owner, componentId);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PAYROLL_COMPONENT_IN_USE');
  });
});

describe('one organisation cannot see another’s salary structure', () => {
  it('lists only its own components', async () => {
    const other = await makeOwner();
    await enablePayroll(other).expect(200);
    await create(other, { ...EARNING, name: 'Their Basic' }).expect(201);

    const ours = await list(owner).expect(200);
    const theirs = await list(other).expect(200);

    const ourIds = new Set(ours.body.components.map((c: any) => c.id));
    for (const c of theirs.body.components) expect(ourIds.has(c.id)).toBe(false);
    expect(theirs.body.components).toHaveLength(1);
  });
});

describe('a component read back and saved unchanged', () => {
  it('is accepted, thresholds and all', async () => {
    /*
     * The round trip every screen makes: read the row, edit one field, send
     * the whole thing back. It was a 400 — the route returned '' for a
     * threshold nobody had set and then refused '' on the way in, so saving a
     * name failed on a field the person had never seen.
     */
    const made = await create(owner, { ...EARNING, name: 'Round trip', code: `RT${rnd().toUpperCase()}` }).expect(201);
    const read = (await list(owner)).body.components.find((c: any) => c.id === made.body.component.id);

    expect(read.thresholdOperator).toBe('');
    const again = await update(owner, read.id, { ...read, name: 'Round trip, renamed' }).expect(200);
    expect(again.body.component.name).toBe('Round trip, renamed');
  });

  it('keeps a threshold it was given', async () => {
    const made = await create(owner, {
      ...EARNING,
      name: 'Over 25k only',
      code: `TH${rnd().toUpperCase()}`,
      thresholdBase: 'BASIC',
      thresholdOperator: 'GT',
      thresholdAmount: 25000,
    }).expect(201);
    expect(made.body.component.thresholdOperator).toBe('GT');
    expect(made.body.component.thresholdAmount).toBe(25000);
  });

  it('refuses half a threshold', async () => {
    /* A base with no comparison never fires, silently. */
    const refused = await create(owner, {
      ...EARNING,
      name: 'Half a rule',
      code: `HR${rnd().toUpperCase()}`,
      thresholdBase: 'BASIC',
      thresholdOperator: '',
    });
    expect(refused.status).toBe(400);
  });

  it('refuses a maximum of nothing', async () => {
    const refused = await create(owner, {
      ...EARNING,
      name: 'Zero cap',
      code: `ZC${rnd().toUpperCase()}`,
      hasMaxLimit: true,
      maximumAmount: 0,
    });
    expect(refused.status).toBe(400);
  });
});
