import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * The cash and bank book.
 *
 * The last collection that lived only in a browser: money moving through a bank
 * account was recorded there and nowhere else, so clearing site data lost the
 * cash book — and the reconciliation screen, which reads these for the book
 * side, could match a statement line against one and then had nothing to mark.
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
  const email = `bb.${label}.${Date.now()}.${rnd()}@example.com`;
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

const entry = (over: Record<string, unknown> = {}) => ({
  ledgerAccountId: 'led-bank-1',
  direction: 'OUT',
  date: '2026-09-30',
  amount: 236,
  narration: 'Bank charges',
  ...over,
});

let owner: Ctx;
beforeAll(async () => {
  owner = await makeOwner('main');
}, 60_000);

describe('the cash and bank book', () => {
  it('stores a line and reads it back', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/bank-book`)
      .set(auth(owner))
      .send(entry())
      .expect(201);
    expect(created.body.entry.amount).toBe(236);
    expect(created.body.entry.direction).toBe('OUT');
    expect(created.body.entry.reconciled).toBe(false);

    const listed = await request(app).get(`/api/orgs/${owner.orgId}/bank-book`).set(auth(owner)).expect(200);
    expect(listed.body.entries.find((e: any) => e.id === created.body.entry.id)).toBeTruthy();
  });

  /*
   * Direction carries the sign, so the amount is a magnitude. A negative amount
   * with direction OUT would mean money coming in, said twice and contradicting
   * itself — and the reconciliation adds these up.
   */
  it('stores the amount as a magnitude whatever sign it arrives with', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/bank-book`)
      .set(auth(owner))
      .send(entry({ amount: -500 }))
      .expect(201);
    expect(created.body.entry.amount).toBe(500);
  });

  it('filters to one account', async () => {
    await request(app).post(`/api/orgs/${owner.orgId}/bank-book`).set(auth(owner)).send(entry({ ledgerAccountId: 'led-a' })).expect(201);
    await request(app).post(`/api/orgs/${owner.orgId}/bank-book`).set(auth(owner)).send(entry({ ledgerAccountId: 'led-b' })).expect(201);

    const listed = await request(app)
      .get(`/api/orgs/${owner.orgId}/bank-book?ledgerAccountId=led-a`)
      .set(auth(owner))
      .expect(200);
    expect(listed.body.entries.length).toBeGreaterThan(0);
    expect(listed.body.entries.every((e: any) => e.ledgerAccountId === 'led-a')).toBe(true);
  });

  it('categorises a line and deletes one', async () => {
    const created = await request(app).post(`/api/orgs/${owner.orgId}/bank-book`).set(auth(owner)).send(entry()).expect(201);
    const patched = await request(app)
      .patch(`/api/orgs/${owner.orgId}/bank-book/${created.body.entry.id}`)
      .set(auth(owner))
      .send({ contraLedgerAccountId: 'led-charges', narration: 'Quarterly charges' })
      .expect(200);
    expect(patched.body.entry.contraLedgerAccountId).toBe('led-charges');
    expect(patched.body.entry.narration).toBe('Quarterly charges');

    await request(app).delete(`/api/orgs/${owner.orgId}/bank-book/${created.body.entry.id}`).set(auth(owner)).expect(200);
    const listed = await request(app).get(`/api/orgs/${owner.orgId}/bank-book`).set(auth(owner)).expect(200);
    expect(listed.body.entries.find((e: any) => e.id === created.body.entry.id)).toBeUndefined();
  });

  /*
   * The payoff. Until the table existed the reconciliation could only tie off
   * the matches whose book side happened to be a receipt or a payment.
   */
  it('is marked against the statement, with the bank date and the reference', async () => {
    const created = await request(app).post(`/api/orgs/${owner.orgId}/bank-book`).set(auth(owner)).send(entry()).expect(201);
    const marked = await request(app)
      .patch(`/api/orgs/${owner.orgId}/bank-book/${created.body.entry.id}/reconcile`)
      .set(auth(owner))
      .send({ reconciled: true, bankDate: '2026-10-01', statementRef: 'HDFC Sep · BANK CHARGES' })
      .expect(200);
    expect(marked.body.entry.reconciled).toBe(true);
    expect(String(marked.body.entry.bankDate)).toContain('2026-10-01');
    expect(marked.body.entry.statementRef).toBe('HDFC Sep · BANK CHARGES');
  });

  /* Unmarking clears the date with it: a line that is not reconciled has no
     bank date, and leaving one behind reads as though it were. */
  it('clears the bank date when a line is unmarked', async () => {
    const created = await request(app).post(`/api/orgs/${owner.orgId}/bank-book`).set(auth(owner)).send(entry()).expect(201);
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/bank-book/${created.body.entry.id}/reconcile`)
      .set(auth(owner))
      .send({ reconciled: true, bankDate: '2026-10-01' })
      .expect(200);
    const cleared = await request(app)
      .patch(`/api/orgs/${owner.orgId}/bank-book/${created.body.entry.id}/reconcile`)
      .set(auth(owner))
      .send({ reconciled: false })
      .expect(200);
    expect(cleared.body.entry.reconciled).toBe(false);
    expect(cleared.body.entry.bankDate).toBeNull();
  });

  it("never shows or touches another account's book", async () => {
    const mine = await request(app).post(`/api/orgs/${owner.orgId}/bank-book`).set(auth(owner)).send(entry()).expect(201);
    const stranger = await makeOwner('stranger');

    const theirs = await request(app).get(`/api/orgs/${stranger.orgId}/bank-book`).set(auth(stranger)).expect(200);
    expect(theirs.body.entries.find((e: any) => e.id === mine.body.entry.id)).toBeUndefined();

    await request(app)
      .patch(`/api/orgs/${stranger.orgId}/bank-book/${mine.body.entry.id}`)
      .set(auth(stranger))
      .send({ amount: 1 })
      .expect(404);
    await request(app)
      .delete(`/api/orgs/${stranger.orgId}/bank-book/${mine.body.entry.id}`)
      .set(auth(stranger))
      .expect(404);
  });

  /* Two companies in one account — the case the account boundary hides. */
  it("keeps one account's two companies apart", async () => {
    const mine = await request(app).post(`/api/orgs/${owner.orgId}/bank-book`).set(auth(owner)).send(entry()).expect(201);
    const second = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ companyName: `BB Two ${Date.now()}-${rnd()}`, state: 'Kerala' })
      .expect(200);
    const sibling: Ctx = { token: owner.token, orgId: second.body.company.orgId, branchId: second.body.branch.id };

    const theirs = await request(app).get(`/api/orgs/${sibling.orgId}/bank-book`).set(auth(sibling)).expect(200);
    expect(theirs.body.entries.find((e: any) => e.id === mine.body.entry.id)).toBeUndefined();

    await request(app)
      .patch(`/api/orgs/${sibling.orgId}/bank-book/${mine.body.entry.id}/reconcile`)
      .set(auth(sibling))
      .send({ reconciled: true })
      .expect(404);
  });
});
