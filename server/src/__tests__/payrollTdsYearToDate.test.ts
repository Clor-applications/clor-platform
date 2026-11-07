import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * TDS across the financial year, through real payroll runs.
 *
 * Monthly TDS is the year's tax on pay so far plus this month for the months
 * left, less what was already deducted, spread over the months left (April
 * 12 … March 1). The bug this holds shut: the months left were counted from
 * the wrong base and nothing already deducted was subtracted, so a flat salary
 * had more tax taken every month and the year's whole tax in December.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { financialYearStart, monthsLeftInFinancialYear } = await import('../services/payroll/run.js');

const app = buildApp().listen(0, '127.0.0.1');
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
  const email = `tds.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `TDS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  /* Its payroll starts in September with nothing earlier to bring in (audit 7 Nov 2026, #2). */
  await api.put(ctx, '/opening-ytd-first-year?fy=2026-27', { firstYear: true, reason: 'First year of paying salaries' }).expect(200);
  return ctx;
}

async function payMonth(c: Ctx, name: string, start: string, end: string) {
  const period = await api.post(c, '/periods', { name: `${name} ${rnd()}`, startDate: start, endDate: end, paymentDate: end }).expect(201);
  const run = await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201);
  const id = run.body.run.id;
  await api.post(c, `/runs/${id}/validate`).expect(200);
  await api.post(c, `/runs/${id}/calculate`).expect(200);
  return id;
}
const approve = async (c: Ctx, runId: string) => {
  await api.post(c, `/runs/${runId}/submit-review`).expect(200);
  await api.post(c, `/runs/${runId}/approve`).expect(200);
};
const tdsOf = async (runId: string) => {
  const slips = await payrollPrisma.salarySlip.findMany({ where: { runId }, select: { id: true } });
  const lines = await payrollPrisma.salarySlipLine.findMany({ where: { slipId: { in: slips.map((s) => s.id) }, componentCode: 'TDS' } });
  return lines.reduce((t, l) => t + Number(l.amount), 0);
};

describe('the financial year', () => {
  it('runs April to March', () => {
    expect(monthsLeftInFinancialYear('2026-04-30')).toBe(12);
    expect(monthsLeftInFinancialYear('2026-09-30')).toBe(7);
    expect(monthsLeftInFinancialYear('2026-12-31')).toBe(4);
    expect(monthsLeftInFinancialYear('2027-01-31')).toBe(3);
    expect(monthsLeftInFinancialYear('2027-03-31')).toBe(1);
    expect(financialYearStart('2026-10-31')).toBe('2026-04-01');
    expect(financialYearStart('2027-02-28')).toBe('2026-04-01');
  });
});

describe('TDS on a flat salary', () => {
  it('takes the same each month, net of what was already deducted', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const { body } = await api.get(c, '/statutory').expect(200);
    const tds = body.schemes.find((s: any) => s.code === 'TDS');
    await api.put(c, `/statutory/schemes/${tds.id}`, { isEnabled: true }).expect(200);

    const mk = (payload: Record<string, unknown>) => api.post(c, '/components', payload).expect(201);
    const basic = await mk({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1 });
    const special = await mk({ name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 2 });
    const tdsLine = await mk({ name: 'Income tax', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 10 });
    const structure = await api
      .post(c, '/structures', {
        name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-04-01', status: 'ACTIVE',
        components: [
          { componentId: basic.body.component.id, displayOrder: 1 },
          { componentId: special.body.component.id, isBalancing: true, displayOrder: 2 },
          { componentId: tdsLine.body.component.id, displayOrder: 10 },
        ],
      })
      .expect(201);
    const person = await api
      .post(c, '/employees', { name: 'Flat salary', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-04-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' } })
      .expect(201);
    await api.post(c, '/assignments', { employeeId: person.body.employee.id, structureId: structure.body.structure.id, effectiveFrom: '2026-04-01', annualCtc: 2_400_000 }).expect(201);

    const sept = await payMonth(c, 'Sept 2026', '2026-09-01', '2026-09-30');
    const september = await tdsOf(sept);
    expect(september).toBeGreaterThan(0);
    await approve(c, sept);

    const oct = await payMonth(c, 'Oct 2026', '2026-10-01', '2026-10-31');
    const october = await tdsOf(oct);
    /* Same pay, same tax: the year's remaining tax over the months left, not the whole year's over fewer and fewer months. */
    expect(Math.abs(october - september)).toBeLessThanOrEqual(1);
  });
});
