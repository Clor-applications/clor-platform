import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { livePostingsFor } from '../services/postingState.js';

/**
 * A posted invoice's accounting values are immutable.
 *
 * The defect: an invoice posted at 118,000 and PATCHed to 40,000 left the
 * document at 40,000 and the ledger at 118,000. The edit route never posted
 * anything, so the books simply kept the first answer and nothing anywhere
 * recorded that the two disagreed.
 *
 * These assert the database on both sides of every refusal — the document, the
 * journal, and the settlement — because a route that returns 409 while having
 * already written something is the same defect wearing a different status
 * code.
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
  const email = `pim.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Mutation owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `PIM Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
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

/** A posted intra-state invoice: 100,000 + 18% = 118,000. */
const makeInvoice = async (over: Record<string, any> = {}) => {
  const res = await request(app)
    .post(`/api/orgs/${owner.orgId}/invoices`)
    .set(auth(owner))
    .send({
      date: '2026-06-10',
      customerName: 'Bengaluru Industrial Supplies',
      placeOfSupplyState: 'Karnataka',
      subtotal: 100000,
      cgstTotal: 9000,
      sgstTotal: 9000,
      gstTotal: 18000,
      total: 118000,
      status: 'Unpaid',
      refNo: 'PO-ORIGINAL',
      items: [{ itemId: 'i1', description: 'Widget', quantity: 1, rate: 100000, gstRate: 18, amount: 100000 }],
      ...over,
    })
    .expect(201);
  return res.body.invoice;
};

const patch = (id: string, body: Record<string, any>) =>
  request(app).patch(`/api/orgs/${owner.orgId}/invoices/${id}`).set(auth(owner)).send(body);

const row = async (id: string) => (await prisma.invoice.findUnique({ where: { id } }))!;

const journal = async (id: string) => {
  const accountId = (await row(id)).accountId;
  const all = await prisma.journalEntry.findMany({
    where: { orgId: owner.orgId, sourceDocType: 'INVOICE', sourceDocId: id },
    include: { lines: true },
  });
  const live = await livePostingsFor(prisma, { accountId, orgId: owner.orgId, sourceDocType: 'INVOICE', sourceDocId: id });
  const debits = all
    .filter((e) => live.some((l) => l.id === e.id))
    .reduce((s, e) => s + e.lines.reduce((t, l) => t + Number(l.debit), 0), 0);
  return { entries: all.length, live: live.length, liveDebits: debits };
};

/** Every entry in the org foots to zero. */
const ledgerBalanced = async () => {
  const entries = await prisma.journalEntry.findMany({ where: { orgId: owner.orgId }, include: { lines: true } });
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

describe('A — a posted invoice cannot have its amounts edited', () => {
  it('refuses the 118,000 to 40,000 edit and leaves both the document and the ledger alone', async () => {
    const invoice = await makeInvoice();
    const before = await journal(invoice.id);
    expect(before.live).toBe(1);
    expect(before.liveDebits).toBe(118000);

    const res = await patch(invoice.id, { total: 40000, subtotal: 33898.31, cgstTotal: 3050.85, sgstTotal: 3050.85 });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/issued/i);

    const after = await row(invoice.id);
    expect(Number(after.total)).toBe(118000);
    expect(Number(after.subtotal)).toBe(100000);

    const post = await journal(invoice.id);
    expect(post.entries).toBe(before.entries); // no reversal, no extra entry
    expect(post.live).toBe(1);
    expect(post.liveDebits).toBe(118000);
    expect(await ledgerBalanced()).toBe(true);
  });
});

describe('B/C — metadata edits still work, and do not erase the money', () => {
  it('changes a note and leaves every financial field standing', async () => {
    const invoice = await makeInvoice();
    const before = await journal(invoice.id);

    const res = await patch(invoice.id, { refNo: 'PO-UPDATED' });
    expect(res.status).toBe(200);

    const after = await row(invoice.id);
    expect(Number(after.total)).toBe(118000);
    expect(Number(after.subtotal)).toBe(100000);
    expect(Number(after.cgstTotal)).toBe(9000);
    expect(Number(after.sgstTotal)).toBe(9000);
    expect(after.date).toBe('2026-06-10');
    expect(after.customerName).toBe('Bengaluru Industrial Supplies');
    expect(JSON.parse(after.itemsJson)).toHaveLength(1);
    expect(after.refNo).toBe('PO-UPDATED');

    const post = await journal(invoice.id);
    expect(post.entries).toBe(before.entries); // metadata raises no entry
  });

  it('keeps the extras a partial edit did not mention', async () => {
    const invoice = await makeInvoice({ salesmanId: 'S-1', shipToAddressId: 'ADDR-9' });
    await patch(invoice.id, { costCenterId: 'CC-2' }).expect(200);
    const extras = JSON.parse((await row(invoice.id)).extrasJson || '{}');
    expect(extras.salesmanId).toBe('S-1');
    expect(extras.shipToAddressId).toBe('ADDR-9');
    expect(extras.costCenterId).toBe('CC-2');
  });
});

describe('D/E/F/G — the protected fields', () => {
  it('refuses a customer change and leaves the AR party as it was', async () => {
    const invoice = await makeInvoice({ customerId: 'cust-A' });
    const res = await patch(invoice.id, { customerId: 'cust-B' });
    expect(res.status).toBe(409);
    expect((await row(invoice.id)).customerId).toBe('cust-A');

    const line = await prisma.journalLine.findFirst({
      where: { orgId: owner.orgId, partyType: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
    });
    expect(line?.partyId).toBe('cust-A');
  });

  it('refuses a date change', async () => {
    const invoice = await makeInvoice();
    expect((await patch(invoice.id, { date: '2026-07-01' })).status).toBe(409);
    expect((await row(invoice.id)).date).toBe('2026-06-10');
  });

  it('refuses a number change', async () => {
    const invoice = await makeInvoice();
    const before = (await row(invoice.id)).number;
    expect((await patch(invoice.id, { number: 'RENUMBERED-1' })).status).toBe(409);
    expect((await row(invoice.id)).number).toBe(before);
  });

  it('refuses a change to line quantity, rate, tax or discount', async () => {
    const invoice = await makeInvoice();
    const base = { itemId: 'i1', description: 'Widget', quantity: 1, rate: 100000, gstRate: 18, amount: 100000 };
    for (const change of [
      { quantity: 2 },
      { rate: 90000 },
      { gstRate: 12 },
      { discountAmount: 500 },
      { itemId: 'i2' },
    ]) {
      const res = await patch(invoice.id, { items: [{ ...base, ...change }] });
      expect(res.status).toBe(409);
    }
    expect(JSON.parse((await row(invoice.id)).itemsJson)[0].rate).toBe(100000);
  });

  it('corrects a walk-in customer name only while nothing identifies them but the name', async () => {
    const named = await makeInvoice({ customerName: 'Typo Traders' });
    expect((await patch(named.id, { customerName: 'Fixed Traders' })).status).toBe(409);

    const identified = await makeInvoice({ customerId: 'cust-Z', customerName: 'Zeta Traders' });
    expect((await patch(identified.id, { customerName: 'Zeta Traders Pvt Ltd' })).status).toBe(200);
  });
});

describe('tax treatment and attribution are immutable once posted', () => {
  /* Each of these decides how the supply was taxed or where it was attributed,
     and each has already been expressed in an entry that cannot follow it. */
  const cases: Array<[string, Record<string, any>]> = [
    ['place of supply', { placeOfSupplyState: 'Maharashtra' }],
    ['tax type', { taxType: 'IGST' }],
    ['reverse charge', { reverseCharge: true }],
    ['warehouse', { warehouseId: 'wh-B' }],
    /* The GSTIN is the counterparty's CTIN in GSTR-1 and decides B2B vs B2C
       there and in the INV-01 payload. */
    ['customer GSTIN', { customerGstin: '29ABCDE1234F2Z6' }],
  ];

  for (const [label, change] of cases) {
    it(`refuses a ${label} change and leaves the books untouched`, async () => {
      const invoice = await makeInvoice({
        placeOfSupplyState: 'Karnataka',
        taxType: 'CGST_SGST',
        reverseCharge: false,
        warehouseId: 'wh-A',
        customerGstin: '29ABCDE1234F1Z5',
      });
      const before = await journal(invoice.id);
      const snapshot = await row(invoice.id);

      const res = await patch(invoice.id, change);
      expect(res.status).toBe(409);

      const after = await row(invoice.id);
      expect(after.placeOfSupplyState).toBe(snapshot.placeOfSupplyState);
      expect(after.taxType).toBe(snapshot.taxType);
      expect(after.reverseCharge).toBe(snapshot.reverseCharge);
      expect(after.warehouseId).toBe(snapshot.warehouseId);
      expect(after.customerGstin).toBe(snapshot.customerGstin);
      expect(Number(after.total)).toBe(118000);

      const post = await journal(invoice.id);
      expect(post.entries).toBe(before.entries); // no reversal, no new posting
      expect(post.live).toBe(1);
      expect(post.liveDebits).toBe(118000);
      expect(await ledgerBalanced()).toBe(true);
    });
  }

  it('accepts the same tax treatment and warehouse resent unchanged', async () => {
    const invoice = await makeInvoice({
      placeOfSupplyState: 'Karnataka',
      taxType: 'CGST_SGST',
      reverseCharge: false,
      warehouseId: 'wh-A',
      customerGstin: '29ABCDE1234F1Z5',
    });
    const res = await patch(invoice.id, {
      placeOfSupplyState: 'Karnataka',
      taxType: 'CGST_SGST',
      reverseCharge: false,
      warehouseId: 'wh-A',
      customerGstin: '29ABCDE1234F1Z5',
      refNo: 'PO-RESENT-TAX',
    });
    expect(res.status).toBe(200);
    expect((await row(invoice.id)).refNo).toBe('PO-RESENT-TAX');
  });

  it('leaves all of them editable while nothing is posted', async () => {
    const invoice = await makeInvoice({ placeOfSupplyState: 'Karnataka', taxType: 'CGST_SGST', warehouseId: 'wh-A' });
    await prisma.journalEntry.updateMany({
      where: { orgId: owner.orgId, sourceDocType: 'INVOICE', sourceDocId: invoice.id, status: 'POSTED' },
      data: { status: 'DRAFT' },
    });
    const res = await patch(invoice.id, {
      placeOfSupplyState: 'Maharashtra',
      taxType: 'IGST',
      reverseCharge: true,
      warehouseId: 'wh-B',
      customerGstin: '27ABCDE1234F1Z5',
    });
    expect(res.status).toBe(200);
    const after = await row(invoice.id);
    expect(after.placeOfSupplyState).toBe('Maharashtra');
    expect(after.taxType).toBe('IGST');
    expect(after.reverseCharge).toBe(true);
    expect(after.warehouseId).toBe('wh-B');
    expect(after.customerGstin).toBe('27ABCDE1234F1Z5');
  });
});

describe('genuine metadata stays editable on a posted invoice', () => {
  it('accepts due date, references and the extras together', async () => {
    const invoice = await makeInvoice();
    const before = await journal(invoice.id);
    const res = await patch(invoice.id, {
      dueDate: '2026-12-31',
      refNo: 'PO-77',
      refDate: '2026-06-01',
      salesmanId: 'S-9',
      costCenterId: 'CC-3',
      shipToAddressId: 'ADDR-4',
    });
    expect(res.status).toBe(200);
    const after = await row(invoice.id);
    expect(after.dueDate).toBe('2026-12-31');
    expect(after.refNo).toBe('PO-77');
    expect(after.refDate).toBe('2026-06-01');
    const extras = JSON.parse(after.extrasJson || '{}');
    expect(extras.salesmanId).toBe('S-9');
    expect(extras.costCenterId).toBe('CC-3');
    expect(extras.shipToAddressId).toBe('ADDR-4');
    expect((await journal(invoice.id)).entries).toBe(before.entries);
  });
});

describe('H — resending what is already there is not an amendment', () => {
  it('accepts an identical protected payload', async () => {
    const invoice = await makeInvoice();
    const before = await journal(invoice.id);
    const res = await patch(invoice.id, {
      total: 118000,
      subtotal: 100000,
      cgstTotal: 9000,
      sgstTotal: 9000,
      date: '2026-06-10',
      customerName: 'Bengaluru Industrial Supplies',
      items: [{ itemId: 'i1', description: 'Widget', quantity: 1, rate: 100000, gstRate: 18, amount: 100000 }],
      refNo: 'PO-RESENT',
    });
    expect(res.status).toBe(200);
    expect(Number((await row(invoice.id)).total)).toBe(118000);
    expect((await journal(invoice.id)).entries).toBe(before.entries);
  });

  it('is not confused by a different key order or numeric spelling in the lines', async () => {
    const invoice = await makeInvoice();
    const res = await patch(invoice.id, {
      items: [{ gstRate: 18, amount: 100000, rate: 100000, quantity: 1, description: 'Widget', itemId: 'i1' }],
      refNo: 'PO-REORDERED',
    });
    expect(res.status).toBe(200);
  });
});

describe('I — an invoice cannot be reduced below what has been received', () => {
  it('refuses, and leaves the receipt and the settlement untouched', async () => {
    /* Draft, so nothing is posted and only the settlement guard can refuse. */
    const invoice = await makeInvoice({ status: 'Draft' });
    await prisma.journalEntry.updateMany({
      where: { orgId: owner.orgId, sourceDocType: 'INVOICE', sourceDocId: invoice.id, status: 'POSTED' },
      data: { status: 'DRAFT' },
    });

    await request(app)
      .post(`/api/orgs/${owner.orgId}/payments`)
      .set(auth(owner))
      .send({
        direction: 'RECEIPT',
        number: `R-${rnd()}`,
        date: '2026-06-15',
        partyType: 'CUSTOMER',
        partyName: 'Bengaluru Industrial Supplies',
        ledgerAccountId: await bankId(),
        amount: 50000,
        allocations: [{ docType: 'INVOICE', docId: invoice.id, amount: 50000 }],
      })
      .expect(201);

    const res = await patch(invoice.id, { total: 40000 });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/received/i);

    const after = await row(invoice.id);
    expect(Number(after.total)).toBe(118000);
    expect(Number(after.paidAmount)).toBe(50000);
    expect(Number(after.total) - Number(after.paidAmount)).toBe(68000);
    expect(await prisma.paymentAllocation.count({ where: { docId: invoice.id } })).toBe(1);
  });
});

describe('J/K — cancellation stays on its own route', () => {
  it('refuses a cancel through the general edit route and leaves the posting live', async () => {
    const invoice = await makeInvoice();
    const res = await patch(invoice.id, { status: 'Cancelled' });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/cancel/i);

    expect((await row(invoice.id)).status).not.toBe('Cancelled');
    expect((await journal(invoice.id)).live).toBe(1);
  });

  it('still reverses through the dedicated status route', async () => {
    const invoice = await makeInvoice();
    expect((await journal(invoice.id)).live).toBe(1);

    await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/status`)
      .set(auth(owner))
      .send({ status: 'Cancelled' })
      .expect(200);

    expect((await row(invoice.id)).status).toBe('Cancelled');
    const after = await journal(invoice.id);
    expect(after.entries).toBe(2); // original + contra
    expect(after.live).toBe(0); // and nothing left standing
    expect(await ledgerBalanced()).toBe(true);
  });

  it('leaves a cancelled invoice financially frozen', async () => {
    const invoice = await makeInvoice();
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/status`)
      .set(auth(owner))
      .send({ status: 'Cancelled' })
      .expect(200);
    /* Its posting is withdrawn, so the immutability rule no longer bites — the
       settlement guard and the lifecycle rule still do. */
    expect((await patch(invoice.id, { status: 'Unpaid' })).status).toBe(409);
  });
});

describe('L — a locked period', () => {
  /* Its own organisation: a lock stops anything else being posted into the
     period, and these tests are not the only ones raising invoices in it. */
  it('allows a note and still refuses an amount', async () => {
    const locked = await makeOwner();
    const created = await request(app)
      .post(`/api/orgs/${locked.orgId}/invoices`)
      .set(auth(locked))
      .send({
        date: '2026-06-12',
        customerName: 'Bengaluru Industrial Supplies',
        placeOfSupplyState: 'Karnataka',
        subtotal: 100000,
        cgstTotal: 9000,
        sgstTotal: 9000,
        gstTotal: 18000,
        total: 118000,
        status: 'Unpaid',
        items: [{ itemId: 'i1', description: 'Widget', quantity: 1, rate: 100000, gstRate: 18, amount: 100000 }],
      })
      .expect(201);
    const id = created.body.invoice.id as string;

    await request(app)
      .post(`/api/orgs/${locked.orgId}/ledger/fiscal-years/2026-27/lock`)
      .set(auth(locked))
      .send({ lockedThrough: '2026-06-30' })
      .expect(200);

    const p = (body: Record<string, any>) =>
      request(app).patch(`/api/orgs/${locked.orgId}/invoices/${id}`).set(auth(locked)).send(body);

    expect((await p({ refNo: 'PO-LOCKED' })).status).toBe(200);
    expect((await p({ total: 40000 })).status).toBe(409);
    expect((await p({ date: '2026-07-05' })).status).toBe(409);
    expect(Number((await prisma.invoice.findUnique({ where: { id } }))!.total)).toBe(118000);
  });
});

describe('M — branch', () => {
  it('refuses a branch change and accepts the same branch resent', async () => {
    const invoice = await makeInvoice();
    const res = await patch(invoice.id, { branchId: 'some-other-branch' });
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/branch/i);
    expect((await row(invoice.id)).branchId).toBe(owner.branchId);

    expect((await patch(invoice.id, { branchId: owner.branchId, refNo: 'PO-SAME-BRANCH' })).status).toBe(200);
  });
});

describe('N — an unposted invoice', () => {
  it('keeps its omitted financial fields through a note-only edit, and stays fully editable', async () => {
    const invoice = await makeInvoice();
    await prisma.journalEntry.updateMany({
      where: { orgId: owner.orgId, sourceDocType: 'INVOICE', sourceDocId: invoice.id, status: 'POSTED' },
      data: { status: 'DRAFT' },
    });

    expect((await patch(invoice.id, { refNo: 'PO-UNPOSTED' })).status).toBe(200);
    const mid = await row(invoice.id);
    expect(Number(mid.total)).toBe(118000);
    expect(Number(mid.subtotal)).toBe(100000);
    expect(JSON.parse(mid.itemsJson)).toHaveLength(1);

    // Nothing is in the books, so the amounts are still the user's to change.
    expect((await patch(invoice.id, { total: 40000, subtotal: 33898.31 })).status).toBe(200);
    expect(Number((await row(invoice.id)).total)).toBe(40000);
  });
});

describe('O — the books', () => {
  it('stay balanced, and refusals leave no trace', async () => {
    const invoice = await makeInvoice();
    const beforeCount = await prisma.journalEntry.count({ where: { orgId: owner.orgId } });

    await patch(invoice.id, { total: 1 });
    await patch(invoice.id, { date: '2027-01-01' });
    await patch(invoice.id, { customerId: 'nope' });
    await patch(invoice.id, { status: 'Cancelled' });

    expect(await prisma.journalEntry.count({ where: { orgId: owner.orgId } })).toBe(beforeCount);
    expect(Number((await row(invoice.id)).total)).toBe(118000);
    expect(await ledgerBalanced()).toBe(true);
  });
});

describe('live-posting detection', () => {
  it('does not mistake a reversal contra for a live posting', async () => {
    const invoice = await makeInvoice();
    const accountId = (await row(invoice.id)).accountId;
    const args = { accountId, orgId: owner.orgId, sourceDocType: 'INVOICE', sourceDocId: invoice.id };

    expect((await livePostingsFor(prisma, args)).length).toBe(1);

    await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/status`)
      .set(auth(owner))
      .send({ status: 'Cancelled' })
      .expect(200);

    /* Two entries now share this sourceDocId and one of them is POSTED — the
       contra. The naive query would call that live. */
    const all = await prisma.journalEntry.findMany({
      where: { orgId: owner.orgId, sourceDocType: 'INVOICE', sourceDocId: invoice.id },
    });
    expect(all).toHaveLength(2);
    expect(all.filter((e) => e.status === 'POSTED')).toHaveLength(1);
    expect((await livePostingsFor(prisma, args)).length).toBe(0);
  });
});
