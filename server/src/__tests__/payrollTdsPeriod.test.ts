import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Salary TDS by the pay period, opening figures, one-offs (audit 7 Nov 2026, #1, #2, #15).
 *
 *  #1  the year, the months left and the tax so far follow the month the pay is FOR, not the day it is paid:
 *      March's salary paid on 1 April is the last month of the year that ends that March.
 *  #2  pay from earlier in the year, before CLOR, is entered per person (or imported) and counted;
 *      a first payroll after April is refused without it, unless the owner says this is the first year.
 *  #15 a bonus or variable pay counts in the year once, not for every month left.
 *
 * Meera: CTC ₹21,81,600 a year. Basic 90,900 (50% of monthly CTC), HRA 36,360 (40% of Basic),
 * employer PF 1,800, Special 52,740 (balancing): gross ₹1,80,000 a month, all of it taxable.
 * New regime: 21,60,000 − 75,000 = 20,85,000; 20,000 + 40,000 + 60,000 + 80,000 + 25% of 85,000
 * = 2,21,250; cess 8,850; 2,30,100 a year, 19,175 a month.
 *
 * Every date is a pay period's, fixed in the past or future on purpose, and none is compared with
 * today, so the file passes under TEST_TODAY=2027-03-31T23:30:00+05:30 and TEST_TODAY=2027-04-01.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

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
  const email = `tdsp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `TDS period Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  await api.post(ctx, '/statutory/seed').expect(200);
  const { body } = await api.get(ctx, '/statutory').expect(200);
  for (const s of body.schemes.filter((x: any) => ['TDS', 'PF'].includes(x.code))) await api.put(ctx, `/statutory/schemes/${s.id}`, { isEnabled: true }).expect(200);
  return ctx;
}

const mk = async (c: Ctx, payload: Record<string, unknown>) => (await api.post(c, '/components', payload).expect(201)).body.component.id as string;

/** Meera's structure and Meera, on it from 1 April 2026. */
const structures = new Map<string, string>();
async function meera(c: Ctx, opts: { joined?: string; code?: string; leaving?: string; extra?: Record<string, unknown> } = {}) {
  /* A second person in the same company goes on the same structure. */
  const structureId = structures.get(c.orgId) || (await staffStructure(c, opts.extra));
  structures.set(c.orgId, structureId);
  const code = opts.code || `M${rnd().toUpperCase()}`;
  const made = await api
    .post(c, '/employees', {
      name: 'Meera Shetty', code, dateOfJoining: opts.joined || '2026-04-01', ...(opts.leaving ? { dateOfLeaving: opts.leaving } : {}), status: 'ACTIVE',
      payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pan: 'ABCDE1234F', pfApplicable: true },
    })
    .expect(201);
  const employeeId = made.body.employee.id as string;
  await api.post(c, '/assignments', { employeeId, structureId, effectiveFrom: opts.joined && opts.joined > '2026-04-01' ? opts.joined : '2026-04-01', annualCtc: 2_181_600 }).expect(201);
  return { employeeId, code };
}

async function staffStructure(c: Ctx, extra?: Record<string, unknown>) {
  const ids = [
    await mk(c, { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', includeInPfWage: true, displayOrder: 1 }),
    await mk(c, { name: 'HRA', code: 'HRA', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 40, calculationBase: 'BASIC', displayOrder: 2 }),
    await mk(c, { name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 3 }),
    await mk(c, { name: 'Employer PF', code: 'ER_PF', type: 'EMPLOYER_CONTRIBUTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, includeInNetPay: false, isTaxable: false, displayOrder: 4 }),
    await mk(c, { name: 'Employee PF', code: 'EE_PF', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, isTaxable: false, displayOrder: 10 }),
    await mk(c, { name: 'Income tax', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 11 }),
    ...(extra ? [await mk(c, { displayOrder: 5, ...extra })] : []),
  ];
  const structure = await api
    .post(c, '/structures', {
      name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-04-01', status: 'ACTIVE',
      components: ids.map((componentId, i) => ({ componentId, displayOrder: i + 1, ...(i === 2 ? { isBalancing: true } : {}) })),
    })
    .expect(201);
  return structure.body.structure.id as string;
}

const period = async (c: Ctx, start: string, end: string, paid: string) =>
  (await api.post(c, '/periods', { name: `${start.slice(0, 7)} ${rnd()}`, startDate: start, endDate: end, paymentDate: paid }).expect(201)).body.period.id as string;

/** Validate and calculate a run for the period; approve it too when asked. */
async function run(c: Ctx, periodId: string, approve = false, payrollDate?: string) {
  const id = (await api.post(c, '/runs', { periodId, ...(payrollDate ? { payrollDate } : {}) }).expect(201)).body.run.id as string;
  const checks = (await api.post(c, `/runs/${id}/validate`).expect(200)).body;
  const calc = await api.post(c, `/runs/${id}/calculate`);
  if (approve) {
    expect(calc.status).toBe(200);
    await api.post(c, `/runs/${id}/submit-review`).expect(200);
    await api.post(c, `/runs/${id}/approve`).expect(200);
  }
  const slips = await payrollPrisma.salarySlip.findMany({ where: { runId: id }, include: { lines: true } });
  const line = (employeeId: string, code: string) => Number(slips.find((s) => s.employeeId === employeeId)?.lines.find((l) => l.componentCode === code)?.amount ?? NaN);
  return { id, checks, calc, line, slips };
}

const opening = (c: Ctx, employeeId: string, body: Record<string, unknown>, fy = '2026-27') => api.put(c, `/opening-ytd/${employeeId}?fy=${fy}`, body);

describe('#2 opening figures before a first payroll after April', () => {
  it('refuses October without them, names the person, and calculates nothing', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    const r = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'));
    const issue = r.checks.issues.find((i: any) => i.code === 'NO_OPENING_YTD');
    expect(issue).toMatchObject({ severity: 'ERROR', employeeId });
    expect(issue.message).toMatch(/Meera Shetty was employed here before October 2026 but has no earlier payslip in CLOR this year/);
    expect(r.calc.status).not.toBe(200);
    expect(r.slips).toHaveLength(0);
  });

  it('hand-check: Meera in October with April–September brought in takes ₹19,175', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    /* Six months at ₹1,80,000, and 6 × 19,175 deducted by the old payroll. */
    await opening(c, employeeId, { grossPay: 1_080_000, taxablePay: 1_080_000, tds: 115_050, professionalTax: 1_200, employeePf: 10_800, throughMonth: '2026-09' }).expect(200);
    const r = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'));
    expect(r.checks.issues.filter((i: any) => i.code === 'NO_OPENING_YTD')).toEqual([]);
    expect(r.line(employeeId, 'BASIC')).toBe(90_900);
    expect(r.line(employeeId, 'HRA')).toBe(36_360);
    expect(r.line(employeeId, 'SPECIAL')).toBe(52_740);
    /* Year: 10,80,000 so far + 1,80,000 × 6 = 21,60,000 → 2,30,100; less 1,15,050 already; ÷ 6. */
    expect(r.line(employeeId, 'TDS')).toBe(19_175);
  });

  it('takes the shortfall over the months left when the old payroll deducted too little', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    await opening(c, employeeId, { grossPay: 1_080_000, tds: 90_000 }).expect(200);
    const r = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'));
    /* (2,30,100 − 90,000) ÷ 6 = 23,350. Blank taxable pay is read as the gross. */
    expect(r.line(employeeId, 'TDS')).toBe(23_350);
    expect((await api.get(c, `/opening-ytd?fy=2026-27`).expect(200)).body.people[0].opening).toMatchObject({ grossPay: 1_080_000, taxablePay: 1_080_000, tds: 90_000 });
  });

  it('needs nothing from somebody who joined after the first month', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c, { joined: '2026-10-05' });
    const r = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'));
    expect(r.checks.issues.filter((i: any) => i.code === 'NO_OPENING_YTD')).toEqual([]);
    expect(r.calc.status).toBe(200);
    expect(r.slips.map((s) => s.employeeId)).toEqual([employeeId]);
  });

  it('the owner may say this is the first year of paying salaries, with a reason, and take it back', async () => {
    const c = await makeOwner();
    await meera(c);
    const oct = await period(c, '2026-10-01', '2026-10-31', '2026-10-31');
    const refused = await api.put(c, '/opening-ytd-first-year?fy=2026-27', { firstYear: true, reason: '' });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('NO_REASON');
    const saved = await api.put(c, '/opening-ytd-first-year?fy=2026-27', { firstYear: true, reason: 'Company registered in September 2026' }).expect(200);
    expect(saved.body.firstPayrollYear).toMatchObject({ financialYear: '2026-27', reason: 'Company registered in September 2026' });
    const r = await run(c, oct);
    expect(r.checks.issues.filter((i: any) => i.code === 'NO_OPENING_YTD')).toEqual([]);
    expect(r.calc.status).toBe(200);
    /* Another year is not covered by it. */
    expect((await api.get(c, '/opening-ytd?fy=2027-28').expect(200)).body.firstPayrollYear).toBeNull();
    await api.put(c, '/opening-ytd-first-year?fy=2026-27', { firstYear: false }).expect(200);
    expect((await api.get(c, '/opening-ytd?fy=2026-27').expect(200)).body.firstPayrollYear).toBeNull();
  });

  it('checks every figure in plain words, and imports a file all or nothing', async () => {
    const c = await makeOwner();
    const a = await meera(c, { code: `A${rnd().toUpperCase()}` });
    const over = await opening(c, a.employeeId, { grossPay: 100, tds: 200 });
    expect(over.status).toBe(400);
    expect(over.body.error).toBe('Income tax deducted cannot be more than the gross pay it came out of.');
    expect((await opening(c, a.employeeId, { grossPay: 100, throughMonth: '2027-05' })).body.code).toBe('BAD_MONTH');

    const bad = await api.post(c, '/opening-ytd/import?fy=2026-27', { csv: `code,gross,taxable,tds,pt,pf\n${a.code},1080000,1080000,115050,1200,10800\nNOBODY,1,1,0,0,0\n` });
    expect(bad.status).toBe(400);
    expect(bad.body.problems).toEqual([{ line: 3, message: 'Nobody in payroll has the code NOBODY.' }]);
    expect(await payrollPrisma.payrollOpeningYtd.count({ where: { orgId: c.orgId } })).toBe(0);

    const good = await api.post(c, '/opening-ytd/import?fy=2026-27', { csv: `Code,Gross,Taxable,TDS,PT,PF,Through\n"${a.code}","1,080,000",1080000,115050,1200,10800,2026-09\n` }).expect(200);
    expect(good.body.saved).toBe(1);
    const row = (await api.get(c, `/tax-declarations/${a.employeeId}?fy=2026-27`).expect(200)).body.opening;
    expect(row).toMatchObject({ grossPay: 1_080_000, tds: 115_050, professionalTax: 1_200, employeePf: 10_800, throughMonth: '2026-09' });
    await api.del(c, `/opening-ytd/${a.employeeId}?fy=2026-27`).expect(200);
    /* Kept as a removed row (a calculated payroll sees the change), read as none. */
    expect(await payrollPrisma.payrollOpeningYtd.count({ where: { orgId: c.orgId, deletedAt: null } })).toBe(0);
    expect((await api.get(c, `/tax-declarations/${a.employeeId}?fy=2026-27`).expect(200)).body.opening).toBeNull();
  });

  it('a one-person company starting in October: the owner enters their own, audited (review of #146, 1)', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    const userId = (jwt.decode(c.token) as any).userId as string;
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId } });
    await opening(c, employeeId, { grossPay: 1_080_000, tds: 115_050 }).expect(200);
    expect(await platformPrisma.auditLog.count({ where: { orgId: c.orgId, action: 'SELF_ENTRY_SOLE_USER' } })).toBe(1);
    const r = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'));
    expect(r.line(employeeId, 'TDS')).toBe(19_175);
  });

  it('is not entered by the person it is about while somebody else could', async () => {
    const c = await makeOwner();
    const { employeeId, code } = await meera(c);
    const other = await member(c);
    await peoplePrisma.employee.update({ where: { id: employeeId }, data: { userId: other.userId } });
    const res = await opening(other, employeeId, { grossPay: 1 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OWN_RECORD');
    const file = await api.post(other, '/opening-ytd/import?fy=2026-27', { csv: `code,gross\n${code},1\n` });
    expect(file.status).toBe(400);
    expect(file.body.problems[0].message).toMatch(/your own pay record/);
    expect(await payrollPrisma.payrollOpeningYtd.count({ where: { orgId: c.orgId } })).toBe(0);
  });

  it('another company cannot see or write them', async () => {
    const c = await makeOwner();
    const other = await makeOwner();
    const { employeeId } = await meera(c);
    await opening(c, employeeId, { grossPay: 10 }).expect(200);
    expect((await opening(other, employeeId, { grossPay: 20 })).status).toBe(404);
    expect((await api.get(other, '/opening-ytd?fy=2026-27').expect(200)).body.people).toEqual([]);
  });
});

describe('#1 the year follows the pay period', () => {
  it('March paid on 1 April is March: one month left, the year so far counted; April starts afresh', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    /* April 2026 to January 2027 paid elsewhere: ₹18,00,000, with ₹1,50,000 tax taken (too little). */
    await opening(c, employeeId, { grossPay: 1_800_000, tds: 150_000 }).expect(200);

    const feb = await run(c, await period(c, '2027-02-01', '2027-02-28', '2027-02-28'), true);
    /* 18,00,000 + 1,80,000 × 2 = 21,60,000 → 2,30,100; less 1,50,000; ÷ 2. */
    expect(feb.line(employeeId, 'TDS')).toBe(40_050);

    /* Paid on 1 April 2027: by its payment date that is April, twelve months left and nothing so far (19,175). */
    const mar = await run(c, await period(c, '2027-03-01', '2027-03-31', '2027-04-01'), true);
    /* By its pay period: 19,80,000 so far + 1,80,000 = 21,60,000; less 1,90,050; one month left. */
    expect(mar.line(employeeId, 'TDS')).toBe(40_050);

    /* April 2027 is a new year: March's payslip, paid in April, is not in it. */
    const apr = await run(c, await period(c, '2027-04-01', '2027-04-30', '2027-04-30'));
    expect(apr.line(employeeId, 'TDS')).toBe(19_175);
    expect(apr.checks.issues.filter((i: any) => i.code === 'NO_OPENING_YTD')).toEqual([]);
  });

  it('Form 16 is the pay year with the opening figures in; 24Q goes by the day tax was deducted', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    await opening(c, employeeId, { grossPay: 1_800_000, tds: 150_000, professionalTax: 2_000, employeePf: 18_000 }).expect(200);
    await run(c, await period(c, '2027-02-01', '2027-02-28', '2027-02-28'), true);
    await run(c, await period(c, '2027-03-01', '2027-03-31', '2027-04-01'), true);

    const { taxYear, form24q } = await import('../services/payroll/form16.js');
    const [year] = await taxYear(c.orgId, '2026-27');
    expect(year.months.map((m: any) => m.month)).toEqual(['2027-02', '2027-03']);
    expect(year.gross).toBe(2_160_000);
    expect(year.tdsDeducted).toBe(230_100);
    expect(year.taxPayable).toBe(230_100);
    expect(year.balance).toBe(0);
    expect(year.openingYtd).toMatchObject({ grossPay: 1_800_000, tds: 150_000 });

    /* March's tax was deducted on 1 April 2027: the first quarter of 2027-28 in the return, not the fourth of 2026-27. */
    const q4 = await form24q(c.orgId, '2026-27', 4);
    expect(q4.rows.map((r: any) => r.paymentDate)).toEqual(['2027-02-28']);
    const q1 = await form24q(c.orgId, '2027-28', 1);
    expect(q1.rows.map((r: any) => [r.paymentDate, r.tds])).toEqual([['2027-04-01', 40_050]]);
  });
});

describe('#15 a one-off counts in the year once', () => {
  it('a ₹1,20,000 bonus in October is not projected for six months', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    await opening(c, employeeId, { grossPay: 1_080_000, tds: 115_050 }).expect(200);
    const oct = await period(c, '2026-10-01', '2026-10-31', '2026-10-31');
    const bonus = await mk(c, { name: 'Bonus', code: 'BONUS', type: 'EARNING', calculationMethod: 'FIXED', isVariable: true, displayOrder: 50 });
    const adj = (await api.post(c, '/adjustments', { employeeId, componentId: bonus, periodId: oct, amount: 120_000, reason: 'Diwali bonus' }).expect(201)).body.adjustment.id;
    await api.post(c, `/adjustments/${adj}/approve`).expect(200);
    const r = await run(c, oct);
    expect(r.line(employeeId, 'BONUS')).toBe(120_000);
    /*
     * 10,80,000 + 1,80,000 × 6 + 1,20,000 once = 22,80,000; less 75,000 = 22,05,000:
     * 2,00,000 + 25% of 2,05,000 = 2,51,250; cess 10,050; 2,61,300; less 1,15,050; ÷ 6 = 24,375.
     * Times six it would have been 28,80,000 of pay and 39,000 a month.
     */
    expect(r.line(employeeId, 'TDS')).toBe(24_375);
  });
});


/** Another active administrator in the company (holds Payroll's edit and approve rights). */
async function member(c: Ctx): Promise<Ctx & { userId: string }> {
  const ownerId = (jwt.decode(c.token) as any).userId as string;
  const org = await platformPrisma.org.findUniqueOrThrow({ where: { id: c.orgId }, select: { accountId: true } });
  const { ensureDefaultRoles } = await import('../services/defaultRoles.js');
  await ensureDefaultRoles(org.accountId, c.orgId, ownerId);
  const email = `tdsp2.${Date.now()}.${rnd()}@example.com`;
  const made = await request(app).post('/api/users').set(at(c)).send({ email, fullName: `Member ${rnd()}`, password: 'Passw0rd!23', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
  const role = await platformPrisma.role.findFirstOrThrow({ where: { orgId: c.orgId, roleType: 'ADMIN' }, select: { id: true } });
  await request(app).put(`/api/orgs/${c.orgId}/users/${made.body.user.id}/role`).set(at(c)).send({ roleId: role.id }).expect(200);
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
  return { ...c, token: login.body.token, userId: made.body.user.id };
}

describe('review of #146', () => {
  it('2: per person: a pay group moved onto CLOR in October needs figures, the group paid here since April does not', async () => {
    const c = await makeOwner();
    const a = await meera(c, { code: `A${rnd().toUpperCase()}` });
    await run(c, await period(c, '2026-04-01', '2026-04-30', '2026-04-30'), true);
    /* Group B: employed since 2025, paid elsewhere until October. */
    const b = await meera(c, { code: `B${rnd().toUpperCase()}`, joined: '2025-06-01' });
    const r = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'));
    const missing = r.checks.issues.filter((i: any) => i.code === 'NO_OPENING_YTD').map((i: any) => i.employeeId);
    expect(missing).toEqual([b.employeeId]);
    expect(missing).not.toContain(a.employeeId);
    /* The list counts only who the payroll will ask about. */
    const list = (await api.get(c, '/opening-ytd?fy=2026-27').expect(200)).body.people;
    expect(list.find((p: any) => p.employeeId === a.employeeId).needsFigures).toBe(false);
  });

  it('3: a 26th–25th cycle is keyed on the period end, across the April turn', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    await opening(c, employeeId, { grossPay: 1_800_000, tds: 150_000 }).expect(200);
    /* 26 Jan – 25 Feb is February: two months left, as the calendar February above. */
    const feb = await run(c, await period(c, '2027-01-26', '2027-02-25', '2027-02-28'), true);
    expect(feb.line(employeeId, 'TDS')).toBe(40_050);
    const mar = await run(c, await period(c, '2027-02-26', '2027-03-25', '2027-03-31'), true);
    expect(mar.line(employeeId, 'TDS')).toBe(40_050);
    /* 26 March – 25 April is April 2027: a new year, twelve months, nothing so far, no opening figures asked. */
    const apr = await run(c, await period(c, '2027-03-26', '2027-04-25', '2027-04-30'));
    expect(apr.checks.issues.filter((i: any) => i.code === 'NO_OPENING_YTD')).toEqual([]);
    expect(apr.line(employeeId, 'TDS')).toBe(19_175);
    const { taxYear } = await import('../services/payroll/form16.js');
    const [y] = await taxYear(c.orgId, '2026-27');
    expect(y.months.map((m: any) => m.month)).toEqual(['2027-02', '2027-03']);
  });

  it('4: Basic and DA, HRA and employer NPS from before CLOR reach Form 16; taxable may exceed gross by NPS', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    const tooMuch = await opening(c, employeeId, { grossPay: 1_080_000, taxablePay: 1_200_000, employerNps: 50_000 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.code).toBe('TAXABLE_OVER_GROSS');
    await opening(c, employeeId, { grossPay: 1_080_000, taxablePay: 1_130_000, tds: 0, basicDa: 540_000, hraReceived: 216_000, employerNps: 50_000 }).expect(200);
    await api
      .put(c, `/tax-declarations/${employeeId}?fy=2026-27`, { regime: 'OLD', items: [], monthlyRent: 30_000, metroCity: true, landlordPan: 'ABCDE1234F' })
      .expect(200);
    const { taxYear } = await import('../services/payroll/form16.js');
    const [y] = await taxYear(c.orgId, '2026-27');
    expect(y.taxableSalary).toBe(1_130_000);
    expect(y.employerNps).toBe(50_000);
    /* Least of HRA 2,16,000; rent 3,60,000 less 10% of Basic 54,000; half of Basic 2,70,000. */
    expect(y.exemptions[0]).toMatchObject({ code: 'HRA', allowed: 216_000 });
  });

  it('6: removing or changing the figures marks a calculated payroll for that person as changed', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    await opening(c, employeeId, { grossPay: 1_080_000, tds: 115_050 }).expect(200);
    const r = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'));
    const { runStale } = await import('../services/payroll/run.js');
    const row = () => payrollPrisma.payrollRun.findUniqueOrThrow({ where: { id: r.id } });
    expect(await runStale(c.orgId, await row())).toBeNull();
    await new Promise((done) => setTimeout(done, 20));
    await opening(c, employeeId, { grossPay: 1_080_000, tds: 100_000 }).expect(200);
    expect(await runStale(c.orgId, await row())).toMatch(/tax declarations/);
    await api.post(c, `/runs/${r.id}/calculate`).expect(200);
    expect(await runStale(c.orgId, await row())).toBeNull();
    await new Promise((done) => setTimeout(done, 20));
    await api.del(c, `/opening-ytd/${employeeId}?fy=2026-27`).expect(200);
    expect(await runStale(c.orgId, await row())).toMatch(/tax declarations/);
  });

  it('7: 24Q goes by the day the payroll paid: a March period paid on 1 April is April in the return', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c);
    await opening(c, employeeId, { grossPay: 1_980_000, tds: 190_050 }).expect(200);
    /* The period planned payment on 31 March; the payroll actually paid on 1 April. */
    const mar = await run(c, await period(c, '2027-03-01', '2027-03-31', '2027-03-31'), true, '2027-04-01');
    expect(mar.line(employeeId, 'TDS')).toBe(40_050);
    const { form24q } = await import('../services/payroll/form16.js');
    expect((await form24q(c.orgId, '2026-27', 4)).rows).toEqual([]);
    const q1 = await form24q(c.orgId, '2027-28', 1);
    expect(q1.rows.map((r: any) => [r.paymentDate, r.tds])).toEqual([['2027-04-01', 40_050]]);
    expect(q1.months.map((m: any) => m.month)).toEqual(['2027-04']);
  });

  it('8: a FIXED component flagged "entered each month" is standing pay, and repeats', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c, { extra: { name: 'Car allowance', code: 'CAR', type: 'EARNING', calculationMethod: 'FIXED', amount: 10_000, isVariable: true } });
    await opening(c, employeeId, { grossPay: 1_080_000, tds: 115_050 }).expect(200);
    const r = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'));
    expect(r.line(employeeId, 'CAR')).toBe(10_000);
    /* Inside the same ₹1,80,000 gross (Special balances it): the year is 21,60,000 as before, 19,175 a month. Counted once it would have been less. */
    expect(r.line(employeeId, 'TDS')).toBe(19_175);
  });

  it('9: leaving on 31 December, October spreads the year over October to December', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c, { leaving: '2026-12-31' });
    await opening(c, employeeId, { grossPay: 1_080_000, tds: 115_050 }).expect(200);
    const r = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'));
    /*
     * 10,80,000 + 1,80,000 × 3 = 16,20,000; less 75,000 = 15,45,000:
     * 20,000 + 40,000 + 15% of 3,45,000 (51,750) = 1,11,750; cess 4,470; 1,16,220.
     * Less 1,15,050 already; ÷ 3 = 390. (Spread to March it would be 19,175 and over-deducted.)
     */
    expect(r.line(employeeId, 'TDS')).toBe(390);
  });

  it('10: the regime is fixed once a payslip went out; an owner or administrator overrides with a reason, audited', async () => {
    const c = await makeOwner();
    const { employeeId, code } = await meera(c);
    await opening(c, employeeId, { grossPay: 1_080_000, tds: 115_050 }).expect(200);
    await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'), true);
    const body = { regime: 'OLD', items: [] };
    const refused = await api.put(c, `/tax-declarations/${employeeId}?fy=2026-27`, body);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('REGIME_LOCKED');
    const profileAs = (taxRegime: string) => api.put(c, `/employees/${employeeId}`, { name: 'Meera Shetty', code, dateOfJoining: '2026-04-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime, pan: 'ABCDE1234F', pfApplicable: true } });
    const { financialYearOf } = await import('../services/payroll/taxDeclaration.js');
    const { todayIst } = await import('../utils/istDate.js');
    if (financialYearOf(todayIst()) === '2026-27') {
      const profile = await profileAs('OLD');
      expect(profile.status).toBe(409);
      expect(profile.body.code).toBe('REGIME_LOCKED');
    } else {
      /* From 1 April the profile sets next year's regime, a fresh choice: not locked by last year's payslips. */
      await profileAs('OLD').expect(200);
      await profileAs('NEW').expect(200);
    }
    /* The same regime is no change: saving the declaration otherwise still works. */
    await api.put(c, `/tax-declarations/${employeeId}?fy=2026-27`, { regime: 'NEW', items: [] }).expect(200);
    await api.put(c, `/tax-declarations/${employeeId}?fy=2026-27`, { ...body, regimeOverrideReason: 'Chose the old regime in April; entered wrongly' }).expect(200);
    expect(await platformPrisma.auditLog.count({ where: { orgId: c.orgId, action: 'REGIME_OVERRIDE' } })).toBe(1);
    expect((await api.get(c, `/tax-declarations/${employeeId}?fy=2026-27`).expect(200)).body.declaration.regime).toBe('OLD');
  });

  it('nits: codes in any case, quoted line breaks, "Sep 2026" and "Sep-26" for the month', async () => {
    const c = await makeOwner();
    const a = await meera(c, { code: `Aa${rnd()}` });
    const b = await meera(c, { code: `Bb${rnd()}` });
    const csv = `Code,Gross,TDS,Through,Note\n${a.code.toLowerCase()},100,0,Sep 2026,"two\nlines, with a comma"\n${b.code.toUpperCase()},200,0,Sep-26,\n`;
    await api.post(c, '/opening-ytd/import?fy=2026-27', { csv }).expect(200);
    const rows = await payrollPrisma.payrollOpeningYtd.findMany({ where: { orgId: c.orgId }, orderBy: { grossPay: 'asc' } });
    expect(rows.map((r) => [r.throughMonth, r.note])).toEqual([['2026-09', 'two\nlines, with a comma'], ['2026-09', null]]);
    const { parseThroughMonth } = await import('../services/payroll/openingYtd.js');
    expect(['2026-09', 'September 2026', '09/2026', '9/2026', 'Sep-26'].map(parseThroughMonth)).toEqual(Array(5).fill('2026-09'));
  });
});

describe('Re-review of #146', () => {
  it('S1 2 April: next year\'s declaration or profile does not move March to its regime', async () => {
    const c = await makeOwner();
    const { employeeId, code } = await meera(c);
    /* 2026-27 on the old regime, with no declaration for it: the profile's, as the October payslip went out on. */
    await payrollPrisma.employeePayrollProfile.updateMany({ where: { orgId: c.orgId, employeeId }, data: { taxRegime: 'OLD' } });
    await opening(c, employeeId, { grossPay: 1_080_000, tds: 0 }).expect(200);
    const oct = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'), true);
    expect(JSON.parse(oct.slips[0].employeeSnapshotJson).taxRegime).toBe('OLD');
    /* 2 April 2027: the new year's declaration chooses NEW. It is copied onto the profile only once 2027-28 is the year today is in. */
    await api.put(c, `/tax-declarations/${employeeId}?fy=2027-28`, { regime: 'NEW', items: [] }).expect(200);
    const { financialYearOf: fyOfDay } = await import('../services/payroll/taxDeclaration.js');
    const { todayIst: todayNow } = await import('../utils/istDate.js');
    const profileRegime = (await payrollPrisma.employeePayrollProfile.findFirstOrThrow({ where: { orgId: c.orgId, employeeId } })).taxRegime;
    expect(profileRegime).toBe(fyOfDay(todayNow()) === '2027-28' ? 'NEW' : 'OLD');
    /* As on 2 April either way: the profile on next year's regime. */
    await payrollPrisma.employeePayrollProfile.updateMany({ where: { orgId: c.orgId, employeeId }, data: { taxRegime: 'NEW' } });
    const { regimeInForce } = await import('../services/payroll/taxDeclaration.js');
    expect(await regimeInForce(c.orgId, employeeId, '2026-27')).toBe('OLD');
    /* The March payroll, run on 2 April, is 2026-27's: still OLD, and a NEW for 2026-27 is still refused. */
    const mar = await run(c, await period(c, '2027-03-01', '2027-03-31', '2027-03-31'), false, '2027-04-02');
    expect(mar.calc.status).toBe(200);
    expect(JSON.parse(mar.slips[0].employeeSnapshotJson).taxRegime).toBe('OLD');
    const refused = await api.put(c, `/tax-declarations/${employeeId}?fy=2026-27`, { regime: 'NEW', items: [] });
    expect(refused.body.code).toBe('REGIME_LOCKED');
    const { financialYearOf } = await import('../services/payroll/taxDeclaration.js');
    const { todayIst } = await import('../utils/istDate.js');
    if (financialYearOf(todayIst()) === '2026-27') {
      /* An override on the profile this year is that year's declaration regime, audited after the save. */
      const profile = await api.put(c, `/employees/${employeeId}`, { name: 'Meera Shetty', code, dateOfJoining: '2026-04-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pan: 'ABCDE1234F', pfApplicable: true, regimeOverrideReason: 'Chose NEW in April; entered wrongly' } });
      expect(profile.status).toBe(200);
      expect(await regimeInForce(c.orgId, employeeId, '2026-27')).toBe('NEW');
      expect(await platformPrisma.auditLog.count({ where: { orgId: c.orgId, action: 'REGIME_OVERRIDE' } })).toBe(1);
    }
  });

  it('S2 joined 27 September, after its cut-off, first paid in October: a warning, and October calculates', async () => {
    const c = await makeOwner();
    const { employeeId } = await meera(c, { joined: '2026-09-27' });
    const r = await run(c, await period(c, '2026-10-01', '2026-10-31', '2026-10-31'));
    const issue = r.checks.issues.find((i: any) => i.code === 'NO_OPENING_YTD');
    expect(issue).toMatchObject({ severity: 'WARNING', employeeId });
    expect(issue.message).toMatch(/joined on 2026-09-27/);
    expect(r.calc.status).toBe(200);
    /* Joined in August: an error as before. */
    const d = await makeOwner();
    const august = await meera(d, { joined: '2026-08-20' });
    const r2 = await run(d, await period(d, '2026-10-01', '2026-10-31', '2026-10-31'));
    expect(r2.checks.issues.find((i: any) => i.code === 'NO_OPENING_YTD')).toMatchObject({ severity: 'ERROR', employeeId: august.employeeId });
  });

  it('nits: gone before this period is one month left; codes that differ only by case refuse the row', async () => {
    const { monthsLeftFor } = await import('../services/payroll/run.js');
    expect(monthsLeftFor('2026-10-31', '2026-09-30')).toBe(1);
    expect(monthsLeftFor('2026-10-31', '2026-12-31')).toBe(3);
    expect(monthsLeftFor('2026-10-31', null)).toBe(6);
    const c = await makeOwner();
    const tag = rnd();
    await meera(c, { code: `ab${tag}` });
    await meera(c, { code: `AB${tag.toUpperCase()}` });
    const res = await api.post(c, '/opening-ytd/import?fy=2026-27', { csv: `Code,Gross,TDS\nab${tag},100,0\n` });
    expect(res.status).toBe(400);
    expect(res.body.problems[0].message).toMatch(/More than one person in payroll has the code/);
  });
});
