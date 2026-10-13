import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

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
  const email = `pos.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: `${label} owner` })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `${label} Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
};

/**
 * The Z report, on the server.
 *
 * It used to live in the browser: the over/short figure — the one number a
 * cash control exists to produce — was held by the machine that produced it
 * and nowhere else.
 */
describe('POS day close', () => {
  let owner: Ctx;
  let other: Ctx;

  beforeAll(async () => {
    owner = await makeOwner('till');
    other = await makeOwner('rival');
  });

  it('records the day and hands back what was counted', async () => {
    const date = `2026-09-${String(10 + Math.floor(Math.random() * 9)).padStart(2, '0')}`;
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/pos-day-closes`)
      .set(auth(owner))
      .send({
        date,
        invoices: 12,
        cash: 4300.5,
        upi: 1200,
        card: 800,
        total: 6300.5,
        countedCash: 4250.5,
        overShort: -50,
        denomCounts: { 500: 8, 100: 3 },
      })
      .expect(201);

    expect(created.body.dayClose.overShort).toBe(-50);
    expect(created.body.dayClose.denomCounts).toEqual({ 500: 8, 100: 3 });

    const listed = await request(app)
      .get(`/api/orgs/${owner.orgId}/pos-day-closes`)
      .set(auth(owner))
      .expect(200);
    const mine = listed.body.dayCloses.find((d: any) => d.date === date);
    expect(mine.cash).toBe(4300.5);
    expect(mine.countedCash).toBe(4250.5);
  });

  it('answers a second close of the same day with the one that stands', async () => {
    // The cashier pressed the button twice. Counting the till again would
    // double the day, and refusing outright would look like the close failed.
    const date = `2026-10-${String(10 + Math.floor(Math.random() * 9)).padStart(2, '0')}`;
    const first = await request(app)
      .post(`/api/orgs/${owner.orgId}/pos-day-closes`)
      .set(auth(owner))
      .send({ date, cash: 100, total: 100, countedCash: 100 })
      .expect(201);

    const again = await request(app)
      .post(`/api/orgs/${owner.orgId}/pos-day-closes`)
      .set(auth(owner))
      .send({ date, cash: 999, total: 999, countedCash: 999 })
      .expect(200);

    expect(again.body.alreadyClosed).toBe(true);
    expect(again.body.dayClose.id).toBe(first.body.dayClose.id);
    expect(again.body.dayClose.cash).toBe(100);
  });

  it('never shows one company the takings of another', async () => {
    const date = `2026-11-${String(10 + Math.floor(Math.random() * 9)).padStart(2, '0')}`;
    await request(app)
      .post(`/api/orgs/${owner.orgId}/pos-day-closes`)
      .set(auth(owner))
      .send({ date, cash: 7777, total: 7777 })
      .expect(201);

    const theirs = await request(app)
      .get(`/api/orgs/${other.orgId}/pos-day-closes`)
      .set(auth(other))
      .expect(200);
    expect(theirs.body.dayCloses.some((d: any) => d.cash === 7777)).toBe(false);
  });

  /*
   * Two companies inside ONE account — the CA firm case, which the
   * cross-account test above does not reach. Both share an accountId, so a
   * query scoped by account alone looks right and shows one shop's takings on
   * another shop's Z report.
   */
  it("keeps one account's two shops apart", async () => {
    const second = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ companyName: `Till Two ${Date.now()}-${rnd()}`, state: 'Kerala' })
      .expect(200);
    const sibling: Ctx = {
      token: owner.token,
      orgId: second.body.company.orgId,
      branchId: second.body.branch.id,
    };
    expect(sibling.orgId).not.toBe(owner.orgId);

    await request(app)
      .post(`/api/orgs/${owner.orgId}/pos-day-closes`)
      .set(auth(owner))
      .send({ date: '2026-12-01', cash: 6161, total: 6161 })
      .expect(201);

    const theirs = await request(app)
      .get(`/api/orgs/${sibling.orgId}/pos-day-closes`)
      .set(auth(sibling))
      .expect(200);
    expect(theirs.body.dayCloses.some((d: any) => d.cash === 6161)).toBe(false);
  });

  it('refuses an org the caller is not in', async () => {
    await request(app)
      .get(`/api/orgs/${other.orgId}/pos-day-closes`)
      .set(auth(owner))
      .expect(403);
  });
});
