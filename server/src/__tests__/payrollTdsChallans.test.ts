import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Salary TDS deposits, a row per month (round 27 pick): the tax deducted in
 * each month, the challans recorded against it, what is left, and the 24Q
 * rows carrying the challan's BSR code, serial and date. Also the payroll
 * details' professional tax state taken from the work site (round 25 pick).
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { depositDue, monthsOf } = await import('../services/payroll/tdsChallans.js');

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
  del: (c: Ctx, path: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `tds.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `TDS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  await api.put(c, '/opening-ytd-first-year?fy=2026-27', { firstYear: true, reason: 'First year of paying salaries' }).expect(200);
  return c;
}

/** ₹24 lakh CTC on the new regime, so tax is deducted each month. */
async function setUp(c: Ctx) {
  await api.post(c, '/statutory/seed').expect(200);
  const { body } = await api.get(c, '/statutory').expect(200);
  await api.put(c, `/statutory/schemes/${body.schemes.find((s: any) => s.code === 'TDS').id}`, { isEnabled: true }).expect(200);
  const mk = async (p: Record<string, unknown>) => (await api.post(c, '/components', p).expect(201)).body.component.id;
  const ids = [
    await mk({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }),
    await mk({ name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 2 }),
    await mk({ name: 'Income tax', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 10 }),
  ];
  const structure = await api
    .post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-04-01', status: 'ACTIVE', components: ids.map((componentId, i) => ({ componentId, displayOrder: i + 1, ...(i === 1 ? { isBalancing: true } : {}) })) })
    .expect(201);
  const person = await api
    .post(c, '/employees', { name: 'Meera Iyer', code: 'D101', dateOfJoining: '2026-04-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pan: 'ABCDE1234F' } })
    .expect(201);
  const employeeId = person.body.employee.id;
  await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: '2026-04-01', annualCtc: 2_400_000 }).expect(201);
  return { employeeId };
}

async function payMonth(c: Ctx, start: string, end: string) {
  const period = await api.post(c, '/periods', { name: `M ${start} ${rnd()}`, startDate: start, endDate: end, paymentDate: end }).expect(201);
  const run = (await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201)).body.run.id;
  for (const step of ['validate', 'calculate', 'submit-review', 'approve']) await api.post(c, `/runs/${run}/${step}`).expect(200);
}

describe('deposit due dates', () => {
  it('is the 7th of the next month, and 30 April for March', () => {
    expect([depositDue('2026-05'), depositDue('2026-12'), depositDue('2027-03')]).toEqual(['2026-06-07', '2027-01-07', '2027-04-30']);
    expect(monthsOf('2026-27')[0]).toBe('2026-04');
    expect(monthsOf('2026-27')[11]).toBe('2027-03');
  });
});

describe('TDS challans', () => {
  it('lists twelve months, takes a challan against one, and puts it on the 24Q rows', async () => {
    const c = await makeOwner();
    await setUp(c);
    await payMonth(c, '2026-09-01', '2026-09-30');

    const before = (await api.get(c, '/reports/tds-challans?fy=2026-27').expect(200)).body;
    expect(before.months).toHaveLength(12);
    const sept = before.months.find((m: any) => m.month === '2026-09');
    expect(sept.tds).toBeGreaterThan(0);
    expect(sept).toMatchObject({ deposited: 0, left: sept.tds, due: '2026-10-07', challans: [] });

    const q2before = (await api.get(c, '/reports/24q?fy=2026-27&quarter=2').expect(200)).body;
    expect(q2before.noChallan).toEqual(['2026-09']);

    /* Wrong shapes are refused in plain words. */
    await api.post(c, '/tds-challans', { financialYear: '2026-27', month: '2026-09', bsrCode: '12345', challanSerial: '1', depositDate: '2026-10-05', amount: 100 }).expect(400);
    await api.post(c, '/tds-challans', { financialYear: '2026-27', month: '2027-09', bsrCode: '0510308', challanSerial: '1', depositDate: '2026-10-05', amount: 100 }).expect(400);
    await api.post(c, '/tds-challans', { financialYear: '2026-27', month: '2026-09', bsrCode: '0510308', challanSerial: '1', depositDate: '2026-08-05', amount: 100 }).expect(400);

    const made = await api
      .post(c, '/tds-challans', { financialYear: '2026-27', month: '2026-09', bsrCode: '0510308', challanSerial: '00042', depositDate: '2026-10-05', amount: sept.tds })
      .expect(201);
    await api.post(c, '/tds-challans', { financialYear: '2026-27', month: '2026-09', bsrCode: '0510308', challanSerial: '00042', depositDate: '2026-10-05', amount: 1 }).expect(409);

    const after = (await api.get(c, '/reports/tds-challans?fy=2026-27').expect(200)).body;
    const sept2 = after.months.find((m: any) => m.month === '2026-09');
    expect(sept2).toMatchObject({ deposited: sept.tds, left: 0, late: false });
    expect(sept2.challans).toEqual([expect.objectContaining({ bsrCode: '0510308', challanSerial: '00042', depositDate: '2026-10-05' })]);
    expect(after.totals.left).toBe(0);

    const q2 = (await api.get(c, '/reports/24q?fy=2026-27&quarter=2').expect(200)).body;
    expect(q2.rows[0]).toMatchObject({ bsrCode: '0510308', challanSerial: '00042', depositDate: '2026-10-05' });
    expect(q2.noChallan).toEqual([]);

    await api.del(c, `/tds-challans/${made.body.id}`).expect(200);
    const gone = (await api.get(c, '/reports/tds-challans?fy=2026-27').expect(200)).body;
    expect(gone.months.find((m: any) => m.month === '2026-09').deposited).toBe(0);
    await api.del(c, `/tds-challans/${made.body.id}`).expect(404);
  });

  it('does not show one company’s challans to another', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const made = await api.post(a, '/tds-challans', { financialYear: '2026-27', month: '2026-04', bsrCode: '0510308', challanSerial: '7', depositDate: '2026-05-06', amount: 500 }).expect(201);
    const seen = (await api.get(b, '/reports/tds-challans?fy=2026-27').expect(200)).body;
    expect(seen.months.every((m: any) => m.challans.length === 0)).toBe(true);
    await api.del(b, `/tds-challans/${made.body.id}`).expect(404);
  });
});

describe('professional tax state from the work site', () => {
  it('is offered on the payroll details and filled on save when PT is on and no state is set', async () => {
    const c = await makeOwner();
    const person = await api.post(c, '/employees', { name: 'Site Person', code: 'S1', dateOfJoining: '2026-04-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL' } }).expect(201);
    const id = person.body.employee.id;
    const employee = await peoplePrisma.employee.findFirstOrThrow({ where: { id } });
    const site = await peoplePrisma.establishment.create({ data: { accountId: employee.accountId, orgId: c.orgId, name: 'Pune works', state: 'Maharashtra', kind: 'FACTORY' } });
    await peoplePrisma.employee.update({ where: { id }, data: { establishmentId: site.id } });

    const read = (await api.get(c, `/employees/${id}`).expect(200)).body;
    expect(read.ptFromSite).toEqual({ state: 'Maharashtra', site: 'Pune works' });

    const saved = (await api.put(c, `/employees/${id}`, { name: 'Site Person', code: 'S1', status: 'ACTIVE', payroll: { ptApplicable: true, professionalTaxState: '' } }).expect(200)).body;
    expect(saved.employee.payroll.professionalTaxState).toBe('Maharashtra');

    /* A state somebody chose stays. */
    const chosen = (await api.put(c, `/employees/${id}`, { name: 'Site Person', code: 'S1', status: 'ACTIVE', payroll: { ptApplicable: true, professionalTaxState: 'Karnataka' } }).expect(200)).body;
    expect(chosen.employee.payroll.professionalTaxState).toBe('Karnataka');
  });
});
