import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * A payroll run, end to end.
 *
 * This is the test that matters. Everything before it configures payroll; this
 * is payroll actually happening — a population, a period, days worked, the
 * arithmetic, and payslips somebody signs off. So it walks the whole thing the
 * way a payroll clerk would on the 28th, and checks the things that would cost
 * real money to get wrong:
 *
 *   - a run refuses to calculate while anything is wrong, and says what;
 *   - the payslip carries a snapshot, so later edits cannot rewrite it;
 *   - approval means specific figures, so nothing moves afterwards;
 *   - the same people cannot be paid twice for one period.
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
let periodId = '';
let structureId = '';
const people: Record<string, string> = {};

const at = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `run.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Payroll owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Run Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

/** ₹12,00,000 a year: Basic 50% of monthly CTC, HRA 40% of Basic, allowance the rest. */
async function setUpPayroll(c: Ctx) {
  const basic = await api
    .post(c, '/components', {
      name: 'Basic', code: 'BASIC', type: 'EARNING',
      calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC',
      includeInPfWage: true, displayOrder: 1,
    })
    .expect(201);
  const hra = await api
    .post(c, '/components', {
      name: 'House Rent Allowance', code: 'HRA', type: 'EARNING',
      calculationMethod: 'FORMULA', formula: 'BASIC * 0.4', displayOrder: 2,
    })
    .expect(201);
  const special = await api
    .post(c, '/components', {
      name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING',
      calculationMethod: 'BALANCING', displayOrder: 3,
    })
    .expect(201);
  const bonus = await api
    .post(c, '/components', {
      name: 'Bonus', code: 'BONUS', type: 'EARNING',
      calculationMethod: 'VARIABLE', isVariable: true, displayOrder: 20,
    })
    .expect(201);

  const structure = await api
    .post(c, '/structures', {
      name: `Staff ${rnd()}`,
      frequency: 'MONTHLY',
      effectiveFrom: '2026-01-01',
      status: 'ACTIVE',
      components: [
        { componentId: basic.body.component.id, displayOrder: 1 },
        { componentId: hra.body.component.id, displayOrder: 2 },
        { componentId: special.body.component.id, isBalancing: true, displayOrder: 3 },
      ],
    })
    .expect(201);

  const period = await api
    .post(c, '/periods', {
      name: `September 2026 ${rnd()}`,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      paymentDate: '2026-09-30',
    })
    .expect(201);

  return { structureId: structure.body.structure.id, periodId: period.body.period.id, bonusComponentId: bonus.body.component.id };
}

async function addPerson(c: Ctx, name: string, ctc: number, over: Record<string, unknown> = {}) {
  const made = await api
    .post(c, '/employees', {
      name,
      code: `E${rnd().toUpperCase()}`,
      dateOfJoining: '2026-01-01',
      status: 'ACTIVE',
      payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', bankAccountNumber: '123412341234', pan: 'ABCDE1234F' },
      ...over,
    })
    .expect(201);
  const id = made.body.employee.id;
  if (ctc > 0) {
    await api.post(c, '/assignments', { employeeId: id, structureId, effectiveFrom: '2026-01-01', annualCtc: ctc }).expect(201);
  }
  return id;
}

beforeAll(async () => {
  owner = await makeOwner();
  const setup = await setUpPayroll(owner);
  structureId = setup.structureId;
  periodId = setup.periodId;
  people.asha = await addPerson(owner, 'Asha Menon', 1_200_000);
  people.rahul = await addPerson(owner, 'Rahul Iyer', 600_000);
});

describe('starting a payroll', () => {
  let runId = '';

  it('gathers everybody eligible for the period', async () => {
    const made = await api.post(owner, '/runs', { periodId }).expect(201);
    runId = made.body.run.id;
    expect(made.body.run.status).toBe('DRAFT');
    expect(made.body.eligible).toBe(2);
    expect(made.body.periodDays).toBe(30);
  });

  it('refuses a second payroll over the same period and population', async () => {
    /* The thing that would pay everybody twice in one month. */
    const again = await api.post(owner, '/runs', { periodId });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('RUN_EXISTS');
  });

  it('refuses a payroll for a closed period', async () => {
    const period = await api
      .post(owner, '/periods', { name: `Closed ${rnd()}`, startDate: '2026-11-01', endDate: '2026-11-30' })
      .expect(201);
    await api.post(owner, `/periods/${period.body.period.id}/lock`, { locked: true }).expect(200);

    const refused = await api.post(owner, '/runs', { periodId: period.body.period.id });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PERIOD_LOCKED');
  });

  it('works out everybody’s days from the period before anybody types them', async () => {
    const got = await api.get(owner, `/runs/${runId}`).expect(200);
    expect(got.body.employees).toHaveLength(2);
    /* Nobody has entered days yet, so validation says where they came from. */
    const check = await api.post(owner, `/runs/${runId}/validate`).expect(200);
    expect(check.body.canCalculate).toBe(true);
    expect(check.body.issues.some((i: any) => i.code === 'DAYS_DERIVED')).toBe(true);
  });
});

describe('a payroll that is not ready', () => {
  it('names the person with no salary, and refuses to calculate', async () => {
    const c = await makeOwner();
    const setup = await setUpPayroll(c);
    structureId = setup.structureId;
    await addPerson(c, 'Has a salary', 600_000);
    await addPerson(c, 'Has no salary', 0);

    const run = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
    const check = await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);

    expect(check.body.canCalculate).toBe(false);
    expect(check.body.issues.some((i: any) => i.code === 'NO_ASSIGNMENT' && /Has no salary/.test(i.message))).toBe(true);

    const refused = await api.post(c, `/runs/${run.body.run.id}/calculate`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('RUN_HAS_ERRORS');
  });

  it('refuses to pay somebody who is on the staff list but not in payroll', async () => {
    /*
     * A payroll profile holds the bank account, the PAN and which statutory
     * schemes apply. Without one there is nowhere to send the money, nothing
     * to deduct tax against and nothing to file — so a run that included such
     * a person was producing a payslip that could not be acted on.
     *
     * It did exactly that: seven people paid while payroll's own setup screen,
     * which counts profiles, reported that nobody was in payroll. Both numbers
     * were right; they were counting different things.
     */
    const c = await makeOwner();
    const setup = await setUpPayroll(c);
    structureId = setup.structureId;
    await addPerson(c, 'In payroll', 600_000);
    await addPerson(c, 'On the staff list only', 600_000, { payroll: undefined });

    const run = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
    const check = await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);

    expect(check.body.canCalculate).toBe(false);
    const issue = check.body.issues.find((i: any) => i.code === 'NO_PAYROLL_PROFILE');
    expect(issue).toBeTruthy();
    expect(issue.message).toMatch(/On the staff list only/);
    /* The message has to say what to do about it, not only what is wrong. */
    expect(issue.message).toMatch(/payroll details/i);

    const refused = await api.post(c, `/runs/${run.body.run.id}/calculate`);
    expect(refused.status).toBe(409);
  });

  it('refuses to pay somebody put on hold after the run was started', async () => {
    const c = await makeOwner();
    const setup = await setUpPayroll(c);
    structureId = setup.structureId;
    await addPerson(c, 'Still paid', 600_000);
    const held = await addPerson(c, 'Put on hold', 600_000);

    const run = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);

    /* The update takes the whole employee, not a patch, so the name comes
       with it. */
    await api
      .put(c, `/employees/${held}`, {
        name: 'Put on hold',
        status: 'ACTIVE',
        payroll: { payrollStatus: 'ON_HOLD', taxRegime: 'NEW' },
      })
      .expect(200);

    const check = await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);
    expect(check.body.canCalculate).toBe(false);
    expect(check.body.issues.some((i: any) => i.code === 'NOT_IN_PAYROLL')).toBe(true);
  });

  it('calculates once the person without a salary is taken out', async () => {
    const c = await makeOwner();
    const setup = await setUpPayroll(c);
    structureId = setup.structureId;
    await addPerson(c, 'Paid person', 600_000);
    const unpaid = await addPerson(c, 'Unpaid person', 0);

    const run = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
    const id = run.body.run.id;

    await api.post(c, `/runs/${id}/employees`, { employeeId: unpaid, include: false }).expect(200);
    const check = await api.post(c, `/runs/${id}/validate`).expect(200);
    expect(check.body.canCalculate).toBe(true);

    const done = await api.post(c, `/runs/${id}/calculate`).expect(200);
    expect(done.body.calculated).toBe(1);
  });
});

describe('the arithmetic of a whole run', () => {
  let c: Ctx;
  let runId = '';
  let ashaId = '';

  beforeAll(async () => {
    c = await makeOwner();
    const setup = await setUpPayroll(c);
    structureId = setup.structureId;
    periodId = setup.periodId;
    ashaId = await addPerson(c, 'Asha Menon', 1_200_000);
    await addPerson(c, 'Rahul Iyer', 600_000);

    const run = await api.post(c, '/runs', { periodId }).expect(201);
    runId = run.body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
  });

  it('pays each person what their structure and CTC say', async () => {
    const got = await api.get(c, `/runs/${runId}`).expect(200);
    const asha = got.body.slips.find((s: any) => s.employeeId === ashaId);
    /* ₹12,00,000 a year is ₹1,00,000 a month, and the structure spends all of
       it: Basic 50,000, HRA 20,000, the allowance the remaining 30,000. */
    expect(asha.grossEarnings).toBe(100000);
    expect(asha.netPay).toBe(100000);
  });

  it('adds the run up to the sum of its payslips', async () => {
    const got = await api.get(c, `/runs/${runId}`).expect(200);
    const sum = got.body.slips.reduce((t: number, s: any) => t + s.netPay, 0);
    expect(got.body.run.netTotal).toBe(sum);
    expect(got.body.run.employeeCount).toBe(2);
    expect(got.body.run.grossTotal).toBe(150000);
  });

  it('gives every payslip a number and a line for every component', async () => {
    const slips = await payrollPrisma.salarySlip.findMany({ where: { orgId: c.orgId, runId }, include: { lines: true } });
    expect(slips).toHaveLength(2);
    for (const s of slips) {
      expect(s.number).toMatch(/^PR-\d{6}-\d{3}-\d{4}$/);
      expect(s.lines.length).toBe(3);
    }
  });

  it('records how every figure was reached', async () => {
    /* The explainability requirement: an employee asking why their HRA is that
       number gets the answer from the payslip, not from somebody rebuilding it. */
    const slip = await payrollPrisma.salarySlip.findFirst({
      where: { orgId: c.orgId, runId, employeeId: ashaId },
      include: { traces: true },
    });
    const hra = slip!.traces.find((t) => t.componentCode === 'HRA');
    expect(hra?.formula).toBe('BASIC * 0.4');
    expect(Number(hra?.computedAmount)).toBe(20000);
  });

  it('remembers the configuration it used, not today’s', async () => {
    const slip = await payrollPrisma.salarySlip.findFirst({ where: { orgId: c.orgId, runId, employeeId: ashaId } });
    const structure = JSON.parse(slip!.structureSnapshotJson);
    const assignment = JSON.parse(slip!.assignmentSnapshotJson);
    const input = JSON.parse(slip!.inputSnapshotJson);

    expect(structure.components).toHaveLength(3);
    expect(assignment.annualCtc).toBe(1200000);
    expect(input.periodDays).toBe(30);
    expect(slip!.engineVersion).toBeTruthy();
  });

  it('keeps the payslip identical after the structure is changed underneath it', async () => {
    /* The property the whole module rests on. */
    const before = await payrollPrisma.salarySlip.findFirst({ where: { orgId: c.orgId, runId, employeeId: ashaId } });

    const comp = await payrollPrisma.salaryComponent.findFirst({ where: { orgId: c.orgId, code: 'HRA' } });
    await payrollPrisma.salaryComponent.update({ where: { id: comp!.id }, data: { formula: 'BASIC * 0.9' } });

    const after = await payrollPrisma.salarySlip.findFirst({ where: { orgId: c.orgId, runId, employeeId: ashaId } });
    expect(Number(after!.netPay)).toBe(Number(before!.netPay));
    expect(after!.structureSnapshotJson).toBe(before!.structureSnapshotJson);

    await payrollPrisma.salaryComponent.update({ where: { id: comp!.id }, data: { formula: 'BASIC * 0.4' } });
  });

  it('recalculates cleanly rather than leaving two sets of payslips', async () => {
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    const slips = await payrollPrisma.salarySlip.count({ where: { orgId: c.orgId, runId } });
    expect(slips).toBe(2);
  });
});

describe('days somebody actually worked', () => {
  let c: Ctx;
  let runId = '';
  let personId = '';

  beforeAll(async () => {
    c = await makeOwner();
    const setup = await setUpPayroll(c);
    structureId = setup.structureId;
    personId = await addPerson(c, 'Part month', 1_200_000);
    const run = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
    runId = run.body.run.id;
  });

  it('prorates on the days entered', async () => {
    await api
      .put(c, `/runs/${runId}/inputs`, {
        inputs: [{ employeeId: personId, workingDays: 30, payableDays: 15, lwpDays: 15 }],
      })
      .expect(200);
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);

    const got = await api.get(c, `/runs/${runId}`).expect(200);
    expect(got.body.slips[0].netPay).toBe(50000);
  });

  it('warns about nil pay rather than refusing it', async () => {
    /* Somebody on unpaid leave all month is a real payslip, and a zero nobody
       was warned about is the problem. */
    await api
      .put(c, `/runs/${runId}/inputs`, { inputs: [{ employeeId: personId, workingDays: 30, payableDays: 0, lwpDays: 30 }] })
      .expect(200);
    const check = await api.post(c, `/runs/${runId}/validate`).expect(200);
    expect(check.body.canCalculate).toBe(true);
    expect(check.body.issues.some((i: any) => i.code === 'ZERO_PAYABLE_DAYS')).toBe(true);
  });
});

describe('sending a payroll round for sign-off', () => {
  let c: Ctx;
  let runId = '';

  beforeAll(async () => {
    c = await makeOwner();
    const setup = await setUpPayroll(c);
    structureId = setup.structureId;
    await addPerson(c, 'Signed off', 900_000);
    const run = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
    runId = run.body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
  });

  it('will not approve a payroll nobody has sent for review', async () => {
    const early = await api.post(c, `/runs/${runId}/approve`);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('RUN_WRONG_STATUS');
  });

  it('goes for review, and can be sent back with a reason', async () => {
    await api.post(c, `/runs/${runId}/submit-review`).expect(200);
    const rejected = await api.post(c, `/runs/${runId}/reject`, { reason: 'Bonus is missing for two people.' }).expect(200);
    expect(rejected.body.run.status).toBe('CALCULATED');
    expect(rejected.body.run.rejectionReason).toMatch(/Bonus is missing/);
  });

  it('approves and then locks', async () => {
    await api.post(c, `/runs/${runId}/submit-review`).expect(200);
    const approved = await api.post(c, `/runs/${runId}/approve`).expect(200);
    expect(approved.body.run.status).toBe('APPROVED');
    expect(approved.body.run.approvedAt).toBeTruthy();

    const locked = await api.post(c, `/runs/${runId}/lock`).expect(200);
    expect(locked.body.run.status).toBe('LOCKED');
  });

  it('refuses every change once it is approved', async () => {
    /* Approving is a statement about specific figures. Figures that can still
       move afterwards make the approval meaningless. */
    const recalc = await api.post(c, `/runs/${runId}/calculate`);
    expect(recalc.status).toBe(409);
    expect(recalc.body.code).toBe('RUN_NOT_EDITABLE');

    const days = await api.put(c, `/runs/${runId}/inputs`, {
      inputs: [{ employeeId: (await api.get(c, `/runs/${runId}`)).body.employees[0].employeeId, workingDays: 30, payableDays: 1 }],
    });
    expect(days.status).toBe(409);
  });
});

describe('what happens next month', () => {
  it('compares each payslip with the one before it', async () => {
    const c = await makeOwner();
    const setup = await setUpPayroll(c);
    structureId = setup.structureId;
    const personId = await addPerson(c, 'Two months', 1_200_000);

    const first = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
    await api.post(c, `/runs/${first.body.run.id}/validate`).expect(200);
    await api.post(c, `/runs/${first.body.run.id}/calculate`).expect(200);

    const october = await api
      .post(c, '/periods', { name: `October 2026 ${rnd()}`, startDate: '2026-10-01', endDate: '2026-10-31' })
      .expect(201);
    const second = await api.post(c, '/runs', { periodId: october.body.period.id }).expect(201);
    /* Half a month this time, so the variance is real and worth flagging. */
    await api
      .put(c, `/runs/${second.body.run.id}/inputs`, {
        inputs: [{ employeeId: personId, workingDays: 31, payableDays: 16 }],
      })
      .expect(200);
    await api.post(c, `/runs/${second.body.run.id}/validate`).expect(200);
    await api.post(c, `/runs/${second.body.run.id}/calculate`).expect(200);

    const got = await api.get(c, `/runs/${second.body.run.id}`).expect(200);
    const slip = got.body.slips[0];
    expect(slip.previousNetPay).toBe(100000);
    expect(slip.variancePercent).toBeLessThan(-40);
  });
});

describe('abandoning a payroll', () => {
  it('cancels it and takes its payslips with it', async () => {
    const c = await makeOwner();
    const setup = await setUpPayroll(c);
    structureId = setup.structureId;
    await addPerson(c, 'Cancelled run', 600_000);
    const run = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
    await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);
    await api.post(c, `/runs/${run.body.run.id}/calculate`).expect(200);

    const cancelled = await api.post(c, `/runs/${run.body.run.id}/cancel`).expect(200);
    expect(cancelled.body.run.status).toBe('CANCELLED');
    expect(await payrollPrisma.salarySlip.count({ where: { orgId: c.orgId, runId: run.body.run.id } })).toBe(0);
  });

  it('lets the period be run again afterwards', async () => {
    const c = await makeOwner();
    const setup = await setUpPayroll(c);
    structureId = setup.structureId;
    await addPerson(c, 'Second attempt', 600_000);
    const first = await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
    await api.post(c, `/runs/${first.body.run.id}/cancel`).expect(200);
    await api.post(c, '/runs', { periodId: setup.periodId }).expect(201);
  });
});
