import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * The month's statutory files, read from real payslips: the PF ECR text, the
 * ESIC contribution rows and the professional tax counts — and the people a
 * file cannot carry, listed rather than dropped silently.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { ecrLine } = await import('../services/payroll/filings.js');

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
  const email = `file.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `File Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true } }).expect(200);
  return c;
}

/** PF, ESI and Karnataka PT switched on; Basic half of CTC, the rest Special. */
async function setUp(c: Ctx) {
  await api.post(c, '/statutory/seed').expect(200);
  const { body } = await api.get(c, '/statutory').expect(200);
  for (const s of body.schemes.filter((x: any) => ['PF', 'ESI', 'PT'].includes(x.code))) {
    await api.put(c, `/statutory/schemes/${s.id}`, { isEnabled: true }).expect(200);
  }
  const mk = async (p: Record<string, unknown>) => (await api.post(c, '/components', p).expect(201)).body.component.id;
  const ids = [
    await mk({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', includeInPfWage: true, includeInEsiWage: true, displayOrder: 1 }),
    await mk({ name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', includeInEsiWage: true, displayOrder: 2 }),
    await mk({ name: 'Employee PF', code: 'EPF', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, isTaxable: false, displayOrder: 10 }),
    await mk({ name: 'Employer PF', code: 'ER_PF', type: 'EMPLOYER_CONTRIBUTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, includeInNetPay: false, isTaxable: false, displayOrder: 20 }),
    await mk({ name: 'Employee ESI', code: 'EESI', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'ESI', includeInGross: false, isTaxable: false, displayOrder: 11 }),
    await mk({ name: 'Employer ESI', code: 'ER_ESI', type: 'EMPLOYER_CONTRIBUTION', calculationMethod: 'STATUTORY', statutoryScheme: 'ESI', includeInGross: false, includeInNetPay: false, isTaxable: false, displayOrder: 21 }),
    await mk({ name: 'Professional Tax', code: 'PT', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PT', includeInGross: false, isTaxable: false, displayOrder: 12 }),
  ];
  const structure = await api
    .post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: ids.map((componentId, i) => ({ componentId, displayOrder: i + 1, ...(i === 1 ? { isBalancing: true } : {}) })) })
    .expect(201);
  const period = await api.post(c, '/periods', { name: `Sept ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201);
  return { structureId: structure.body.structure.id, periodId: period.body.period.id };
}

async function person(c: Ctx, structureId: string, name: string, monthly: number, payroll: Record<string, unknown>) {
  const made = await api
    .post(c, '/employees', { name, code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pfApplicable: true, esiApplicable: true, ptApplicable: true, professionalTaxState: 'Karnataka', ...payroll } })
    .expect(201);
  await api.post(c, '/assignments', { employeeId: made.body.employee.id, structureId, effectiveFrom: '2026-01-01', annualCtc: monthly * 12 }).expect(201);
  return made.body.employee.id;
}

describe('statutory files', () => {
  it('writes the ECR, ESIC rows and PT counts from the payslips, and lists who is missing an identifier', async () => {
    const c = await makeOwner();
    const { structureId, periodId } = await setUp(c);
    // ₹20,000 a month: Basic ₹10,000, under the ESI ceiling and under Karnataka's PT threshold.
    const asha = await person(c, structureId, 'Asha Rao', 20_000, { uan: '100200300400', esiNumber: '3100123456' });
    // ₹60,000 a month: Basic ₹30,000 (PF wages capped at ₹15,000), over ESI, pays ₹200 PT.
    await person(c, structureId, 'Vikram Shetty', 60_000, { uan: '100200300401', esiNumber: '' });
    // No UAN: cannot go in the ECR.
    await person(c, structureId, 'Nobody Uan', 20_000, { esiNumber: '' });

    const run = (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id;
    await api.post(c, `/runs/${run}/validate`).expect(200);
    await api.post(c, `/runs/${run}/calculate`).expect(200);

    const f = (await api.get(c, `/reports/filings?periodId=${periodId}`).expect(200)).body;

    /*
     * Asha's ₹20,000 CTC is gross ₹18,208 + employer PF ₹1,200 + employer ESI ₹592:
     * ESI is on the ₹18,208 actually paid (0.75% = ₹137), not on the ₹20,000.
     * ECR: UAN, name, gross, EPF/EPS/EDLI wages, EE 12%, EPS 8.33%, ER 3.67%, NCP, refund. */
    const lines = f.ecr.text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines).toContain('100200300400#~#ASHA RAO#~#18208#~#10000#~#10000#~#10000#~#1200#~#833#~#367#~#0#~#0');
    expect(lines).toContain('100200300401#~#VIKRAM SHETTY#~#58200#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0');
    expect(f.ecr.problems).toEqual([expect.objectContaining({ name: 'Nobody Uan', message: expect.stringContaining('No UAN') })]);

    /* ESIC: Asha only (Vikram is over the ceiling); the person without an IP number is listed. */
    expect(f.esic.rows).toEqual([expect.objectContaining({ employeeId: asha, ipNumber: '3100123456', days: 30, wages: 18208, reason: 0, lastWorkingDay: '', employee: 137, employer: 592 })]);
    expect(f.esic.problems.map((p: { name: string }) => p.name)).toEqual(['Nobody Uan']);

    /* PT: one person at ₹200 in Karnataka. */
    expect(f.pt.states).toEqual([
      expect.objectContaining({ state: 'Karnataka', slabs: [{ amount: 200, count: 1, total: 200 }], people: 1, employee: 200, total: 200, dueDate: '2026-10-20', form: expect.stringContaining('Form 5') }),
    ]);
    /* The screen says plainly where it is filed: CLOR makes no state upload file. */
    expect(f.pt.note).toMatch(/state portal/);
  });

  it('keeps the separator and line breaks out of a name', () => {
    const line = ecrLine({ employeeId: 'x', uan: '100200300400', name: 'A#~#B\nC', gross: 1, epfWages: 1, epsWages: 1, edliWages: 1, epfContribution: 0, epsContribution: 0, difference: 0, ncpDays: 0, refund: 0 });
    expect(line.split('#~#')).toHaveLength(11);
    expect(line).toContain('A B C');
  });

  it('needs a pay period', async () => {
    const c = await makeOwner();
    await api.get(c, '/reports/filings').expect(400);
  });
});
