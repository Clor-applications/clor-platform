import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';

/**
 * One listening server for the whole file, not one per request.
 *
 * supertest given an Express app binds a fresh ephemeral-port listener for
 * every single request; a run makes thousands of listen/close cycles, and
 * the suite's residual flake was a raw Node-level 400 "Bad Request" that
 * never reached Express (absent from both morgan and the anomaly log) —
 * socket churn, not application behaviour. Given an already-listening
 * server, supertest reuses it.
 */
const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `pay.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Pay owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Pay Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

/** What the endpoint answers as-is, with no accounts opened first. */
const rawModes = async (c: Ctx) => {
  const res = await request(app).get(`/api/orgs/${c.orgId}/payment-modes`).set(auth(c)).expect(200);
  return res.body.modes as Array<{ id: string; controlKind: string; name: string }>;
};

/** Opening a real cash or bank account, the way the chart of accounts does. */
const openLedger = async (c: Ctx, name: string, controlKind: 'CASH' | 'BANK') => {
  const res = await request(app)
    .post(`/api/orgs/${c.orgId}/ledger/accounts`)
    .set(auth(c))
    .send({ name, accountType: 'ASSET', controlKind })
    .expect(201);
  return res.body.account.id as string;
};

/**
 * Payment modes for an org that has opened its accounts.
 *
 * Modes list only the cash and bank accounts a business actually created, so
 * every test that pays or receives has to open one first — exactly as a real
 * org does before its first receipt.
 */
const provisioned = new Set<string>();
const modesFor = async (c: Ctx) => {
  if (!provisioned.has(c.orgId)) {
    provisioned.add(c.orgId);
    await openLedger(c, 'HDFC Current A/c', 'BANK');
    await openLedger(c, 'Petty Cash', 'CASH');
  }
  return rawModes(c);
};

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('payment modes', () => {
  it('offers nothing until the business opens a cash or bank account', async () => {
    // Setup gives every org a Cash-in-Hand and a Bank Accounts control
    // account so postings resolve. Nobody chose them, so "Received into"
    // must not offer them — an empty list is the honest answer here.
    const fresh = await makeOwner();
    expect(await rawModes(fresh)).toEqual([]);
  });

  it('offers the real cash and bank ledgers, not a hardcoded list', async () => {
    const modes = await modesFor(owner);
    const kinds = modes.map((m) => m.controlKind).sort();
    expect(kinds).toEqual(['BANK', 'CASH']);
    // Every mode is an actual ledger account, so a receipt knows where the
    // money landed.
    for (const m of modes) expect(m.id).toBeTruthy();
    // The setup control accounts are not among them.
    expect(modes.map((m) => m.name)).not.toContain('Cash-in-Hand');
    expect(modes.map((m) => m.name)).not.toContain('Bank Accounts');
  });
});

describe('receipts and payments', () => {
  it('posts a receipt as bank debit and receivable credit', async () => {
    const org = await makeOwner();
    const modes = await modesFor(org);
    const bank = modes.find((m) => m.controlKind === 'BANK')!;

    const res = await request(app)
      .post(`/api/orgs/${org.orgId}/payments`)
      .set(auth(org))
      .send({
        direction: 'RECEIPT',
        date: '2026-08-17',
        partyType: 'CUSTOMER',
        partyName: 'Acme',
        ledgerAccountId: bank.id,
        amount: 5000,
        instrumentRef: 'NEFT-9931',
      })
      .expect(201);

    expect(res.body.payment.number).toMatch(/^RCP-\d{4}-\d{5}$/);

    const tb = await request(app).get(`/api/orgs/${org.orgId}/ledger/trial-balance`).set(auth(org)).expect(200);
    const row = (kind: string) => tb.body.rows.find((r: any) => r.controlKind === kind) || { debit: 0, credit: 0 };

    expect(row('BANK').debit).toBeCloseTo(5000, 2);
    expect(row('AR').credit).toBeCloseTo(5000, 2);
    expect(tb.body.totals.balanced).toBe(true);
  });

  it('splits a receipt across the bank, TDS and charges, crediting the customer with the whole settlement', async () => {
    const org = await makeOwner();
    const modes = await modesFor(org);
    const bank = modes.find((m) => m.controlKind === 'BANK')!;

    // An invoice of 10,000 settled by 8,950 in the bank, 1,000 withheld as TDS
    // and 50 taken by the bank. The customer is discharged of the full 10,000.
    await request(app)
      .post(`/api/orgs/${org.orgId}/payments`)
      .set(auth(org))
      .send({
        direction: 'RECEIPT',
        date: '2026-08-17',
        partyType: 'CUSTOMER',
        partyName: 'Acme',
        ledgerAccountId: bank.id,
        amount: 8950,
        deductions: [
          { kind: 'TDS', amount: 1000 },
          { kind: 'BANK_CHARGES', amount: 50 },
        ],
      })
      .expect(201);

    const tb = await request(app).get(`/api/orgs/${org.orgId}/ledger/trial-balance`).set(auth(org)).expect(200);
    const row = (kind: string) => tb.body.rows.find((r: any) => r.controlKind === kind) || { debit: 0, credit: 0 };

    // Only the cash reaches the bank — the whole point of the split.
    expect(row('BANK').debit).toBeCloseTo(8950, 2);
    expect(row('TDS_RECEIVABLE').debit).toBeCloseTo(1000, 2);
    expect(row('BANK_CHARGES').debit).toBeCloseTo(50, 2);
    expect(row('AR').credit).toBeCloseTo(10000, 2);
    expect(tb.body.totals.balanced).toBe(true);
  });

  it('measures allocations against the settlement, not just the cash', async () => {
    const org = await makeOwner();
    const modes = await modesFor(org);
    const bank = modes.find((m) => m.controlKind === 'BANK')!;

    // 900 in the bank plus 100 of TDS settles 1,000 — so allocating 1,000 is
    // within the payment, and allocating 1,001 is not.
    const over = await request(app)
      .post(`/api/orgs/${org.orgId}/payments`)
      .set(auth(org))
      .send({
        direction: 'RECEIPT',
        date: '2026-08-17',
        partyType: 'CUSTOMER',
        partyName: 'Acme',
        ledgerAccountId: bank.id,
        amount: 900,
        deductions: [{ kind: 'TDS', amount: 100 }],
        allocations: [{ docType: 'INVOICE', docId: 'missing-doc', amount: 1001 }],
      });
    expect(over.status).toBe(400);
    expect(String(over.body.error)).toMatch(/more than the payment/i);
  });

  it('posts a payment as payable debit and cash credit', async () => {
    const org = await makeOwner();
    const modes = await modesFor(org);
    const cash = modes.find((m) => m.controlKind === 'CASH')!;

    await request(app)
      .post(`/api/orgs/${org.orgId}/payments`)
      .set(auth(org))
      .send({
        direction: 'PAYMENT',
        date: '2026-08-17',
        partyType: 'VENDOR',
        partyName: 'Supplier',
        ledgerAccountId: cash.id,
        amount: 1200,
      })
      .expect(201);

    const tb = await request(app).get(`/api/orgs/${org.orgId}/ledger/trial-balance`).set(auth(org)).expect(200);
    const row = (kind: string) => tb.body.rows.find((r: any) => r.controlKind === kind) || { debit: 0, credit: 0 };

    expect(row('AP').debit).toBeCloseTo(1200, 2);
    expect(row('CASH').credit).toBeCloseTo(1200, 2);
    expect(tb.body.totals.balanced).toBe(true);
  });

  it('refuses a mode that is not a cash or bank ledger', async () => {
    const org = await makeOwner();
    const accounts = await request(app).get(`/api/orgs/${org.orgId}/ledger/accounts`).set(auth(org)).expect(200);
    const sales = accounts.body.accounts.find((a: any) => a.controlKind === 'SALES');

    const res = await request(app)
      .post(`/api/orgs/${org.orgId}/payments`)
      .set(auth(org))
      .send({ direction: 'RECEIPT', date: '2026-08-17', ledgerAccountId: sales.id, amount: 100 })
      .expect(400);
    expect(String(res.body.error)).toMatch(/cash or bank/i);
  });

  it('refuses allocating more than the payment', async () => {
    const org = await makeOwner();
    const modes = await modesFor(org);

    const res = await request(app)
      .post(`/api/orgs/${org.orgId}/payments`)
      .set(auth(org))
      .send({
        direction: 'RECEIPT',
        date: '2026-08-17',
        ledgerAccountId: modes[0].id,
        amount: 500,
        allocations: [{ docType: 'INVOICE', docId: 'inv-1', amount: 900 }],
      })
      .expect(400);
    expect(String(res.body.error)).toMatch(/more than the payment/i);
  });

  it('records allocations against the documents settled', async () => {
    const org = await makeOwner();
    const modes = await modesFor(org);

    const invoice = await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set(auth(org))
      .send({ date: '2026-08-17', customerName: 'Acme', subtotal: 1000, total: 1000, items: [] })
      .expect(201);

    const res = await request(app)
      .post(`/api/orgs/${org.orgId}/payments`)
      .set(auth(org))
      .send({
        direction: 'RECEIPT',
        date: '2026-08-18',
        ledgerAccountId: modes[0].id,
        amount: 600,
        allocations: [{ docType: 'INVOICE', docId: invoice.body.invoice.id, amount: 600 }],
      })
      .expect(201);

    expect(res.body.payment.allocations).toHaveLength(1);
    expect(res.body.payment.allocations[0].amount).toBe(600);
  });

  it('reverses rather than deletes, leaving the ledger balanced', async () => {
    const org = await makeOwner();
    const modes = await modesFor(org);

    const created = await request(app)
      .post(`/api/orgs/${org.orgId}/payments`)
      .set(auth(org))
      .send({ direction: 'RECEIPT', date: '2026-08-17', ledgerAccountId: modes[0].id, amount: 800 })
      .expect(201);

    const res = await request(app)
      .post(`/api/orgs/${org.orgId}/payments/${created.body.payment.id}/reverse`)
      .set(auth(org))
      .expect(200);

    expect(res.body.reversedEntries).toBe(1);
    expect(res.body.payment.status).toBe('REVERSED');

    const entries = await prisma.journalEntry.findMany({
      where: { orgId: org.orgId, sourceDocType: 'RECEIPT', sourceDocId: created.body.payment.id },
    });
    expect(entries).toHaveLength(2);

    const tb = await request(app).get(`/api/orgs/${org.orgId}/ledger/trial-balance`).set(auth(org)).expect(200);
    expect(tb.body.totals.balanced).toBe(true);
  });
});

describe('reconciliation', () => {
  it('is refused while the feature is off, and works once it is on', async () => {
    const org = await makeOwner();
    const modes = await modesFor(org);

    const created = await request(app)
      .post(`/api/orgs/${org.orgId}/payments`)
      .set(auth(org))
      .send({ direction: 'RECEIPT', date: '2026-08-17', ledgerAccountId: modes[0].id, amount: 300 })
      .expect(201);

    const off = await request(app)
      .patch(`/api/orgs/${org.orgId}/payments/${created.body.payment.id}/reconcile`)
      .set(auth(org))
      .send({ reconciled: true })
      .expect(400);
    expect(String(off.body.error)).toMatch(/switched off/i);

    await request(app)
      .put(`/api/orgs/${org.orgId}/features`)
      .set(auth(org))
      .send({ features: { bankReconciliation: true } })
      .expect(200);

    const on = await request(app)
      .patch(`/api/orgs/${org.orgId}/payments/${created.body.payment.id}/reconcile`)
      .set(auth(org))
      .send({ reconciled: true, statementRef: 'STMT-42' })
      .expect(200);

    expect(on.body.payment.reconciled).toBe(true);
    expect(on.body.payment.bankDate).toBeTruthy();

    // Entry is unaffected either way: the voucher is still the single record.
    const list = await request(app)
      .get(`/api/orgs/${org.orgId}/payments?direction=RECEIPT&unreconciled=true`)
      .set(auth(org))
      .expect(200);
    expect(list.body.payments.some((p: any) => p.id === created.body.payment.id)).toBe(false);
  });
});
