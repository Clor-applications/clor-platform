import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Minimum wages per state (round 66): rates HR enters or imports by state,
 * zone and skill level from a date; each person's skill level; the warning in
 * the pay run and on a salary; the April and October reminder.
 *
 * Every rate below is a TEST figure, not a real state's notified rate.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { rateFor, minimumWageCheck, parseRatesCsv, revisionReminder, skillOf } = await import('../services/payroll/minimumWage.js');

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
  const email = `minwage.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `MinWage Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  await api.put(c, '/opening-ytd-first-year?fy=2026-27', { firstYear: true, reason: 'First year of paying salaries' }).expect(200);
  return c;
}

/** Basic half of CTC, the rest special allowance; Basic counts as wages. */
async function structure(c: Ctx) {
  const mk = async (p: Record<string, unknown>) => (await api.post(c, '/components', p).expect(201)).body.component.id;
  const ids = [
    await mk({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', includeInGratuityWage: true, displayOrder: 1 }),
    await mk({ name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 2 }),
  ];
  const s = await api
    .post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-04-01', status: 'ACTIVE', components: ids.map((componentId, i) => ({ componentId, displayOrder: i + 1, ...(i === 1 ? { isBalancing: true } : {}) })) })
    .expect(201);
  return s.body.structure.id as string;
}

const RATES = [
  { state: 'KARNATAKA', zone: '', skill: 'SEMI_SKILLED', effectiveFrom: '2026-04-01', monthlyRate: 15000 },
  { state: 'KARNATAKA', zone: '', skill: 'SEMI_SKILLED', effectiveFrom: '2026-10-01', monthlyRate: 15500 },
  { state: 'KARNATAKA', zone: 'Zone I', skill: 'SEMI_SKILLED', effectiveFrom: '2026-04-01', monthlyRate: 16000 },
];

describe('minimum wage rules', () => {
  it('reads skill levels in plain words', () => {
    expect([skillOf('semi skilled'), skillOf('Semi-Skilled'), skillOf('highly skilled'), skillOf('UNSKILLED'), skillOf('expert')]).toEqual(['SEMI_SKILLED', 'SEMI_SKILLED', 'HIGHLY_SKILLED', 'UNSKILLED', null]);
  });

  it('takes the latest rate in force, and a zone row before the whole state', () => {
    expect(Number(rateFor(RATES, 'Karnataka', '', 'SEMI_SKILLED', '2026-09-30')!.monthlyRate)).toBe(15000);
    expect(Number(rateFor(RATES, 'KA', null, 'SEMI_SKILLED', '2026-10-31')!.monthlyRate)).toBe(15500);
    expect(Number(rateFor(RATES, 'Karnataka', 'zone i', 'SEMI_SKILLED', '2026-10-31')!.monthlyRate)).toBe(16000);
    /* A zone with no row of its own falls back to the whole state. */
    expect(Number(rateFor(RATES, 'Karnataka', 'Zone III', 'SEMI_SKILLED', '2026-10-31')!.monthlyRate)).toBe(15500);
    expect(rateFor(RATES, 'Karnataka', '', 'SKILLED', '2026-10-31')).toBeNull();
    expect(rateFor(RATES, 'Karnataka', '', 'SEMI_SKILLED', '2026-03-31')).toBeNull();
  });

  it('says below the minimum in plain words, on wages as the codes count them', () => {
    const below = minimumWageCheck({ rows: RATES, state: 'Karnataka', skill: 'SEMI_SKILLED', onDate: '2026-11-30', wages: 7000, gross: 14000 });
    expect(below).toMatchObject({ below: true, minimum: 15500, pays: 7000, shortBy: 8500 });
    expect(below!.message).toBe('Below minimum wage for Karnataka, semi-skilled: ₹15,500 a month, pays ₹7,000');
    /* Wages under half of pay count as half (labour codes). */
    expect(minimumWageCheck({ rows: RATES, state: 'Karnataka', skill: 'SEMI_SKILLED', onDate: '2026-11-30', wages: 5000, gross: 40000 })).toMatchObject({ pays: 20000, below: false });
    expect(minimumWageCheck({ rows: RATES, state: '', skill: 'SEMI_SKILLED', onDate: '2026-11-30', wages: 1, gross: 2 })).toBeNull();
  });

  it('reads a CSV, reporting every bad line by number', () => {
    const good = parseRatesCsv('state,zone,skill,effective_from,monthly_rate,note\nKarnataka,,semi-skilled,2026-04-01,"15,000",Notification 1\nKarnataka,Zone I,Skilled,2026-04-01,17000,\n');
    expect(good.errors).toEqual([]);
    expect(good.rows).toEqual([
      { state: 'KARNATAKA', zone: '', skill: 'SEMI_SKILLED', effectiveFrom: '2026-04-01', monthlyRate: 15000, note: 'Notification 1' },
      { state: 'KARNATAKA', zone: 'Zone I', skill: 'SKILLED', effectiveFrom: '2026-04-01', monthlyRate: 17000, note: null },
    ]);
    const bad = parseRatesCsv('state,skill,effective_from,monthly_rate\nKarnataka,expert,2026-04-01,100\n,unskilled,2026-04-01,100\nKarnataka,unskilled,1 April,100\nKarnataka,unskilled,2026-04-01,0\n');
    expect(bad.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(parseRatesCsv('state,rate\nKarnataka,1').errors[0].error).toMatch(/skill, effective_from, monthly_rate are missing/);
  });

  it('reminds from 1 April and 1 October for states in use with older rates', () => {
    expect(revisionReminder('2026-09-15', RATES, ['Karnataka'])).toBeNull();
    const oct = revisionReminder('2027-01-10', RATES.filter((r) => r.effectiveFrom < '2026-10-01'), ['Karnataka', 'Kerala']);
    expect(oct).toMatchObject({ since: '2026-10-01', states: ['KARNATAKA'] });
    expect(oct!.message).toMatch(/No October 2026 rates yet for Karnataka/);
    expect(revisionReminder('2027-04-02', RATES, ['Karnataka'])!.message).toMatch(/No April 2027 rates yet for Karnataka/);
    /* No rates on file at all: the empty table says so; no reminder. */
    expect(revisionReminder('2027-04-02', [], ['Karnataka'])).toBeNull();
  });
});

describe('minimum wages in payroll', () => {
  it('keeps rates per company, imports a CSV all or nothing, and replaces the same row', async () => {
    const c = await makeOwner();
    const empty = (await api.get(c, '/minimum-wages').expect(200)).body;
    expect(empty).toMatchObject({ rates: [], reminder: null });

    await api.post(c, '/minimum-wages', { state: 'Karnataka', skill: 'expert', effectiveFrom: '2026-04-01', monthlyRate: 1 }).expect(400);
    await api.post(c, '/minimum-wages', { state: 'Karnataka', skill: 'SEMI_SKILLED', effectiveFrom: '2026-04-01', monthlyRate: 0 }).expect(400);
    const made = await api.post(c, '/minimum-wages', { state: 'Karnataka', skill: 'SEMI_SKILLED', effectiveFrom: '2026-04-01', monthlyRate: 15000 }).expect(201);
    const again = await api.post(c, '/minimum-wages', { state: 'KA', skill: 'semi-skilled', effectiveFrom: '2026-04-01', monthlyRate: 15100 }).expect(200);
    expect(again.body).toEqual({ id: made.body.id, replaced: true });

    const refused = await api.post(c, '/minimum-wages/import', { csv: 'state,skill,effective_from,monthly_rate\nKarnataka,skilled,2026-04-01,17000\nKarnataka,bad,2026-04-01,1\n' }).expect(400);
    expect(refused.body.errors).toEqual([{ line: 3, error: expect.stringMatching(/Skill level/) }]);
    expect((await api.get(c, '/minimum-wages').expect(200)).body.rates).toHaveLength(1);

    const imported = await api.post(c, '/minimum-wages/import', { csv: 'state,skill,effective_from,monthly_rate\nKarnataka,skilled,2026-04-01,17000\nKarnataka,semi-skilled,2026-04-01,15000\n' }).expect(200);
    expect(imported.body).toEqual({ added: 1, replaced: 1 });
    const list = (await api.get(c, '/minimum-wages').expect(200)).body.rates;
    expect(list.map((r: any) => [r.stateLabel, r.skillLabel, r.monthlyRate])).toEqual([
      ['Karnataka', 'semi-skilled', 15000],
      ['Karnataka', 'skilled', 17000],
    ]);

    const other = await makeOwner();
    expect((await api.get(other, '/minimum-wages').expect(200)).body.rates).toEqual([]);
    await api.del(other, `/minimum-wages/${made.body.id}`).expect(404);
    await api.del(c, `/minimum-wages/${made.body.id}`).expect(200);
    await api.del(c, `/minimum-wages/${made.body.id}`).expect(404);
  });

  it('warns on the salary and in the pay run, by the person’s state and skill level', async () => {
    const c = await makeOwner();
    const structureId = await structure(c);
    /* Skill level defaults to unskilled and is saved on the payroll details. */
    const person = await api
      .post(c, '/employees', { name: 'Ravi Kumar', code: 'M1', dateOfJoining: '2026-04-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', professionalTaxState: 'Karnataka' } })
      .expect(201);
    const employeeId = person.body.employee.id;
    expect(person.body.employee.payroll).toMatchObject({ skillLevel: 'UNSKILLED', minimumWageZone: '' });
    const saved = await api.put(c, `/employees/${employeeId}`, { name: 'Ravi Kumar', code: 'M1', status: 'ACTIVE', payroll: { skillLevel: 'SEMI_SKILLED' } }).expect(200);
    expect(saved.body.employee.payroll.skillLevel).toBe('SEMI_SKILLED');

    /* ₹1,80,000 a year: ₹15,000 a month, wages (basic) ₹7,500. No rates yet: nothing said. */
    const salary = { employeeId, structureId, effectiveFrom: '2026-10-01', annualCtc: 180000 };
    expect((await api.post(c, '/assignments/minimum-wage-check', salary).expect(200)).body.minimumWage).toBeNull();

    await api.post(c, '/minimum-wages', { state: 'Karnataka', skill: 'SEMI_SKILLED', effectiveFrom: '2026-04-01', monthlyRate: 12000 }).expect(201);
    await api.post(c, '/minimum-wages', { state: 'Karnataka', skill: 'UNSKILLED', effectiveFrom: '2026-04-01', monthlyRate: 5000 }).expect(201);

    const checked = (await api.post(c, '/assignments/minimum-wage-check', salary).expect(200)).body.minimumWage;
    expect(checked.message).toBe('Below minimum wage for Karnataka, semi-skilled: ₹12,000 a month, pays ₹7,500');
    const made = await api.post(c, '/assignments', salary).expect(201);
    expect(made.body.minimumWage).toMatchObject({ below: true, minimum: 12000, pays: 7500 });

    const period = await api.post(c, '/periods', { name: `Oct ${rnd()}`, startDate: '2026-10-01', endDate: '2026-10-31', paymentDate: '2026-10-31' }).expect(201);
    const run = (await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201)).body.run.id;
    const issues = (await api.post(c, `/runs/${run}/validate`).expect(200)).body.issues;
    const mw = issues.find((i: any) => i.code === 'BELOW_MINIMUM_WAGE');
    expect(mw).toMatchObject({ severity: 'WARNING', employeeId });
    expect(mw.message).toMatch(/^Ravi Kumar: Below minimum wage for Karnataka, semi-skilled: ₹12,000 a month, pays ₹7,500/);

    /* Unskilled, the rate is met: no warning. */
    await api.put(c, `/employees/${employeeId}`, { name: 'Ravi Kumar', code: 'M1', status: 'ACTIVE', payroll: { skillLevel: 'UNSKILLED' } }).expect(200);
    const after = (await api.post(c, `/runs/${run}/validate`).expect(200)).body.issues;
    expect(after.some((i: any) => i.code === 'BELOW_MINIMUM_WAGE')).toBe(false);
  });
});
