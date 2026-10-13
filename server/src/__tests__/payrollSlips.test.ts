import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Payslips as documents.
 *
 * A payslip is read long after the payroll that produced it, usually by
 * somebody who was not there. So the tests here are about what it remembers:
 * that it serves its own snapshot rather than today's configuration, that the
 * arithmetic on it can be traced, and that the two fields worth stealing are
 * masked — a payslip is the document most likely to be forwarded by email.
 */

const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;
let runId = '';
let slipId = '';
let employeeId = '';

const at = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `slip.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Payroll owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Slip Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

beforeAll(async () => {
  owner = await makeOwner();

  const basic = await api
    .post(owner, '/components', {
      name: 'Basic', code: 'BASIC', type: 'EARNING',
      calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1,
    })
    .expect(201);
  const hra = await api
    .post(owner, '/components', {
      name: 'House Rent Allowance', code: 'HRA', type: 'EARNING',
      calculationMethod: 'FORMULA', formula: 'BASIC * 0.4', displayOrder: 2,
    })
    .expect(201);
  const pt = await api
    .post(owner, '/components', {
      name: 'Professional Tax', code: 'PT', type: 'DEDUCTION',
      calculationMethod: 'FIXED', amount: 200, includeInGross: false, isTaxable: false, displayOrder: 10,
    })
    .expect(201);

  const structure = await api
    .post(owner, '/structures', {
      name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE',
      components: [
        { componentId: basic.body.component.id, displayOrder: 1 },
        { componentId: hra.body.component.id, displayOrder: 2 },
        { componentId: pt.body.component.id, displayOrder: 10 },
      ],
    })
    .expect(201);

  const period = await api
    .post(owner, '/periods', { name: `Sept 2026 ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' })
    .expect(201);

  const person = await api
    .post(owner, '/employees', {
      name: 'Asha Menon',
      code: 'EMP001',
      designation: 'Accountant',
      department: 'Finance',
      dateOfJoining: '2026-01-01',
      status: 'ACTIVE',
      payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', bankAccountNumber: '998877665544', pan: 'ABCDE1234F', bankName: 'HDFC' },
    })
    .expect(201);
  employeeId = person.body.employee.id;

  await api
    .post(owner, '/assignments', {
      employeeId,
      structureId: structure.body.structure.id,
      effectiveFrom: '2026-01-01',
      annualCtc: 1_200_000,
    })
    .expect(201);

  const run = await api.post(owner, '/runs', { periodId: period.body.period.id }).expect(201);
  runId = run.body.run.id;
  await api.post(owner, `/runs/${runId}/validate`).expect(200);
  await api.post(owner, `/runs/${runId}/calculate`).expect(200);

  const slips = await api.get(owner, `/slips?runId=${runId}`).expect(200);
  slipId = slips.body.slips[0].id;
});

describe('the list of payslips', () => {
  it('shows each one with the person and the period it belongs to', async () => {
    const got = await api.get(owner, `/slips?runId=${runId}`).expect(200);
    expect(got.body.slips).toHaveLength(1);
    const s = got.body.slips[0];
    expect(s.employee.name).toBe('Asha Menon');
    expect(s.period.name).toMatch(/Sept 2026/);
    expect(s.netPay).toBe(69800);
  });

  it('still names somebody who has left the staff directory', async () => {
    /*
     * Found in a browser walkthrough: the list read the live directory and
     * showed "Unknown" for anybody removed from it, while the payslip itself
     * had their name in its snapshot all along. A list of payslips nobody can
     * put a name to is a list nobody can reconcile.
     */
    await peoplePrisma.employee.deleteMany({ where: { orgId: owner.orgId, id: employeeId } });

    const got = await api.get(owner, `/slips?runId=${runId}`).expect(200);
    expect(got.body.slips[0].employee.name).toBe('Asha Menon');

    /* Put her back, so the tests after this one still find her. */
    await peoplePrisma.employee.create({
      data: {
        id: employeeId, accountId: (await payrollPrisma.salarySlip.findFirst({ where: { id: slipId } }))!.accountId,
        orgId: owner.orgId, name: 'Asha Menon', code: 'EMP001', status: 'ACTIVE', createdByUserId: 'test',
      },
    });
  });

  it('narrows to one person', async () => {
    const got = await api.get(owner, `/slips?employeeId=${employeeId}`).expect(200);
    expect(got.body.slips.every((s: any) => s.employeeId === employeeId)).toBe(true);
  });
});

describe('one payslip, as a document', () => {
  it('separates what was earned, deducted and contributed', async () => {
    const got = await api.get(owner, `/slips/${slipId}`).expect(200);
    const slip = got.body.slip;
    expect(slip.earnings.map((l: any) => l.code).sort()).toEqual(['BASIC', 'HRA']);
    expect(slip.deductions.map((l: any) => l.code)).toEqual(['PT']);
    /* 50,000 + 20,000 earned, 200 deducted. */
    expect(slip.grossEarnings).toBe(70000);
    expect(slip.totalDeductions).toBe(200);
    expect(slip.netPay).toBe(69800);
  });

  it('carries the days it was worked out over', async () => {
    const slip = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;
    expect(slip.days.periodDays).toBe(30);
    expect(slip.days.payableDays).toBe(30);
  });

  it('carries the CTC it was calculated from', async () => {
    const slip = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;
    expect(slip.ctc.annual).toBe(1200000);
    expect(slip.ctc.monthly).toBe(100000);
  });

  it('names the engine that produced it', async () => {
    const slip = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;
    expect(slip.engineVersion).toBeTruthy();
  });
});

describe('why each figure is what it is', () => {
  it('explains a formula line', async () => {
    /* The most common question payroll receives, answered by the payslip
       rather than by somebody rebuilding the arithmetic. */
    const slip = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;
    const hra = slip.calculation.find((t: any) => t.code === 'HRA');
    expect(hra.formula).toBe('BASIC * 0.4');
    expect(hra.computedAmount).toBe(20000);
  });

  it('explains a percentage line, with the base it used', async () => {
    const slip = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;
    const basic = slip.calculation.find((t: any) => t.code === 'BASIC');
    expect(basic.ruleText).toBe('50% of MONTHLY_CTC');
    expect(basic.baseAmount).toBe(100000);
    expect(basic.computedAmount).toBe(50000);
  });

  it('explains every line on the payslip', async () => {
    const slip = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;
    const paid = [...slip.earnings, ...slip.deductions].map((l: any) => l.code).sort();
    const explained = slip.calculation.map((t: any) => t.code).sort();
    expect(explained).toEqual(paid);
  });
});

describe('what a payslip remembers', () => {
  it('keeps the job title the person held at the time', async () => {
    /* Somebody promoted since should still have last month's payslip showing
       last month's job. */
    await request(app)
      .put(`/api/orgs/${owner.orgId}/payroll/employees/${employeeId}`)
      .set(at(owner))
      .send({ name: 'Asha Menon', code: 'EMP001', designation: 'Finance Manager', department: 'Finance', status: 'ACTIVE' })
      .expect(200);

    const slip = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;
    expect(slip.employee.designation).toBe('Accountant');
  });

  it('does not move when the salary component is changed underneath it', async () => {
    const before = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;

    const comp = await payrollPrisma.salaryComponent.findFirst({ where: { orgId: owner.orgId, code: 'HRA' } });
    await payrollPrisma.salaryComponent.update({ where: { id: comp!.id }, data: { formula: 'BASIC * 0.9' } });

    const after = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;
    expect(after.netPay).toBe(before.netPay);
    expect(after.calculation.find((t: any) => t.code === 'HRA').formula).toBe('BASIC * 0.4');

    await payrollPrisma.salaryComponent.update({ where: { id: comp!.id }, data: { formula: 'BASIC * 0.4' } });
  });
});

describe('the two fields worth stealing', () => {
  it('sends them in full to somebody holding the level', async () => {
    /* This account is the organisation's owner, so the unmasked path is the
       one under test. */
    const slip = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;
    expect(slip.employee.masked).toBe(false);
    expect(slip.employee.pan).toBe('ABCDE1234F');
    expect(slip.employee.bankAccountNumber).toBe('998877665544');
  });

  it('never sends a payslip without the bank the money goes to', async () => {
    const slip = (await api.get(owner, `/slips/${slipId}`).expect(200)).body.slip;
    expect(slip.employee.bankName).toBe('HDFC');
  });
});

describe('what has been earned so far this year', () => {
  it('adds up the payslips rather than storing a figure that can go stale', async () => {
    const got = await api.get(owner, `/slips/${slipId}/year-to-date`).expect(200);
    const ytd = got.body.yearToDate;
    /* September falls in the financial year beginning that April. */
    expect(ytd.financialYearFrom).toBe('2026-04-01');
    expect(ytd.payslips).toBe(1);
    expect(ytd.grossEarnings).toBe(70000);
    expect(ytd.netPay).toBe(69800);
  });
});

describe('the boundary', () => {
  it('shows one organisation nothing of another’s payslips', async () => {
    const other = await makeOwner();
    const theirs = await api.get(other, '/slips').expect(200);
    expect(theirs.body.slips).toHaveLength(0);
  });

  it('keeps payslips out of the accounting database', async () => {
    await expect(prisma.$queryRawUnsafe('SELECT 1 FROM "SalarySlip" LIMIT 1')).rejects.toThrow();
  });
});
