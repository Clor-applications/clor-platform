import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Statutory bonus runs (round 66 pick, Payment of Bonus Act 1965): who
 * qualifies for the year from approved payslips, the bonus on the lower of the
 * wage and the calculation base, a draft list, approval into one approved
 * earning per person on the month chosen, the payslip that pays it, cancelling,
 * the Act's figures as company settings, and the Form C register.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { ACT_DEFAULTS, personBonus } = await import('../services/payroll/bonus.js');

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
  const email = `bonus.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Bonus Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  await api.put(c, '/opening-ytd-first-year?fy=2026-27', { firstYear: true, reason: 'First year of paying salaries' }).expect(200);
  return c;
}

/** Basic is half of monthly CTC: ₹10,000 for Asha, ₹25,000 for Bala, ₹10,000 for Chitra who joins on 20 October. */
async function setUp(c: Ctx) {
  const mk = async (p: Record<string, unknown>) => (await api.post(c, '/components', p).expect(201)).body.component.id;
  const ids = [
    await mk({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }),
    await mk({ name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 2 }),
  ];
  const structure = await api
    .post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-04-01', status: 'ACTIVE', components: ids.map((componentId, i) => ({ componentId, displayOrder: i + 1, ...(i === 1 ? { isBalancing: true } : {}) })) })
    .expect(201);
  const person = async (name: string, code: string, joined: string, annualCtc: number) => {
    const p = await api.post(c, '/employees', { name, code, dateOfJoining: joined, status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL' } }).expect(201);
    const employeeId = p.body.employee.id;
    await api.post(c, '/assignments', { employeeId, structureId: structure.body.structure.id, effectiveFrom: joined < '2026-04-01' ? '2026-04-01' : joined, annualCtc }).expect(201);
    return employeeId;
  };
  return {
    asha: await person('Asha Rao', 'B101', '2026-04-01', 240_000),
    bala: await person('Bala Nair', 'B102', '2026-04-01', 600_000),
    chitra: await person('Chitra Das', 'B103', '2026-10-20', 240_000),
  };
}

async function period(c: Ctx, start: string, end: string) {
  return (await api.post(c, '/periods', { name: `M ${start} ${rnd()}`, startDate: start, endDate: end, paymentDate: end }).expect(201)).body.period.id as string;
}
async function payMonth(c: Ctx, periodId: string) {
  const run = (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id as string;
  for (const step of ['validate', 'calculate', 'submit-review', 'approve']) await api.post(c, `/runs/${run}/${step}`).expect(200);
  return run;
}

describe('the bonus for one person', () => {
  it('counts months at or under the ceiling, on the lower of the wage and the base', () => {
    const r = personBonus(
      [
        { month: '2026-04', days: 30, wage: 10000 },
        { month: '2026-05', days: 31, wage: 22000 },
        { month: '2026-06', days: 30, wage: 5000 },
      ],
      ACT_DEFAULTS,
      8.33
    );
    expect(r.daysWorked).toBe(91);
    expect(r.wages).toBe(37000);
    expect(r.bonusWages).toBe(12000); // 7,000 + left out + 5,000
    expect(r.amount).toBe(999.6);
    expect(r.eligible).toBe(true);
    expect(r.reason).toMatch(/1 month above ₹21,000/);
    expect(r.months[1]).toMatchObject({ counted: false, bonusWage: 0 });
  });

  it('uses the minimum wage when it is above the ceiling, and never pays under the minimum amount', () => {
    expect(personBonus([{ month: '2026-04', days: 30, wage: 12000 }], { ...ACT_DEFAULTS, minimumWage: 9000 }, 10).bonusWages).toBe(9000);
    const small = personBonus([{ month: '2026-04', days: 30, wage: 1000 }, { month: '2026-05', days: 5, wage: 100 }], ACT_DEFAULTS, 8.33);
    expect(small.amount).toBe(100);
    expect(small.reason).toMatch(/minimum of ₹100/);
  });

  it('does not qualify under the minimum days, or with every month above the ceiling', () => {
    expect(personBonus([{ month: '2026-10', days: 12, wage: 4000 }], ACT_DEFAULTS, 8.33)).toMatchObject({ eligible: false, amount: 0, reason: expect.stringMatching(/12 days/) });
    expect(personBonus([{ month: '2026-10', days: 31, wage: 25000 }], ACT_DEFAULTS, 8.33)).toMatchObject({ eligible: false, amount: 0, reason: expect.stringMatching(/above ₹21,000 a month all year/) });
  });
});

describe('bonus runs', () => {
  it('works out a draft, takes the settings, approves into earnings a pay run pays, and gives the register', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    await payMonth(c, await period(c, '2026-09-01', '2026-09-30'));
    await payMonth(c, await period(c, '2026-10-01', '2026-10-31'));

    /* The Act's figures are settings, with notes to check them. */
    const s = (await api.get(c, '/bonus/settings').expect(200)).body;
    expect(s.rules).toMatchObject({ eligibilityCeiling: 21000, calculationCeiling: 7000, minPercent: 8.33, maxPercent: 20, minimumAmount: 100, minDays: 30 });
    expect(s.notes.eligibilityCeiling).toMatch(/Check the current rule/);

    await api.post(c, '/bonus-runs', { financialYear: '2026-27', ratePercent: 25 }).expect(400);
    await api.post(c, '/bonus-runs', { financialYear: '2026-28', ratePercent: 10 }).expect(400);
    await api.post(c, '/bonus-runs', { financialYear: '2025-26', ratePercent: 10 }).expect(409);

    const draft = (await api.post(c, '/bonus-runs', { financialYear: '2026-27', ratePercent: 8.33 }).expect(201)).body.run;
    expect(draft).toMatchObject({ status: 'DRAFT', ratePercent: 8.33, eligibleCount: 1 });
    const line = (id: string, run = draft) => run.lines.find((l: any) => l.employeeId === id);
    expect(line(ids.asha)).toMatchObject({ eligible: true, daysWorked: 61, wages: 20000, bonusWages: 14000, amount: 1166.2 });
    expect(line(ids.bala)).toMatchObject({ eligible: false, amount: 0, reason: expect.stringMatching(/above ₹21,000/) });
    expect(line(ids.chitra)).toMatchObject({ eligible: false, reason: expect.stringMatching(/days in the year; at least 30/) });
    expect(draft.lines[0].employeeId).toBe(ids.asha);

    /* A higher ceiling, saved and audited, then worked out again: Bala now counts, on the ₹7,000 base. */
    await api.put(c, '/bonus/settings', { ...s.rules, minPercent: 21 }).expect(400);
    await api.put(c, '/bonus/settings', { ...s.rules, eligibilityCeiling: 30000 }).expect(200);
    const again = (await api.post(c, '/bonus-runs', { financialYear: '2026-27', ratePercent: 8.33 }).expect(200)).body.run;
    expect(again.id).toBe(draft.id);
    expect(line(ids.bala, again)).toMatchObject({ eligible: true, wages: 50000, bonusWages: 14000, amount: 1166.2 });
    expect(again.totalAmount).toBe(2332.4);

    const nov = await period(c, '2026-11-01', '2026-11-30');
    await api.post(c, `/bonus-runs/${draft.id}/approve`, {}).expect(400);
    const approved = (await api.post(c, `/bonus-runs/${draft.id}/approve`, { periodId: nov }).expect(200)).body;
    expect(approved).toMatchObject({ earnings: 2, waiting: 0, run: { status: 'APPROVED', periodId: nov } });
    await api.post(c, `/bonus-runs/${draft.id}/approve`, { periodId: nov }).expect(409);
    await api.post(c, '/bonus-runs', { financialYear: '2026-27', ratePercent: 10 }).expect(409);

    const earnings = await payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, reference: `bonus:${draft.id}` } });
    expect(earnings).toHaveLength(2);
    expect(earnings.every((a) => a.status === 'APPROVED' && a.type === 'EARNING' && a.periodId === nov && Number(a.amount) === 1166.2)).toBe(true);

    /* November's pay run pays it, under the Statutory bonus earning. */
    const runId = await payMonth(c, nov);
    const slip = await payrollPrisma.salarySlip.findFirstOrThrow({ where: { orgId: c.orgId, runId, employeeId: ids.asha }, include: { lines: true } });
    expect(slip.lines.find((l) => l.componentCode === 'STAT_BONUS')).toMatchObject({ type: 'EARNING' });
    expect(Number(slip.lines.find((l) => l.componentCode === 'STAT_BONUS')!.amount)).toBe(1166.2);

    /* Paid on a payslip: it cannot be cancelled from here. */
    await api.post(c, `/bonus-runs/${draft.id}/cancel`, { reason: 'Wrong rate' }).expect(409);

    const reg = (await api.get(c, `/bonus-runs/${draft.id}/register`).expect(200)).body;
    expect(reg.rows).toHaveLength(2);
    expect(reg.rows[0]).toMatchObject({ serial: 1, name: 'Asha Rao', daysWorked: 61, wages: 20000, bonusPayable: 1166.2, netPayable: 1166.2, fatherName: '', customaryBonus: null });

    const year = (await api.get(c, '/bonus-runs?fy=2026-27').expect(200)).body;
    expect(year.run).toMatchObject({ id: draft.id, status: 'APPROVED' });
  }, 120_000);

  it('cancels an approved run whose earnings are unpaid, with a reason, and keeps it as history', async () => {
    const c = await makeOwner();
    await setUp(c);
    await payMonth(c, await period(c, '2026-06-01', '2026-06-30'));
    const run = (await api.post(c, '/bonus-runs', { financialYear: '2026-27', ratePercent: 20 }).expect(201)).body.run;
    expect(run.lines.find((l: any) => l.eligible).amount).toBe(1400);
    const jul = await period(c, '2026-07-01', '2026-07-31');
    await api.post(c, `/bonus-runs/${run.id}/approve`, { periodId: jul }).expect(200);

    await api.post(c, `/bonus-runs/${run.id}/cancel`, {}).expect(400);
    await api.post(c, `/bonus-runs/${run.id}/cancel`, { reason: 'Rate decided again' }).expect(200);
    const earnings = await payrollPrisma.payrollAdjustment.findMany({ where: { orgId: c.orgId, reference: `bonus:${run.id}` } });
    expect(earnings.every((a) => a.status === 'CANCELLED')).toBe(true);

    const year = (await api.get(c, '/bonus-runs?fy=2026-27').expect(200)).body;
    expect(year.run).toBeNull();
    expect(year.history).toEqual([expect.objectContaining({ id: run.id, status: 'CANCELLED', cancelReason: 'Rate decided again' })]);
    /* And a new one can be worked out. */
    await api.post(c, '/bonus-runs', { financialYear: '2026-27', ratePercent: 8.33 }).expect(201);
  }, 120_000);

  it('does not show or let another company touch a bonus run', async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    await setUp(a);
    await payMonth(a, await period(a, '2026-05-01', '2026-05-31'));
    const run = (await api.post(a, '/bonus-runs', { financialYear: '2026-27', ratePercent: 8.33 }).expect(201)).body.run;
    expect((await api.get(b, '/bonus-runs?fy=2026-27').expect(200)).body.run).toBeNull();
    await api.post(b, `/bonus-runs/${run.id}/approve`, { periodId: 'x' }).expect(404);
    await api.post(b, `/bonus-runs/${run.id}/cancel`, {}).expect(404);
    await api.get(b, `/bonus-runs/${run.id}/register`).expect(404);
  }, 120_000);
});
