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
