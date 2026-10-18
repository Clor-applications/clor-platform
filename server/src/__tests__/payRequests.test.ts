import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import request from 'supertest';

/**
 * UPI Direct: a pay link for an invoice, the public pay page with the UPI
 * intent and QR, the payer's "I have paid" with a UTR, and confirmation
 * against the receipt recorded for it — and what a link may never do.
 */

const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { upiIntent, newReference } = await import('../routes/payRequests.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `upi.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'UPI owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `UPI Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}
const bankOf = async (c: Ctx) =>
  (await request(app).post(`/api/orgs/${c.orgId}/ledger/accounts`).set(auth(c)).send({ name: `Bank ${rnd()}`, accountType: 'ASSET', controlKind: 'BANK' }).expect(201)).body.account.id as string;
const invoiceOf = async (c: Ctx, total: number, status?: string) => {
  const inv = (await request(app).post(`/api/orgs/${c.orgId}/invoices`).set(auth(c)).send({ date: '2026-10-10', customerName: 'Asha Traders', subtotal: total, gstTotal: 0, total, items: [{ description: 'Service', quantity: 1, rate: total, gstRate: 0 }] }).expect(201)).body.invoice;
  if (status) await prisma.invoice.update({ where: { id: inv.id }, data: { status } });
  return inv;
};
const tokenOf = (url: string) => url.split('/pay/')[1];

let owner: Ctx;
beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('UPI Direct', () => {
  it('makes a link, shows the pay page, takes the UTR, tells the team, and confirms against the receipt', async () => {
    const inv = await invoiceOf(owner, 1180);
    if (inv.status === 'Draft') await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'Unpaid' } });
    const made = await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(auth(owner)).send({ docId: inv.id, payeeVpa: 'asha.traders@okhdfc', payeeName: 'Asha Traders' }).expect(201);
    expect(made.body.request).toMatchObject({ status: 'PENDING', amount: 1180, docNumber: inv.number, payeeVpa: 'asha.traders@okhdfc', reference: expect.stringMatching(/^CLR-[A-Z2-9]{6}$/) });
    expect(made.body.url).toMatch(/\/pay\/clorpay_[A-Za-z0-9_-]{20,}$/);
    expect(made.body.upi).toContain('upi://pay?pa=asha.traders%40okhdfc');
    expect(made.body.upi).toContain('am=1180.00');
    expect(made.body.upi).toContain(`tr=${made.body.request.reference}`);
    const token = tokenOf(made.body.url);

    /* The public page: amount, payee, QR and the UPI button; no session needed. */
    const pagePublic = await request(app).get(`/pay/${token}`).expect(200);
    expect(pagePublic.type).toBe('text/html');
    expect(pagePublic.headers['cache-control']).toBe('no-store');
    expect(pagePublic.text).toContain('₹1,180.00');
    expect(pagePublic.text).toContain('asha.traders@okhdfc');
    expect(pagePublic.text).toContain('data:image/png;base64,');
    expect(pagePublic.text).toContain('href="upi://pay?');
    await request(app).get('/pay/clorpay_' + 'x'.repeat(30)).expect(404);
    await request(app).get('/pay/not-a-token').expect(404);

    /* A wrong UTR is refused with a reason; a right one is taken once. */
    const bad = await request(app).post(`/pay/${token}/claim`).type('form').send({ utr: '12ab' }).expect(303);
    expect(decodeURIComponent(bad.headers.location)).toMatch(/does not look like a UTR/);
    await request(app).post(`/pay/${token}/claim`).type('form').send({ utr: '428917365012', payerName: 'Ravi <script>' }).expect(303);
    const after = await request(app).get(`/pay/${token}`).expect(200);
    expect(after.text).toContain('428917365012');
    expect(after.text).not.toContain('<script>');
    /* The team that records receipts is told. */
    const inbox = (await request(app).get(`/api/orgs/${owner.orgId}/notifications/inbox`).set(auth(owner)).expect(200)).body.notifications;
    const n = inbox.find((x: any) => x.kind === 'payment.claimed');
    expect(n.title).toMatch(/says they paid ₹1180\.00 for invoice/);
    expect(n.body).toMatch(/UTR 428917365012/);

    /* Confirmation needs the real receipt: right amount, posted, allocated to this invoice. */
    const list = (await request(app).get(`/api/orgs/${owner.orgId}/pay-requests?docId=${inv.id}`).set(auth(owner)).expect(200)).body.requests;
    expect(list[0]).toMatchObject({ status: 'CLAIMED', payerUtr: '428917365012' });
    const id = list[0].id;
    expect((await request(app).post(`/api/orgs/${owner.orgId}/pay-requests/${id}/confirm`).set(auth(owner)).send({}).expect(400)).body.error).toMatch(/Record the receipt first/);
    const bank = await bankOf(owner);
    const wrongAmount = (await request(app).post(`/api/orgs/${owner.orgId}/payments`).set(auth(owner)).send({ direction: 'RECEIPT', date: '2026-10-12', partyType: 'CUSTOMER', partyName: 'Asha Traders', ledgerAccountId: bank, amount: 100, instrumentRef: 'UPI 428917365012' }).expect(201)).body.payment;
    expect((await request(app).post(`/api/orgs/${owner.orgId}/pay-requests/${id}/confirm`).set(auth(owner)).send({ paymentId: wrongAmount.id }).expect(400)).body.error).toMatch(/the request was 1180\.00/);
    const receipt = (await request(app).post(`/api/orgs/${owner.orgId}/payments`).set(auth(owner)).send({ direction: 'RECEIPT', date: '2026-10-12', partyType: 'CUSTOMER', partyName: 'Asha Traders', ledgerAccountId: bank, amount: 1180, instrumentRef: 'UPI 428917365012', allocations: [{ docType: 'INVOICE', docId: inv.id, amount: 1180 }] }).expect(201)).body.payment;
    const ok = await request(app).post(`/api/orgs/${owner.orgId}/pay-requests/${id}/confirm`).set(auth(owner)).send({ paymentId: receipt.id }).expect(200);
    expect(ok.body.request).toMatchObject({ status: 'PAID', paymentId: receipt.id });
    expect((await request(app).post(`/api/orgs/${owner.orgId}/pay-requests/${id}/confirm`).set(auth(owner)).send({ paymentId: receipt.id }).expect(200)).body.replayed).toBe(true);
    expect((await request(app).get(`/pay/${token}`).expect(200)).text).toContain('Paid — thank you');
    /* Nothing is owed now: no new link. */
    expect((await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(auth(owner)).send({ docId: inv.id, payeeVpa: 'asha.traders@okhdfc', payeeName: 'Asha Traders' }).expect(400)).body.error).toMatch(/Nothing is owed/);
  });

  it('refuses drafts, bad UPI IDs, more than is owed, reused UTRs, and other companies', async () => {
    const draft = await invoiceOf(owner, 500, 'Draft');
    expect((await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(auth(owner)).send({ docId: draft.id, payeeVpa: 'a@okicici', payeeName: 'A' }).expect(400)).body.error).toMatch(/Finalise/);
    const inv = await invoiceOf(owner, 500, 'Unpaid');
    expect((await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(auth(owner)).send({ docId: inv.id, payeeVpa: 'not-a-vpa', payeeName: 'A' }).expect(400)).body.error).toMatch(/UPI ID/);
    expect((await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(auth(owner)).send({ docId: inv.id, amount: 600, payeeVpa: 'a@okicici', payeeName: 'A' }).expect(400)).body.error).toMatch(/more than the 500\.00/);
    /* A part payment link; a second link replaces the first. */
    const first = (await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(auth(owner)).send({ docId: inv.id, amount: 200, payeeVpa: 'a@okicici', payeeName: 'A' }).expect(201)).body;
    const second = (await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(auth(owner)).send({ docId: inv.id, payeeVpa: 'a@okicici', payeeName: 'A' }).expect(201)).body;
    expect((await request(app).get(`/pay/${tokenOf(first.url)}`).expect(200)).text).toMatch(/no longer in use/);
    /* A UTR given once cannot be given again for another request of the company. */
    const other = await invoiceOf(owner, 300, 'Unpaid');
    const third = (await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(auth(owner)).send({ docId: other.id, payeeVpa: 'a@okicici', payeeName: 'A' }).expect(201)).body;
    await request(app).post(`/pay/${tokenOf(second.url)}/claim`).type('form').send({ utr: '999900001111' }).expect(303);
    const reused = await request(app).post(`/pay/${tokenOf(third.url)}/claim`).type('form').send({ utr: '999900001111' }).expect(303);
    expect(decodeURIComponent(reused.headers.location)).toMatch(/already given/);
    /* Another company sees none of it and cannot confirm or cancel it. */
    const rival = await makeOwner();
    expect((await request(app).get(`/api/orgs/${rival.orgId}/pay-requests`).set(auth(rival)).expect(200)).body.requests).toEqual([]);
    await request(app).post(`/api/orgs/${rival.orgId}/pay-requests/${second.request.id}/cancel`).set(auth(rival)).expect(404);
    await request(app).post(`/api/orgs/${rival.orgId}/pay-requests`).set(auth(rival)).send({ docId: inv.id, payeeVpa: 'evil@okaxis', payeeName: 'Evil' }).expect(404);
    await request(app).get(`/api/orgs/${owner.orgId}/pay-requests`).set(auth(rival)).expect(403);
    /* Cancelled: the link closes. Expired: the link closes. */
    await request(app).post(`/api/orgs/${owner.orgId}/pay-requests/${third.request.id}/cancel`).set(auth(owner)).expect(200);
    expect((await request(app).get(`/pay/${tokenOf(third.url)}`).expect(200)).text).toMatch(/no longer in use/);
    const fourth = (await request(app).post(`/api/orgs/${owner.orgId}/pay-requests`).set(auth(owner)).send({ docId: other.id, payeeVpa: 'a@okicici', payeeName: 'A' }).expect(201)).body;
    await prisma.paymentRequest.update({ where: { id: fourth.request.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).get(`/pay/${tokenOf(fourth.url)}`).expect(200)).text).toMatch(/past its date/);
    await platformPrisma.$disconnect();
  });

  it('writes the UPI intent the way UPI apps read it', () => {
    const uri = upiIntent({ payeeVpa: 'shop@oksbi', payeeName: 'Sri Ram & Sons', amountPaise: 123456, reference: 'CLR-ABC234', docNumber: 'INV/26/001' });
    expect(uri).toBe('upi://pay?pa=shop%40oksbi&pn=Sri%20Ram%20%26%20Sons&am=1234.56&cu=INR&tn=CLR-ABC234%20Invoice%20INV%2F26%2F001&tr=CLR-ABC234');
    expect(newReference()).toMatch(/^CLR-[A-HJ-NP-Z2-9]{6}$/);
  });
});
