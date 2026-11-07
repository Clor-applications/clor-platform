import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Review of #138 (salary TDS): the portal cannot set a previous employer's
 * figures, your own regime or Form 12B is somebody else's to change, the
 * employer-NPS limit holds the whole year where a structure has no Basic line,
 * tax withheld without a PAN is approved only by name, an existing company is
 * topped up to the 2026-27 rule, PT is projected once for the month, and the
 * declaration's "60 or older" stands in for a missing date of birth.
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
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(schemes: string[] = ['TDS']): Promise<Ctx> {
  const email = `stdr.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `TDS review Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const org = await platformPrisma.org.findUnique({ where: { id: setup.body.company.orgId }, select: { accountId: true } });
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: (jwt.decode(signup.body.token) as any).userId, accountId: org!.accountId };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { payroll: true, people: true, attendance: true } }).expect(200);
  await api.post(c, '/statutory/seed').expect(200);
  const { body } = await api.get(c, '/statutory').expect(200);
  for (const s of body.schemes.filter((x: any) => schemes.includes(x.code))) await api.put(c, `/statutory/schemes/${s.id}`, { isEnabled: true }).expect(200);
  return c;
}

/** An administrator besides the owner. */
async function admin(c: Ctx): Promise<Ctx> {
  const { ensureDefaultRoles } = await import('../services/defaultRoles.js');
  await ensureDefaultRoles(c.accountId, c.orgId, c.userId);
  const email = `stdr2.${Date.now()}.${rnd()}@example.com`;
  const made = await request(app).post('/api/users').set(at(c)).send({ email, fullName: `Member ${rnd()}`, password: 'Passw0rd!23', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
  const r = await platformPrisma.role.findFirstOrThrow({ where: { orgId: c.orgId, roleType: 'ADMIN' }, select: { id: true } });
  await request(app).put(`/api/orgs/${c.orgId}/users/${made.body.user.id}/role`).set(at(c)).send({ roleId: r.id }).expect(200);
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
  return { ...c, token: login.body.token, userId: made.body.user.id };
}

const component = async (c: Ctx, payload: Record<string, unknown>) => (await api.post(c, '/components', payload).expect(201)).body.component.id as string;
const structure = async (c: Ctx, ids: string[], balancing?: string) =>
  (
    await api
      .post(c, '/structures', {
        name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-04-01', status: 'ACTIVE',
        components: ids.map((componentId, i) => ({ componentId, displayOrder: i + 1, ...(componentId === balancing ? { isBalancing: true } : {}) })),
      })
      .expect(201)
  ).body.structure.id as string;

async function person(c: Ctx, structureId: string, annualCtc: number, payroll: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const code = `E${rnd().toUpperCase()}`;
  const made = await api
    .post(c, '/employees', { name: `Person ${rnd()}`, code, dateOfJoining: '2026-04-01', status: 'ACTIVE', ...extra, payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pan: 'ABCDE1234F', ...payroll } })
    .expect(201);
  const id = made.body.employee.id as string;
  await api.post(c, '/assignments', { employeeId: id, structureId, effectiveFrom: '2026-04-01', annualCtc }).expect(201);
  return { id, code };
}

const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

/** A month's payroll, calculated; approved when asked (and, without a PAN, approved saying so). */
async function month(c: Ctx, y: number, m: number, approve = true) {
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = monthEnd(y, m);
  const period = await api.post(c, '/periods', { name: `${start.slice(0, 7)} ${rnd()}`, startDate: start, endDate: end, paymentDate: end }).expect(201);
  const id = (await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201)).body.run.id as string;
  const checks = (await api.post(c, `/runs/${id}/validate`).expect(200)).body;
  await api.post(c, `/runs/${id}/calculate`).expect(200);
  if (approve) {
    await api.post(c, `/runs/${id}/submit-review`).expect(200);
    await api.post(c, `/runs/${id}/approve`).expect(200);
  }
  const slips = await payrollPrisma.salarySlip.findMany({ where: { runId: id }, include: { lines: true } });
  const line = (employeeId: string, code: string) => Number(slips.find((s) => s.employeeId === employeeId)?.lines.find((l) => l.componentCode === code)?.amount ?? NaN);
  return { id, checks, line };
}

async function portalFor(c: Ctx, employeeId: string, code: string) {
  const access = await request(app).get(`/api/orgs/${c.orgId}/attendance/portal-access`).set(at(c)).expect(200);
  const activation = (await request(app).post(`/api/orgs/${c.orgId}/attendance/portal-access/codes`).set(at(c)).send({ employeeIds: [employeeId] }).expect(200)).body.codes[0].activationCode;
  const token = (await request(app).post('/api/portal/activate').send({ company: access.body.company.code, employeeCode: code, activationCode: activation, password: 'mine pass 1' }).expect(200)).body.token;
  return { put: (b: unknown) => request(app).put('/api/portal/tax').set('Authorization', `Bearer ${token}`).send(b as any) };
}

async function plainStructure(c: Ctx) {
  const basic = await component(c, { name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1 });
  const special = await component(c, { name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 2 });
  const tds = await component(c, { name: 'Income tax', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 10 });
  return structure(c, [basic, special, tds], special);
}

describe('B1 a previous employer from the portal', () => {
  it('is ignored: the employee cannot send their own Form 12B TDS; what HR entered stays', async () => {
    const c = await makeOwner();
    const s = await plainStructure(c);
    const { id, code } = await person(c, s, 2_160_000);
    await api.put(c, `/tax-declarations/${id}?fy=2026-27`, { regime: 'NEW', items: [], previousEmployer: { name: 'Acme', income: 300_000, professionalTax: 0, tds: 20_000 } }).expect(200);
    const portal = await portalFor(c, id, code);
    await portal.put({ regime: 'NEW', items: [], previousEmployer: { name: 'Made up', income: 100_000, professionalTax: 0, tds: 500_000 } }).expect(200);
    const row = await payrollPrisma.taxDeclaration.findFirstOrThrow({ where: { orgId: c.orgId, employeeId: id } });
    expect(row.previousEmployerName).toBe('Acme');
    expect(Number(row.previousEmployerTds)).toBe(20_000);
    expect(Number(row.previousEmployerIncome)).toBe(300_000);
  });
});

describe('S2 your own declaration', () => {
  it('its regime and Form 12B are refused to you while somebody else could; other changes are not', async () => {
    const c = await makeOwner();
    const other = await admin(c);
    const s = await plainStructure(c);
    const { id } = await person(c, s, 2_160_000);
    await peoplePrisma.employee.update({ where: { id }, data: { userId: other.userId } });
    for (const body of [{ regime: 'OLD', items: [] }, { regime: 'NEW', items: [], previousEmployer: { name: 'Acme', income: 300_000, professionalTax: 0, tds: 90_000 } }]) {
      const res = await api.put(other, `/tax-declarations/${id}?fy=2026-27`, body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body.code).toBe('OWN_RECORD');
    }
    /* The same regime, no previous employer: nothing that moves the tax. */
    await api.put(other, `/tax-declarations/${id}?fy=2026-27`, { regime: 'NEW', items: [] }).expect(200);
    await api.put(c, `/tax-declarations/${id}?fy=2026-27`, { regime: 'OLD', items: [] }).expect(200);
  });

  it('an owner alone in the company changes their own, audited', async () => {
    const c = await makeOwner();
    const s = await plainStructure(c);
    const { id } = await person(c, s, 2_160_000);
    await peoplePrisma.employee.update({ where: { id }, data: { userId: c.userId } });
    await api.put(c, `/tax-declarations/${id}?fy=2026-27`, { regime: 'OLD', items: [] }).expect(200);
    expect(await platformPrisma.auditLog.count({ where: { orgId: c.orgId, action: 'SELF_ENTRY_SOLE_USER' } })).toBe(1);
  });
});

describe('S3 the employer-NPS limit without a Basic line', () => {
  it('holds at 14% of the PF-wage pay for the whole year, April to March, and Form 16 allows the same', async () => {
    const c = await makeOwner();
    /* No BASIC or DA: one PF-wage line, ₹1,50,000 a month, and ₹25,000 employer NPS. */
    const pay = await component(c, { name: 'Consolidated pay', code: 'PAY', type: 'EARNING', calculationMethod: 'FIXED', amount: 150_000, includeInPfWage: true, displayOrder: 1 });
    const nps = await component(c, {
      name: 'Employer NPS', code: 'PENSION_CO', type: 'EMPLOYER_CONTRIBUTION', calculationMethod: 'FIXED', amount: 25_000,
      includeInGross: false, includeInNetPay: false, isTaxable: false, taxSection: 'EMPLOYER_NPS', displayOrder: 2,
    });
    const tds = await component(c, { name: 'Income tax', code: 'TDS', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'TDS', includeInGross: false, isTaxable: false, displayOrder: 10 });
    const s = await structure(c, [pay, nps, tds]);
    const { id } = await person(c, s, 2_100_000);
    /*
     * 18,00,000 pay + 3,00,000 NPS = 21,00,000. NPS allowed: 14% of 18,00,000 = 2,52,000.
     * 21,00,000 − 75,000 − 2,52,000 = 17,73,000: 20,000 + 40,000 + 60,000 + 20% of 1,73,000 = 1,54,600; cess 6,184; 1,60,784.
     * Before, earlier months added no Basic, so from May the limit fell (2,31,000 in May) and every month took more.
     */
    let total = 0;
    for (const [y, m] of [[2026, 4], [2026, 5], [2026, 6], [2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2], [2027, 3]]) {
      const r = await month(c, y, m);
      total += r.line(id, 'TDS');
    }
    expect(Math.abs(total - 160_784)).toBeLessThanOrEqual(6);
    const { taxYear } = await import('../services/payroll/form16.js');
    const [f16] = await taxYear(c.orgId, '2026-27', id);
    expect(f16.employerNps).toBe(252_000);
    expect(f16.taxPayable).toBe(160_784);
    expect(Math.abs(f16.balance!)).toBeLessThanOrEqual(6);
  });
});

describe('S4 tax withheld without a PAN', () => {
  it('is approved only when the approver names who, and that is audited', async () => {
    const c = await makeOwner();
    const s = await plainStructure(c);
    const without = await person(c, s, 2_400_000, { pan: null });
    const r = await month(c, 2026, 4, false);
    expect(r.line(without.id, 'TDS')).toBeGreaterThan(0);
    await api.post(c, `/runs/${r.id}/submit-review`).expect(200);
    const refused = await api.post(c, `/runs/${r.id}/approve`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('NO_PAN_UNACKNOWLEDGED');
    expect(refused.body.people.map((p: any) => p.employeeId)).toEqual([without.id]);
    await api.post(c, `/runs/${r.id}/approve`, { noPanAcknowledged: ['someone else'] }).expect(409);
    await api.post(c, `/runs/${r.id}/approve`, { noPanAcknowledged: [without.id] }).expect(200);
    const audit = await platformPrisma.auditLog.findFirstOrThrow({ where: { orgId: c.orgId, action: 'NO_PAN_ACKNOWLEDGED' } });
    expect(audit.message).toMatch(/without a PAN/);
  });
});

describe('S5 an existing company on the 2025-26 seed', () => {
  it('is topped up to the rule from 1 April 2026 the next time payroll reads its schemes', async () => {
    const c = await makeOwner();
    const scheme = await payrollPrisma.statutoryScheme.findFirstOrThrow({ where: { orgId: c.orgId, code: 'TDS' } });
    /* As a company seeded before this catalogue: no 2026-27 rule, an older catalogue version. */
    await payrollPrisma.statutoryRule.deleteMany({ where: { orgId: c.orgId, schemeId: scheme.id, effectiveFrom: '2026-04-01' } });
    await payrollPrisma.payrollSetting.updateMany({ where: { orgId: c.orgId }, data: { statutoryCatalogue: '2026-10-01.1' } });
    expect(await payrollPrisma.statutoryRule.count({ where: { orgId: c.orgId, schemeId: scheme.id, effectiveFrom: '2026-04-01' } })).toBe(0);
    await api.get(c, '/statutory').expect(200);
    const rule = await payrollPrisma.statutoryRule.findFirst({ where: { orgId: c.orgId, schemeId: scheme.id, effectiveFrom: '2026-04-01' } });
    expect(rule).not.toBeNull();
    expect(JSON.parse(rule!.configJson).standardDeduction).toBe(75_000);
    const { SEED_CATALOGUE_VERSION } = await import('../services/payroll/statutory/defaults.js');
    expect((await payrollPrisma.payrollSetting.findUniqueOrThrow({ where: { orgId: c.orgId } })).statutoryCatalogue).toBe(SEED_CATALOGUE_VERSION);
  });
});

describe('nits', () => {
  it('the declaration\'s "60 or older" gives the senior slabs when there is no date of birth', async () => {
    const { ageBandFor } = await import('../services/payroll/statutory/engine.js');
    expect(ageBandFor(null, '2026-10-31', true)).toBe('SENIOR');
    expect(ageBandFor(null, '2026-10-31', false)).toBeNull();
    /* A date of birth wins over the tick. */
    expect(ageBandFor('1990-01-01', '2026-10-31', true)).toBeNull();
  });
});
