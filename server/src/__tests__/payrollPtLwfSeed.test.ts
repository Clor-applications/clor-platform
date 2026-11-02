import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Professional tax and LWF for every state, through the database: what the
 * seed step gives a new company, what it gives a company that seeded before
 * (without touching a rule that company published itself), the check-before-
 * use warning on a pay run, and the PT and LWF returns read from payslips.
 */

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { LEGACY_SEEDS } = await import('../services/payroll/statutory/defaults.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
  del: (c: Ctx, path: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `ptlwf.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `PT LWF Co ${Date.now()}-${rnd()}`, state: 'Maharashtra' })
    .expect(200);
  const orgId = setup.body.company.orgId;
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { accountId: true } });
  const c = { token: signup.body.token, orgId, branchId: setup.body.branch.id, accountId: org!.accountId };
  await request(app).put(`/api/orgs/${orgId}/features`).set(at(c)).send({ features: { payroll: true } }).expect(200);
  return c;
}

const rulesOf = async (c: Ctx, code: string) => (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === code)?.rules || [];

describe('seeding a new company', () => {
  it('gives every levying state a PT rule and every collecting state an LWF rule, with notes', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const pt = await rulesOf(c, 'PT');
    const lwf = await rulesOf(c, 'LWF');
    const ptStates = new Set(pt.map((r: any) => r.jurisdiction));
    for (const s of ['MAHARASHTRA', 'KARNATAKA', 'WEST BENGAL', 'GUJARAT', 'TELANGANA', 'ANDHRA PRADESH', 'TAMIL NADU', 'KERALA', 'MADHYA PRADESH', 'ASSAM', 'BIHAR', 'JHARKHAND', 'MEGHALAYA', 'TRIPURA', 'SIKKIM', 'MANIPUR', 'MIZORAM', 'NAGALAND', 'PUDUCHERRY', 'PUNJAB', 'ODISHA']) {
      expect(ptStates.has(s), s).toBe(true);
    }
    const lwfStates = new Set(lwf.map((r: any) => r.jurisdiction));
    for (const s of ['MAHARASHTRA', 'KARNATAKA', 'TAMIL NADU', 'KERALA', 'ANDHRA PRADESH', 'TELANGANA', 'GUJARAT', 'GOA', 'MADHYA PRADESH', 'CHHATTISGARH', 'HARYANA', 'PUNJAB', 'CHANDIGARH', 'DELHI', 'WEST BENGAL', 'ODISHA']) {
      expect(lwfStates.has(s), s).toBe(true);
    }
    expect(pt.every((r: any) => r.note && r.origin === 'SEED')).toBe(true);
    /* Low-confidence figures carry the flag and say so in the note. */
    const meghalaya = pt.find((r: any) => r.jurisdiction === 'MEGHALAYA');
    expect(meghalaya.config.needsCheck).toBe(true);
    expect(meghalaya.needsCheck).toBe(true);
    expect(meghalaya.note).toMatch(/Not sure/);
  });

  it('keeps West Bengal’s old slabs, closed the day before the new ones', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const wb = (await rulesOf(c, 'PT')).filter((r: any) => r.jurisdiction === 'WEST BENGAL');
    const old = wb.find((r: any) => r.effectiveFrom === '2023-04-01');
    const fresh = wb.find((r: any) => r.effectiveFrom === '2026-10-01');
    expect(old).toMatchObject({ status: 'SUPERSEDED', effectiveTo: '2026-09-30' });
    expect(fresh).toMatchObject({ status: 'ACTIVE', effectiveTo: null });
  });

  it('switches nothing on', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const { body } = await api.get(c, '/statutory').expect(200);
    expect(body.schemes.every((s: any) => !s.isEnabled)).toBe(true);
  });
});

describe('topping up a company that seeded before', () => {
  it('adds CLOR’s new rules and leaves the company’s own alone', async () => {
    const c = await makeOwner();
    /* What the first seed step left behind: PT with three states, rows with no origin. */
    const scheme = await payrollPrisma.statutoryScheme.create({ data: { accountId: c.accountId, orgId: c.orgId, code: 'PT', name: 'Professional Tax', isEnabled: true, createdByUserId: 'u' } });
    const make = (jurisdiction: string, version: string, config: unknown, over: Record<string, unknown> = {}) =>
      payrollPrisma.statutoryRule.create({
        data: { accountId: c.accountId, orgId: c.orgId, schemeId: scheme.id, jurisdiction, effectiveFrom: version, version, rounding: 'NEAREST', configJson: JSON.stringify(config), status: 'ACTIVE', createdByUserId: 'u', ...over },
      });
    for (const legacy of LEGACY_SEEDS) await make(legacy.jurisdiction!, legacy.version, legacy.config);
    /* The company's own Karnataka rate from June 2025, published before `origin` was recorded. */
    const ownKarnataka = await make('KARNATAKA', '2025-06-01', { slabs: [{ from: 0, to: null, amount: 250 }] });
    await payrollPrisma.statutoryRule.updateMany({ where: { schemeId: scheme.id, jurisdiction: 'KARNATAKA', version: '2023-04-01' }, data: { status: 'SUPERSEDED', effectiveTo: '2025-05-31' } });
    /* And a Gujarat rate of its own, published through the screen. */
    const ownGujarat = (
      await api.post(c, `/statutory/schemes/${scheme.id}/rules`, { jurisdiction: 'Gujarat', effectiveFrom: '2024-01-01', rounding: 'NEAREST', config: { slabs: [{ from: 0, to: null, amount: 150 }] } }).expect(201)
    ).body.rule;
    expect(ownGujarat.jurisdiction).toBe('GUJARAT');
    const before = await payrollPrisma.statutoryRule.findMany({ where: { id: { in: [ownKarnataka.id, ownGujarat.id] } }, orderBy: { id: 'asc' } });

    /* Opening the screen tops the company up. */
    await api.get(c, '/statutory').expect(200);
    const after = await payrollPrisma.statutoryRule.findMany({ where: { id: { in: [ownKarnataka.id, ownGujarat.id] } }, orderBy: { id: 'asc' } });
    /* The company's rules: same figures, same dates, same status — nothing about them moved. */
    expect(after.map((r) => [r.configJson, r.effectiveFrom, r.effectiveTo, r.status, Number(r.employeeRate)])).toEqual(
      before.map((r) => [r.configJson, r.effectiveFrom, r.effectiveTo, r.status, Number(r.employeeRate)])
    );

    const pt = await payrollPrisma.statutoryRule.findMany({ where: { schemeId: scheme.id } });
    const of = (j: string) => pt.filter((r) => r.jurisdiction === j).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    /* CLOR's 2025 Karnataka figures are older than the company's own June 2025 rate: not added. */
    expect(of('KARNATAKA').map((r) => r.version)).toEqual(['2023-04-01', '2025-06-01']);
    /* Nor CLOR's 2022 Gujarat figures, older than the company's 2024 rate. */
    expect(of('GUJARAT').map((r) => r.version)).toEqual(['2024-01-01']);
    /* Maharashtra's first seeded version, corrected on the same date, never applies again. */
    const mh = of('MAHARASHTRA');
    expect(mh.map((r) => [r.version, r.status, r.effectiveTo])).toEqual([
      ['2023-04-01', 'SUPERSEDED', '2023-03-31'],
      ['2023-04-01.2', 'ACTIVE', null],
    ]);
    /* West Bengal gets its October 2026 slabs, the old ones closed the day before. */
    expect(of('WEST BENGAL').map((r) => [r.version, r.status, r.effectiveTo])).toEqual([
      ['2023-04-01', 'SUPERSEDED', '2026-09-30'],
      ['2026-10-01', 'ACTIVE', null],
    ]);
    /* States it never had arrive, and LWF arrives switched off. */
    expect(of('TELANGANA')).toHaveLength(1);
    const lwf = await payrollPrisma.statutoryScheme.findFirst({ where: { orgId: c.orgId, code: 'LWF' } });
    expect(lwf?.isEnabled).toBe(false);

    /* Once per catalogue: opening the screen again adds nothing. */
    const count = await payrollPrisma.statutoryRule.count({ where: { orgId: c.orgId } });
    await api.get(c, '/statutory').expect(200);
    expect(await payrollPrisma.statutoryRule.count({ where: { orgId: c.orgId } })).toBe(count);
    /* And pressing "Add the standard rates" again still keeps the company's own. */
    const again = (await api.post(c, '/statutory/seed').expect(200)).body;
    expect(again.count).toBe(0);
    expect(again.kept).toEqual(expect.arrayContaining(['PT:KARNATAKA:2025-04-01', 'PT:GUJARAT:2022-04-01']));
  });

  it('does not give the standard rates to a company that never asked for them', async () => {
    const c = await makeOwner();
    await api.get(c, '/statutory').expect(200);
    expect(await payrollPrisma.statutoryRule.count({ where: { orgId: c.orgId } })).toBe(0);
  });
});

/* A company with PT and LWF on, components for both, and a structure of Basic, Special and the levies. */
async function setUp(c: Ctx, periods: Array<[string, string]>) {
  await api.post(c, '/statutory/seed').expect(200);
  const { body } = await api.get(c, '/statutory').expect(200);
  for (const s of body.schemes.filter((x: any) => ['PT', 'LWF'].includes(x.code))) await api.put(c, `/statutory/schemes/${s.id}`, { isEnabled: true }).expect(200);
  const mk = async (p: Record<string, unknown>) => (await api.post(c, '/components', p).expect(201)).body.component.id;
  const ids = [
    await mk({ name: 'Basic', code: 'BASIC', type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1 }),
    await mk({ name: 'Special', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 2 }),
    await mk({ name: 'Professional Tax', code: 'PT', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'PT', includeInGross: false, isTaxable: false, displayOrder: 10 }),
    await mk({ name: 'Employee LWF', code: 'LWF', type: 'DEDUCTION', calculationMethod: 'STATUTORY', statutoryScheme: 'LWF', includeInGross: false, isTaxable: false, displayOrder: 11 }),
    await mk({ name: 'Employer LWF', code: 'ER_LWF', type: 'EMPLOYER_CONTRIBUTION', calculationMethod: 'STATUTORY', statutoryScheme: 'LWF', includeInGross: false, includeInNetPay: false, isTaxable: false, displayOrder: 20 }),
  ];
  const structure = await api
    .post(c, '/structures', { name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE', components: ids.map((componentId, i) => ({ componentId, displayOrder: i + 1, ...(i === 1 ? { isBalancing: true } : {}) })) })
    .expect(201);
  const periodIds: string[] = [];
  for (const [start, end] of periods) {
    periodIds.push((await api.post(c, '/periods', { name: `${start} ${rnd()}`, startDate: start, endDate: end, paymentDate: end }).expect(201)).body.period.id);
  }
  return { structureId: structure.body.structure.id, periodIds };
}

async function person(c: Ctx, structureId: string, name: string, monthly: number, state: string, people: Record<string, unknown> = {}) {
  const made = await api
    .post(c, '/employees', { name, code: `E${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', ptApplicable: true, professionalTaxState: state } })
    .expect(201);
  const id = made.body.employee.id;
  if (Object.keys(people).length) await peoplePrisma.employee.update({ where: { id }, data: people });
  /* Employer LWF comes out of CTC through the balancing line, so gross is CTC less it; the tests pick pay where that does not cross a band. */
  await api.post(c, '/assignments', { employeeId: id, structureId, effectiveFrom: '2026-01-01', annualCtc: monthly * 12 }).expect(201);
  return id;
}

async function run(c: Ctx, periodId: string) {
  const id = (await api.post(c, '/runs', { periodId }).expect(201)).body.run.id;
  const checks = (await api.post(c, `/runs/${id}/validate`).expect(200)).body;
  await api.post(c, `/runs/${id}/calculate`).expect(200);
  const slips = (await api.get(c, `/slips?runId=${id}`).expect(200)).body.slips;
  return { id, checks, slips };
}

const lineOf = async (slipId: string, code: string) => {
  const lines = await payrollPrisma.salarySlipLine.findMany({ where: { slipId, componentCode: code } });
  return lines.reduce((t, l) => t + Number(l.amount), 0);
};

describe('a pay run under the state rules', () => {
  it('uses West Bengal’s old slabs for September 2026 and the new ones for October', async () => {
    const c = await makeOwner();
    const { structureId, periodIds } = await setUp(c, [['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31']]);
    /* ₹45,000 a month: ₹200 on the old slabs, ₹140 on the new. */
    await person(c, structureId, 'Bengal Staff', 45_000, 'West Bengal');
    const sept = await run(c, periodIds[0]);
    const oct = await run(c, periodIds[1]);
    expect(await lineOf(sept.slips[0].id, 'PT')).toBe(200);
    expect(await lineOf(oct.slips[0].id, 'PT')).toBe(140);
  });

  it('reads a woman’s gender from People for Maharashtra, and collects LWF in June', async () => {
    const c = await makeOwner();
    const { structureId, periodIds } = await setUp(c, [['2026-06-01', '2026-06-30']]);
    /* One person in Maharashtra is below its five-person threshold: the company says it is covered anyway. */
    await api.put(c, '/statutory/lwf-settings', { coverage: 'ALWAYS', managerDesignations: ['Branch Manager'] }).expect(200);
    const woman = await person(c, structureId, 'Meera Patil', 20_000, 'MH', { gender: 'FEMALE' });
    const man = await person(c, structureId, 'Rahul Patil', 20_000, 'Maharashtra', { gender: 'MALE' });
    const manager = await person(c, structureId, 'Anil Desai', 60_000, 'Maharashtra', { gender: 'MALE', designation: 'Branch Manager' });
    const june = await run(c, periodIds[0]);
    const slip = (id: string) => june.slips.find((s: any) => s.employeeId === id).id;
    expect(await lineOf(slip(woman), 'PT')).toBe(0);
    expect(await lineOf(slip(man), 'PT')).toBe(200);
    expect(await lineOf(slip(man), 'LWF')).toBe(25);
    expect(await lineOf(slip(man), 'ER_LWF')).toBe(75);
    /* The manager is left out of LWF, not of PT. */
    expect(await lineOf(slip(manager), 'LWF')).toBe(0);
    expect(await lineOf(slip(manager), 'PT')).toBe(200);

    /* The return for the January–June collection. */
    const f = (await api.get(c, `/reports/filings?periodId=${periodIds[0]}`).expect(200)).body;
    expect(f.lwf.states).toEqual([
      expect.objectContaining({ state: 'Maharashtra', collection: 'Jan–Jun 2026', people: 2, employee: 50, employer: 150, total: 200, dueDate: '2026-07-15', form: 'Form A-1' }),
    ]);
    expect(f.lwf.note).toMatch(/state portal/);
    expect(f.pt.states).toEqual([expect.objectContaining({ state: 'Maharashtra', people: 2, employee: 400, dueDate: '2026-07-15' })]);
  });

  it('collects no LWF below the state’s size by default', async () => {
    const c = await makeOwner();
    const { structureId, periodIds } = await setUp(c, [['2026-06-01', '2026-06-30']]);
    await person(c, structureId, 'Solo', 30_000, 'Maharashtra');
    const june = await run(c, periodIds[0]);
    expect(await lineOf(june.slips[0].id, 'LWF')).toBe(0);
  });

  it('warns about a rule CLOR could not confirm until somebody confirms it', async () => {
    const c = await makeOwner();
    const { structureId, periodIds } = await setUp(c, [['2026-11-01', '2026-11-30']]);
    await person(c, structureId, 'Shillong Staff', 50_000, 'Meghalaya');
    const first = await run(c, periodIds[0]);
    const warning = first.checks.issues.find((i: any) => i.code === 'RULE_NEEDS_CHECK');
    expect(warning).toMatchObject({ severity: 'WARNING', message: expect.stringMatching(/Meghalaya.*notice/) });

    /* The rules screen lists it, for the state the company has people in. */
    const screen = (await api.get(c, '/statutory').expect(200)).body;
    const check = screen.checks.find((x: any) => x.state === 'Meghalaya');
    expect(check).toMatchObject({ scheme: 'PT', people: 1 });
    expect(screen.checks.some((x: any) => x.state === 'Nagaland')).toBe(false);

    /* Confirmed once, for this version: the warning goes. */
    const confirmed = (await api.post(c, `/statutory/rules/${check.ruleId}/confirm`).expect(200)).body.rule;
    expect(confirmed.needsCheck).toBe(false);
    const again = (await api.post(c, `/runs/${first.id}/validate`).expect(200)).body;
    expect(again.issues.some((i: any) => i.code === 'RULE_NEEDS_CHECK')).toBe(false);
    expect((await api.get(c, '/statutory').expect(200)).body.checks).toEqual([]);
  });

  it('counts a corrected rate as checked', async () => {
    const c = await makeOwner();
    const { structureId, periodIds } = await setUp(c, [['2026-11-01', '2026-11-30']]);
    await person(c, structureId, 'Aizawl Staff', 30_000, 'Mizoram');
    const pt = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PT');
    await api
      .post(c, `/statutory/schemes/${pt.id}/rules`, { jurisdiction: 'MIZORAM', effectiveFrom: '2026-11-01', rounding: 'NEAREST', config: { needsCheck: true, slabs: [{ from: 0, to: 20000, amount: 0 }, { from: 20000.01, to: null, amount: 208 }] } })
      .expect(201);
    const r = await run(c, periodIds[0]);
    expect(r.checks.issues.some((i: any) => i.code === 'RULE_NEEDS_CHECK')).toBe(false);
    expect(await lineOf(r.slips[0].id, 'PT')).toBe(208);
  });

  it('says so when somebody on PT has no state', async () => {
    const c = await makeOwner();
    const { structureId, periodIds } = await setUp(c, [['2026-11-01', '2026-11-30']]);
    await person(c, structureId, 'Nowhere', 30_000, '');
    const r = await run(c, periodIds[0]);
    expect(r.checks.issues.find((i: any) => i.code === 'NO_PT_STATE')).toBeTruthy();
    expect(await lineOf(r.slips[0].id, 'PT')).toBe(0);
  });
});

async function colleague(boss: Ctx, permissions: string[]): Promise<Ctx> {
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  await request(app).put(`/api/orgs/${boss.orgId}/roles/${role.body.role.id}/permissions`).set(at(boss)).send({ permissions }).expect(200);
  const email = `col.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app).post('/api/users').set(at(boss)).send({ email, fullName: 'Colleague', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!23' }).expect(200);
  return { ...boss, token: login.body.token };
}

/** A company as the first seed step left it: PT for three states, rows with no origin, nothing else. */
async function legacyCompany() {
  const c = await makeOwner();
  const scheme = await payrollPrisma.statutoryScheme.create({ data: { accountId: c.accountId, orgId: c.orgId, code: 'PT', name: 'Professional Tax', isEnabled: true, createdByUserId: 'u' } });
  for (const legacy of LEGACY_SEEDS) {
    await payrollPrisma.statutoryRule.create({
      data: { accountId: c.accountId, orgId: c.orgId, schemeId: scheme.id, jurisdiction: legacy.jurisdiction, effectiveFrom: legacy.version, version: legacy.version, rounding: 'NEAREST', configJson: JSON.stringify(legacy.config), status: 'ACTIVE', createdByUserId: 'u' },
    });
  }
  return { c, scheme };
}

const periodOf = async (c: Ctx, body: Record<string, unknown>) => (await api.post(c, '/periods', { name: `P ${rnd()}`, ...body }).expect(201)).body.period.id as string;

describe('the month professional tax and LWF belong to', () => {
  it('is the pay period’s month, not the day it is paid', async () => {
    const c = await makeOwner();
    const { structureId } = await setUp(c, []);
    /* September's pay, paid on 1 October: West Bengal's September slabs (₹200), not October's (₹140). */
    const sept = await periodOf(c, { startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-10-01' });
    await person(c, structureId, 'Paid late', 45_000, 'West Bengal');
    const r = await run(c, sept);
    expect(r.slips.length).toBe(1);
    expect(await lineOf(r.slips[0].id, 'PT')).toBe(200);
  });

  it('takes Karnataka’s February ₹300 in February’s pay paid on 1 March', async () => {
    const c = await makeOwner();
    const { structureId } = await setUp(c, []);
    const feb = await periodOf(c, { startDate: '2027-02-01', endDate: '2027-02-28', paymentDate: '2027-03-01' });
    await person(c, structureId, 'Bengaluru', 40_000, 'Karnataka');
    const r = await run(c, feb);
    expect(await lineOf(r.slips[0].id, 'PT')).toBe(300);
  });

  it('takes LWF in June’s pay even when it is paid in July', async () => {
    const c = await makeOwner();
    const { structureId } = await setUp(c, []);
    await api.put(c, '/statutory/lwf-settings', { coverage: 'ALWAYS' }).expect(200);
    const june = await periodOf(c, { startDate: '2026-06-01', endDate: '2026-06-30', paymentDate: '2026-07-01' });
    await person(c, structureId, 'Pune', 30_000, 'Maharashtra');
    const r = await run(c, june);
    expect(await lineOf(r.slips[0].id, 'LWF')).toBe(25);
  });

  it('takes professional tax once a month, however many runs the month has', async () => {
    const c = await makeOwner();
    const { structureId, periodIds } = await setUp(c, [['2026-11-01', '2026-11-30']]);
    await person(c, structureId, 'Twice paid', 40_000, 'Karnataka');
    const monthly = await run(c, periodIds[0]);
    expect(await lineOf(monthly.slips[0].id, 'PT')).toBe(200);
    /* An off-cycle run inside the same month. */
    const offCycle = await periodOf(c, { frequency: 'WEEKLY', startDate: '2026-11-23', endDate: '2026-11-29', paymentDate: '2026-11-29' });
    const second = await run(c, offCycle);
    expect(second.slips.length).toBe(1);
    expect(await lineOf(second.slips[0].id, 'PT')).toBe(0);
  });

  it('warns when a state has rates, but none for that month', async () => {
    const c = await makeOwner();
    const { structureId } = await setUp(c, []);
    const march = await periodOf(c, { startDate: '2026-03-01', endDate: '2026-03-31', paymentDate: '2026-03-31' });
    await person(c, structureId, 'Bhubaneswar', 40_000, 'Odisha');
    const r = await run(c, march);
    expect(r.checks.issues.find((i: any) => i.code === 'NO_RULE_FOR_MONTH')?.message).toMatch(/Odisha professional tax.*2026-04-01/);
  });
});

describe('CLOR’s newer figures beside a company’s own', () => {
  it('arrive as a draft HR adopts, never in force over the company’s rate', async () => {
    const { c, scheme } = await legacyCompany();
    /* The company's own West Bengal rate from January 2025. */
    const own = (await api.post(c, `/statutory/schemes/${scheme.id}/rules`, { jurisdiction: 'West Bengal', effectiveFrom: '2025-01-01', rounding: 'NEAREST', config: { slabs: [{ from: 0, to: null, amount: 180 }] } }).expect(201)).body.rule;
    const screen = (await api.get(c, '/statutory').expect(200)).body;
    const wb = await payrollPrisma.statutoryRule.findMany({ where: { schemeId: scheme.id, jurisdiction: 'WEST BENGAL' }, orderBy: { effectiveFrom: 'asc' } });
    /* CLOR's October 2026 slabs: a draft. The company's rate: untouched, still in force. */
    expect(wb.map((r) => [r.version, r.status, r.effectiveTo])).toEqual([
      ['2023-04-01', 'SUPERSEDED', '2024-12-31'],
      ['2025-01-01', 'ACTIVE', null],
      ['2026-10-01', 'DRAFT', null],
    ]);
    const offer = screen.offers.find((o: any) => o.state === 'West Bengal');
    expect(offer).toMatchObject({ scheme: 'PT', effectiveFrom: '2026-10-01', yours: { effectiveFrom: '2025-01-01' } });
    /* Payroll does not read it. */
    const { loadRules } = await import('../services/payroll/statutory/resolve.js');
    const { ruleInForce } = await import('../services/payroll/statutory/engine.js');
    expect(ruleInForce((await loadRules(c.orgId)).get('PT')!, '2026-11-30', 'WEST BENGAL')?.id).toBe(own.id);

    /* Adopted: in force from its date, the company's closed the day before. */
    await api.post(c, `/statutory/rules/${offer.ruleId}/adopt`).expect(200);
    const after = await payrollPrisma.statutoryRule.findMany({ where: { schemeId: scheme.id, jurisdiction: 'WEST BENGAL' }, orderBy: { effectiveFrom: 'asc' } });
    expect(after.map((r) => [r.version, r.status, r.effectiveTo])).toEqual([
      ['2023-04-01', 'SUPERSEDED', '2024-12-31'],
      ['2025-01-01', 'SUPERSEDED', '2026-09-30'],
      ['2026-10-01', 'ACTIVE', null],
    ]);
    expect((await api.get(c, '/statutory').expect(200)).body.offers).toEqual([]);
  });

  it('can be declined, and is not offered again', async () => {
    const { c, scheme } = await legacyCompany();
    await api.post(c, `/statutory/schemes/${scheme.id}/rules`, { jurisdiction: 'WEST BENGAL', effectiveFrom: '2025-01-01', rounding: 'NEAREST', config: { slabs: [{ from: 0, to: null, amount: 180 }] } }).expect(201);
    const offer = (await api.get(c, '/statutory').expect(200)).body.offers.find((o: any) => o.state === 'West Bengal');
    await api.del(c, `/statutory/rules/${offer.ruleId}`).expect(200);
    const again = (await api.post(c, '/statutory/seed').expect(200)).body;
    expect(again.created).toEqual([]);
    expect(again.offered).toEqual([]);
    expect((await api.get(c, '/statutory').expect(200)).body.offers).toEqual([]);
    /* The company's own rate is still the one in force. */
    const own = await payrollPrisma.statutoryRule.findFirst({ where: { schemeId: scheme.id, jurisdiction: 'WEST BENGAL', version: '2025-01-01' } });
    expect(own).toMatchObject({ status: 'ACTIVE', effectiveTo: null });
  });
});

describe('a CLOR rate the company removed', () => {
  it('stays removed through seeding and later catalogues', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const gujarat = (await rulesOf(c, 'PT')).find((r: any) => r.jurisdiction === 'GUJARAT');
    await api.del(c, `/statutory/rules/${gujarat.id}`).expect(200);
    expect((await payrollPrisma.statutoryRule.findUnique({ where: { id: gujarat.id } }))?.status).toBe('WITHDRAWN');
    expect((await rulesOf(c, 'PT')).some((r: any) => r.jurisdiction === 'GUJARAT')).toBe(false);
    /* Seeding again, and a new catalogue version: Gujarat does not come back. */
    expect((await api.post(c, '/statutory/seed').expect(200)).body.created).toEqual([]);
    await payrollPrisma.payrollSetting.update({ where: { orgId: c.orgId }, data: { statutoryCatalogue: 'older' } });
    await api.get(c, '/statutory').expect(200);
    expect((await rulesOf(c, 'PT')).some((r: any) => r.jurisdiction === 'GUJARAT')).toBe(false);
  });

  it('while a company’s own unused rate is simply deleted', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const pt = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PT');
    const own = (await api.post(c, `/statutory/schemes/${pt.id}/rules`, { jurisdiction: 'GOA', effectiveFrom: '2026-12-01', rounding: 'NEAREST', config: { slabs: [] } }).expect(201)).body.rule;
    await api.del(c, `/statutory/rules/${own.id}`).expect(200);
    expect(await payrollPrisma.statutoryRule.findUnique({ where: { id: own.id } })).toBeNull();
  });
});

describe('correcting a CLOR rate from its own start date', () => {
  it('is a suffixed version that replaces CLOR’s from the same day', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const pt = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PT');
    const body = { jurisdiction: 'KARNATAKA', effectiveFrom: '2025-04-01', rounding: 'NEAREST', config: { slabs: [{ from: 0, to: 29999.99, amount: 0 }, { from: 30000, to: null, amount: 200 }] } };
    const fixed = (await api.post(c, `/statutory/schemes/${pt.id}/rules`, body).expect(201)).body.rule;
    expect(fixed.version).toBe('2025-04-01.2');
    const ka = await payrollPrisma.statutoryRule.findMany({ where: { orgId: c.orgId, schemeId: pt.id, jurisdiction: 'KARNATAKA' }, orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] });
    expect(ka.map((r) => [r.version, r.status, r.effectiveTo])).toEqual([
      ['2023-04-01', 'SUPERSEDED', '2025-03-31'],
      ['2025-04-01', 'SUPERSEDED', '2025-03-31'],
      ['2025-04-01.2', 'ACTIVE', null],
    ]);
    /* The company's own rate now starts that day: a second one is refused. */
    expect((await api.post(c, `/statutory/schemes/${pt.id}/rules`, body)).status).toBe(409);
  });
});

describe('the top-up, twice at once', () => {
  it('adds each rule once and never fails the screen', async () => {
    const { c, scheme } = await legacyCompany();
    const { ensureStatutoryCatalogue } = await import('../services/payroll/statutory/resolve.js');
    const [a, b, job] = await Promise.all([
      api.get(c, '/statutory'),
      api.get(c, '/statutory'),
      ensureStatutoryCatalogue(c.orgId, c.accountId).then(
        () => 'ok',
        (e) => String(e)
      ),
    ]);
    expect([a.status, b.status, job]).toEqual([200, 200, 'ok']);
    const rows = await payrollPrisma.statutoryRule.findMany({ where: { orgId: c.orgId }, select: { schemeId: true, jurisdiction: true, version: true } });
    const keys = rows.map((r) => `${r.schemeId}|${r.jurisdiction}|${r.version}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.filter((r) => r.schemeId === scheme.id && r.jurisdiction === 'TELANGANA')).toHaveLength(1);
  });

  it('is not done by somebody who may only view the rates', async () => {
    const { c } = await legacyCompany();
    const viewer = await colleague(c, ['PAYROLL::Payroll Settings::VIEW']);
    const before = await payrollPrisma.statutoryRule.count({ where: { orgId: c.orgId } });
    await api.get(viewer, '/statutory').expect(200);
    expect(await payrollPrisma.statutoryRule.count({ where: { orgId: c.orgId } })).toBe(before);
    /* Somebody who may edit them tops the company up. */
    await api.get(c, '/statutory').expect(200);
    expect(await payrollPrisma.statutoryRule.count({ where: { orgId: c.orgId } })).toBeGreaterThan(before);
  });
});

describe('approving a run with figures CLOR could not confirm', () => {
  it('is refused, naming the state, until the rule is confirmed', async () => {
    const c = await makeOwner();
    const { structureId, periodIds } = await setUp(c, [['2026-11-01', '2026-11-30']]);
    await person(c, structureId, 'Shillong', 50_000, 'Meghalaya');
    const r = await run(c, periodIds[0]);
    /* Calculated and previewed: the payslip is there. */
    expect(await lineOf(r.slips[0].id, 'PT')).toBe(208);
    const detail = (await api.get(c, `/runs/${r.id}`).expect(200)).body;
    expect(detail.statutoryChecks).toEqual([expect.objectContaining({ scheme: 'PT', state: 'Meghalaya' })]);
    await api.post(c, `/runs/${r.id}/submit-review`).expect(200);
    const refused = await api.post(c, `/runs/${r.id}/approve`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('RULE_NEEDS_CHECK');
    expect(refused.body.error).toMatch(/Meghalaya professional tax/);

    await api.post(c, `/statutory/rules/${detail.statutoryChecks[0].ruleId}/confirm`).expect(200);
    expect((await api.get(c, `/runs/${r.id}`).expect(200)).body.statutoryChecks).toEqual([]);
    const approved = await api.post(c, `/runs/${r.id}/approve`);
    expect([approved.status, approved.body.code]).toEqual([200, undefined]);
  });
});

describe('managers and supervisors', () => {
  it('leaves a manager out at any pay and a supervisor only above the state’s limit', async () => {
    const c = await makeOwner();
    const { structureId, periodIds } = await setUp(c, [['2026-06-01', '2026-06-30']]);
    await api.put(c, '/statutory/lwf-settings', { coverage: 'ALWAYS', managerDesignations: ['Store Manager'], supervisorDesignations: ['Supervisor'] }).expect(200);
    const manager = await person(c, structureId, 'Low-paid manager', 3_000, 'Maharashtra', { designation: 'Store Manager' });
    const lowSupervisor = await person(c, structureId, 'Supervisor on 3,000', 3_000, 'Maharashtra', { designation: 'Supervisor' });
    const supervisor = await person(c, structureId, 'Supervisor on 30,000', 30_000, 'Maharashtra', { designation: 'supervisor' });
    const june = await run(c, periodIds[0]);
    const slip = (id: string) => june.slips.find((s: any) => s.employeeId === id).id;
    expect(await lineOf(slip(manager), 'LWF')).toBe(0);
    expect(await lineOf(slip(lowSupervisor), 'LWF')).toBe(25);
    expect(await lineOf(slip(supervisor), 'LWF')).toBe(0);
    expect((await api.get(c, '/statutory').expect(200)).body.lwf).toEqual({ coverage: 'ALWAYS', managerDesignations: ['Store Manager'], supervisorDesignations: ['Supervisor'] });
  });
});
