import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * One-off earnings and deductions.
 *
 * What this holds is the lifecycle rather than the arithmetic: that an
 * adjustment belongs to one period and does not leak into the next, that it is
 * approved before it is paid, and that a payroll which has paid it turns it
 * into a record nobody can quietly edit.
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
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
  del: (c: Ctx, path: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `adj.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Adj Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

/** A structure, one person on it, and two open months to adjust. */
async function setUp(c: Ctx) {
  const mk = (payload: Record<string, unknown>) => api.post(c, '/components', payload).expect(201);

  const basic = await mk({
    name: 'Basic', code: 'BASIC', type: 'EARNING',
    calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1,
  });
  /* `isVariable` — the amount arrives per person per month, which is exactly
     what an adjustment is. */
  const bonus = await mk({ name: 'Bonus', code: 'BONUS', type: 'EARNING', calculationMethod: 'FIXED', isVariable: true, displayOrder: 50 });
  const fine = await mk({ name: 'Recovery', code: 'RECOVERY', type: 'DEDUCTION', calculationMethod: 'FIXED', isVariable: true, displayOrder: 60 });
  const erPf = await mk({
    name: 'Employer PF', code: 'ER_PF', type: 'EMPLOYER_CONTRIBUTION',
    calculationMethod: 'FIXED', isVariable: true, includeInGross: false, includeInNetPay: false, displayOrder: 70,
  });

  const structure = await api
    .post(c, '/structures', {
      name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE',
      components: [
        { componentId: basic.body.component.id, displayOrder: 1 },
        { componentId: bonus.body.component.id, displayOrder: 50 },
        { componentId: fine.body.component.id, displayOrder: 60 },
      ],
    })
    .expect(201);

  const march = await api
    .post(c, '/periods', { name: `March ${rnd()}`, startDate: '2026-03-01', endDate: '2026-03-31', paymentDate: '2026-03-31' })
    .expect(201);
  const april = await api
    .post(c, '/periods', { name: `April ${rnd()}`, startDate: '2026-04-01', endDate: '2026-04-30', paymentDate: '2026-04-30' })
    .expect(201);

  const person = await api
    .post(c, '/employees', {
      name: 'Nivedita Rao', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE',
      payroll: { payrollStatus: 'IN_PAYROLL' },
    })
    .expect(201);
  await api
    .post(c, '/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 })
    .expect(201);

  return {
    employeeId: person.body.employee.id,
    bonusId: bonus.body.component.id,
    fineId: fine.body.component.id,
    erPfId: erPf.body.component.id,
    marchId: march.body.period.id,
    aprilId: april.body.period.id,
  };
}

const runPayroll = async (c: Ctx, periodId: string) => {
  const run = await api.post(c, '/runs', { periodId }).expect(201);
  await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);
  await api.post(c, `/runs/${run.body.run.id}/calculate`).expect(200);
  return run.body.run.id;
};

describe('adding a one-off', () => {
  it('starts as a draft, and takes its earning-or-deduction from the component', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);

    const bonus = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 15_000, reason: 'Q4 bonus' })
      .expect(201);
    expect(bonus.body.adjustment.type).toBe('EARNING');
    expect(bonus.body.adjustment.status).toBe('DRAFT');

    const fine = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.fineId, periodId: ids.marchId, amount: 2_000 })
      .expect(201);
    expect(fine.body.adjustment.type).toBe('DEDUCTION');
  });

  it('refuses an employer cost, which is not somebody’s pay to adjust', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);

    const refused = await api.post(c, '/adjustments', {
      employeeId: ids.employeeId, componentId: ids.erPfId, periodId: ids.marchId, amount: 1_000,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('employer cost');
  });

  it('refuses a closed month', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    await api.post(c, `/periods/${ids.marchId}/lock`).expect(200);

    const refused = await api.post(c, '/adjustments', {
      employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 5_000,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PERIOD_LOCKED');
  });

  it('refuses an adjustment of nothing', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const refused = await api.post(c, '/adjustments', {
      employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 0,
    });
    expect(refused.status).toBe(400);
  });
});

describe('a payroll that pays one', () => {
  it('pays only an approved one', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);

    /* Left as a draft: nobody has said this should be paid. */
    await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 15_000 })
      .expect(201);

    const runId = await runPayroll(c, ids.marchId);
    const slip = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0];
    expect(slip.grossEarnings).toBe(50_000);
  });

  it('adds an approved one on top of the structure', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);

    const bonus = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 15_000 })
      .expect(201);
    const fine = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.fineId, periodId: ids.marchId, amount: 2_000 })
      .expect(201);
    await api.post(c, `/adjustments/${bonus.body.adjustment.id}/approve`).expect(200);
    await api.post(c, `/adjustments/${fine.body.adjustment.id}/approve`).expect(200);

    const runId = await runPayroll(c, ids.marchId);
    const slip = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0];

    expect(slip.grossEarnings).toBe(65_000);
    expect(slip.totalDeductions).toBe(2_000);
    expect(slip.netPay).toBe(63_000);
  });

  it('names the component on the payslip, even when it is not in the structure', async () => {
    /*
     * Found in a browser walkthrough. A structure locks its components the
     * moment anybody is assigned to it, so a bonus added afterwards lives
     * outside every structure in the company — and the payslip line was
     * falling back to a generic "Adjustment", with no ledger mapping. The
     * person could not see what they had been paid for, and two different
     * bonuses collapsed into one column on the salary register.
     */
    const c = await makeOwner();
    const ids = await setUp(c);

    /* A component deliberately NOT in anybody's structure. */
    const offStructure = await api
      .post(c, '/components', {
        name: 'Retention Bonus', code: 'RETENTION', type: 'EARNING',
        calculationMethod: 'FIXED', isVariable: true, displayOrder: 55,
      })
      .expect(201);

    const made = await api
      .post(c, '/adjustments', {
        employeeId: ids.employeeId, componentId: offStructure.body.component.id, periodId: ids.marchId, amount: 12_000,
      })
      .expect(201);
    await api.post(c, `/adjustments/${made.body.adjustment.id}/approve`).expect(200);

    const runId = await runPayroll(c, ids.marchId);
    const slipId = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0].id;
    const slip = (await api.get(c, `/slips/${slipId}`).expect(200)).body.slip;

    const line = slip.earnings.find((l: any) => l.amount === 12_000);
    expect(line.code).toBe('RETENTION');
    expect(line.name).toBe('Retention Bonus');
  });

  it('marks it spent, and says which payroll spent it', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const bonus = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 15_000 })
      .expect(201);
    await api.post(c, `/adjustments/${bonus.body.adjustment.id}/approve`).expect(200);

    const runId = await runPayroll(c, ids.marchId);

    const after = (await api.get(c, '/adjustments').expect(200)).body.adjustments[0];
    expect(after.status).toBe('CONSUMED');
    expect(after.consumedByRunId).toBe(runId);
    expect(after.consumedByRunNumber).toBeTruthy();
  });

  it('does not let a March bonus reappear in April', async () => {
    /*
     * The reason an adjustment carries a period at all. Without it, a one-off
     * is paid again every month until somebody notices.
     */
    const c = await makeOwner();
    const ids = await setUp(c);
    const bonus = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 15_000 })
      .expect(201);
    await api.post(c, `/adjustments/${bonus.body.adjustment.id}/approve`).expect(200);

    await runPayroll(c, ids.marchId);
    const aprilRun = await runPayroll(c, ids.aprilId);

    const april = (await api.get(c, `/slips?runId=${aprilRun}`).expect(200)).body.slips[0];
    expect(april.grossEarnings).toBe(50_000);
  });
});

describe('once a payroll has paid it', () => {
  const paid = async (c: Ctx, ids: Awaited<ReturnType<typeof setUp>>) => {
    const bonus = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 15_000 })
      .expect(201);
    await api.post(c, `/adjustments/${bonus.body.adjustment.id}/approve`).expect(200);
    await runPayroll(c, ids.marchId);
    return bonus.body.adjustment.id;
  };

  it('cannot be edited', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const id = await paid(c, ids);

    const refused = await api.put(c, `/adjustments/${id}`, {
      employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 99_000,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('ADJUSTMENT_NOT_EDITABLE');
  });

  it('cannot be cancelled or deleted', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const id = await paid(c, ids);

    const cancel = await api.post(c, `/adjustments/${id}/cancel`);
    expect(cancel.status).toBe(409);
    expect(cancel.body.code).toBe('ADJUSTMENT_CONSUMED');

    const remove = await api.del(c, `/adjustments/${id}`);
    expect(remove.status).toBe(409);
  });
});

describe('changing one before it is paid', () => {
  it('sends an approved adjustment back for approval', async () => {
    /* The approval was of an amount, not of a row — so changing the amount
       means the approval no longer applies to it. */
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 15_000 })
      .expect(201);
    await api.post(c, `/adjustments/${made.body.adjustment.id}/approve`).expect(200);

    const edited = await api
      .put(c, `/adjustments/${made.body.adjustment.id}`, {
        employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 40_000,
      })
      .expect(200);
    expect(edited.body.adjustment.status).toBe('DRAFT');
    expect(edited.body.adjustment.approvedAt).toBe(null);

    /* And a payroll does not pay it while it is back in draft. */
    const runId = await runPayroll(c, ids.marchId);
    const slip = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0];
    expect(slip.grossEarnings).toBe(50_000);
  });

  it('keeps a cancelled one, and deletes only a draft', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);

    const first = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 15_000 })
      .expect(201);
    await api.post(c, `/adjustments/${first.body.adjustment.id}/cancel`).expect(200);

    /* "We decided not to pay this" is worth keeping. */
    const remove = await api.del(c, `/adjustments/${first.body.adjustment.id}`);
    expect(remove.status).toBe(409);
    expect(remove.body.code).toBe('ADJUSTMENT_NOT_DRAFT');

    const second = await api
      .post(c, '/adjustments', { employeeId: ids.employeeId, componentId: ids.bonusId, periodId: ids.marchId, amount: 1_000 })
      .expect(201);
    await api.del(c, `/adjustments/${second.body.adjustment.id}`).expect(200);

    const left = (await api.get(c, '/adjustments').expect(200)).body.adjustments;
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe('CANCELLED');
  });
});
