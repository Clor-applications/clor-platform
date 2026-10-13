import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Whether payroll is ready to run.
 *
 * The thing worth holding is that every step is derived from records rather
 * than a stored flag. A wizard that writes "statutory: done" can say so about a
 * company with no rates; a step that reads the rates cannot. These tests prove
 * each step turns on when the thing it asks for appears — and, just as
 * important, turns back off when it is taken away.
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
  get: (c: Ctx, path: string) => request(app).get(`/api/orgs/${c.orgId}/payroll${path}`).set(at(c)),
};

async function makeOwner({ payroll = true } = {}): Promise<Ctx> {
  const email = `setup.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Setup Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  if (payroll) await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

const state = async (c: Ctx) => (await api.get(c, '/setup').expect(200)).body.setup;
const step = (s: any, key: string) => s.steps.find((x: any) => x.key === key);

describe('a company that has never run payroll', () => {
  it('answers even with payroll switched off, because that is who is asking', async () => {
    /* The setup screen has to be able to say "where am I" before the app is
       in use. Every route that does real work still refuses. */
    const c = await makeOwner({ payroll: false });

    const s = await state(c);
    expect(s.enabled).toBe(false);
    expect(s.ready).toBe(false);

    /* And a route that does something is still shut. */
    const refused = await api.get(c, '/runs');
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('PAYROLL_DISABLED');
  });

  it('has nothing done, and points at the first thing to do', async () => {
    const c = await makeOwner();
    const s = await state(c);

    expect(s.done).toBe(0);
    expect(s.total).toBe(5);
    expect(s.ready).toBe(false);
    expect(s.nextStep.key).toBe('calendar');
    expect(s.steps.every((x: any) => !x.done)).toBe(true);
  });
});

describe('each step turns on when the thing it asks for exists', () => {
  it('the pay calendar, once a month is open', async () => {
    const c = await makeOwner();
    expect(step(await state(c), 'calendar').done).toBe(false);

    const period = await api
      .post(c, '/periods', { name: `Jan ${rnd()}`, startDate: '2027-01-01', endDate: '2027-01-31', paymentDate: '2027-01-31' })
      .expect(201);

    expect(step(await state(c), 'calendar').done).toBe(true);

    /* And off again when the only month is closed — a locked month cannot be
       run, so it is not a calendar payroll can use. */
    await api.post(c, `/periods/${period.body.period.id}/lock`).expect(200);
    expect(step(await state(c), 'calendar').done).toBe(false);
  });

  it('the salary components, only once a structure combines them', async () => {
    const c = await makeOwner();
    const basic = await api
      .post(c, '/components', {
        name: 'Basic', code: 'BASIC', type: 'EARNING',
        calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1,
      })
      .expect(201);

    /* A component on its own pays nobody. */
    let s = await state(c);
    expect(step(s, 'components').done).toBe(false);
    expect(step(s, 'components').detail).toContain('no active structure');

    await api
      .post(c, '/structures', {
        name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2027-01-01', status: 'ACTIVE',
        components: [{ componentId: basic.body.component.id, displayOrder: 1 }],
      })
      .expect(201);

    expect(step(await state(c), 'components').done).toBe(true);
  });

  it('statutory, once the schemes exist', async () => {
    const c = await makeOwner();
    expect(step(await state(c), 'statutory').done).toBe(false);

    await api.post(c, '/statutory/seed').expect(200);

    const s = step(await state(c), 'statutory');
    expect(s.done).toBe(true);
    /* Seeded but none switched on is still "done" — a company may have none
       that apply, and the step asks whether the question has been answered. */
    expect(s.detail).toContain('of');
  });

  it('accounting, once every component has somewhere to post', async () => {
    const c = await makeOwner();

    /* Nothing to map is not the same as mapped. */
    expect(step(await state(c), 'accounting').done).toBe(false);
    expect(step(await state(c), 'accounting').detail).toContain('Waiting for');

    const { ensureLedgerSetup } = await import('../services/ledger.js');
    const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
    const org = await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } });
    await ensureLedgerSetup(org!.accountId, c.orgId, 'test');
    const expense = await prisma.ledgerAccount.findFirst({
      where: { accountId: org!.accountId, orgId: c.orgId, controlKind: 'EXPENSES' },
      select: { id: true },
    });

    const basic = await api
      .post(c, '/components', {
        name: 'Basic', code: 'BASIC', type: 'EARNING',
        calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1,
      })
      .expect(201);

    let s = step(await state(c), 'accounting');
    expect(s.done).toBe(false);
    expect(s.detail).toContain('Basic');

    await request(app)
      .put(`/api/orgs/${c.orgId}/payroll/components/${basic.body.component.id}/ledgers`)
      .set(at(c))
      .send({ expenseLedgerId: expense!.id })
      .expect(200);

    expect(step(await state(c), 'accounting').done).toBe(true);
  });

  it('the people, only once somebody has a salary', async () => {
    const c = await makeOwner();
    const basic = await api
      .post(c, '/components', {
        name: 'Basic', code: 'BASIC', type: 'EARNING',
        calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1,
      })
      .expect(201);
    const structure = await api
      .post(c, '/structures', {
        name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2027-01-01', status: 'ACTIVE',
        components: [{ componentId: basic.body.component.id, displayOrder: 1 }],
      })
      .expect(201);

    const person = await api
      .post(c, '/employees', {
        name: 'Ritika Chawla', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2027-01-01', status: 'ACTIVE',
        payroll: { payrollStatus: 'IN_PAYROLL' },
      })
      .expect(201);

    /* In payroll, but on nothing. */
    let s = step(await state(c), 'people');
    expect(s.done).toBe(false);
    expect(s.detail).toContain('none with a salary');

    await api
      .post(c, '/assignments', {
        employeeId: person.body.employee.id, structureId: structure.body.structure.id,
        effectiveFrom: '2027-01-01', annualCtc: 600_000,
      })
      .expect(201);

    expect(step(await state(c), 'people').done).toBe(true);
  });
});

describe('ready to run', () => {
  it('is only true once every step is', async () => {
    const c = await makeOwner();

    const { ensureLedgerSetup } = await import('../services/ledger.js');
    const { prisma } = await import('../utils/prisma.js');
    const { platformPrisma } = await import('../utils/platformPrisma.js');
    const org = await platformPrisma.org.findUnique({ where: { id: c.orgId }, select: { accountId: true } });
    await ensureLedgerSetup(org!.accountId, c.orgId, 'test');
    const expense = await prisma.ledgerAccount.findFirst({
      where: { accountId: org!.accountId, orgId: c.orgId, controlKind: 'EXPENSES' },
      select: { id: true },
    });

    await api.post(c, '/periods', { name: `Feb ${rnd()}`, startDate: '2027-02-01', endDate: '2027-02-28' }).expect(201);
    await api.post(c, '/statutory/seed').expect(200);

    const basic = await api
      .post(c, '/components', {
        name: 'Basic', code: 'BASIC', type: 'EARNING',
        calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', displayOrder: 1,
      })
      .expect(201);
    await request(app)
      .put(`/api/orgs/${c.orgId}/payroll/components/${basic.body.component.id}/ledgers`)
      .set(at(c))
      .send({ expenseLedgerId: expense!.id })
      .expect(200);

    const structure = await api
      .post(c, '/structures', {
        name: `Staff ${rnd()}`, frequency: 'MONTHLY', effectiveFrom: '2027-01-01', status: 'ACTIVE',
        components: [{ componentId: basic.body.component.id, displayOrder: 1 }],
      })
      .expect(201);

    /* Four of five: still not ready. */
    let s = await state(c);
    expect(s.ready).toBe(false);
    expect(s.nextStep.key).toBe('people');

    const person = await api
      .post(c, '/employees', {
        name: 'Ritika Chawla', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2027-01-01', status: 'ACTIVE',
        payroll: { payrollStatus: 'IN_PAYROLL' },
      })
      .expect(201);
    await api
      .post(c, '/assignments', {
        employeeId: person.body.employee.id, structureId: structure.body.structure.id,
        effectiveFrom: '2027-01-01', annualCtc: 600_000,
      })
      .expect(201);

    s = await state(c);
    expect(s.ready).toBe(true);
    expect(s.done).toBe(5);
    expect(s.nextStep).toBe(null);
  });

  it('stops being true when what made it true is taken away', async () => {
    /* A stored "setup complete" flag would still say ready here. */
    const c = await makeOwner();
    await api.post(c, '/periods', { name: `Mar ${rnd()}`, startDate: '2027-03-01', endDate: '2027-03-31' }).expect(201);
    expect(step(await state(c), 'calendar').done).toBe(true);

    await payrollPrisma.payrollPeriod.deleteMany({ where: { orgId: c.orgId } });
    expect(step(await state(c), 'calendar').done).toBe(false);
  });
});
