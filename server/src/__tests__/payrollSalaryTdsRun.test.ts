import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Salary TDS through real payroll runs, for April 2026 (twelve months left).
 *
 * The engine's arithmetic is tested on its own (payrollSalaryTds.test.ts);
 * this holds shut what the run feeds it: taxable components rather than gross,
 * employer NPS, professional tax and age under the old regime, a previous
 * employer's Form 12B from the declaration, and the PAN — with a warning on
 * the run that the payroll admin sees before approving it.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

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
  const email = `stds.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Salary TDS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  await api.post(ctx, '/statutory/seed').expect(200);
  const { body } = await api.get(ctx, '/statutory').expect(200);
  for (const s of body.schemes.filter((x: any) => ['TDS', 'PT'].includes(x.code))) await api.put(ctx, `/statutory/schemes/${s.id}`, { isEnabled: true }).expect(200);
  return ctx;
}

const component = async (c: Ctx, payload: Record<string, unknown>) => (await api.post(c, '/components', payload).expect(201)).body.component;
const structure = async (c: Ctx, lines: Array<{ id: string; balancing?: boolean }>) =>
  (
    await api
      .post(c, '/structures', {
        name: `Staff ${rnd()}`,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        status: 'ACTIVE',
        components: lines.map((l, i) => ({ componentId: l.id, displayOrder: i + 1, ...(l.balancing ? { isBalancing: true } : {}) })),
      })
      .expect(201)
  ).body.structure.id;

async function person(c: Ctx, structureId: string, annualCtc: number, payroll: Record<string, unknown> = {}) {
  const made = await api
    .post(c, '/employees', { name: `Person ${rnd()}`, code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-04-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', ...payroll } })
    .expect(201);
  const id = made.body.employee.id;
  await api.post(c, '/assignments', { employeeId: id, structureId, effectiveFrom: '2026-04-01', annualCtc }).expect(201);
  return id;
}

async function april(c: Ctx) {
  const period = await api.post(c, '/periods', { name: `April 2026 ${rnd()}`, startDate: '2026-04-01', endDate: '2026-04-30', paymentDate: '2026-04-30' }).expect(201);
  const id = (await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201)).body.run.id;
  const checks = (await api.post(c, `/runs/${id}/validate`).expect(200)).body;
  await api.post(c, `/runs/${id}/calculate`).expect(200);
  const slips = await payrollPrisma.salarySlip.findMany({ where: { runId: id }, include: { lines: true } });
  const line = (employeeId: string, code: string) =>
    Number(slips.find((s) => s.employeeId === employeeId)?.lines.find((l) => l.componentCode === code)?.amount ?? NaN);
  return { checks, line };
}

const PAN = 'ABCDE1234F';

describe('salary TDS in a payroll run', () => {
  it('taxes taxable components only, and 20% with a warning where there is no PAN', async () => {
    const c = await makeOwner();
    const basic = await component(c, { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1 });
    /* Paid against bills: in gross, not taxed. */
    const reimb = await component(c, { name: 'Fuel reimbursement', code: 'FUEL', type: 'EARNING', calculationMethod: 'FIXED', amount: 20_000, isTaxable: false, displayOrder: 2 });
    const special = await component(c, { name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 3 });
    const tds = await component(c, { name: 'Income tax', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 10 });
    const s = await structure(c, [{ id: basic.id }, { id: reimb.id }, { id: special.id, balancing: true }, { id: tds.id }]);

    const withPan = await person(c, s, 2_400_000, { pan: PAN });
    const without = await person(c, s, 2_400_000);
    const { checks, line } = await april(c);

    /* ₹2,00,000 a month less the ₹20,000 reimbursement = ₹21,60,000 a year; less 75,000 = 20,85,000:
       20,000 + 40,000 + 60,000 + 80,000 + 25% of 85,000 = 2,21,250, + cess = 2,30,100, / 12. On gross it was 24,375. */
    expect(line(withPan, 'TDS')).toBe(19_175);
    /* No PAN: 20% of 20,85,000 = 4,17,000, / 12. */
    expect(line(without, 'TDS')).toBe(34_750);

    const noPan = checks.issues.filter((i: any) => i.code === 'NO_PAN');
    expect(noPan.map((i: any) => i.employeeId)).toEqual([without]);
    expect(noPan[0].severity).toBe('WARNING');
    expect(noPan[0].message).toMatch(/20%/);
  });

  it('counts employer NPS as salary and allows it to 14% of Basic', async () => {
    const c = await makeOwner();
    const basic = await component(c, { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'FIXED', amount: 150_000, displayOrder: 1 });
    const nps = await component(c, {
      name: 'Employer NPS', code: 'PENSION_CO', type: 'EMPLOYER_CONTRIBUTION', calculationMethod: 'FIXED', amount: 25_000,
      includeInGross: false, includeInNetPay: false, isTaxable: false, taxSection: 'EMPLOYER_NPS', displayOrder: 2,
    });
    expect(nps.taxSection).toBe('EMPLOYER_NPS');
    const tds = await component(c, { name: 'Income tax', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 10 });
    const s = await structure(c, [{ id: basic.id }, { id: nps.id }, { id: tds.id }]);
    const id = await person(c, s, 2_100_000, { pan: PAN });
    const { line } = await april(c);

    /* ₹18 lakh Basic + ₹3 lakh NPS = ₹21 lakh; NPS allowed to 14% of 18 lakh = 2,52,000; less 75,000 = 17,73,000:
       1,20,000 + 20% of 1,73,000 = 1,54,600, + cess = 1,60,784, / 12. */
    expect(line(id, 'TDS')).toBe(13_399);
  });

  it('refuses to mark a deduction as employer NPS', async () => {
    const c = await makeOwner();
    await api
      .post(c, '/components', { name: 'NPS', code: 'NPS_X', type: 'DEDUCTION', calculationMethod: 'FIXED', amount: 100, taxSection: 'EMPLOYER_NPS' })
      .expect(400);
  });

  it('takes professional tax off and uses a senior’s slabs under the old regime', async () => {
    const c = await makeOwner();
    const basic = await component(c, { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1 });
    const special = await component(c, { name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 2 });
    const pt = await component(c, { name: 'Professional Tax', code: 'PT', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PT', includeInGross: false, isTaxable: false, displayOrder: 9 });
    const tds = await component(c, { name: 'Income tax', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 10 });
    const s = await structure(c, [{ id: basic.id }, { id: special.id, balancing: true }, { id: pt.id }, { id: tds.id }]);
    const old = { pan: PAN, taxRegime: 'OLD', ptApplicable: true, professionalTaxState: 'Karnataka' };
    const senior = await person(c, s, 900_000, old);
    const younger = await person(c, s, 900_000, old);
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: senior }, data: { dateOfBirth: '1960-01-01' } }));
    await runInTenant(c.orgId, () => peoplePrisma.employee.update({ where: { id: younger }, data: { dateOfBirth: '1990-01-01' } }));
    const { line } = await april(c);

    /* Karnataka: ₹200 this month, so ₹2,400 for the year as April projects it. */
    expect(line(senior, 'PT')).toBe(200);
    /* ₹9 lakh less 50,000 less 2,400 = 8,47,600.
       Senior: 10,000 + 20% of 3,47,600 = 79,520, + cess = 82,700.80, / 12.
       Under 60: 12,500 + 20% of 3,47,600 = 82,020, + cess = 85,300.80, / 12. */
    expect(line(senior, 'TDS')).toBe(Math.round(82_700.8 / 12));
    expect(line(younger, 'TDS')).toBe(Math.round(85_300.8 / 12));
  });

  it('adds a previous employer’s salary and TDS from the declaration (Form 12B)', async () => {
    const c = await makeOwner();
    const basic = await component(c, { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1 });
    const special = await component(c, { name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 2 });
    const tds = await component(c, { name: 'Income tax', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 10 });
    const s = await structure(c, [{ id: basic.id }, { id: special.id, balancing: true }, { id: tds.id }]);
    const id = await person(c, s, 1_200_000, { pan: PAN });

    const saved = await api
      .put(c, `/tax-declarations/${id}?fy=2026-27`, { regime: 'NEW', previousEmployer: { name: 'Earlier Ltd', income: 1_000_000, professionalTax: 0, tds: 50_000 } })
      .expect(200);
    expect(saved.body.declaration.previousEmployer).toEqual({ name: 'Earlier Ltd', income: 1_000_000, professionalTax: 0, tds: 50_000 });
    await api.put(c, `/tax-declarations/${id}?fy=2026-27`, { regime: 'NEW', previousEmployer: { income: 0, professionalTax: 3_000, tds: 0 } }).expect(400);

    const { line } = await april(c);
    /* ₹12 lakh here + ₹10 lakh there = 22 lakh, less 75,000 = 21,25,000: 2,00,000 + 25% of 1,25,000 = 2,31,250,
       + cess = 2,40,500, less 50,000 already withheld, / 12. Here alone it would be nil. */
    expect(line(id, 'TDS')).toBe(15_875);
  });
});
