import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Form 16 Part B and Form 24Q Annexure I, read from approved payslips and
 * worked out with the same tax function as monthly TDS.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { quarterOf } = await import('../services/payroll/form16.js');

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
  const email = `tax.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Tax Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  /* Its payroll starts in September with nothing earlier to bring in (audit 7 Nov 2026, #2). */
  await api.put(c, '/opening-ytd-first-year?fy=2026-27', { firstYear: true, reason: 'First year of paying salaries' }).expect(200);
  return c;
}

/** ₹12 lakh CTC, old regime: Basic 50%, HRA 20%, the rest Special; TDS on. */
async function setUp(c: Ctx) {
  await api.post(c, '/statutory/seed').expect(200);
  const { body } = await api.get(c, '/statutory').expect(200);
  await api.put(c, `/statutory/schemes/${body.schemes.find((s: any) => s.code === 'TDS').id}`, { isEnabled: true }).expect(200);
  const mk = async (p: Record<string, unknown>) => (await api.post(c, '/components', p).expect(201)).body.component.id;
  const ids = [
    await mk({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }),
    await mk({ name: 'House rent allowance', code: 'HRA', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 20, calculationBase: 'MONTHLY_CTC', displayOrder: 2 }),
    await mk({ name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 3 }),
    await mk({ name: 'Income tax', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 10 }),
  ];
  const structure = await api
    .post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-04-01', status: 'ACTIVE', components: ids.map((componentId, i) => ({ componentId, displayOrder: i + 1, ...(i === 2 ? { isBalancing: true } : {}) })) })
    .expect(201);
  const person = await api
    .post(c, '/employees', { name: 'Ravi Kumar', code: 'T101', dateOfJoining: '2026-04-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'OLD', pan: 'ABCDE1234F' } })
    .expect(201);
  const employeeId = person.body.employee.id;
  await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-04-01', annualCtc: 1_200_000 }).expect(201);
  return { employeeId };
}

async function payMonth(c: Ctx, start: string, end: string) {
  const period = await api.post(c, '/periods', { name: `M ${start} ${rnd()}`, startDate: start, endDate: end, paymentDate: end }).expect(201);
  const run = (await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201)).body.run.id;
  for (const step of ['validate', 'calculate', 'submit-review', 'approve']) await api.post(c, `/runs/${run}/${step}`).expect(200);
  return run;
}

describe('quarters', () => {
  it('runs April–June as the first and January–March as the fourth', () => {
    expect([quarterOf('2026-04-30'), quarterOf('2026-09-01'), quarterOf('2026-12-31'), quarterOf('2027-03-01')]).toEqual([1, 2, 3, 4]);
  });
});

describe('Form 16 and 24Q', () => {
  it('certifies the year paid so far, and lists each month’s TDS in its quarter', async () => {
    const c = await makeOwner();
    const { employeeId } = await setUp(c);
    await api.put(c, `/tax-declarations/${employeeId}?fy=2026-27`, { regime: 'OLD', items: [{ code: '80C', declared: 100_000 }] }).expect(200);
    await payMonth(c, '2026-09-01', '2026-09-30');
    await payMonth(c, '2026-10-01', '2026-10-31');

    const f = (await api.get(c, `/reports/form16?fy=2026-27&employeeId=${employeeId}`).expect(200)).body;
    const p = f.people[0];
    /* Two months of ₹1,00,000: ₹2,00,000 less ₹50,000 standard and ₹1,00,000 under 80C is ₹50,000 — no tax on that. */
    expect(p).toMatchObject({ pan: 'ABCDE1234F', panValid: true, regime: 'OLD', gross: 200_000, standardDeduction: 50_000, taxable: 50_000, taxPayable: 0 });
    expect(p.chapterVIA).toEqual([expect.objectContaining({ code: '80C', allowed: 100_000 })]);
    expect(p.months.map((m: any) => m.month)).toEqual(['2026-09', '2026-10']);
    /* TDS was withheld on the projected year, so the certificate shows it was over-deducted so far. */
    expect(p.tdsDeducted).toBeGreaterThan(0);
    expect(p.balance).toBe(-p.tdsDeducted);

    const q2 = (await api.get(c, '/reports/24q?fy=2026-27&quarter=2').expect(200)).body;
    expect(q2.rows).toEqual([expect.objectContaining({ pan: 'ABCDE1234F', section: '192', paymentDate: '2026-09-30', amountPaid: 100_000, tds: p.months[0].tds })]);
    expect(q2.problems).toEqual([]);
    const q3 = (await api.get(c, '/reports/24q?fy=2026-27&quarter=3').expect(200)).body;
    expect(q3.rows.map((r: any) => r.paymentDate)).toEqual(['2026-10-31']);
    expect(q3.total).toBe(p.months[1].tds);

    await api.get(c, '/reports/24q?fy=2026-27&quarter=5').expect(400);
    await api.get(c, '/reports/form16?fy=2026').expect(400);
  });
});
