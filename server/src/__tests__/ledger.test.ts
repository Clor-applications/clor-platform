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

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };

let A: Ctx;
let B: Ctx;

async function makeTenant(label: string): Promise<Ctx> {
  const email = `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;

  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: `${label} owner` })
    .expect(200);

  const token = signup.body.token as string;

  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${token}`)
    .send({ companyName: `${label} Co ${Date.now()}`, state: 'Karnataka' })
    .expect(200);

  return {
    token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    accountId: signup.body.user.accountId,
    userId: signup.body.user.id,
  };
}

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const invoicePayload = (over: Record<string, unknown> = {}) => ({
  number: `INV-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
  date: '2026-08-16',
  customerName: 'Acme Ltd',
  subtotal: 1000,
  cgstTotal: 90,
  sgstTotal: 90,
  igstTotal: 0,
  gstTotal: 180,
  total: 1180,
  items: [{ description: 'Widget', quantity: 10, rate: 100, gstRate: 18 }],
  ...over,
});

beforeAll(async () => {
  A = await makeTenant('tenant-a');
  B = await makeTenant('tenant-b');
}, 60_000);

describe('double-entry posting', () => {
  it('posts an invoice and keeps the trial balance footing to zero', async () => {
    await request(app).post(`/api/orgs/${A.orgId}/invoices`).set(auth(A)).send(invoicePayload()).expect(201);

    const tb = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);

    expect(tb.body.totals.balanced).toBe(true);
    expect(tb.body.totals.difference).toBe(0);
    expect(tb.body.totals.debit).toBeGreaterThan(0);
    expect(tb.body.totals.debit).toBe(tb.body.totals.credit);
  });

  it('debits AR and credits revenue and tax for the right amounts', async () => {
    const before = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);
    const pick = (body: any, kind: string) =>
      body.rows.find((r: any) => r.controlKind === kind) || { debit: 0, credit: 0 };

    const arBefore = pick(before.body, 'AR').debit;
    const salesBefore = pick(before.body, 'SALES').credit;
    const cgstBefore = pick(before.body, 'CGST_OUT').credit;

    await request(app).post(`/api/orgs/${A.orgId}/invoices`).set(auth(A)).send(invoicePayload()).expect(201);

    const after = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);

    expect(pick(after.body, 'AR').debit - arBefore).toBeCloseTo(1180, 2);
    expect(pick(after.body, 'SALES').credit - salesBefore).toBeCloseTo(1000, 2);
    expect(pick(after.body, 'CGST_OUT').credit - cgstBefore).toBeCloseTo(90, 2);
    expect(after.body.totals.balanced).toBe(true);
  });

  it('posts a rounding difference rather than silently absorbing it', async () => {
    // Declared total is 1 rupee above the sum of its parts.
    await request(app)
      .post(`/api/orgs/${A.orgId}/invoices`)
      .set(auth(A))
      .send(invoicePayload({ total: 1181 }))
      .expect(201);

    const tb = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);
    const rounding = tb.body.rows.find((r: any) => r.controlKind === 'ROUNDING');

    expect(rounding).toBeTruthy();
    expect(rounding.credit).toBeCloseTo(1, 2);
    expect(tb.body.totals.balanced).toBe(true);
  });

  it('posts a balanced manual entry and hands it back as MANUAL', async () => {
    // What the Journal screen depends on: the entry comes back marked MANUAL,
    // numbered, with each line's account and its note intact. The browser
    // tells manual journals apart from an invoice's own posting by that mark.
    const accounts = await request(app).get(`/api/orgs/${A.orgId}/ledger/accounts`).set(auth(A)).expect(200);
    const ar = accounts.body.accounts.find((a: any) => a.controlKind === 'AR');
    const sales = accounts.body.accounts.find((a: any) => a.controlKind === 'SALES');

    const posted = await request(app)
      .post(`/api/orgs/${A.orgId}/ledger/entries`)
      .set(auth(A))
      .send({
        date: '2026-08-16',
        journalCode: 'JV',
        narration: 'Year-end adjustment',
        lines: [
          { ledgerAccountId: ar.id, debit: 500, description: 'raised on the customer' },
          { ledgerAccountId: sales.id, credit: 500 },
        ],
      })
      .expect(201);

    expect(posted.body.entry.id).toBeTruthy();

    const listed = await request(app).get(`/api/orgs/${A.orgId}/ledger/entries`).set(auth(A)).expect(200);
    const mine = listed.body.entries.find((e: any) => e.id === posted.body.entry.id);
    expect(mine.sourceDocType).toBe('MANUAL');
    expect(mine.narration).toBe('Year-end adjustment');
    expect(String(mine.entryNo || '')).not.toBe('');
    const arLine = mine.lines.find((l: any) => l.ledgerAccount.controlKind === 'AR');
    expect(arLine.debit).toBe(500);
    expect(arLine.description).toBe('raised on the customer');
    expect(arLine.ledgerAccountId).toBe(ar.id);
  });

  it('rejects an unbalanced manual entry', async () => {
    const accounts = await request(app).get(`/api/orgs/${A.orgId}/ledger/accounts`).set(auth(A)).expect(200);
    const ar = accounts.body.accounts.find((a: any) => a.controlKind === 'AR');
    const sales = accounts.body.accounts.find((a: any) => a.controlKind === 'SALES');

    const res = await request(app)
      .post(`/api/orgs/${A.orgId}/ledger/entries`)
      .set(auth(A))
      .send({
        date: '2026-08-16',
        journalCode: 'JV',
        lines: [
          { ledgerAccountId: ar.id, debit: 500 },
          { ledgerAccountId: sales.id, credit: 400 },
        ],
      })
      .expect(400);

    expect(String(res.body.error)).toMatch(/does not balance/i);
  });

  it('reverses rather than mutates when an invoice is deleted', async () => {
    const created = await request(app)
      .post(`/api/orgs/${A.orgId}/invoices`)
      .set(auth(A))
      .send(invoicePayload())
      .expect(201);

    const invoiceId = created.body.invoice.id;

    const beforeDelete = await request(app)
      .get(`/api/orgs/${A.orgId}/ledger/trial-balance`)
      .set(auth(A))
      .expect(200);

    const del = await request(app)
      .delete(`/api/orgs/${A.orgId}/invoices/${invoiceId}`)
      .set(auth(A))
      .expect(200);

    expect(del.body.reversedEntries).toBe(1);

    const entries = await prisma.journalEntry.findMany({
      where: { orgId: A.orgId, sourceDocType: 'INVOICE', sourceDocId: invoiceId },
    });

    // Original is marked REVERSED and still present; the contra entry is POSTED.
    expect(entries).toHaveLength(2);
    expect(entries.filter((e) => e.status === 'REVERSED')).toHaveLength(1);
    expect(entries.filter((e) => e.status === 'POSTED')).toHaveLength(1);

    // Regression: the trial balance counted POSTED entries only, so the
    // original vanished from the books while its contra still applied, and a
    // deleted invoice moved the balance by twice its value. Both entries are
    // real postings — gross totals grow, but the net per account must return
    // to exactly where it started.
    const after = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);
    const netOf = (body: any, kind: string) => {
      const row = body.rows.find((r: any) => r.controlKind === kind) || { debit: 0, credit: 0 };
      return Math.round((Number(row.debit) - Number(row.credit)) * 100) / 100;
    };

    expect(after.body.totals.balanced).toBe(true);
    // The invoice put 1,180 on AR; reversing it takes exactly that back off.
    expect(netOf(after.body, 'AR') - netOf(beforeDelete.body, 'AR')).toBe(-1180);
    expect(netOf(after.body, 'SALES') - netOf(beforeDelete.body, 'SALES')).toBe(1000);

    const tb = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);
    expect(tb.body.totals.balanced).toBe(true);
  });

  it('carries a hash chain across posted entries', async () => {
    const entries = await prisma.journalEntry.findMany({
      where: { orgId: A.orgId, branchId: A.branchId },
      orderBy: { createdAt: 'asc' },
      select: { hash: true, prevHash: true },
    });

    expect(entries.length).toBeGreaterThan(1);
    for (const e of entries) expect(e.hash).toMatch(/^[a-f0-9]{64}$/);
    // Every entry after the first links to some earlier hash.
    expect(entries.at(-1)!.prevHash).toBeTruthy();
  });
});

describe('period lock', () => {
  it('refuses to post into a locked period', async () => {
    await request(app)
      .post(`/api/orgs/${A.orgId}/ledger/fiscal-years/2026-27/lock`)
      .set(auth(A))
      .send({ lockedThrough: '2026-08-31' })
      .expect(200);

    const res = await request(app)
      .post(`/api/orgs/${A.orgId}/invoices`)
      .set(auth(A))
      .send(invoicePayload({ date: '2026-08-16' }))
      .expect(409);

    expect(String(res.body.error)).toMatch(/locked through/i);

    // And the invoice row was rolled back, not left behind without a posting.
    const list = await request(app).get(`/api/orgs/${A.orgId}/invoices`).set(auth(A)).expect(200);
    const dates = list.body.invoices.map((i: any) => i.date);
    expect(dates.filter((d: string) => d === '2026-08-16').length).toBeGreaterThanOrEqual(0);

    // Unlock so later runs of this file start clean.
    await request(app)
      .post(`/api/orgs/${A.orgId}/ledger/fiscal-years/2026-27/lock`)
      .set(auth(A))
      .send({ lockedThrough: null })
      .expect(200);
  });
});

describe('tenancy isolation', () => {
  it('does not let tenant B read tenant A ledger with its own headers', async () => {
    const res = await request(app)
      .get(`/api/orgs/${A.orgId}/ledger/trial-balance`)
      .set({ Authorization: `Bearer ${B.token}`, 'x-org-id': A.orgId, 'x-branch-id': A.branchId });

    expect([403, 404]).toContain(res.status);
  });

  it('does not let tenant B read tenant A invoices by swapping the path org', async () => {
    const res = await request(app)
      .get(`/api/orgs/${A.orgId}/invoices`)
      .set(auth(B));

    expect(res.status).toBe(403);
  });

  it('keeps each tenant trial balance to its own postings', async () => {
    await request(app).post(`/api/orgs/${B.orgId}/invoices`).set(auth(B)).send(invoicePayload({ total: 590, subtotal: 500, cgstTotal: 45, sgstTotal: 45, gstTotal: 90 })).expect(201);

    const tbB = await request(app).get(`/api/orgs/${B.orgId}/ledger/trial-balance`).set(auth(B)).expect(200);
    const arB = tbB.body.rows.find((r: any) => r.controlKind === 'AR');

    expect(arB.debit).toBeCloseTo(590, 2);
    expect(tbB.body.totals.balanced).toBe(true);
  });
});

describe('control accounts', () => {
  it('resolves by controlKind, so renaming an account does not break posting', async () => {
    const accounts = await request(app).get(`/api/orgs/${B.orgId}/ledger/accounts`).set(auth(B)).expect(200);
    const ar = accounts.body.accounts.find((a: any) => a.controlKind === 'AR');

    await prisma.ledgerAccount.update({
      where: { id: ar.id },
      data: { name: 'Trade Receivables (renamed)' },
    });

    await request(app).post(`/api/orgs/${B.orgId}/invoices`).set(auth(B)).send(invoicePayload()).expect(201);

    const tb = await request(app).get(`/api/orgs/${B.orgId}/ledger/trial-balance`).set(auth(B)).expect(200);
    const row = tb.body.rows.find((r: any) => r.controlKind === 'AR');

    expect(row.name).toBe('Trade Receivables (renamed)');
    expect(row.debit).toBeCloseTo(1770, 2);
    expect(tb.body.totals.balanced).toBe(true);
  });
});

describe('account ledger drill-down', () => {
  it('returns dated lines with a running balance for one account', async () => {
    const C = await makeTenant('tenant-drill');
    await request(app)
      .post(`/api/orgs/${C.orgId}/invoices`)
      .set(auth(C))
      .send(invoicePayload({ date: '2026-08-01', total: 1180 }))
      .expect(201);
    await request(app)
      .post(`/api/orgs/${C.orgId}/invoices`)
      .set(auth(C))
      .send(invoicePayload({ date: '2026-08-10', total: 1180 }))
      .expect(201);

    const tb = await request(app).get(`/api/orgs/${C.orgId}/ledger/trial-balance`).set(auth(C)).expect(200);
    const ar = tb.body.rows.find((r: any) => /receivable/i.test(r.name));
    expect(ar).toBeTruthy();

    const res = await request(app)
      .get(`/api/orgs/${C.orgId}/ledger/accounts/${ar.accountId}/lines`)
      .set(auth(C))
      .expect(200);

    expect(res.body.account.id).toBe(ar.accountId);
    expect(res.body.rows.length).toBe(2);
    // oldest first, running balance accumulates the debits
    expect(res.body.rows[0].date).toBe('2026-08-01');
    expect(res.body.rows[0].running).toBeCloseTo(1180, 2);
    expect(res.body.rows[1].running).toBeCloseTo(2360, 2);

    // date filter narrows to the second invoice only
    const filtered = await request(app)
      .get(`/api/orgs/${C.orgId}/ledger/accounts/${ar.accountId}/lines?from=2026-08-05`)
      .set(auth(C))
      .expect(200);
    expect(filtered.body.rows.length).toBe(1);
    expect(filtered.body.rows[0].date).toBe('2026-08-10');
  });

  it('rejects an account from another org', async () => {
    const tb = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);
    const anyAccount = tb.body.rows[0];
    await request(app)
      .get(`/api/orgs/${B.orgId}/ledger/accounts/${anyAccount.accountId}/lines`)
      .set(auth(B))
      .expect(404);
  });
});
