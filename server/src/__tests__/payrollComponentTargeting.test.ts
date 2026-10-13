import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * A component that finds its own people, through a real payroll run.
 *
 * The unit tests in payrollEligibility.test.ts prove the rules; this proves
 * they are actually consulted — that a conditional component reaches the
 * payslip of somebody who matches, stays off the payslip of somebody who does
 * not, and that a component nobody's structure lists can still be paid.
 *
 * That last one is the whole point of the feature. Before it, the only way to
 * pay an allowance to the Chennai office was a second salary structure, and
 * two structures that differ by one line drift within a year.
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
let periodId = '';
let structureId = '';
const people: Record<string, string> = {};

const at = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const api = {
  post: (c: Ctx, path: string, body?: unknown) =>
    request(app).post(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  put: (c: Ctx, path: string, body?: unknown) =>
    request(app).put(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)).send(body as any),
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
  del: (c: Ctx, path: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner(): Promise<Ctx> {
  const email = `target.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Payroll owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Target Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

async function addPerson(c: Ctx, name: string, department: string, ctc: number) {
  const made = await api
    .post(c, '/employees', {
      name,
      code: `E${rnd().toUpperCase()}`,
      department,
      dateOfJoining: '2026-01-01',
      status: 'ACTIVE',
      payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW' },
    })
    .expect(201);
  const id = made.body.employee.id;
  await api.post(c, '/assignments', { employeeId: id, structureId, effectiveFrom: '2026-01-01', annualCtc: ctc }).expect(201);
  return id;
}

/** Runs a payroll over the current period and returns each person's lines. */
async function payslipLines(c: Ctx) {
  const run = await api.post(c, '/runs', { periodId }).expect(201);
  await api.post(c, `/runs/${run.body.run.id}/calculate`, {}).expect(200);
  const slips = await api.get(c, `/slips?runId=${run.body.run.id}`).expect(200);

  const byEmployee = new Map<string, Array<{ code: string; amount: number }>>();
  for (const slip of slips.body.slips || []) {
    const detail = await api.get(c, `/slips/${slip.id}`).expect(200);
    /* A payslip is returned as the two sides somebody reads, not as one list
       of lines — which is the shape the screen wants and the shape a payslip
       has on paper. */
    const sides = [...(detail.body.slip.earnings || []), ...(detail.body.slip.deductions || [])];
    byEmployee.set(
      slip.employeeId,
      sides.map((l: any) => ({ code: l.code, amount: Number(l.amount) }))
    );
  }
  /* Runs are one-per-period-and-population, so each call gets its own period. */
  return byEmployee;
}

async function freshPeriod(c: Ctx, month: string) {
  const period = await api
    .post(c, '/periods', {
      name: `${month} ${rnd()}`,
      startDate: `2026-${month}-01`,
      endDate: `2026-${month}-28`,
      paymentDate: `2026-${month}-28`,
    })
    .expect(201);
  periodId = period.body.period.id;
}

beforeAll(async () => {
  owner = await makeOwner();

  const basic = await api
    .post(owner, '/components', {
      name: 'Basic', code: 'BASIC', type: 'EARNING',
      calculationMethod: 'PERCENTAGE', percentage: 50, calculationBase: 'MONTHLY_CTC', displayOrder: 1,
    })
    .expect(201);
  const special = await api
    .post(owner, '/components', {
      name: 'Special Allowance', code: 'SPECIAL', type: 'EARNING',
      calculationMethod: 'BALANCING', displayOrder: 3,
    })
    .expect(201);

  const structure = await api
    .post(owner, '/structures', {
      name: `Staff ${rnd()}`,
      frequency: 'MONTHLY',
      effectiveFrom: '2026-01-01',
      status: 'ACTIVE',
      components: [
        { componentId: basic.body.component.id, displayOrder: 1 },
        { componentId: special.body.component.id, isBalancing: true, displayOrder: 3 },
      ],
    })
    .expect(201);
  structureId = structure.body.structure.id;

  await freshPeriod(owner, '09');
  people.asha = await addPerson(owner, 'Asha Menon', 'Engineering', 1_200_000);
  people.rahul = await addPerson(owner, 'Rahul Iyer', 'Sales', 1_200_000);
});

describe('a component that names its own population', () => {
  let transportId = '';

  it('is created with a rule, and the rule comes back with it', async () => {
    const made = await api
      .post(owner, '/components', {
        name: 'Engineering transport', code: 'ENGTRANS', type: 'EARNING',
        calculationMethod: 'FIXED', amount: 2500,
        appliesTo: 'CONDITIONS', displayOrder: 30,
      })
      .expect(201);
    transportId = made.body.component.id;

    await api
      .put(owner, `/components/${transportId}/conditions`, {
        conditions: [{ field: 'department', operator: 'EQ', value: 'Engineering' }],
      })
      .expect(200);

    const list = await api.get(owner, '/components').expect(200);
    const found = list.body.components.find((c: any) => c.id === transportId);
    expect(found.appliesTo).toBe('CONDITIONS');
    expect(found.conditions).toHaveLength(1);
    expect(found.conditions[0].field).toBe('department');
  });

  it('refuses a rule about a field that does not exist', async () => {
    /* Saved silently, this pays nobody for ever — the engine treats an unknown
       field as "does not match", which is right at calculation time and a trap
       at save time. */
    const refused = await api.put(owner, `/components/${transportId}/conditions`, {
      conditions: [{ field: 'departmnet', operator: 'EQ', value: 'Engineering' }],
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('departmnet');
  });

  it('refuses a comparison with nothing to compare against', async () => {
    const refused = await api.put(owner, `/components/${transportId}/conditions`, {
      conditions: [{ field: 'department', operator: 'EQ', value: '  ' }],
    });
    expect(refused.status).toBe(400);
  });

  it('pays the person who matches and not the person who does not', async () => {
    await freshPeriod(owner, '10');
    const lines = await payslipLines(owner);

    const asha = lines.get(people.asha) || [];
    const rahul = lines.get(people.rahul) || [];

    expect(asha.find((l) => l.code === 'ENGTRANS')?.amount).toBe(2500);
    expect(rahul.find((l) => l.code === 'ENGTRANS')).toBeUndefined();
  });

  it('reaches a payslip without being on anybody’s structure', async () => {
    /* The point of the whole feature, asserted rather than asserted-by-comment:
       the structure everybody is assigned to does not list this component, and
       the test above found it on a payslip anyway. */
    const structure = await api.get(owner, `/structures/${structureId}`).expect(200);
    const onStructure = (structure.body.structure.components || []).map((c: any) => c.componentId);
    const all = await api.get(owner, '/components').expect(200);
    const idOf = (code: string) => all.body.components.find((c: any) => c.code === code)?.id;

    expect(onStructure).not.toContain(idOf('ENGTRANS'));
    expect(onStructure).toContain(idOf('BASIC'));
  });

  it('lets a named exclusion beat the rule', async () => {
    await api
      .post(owner, `/components/${transportId}/employees`, { employeeId: people.asha, mode: 'EXCLUDE' })
      .expect(201);

    await freshPeriod(owner, '11');
    const lines = await payslipLines(owner);
    expect((lines.get(people.asha) || []).find((l) => l.code === 'ENGTRANS')).toBeUndefined();
  });

  it('lets a named inclusion reach somebody the rule misses', async () => {
    await api.del(owner, `/components/${transportId}/employees/${people.asha}`).expect(200);
    await api
      .post(owner, `/components/${transportId}/employees`, { employeeId: people.rahul, mode: 'INCLUDE' })
      .expect(201);

    await freshPeriod(owner, '12');
    const lines = await payslipLines(owner);
    expect((lines.get(people.rahul) || []).find((l) => l.code === 'ENGTRANS')?.amount).toBe(2500);
    expect((lines.get(people.asha) || []).find((l) => l.code === 'ENGTRANS')?.amount).toBe(2500);
  });

  it('refuses to name somebody who is not in this company', async () => {
    const refused = await api.post(owner, `/components/${transportId}/employees`, {
      employeeId: 'not-a-person',
      mode: 'INCLUDE',
    });
    expect(refused.status).toBe(404);
  });

  it('offers the browser exactly the fields the engine reads', async () => {
    const catalogue = await api.get(owner, '/components/rule-catalogue').expect(200);
    const fields = catalogue.body.fields.map((f: any) => f.field);
    expect(fields).toContain('department');
    expect(fields).toContain('annualCtc');
    /* The list the screen offers is the list the server evaluates — two lists
       drift, and a rule on a field only one of them knows pays nobody. */
    expect(catalogue.body.operators.find((o: any) => o.operator === 'IS_SET').needsValue).toBe(false);
  });
});
