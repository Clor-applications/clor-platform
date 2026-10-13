import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Who is paid, and for when.
 *
 * A pay group is the population a run is drawn from; a period is the interval
 * it is filed against. Together they are what makes a payroll run identifiable
 * rather than just "this month's" — and both carry rules that nothing
 * downstream can recover from being broken:
 *
 *   - two periods on the same cycle must not cover the same day, or an
 *     adjustment has no answer to which payroll it belongs in;
 *   - a period's dates cannot move once payroll has been calculated on them,
 *     because proration is days-in-period and the payslips would stop matching;
 *   - a locked period is a closed book.
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

const at = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `cal.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Payroll owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Cal Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { payroll: true } }).expect(200);
  return ctx;
}

const groups = {
  list: (c: Ctx) => request(app).get(`/api/orgs/${c.orgId}/payroll/pay-groups`).set(at(c)),
  create: (c: Ctx, body: Record<string, unknown>) =>
    request(app).post(`/api/orgs/${c.orgId}/payroll/pay-groups`).set(at(c)).send(body),
  update: (c: Ctx, id: string, body: Record<string, unknown>) =>
    request(app).put(`/api/orgs/${c.orgId}/payroll/pay-groups/${id}`).set(at(c)).send(body),
  destroy: (c: Ctx, id: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll/pay-groups/${id}`).set(at(c)),
};

const periods = {
  list: (c: Ctx) => request(app).get(`/api/orgs/${c.orgId}/payroll/periods`).set(at(c)),
  create: (c: Ctx, body: Record<string, unknown>) =>
    request(app).post(`/api/orgs/${c.orgId}/payroll/periods`).set(at(c)).send(body),
  update: (c: Ctx, id: string, body: Record<string, unknown>) =>
    request(app).put(`/api/orgs/${c.orgId}/payroll/periods/${id}`).set(at(c)).send(body),
  lock: (c: Ctx, id: string, locked = true) =>
    request(app).post(`/api/orgs/${c.orgId}/payroll/periods/${id}/lock`).set(at(c)).send({ locked }),
  destroy: (c: Ctx, id: string) => request(app).delete(`/api/orgs/${c.orgId}/payroll/periods/${id}`).set(at(c)),
};

const SEPTEMBER = { name: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', paymentDate: '2026-09-30' };

/** A run, written straight into payroll's own database. */
const makeRun = (orgId: string, periodId: string, payGroupId?: string) =>
  payrollPrisma.payrollRun.create({
    data: {
      accountId: 'acct-test',
      orgId,
      number: `RUN-${rnd()}`,
      periodId,
      ...(payGroupId ? { payGroupId } : {}),
      payrollDate: '2026-09-30',
      createdByUserId: 'user-test',
    },
  });

beforeAll(async () => {
  owner = await makeOwner();
});

describe('pay groups', () => {
  it('records one and reports that nothing depends on it yet', async () => {
    const made = await groups.create(owner, { name: 'Monthly staff', frequency: 'MONTHLY', paymentDay: 30 }).expect(201);
    expect(made.body.payGroup).toMatchObject({ name: 'Monthly staff', frequency: 'MONTHLY', paymentDay: 30 });
    expect(made.body.payGroup.usage.total).toBe(0);
  });

  it('refuses a second group with the same name', async () => {
    await groups.create(owner, { name: 'Monthly staff', frequency: 'MONTHLY' }).expect(409);
  });

  it('refuses a day of the month on a cycle that has no month', async () => {
    /* A weekly group is paid on a weekday. Accepting "30" here would store a
       number that means nothing and reads as if it means something. */
    const bad = await groups.create(owner, { name: `Weekly ${rnd()}`, frequency: 'WEEKLY', paymentDay: 30 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/day of the month/i);
  });

  it('keeps its cycle once runs have been drawn on it', async () => {
    const made = await groups.create(owner, { name: `Site labour ${rnd()}`, frequency: 'MONTHLY' }).expect(201);
    const id = made.body.payGroup.id;
    /* Its own month: periods on one cycle may not overlap, so a fixture that
       reused September would collide with the period tests below. */
    const period = await periods.create(owner, { name: `May ${rnd()}`, startDate: '2026-05-01', endDate: '2026-05-31' }).expect(201);
    await makeRun(owner.orgId, period.body.period.id, id);

    /* Renaming stays available — it is the rhythm past runs were drawn on that
       cannot move. */
    await groups.update(owner, id, { name: `Site labour renamed ${rnd()}`, frequency: 'MONTHLY' }).expect(200);

    const retimed = await groups.update(owner, id, { name: `Site labour ${rnd()}`, frequency: 'WEEKLY' });
    expect(retimed.status).toBe(409);
    expect(retimed.body.code).toBe('PAY_GROUP_IN_USE');
  });

  it('cannot be deleted while a run points at it, and says what is holding it', async () => {
    const made = await groups.create(owner, { name: `Contractors ${rnd()}`, frequency: 'MONTHLY' }).expect(201);
    const id = made.body.payGroup.id;
    const period = await periods.create(owner, { name: `Jun ${rnd()}`, startDate: '2026-06-01', endDate: '2026-06-30' }).expect(201);
    await makeRun(owner.orgId, period.body.period.id, id);

    const refused = await groups.destroy(owner, id);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/1 payroll run/);
  });

  it('can be deleted while nothing points at it', async () => {
    const made = await groups.create(owner, { name: `Interns ${rnd()}`, frequency: 'MONTHLY' }).expect(201);
    await groups.destroy(owner, made.body.payGroup.id).expect(200);
  });
});

describe('payroll periods', () => {
  it('records one', async () => {
    const made = await periods.create(owner, SEPTEMBER).expect(201);
    expect(made.body.period).toMatchObject({ name: 'September 2026', startDate: '2026-09-01', isLocked: false });
  });

  it('refuses a period that ends before it starts', async () => {
    const bad = await periods.create(owner, { name: `Backwards ${rnd()}`, startDate: '2026-09-30', endDate: '2026-09-01' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/before it starts/i);
  });

  it('refuses two periods on the same cycle covering the same days', async () => {
    /* An adjustment belongs to a period. Two periods over one day means a
       bonus lands in whichever run is calculated first. */
    const overlap = await periods.create(owner, {
      name: `Mid September ${rnd()}`,
      startDate: '2026-09-15',
      endDate: '2026-10-14',
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toBe('PAYROLL_PERIOD_OVERLAP');
    expect(overlap.body.error).toContain('September 2026');
  });

  it('allows a different cycle over the same days, because that is what running both means', async () => {
    await periods
      .create(owner, { name: `Week 37 ${rnd()}`, startDate: '2026-09-07', endDate: '2026-09-13', frequency: 'WEEKLY' })
      .expect(201);
  });

  it('keeps its dates once payroll has been calculated on them', async () => {
    const made = await periods.create(owner, { name: `Nov ${rnd()}`, startDate: '2026-11-01', endDate: '2026-11-30' }).expect(201);
    const id = made.body.period.id;

    /* Free to move while nothing has been filed against it. */
    await periods.update(owner, id, { name: made.body.period.name, startDate: '2026-11-01', endDate: '2026-11-29' }).expect(200);

    await makeRun(owner.orgId, id);

    const moved = await periods.update(owner, id, { name: made.body.period.name, startDate: '2026-11-02', endDate: '2026-11-30' });
    expect(moved.status).toBe(409);
    expect(moved.body.code).toBe('PAYROLL_PERIOD_IN_USE');

    /* Renaming does not touch the arithmetic, so it stays allowed. */
    await periods.update(owner, id, { name: `November 2026 ${rnd()}`, startDate: '2026-11-01', endDate: '2026-11-29' }).expect(200);
  });
});

describe('locking a period', () => {
  it('refuses while a run in it is still open', async () => {
    const made = await periods.create(owner, { name: `Dec ${rnd()}`, startDate: '2026-12-01', endDate: '2026-12-31' }).expect(201);
    const id = made.body.period.id;
    await makeRun(owner.orgId, id); // DRAFT by default

    const refused = await periods.lock(owner, id);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PAYROLL_PERIOD_HAS_OPEN_RUNS');
  });

  it('closes the book once nothing is in flight, and refuses changes after', async () => {
    const made = await periods.create(owner, { name: `Jan ${rnd()}`, startDate: '2027-01-01', endDate: '2027-01-31' }).expect(201);
    const id = made.body.period.id;

    const locked = await periods.lock(owner, id).expect(200);
    expect(locked.body.period).toMatchObject({ isLocked: true, status: 'CLOSED' });

    const edit = await periods.update(owner, id, { name: made.body.period.name, startDate: '2027-01-01', endDate: '2027-01-30' });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('PAYROLL_PERIOD_LOCKED');

    const removed = await periods.destroy(owner, id);
    expect(removed.status).toBe(409);
    expect(removed.body.code).toBe('PAYROLL_PERIOD_LOCKED');
  });

  it('can be reopened deliberately', async () => {
    const made = await periods.create(owner, { name: `Feb ${rnd()}`, startDate: '2027-02-01', endDate: '2027-02-28' }).expect(201);
    const id = made.body.period.id;
    await periods.lock(owner, id).expect(200);
    const reopened = await periods.lock(owner, id, false).expect(200);
    expect(reopened.body.period).toMatchObject({ isLocked: false, status: 'OPEN' });
    await periods.update(owner, id, { name: made.body.period.name, startDate: '2027-02-01', endDate: '2027-02-27' }).expect(200);
  });
});

describe('the boundary still holds', () => {
  it('shows one organisation nothing of another’s calendar', async () => {
    const other = await makeOwner();
    await groups.create(other, { name: 'Their group', frequency: 'MONTHLY' }).expect(201);
    await periods.create(other, { name: 'Their September', startDate: '2026-09-01', endDate: '2026-09-30' }).expect(201);

    const theirGroups = await groups.list(other).expect(200);
    const theirPeriods = await periods.list(other).expect(200);
    expect(theirGroups.body.payGroups).toHaveLength(1);
    expect(theirPeriods.body.periods).toHaveLength(1);

    const ourGroups = await groups.list(owner).expect(200);
    expect(ourGroups.body.payGroups.some((g: any) => g.name === 'Their group')).toBe(false);
  });

  it('answers nothing for an organisation that has not switched payroll on', async () => {
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email: `off.${Date.now()}.${rnd()}@example.com`, password: 'Passw0rd!23', name: 'No payroll' })
      .expect(200);
    const setup = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${signup.body.token}`)
      .send({ companyName: `Off Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
      .expect(200);
    const off = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };

    const a = await groups.list(off).expect(403);
    expect(a.body.code).toBe('PAYROLL_DISABLED');
    await periods.list(off).expect(403);
  });
});
