import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * The payroll overview.
 *
 * Every figure here is derived, so the tests are about honesty rather than
 * arithmetic: that two counts on the same screen cannot contradict each other,
 * that the blockers say what is actually in the way, and that the totals match
 * the payslips they summarise rather than a stored copy of them.
 */

const { buildApp } = await import('../app.js');
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
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `ovw.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Ovw Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

const overview = async (c: Ctx) => (await api.get(c, '/overview').expect(200)).body.overview;

async function setUp(c: Ctx) {
  const basic = await api
    .post(c, '/components', {
      name: 'Basic', code: 'BASIC', type: 'EARNING',
      calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1,
    })
    .expect(201);

  const structure = await api
    .post(c, '/structures', {
      name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE',
      components: [{ componentId: basic.body.component.id, displayOrder: 1 }],
    })
    .expect(201);

  /* A month covering today, so the overview has a current period to find. */
  const today = new Date();
  const start = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const endDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const end = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${endDay}`;

  const period = await api
    .post(c, '/periods', { name: `This month ${rnd()}`, startDate: start, endDate: end, paymentDate: end })
    .expect(201);

  const people: string[] = [];
  for (const name of ['Kavya Ramanathan', 'Zoya Qureshi']) {
    const made = await api
      .post(c, '/employees', {
        name, code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE',
        payroll: { payrollStatus: 'IN_PAYROLL' },
      })
      .expect(201);
    await api
      .post(c, '/assignments', { employeeId: made.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-01-01', annualCtc: 600_000 })
      .expect(201);
    people.push(made.body.employee.id);
  }

  return { periodId: period.body.period.id, structureId: structure.body.structure.id, componentId: basic.body.component.id, people };
}

describe('the headline', () => {
  it('finds the month payroll is for, and says it has not been run', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);

    const o = await overview(c);
    expect(o.currentPeriod.id).toBe(ids.periodId);
    expect(o.currentRun).toBe(null);
    expect(o.people.inPayroll).toBe(2);
    expect(o.people.headcount).toBe(2);
  });

  it('reports the run once there is one, with the totals from its payslips', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const run = await api.post(c, '/runs', { periodId: ids.periodId }).expect(201);
    await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);
    await api.post(c, `/runs/${run.body.run.id}/calculate`).expect(200);

    const o = await overview(c);
    expect(o.currentRun.number).toBe(run.body.run.number);
    expect(o.currentRun.stage).toBe('Waiting to be checked');
    expect(o.currentRun.employeeCount).toBe(2);
    expect(o.currentRun.gross).toBe(100_000);

    const slips = (await api.get(c, `/slips?runId=${run.body.run.id}`).expect(200)).body.slips;
    expect(o.currentRun.net).toBe(slips.reduce((t: number, s: any) => t + s.netPay, 0));
  });
});

describe('the two counts of people', () => {
  it('cannot contradict each other when somebody leaves the directory', async () => {
    /*
     * This was a real bug: payroll profiles were counted without checking the
     * person still existed, and the screen said "4 in payroll of 2 on the
     * books" — a pair of numbers that cannot both be true.
     */
    const c = await makeOwner();
    const ids = await setUp(c);

    await peoplePrisma.employee.deleteMany({ where: { orgId: c.orgId, id: ids.people[0] } });

    const o = await overview(c);
    expect(o.people.headcount).toBe(1);
    expect(o.people.inPayroll).toBe(1);
    expect(o.people.inPayroll).toBeLessThanOrEqual(o.people.headcount);
    expect(o.people.orphaned).toBe(1);
    expect(o.blockers.map((b: any) => b.code)).toContain('ORPHANED_PAYROLL_PROFILES');
  });

  it('counts somebody with no salary as being in the way', async () => {
    const c = await makeOwner();
    await setUp(c);
    await api
      .post(c, '/employees', {
        name: 'Pranav Bhandari', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE',
        payroll: { payrollStatus: 'IN_PAYROLL' },
      })
      .expect(201);

    const o = await overview(c);
    expect(o.people.withoutSalary).toBe(1);
    const blocker = o.blockers.find((b: any) => b.code === 'PEOPLE_WITHOUT_SALARY');
    expect(blocker.count).toBe(1);
    expect(blocker.message).toContain('1 person has');
  });
});

describe('what is in the way', () => {
  it('names an unapproved adjustment, because payroll will not pay it', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    await api
      .post(c, '/adjustments', { employeeId: ids.people[0], componentId: ids.componentId, periodId: ids.periodId, amount: 5_000 })
      .expect(201);

    const o = await overview(c);
    expect(o.blockers.map((b: any) => b.code)).toContain('ADJUSTMENTS_UNAPPROVED');
    expect(o.pending.unapprovedAdjustments).toBe(1);
    /* Not counted as pending value: nobody has agreed to pay it. */
    expect(o.pending.adjustments).toBe(0);
  });

  it('stops naming it once it is approved, and counts what it is worth', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api
      .post(c, '/adjustments', { employeeId: ids.people[0], componentId: ids.componentId, periodId: ids.periodId, amount: 5_000 })
      .expect(201);
    await api.post(c, `/adjustments/${made.body.adjustment.id}/approve`).expect(200);

    const o = await overview(c);
    expect(o.blockers.map((b: any) => b.code)).not.toContain('ADJUSTMENTS_UNAPPROVED');
    expect(o.pending.adjustments).toBe(1);
    expect(o.pending.adjustmentValue).toBe(5_000);
  });

  it('says nothing when there is nothing in the way', async () => {
    const c = await makeOwner();
    await setUp(c);
    const o = await overview(c);
    expect(o.blockers).toEqual([]);
  });
});
