import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Salary structures: the shape of a salary, before anybody is on it.
 *
 * Two things carry the weight here. A structure that has people assigned to it
 * stops being free to change what it pays, because every report that groups by
 * structure would otherwise start describing past months with today's rules.
 * And the preview has to be the same arithmetic a payroll run performs — a
 * preview computed another way is a second answer, and the one on screen is
 * then the one nobody can reproduce.
 */

const { buildApp } = await import('../app.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await payrollPrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;
const ids: Record<string, string> = {};

const at = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `struct.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Payroll owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Struct Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

const component = (c: Ctx, body: Record<string, unknown>) =>
  request(app).post(`/api/orgs/${c.orgId}/payroll/components`).set(at(c)).send(body);

const structures = {
  list: (c: Ctx) => request(app).get(`/api/orgs/${c.orgId}/payroll/structures`).set(at(c)),
  get: (c: Ctx, id: string) => request(app).get(`/api/orgs/${c.orgId}/payroll/structures/${id}`).set(at(c)),
  create: (c: Ctx, body: Record<string, unknown>) =>
    request(app).post(`/api/orgs/${c.orgId}/payroll/structures`).set(at(c)).send(body),
  update: (c: Ctx, id: string, body: Record<string, unknown>) =>
    request(app).put(`/api/orgs/${c.orgId}/payroll/structures/${id}`).set(at(c)).send(body),
  destroy: (c: Ctx, id: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll/structures/${id}`).set(at(c)),
  preview: (c: Ctx, body: Record<string, unknown>) =>
    request(app).post(`/api/orgs/${c.orgId}/payroll/structures/preview`).set(at(c)).send(body),
};

/** The ordinary Indian shape: Basic from CTC, HRA from Basic, allowance takes the rest. */
const standardLines = () => [
  { componentId: ids.BASIC, displayOrder: 1 },
  { componentId: ids.HRA, displayOrder: 2 },
  { componentId: ids.SPECIAL, isBalancing: true, displayOrder: 3 },
];

const structureBody = (over: Record<string, unknown> = {}) => ({
  name: `Staff ${rnd()}`,
  frequency: 'MONTHLY',
  effectiveFrom: '2026-04-01',
  status: 'ACTIVE',
  components: standardLines(),
  ...over,
});

beforeAll(async () => {
  owner = await makeOwner();
  const made = await Promise.all([
    component(owner, {
      name: 'Basic', code: 'BASIC', type: 'EARNING',
      calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC',
      includeInPfWage: true, displayOrder: 1,
    }),
    component(owner, {
      name: 'House Rent Allowance', code: 'HRA', type: 'EARNING',
      calculationMethod: 'FORMULA', formula: 'BASIC * 0.4', displayOrder: 2,
    }),
    component(owner, {
      name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING',
      calculationMethod: 'BALANCING', displayOrder: 3,
    }),
    component(owner, {
      name: 'Employee PF', code: 'EPF', type: 'DEDUCTION',
      calculationMethod: 'FORMULA', formula: 'MIN(BASIC * 0.12, 1800)',
      includeInGross: false, isTaxable: false, displayOrder: 10,
    }),
  ]);
  for (const r of made) {
    expect(r.status).toBe(201);
    ids[r.body.component.code] = r.body.component.id;
  }
});

describe('assembling a structure', () => {
  it('records one with its lines in order', async () => {
    const made = await structures.create(owner, structureBody({ name: 'Staff monthly' })).expect(201);
    expect(made.body.structure.components).toHaveLength(3);
    expect(made.body.structure.components.map((l: any) => l.displayOrder)).toEqual([1, 2, 3]);
    expect(made.body.structure.assignedCount).toBe(0);
  });

  it('refuses one with no components at all', async () => {
    const bad = await structures.create(owner, structureBody({ components: [] }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/at least one component/i);
  });

  it('refuses the same component twice', async () => {
    const bad = await structures.create(
      owner,
      structureBody({ components: [{ componentId: ids.BASIC }, { componentId: ids.BASIC }] })
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/twice/i);
  });

  it('refuses two components both taking the balance', async () => {
    const bad = await structures.create(
      owner,
      structureBody({
        components: [
          { componentId: ids.BASIC, isBalancing: true },
          { componentId: ids.SPECIAL, isBalancing: true },
        ],
      })
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/only one component/i);
  });

  it('refuses a formula naming a component this structure does not have', async () => {
    /* It would evaluate to zero for ever, which reads on a payslip as a
       deliberate nil rather than a mistake. */
    const bad = await structures.create(
      owner,
      structureBody({
        components: [{ componentId: ids.BASIC, formula: 'BONUS * 2', calculationMethod: 'FORMULA' }],
      })
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/BONUS/);
  });

  it('refuses a formula it cannot read at all', async () => {
    const bad = await structures.create(
      owner,
      structureBody({
        components: [{ componentId: ids.BASIC, formula: 'process.exit(1)', calculationMethod: 'FORMULA' }],
      })
    );
    expect(bad.status).toBe(400);
  });

  it('refuses one that stops being effective before it starts', async () => {
    const bad = await structures.create(owner, structureBody({ effectiveFrom: '2026-04-01', effectiveTo: '2026-03-01' }));
    expect(bad.status).toBe(400);
  });

  it('refuses a second structure of the same name from the same date', async () => {
    const name = `Twins ${rnd()}`;
    await structures.create(owner, structureBody({ name })).expect(201);
    const clash = await structures.create(owner, structureBody({ name }));
    expect(clash.status).toBe(409);
  });
});

describe('what a structure pays, before it is saved', () => {
  it('works the whole salary out from a CTC', async () => {
    const r = await structures
      .preview(owner, { components: standardLines(), annualCtc: 1_200_000, frequency: 'MONTHLY' })
      .expect(200);
    const p = r.body.preview;
    const amount = (code: string) => p.lines.find((l: any) => l.code === code)?.amount;

    expect(amount('BASIC')).toBe(50000);
    expect(amount('HRA')).toBe(20000);
    expect(amount('SPECIAL')).toBe(30000);
    expect(p.grossEarnings).toBe(100000);
    expect(p.errors).toEqual([]);
  });

  it('shows the annual figures beside the monthly ones', async () => {
    const r = await structures
      .preview(owner, { components: standardLines(), annualCtc: 1_200_000 })
      .expect(200);
    expect(r.body.preview.annual.gross).toBe(1_200_000);
  });

  it('explains every line it produced', async () => {
    const r = await structures
      .preview(owner, { components: standardLines(), annualCtc: 1_200_000 })
      .expect(200);
    const hra = r.body.preview.trace.find((t: any) => t.code === 'HRA');
    expect(hra.formula).toBe('BASIC * 0.4');
    expect(hra.computedAmount).toBe(20000);
  });

  it('takes the deduction off net pay and leaves gross alone', async () => {
    const r = await structures
      .preview(owner, {
        components: [...standardLines(), { componentId: ids.EPF, displayOrder: 10 }],
        annualCtc: 1_200_000,
      })
      .expect(200);
    expect(r.body.preview.grossEarnings).toBe(100000);
    expect(r.body.preview.totalDeductions).toBe(1800);
    expect(r.body.preview.netPay).toBe(98200);
  });

  it('prorates a part month', async () => {
    const r = await structures
      .preview(owner, { components: standardLines(), annualCtc: 1_200_000, workingDays: 30, payableDays: 15 })
      .expect(200);
    expect(r.body.preview.lines.find((l: any) => l.code === 'BASIC').amount).toBe(25000);
  });

  it('divides a weekly structure by the weeks in a year', async () => {
    const r = await structures
      .preview(owner, { components: standardLines(), annualCtc: 520_000, frequency: 'WEEKLY' })
      .expect(200);
    expect(r.body.preview.lines.find((l: any) => l.code === 'BASIC').amount).toBe(5000);
  });

  it('saves nothing at all', async () => {
    const before = await payrollPrisma.salaryStructure.count({ where: { orgId: owner.orgId } });
    await structures.preview(owner, { components: standardLines(), annualCtc: 900_000 }).expect(200);
    const after = await payrollPrisma.salaryStructure.count({ where: { orgId: owner.orgId } });
    expect(after).toBe(before);
  });

  it('agrees with what the structure pays once it is saved', async () => {
    /* The property that matters: the preview and the stored structure are the
       same arithmetic, not two implementations that happen to agree today. */
    const preview = await structures
      .preview(owner, { components: standardLines(), annualCtc: 1_500_000 })
      .expect(200);
    const saved = await structures.create(owner, structureBody({ name: `Agree ${rnd()}` })).expect(201);
    const again = await structures
      .preview(owner, {
        components: saved.body.structure.components.map((l: any) => ({
          componentId: l.componentId,
          calculationMethod: l.calculationMethod,
          amount: l.amount,
          percentage: l.percentage,
          formula: l.formula,
          calculationBase: l.calculationBase,
          isBalancing: l.isBalancing,
          displayOrder: l.displayOrder,
        })),
        annualCtc: 1_500_000,
      })
      .expect(200);
    expect(again.body.preview.netPay).toBe(preview.body.preview.netPay);
    expect(again.body.preview.grossEarnings).toBe(preview.body.preview.grossEarnings);
  });
});

describe('a structure people are already on', () => {
  let structureId = '';

  beforeAll(async () => {
    const made = await structures.create(owner, structureBody({ name: `Assigned ${rnd()}` })).expect(201);
    structureId = made.body.structure.id;
    await payrollPrisma.salaryAssignment.create({
      data: {
        accountId: 'acct-test',
        orgId: owner.orgId,
        employeeId: `emp-${rnd()}`,
        structureId,
        effectiveFrom: '2026-04-01',
        annualCtc: 1_200_000,
        monthlyCtc: 100_000,
        createdByUserId: 'user-test',
      },
    });
  });

  it('can still be renamed and described', async () => {
    const current = (await structures.get(owner, structureId)).body.structure;
    const saved = await structures
      .update(owner, structureId, {
        ...structureBody({ name: `Assigned renamed ${rnd()}`, effectiveFrom: current.effectiveFrom }),
        components: current.components.map((l: any) => ({
          componentId: l.componentId,
          calculationMethod: l.calculationMethod,
          amount: l.amount,
          percentage: l.percentage,
          formula: l.formula,
          calculationBase: l.calculationBase,
          isBalancing: l.isBalancing,
          displayOrder: l.displayOrder,
        })),
      })
      .expect(200);
    expect(saved.body.structure.assignedCount).toBe(1);
  });

  it('refuses a change to what it pays', async () => {
    const current = (await structures.get(owner, structureId)).body.structure;
    const changed = await structures.update(owner, structureId, {
      ...structureBody({ name: current.name, effectiveFrom: current.effectiveFrom }),
      components: [
        { componentId: ids.BASIC, calculationMethod: 'PERCENTAGE', percentage: 60, calculationBase: 'MONTHLY_CTC', displayOrder: 1 },
        { componentId: ids.HRA, displayOrder: 2 },
        { componentId: ids.SPECIAL, isBalancing: true, displayOrder: 3 },
      ],
    });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe('STRUCTURE_IN_USE');
  });

  it('refuses a change to the date it takes effect', async () => {
    const current = (await structures.get(owner, structureId)).body.structure;
    const moved = await structures.update(owner, structureId, {
      ...structureBody({ name: current.name, effectiveFrom: '2026-05-01' }),
      components: current.components.map((l: any) => ({
        componentId: l.componentId,
        calculationMethod: l.calculationMethod,
        amount: l.amount,
        percentage: l.percentage,
        formula: l.formula,
        calculationBase: l.calculationBase,
        isBalancing: l.isBalancing,
        displayOrder: l.displayOrder,
      })),
    });
    expect(moved.status).toBe(409);
  });

  it('cannot be deleted', async () => {
    const refused = await structures.destroy(owner, structureId);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/archive/i);
  });
});

describe('a structure nobody is on', () => {
  it('can be changed and deleted freely', async () => {
    const made = await structures.create(owner, structureBody({ name: `Free ${rnd()}` })).expect(201);
    const id = made.body.structure.id;
    await structures
      .update(owner, id, structureBody({ name: `Free changed ${rnd()}`, components: [{ componentId: ids.BASIC }] }))
      .expect(200);
    await structures.destroy(owner, id).expect(200);
  });
});

describe('the tenancy boundary', () => {
  it('shows one organisation nothing of another’s structures', async () => {
    const other = await makeOwner();
    const theirs = await structures.list(other).expect(200);
    expect(theirs.body.structures).toHaveLength(0);
  });

  it('answers nothing while payroll is switched off', async () => {
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email: `structoff.${Date.now()}.${rnd()}@example.com`, password: 'Passw0rd!23', name: 'No payroll' })
      .expect(200);
    const setup = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${signup.body.token}`)
      .send({ companyName: `Off Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
      .expect(200);
    const off = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    const refused = await structures.list(off).expect(403);
    expect(refused.body.code).toBe('PAYROLL_DISABLED');
  });
});
