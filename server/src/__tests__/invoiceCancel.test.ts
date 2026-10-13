import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';

/**
 * Cancelling an invoice, and refusing to delete one that was issued.
 *
 * Two halves of the same defect. Cancelling only ever wrote `status`, so a
 * cancelled invoice kept its sales revenue and its output GST sitting in the
 * trial balance — the P&L and the tax liability both overstated, with nothing
 * on screen to explain the gap. Meanwhile deleting an invoice *did* reverse the
 * ledger and worked on any invoice at all, so the safe-looking action left the
 * books wrong and the destructive one was the only honest path.
 *
 * Rule 46(b) wants a consecutive serial number unique to the financial year,
 * and an invoice already reported in GSTR-1 has to be amended or credit-noted.
 * So: issued invoices cancel, drafts delete.
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

beforeAll(async () => {
  const email = `cancel.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Cancel owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Cancel Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}, 60_000);

/*
 * Every invoice is created as a Draft: `status` is a permission-level field and
 * is stripped from the create body by design, so a clerk cannot raise a
 * document already marked paid. Issuing one therefore means promoting it
 * through the status route, which is also how the product does it.
 */
const makeInvoice = async () => {
  const created = await request(app)
    .post(`/api/orgs/${owner.orgId}/invoices`)
    .set(auth(owner))
    .send({
      date: '2026-08-01',
      customerName: 'Buyer Co',
      subtotal: 1000,
      cgstTotal: 90,
      sgstTotal: 90,
      gstTotal: 180,
      total: 1180,
      items: [{ description: 'Widget', quantity: 1, rate: 1000, gstRate: 18 }],
    })
    .expect(201);
  return created.body.invoice;
};

const postedEntries = (invoiceId: string) =>
  prisma.journalEntry.findMany({
    where: { orgId: owner.orgId, sourceDocType: 'INVOICE', sourceDocId: invoiceId, status: 'POSTED' },
    include: { lines: true },
  });

const allEntries = (invoiceId: string) =>
  prisma.journalEntry.findMany({
    where: { orgId: owner.orgId, sourceDocType: 'INVOICE', sourceDocId: invoiceId },
    include: { lines: true },
  });

const setStatus = (invoiceId: string, status: string) =>
  request(app).patch(`/api/orgs/${owner.orgId}/invoices/${invoiceId}/status`).set(auth(owner)).send({ status });

describe('cancelling an invoice', () => {
  it('reverses the journal entry, so the books stop carrying it', async () => {
    const invoice = await makeInvoice();
    const before = await postedEntries(invoice.id);
    expect(before.length).toBeGreaterThan(0);

    const res = await setStatus(invoice.id, 'Cancelled').expect(200);
    expect(res.body.invoice.status).toBe('Cancelled');
    expect(res.body.reversedEntries).toBe(before.length);

    /*
     * Nothing is edited or removed: the original is marked REVERSED and points
     * at a new contra entry, so the trail holds both halves. What must be true
     * is that the two together net to nothing on every account they touched.
     */
    const all = await allEntries(invoice.id);
    expect(all.length).toBe(before.length * 2);
    expect(all.filter((e) => e.status === 'REVERSED')).toHaveLength(before.length);
    expect(all.filter((e) => e.status === 'POSTED')).toHaveLength(before.length);

    const perAccount = new Map<string, number>();
    for (const line of all.flatMap((e) => e.lines)) {
      const net = Number(line.debit ?? 0) - Number(line.credit ?? 0);
      perAccount.set(line.ledgerAccountId, (perAccount.get(line.ledgerAccountId) ?? 0) + net);
    }
    expect(perAccount.size).toBeGreaterThan(0);
    for (const [account, net] of perAccount) {
      expect(`${account}:${Math.abs(net) < 0.005}`).toBe(`${account}:true`);
    }
  });

  /* Cancelling twice must not post a second reversal and re-open the books. */
  it('does not reverse again when the status is set to Cancelled twice', async () => {
    const invoice = await makeInvoice();
    await setStatus(invoice.id, 'Cancelled').expect(200);
    const afterFirst = await allEntries(invoice.id);

    const second = await setStatus(invoice.id, 'Cancelled').expect(200);
    expect(second.body.reversedEntries).toBe(0);
    expect((await allEntries(invoice.id)).length).toBe(afterFirst.length);
  });

  it('leaves the ledger alone for any other status change', async () => {
    const invoice = await makeInvoice();
    const before = await postedEntries(invoice.id);

    const res = await setStatus(invoice.id, 'Paid').expect(200);
    expect(res.body.reversedEntries).toBe(0);
    expect((await postedEntries(invoice.id)).length).toBe(before.length);
  });

  /* The number is what makes cancel the right action, so it must survive. */
  it('keeps the invoice and its number on the books', async () => {
    const invoice = await makeInvoice();
    await setStatus(invoice.id, 'Cancelled').expect(200);

    const row = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(row).not.toBeNull();
    expect(row?.number).toBe(invoice.number);
  });
});

describe('deleting an invoice', () => {
  it('refuses to delete one that has been issued, and names the alternative', async () => {
    const invoice = await makeInvoice();
    await setStatus(invoice.id, 'Unpaid').expect(200);
    const res = await request(app)
      .delete(`/api/orgs/${owner.orgId}/invoices/${invoice.id}`)
      .set(auth(owner))
      .expect(409);
    expect(res.body.code).toBe('INVOICE_ISSUED');
    expect(String(res.body.error)).toMatch(/cancel/i);

    // Still there, still posted.
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).not.toBeNull();
  });

  it('refuses to delete a cancelled invoice — it is the record', async () => {
    const invoice = await makeInvoice();
    await setStatus(invoice.id, 'Cancelled').expect(200);

    await request(app).delete(`/api/orgs/${owner.orgId}/invoices/${invoice.id}`).set(auth(owner)).expect(409);
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).not.toBeNull();
  });

  /* A draft was never issued and holds no number a return has seen. */
  it('still deletes a draft', async () => {
    const invoice = await makeInvoice();
    await request(app).delete(`/api/orgs/${owner.orgId}/invoices/${invoice.id}`).set(auth(owner)).expect(200);
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).toBeNull();
  });
});
