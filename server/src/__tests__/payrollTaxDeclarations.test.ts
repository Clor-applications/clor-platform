import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Income tax declarations: limits per section, the HRA exemption, PF counted
 * in 80C, declared amounts before verification and proved ones after — and
 * the employee declaring from the portal.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { deductionsFor, financialYearOf } = await import('../services/payroll/taxDeclaration.js');

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

const decl = (over: Record<string, unknown> = {}) => ({
  status: 'SUBMITTED', regime: 'OLD', itemsJson: '[]', monthlyRent: 0, metroCity: false, seniorSelf: false, seniorParents: false, ...over,
});
const items = (rows: Array<{ code: string; declared: number; verified?: number }>) => JSON.stringify(rows);

describe('the deductions a declaration allows', () => {
  it('caps each section, counts PF towards 80C, and gives seniors the higher 80D limit', () => {
    const d = deductionsFor(
      decl({ itemsJson: items([{ code: '80C', declared: 100_000 }, { code: '80D_PARENTS', declared: 40_000 }, { code: '80CCD1B', declared: 80_000 }]), seniorParents: true }),
      { basic: 600_000, hra: 0, employeePf: 72_000 }
    );
    expect(Object.fromEntries(d.lines.map((l) => [l.code, l.allowed]))).toEqual({ '80C': 150_000, '80D_PARENTS': 40_000, '80CCD1B': 50_000 });
    expect(d.total).toBe(240_000);
  });

  it('works out HRA as the least of HRA, rent less 10% of Basic, and 50% or 40% of Basic', () => {
    const basic = 600_000;
    // Rent ₹30,000 a month: rent less 10% of Basic is ₹3,00,000; HRA received ₹2,40,000 is the least.
    expect(deductionsFor(decl({ monthlyRent: 30_000, metroCity: true }), { basic, hra: 240_000, employeePf: 0 }).total).toBe(240_000);
    // Rent ₹20,000: ₹2,40,000 − ₹60,000 = ₹1,80,000.
    expect(deductionsFor(decl({ monthlyRent: 20_000 }), { basic, hra: 240_000, employeePf: 0 }).total).toBe(180_000);
    // Outside a metro, 40% of Basic (₹2,40,000) would bind only with more rent and HRA.
    expect(deductionsFor(decl({ monthlyRent: 50_000 }), { basic, hra: 400_000, employeePf: 0 }).total).toBe(240_000);
  });

  it('uses verified amounts once verified, and nothing under the new regime', () => {
    const rows = items([{ code: '80C', declared: 150_000, verified: 60_000 }]);
    expect(deductionsFor(decl({ itemsJson: rows }), { basic: 0, hra: 0, employeePf: 0 }).total).toBe(150_000);
    expect(deductionsFor(decl({ itemsJson: rows, status: 'VERIFIED' }), { basic: 0, hra: 0, employeePf: 0 }).total).toBe(60_000);
    expect(deductionsFor(decl({ itemsJson: rows, regime: 'NEW' }), { basic: 0, hra: 0, employeePf: 0 }).total).toBe(0);
  });

  it('names the financial year', () => {
    expect(financialYearOf('2026-04-01')).toBe('2026-27');
    expect(financialYearOf('2027-03-31')).toBe('2026-27');
    expect(financialYearOf('2099-12-01')).toBe('2099-00');
  });
});

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
  const period = await api.post(c, '/periods', { name: `Sept ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' }).expect(201);
  const run = (await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201)).body.run.id;
  return { employeeId, run };
}

async function tdsOf(c: Ctx, run: string, employeeId: string) {
  await api.post(c, `/runs/${run}/validate`).expect(200);
  await api.post(c, `/runs/${run}/calculate`).expect(200);
  const slip = await payrollPrisma.salarySlip.findFirst({ where: { runId: run, employeeId } });
  const line = await payrollPrisma.salarySlipLine.findFirst({ where: { slipId: slip!.id, componentCode: 'TDS' } });
  return Number(line?.amount ?? 0);
}

/*
 * September: ₹1,00,000 a month for the 7 months left is ₹7,00,000; less the
 * old regime's ₹50,000 standard deduction, ₹6,50,000 taxable — ₹42,500 of tax,
 * ₹44,200 with cess, ₹6,314 a month. With ₹1,00,000 under 80C, ₹5,50,000:
 * ₹22,500, ₹23,400 with cess, ₹3,343 a month.
 */
describe('a declaration on the payslip', () => {
  it('lowers TDS by what was declared, then by what was verified; HR sets the verified amounts', async () => {
    const c = await makeOwner();
    const { employeeId, run } = await setUp(c);
    const none = await tdsOf(c, run, employeeId);
    expect(none).toBeCloseTo(44_200 / 7, 0);

    const body = { regime: 'OLD', items: [{ code: '80C', declared: 100_000 }] };
    await api.put(c, `/tax-declarations/${employeeId}?fy=2026-27`, body).expect(200);
    expect(await tdsOf(c, run, employeeId)).toBeCloseTo(23_400 / 7, 0);

    // Proofs for only ₹40,000: ₹6,10,000 taxable, ₹34,500 + cess = ₹35,880.
    await api.put(c, `/tax-declarations/${employeeId}?fy=2026-27`, { ...body, items: [{ code: '80C', declared: 100_000, verified: 40_000 }] }).expect(200);
    const verified = await api.post(c, `/tax-declarations/${employeeId}/verify?fy=2026-27`).expect(200);
    expect(verified.body.declaration.status).toBe('VERIFIED');
    expect(await tdsOf(c, run, employeeId)).toBeCloseTo(35_880 / 7, 0);
    const slip = await payrollPrisma.salarySlip.findFirst({ where: { runId: run, employeeId } });
    expect(slip!.statutorySnapshotJson).toContain('verified deductions');

    expect((await api.put(c, `/tax-declarations/${employeeId}?fy=2026-27`, body).expect(409)).body.code).toBe('VERIFIED');
    await api.post(c, `/tax-declarations/${employeeId}/reopen?fy=2026-27`).expect(200);
    const list = await api.get(c, '/tax-declarations?fy=2026-27').expect(200);
    expect(list.body.people).toEqual([expect.objectContaining({ employeeId, regime: 'OLD', status: 'SUBMITTED' })]);
  });

  it('switching to the new regime ignores the deductions', async () => {
    const c = await makeOwner();
    const { employeeId, run } = await setUp(c);
    await api.put(c, `/tax-declarations/${employeeId}?fy=2026-27`, { regime: 'NEW', items: [{ code: '80C', declared: 150_000 }] }).expect(200);
    const profile = await payrollPrisma.employeePayrollProfile.findFirst({ where: { employeeId } });
    expect(profile!.taxRegime).toBe('NEW');
    // New regime: ₹7,00,000 − ₹75,000 is under the ₹12 lakh rebate line.
    expect(await tdsOf(c, run, employeeId)).toBe(0);
  });

  it('needs the landlord’s PAN for rent over ₹1 lakh a year', async () => {
    const c = await makeOwner();
    const { employeeId } = await setUp(c);
    expect((await api.put(c, `/tax-declarations/${employeeId}`, { regime: 'OLD', monthlyRent: 15_000 }).expect(400)).body.code).toBe('LANDLORD_PAN');
    await api.put(c, `/tax-declarations/${employeeId}`, { regime: 'OLD', monthlyRent: 15_000, landlordPan: 'abcde1234f' }).expect(200);
  });
});

describe('declaring from the portal', () => {
  it('saves what the employee declares as submitted, and leaves verified amounts to HR', async () => {
    const c = await makeOwner();
    const { employeeId } = await setUp(c);
    const access = await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200);
    const code = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employeeId] }).expect(200)).body.codes[0].activationCode;
    const token = (await request(app).post('/api/portal/activate').send({ company: access.body.company.code, employeeCode: 'T101', activationCode: code, password: 'mine pass 1' }).expect(200)).body.token;
    const portal = { get: () => request(app).get('/api/portal/tax').set('Authorization', `Bearer ${token}`), put: (b: unknown) => request(app).put('/api/portal/tax').set('Authorization', `Bearer ${token}`).send(b as any) };

    expect((await portal.get().expect(200)).body).toMatchObject({ available: true, declaration: { status: 'NONE', regime: 'NEW' } });
    const saved = await portal.put({ regime: 'OLD', items: [{ code: '80C', declared: 90_000, verified: 999_999 }] }).expect(200);
    expect(saved.body.declaration.status).toBe('SUBMITTED');
    expect(saved.body.declaration.items.find((i: any) => i.code === '80C')).toMatchObject({ declared: 90_000, verified: null });

    await api.post(c, `/tax-declarations/${employeeId}/verify`).expect(200);
    expect((await portal.put({ regime: 'OLD', items: [] }).expect(409)).body.code).toBe('VERIFIED');
  });
});
