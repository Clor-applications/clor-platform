import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Statutory deductions, through a real payroll run.
 *
 * The engine is tested on its own arithmetic elsewhere. What this holds is the
 * wiring: that a scheme switched on actually reaches a payslip, that the
 * payslip records which rule version produced the figure, and that publishing a
 * new rate does not reach backwards into a month already paid.
 *
 * It also holds the shape of the calculation. PF is a share of PF wages, and
 * PF wages are an output of the structure — so the run works the structure out
 * once to learn the wages, computes the schemes, and works it out again with
 * the real amounts. Getting that order wrong gives everybody nil.
 */

const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };

const at = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
  del: (c: Ctx, path: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `stat.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Payroll owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Stat Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

/** A company with PF and ESI switched on, and components for both sides. */
async function setUp(c: Ctx) {
  await api.post(c, '/statutory/seed').expect(200);
  const { body } = await api.get(c, '/statutory').expect(200);
  for (const scheme of body.schemes.filter((s: any) => ['PF', 'ESI'].includes(s.code))) {
    await api.put(c, `/statutory/schemes/${scheme.id}`, { isEnabled: true }).expect(200);
  }

  const mk = (payload: Record<string, unknown>) => api.post(c, '/components', payload).expect(201);
  const basic = await mk({
    name: 'Basic', code: 'BASIC', type: 'EARNING',
    calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC',
    includeInPfWage: true, includeInEsiWage: true, displayOrder: 1,
  });
  const special = await mk({
    name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING',
    calculationMethod: 'BALANCING', includeInEsiWage: true, displayOrder: 2,
  });
  const epf = await mk({
    name: 'Employee PF', code: 'EPF', type: 'DEDUCTION',
    calculationMethod: 'STATUTORY', statutoryScheme: 'PF',
    includeInGross: false, isTaxable: false, displayOrder: 10,
  });
  const erpf = await mk({
    name: 'Employer PF', code: 'ER_PF', type: 'EMPLOYER_CONTRIBUTION',
    calculationMethod: 'STATUTORY', statutoryScheme: 'PF',
    includeInGross: false, includeInNetPay: false, isTaxable: false, displayOrder: 20,
  });

  const structure = await api
    .post(c, '/structures', {
      name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE',
      components: [
        { componentId: basic.body.component.id, displayOrder: 1 },
        { componentId: special.body.component.id, isBalancing: true, displayOrder: 2 },
        { componentId: epf.body.component.id, displayOrder: 10 },
        { componentId: erpf.body.component.id, displayOrder: 20 },
      ],
    })
    .expect(201);

  const period = await api
    .post(c, '/periods', { name: `Sept 2026 ${rnd()}`, startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' })
    .expect(201);

  return { structureId: structure.body.structure.id, periodId: period.body.period.id };
}

async function addPerson(c: Ctx, structureId: string, name: string, ctc: number, payroll: Record<string, unknown> = {}) {
  const made = await api
    .post(c, '/employees', {
      name, code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE',
      payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', pfApplicable: true, esiApplicable: true, ...payroll },
    })
    .expect(201);
  await api
    .post(c, '/assignments', { employeeId: made.body.employee.id, structureId, effectiveFrom: '2026-01-01', annualCtc: ctc })
    .expect(201);
  return made.body.employee.id;
}

async function runPayroll(c: Ctx, periodId: string) {
  const run = await api.post(c, '/runs', { periodId }).expect(201);
  await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);
  await api.post(c, `/runs/${run.body.run.id}/calculate`).expect(200);
  return run.body.run.id;
}

describe('switching a scheme on', () => {
  it('refuses a scheme with no rates behind it', async () => {
    /* Switching it on would deduct nothing and say nothing about why. */
    const c = await makeOwner();
    /* The real tenant, so the route finds it — a scheme under a made-up
       account is simply somebody else's and answers 404. */
    const org = await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } });
    const scheme = await payrollPrisma.statutoryScheme.create({
      data: { accountId: org!.accountId, orgId: c.orgId, code: 'LWF', name: 'Labour Welfare Fund', createdByUserId: 'u' },
    });
    const refused = await api.put(c, `/statutory/schemes/${scheme.id}`, { isEnabled: true });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('SCHEME_HAS_NO_RULES');
  });

  it('seeds rates without switching anything on', async () => {
    /* A deduction nobody asked for is money taken from somebody's pay by
       default. */
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const { body } = await api.get(c, '/statutory').expect(200);
    expect(body.schemes.length).toBeGreaterThan(0);
    expect(body.schemes.every((s: any) => s.isEnabled === false)).toBe(true);
    expect(body.schemes.find((s: any) => s.code === 'PF').rules.length).toBeGreaterThan(0);
  });

  it('seeds again without duplicating anything', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const second = await api.post(c, '/statutory/seed').expect(200);
    expect(second.body.count).toBe(0);
  });
});

describe('a payroll with PF switched on', () => {
  let c: Ctx;
  let ids: Awaited<ReturnType<typeof setUp>>;
  let runId = '';
  let modestId = '';
  let largeId = '';

  beforeAll(async () => {
    c = await makeOwner();
    ids = await setUp(c);
    /* ₹3,00,000 a year is ₹25,000 a month, so Basic is ₹12,500 — under the
       ceiling. ₹12,00,000 gives a Basic of ₹50,000, over it. */
    modestId = await addPerson(c, ids.structureId, 'Under ceiling', 300_000);
    largeId = await addPerson(c, ids.structureId, 'Over ceiling', 1_200_000);
    runId = await runPayroll(c, ids.periodId);
  });

  it('deducts PF instead of showing nil', async () => {
    /* The thing this whole piece of work was for. */
    const slips = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips;
    expect(slips.every((s: any) => s.totalDeductions > 0)).toBe(true);
  });

  it('takes 12% below the ceiling', async () => {
    const slips = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips;
    const modest = slips.find((s: any) => s.employeeId === modestId);
    /* Basic is ₹12,500; 12% is ₹1,500. */
    expect(modest.totalDeductions).toBe(1500);
  });

  it('stops at the ceiling above it', async () => {
    const slips = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips;
    const large = slips.find((s: any) => s.employeeId === largeId);
    expect(large.totalDeductions).toBe(1800);
  });

  it('charges the employer their share as a company cost, not from pay', async () => {
    const slips = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips;
    const large = slips.find((s: any) => s.employeeId === largeId);
    expect(large.employerContributions).toBe(1800);
    expect(large.netPay).toBe(large.grossEarnings - 1800);
  });

  it('explains the ceiling on the payslip rather than printing "PF rule"', async () => {
    const slips = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips;
    const large = slips.find((s: any) => s.employeeId === largeId);
    const slip = (await api.get(c, `/slips/${large.id}`).expect(200)).body.slip;
    const epf = slip.calculation.find((t: any) => t.code === 'EPF');
    expect(epf.ruleText).toMatch(/ceiling/i);
    expect(epf.computedAmount).toBe(1800);
  });

  it('records which rule version produced the figure', async () => {
    const slips = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips;
    const slip = await payrollPrisma.salarySlip.findFirst({ where: { orgId: c.orgId, id: slips[0].id } });
    const snapshot = JSON.parse(slip!.statutorySnapshotJson);
    expect(snapshot.versions.PF.version).toBeTruthy();
    expect(snapshot.results.find((r: any) => r.scheme === 'PF').employee).toBeGreaterThan(0);
  });

  it('keeps the employer’s pension split on the record', async () => {
    const slips = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips;
    const slip = await payrollPrisma.salarySlip.findFirst({ where: { orgId: c.orgId, id: slips[0].id } });
    const snapshot = JSON.parse(slip!.statutorySnapshotJson);
    const pf = snapshot.results.find((r: any) => r.scheme === 'PF');
    expect(pf.employerSplit.EPS + pf.employerSplit.EPF).toBe(pf.employer);
  });

  it('deducts nothing from somebody PF does not apply to', async () => {
    const c2 = await makeOwner();
    const s2 = await setUp(c2);
    await addPerson(c2, s2.structureId, 'Exempt', 600_000, { pfApplicable: false, esiApplicable: false });
    const id = await runPayroll(c2, s2.periodId);
    const slips = (await api.get(c2, `/slips?runId=${id}`).expect(200)).body.slips;
    expect(slips[0].totalDeductions).toBe(0);
  });
});

describe('a rate that changes', () => {
  it('does not reach backwards into a month already paid', async () => {
    /*
     * The property the whole versioning design exists for. A ceiling raised in
     * December must leave September's payslip exactly as it was.
     */
    const c = await makeOwner();
    const ids = await setUp(c);
    await addPerson(c, ids.structureId, 'Paid in September', 1_200_000);
    const runId = await runPayroll(c, ids.periodId);

    const before = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0];
    expect(before.totalDeductions).toBe(1800);

    /* A new ceiling, from December. */
    const { body } = await api.get(c, '/statutory').expect(200);
    const pf = body.schemes.find((s: any) => s.code === 'PF');
    await api
      .post(c, `/statutory/schemes/${pf.id}/rules`, {
        jurisdiction: 'IN',
        effectiveFrom: '2026-12-01',
        employeeRate: 12,
        employerRate: 12,
        wageCeiling: 25000,
        rounding: 'NEAREST',
        config: { epsRate: 8.33, epsWageCeiling: 25000 },
      })
      .expect(201);

    const after = (await api.get(c, `/slips?runId=${runId}`).expect(200)).body.slips[0];
    expect(after.totalDeductions).toBe(before.totalDeductions);
  });

  it('closes the version it supersedes the day before', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const pf = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PF');

    await api
      .post(c, `/statutory/schemes/${pf.id}/rules`, {
        jurisdiction: 'IN', effectiveFrom: '2026-12-01', employeeRate: 12, employerRate: 12, wageCeiling: 25000, rounding: 'NEAREST', config: {},
      })
      .expect(201);

    const rules = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PF').rules;
    const old = rules.find((r: any) => r.effectiveFrom === '2014-09-01');
    expect(old.effectiveTo).toBe('2026-11-30');
    expect(old.status).toBe('SUPERSEDED');
  });

  it('refuses a second rate starting on the same day', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const pf = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PF');
    const body = { jurisdiction: 'IN', effectiveFrom: '2027-01-01', employeeRate: 12, employerRate: 12, rounding: 'NEAREST' as const, config: {} };
    await api.post(c, `/statutory/schemes/${pf.id}/rules`, body).expect(201);
    const clash = await api.post(c, `/statutory/schemes/${pf.id}/rules`, body);
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('RULE_EXISTS');
  });

  it('cannot be deleted once a payslip was computed under it', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    await addPerson(c, ids.structureId, 'Under a rule', 600_000);
    await runPayroll(c, ids.periodId);

    const pf = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PF');
    const used = pf.rules.find((r: any) => r.usedOnPayslips > 0);
    expect(used).toBeTruthy();

    const refused = await api.del(c, `/statutory/rules/${used.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('RULE_IN_USE');
  });

  it('puts the version it superseded back in force when it is deleted', async () => {
    /*
     * Publishing a rate closes the one before it. Undoing the publish has to
     * undo that too, or the old rate stays SUPERSEDED with an end date and
     * nothing at all is in force afterwards — and a scheme with no rule in
     * force deducts nil, quietly.
     */
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const pf = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PF');

    const added = await api
      .post(c, `/statutory/schemes/${pf.id}/rules`, {
        jurisdiction: 'IN', effectiveFrom: '2026-12-01', employeeRate: 12, employerRate: 12, wageCeiling: 25000, rounding: 'NEAREST', config: {},
      })
      .expect(201);

    const closed = (await api.get(c, '/statutory').expect(200)).body.schemes
      .find((s: any) => s.code === 'PF').rules.find((r: any) => r.effectiveFrom === '2014-09-01');
    expect(closed.status).toBe('SUPERSEDED');
    expect(closed.effectiveTo).toBe('2026-11-30');

    await api.del(c, `/statutory/rules/${added.body.rule.id}`).expect(200);

    const reopened = (await api.get(c, '/statutory').expect(200)).body.schemes
      .find((s: any) => s.code === 'PF').rules.find((r: any) => r.effectiveFrom === '2014-09-01');
    expect(reopened.status).toBe('ACTIVE');
    expect(reopened.effectiveTo).toBe(null);
  });

  it('leaves other jurisdictions alone when one of theirs is deleted', async () => {
    const c = await makeOwner();
    await api.post(c, '/statutory/seed').expect(200);
    const pt = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PT');

    const added = await api
      .post(c, `/statutory/schemes/${pt.id}/rules`, {
        jurisdiction: 'KARNATAKA', effectiveFrom: '2026-10-01', rounding: 'NEAREST',
        config: { slabs: [{ from: 0, to: null, amount: 250 }] },
      })
      .expect(201);
    await api.del(c, `/statutory/rules/${added.body.rule.id}`).expect(200);

    const rules = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PT').rules;
    const byPlace = (j: string) => rules.filter((r: any) => r.jurisdiction === j);
    expect(byPlace('KARNATAKA').map((r: any) => r.status)).toEqual(['ACTIVE']);
    expect(byPlace('MAHARASHTRA').every((r: any) => r.status === 'ACTIVE')).toBe(true);
    expect(byPlace('WEST BENGAL').every((r: any) => r.status === 'ACTIVE')).toBe(true);
  });
});

describe('a company that has not switched any scheme on', () => {
  it('still calculates, and says why the statutory lines are nil', async () => {
    const c = await makeOwner();
    const basic = await api
      .post(c, '/components', {
        name: 'Basic', code: 'BASIC', type: 'EARNING',
        calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1,
      })
      .expect(201);
    const epf = await api
      .post(c, '/components', {
        name: 'Employee PF', code: 'EPF', type: 'DEDUCTION',
        calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, displayOrder: 10,
      })
      .expect(201);
    const structure = await api
      .post(c, '/structures', {
        name: `Bare ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE',
        components: [
          { componentId: basic.body.component.id, displayOrder: 1 },
          { componentId: epf.body.component.id, displayOrder: 10 },
        ],
      })
      .expect(201);
    const period = await api
      .post(c, '/periods', { name: `Oct ${rnd()}`, startDate: '2026-10-01', endDate: '2026-10-31' })
      .expect(201);
    await addPerson(c, structure.body.structure.id, 'No schemes', 600_000);

    const run = await api.post(c, '/runs', { periodId: period.body.period.id }).expect(201);
    const check = await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);
    expect(check.body.canCalculate).toBe(true);
    expect(check.body.issues.some((i: any) => i.code === 'STATUTORY_NOT_COMPUTED')).toBe(true);
  });
});
