import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { advanceRunDate, runDueSchedules } from '../services/recurring.js';

/**
 * Recurring invoices, once they are a service rather than a browser tab.
 *
 * They used to be raised when somebody signed in: schedules lived in
 * localStorage, clearing the browser lost them, nobody signing in meant nobody
 * was billed, and two open tabs could raise the same month twice.
 *
 * Most of what follows is about that last one. Billing a customer twice for one
 * period is the failure that costs a supplier their credibility, and the only
 * thing preventing it is the uniqueness of the period claim.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const makeOwner = async (label: string): Promise<Ctx> => {
  const email = `rec.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: `${label} owner` })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Rec ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
};

const schedule = (over: Record<string, unknown> = {}) => ({
  name: `Monthly retainer ${rnd()}`,
  partyName: 'Acme Traders',
  frequency: 'MONTHLY',
  nextRunDate: '2026-01-01',
  dueDays: 15,
  template: {
    items: [{ description: 'Retainer', quantity: 1, rate: 10000, gstRate: 18, amount: 10000 }],
    subtotal: 10000,
    cgstTotal: 900,
    sgstTotal: 900,
    gstTotal: 1800,
    total: 11800,
  },
  ...over,
});

const drafts = (orgId: string) =>
  prisma.invoice.findMany({ where: { orgId, status: 'Draft' }, orderBy: { date: 'asc' } });

let owner: Ctx;
beforeAll(async () => {
  owner = await makeOwner('main');
}, 60_000);

describe('the schedule itself', () => {
  it('is stored on the server, not in a browser', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/recurring`)
      .set(auth(owner))
      .send(schedule())
      .expect(201);
    expect(created.body.schedule.id).toBeTruthy();
    // The invoice it raises is kept whole: a schedule must keep billing what
    // was agreed even after the item's price changes.
    expect(created.body.schedule.template.total).toBe(11800);

    const listed = await request(app).get(`/api/orgs/${owner.orgId}/recurring`).set(auth(owner)).expect(200);
    expect(listed.body.schedules.find((s: any) => s.id === created.body.schedule.id)).toBeTruthy();
  });

  it('can be paused and deleted', async () => {
    const c = await request(app).post(`/api/orgs/${owner.orgId}/recurring`).set(auth(owner)).send(schedule()).expect(201);
    const paused = await request(app)
      .patch(`/api/orgs/${owner.orgId}/recurring/${c.body.schedule.id}`)
      .set(auth(owner))
      .send({ isActive: false })
      .expect(200);
    expect(paused.body.schedule.isActive).toBe(false);
    await request(app).delete(`/api/orgs/${owner.orgId}/recurring/${c.body.schedule.id}`).set(auth(owner)).expect(200);
  });
});

describe('raising what is due', () => {
  it('raises one draft per period that has passed', async () => {
    const org = await makeOwner('catchup');
    await request(app)
      .post(`/api/orgs/${org.orgId}/recurring`)
      .set(auth(org))
      .send(schedule({ nextRunDate: '2026-01-01' }))
      .expect(201);

    // Three months have passed: January, February, March.
    const summary = await runDueSchedules({ orgId: org.orgId, today: '2026-03-15' });
    expect(summary.raised).toBe(3);

    const raised = await drafts(org.orgId);
    expect(raised.map((i) => i.date)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  /*
   * The one that matters. Two tabs, two instances or a retried job must not
   * bill a customer twice for one month.
   */
  it('raises nothing on a second run', async () => {
    const org = await makeOwner('idem');
    await request(app).post(`/api/orgs/${org.orgId}/recurring`).set(auth(org)).send(schedule()).expect(201);

    const first = await runDueSchedules({ orgId: org.orgId, today: '2026-02-15' });
    expect(first.raised).toBe(2);

    const second = await runDueSchedules({ orgId: org.orgId, today: '2026-02-15' });
    expect(second.raised).toBe(0);
    expect(await drafts(org.orgId)).toHaveLength(2);
  });

  /* Two runs at the same moment, which is the race the claim exists for. */
  it('raises nothing extra when two runs race', async () => {
    const org = await makeOwner('race');
    await request(app).post(`/api/orgs/${org.orgId}/recurring`).set(auth(org)).send(schedule()).expect(201);

    const [a, b] = await Promise.all([
      runDueSchedules({ orgId: org.orgId, today: '2026-02-15' }),
      runDueSchedules({ orgId: org.orgId, today: '2026-02-15' }),
    ]);
    expect(a.raised + b.raised).toBe(2);
    expect(await drafts(org.orgId)).toHaveLength(2);
  });

  /*
   * A draft, never a posted invoice. Nothing reaches the ledger until a person
   * opens it, so a forgotten schedule cannot quietly bill somebody for a year.
   */
  it('raises drafts, unnumbered, with a due date', async () => {
    const org = await makeOwner('draft');
    await request(app)
      .post(`/api/orgs/${org.orgId}/recurring`)
      .set(auth(org))
      .send(schedule({ nextRunDate: '2026-01-01', dueDays: 15 }))
      .expect(201);
    await runDueSchedules({ orgId: org.orgId, today: '2026-01-10' });

    const [inv] = await drafts(org.orgId);
    expect(inv.status).toBe('Draft');
    /*
     * A provisional marker, not a series number: a draft is not an issued
     * invoice, and letting it consume a number leaves a hole in a series that
     * has to be consecutive. Keyed to the schedule and period, so the invoice
     * table itself refuses a duplicate even without the run claim.
     */
    expect(inv.number).toMatch(/^DRAFT\//);
    expect(inv.number).toContain('2026-01-01');
    // A draft with no due date can never be overdue.
    expect(inv.dueDate).toBe('2026-01-16');
    expect(Number(inv.total)).toBe(11800);
  });

  it('stops at the end date', async () => {
    const org = await makeOwner('enddate');
    await request(app)
      .post(`/api/orgs/${org.orgId}/recurring`)
      .set(auth(org))
      .send(schedule({ nextRunDate: '2026-01-01', endDate: '2026-02-01' }))
      .expect(201);
    await runDueSchedules({ orgId: org.orgId, today: '2026-06-01' });
    expect(await drafts(org.orgId)).toHaveLength(2);
  });

  /* "End after 3 invoices" is a different instruction from an end date. */
  it('stops after the agreed number of invoices', async () => {
    const org = await makeOwner('count');
    await request(app)
      .post(`/api/orgs/${org.orgId}/recurring`)
      .set(auth(org))
      .send(schedule({ nextRunDate: '2026-01-01', maxOccurrences: 3 }))
      .expect(201);
    await runDueSchedules({ orgId: org.orgId, today: '2026-12-01' });
    expect(await drafts(org.orgId)).toHaveLength(3);
  });

  it('raises nothing for a paused schedule', async () => {
    const org = await makeOwner('paused');
    const c = await request(app).post(`/api/orgs/${org.orgId}/recurring`).set(auth(org)).send(schedule()).expect(201);
    await request(app)
      .patch(`/api/orgs/${org.orgId}/recurring/${c.body.schedule.id}`)
      .set(auth(org))
      .send({ isActive: false })
      .expect(200);
    await runDueSchedules({ orgId: org.orgId, today: '2026-06-01' });
    expect(await drafts(org.orgId)).toHaveLength(0);
  });

  /* A schedule dormant for years must not flood the list on the day it wakes. */
  it('caps how far it will catch up', async () => {
    const org = await makeOwner('flood');
    await request(app)
      .post(`/api/orgs/${org.orgId}/recurring`)
      .set(auth(org))
      .send(schedule({ nextRunDate: '2020-01-01' }))
      .expect(201);
    await runDueSchedules({ orgId: org.orgId, today: '2026-01-01' });
    expect((await drafts(org.orgId)).length).toBeLessThanOrEqual(12);
  });

  it('records what it raised, and against which period', async () => {
    const org = await makeOwner('runs');
    const c = await request(app).post(`/api/orgs/${org.orgId}/recurring`).set(auth(org)).send(schedule()).expect(201);
    await runDueSchedules({ orgId: org.orgId, today: '2026-02-15' });

    const runs = await request(app)
      .get(`/api/orgs/${org.orgId}/recurring/${c.body.schedule.id}/runs`)
      .set(auth(org))
      .expect(200);
    expect(runs.body.runs).toHaveLength(2);
    expect(runs.body.runs.every((r: any) => r.invoiceId)).toBe(true);
  });

  it('can be triggered from the app and is safe to press twice', async () => {
    const org = await makeOwner('button');
    await request(app).post(`/api/orgs/${org.orgId}/recurring`).set(auth(org)).send(schedule()).expect(201);
    const first = await request(app).post(`/api/orgs/${org.orgId}/recurring/run`).set(auth(org)).expect(200);
    expect(first.body.raised).toBeGreaterThan(0);
    const second = await request(app).post(`/api/orgs/${org.orgId}/recurring/run`).set(auth(org)).expect(200);
    expect(second.body.raised).toBe(0);
  });

  it("never raises into another account's books", async () => {
    const mine = await makeOwner('mine');
    const stranger = await makeOwner('stranger');
    await request(app).post(`/api/orgs/${mine.orgId}/recurring`).set(auth(mine)).send(schedule()).expect(201);

    await runDueSchedules({ orgId: stranger.orgId, today: '2026-06-01' });
    expect(await drafts(stranger.orgId)).toHaveLength(0);

    const listed = await request(app).get(`/api/orgs/${stranger.orgId}/recurring`).set(auth(stranger)).expect(200);
    expect(listed.body.schedules).toHaveLength(0);
  });
});

describe('working out the next period', () => {
  it('keeps to the end of a short month', () => {
    // Jan 31 + 1 month is Feb 28, not Mar 3.
    expect(advanceRunDate('2026-01-31', 'MONTHLY')).toBe('2026-02-28');
  });

  it.each([
    ['WEEKLY', 1, '2026-01-08'],
    ['MONTHLY', 1, '2026-02-01'],
    ['QUARTERLY', 1, '2026-04-01'],
    ['YEARLY', 1, '2027-01-01'],
    ['MONTHLY', 2, '2026-03-01'],
  ])('advances %s every %i period(s)', (freq, interval, expected) => {
    expect(advanceRunDate('2026-01-01', freq as string, interval as number)).toBe(expected);
  });
});
