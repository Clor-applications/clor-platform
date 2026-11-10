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

async function makeOwner({ payroll = true } = {}): Promise<Ctx> {
  const email = `setup.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Setup Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  /* A fresh account owns every sellable app (explicit bootstrap subscription), so
     "off" is now the customer turning the app off, not a catalog default. */
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: !!payroll } }).expect(200);
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
    expect(s.total).toBe(6);
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

    /* Four of the five a payslip needs: still not ready. The registrations
       step waits too, but payroll can run without it. */
    let s = await state(c);
    expect(s.ready).toBe(false);
    expect(s.nextStep.key).toBe('registrations');
    expect(step(s, 'registrations').optional).toBe(true);

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

    /* Everything a payslip needs: ready, with the registrations still on the list. */
    s = await state(c);
    expect(s.ready).toBe(true);
    expect(s.done).toBe(5);
    expect(s.total).toBe(6);
    expect(s.nextStep.key).toBe('registrations');

    await api.put(c, '/settings/statutory-registrations', { tds: { applies: true, tan: 'BLRA12345B' } }).expect(200);
    s = await state(c);
    expect(s.ready).toBe(true);
    expect(s.done).toBe(6);
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

/**
 * The statutory registrations step (roadmap 15). The numbers each return is
 * filed under are asked for in setup, kept where Compliance keeps them, and
 * checked in the shape their portal wants.
 */
describe('statutory registrations', () => {
  const REG = '/settings/statutory-registrations';

  it('starts unanswered, and the step says so without blocking payroll', async () => {
    const c = await makeOwner();
    const r = (await api.get(c, REG).expect(200)).body;
    expect(r.answeredAt).toBe(null);
    expect(r.done).toBe(false);
    expect(r.hasSchemes).toBe(false);
    expect(r.pt.levyStates.map((s: any) => s.label)).toContain('Karnataka');
    expect(r.deductorTypes.map((d: any) => d.code)).toContain('COMPANY');

    const st = step(await state(c), 'registrations');
    expect(st.done).toBe(false);
    expect(st.optional).toBe(true);
    expect(st.detail).toContain('Not entered yet');
  });

  it('refuses a number in the wrong shape, saying what the shape is', async () => {
    const c = await makeOwner();
    let r = await api.put(c, REG, { tds: { applies: true, tan: 'BLR12345B' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('four letters, five numbers and a letter');

    r = await api.put(c, REG, { pf: { applies: true, code: 'KN/BNG/12' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('KNBNG0012345000');

    r = await api.put(c, REG, { esi: { applies: true, code: '1234' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('17 digits');

    /* Nothing was written by a refused save. */
    expect((await api.get(c, REG).expect(200)).body.answeredAt).toBe(null);

    /* The Compliance screen's own field is held to the same shape. */
    await api.post(c, '/statutory/seed').expect(200);
    const schemes = (await api.get(c, '/statutory').expect(200)).body.schemes;
    const tds = schemes.find((s: any) => s.code === 'TDS');
    r = await api.put(c, `/statutory/schemes/${tds.id}`, { isEnabled: false, registrationNumber: 'nope' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('BAD_REGISTRATION_NUMBER');
  });

  it('saves to the same fields Compliance edits, adds the standard rates if none exist, and audits', async () => {
    const c = await makeOwner();
    const saved = (
      await api
        .put(c, REG, {
          pf: { applies: true, code: 'kn/bng/0012345/000', contributeOnFullWage: false },
          esi: { applies: false, code: null },
          pt: { applies: true, registrations: [{ state: 'KA', registrationNumber: 'ptr 1234' }] },
          tds: { applies: true, tan: 'blra12345b', deductorType: 'COMPANY', responsibleName: 'Ritika Chawla', responsibleDesignation: 'Director' },
        })
        .expect(200)
    ).body;

    /* Tidy, upper case, slashes out: the way the portals take them. */
    expect(saved.pf).toMatchObject({ applies: true, code: 'KNBNG0012345000', contributeOnFullWage: false, wageCeiling: 15000 });
    expect(saved.esi).toMatchObject({ applies: false, code: '', eligibilityThreshold: 21000 });
    expect(saved.pt.applies).toBe(true);
    expect(saved.pt.registrations).toEqual([{ state: 'KARNATAKA', label: 'Karnataka', registrationNumber: 'PTR 1234', people: 0 }]);
    expect(saved.tds).toMatchObject({ applies: true, tan: 'BLRA12345B', deductorType: 'COMPANY', responsibleName: 'Ritika Chawla', responsibleDesignation: 'Director' });
    expect(saved.answeredAt).toBeTruthy();
    expect(saved.missing).toEqual([]);
    expect(saved.done).toBe(true);
    expect(saved.hasSchemes).toBe(true);

    /* The Compliance screen reads the very same numbers. */
    const schemes = (await api.get(c, '/statutory').expect(200)).body.schemes;
    expect(schemes.find((s: any) => s.code === 'PF')).toMatchObject({ isEnabled: true, registrationNumber: 'KNBNG0012345000' });
    expect(schemes.find((s: any) => s.code === 'TDS')).toMatchObject({ isEnabled: true, registrationNumber: 'BLRA12345B' });
    expect(schemes.find((s: any) => s.code === 'ESI').isEnabled).toBe(false);

    /* And Form 16 finds the TAN where it always looked. */
    const { employerFor } = await import('../services/payroll/form16.js');
    expect((await employerFor(c.orgId)).tan).toBe('BLRA12345B');

    const st = step(await state(c), 'registrations');
    expect(st.done).toBe(true);
    expect(st.detail).toBe('PF, professional tax, income tax registered');

    const { platformPrisma } = await import('../utils/platformPrisma.js');
    const audit = await platformPrisma.auditLog.findFirst({ where: { orgId: c.orgId, entity: 'PAYROLL_SETTINGS' }, orderBy: { createdAt: 'desc' } });
    expect(audit?.message).toContain('Statutory registrations saved');
    expect(audit?.message).toContain('KNBNG0012345000');
    expect(audit?.message).toContain('TAN BLRA12345B');
  });

  it('a scheme that applies without its number is missing, on the checklist and the pay run alike', async () => {
    const c = await makeOwner();
    const saved = (await api.put(c, REG, { pf: { applies: true, code: null }, tds: { applies: true, tan: null } }).expect(200)).body;
    expect(saved.done).toBe(false);
    expect(saved.missing.map((m: any) => m.message)).toEqual([
      'PF ECR cannot be filed until the PF establishment code is added.',
      'Form 24Q cannot be filed until the TAN is added.',
    ]);
    const st = step(await state(c), 'registrations');
    expect(st.done).toBe(false);
    expect(st.detail).toBe('Missing: PF establishment code, TAN');

    /* Professional tax: missing for a state with people in payroll, not for one nobody works in. */
    await api.put(c, REG, { pt: { applies: true, registrations: [] } }).expect(200);
    const person = await api
      .post(c, '/employees', {
        name: 'Ritika Chawla', code: `E${rnd().toUpperCase()}`, dateOfJoining: '2027-01-01', status: 'ACTIVE',
        payroll: { payrollStatus: 'IN_PAYROLL', professionalTaxState: 'Karnataka' },
      })
      .expect(201);
    expect(person.body.employee.id).toBeTruthy();
    let r = (await api.get(c, REG).expect(200)).body;
    expect(r.pt.registrations).toEqual([{ state: 'KARNATAKA', label: 'Karnataka', registrationNumber: '', people: 1 }]);
    expect(r.missing.map((m: any) => m.short)).toContain('Karnataka professional tax registration');

    await api.put(c, REG, { pt: { applies: true, registrations: [{ state: 'Karnataka', registrationNumber: 'PTR-KA-1' }] } }).expect(200);
    r = (await api.get(c, REG).expect(200)).body;
    expect(r.missing.map((m: any) => m.scheme)).not.toContain('PT');

    /* The pay run screen carries the same lines. */
    await api.post(c, '/periods', { name: `Apr ${rnd()}`, startDate: '2027-04-01', endDate: '2027-04-30', paymentDate: '2027-04-30' }).expect(201);
    const periods = (await api.get(c, '/periods').expect(200)).body.periods;
    const run = await api.post(c, '/runs', { periodId: periods[0].id, payrollDate: '2027-04-30' });
    expect([200, 201]).toContain(run.status);
    const detail = (await api.get(c, `/runs/${run.body.run.id}`).expect(200)).body;
    expect(detail.registrationGaps.map((g: any) => g.message)).toEqual([
      'PF ECR cannot be filed until the PF establishment code is added.',
      'Form 24Q cannot be filed until the TAN is added.',
    ]);

    /* Adding the code takes the line away. */
    await api.put(c, REG, { pf: { applies: true, code: 'KNBNG0012345000' } }).expect(200);
    const again = (await api.get(c, `/runs/${run.body.run.id}`).expect(200)).body;
    expect(again.registrationGaps.map((g: any) => g.scheme)).toEqual(['TDS']);
  });

  it('choosing the full PF wage publishes a new PF rate from today and leaves the old one on record', async () => {
    const c = await makeOwner();
    await api.put(c, REG, { pf: { applies: true, code: 'KNBNG0012345000', contributeOnFullWage: true } }).expect(200);
    const pf = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PF');
    const active = pf.rules.filter((r: any) => r.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0].config.contributeOnFullWage).toBe(true);
    expect(active[0].origin).toBe('COMPANY');
    expect(active[0].config.epsRate).toBe(8.33);
    const superseded = pf.rules.filter((r: any) => r.status === 'SUPERSEDED');
    expect(superseded).toHaveLength(1);
    expect(superseded[0].config.contributeOnFullWage).toBe(false);
    expect((await api.get(c, REG).expect(200)).body.pf.contributeOnFullWage).toBe(true);

    /* Saying the same thing again writes nothing. */
    await api.put(c, REG, { pf: { applies: true, code: 'KNBNG0012345000', contributeOnFullWage: true } }).expect(200);
    const after = (await api.get(c, '/statutory').expect(200)).body.schemes.find((s: any) => s.code === 'PF');
    expect(after.rules).toHaveLength(pf.rules.length);
  });

  it('only somebody who may edit payroll settings saves them', async () => {
    const c = await makeOwner();
    const email = `viewer.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Viewer' }).expect(200);
    const stranger = { token: signup.body.token, orgId: c.orgId, branchId: c.branchId };
    const r = await request(app).put(`/api/orgs/${c.orgId}/payroll${REG}`).set(at(stranger)).send({ tds: { applies: true, tan: 'BLRA12345B' } });
    expect([401, 403]).toContain(r.status);
  });
});
