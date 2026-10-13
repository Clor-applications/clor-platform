import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Salary revisions.
 *
 * The part worth testing hardest is the impact, because it is the only figure
 * anybody makes a decision on. A twelve percent rise on cost to company is not
 * twelve percent in the hand — provident fund rises with basic and the employer
 * pays more on top — and an impact that quietly said otherwise would be worse
 * than none at all.
 */

const { buildApp } = await import('../app.js');
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
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

const api = {
  post: (c: Ctx, path: string, body?: unknown) => request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) => request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `rev.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Payroll owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Rev Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

/**
 * A structure where basic is half of CTC and PF is deducted on it, so a rise
 * moves more than one number — which is the whole point of an impact preview.
 */
async function setUp(c: Ctx) {
  await api.post(c, '/statutory/seed').expect(200);
  const schemes = (await api.get(c, '/statutory').expect(200)).body.schemes;
  const pf = schemes.find((s: any) => s.code === 'PF');
  await api.put(c, `/statutory/schemes/${pf.id}`, { isEnabled: true }).expect(200);

  const mk = (payload: Record<string, unknown>) => api.post(c, '/components', payload).expect(201);

  const basic = await mk({
    name: 'Basic', code: 'BASIC', type: 'EARNING',
    calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC',
    includeInPfWage: true, displayOrder: 1,
  });
  const special = await mk({ name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING', calculationMethod: 'BALANCING', displayOrder: 2 });
  const epf = await mk({
    name: 'Employee PF', code: 'EPF', type: 'DEDUCTION',
    calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, isTaxable: false, displayOrder: 10,
  });
  const erpf = await mk({
    name: 'Employer PF', code: 'ER_PF', type: 'EMPLOYER_CONTRIBUTION',
    calculationMethod: 'STATUTORY', statutoryScheme: 'PF', includeInGross: false, includeInNetPay: false, isTaxable: false, displayOrder: 20,
  });

  const mkStructure = async (name: string) =>
    (
      await api
        .post(c, '/structures', {
          name: `${name} ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2026-01-01', status: 'ACTIVE',
          components: [
            { componentId: basic.body.component.id, displayOrder: 1 },
            { componentId: special.body.component.id, isBalancing: true, displayOrder: 2 },
            { componentId: epf.body.component.id, displayOrder: 10 },
            { componentId: erpf.body.component.id, displayOrder: 20 },
          ],
        })
        .expect(201)
    ).body.structure.id;

  const structureId = await mkStructure('Staff');
  const seniorId = await mkStructure('Senior');

  const person = await api
    .post(c, '/employees', {
      name: 'Aarav Krishnan', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE',
      payroll: { payrollStatus: 'IN_PAYROLL', pfApplicable: true },
    })
    .expect(201);
  const employeeId = person.body.employee.id;

  await api
    .post(c, '/assignments', { employeeId, structureId, effectiveFrom: '2026-01-01', annualCtc: 600_000 })
    .expect(201);

  const period = await api
    .post(c, '/periods', { name: `July ${rnd()}`, startDate: '2026-07-01', endDate: '2026-07-31', paymentDate: '2026-07-31' })
    .expect(201);

  return { employeeId, structureId, seniorId, periodId: period.body.period.id };
}

const draft = (ids: Awaited<ReturnType<typeof setUp>>, over: Record<string, unknown> = {}) => ({
  employeeId: ids.employeeId,
  proposedStructureId: ids.structureId,
  proposedAnnualCtc: 720_000,
  effectiveFrom: '2026-07-01',
  reason: 'Annual increment',
  ...over,
});

describe('what a revision actually costs', () => {
  it('shows every component that moves, and by how much', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);

    const { body } = await api
      .post(c, '/revisions/impact-preview', {
        employeeId: ids.employeeId,
        proposedStructureId: ids.structureId,
        proposedAnnualCtc: 720_000,
        effectiveFrom: '2026-07-01',
      })
      .expect(200);

    const impact = body.impact;
    expect(impact.ctc.from).toBe(600_000);
    expect(impact.ctc.to).toBe(720_000);
    expect(impact.ctc.percent).toBe(20);

    /* Basic is half of monthly CTC: ₹25,000 becomes ₹30,000. */
    const basic = impact.lines.find((l: any) => l.code === 'BASIC');
    expect(basic.from).toBe(25_000);
    expect(basic.to).toBe(30_000);
    expect(basic.change).toBe(5_000);

    /*
     * Here the whole rise reaches take-home, and the preview should say so
     * rather than hedge: basic is above the ₹15,000 PF ceiling both before and
     * after, so the contribution does not move and nothing absorbs the rise.
     * The interesting case is the one below, where it does.
     */
    expect(impact.monthly.change).toBe(10_000);
    expect(impact.lines.find((l: any) => l.code === 'EPF')).toBeUndefined();
  });

  it('says when a rise is swallowed by deductions', async () => {
    /*
     * PF is capped at ₹15,000 of wages, so a rise that takes basic from below
     * the ceiling to above it is deducted on more than it was. The preview
     * must say so rather than showing a cheerful number.
     */
    const c = await makeOwner();
    const ids = await setUp(c);

    /* CTC ₹1,20,000 a year: basic ₹5,000 a month, well under the ceiling. */
    await payrollPrisma.salaryAssignment.updateMany({
      where: { orgId: c.orgId, employeeId: ids.employeeId },
      data: { annualCtc: 120_000, monthlyCtc: 10_000 },
    });

    const { body } = await api
      .post(c, '/revisions/impact-preview', {
        employeeId: ids.employeeId,
        proposedStructureId: ids.structureId,
        proposedAnnualCtc: 800_000,
        effectiveFrom: '2026-07-01',
      })
      .expect(200);

    const epf = body.impact.lines.find((l: any) => l.code === 'EPF');
    expect(epf.from).toBe(600);
    /* Basic is now ₹33,333, above the ₹15,000 ceiling, so PF is ₹1,800. */
    expect(epf.to).toBe(1_800);
  });

  it('counts the employer’s own contribution as part of the cost', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);

    const { body } = await api
      .post(c, '/revisions/impact-preview', {
        employeeId: ids.employeeId,
        proposedStructureId: ids.structureId,
        proposedAnnualCtc: 720_000,
        effectiveFrom: '2026-07-01',
      })
      .expect(200);

    expect(body.impact.employerCost.change).toBeGreaterThan(0);
    /* What the company pays out each month is gross plus its own
       contribution, so it exceeds take-home by more than the rise alone. */
    expect(body.impact.employerCost.change).toBeGreaterThanOrEqual(body.impact.monthly.change);
  });

  it('notices a pay cut', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const { body } = await api
      .post(c, '/revisions/impact-preview', {
        employeeId: ids.employeeId,
        proposedStructureId: ids.structureId,
        proposedAnnualCtc: 400_000,
        effectiveFrom: '2026-07-01',
      })
      .expect(200);
    expect(body.impact.notes.map((n: any) => n.code)).toContain('PAY_CUT');
  });
});

describe('the lifecycle', () => {
  it('goes draft, reviewed, approved, applied — and only the last changes pay', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);

    const made = await api.post(c, '/revisions', draft(ids)).expect(201);
    const id = made.body.revision.id;
    expect(made.body.revision.status).toBe('DRAFT');
    expect(made.body.revision.currentAnnualCtc).toBe(600_000);
    expect(made.body.revision.incrementPercent).toBe(20);

    /* Nothing has changed yet. */
    let assignment = (await api.get(c, `/assignments?employeeId=${ids.employeeId}`).expect(200)).body.assignments[0];
    expect(assignment.annualCtc).toBe(600_000);

    await api.post(c, `/revisions/${id}/submit-review`).expect(200);
    await api.post(c, `/revisions/${id}/approve`).expect(200);

    /* Still nothing: approving is a decision, applying is the change. */
    assignment = (await api.get(c, `/assignments?employeeId=${ids.employeeId}`).expect(200)).body.assignments[0];
    expect(assignment.annualCtc).toBe(600_000);

    const applied = await api.post(c, `/revisions/${id}/apply`).expect(200);
    expect(applied.body.revision.status).toBe('APPLIED');

    const assignments = (await api.get(c, `/assignments?employeeId=${ids.employeeId}`).expect(200)).body.assignments;
    const now = assignments.find((a: any) => a.status === 'ACTIVE');
    expect(now.annualCtc).toBe(720_000);
    expect(now.effectiveFrom).toBe('2026-07-01');
    /* The old salary closes the day before the new one starts. */
    const old = assignments.find((a: any) => a.status === 'SUPERSEDED');
    expect(old.effectiveTo).toBe('2026-06-30');
  });

  it('cannot be applied before it is approved', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api.post(c, '/revisions', draft(ids)).expect(201);

    const refused = await api.post(c, `/revisions/${made.body.revision.id}/apply`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('NOT_APPROVED');
  });

  it('applies once', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api.post(c, '/revisions', draft(ids)).expect(201);
    const id = made.body.revision.id;
    await api.post(c, `/revisions/${id}/submit-review`).expect(200);
    await api.post(c, `/revisions/${id}/approve`).expect(200);
    await api.post(c, `/revisions/${id}/apply`).expect(200);

    const again = await api.post(c, `/revisions/${id}/apply`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_APPLIED');
  });

  it('will not start a salary inside a month that has been closed', async () => {
    /* Backdating into a paid month would leave the payslips saying one thing
       and the assignment another. An arrear is the right answer. */
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api.post(c, '/revisions', draft(ids, { effectiveFrom: '2026-07-15' })).expect(201);
    const id = made.body.revision.id;
    await api.post(c, `/revisions/${id}/submit-review`).expect(200);
    await api.post(c, `/revisions/${id}/approve`).expect(200);
    await api.post(c, `/periods/${ids.periodId}/lock`).expect(200);

    const refused = await api.post(c, `/revisions/${id}/apply`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PERIOD_LOCKED');
  });

  it('allows only one open revision per person', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    await api.post(c, '/revisions', draft(ids)).expect(201);

    const second = await api.post(c, '/revisions', draft(ids, { effectiveFrom: '2026-08-01' }));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('REVISION_OPEN');
  });

  it('withdraws a review when the numbers change', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api.post(c, '/revisions', draft(ids)).expect(201);
    const id = made.body.revision.id;
    await api.post(c, `/revisions/${id}/submit-review`).expect(200);

    const edited = await api.put(c, `/revisions/${id}`, draft(ids, { proposedAnnualCtc: 900_000 })).expect(200);
    expect(edited.body.revision.status).toBe('DRAFT');
    expect(edited.body.revision.reviewedAt).toBe(null);
    expect(edited.body.revision.incrementPercent).toBe(50);
  });

  it('cannot be edited once approved', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api.post(c, '/revisions', draft(ids)).expect(201);
    const id = made.body.revision.id;
    await api.post(c, `/revisions/${id}/submit-review`).expect(200);
    await api.post(c, `/revisions/${id}/approve`).expect(200);

    const refused = await api.put(c, `/revisions/${id}`, draft(ids, { proposedAnnualCtc: 900_000 }));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('REVISION_NOT_EDITABLE');
  });
});

describe('the impact that was approved', () => {
  it('is kept, so a later change of rates does not restate it', async () => {
    /*
     * "We approved this on the understanding it cost X" needs the X that was
     * on the screen, not one recomputed under today's rates.
     */
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api.post(c, '/revisions', draft(ids)).expect(201);
    const id = made.body.revision.id;
    await api.post(c, `/revisions/${id}/submit-review`).expect(200);
    await api.post(c, `/revisions/${id}/approve`).expect(200);

    const approved = (await api.get(c, `/revisions/${id}`).expect(200)).body.revision;
    expect(approved.impactIsStored).toBe(true);
    const wasCost = approved.impact.employerCost.to;

    /* The PF ceiling doubles from a later date — which does not change what
       was approved. */
    const pf = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PF');
    await api
      .post(c, `/statutory/schemes/${pf.id}/rules`, {
        jurisdiction: 'IN', effectiveFrom: '2026-06-01', employeeRate: 12, employerRate: 12, wageCeiling: 50_000, rounding: 'NEAREST',
        config: { epsRate: 8.33, epsWageCeiling: 50_000 },
      })
      .expect(201);

    const after = (await api.get(c, `/revisions/${id}`).expect(200)).body.revision;
    expect(after.impact.employerCost.to).toBe(wasCost);
  });

  it('is recomputed while it is still a draft', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api.post(c, '/revisions', draft(ids)).expect(201);

    const seen = (await api.get(c, `/revisions/${made.body.revision.id}`).expect(200)).body.revision;
    expect(seen.impactIsStored).toBe(false);
    expect(seen.impact.ctc.to).toBe(720_000);
  });
});

describe('a payroll after a revision', () => {
  it('pays the new salary', async () => {
    const c = await makeOwner();
    const ids = await setUp(c);
    const made = await api.post(c, '/revisions', draft(ids)).expect(201);
    const id = made.body.revision.id;
    await api.post(c, `/revisions/${id}/submit-review`).expect(200);
    await api.post(c, `/revisions/${id}/approve`).expect(200);
    await api.post(c, `/revisions/${id}/apply`).expect(200);

    const run = await api.post(c, '/runs', { periodId: ids.periodId }).expect(201);
    await api.post(c, `/runs/${run.body.run.id}/validate`).expect(200);
    await api.post(c, `/runs/${run.body.run.id}/calculate`).expect(200);

    const slip = (await api.get(c, `/slips?runId=${run.body.run.id}`).expect(200)).body.slips[0];
    /* ₹7,20,000 a year is ₹60,000 a month, less the employer's PF, which is
       part of cost to company rather than of gross. */
    expect(slip.employerCost).toBe(60_000);
  });
});
