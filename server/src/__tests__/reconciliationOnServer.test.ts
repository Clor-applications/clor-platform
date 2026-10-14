import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * Bank reconciliation, kept on the server for every kind of movement.
 *
 * Only payments reached the server. A reconciled statement line or contra,
 * and the whole bank-date history, lived in the browser and were lost on the
 * next reload.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;
let bankId: string;
let cashId: string;

const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const rnd = () => Math.random().toString(36).slice(2, 8);

const audit = async () => (await request(app).get(`/api/orgs/${owner.orgId}/bank-date-audit`).set(auth(owner)).expect(200)).body.audit;

beforeAll(async () => {
  const email = `recon.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Recon Owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Recon Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };

  const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
  await request(app)
    .put(`/api/orgs/${owner.orgId}/features`)
    .set(auth(owner))
    .send({ features: { ...(current.body.features || {}), bankReconciliation: true } })
    .expect(200);

  bankId = (
    await request(app).post(`/api/orgs/${owner.orgId}/ledger/accounts`).set(auth(owner)).send({ name: `Bank ${rnd()}`, accountType: 'ASSET', controlKind: 'BANK' }).expect(201)
  ).body.account.id;
  cashId = (
    await request(app).post(`/api/orgs/${owner.orgId}/ledger/accounts`).set(auth(owner)).send({ name: `Cash ${rnd()}`, accountType: 'ASSET', controlKind: 'CASH' }).expect(201)
  ).body.account.id;
}, 60_000);

describe('a payment', () => {
  it('records RECONCILED, REDATED and UNRECONCILED, and nothing for a repeat of the same', async () => {
    const pay = await request(app)
      .post(`/api/orgs/${owner.orgId}/payments`)
      .set(auth(owner))
      .send({ direction: 'RECEIPT', date: '2026-09-02', partyType: 'CUSTOMER', partyName: 'Acme', ledgerAccountId: bankId, amount: 500 })
      .expect(201);
    const id = pay.body.payment.id;
    const reconcile = (body: any) => request(app).patch(`/api/orgs/${owner.orgId}/payments/${id}/reconcile`).set(auth(owner)).send(body).expect(200);

    await reconcile({ reconciled: true, bankDate: '2026-09-04' });
    await reconcile({ reconciled: true, bankDate: '2026-09-04' }); // no change, no row
    await reconcile({ reconciled: true, bankDate: '2026-09-05' });
    await reconcile({ reconciled: false });

    const mine = (await audit()).filter((a: any) => a.kind === 'PAYMENT' && a.sourceId === id).reverse();
    expect(mine.map((a: any) => a.action)).toEqual(['RECONCILED', 'REDATED', 'UNRECONCILED']);
    expect(mine[1]).toMatchObject({ previousBankDate: '2026-09-04', bankDate: '2026-09-05', transactionDate: '2026-09-02' });
    expect(mine[0].by).toBe('Recon Owner');
  });
});

describe('a bank-statement line', () => {
  it('keeps its reconciliation, and its history, on the server', async () => {
    const entry = await request(app)
      .post(`/api/orgs/${owner.orgId}/bank-book`)
      .set(auth(owner))
      .send({ ledgerAccountId: bankId, direction: 'OUT', date: '2026-09-06', amount: 1200, reference: 'NEFT-77', source: 'STATEMENT' })
      .expect(201);
    const id = entry.body.entry.id;
    await request(app).patch(`/api/orgs/${owner.orgId}/bank-book/${id}/reconcile`).set(auth(owner)).send({ reconciled: true, bankDate: '2026-09-07' }).expect(200);

    const list = await request(app).get(`/api/orgs/${owner.orgId}/bank-book?ledgerAccountId=${bankId}`).set(auth(owner)).expect(200);
    const row = (list.body.entries || []).find((e: any) => e.id === id);
    expect(row.reconciled).toBe(true);
    expect(String(row.bankDate).slice(0, 10)).toBe('2026-09-07');
    expect((await audit()).some((a: any) => a.kind === 'STATEMENT' && a.sourceId === id && a.voucherNo === 'NEFT-77')).toBe(true);
  });
});

describe('a contra', () => {
  it('can be reconciled — journals had nowhere to keep it — and the posting is untouched', async () => {
    const posted = await request(app)
      .post(`/api/orgs/${owner.orgId}/ledger/entries`)
      .set(auth(owner))
      .send({
        date: '2026-09-08',
        journalCode: 'JV',
        narration: 'Cash deposited',
        lines: [
          { ledgerAccountId: bankId, debit: 3000 },
          { ledgerAccountId: cashId, credit: 3000 },
        ],
      })
      .expect(201);
    const entryId = posted.body.entry?.id || posted.body.id;
    const before = (await request(app).get(`/api/orgs/${owner.orgId}/ledger/entries`).set(auth(owner)).expect(200)).body.entries.find((e: any) => e.id === entryId);

    const res = await request(app)
      .patch(`/api/orgs/${owner.orgId}/ledger/entries/${entryId}/reconcile`)
      .set(auth(owner))
      .send({ reconciled: true, bankDate: '2026-09-09' })
      .expect(200);
    expect(res.body.entry.reconciled).toBe(true);

    const after = (await request(app).get(`/api/orgs/${owner.orgId}/ledger/entries`).set(auth(owner)).expect(200)).body.entries.find((e: any) => e.id === entryId);
    expect(after.reconciled).toBe(true);
    expect(String(after.bankDate).slice(0, 10)).toBe('2026-09-09');
    expect(after.hash).toBe(before.hash);
    expect((await audit()).some((a: any) => a.kind === 'CONTRA' && a.sourceId === entryId)).toBe(true);
  });

  it('needs the right to change bank transactions', async () => {
    const roles = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    const viewer = roles.body.roles.find((r: any) => r.name === 'Viewer');
    const email = `v.${Date.now()}.${rnd()}@example.com`;
    const user = await request(app)
      .post('/api/users')
      .set(auth(owner))
      .send({ email, fullName: 'Viewer', password: 'Passw0rd!23', orgIds: [owner.orgId], branchIdsByOrg: { [owner.orgId]: [owner.branchId] } })
      .expect(201);
    await request(app).post(`/api/orgs/${owner.orgId}/users/${user.body.user.id}/roles`).set(auth(owner)).send({ roleId: viewer.id }).expect(201);
    const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
    const v = { ...owner, token: login.body.token };
    const any = (await request(app).get(`/api/orgs/${owner.orgId}/ledger/entries`).set(auth(owner)).expect(200)).body.entries[0];
    await request(app).patch(`/api/orgs/${owner.orgId}/ledger/entries/${any.id}/reconcile`).set(auth(v)).send({ reconciled: true }).expect(403);
  });
});
