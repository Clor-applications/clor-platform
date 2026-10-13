import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Loans and advances, and getting the money back out of somebody's pay.
 *
 * Two properties carry most of the weight here. The schedule must add up to
 * exactly what was lent, because a few rupees adrift is a balance nobody can
 * close. And a recovery must never drive a payslip negative, because that hands
 * somebody a month where they owe the company for having worked.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { buildSchedule } = await import('../services/payroll/loan.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `loan.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Loan Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

/** One person on ₹6,00,000, a loan-recovery deduction, and three open months. */
async function setUp(c: Ctx) {
  const mk = (payload: Record<string, unknown>) => api.post(c, '/components', payload).expect(201);

  const basic = await mk({
    name: 'Basic', code: 'BASIC', type: 'EARNING',
    calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1,
  });
  const recovery = await mk({
    name: 'Loan Recovery', code: 'LOANREC', type: 'DEDUCTION',
    calculationMethod: 'FIXED', isVariable: true, displayOrder: 80,
  });
  const notADeduction = await mk({
    name: 'Reimbursement', code: 'REIMB', type: 'EARNING', calculationMethod: 'FIXED', isVariable: true, displayOrder: 90,
  });

  const structure = await api
    .post(c, '/structures', {
      name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE',
      components: [
        { componentId: basic.body.component.id, displayOrder: 1 },
        { componentId: recovery.body.component.id, displayOrder: 80 },
      ],
    })
    .expect(201);

  const months: string[] = [];
  for (const [name, start, end] of [
    ['June', '2026-06-01', '2026-06-30'],
    ['July', '2026-07-01', '2026-07-31'],
    ['August', '2026-08-01', '2026-08-31'],
  ] as const) {
    const p = await api
      .post(c, '/periods', { name: `${name} ${rnd()}`, startDate: start, endDate: end, paymentDate: end })
      .expect(201);
    months.push(p.body.period.id);
  }

  const person = await api
    .post(c, '/employees', {
      name: 'Tanmay Deshpande', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE',
      payroll: { payrollStatus: 'IN_PAYROLL' },
    })
    .expect(201);
  await api
    .post(c, '/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 })
    .expect(201);

  return {
    employeeId: person.body.employee.id,
    recoveryComponentId: recovery.body.component.id,
    earningComponentId: notADeduction.body.component.id,
    months,
  };
}

const loanBody = (ids: Awaited<ReturnType<typeof setUp>>, over: Record<string, unknown> = {}) => ({
  employeeId: ids.employeeId,
  principal: 60_000,
  interestRate: 0,
  startDate: '2026-06-01',
  recoveryStartPeriodId: ids.months[0],
  installmentCount: 6,
  recoveryComponentId: ids.recoveryComponentId,
  ...over,
});

const runPayroll = async (c: Ctx, periodId: string, days?: { employeeId: string; workingDays: number; payableDays: number }) => {
  const run = await api.post(c, '/runs', { periodId }).expect(201);
  if (days) {
    await api
      .put(c, `/runs/${run.body.run.id}/inputs`, {
        inputs: [
          {
            employeeId: days.employeeId,
            workingDays: days.workingDays,
            payableDays: days.payableDays,
            lwpDays: days.workingDays - days.payableDays,
          },
        ],
      })
      .expect(200);
  }
  await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);
  await api.post(c, `/runs/${run.body.run.id}/calculate`).expect(200);
  return run.body.run.id;
};

const slipOf = async (c: Ctx, runId: string) => (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0];

describe('the schedule', () => {
  it('adds up to exactly what was lent', async () => {
    /* A schedule a few rupees adrift is a balance nobody can close. */
    for (const [principal, count] of [
      [60_000, 6],
      [10_000, 3],
      [100_000, 7],
      [1, 3],
      [99_999.99, 11],
    ] as const) {
      const rows = buildSchedule({ principal, annualInterestRate: 0, installmentCount: count });
      const sum = rows.reduce((t, r) => t + r.dueAmount, 0);
      expect(Math.round(sum * 100)).toBe(Math.round(principal * 100));
      expect(rows).toHaveLength(count);
    }
  });

  it('charges flat interest over the term, and still adds up', async () => {
    const rows = buildSchedule({ principal: 120_000, annualInterestRate: 10, installmentCount: 12 });
    const principal = rows.reduce((t, r) => t + r.principalAmount, 0);
    const interest = rows.reduce((t, r) => t + r.interestAmount, 0);

    expect(Math.round(principal * 100)).toBe(120_000_00);
    /* 10% of ₹1,20,000 over one year. */
    expect(Math.round(interest * 100)).toBe(12_000_00);
    expect(Math.round(rows.reduce((t, r) => t + r.dueAmount, 0) * 100)).toBe(132_000_00);
  });

  it('is previewed before a loan exists', async () => {
    const c = await makeOwner();
    const { body } = await api.post(c, '/loans/schedule-preview', { principal: 60_000, interestRate: 0, installmentCount: 6 }).expect(200);
    expect(body.schedule).toHaveLength(6);
    expect(body.total).toBe(60_000);
    expect(body.schedule[0].dueAmount).toBe(10_000);
  });
});

describe('approving a loan', () => {
  it('writes the schedule against real months, and starts it running', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api.post(c, '/loans', loanBody(ids)).expect(201);

    expect(made.body.loan.status).toBe('DRAFT');
    expect(made.body.loan.outstandingBalance).toBe(0);

    await api.post(c, `/loans/${made.body.loan.id}/approve`).expect(200);

    const { body } = await api.get(c, `/loans/${made.body.loan.id}`).expect(200);
    expect(body.loan.status).toBe('ACTIVE');
    expect(body.loan.outstanding).toBe(60_000);
    expect(body.loan.installments).toHaveLength(6);
    /* Three months exist, so three instalments have one and three wait for the
       calendar to be filled in. */
    expect(body.loan.installments.filter((i: any) => i.periodId).length).toBe(3);
  });

  it('refuses a recovery against something that is not a deduction', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const refused = await api.post(c, '/loans', loanBody(ids, { recoveryComponentId: ids.earningComponentId }));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('NOT_A_DEDUCTION');
  });

  it('refuses to change the terms once it is running', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api.post(c, '/loans', loanBody(ids)).expect(201);
    await api.post(c, `/loans/${made.body.loan.id}/approve`).expect(200);

    const refused = await api.put(c, `/loans/${made.body.loan.id}`, loanBody(ids, { principal: 500_000 }));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('LOAN_NOT_DRAFT');
  });
});

describe('a payroll that recovers one', () => {
  const approved = async (c: Ctx, ids: Awaited<ReturnType<typeof setUp>>, over: Record<string, unknown> = {}) => {
    const made = await api.post(c, '/loans', loanBody(ids, over)).expect(201);
    await api.post(c, `/loans/${made.body.loan.id}/approve`).expect(200);
    return made.body.loan.id;
  };

  it('takes the instalment off the payslip and closes it', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await approved(c, ids);

    const runId = await runPayroll(c, ids.months[0]);
    const slip = await slipOf(c, runId);

    expect(slip.grossEarnings).toBe(50_000);
    expect(slip.totalDeductions).toBe(10_000);
    expect(slip.netPay).toBe(40_000);

    const { body } = await api.get(c, `/loans/${loanId}`).expect(200);
    expect(body.loan.outstanding).toBe(50_000);
    expect(body.loan.recovered).toBe(10_000);
    const first = body.loan.installments[0];
    expect(first.status).toBe('RECOVERED');
    /* The instalment says which payslip took it. */
    expect(first.slipNumber).toBeTruthy();
  });

  it('names the recovery component on the payslip when it is not in the structure', async () => {
    /* Same cause as the adjustment case: a loan-recovery deduction added
       after people were assigned lives outside every structure, and the
       payslip line was falling back to a generic "Loan recovery". */
    const c = await makeOwner();
    const ids = await setUp(c);

    const offStructure = await api
      .post(c, '/components', {
        name: 'Advance Recovery', code: 'ADVREC', type: 'DEDUCTION',
        calculationMethod: 'FIXED', isVariable: true, displayOrder: 85,
      })
      .expect(201);

    const made = await api.post(c, '/loans', loanBody(ids, { recoveryComponentId: offStructure.body.component.id })).expect(201);
    await api.post(c, `/loans/${made.body.loan.id}/approve`).expect(200);

    const runId = await runPayroll(c, ids.months[0]);
    const slipId = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0].id;
    const slip = (await api.get(c, `/slips/${slipId}`).expect(200)).body.slip;

    const line = slip.deductions.find((l: any) => l.amount === 10_000);
    expect(line.code).toBe('ADVREC');
    expect(line.name).toBe('Advance Recovery');
  });

  it('does not take a second month’s instalment in the first month', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    await approved(c, ids);

    const runId = await runPayroll(c, ids.months[0]);
    expect((await slipOf(c, runId)).totalDeductions).toBe(10_000);
  });

  it('never drives a payslip negative, and leaves the rest owed', async () => {
    /*
     * The property that matters most. Somebody on unpaid leave for most of the
     * month earns less than they owe; taking the whole instalment would hand
     * them a payslip saying they owe the company for having worked.
     */
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await approved(c, ids, { principal: 120_000, installmentCount: 3 });

    /* One payable day out of thirty: about ₹1,667 earned, against a ₹40,000
       instalment. */
    const runId = await runPayroll(c, ids.months[0], { employeeId: ids.employeeId, workingDays: 30, payableDays: 1 });
    const slip = await slipOf(c, runId);

    expect(slip.netPay).toBeGreaterThanOrEqual(0);
    expect(slip.totalDeductions).toBe(slip.grossEarnings);
    expect(slip.netPay).toBe(0);

    /* Not written off: the instalment is still owed. */
    const { body } = await api.get(c, `/loans/${loanId}`).expect(200);
    expect(body.loan.installments[0].status).toBe('PENDING');
    expect(body.loan.outstanding).toBe(120_000);
  });

  it('completes the loan once the last instalment is taken', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await approved(c, ids, { principal: 30_000, installmentCount: 3 });

    for (const month of ids.months) await runPayroll(c, month);

    const { body } = await api.get(c, `/loans/${loanId}`).expect(200);
    expect(body.loan.status).toBe('COMPLETED');
    expect(body.loan.outstanding).toBe(0);
    expect(body.loan.installments.every((i: any) => i.status === 'RECOVERED')).toBe(true);
  });

  it('un-recovers an instalment when the payroll that took it is recalculated away', async () => {
    /*
     * A payroll replaces its payslips wholesale. Without this, taking somebody
     * out of a run and recalculating would leave their loan looking repaid by
     * a payslip that no longer exists.
     */
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await approved(c, ids);

    /* A second person, so taking the borrower out still leaves a payroll to
       calculate. */
    const other = await api
      .post(c, '/employees', {
        name: 'Ishita Sarkar', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE',
        payroll: { payrollStatus: 'IN_PAYROLL' },
      })
      .expect(201);
    const structureId = (await api.get(c, `/assignments?employeeId=${ids.employeeId}`).expect(200)).body.assignments[0].structureId;
    await api
      .post(c, '/assignments', { employeeId: other.body.employee.id, structureId, effectiveFrom: '2026-01-01', annualCtc: 600_000 })
      .expect(201);

    const run = await api.post(c, '/runs', { periodId: ids.months[0] }).expect(201);
    const runId = run.body.run.id;
    await api.post(c, `/runs/${runId}/validate`).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);
    expect((await api.get(c, `/loans/${loanId}`)).body.loan.recovered).toBe(10_000);

    await api.post(c, `/runs/${runId}/employees`, { employeeId: ids.employeeId, include: false }).expect(200);
    await api.post(c, `/runs/${runId}/calculate`).expect(200);

    const { body } = await api.get(c, `/loans/${loanId}`).expect(200);
    expect(body.loan.recovered).toBe(0);
    expect(body.loan.outstanding).toBe(60_000);
    expect(body.loan.installments[0].status).toBe('PENDING');
  });
});

describe('changing a running loan', () => {
  const running = async (c: Ctx, ids: Awaited<ReturnType<typeof setUp>>) => {
    const made = await api.post(c, '/loans', loanBody(ids)).expect(201);
    await api.post(c, `/loans/${made.body.loan.id}/approve`).expect(200);
    return made.body.loan.id;
  };

  it('waives an instalment, and the loan owes that much less', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await running(c, ids);
    const before = (await api.get(c, `/loans/${loanId}`)).body.loan;

    await api.post(c, `/loans/${loanId}/installments/${before.installments[0].id}`, { action: 'WAIVE' }).expect(200);

    const { body } = await api.get(c, `/loans/${loanId}`).expect(200);
    expect(body.loan.outstanding).toBe(50_000);
    expect(body.loan.waived).toBe(10_000);
    expect(body.loan.installments[0].status).toBe('WAIVED');
  });

  it('skips one without forgiving it', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await running(c, ids);
    const before = (await api.get(c, `/loans/${loanId}`)).body.loan;

    await api.post(c, `/loans/${loanId}/installments/${before.installments[0].id}`, { action: 'SKIP' }).expect(200);

    const { body } = await api.get(c, `/loans/${loanId}`).expect(200);
    /* Still owed — the loan simply runs a month longer. */
    expect(body.loan.outstandingBalance).toBe(60_000);

    /* And the payroll does not take it. */
    const runId = await runPayroll(c, ids.months[0]);
    expect((await slipOf(c, runId)).totalDeductions).toBe(0);
  });

  it('will not touch an instalment a payslip has already taken', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await running(c, ids);
    await runPayroll(c, ids.months[0]);

    const loan = (await api.get(c, `/loans/${loanId}`)).body.loan;
    const refused = await api.post(c, `/loans/${loanId}/installments/${loan.installments[0].id}`, { action: 'WAIVE' });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('INSTALMENT_RECOVERED');
  });

  it('will not cancel a loan money has come out of', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await running(c, ids);
    await runPayroll(c, ids.months[0]);

    const refused = await api.post(c, `/loans/${loanId}/cancel`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('LOAN_PARTLY_RECOVERED');
  });

  it('cancels one nothing has come out of', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const loanId = await running(c, ids);

    await api.post(c, `/loans/${loanId}/cancel`).expect(200);
    const { body } = await api.get(c, `/loans/${loanId}`).expect(200);
    expect(body.loan.status).toBe('CANCELLED');
    expect(body.loan.installments).toHaveLength(0);
  });
});
