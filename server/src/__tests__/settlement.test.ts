import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { deriveSettlementStatus, recalcDocumentSettlement } from '../services/settlement.js';

/**
 * Settlement authority: allocations decide what a document has been paid.
 *
 * The defect these hold down had three answers to one question. An invoice of
 * 118,000 with a 50,000 receipt against it reported 118,000 outstanding
 * wherever `total - paidAmount` was read, 68,000 wherever the allocations were
 * read, and the ledger — the only audited one — agreed with neither screen.
 * `Invoice.paidAmount` was written by the browser and by nothing else; the
 * payment routes never touched it.
 *
 * So these assert the database, not a response body: a route that returned the
 * right number while storing the wrong one is exactly the failure being fixed.
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
  const email = `settle.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Settlement owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Settle Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

let bankAccountId = '';
const bankId = async () => {
  if (bankAccountId) return bankAccountId;
  const created = await request(app)
    .post(`/api/orgs/${owner.orgId}/ledger/accounts`)
    .set(auth(owner))
    .send({ name: 'HDFC Current A/c', accountType: 'ASSET', controlKind: 'BANK' })
    .expect(201);
  bankAccountId = created.body.account.id as string;
  return bankAccountId;
};

/** An intra-state invoice: taxable + 18% split into CGST and SGST. */
const makeInvoice = async (taxable: number, date = '2026-06-10') => {
  const gst = Math.round(taxable * 0.18 * 100) / 100;
  const half = Math.round((gst / 2) * 100) / 100;
  const res = await request(app)
    .post(`/api/orgs/${owner.orgId}/invoices`)
    .set(auth(owner))
    .send({
      date,
      customerName: 'Bengaluru Industrial Supplies',
      placeOfSupplyState: 'Karnataka',
      subtotal: taxable,
      cgstTotal: half,
      sgstTotal: half,
      gstTotal: gst,
      total: Math.round((taxable + gst) * 100) / 100,
      status: 'Unpaid',
      items: [{ description: 'Widget', quantity: 1, rate: taxable, gstRate: 18 }],
    })
    .expect(201);
  return res.body.invoice;
};

const receipt = async (amount: number, allocations: Array<{ docId: string; amount: number }>, number?: string) => {
  const res = await request(app)
    .post(`/api/orgs/${owner.orgId}/payments`)
    .set(auth(owner))
    .send({
      direction: 'RECEIPT',
      number: number || `RCPT-${rnd()}`,
      date: '2026-06-15',
      partyType: 'CUSTOMER',
      partyName: 'Bengaluru Industrial Supplies',
      ledgerAccountId: await bankId(),
      amount,
      allocations: allocations.map((a) => ({ docType: 'INVOICE', docId: a.docId, amount: a.amount })),
    });
  return res;
};

/** Straight from the database — the response body is not the thing under test. */
const stored = async (invoiceId: string) => {
  const row = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  const total = Number(row!.total);
  const paid = Number(row!.paidAmount);
  return { total, paid, outstanding: Math.round((total - paid) * 100) / 100, status: row!.status };
};

/** Every journal entry in the org foots to zero. */
const ledgerBalances = async () => {
  const entries = await prisma.journalEntry.findMany({
    where: { orgId: owner.orgId },
    include: { lines: true },
  });
  return entries.every((e) => {
    const d = e.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0);
    const c = e.lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
    return d === c;
  });
};

beforeAll(async () => {
  owner = await makeOwner();
  await bankId();
});

describe('the canonical receivable', () => {
  it('settles, over-settles to Paid, and unwinds exactly as the receipts are reversed', async () => {
    const invoice = await makeInvoice(100000);
    expect(await stored(invoice.id)).toMatchObject({ total: 118000, paid: 0, outstanding: 118000, status: 'Unpaid' });

    const r1 = await receipt(50000, [{ docId: invoice.id, amount: 50000 }]);
    expect(r1.status).toBe(201);
    expect(await stored(invoice.id)).toMatchObject({ paid: 50000, outstanding: 68000, status: 'Partially Paid' });

    const r2 = await receipt(68000, [{ docId: invoice.id, amount: 68000 }]);
    expect(r2.status).toBe(201);
    expect(await stored(invoice.id)).toMatchObject({ paid: 118000, outstanding: 0, status: 'Paid' });

    // Reversing the first receipt must reopen the invoice by exactly its
    // amount — not close it, and not zero it.
    await request(app)
      .post(`/api/orgs/${owner.orgId}/payments/${r1.body.payment.id}/reverse`)
      .set(auth(owner))
      .expect(200);
    expect(await stored(invoice.id)).toMatchObject({ paid: 68000, outstanding: 50000, status: 'Partially Paid' });

    await request(app)
      .post(`/api/orgs/${owner.orgId}/payments/${r2.body.payment.id}/reverse`)
      .set(auth(owner))
      .expect(200);
    expect(await stored(invoice.id)).toMatchObject({ paid: 0, outstanding: 118000, status: 'Unpaid' });

    expect(await ledgerBalances()).toBe(true);
  });
});

describe('what the allocation counts', () => {
  it('counts the allocation, never the receipt — money left on account settles nothing', async () => {
    const invoice = await makeInvoice(100000);
    // 70,000 received, 50,000 of it put against this invoice.
    const res = await receipt(70000, [{ docId: invoice.id, amount: 50000 }]);
    expect(res.status).toBe(201);
    const after = await stored(invoice.id);
    expect(after.paid).toBe(50000);
    expect(after.outstanding).toBe(68000);
    expect(after.status).toBe('Partially Paid');
  });

  it('settles several invoices independently from one receipt', async () => {
    const a = await makeInvoice(100000); // 118,000
    const b = await makeInvoice(50000); //  59,000
    const res = await receipt(60000, [
      { docId: a.id, amount: 30000 },
      { docId: b.id, amount: 20000 },
    ]);
    expect(res.status).toBe(201);
    expect(await stored(a.id)).toMatchObject({ paid: 30000, outstanding: 88000, status: 'Partially Paid' });
    expect(await stored(b.id)).toMatchObject({ paid: 20000, outstanding: 39000, status: 'Partially Paid' });
    expect(await ledgerBalances()).toBe(true);
  });

  it('refuses to allocate more to an invoice than it still owes', async () => {
    const invoice = await makeInvoice(100000);
    await receipt(100000, [{ docId: invoice.id, amount: 100000 }]);
    const over = await receipt(50000, [{ docId: invoice.id, amount: 50000 }]);
    expect(over.status).toBe(400);
    expect(String(over.body.error)).toMatch(/outstanding/i);
    // The refused receipt changed nothing.
    expect(await stored(invoice.id)).toMatchObject({ paid: 100000, outstanding: 18000, status: 'Partially Paid' });
  });

  it('never drives outstanding below zero', async () => {
    const invoice = await makeInvoice(100000);
    await receipt(118000, [{ docId: invoice.id, amount: 118000 }]);
    const s = await stored(invoice.id);
    expect(s.outstanding).toBe(0);
    expect(s.outstanding).toBeGreaterThanOrEqual(0);
    expect(s.status).toBe('Paid');
  });
});

describe('recalculation', () => {
  it('is idempotent — running it again changes nothing', async () => {
    const invoice = await makeInvoice(100000);
    await receipt(50000, [{ docId: invoice.id, amount: 50000 }]);
    const before = await stored(invoice.id);

    const first = await recalcDocumentSettlement(prisma, {
      accountId: (await prisma.invoice.findUnique({ where: { id: invoice.id } }))!.accountId,
      orgId: owner.orgId,
      docType: 'INVOICE',
      docId: invoice.id,
    });
    expect(first!.changed).toBe(false);

    const second = await recalcDocumentSettlement(prisma, {
      accountId: (await prisma.invoice.findUnique({ where: { id: invoice.id } }))!.accountId,
      orgId: owner.orgId,
      docType: 'INVOICE',
      docId: invoice.id,
    });
    expect(second!.changed).toBe(false);
    expect(await stored(invoice.id)).toEqual(before);
  });

  it('derives from persisted allocations, so repeated receipts cannot lose each other', async () => {
    const invoice = await makeInvoice(100000);
    // Sequential rather than truly concurrent — SQLite serialises writers — but
    // the point holds either way: each receipt's settlement is computed from
    // every allocation that exists, not from the previous paidAmount.
    await receipt(20000, [{ docId: invoice.id, amount: 20000 }]);
    await receipt(30000, [{ docId: invoice.id, amount: 30000 }]);
    await receipt(10000, [{ docId: invoice.id, amount: 10000 }]);
    expect(await stored(invoice.id)).toMatchObject({ paid: 60000, outstanding: 58000, status: 'Partially Paid' });
  });
});

describe('status derivation', () => {
  it('maps outstanding onto the settlement scale', () => {
    expect(deriveSettlementStatus({ totalPaise: 11800000, paidPaise: 0, current: 'Unpaid' })).toBe('Unpaid');
    expect(deriveSettlementStatus({ totalPaise: 11800000, paidPaise: 5000000, current: 'Unpaid' })).toBe('Partially Paid');
    expect(deriveSettlementStatus({ totalPaise: 11800000, paidPaise: 11800000, current: 'Partially Paid' })).toBe('Paid');
  });

  it('leaves a document alone when its status describes its life, not its money', () => {
    for (const s of ['Draft', 'Cancelled', 'Pending Approval', 'Rejected']) {
      expect(deriveSettlementStatus({ totalPaise: 11800000, paidPaise: 11800000, current: s })).toBe(s);
    }
  });

  it('keeps Overdue while nothing is paid, and moves it on once something is', () => {
    expect(deriveSettlementStatus({ totalPaise: 11800000, paidPaise: 0, current: 'Overdue' })).toBe('Overdue');
    expect(deriveSettlementStatus({ totalPaise: 11800000, paidPaise: 100, current: 'Overdue' })).toBe('Partially Paid');
  });

  it('does not invent a status for a document with nothing to settle', () => {
    expect(deriveSettlementStatus({ totalPaise: 0, paidPaise: 0, current: 'Unpaid' })).toBe('Unpaid');
  });
});

describe('vendor bills', () => {
  /* Bills carry `settledAmount` rather than `paidAmount`, and nothing wrote it
     either — the same defect through the same allocation table, so the same
     service settles both. */
  const makeBill = async (taxable: number) => {
    const gst = Math.round(taxable * 0.18 * 100) / 100;
    const half = Math.round((gst / 2) * 100) / 100;
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/bills`)
      .set(auth(owner))
      .send({
        date: '2026-06-10',
        partyName: 'Karnataka Industrial Supplies',
        subtotal: taxable,
        cgstTotal: half,
        sgstTotal: half,
        gstTotal: gst,
        total: Math.round((taxable + gst) * 100) / 100,
        status: 'Unpaid',
        items: [{ description: 'Raw material', quantity: 1, rate: taxable, gstRate: 18 }],
      });
    return res;
  };

  const storedBill = async (billId: string) => {
    const row = await prisma.bill.findUnique({ where: { id: billId } });
    const total = Number(row!.total);
    const settled = Number(row!.settledAmount);
    return { total, settled, outstanding: Math.round((total - settled) * 100) / 100, status: row!.status };
  };

  it('settles from allocations and unwinds on reversal, like an invoice', async () => {
    const created = await makeBill(100000);
    expect(created.status).toBe(201);
    const bill = created.body.bill || created.body.doc || created.body.document;
    expect(bill?.id).toBeTruthy();
    expect(await storedBill(bill.id)).toMatchObject({ total: 118000, settled: 0, outstanding: 118000 });

    const pay = await request(app)
      .post(`/api/orgs/${owner.orgId}/payments`)
      .set(auth(owner))
      .send({
        direction: 'PAYMENT',
        number: `PAY-${rnd()}`,
        date: '2026-06-15',
        partyType: 'VENDOR',
        partyName: 'Karnataka Industrial Supplies',
        ledgerAccountId: await bankId(),
        amount: 50000,
        allocations: [{ docType: 'BILL', docId: bill.id, amount: 50000 }],
      });
    expect(pay.status).toBe(201);
    expect(await storedBill(bill.id)).toMatchObject({ settled: 50000, outstanding: 68000, status: 'Partially Paid' });

    await request(app)
      .post(`/api/orgs/${owner.orgId}/payments/${pay.body.payment.id}/reverse`)
      .set(auth(owner))
      .expect(200);
    expect(await storedBill(bill.id)).toMatchObject({ settled: 0, outstanding: 118000, status: 'Unpaid' });
    expect(await ledgerBalances()).toBe(true);
  });
});

describe('a cancelled invoice', () => {
  it('keeps its status but still reports its allocations honestly', async () => {
    const invoice = await makeInvoice(100000);
    await receipt(50000, [{ docId: invoice.id, amount: 50000 }]);
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/status`)
      .set(auth(owner))
      .send({ status: 'Cancelled' })
      .expect(200);
    const after = await stored(invoice.id);
    expect(after.status).toBe('Cancelled');
    expect(after.paid).toBe(50000);
  });
});
