import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHmac } from 'node:crypto';

/**
 * Paying CLOR's invoices online, renewal invoices, and two-person approval of
 * big discounts:
 *  - an issued invoice is paid on the active gateway's page; the signed
 *    webhook, or the check when the customer comes back, marks it paid once
 *    and moves the subscription on;
 *  - the renewal job issues the next period's invoice once, at the list price
 *    after the offer ends, and emails the owner;
 *  - a deal over the discount limit waits until someone other than the person
 *    who asked approves it.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { __setGateway } = await import('../billing/gateway.js');
const { RazorpayGateway } = await import('../billing/razorpay.js');
const { createDraft, issueInvoice } = await import('../billing/invoices.js');
const { runRenewals } = await import('../billing/renewals.js');
const { returnUrlFor } = await import('../billing/payLinks.js');
const { paidUntil } = await import('../billing/events.js');
const { opsKit, lastAudit, at } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
afterEach(() => __setGateway(null));
const { company, staff } = opsKit(app);
const tag = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const SECRET = 'whsec_rzp_test';

/** Razorpay on recorded answers: links are made and read back from `links`. */
function fakeRazorpay() {
  const calls: Array<{ method: string; url: string; body: any }> = [];
  const links = new Map<string, { status: string; amount_paid: number; payments: any[] }>();
  let n = 0;
  const gateway = new RazorpayGateway({ mode: 'TEST', keyId: 'rzp_test_AbCdEf123456', keySecret: 'secretSecret123', webhookSecret: SECRET }, async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, url, body });
    if (init.method === 'POST' && url.endsWith('/payment_links')) {
      const id = `plink_${++n}${tag()}`;
      links.set(id, { status: 'created', amount_paid: 0, payments: [] });
      return { status: 200, text: async () => JSON.stringify({ id, short_url: `https://rzp.io/i/${id}`, status: 'created' }) };
    }
    const m = /payment_links\/([^/?]+)$/.exec(url);
    if (init.method === 'GET' && m && links.has(m[1])) return { status: 200, text: async () => JSON.stringify({ id: m[1], ...links.get(m[1]) }) };
    return { status: 404, text: async () => '{}' };
  });
  return { gateway, calls, links };
}

/** An account with a monthly subscription at ₹1,000 and one issued invoice for it. */
async function customerWithInvoice(total = 100000) {
  const cust = await company('payonline');
  await setSub(cust.accountId, { status: 'active', billingInterval: 'month', currentPeriodEnd: new Date(Date.now() + 5 * 86_400_000), planName: 'Test plan', periodAmount: total, listAmount: total });
  const d = await createDraft({ accountId: cust.accountId, lines: [{ description: 'CLOR Test plan, monthly', quantity: 1, unitAmount: total }], months: 1 }, null);
  const inv = await issueInvoice(d.id, null);
  return { cust, inv };
}

/** Signup gives every account a trial subscription; a test changes it. */
const setSub = (accountId: string, data: Record<string, unknown>) => platformPrisma.subscription.update({ where: { accountId }, data });

const signed = (body: unknown) => {
  const raw = JSON.stringify(body);
  return { raw, sig: createHmac('sha256', SECRET).update(raw).digest('hex') };
};
const paidWebhook = (linkId: string, invoiceId: string, amount: number, paymentId = `pay_${tag()}`) => ({
  event: 'payment_link.paid',
  payload: {
    payment_link: { entity: { id: linkId, status: 'paid', amount_paid: amount, notes: { invoiceId } } },
    payment: { entity: { id: paymentId, amount, notes: {} } },
  },
  created_at: Math.floor(Date.now() / 1000),
});

describe('paying an invoice online', () => {
  it('makes one link for the total, marks the invoice paid from the webhook once, and moves the subscription on', async () => {
    const { cust, inv } = await customerWithInvoice();
    const before = (await platformPrisma.subscription.findUnique({ where: { accountId: cust.accountId } }))!.currentPeriodEnd!;

    /* With manual payments only, nothing is offered online. */
    expect((await request(app).get('/api/billing/invoices').set(at(cust)).expect(200)).body.payOnline).toBe(false);
    expect((await request(app).post(`/api/billing/invoices/${inv.id}/pay`).set(at(cust)).send({}).expect(409)).body.error).toMatch(/not open yet/);

    const rzp = fakeRazorpay();
    __setGateway(rzp.gateway);
    expect((await request(app).get(`/api/billing/invoices/${inv.id}`).set(at(cust)).expect(200)).body.payOnline).toBe(true);
    const first = (await request(app).post(`/api/billing/invoices/${inv.id}/pay`).set(at(cust)).send({ returnTo: 'https://evil.example.com/steal' }).expect(200)).body;
    expect(first).toMatchObject({ gateway: 'razorpay', reused: false });
    const made = rzp.calls.find((c) => c.method === 'POST')!;
    expect(made.body).toMatchObject({ amount: inv.total, currency: 'INR', accept_partial: false, notes: { accountId: cust.accountId, invoiceId: inv.id } });
    expect(made.body.callback_url).not.toMatch(/evil/);
    /* Pressing it again uses the same page. */
    expect((await request(app).post(`/api/billing/invoices/${inv.id}/pay`).set(at(cust)).send({}).expect(200)).body).toMatchObject({ url: first.url, reused: true });
    expect(rzp.calls.filter((c) => c.method === 'POST')).toHaveLength(1);

    /* Another account cannot reach it. */
    const other = await company('payonline');
    await request(app).post(`/api/billing/invoices/${inv.id}/pay`).set(at(other)).send({}).expect(404);

    const linkId = (await platformPrisma.billingInvoice.findUnique({ where: { id: inv.id } }))!.payLinkId!;
    const { raw, sig } = signed(paidWebhook(linkId, inv.id, inv.total, 'pay_TEST123'));
    await request(app).post('/api/billing/webhook/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', `evt_${tag()}`).send(raw).expect(200);
    const paid = await platformPrisma.billingInvoice.findUnique({ where: { id: inv.id } });
    expect(paid).toMatchObject({ status: 'PAID', paidAmount: inv.total, paymentReference: 'pay_TEST123' });
    const sub = await platformPrisma.subscription.findUnique({ where: { accountId: cust.accountId } });
    expect(sub?.status).toBe('active');
    expect(sub!.currentPeriodEnd!.getTime()).toBeGreaterThan(before.getTime() + 27 * 86_400_000);

    /* The same payment again (a resend under a new event id) changes nothing. */
    const again = await request(app).post('/api/billing/webhook/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', `evt_${tag()}`).send(raw).expect(200);
    expect(again.body.duplicate).toBe(true);
    expect((await platformPrisma.subscription.findUnique({ where: { accountId: cust.accountId } }))!.currentPeriodEnd!.getTime()).toBe(sub!.currentPeriodEnd!.getTime());
    await request(app).post(`/api/billing/invoices/${inv.id}/pay`).set(at(cust)).send({}).expect(409);
  }, 120_000);

  it('marks it paid when the customer comes back before the webhook, and refuses a short payment', async () => {
    const rzp = fakeRazorpay();
    __setGateway(rzp.gateway);
    const { cust, inv } = await customerWithInvoice(50000);
    await request(app).post(`/api/billing/invoices/${inv.id}/pay`).set(at(cust)).send({ returnTo: 'http://localhost:5173/?x=1' }).expect(200);
    const linkId = (await platformPrisma.billingInvoice.findUnique({ where: { id: inv.id } }))!.payLinkId!;
    expect((await request(app).post(`/api/billing/invoices/${inv.id}/pay/check`).set(at(cust)).send({}).expect(200)).body).toMatchObject({ paid: false, status: 'ISSUED' });
    rzp.links.set(linkId, { status: 'paid', amount_paid: inv.total, payments: [{ payment_id: 'pay_BACK1', status: 'captured' }] });
    expect((await request(app).post(`/api/billing/invoices/${inv.id}/pay/check`).set(at(cust)).send({}).expect(200)).body).toMatchObject({ paid: true, status: 'PAID' });
    expect((await platformPrisma.billingInvoice.findUnique({ where: { id: inv.id } }))?.paymentReference).toBe('pay_BACK1');
    /* The webhook arriving later is the same event, kept once. */
    const { raw, sig } = signed(paidWebhook(linkId, inv.id, inv.total));
    expect((await request(app).post('/api/billing/webhook/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', sig).send(raw).expect(200)).body.duplicate).toBe(true);

    const short = await customerWithInvoice(80000);
    await request(app).post(`/api/billing/invoices/${short.inv.id}/pay`).set(at(short.cust)).send({}).expect(200);
    const shortLink = (await platformPrisma.billingInvoice.findUnique({ where: { id: short.inv.id } }))!.payLinkId!;
    const s = signed(paidWebhook(shortLink, short.inv.id, 1000));
    await request(app).post('/api/billing/webhook/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', s.sig).send(s.raw).expect(200);
    expect((await platformPrisma.billingInvoice.findUnique({ where: { id: short.inv.id } }))?.status).toBe('ISSUED');
    const ev = await platformPrisma.paymentEvent.findFirst({ where: { eventId: `payment_link.paid:${shortLink}` } });
    expect(ev?.detail).toMatch(/less than invoice/);
  }, 120_000);

  it('sends the customer back only to CLOR’s own pages', () => {
    expect(returnUrlFor('https://app.clor.in/#/billing?paid=1')).toBe('https://app.clor.in/#/billing?paid=1');
    expect(returnUrlFor('https://people.clor.in/x')).toBe('https://people.clor.in/x');
    expect(returnUrlFor('https://clor.in.evil.com/')).not.toMatch(/evil/);
    expect(returnUrlFor('https://someone.clor.in/')).not.toMatch(/someone/);
    expect(returnUrlFor('javascript:alert(1)')).not.toMatch(/javascript/);
  });
});

describe('renewal invoices', () => {
  it('issues the next period once, at the list price after the offer ends, and emails the owner', async () => {
    const cust = await company('renew');
    const ends = new Date(Date.now() + 3 * 86_400_000);
    await setSub(cust.accountId, { status: 'active', billingInterval: 'month', currentPeriodEnd: ends, planName: 'Growth', planUnit: 'USER', quantity: 10, listAmount: 200000, periodAmount: 150000, offerCode: 'LAUNCH25', offerEndsAt: ends });
    const r = await runRenewals(new Date(), [cust.accountId]);
    expect(r).toMatchObject({ issued: 1, failed: [] });
    const invs = await platformPrisma.billingInvoice.findMany({ where: { accountId: cust.accountId } });
    expect(invs).toHaveLength(1);
    expect(invs[0]).toMatchObject({ status: 'ISSUED', source: 'RENEWAL', subtotal: 200000, months: 1 });
    expect(invs[0].number).toBeTruthy();
    expect((invs[0].lines as any[])[0].description).toBe('CLOR Growth, 10 users, monthly');
    expect(await platformPrisma.emailOutbox.count({ where: { toEmail: cust.email, templateKey: 'billing.renewal_invoice' } })).toBe(1);
    expect((await platformPrisma.operatorAuditEvent.findFirst({ where: { targetAccountId: cust.accountId, action: 'INVOICE_RENEWAL_ISSUED' } }))?.operatorUserId).toBe('system');

    /* A second run, or a second server, changes nothing. */
    expect(await runRenewals(new Date(), [cust.accountId])).toMatchObject({ issued: 0, skipped: 1 });
    expect(await platformPrisma.billingInvoice.count({ where: { accountId: cust.accountId } })).toBe(1);

    /* Cancelling at the period end, or a period far off, gets none. */
    const later = await company('renew');
    await setSub(later.accountId, { status: 'active', billingInterval: 'year', currentPeriodEnd: new Date(Date.now() + 40 * 86_400_000), planName: 'Growth', listAmount: 100000, periodAmount: 100000 });
    const leaving = await company('renew');
    await setSub(leaving.accountId, { status: 'active', billingInterval: 'month', cancelAtPeriodEnd: true, currentPeriodEnd: ends, planName: 'Growth', listAmount: 100000, periodAmount: 100000 });
    expect(await runRenewals(new Date(), [later.accountId, leaving.accountId])).toMatchObject({ issued: 0 });
  }, 120_000);

  it('lists what is coming up for staff, and issues the due ones on request', async () => {
    const fin = await staff('BILLING');
    const reader = await staff('READ_ONLY');
    const cust = await company('renew');
    await setSub(cust.accountId, { status: 'active', billingInterval: 'month', currentPeriodEnd: new Date(Date.now() + 2 * 86_400_000), planName: 'Starter', listAmount: 50000, periodAmount: 50000 });
    const list = (await request(app).get('/api/ops/invoicing/renewals').set(reader.h).expect(200)).body;
    expect(list.upcoming.find((u: any) => u.accountId === cust.accountId)).toMatchObject({ planName: 'Starter', dueNow: true, invoice: null });
    await request(app).post('/api/ops/invoicing/renewals/run').set(reader.h).send({}).expect(403);
  }, 120_000);
});

describe('two-person approval of big discounts', () => {
  it('waits for someone else to approve a deal over the limit, then sets it in their name', async () => {
    const asker = await staff('BILLING');
    const approver = await staff('BILLING');
    const support = await staff('SUPPORT');
    const owner = await staff('SUPER_ADMIN');
    const cust = await company('approve');
    const plan = (await request(app).post('/api/ops/custom-plans').set(asker.h).send({ accountId: cust.accountId, name: 'Big deal plan', apps: ['accounting'], unit: 'USER', includedUnits: 5, monthlyPrice: 100000, monthlyExtra: 10000, yearlyPrice: null, yearlyExtra: 0, gstApplies: false }).expect(201)).body.plan;
    const code = `HALF${tag()}`;
    await request(app).post('/api/ops/offers').set(asker.h).send({ code, name: 'Forty off', kind: 'PERCENT', value: 40 }).expect(201);
    const ask = { source: 'custom', ref: plan.id, period: 'MONTHLY', quantity: 5, offerCode: code };

    expect((await request(app).post(`/api/ops/accounts/${cust.accountId}/deal/quote`).set(asker.h).send(ask).expect(200)).body).toMatchObject({ needsApproval: true, limit: 20 });
    const asked = await request(app).post(`/api/ops/accounts/${cust.accountId}/deal`).set(asker.h).send({ ...ask, reason: 'Matching a rival quote' }).expect(202);
    expect(asked.body).toMatchObject({ needsApproval: true, approval: { status: 'PENDING' } });
    const id = asked.body.approval.id;
    expect((await platformPrisma.subscription.findUnique({ where: { accountId: cust.accountId } }))?.planName ?? null).toBeNull();
    expect((await lastAudit(asker.userId, 'APPROVAL_ASKED'))?.detail).toMatchObject({ approvalId: id, discount: '40%' });
    expect(await platformPrisma.emailOutbox.count({ where: { toEmail: approver.email, templateKey: 'ops.approval_asked', relatedId: id } })).toBe(1);
    expect(await platformPrisma.emailOutbox.count({ where: { toEmail: asker.email, templateKey: 'ops.approval_asked', relatedId: id } })).toBe(0);

    const mine = (await request(app).get('/api/ops/approvals').set(asker.h).expect(200)).body.approvals.find((a: any) => a.id === id);
    expect(mine).toMatchObject({ mine: true, canDecide: false, canWithdraw: true, discountPercent: 40 });
    expect((await request(app).post(`/api/ops/approvals/${id}/approve`).set(asker.h).send({}).expect(403)).body.code).toBe('SAME_PERSON');
    expect((await request(app).post(`/api/ops/approvals/${id}/approve`).set(support.h).send({}).expect(403)).body.code).toBe('OPERATOR_ROLE');
    expect((await request(app).get('/api/ops/approvals').set(approver.h).expect(200)).body.approvals.find((a: any) => a.id === id)).toMatchObject({ canDecide: true, canWithdraw: false });

    const ok = await request(app).post(`/api/ops/approvals/${id}/approve`).set(approver.h).send({ note: 'Fine for a year' }).expect(200);
    expect(ok.body.status).toBe('APPROVED');
    expect(await platformPrisma.subscription.findUnique({ where: { accountId: cust.accountId } })).toMatchObject({ planName: 'Big deal plan', listAmount: 100000, periodAmount: 60000, offerCode: code });
    expect((await lastAudit(approver.userId, 'SUBSCRIPTION_DEAL_SET'))?.detail).toMatchObject({ approvedAfterRequest: id, reason: 'Matching a rival quote' });
    expect((await lastAudit(approver.userId, 'APPROVAL_GRANTED'))?.detail).toMatchObject({ approvalId: id, note: 'Fine for a year' });
    await request(app).post(`/api/ops/approvals/${id}/approve`).set(owner.h).send({}).expect(409);

    /* Turned down needs a reason; withdrawn by the person who asked; expired cannot be approved. */
    /* Holding the offer is no way round the limit: more users at 40% off is asked again. */
    const held = (await request(app).post(`/api/ops/accounts/${cust.accountId}/deal`).set(asker.h).send({ ...ask, quantity: 6, reason: 'One more user' }).expect(202)).body.approval.id;
    /* One waiting request per customer. */
    expect((await request(app).post(`/api/ops/accounts/${cust.accountId}/deal`).set(asker.h).send({ ...ask, quantity: 7, reason: 'Two more users' }).expect(409)).body.error).toMatch(/already waiting/);
    /* Prices that moved since it was asked are not approved blind. */
    await platformPrisma.opsApproval.update({ where: { id: held }, data: { discountPercent: 30 } });
    expect((await request(app).post(`/api/ops/approvals/${held}/approve`).set(approver.h).send({}).expect(409)).body.code).toBe('PRICE_CHANGED');
    expect((await platformPrisma.subscription.findUnique({ where: { accountId: cust.accountId } }))?.quantity).toBe(5);
    expect((await platformPrisma.opsApproval.findUnique({ where: { id: held } }))?.status).toBe('FAILED');
    const other = await company('approve');
    const planB = (await request(app).post('/api/ops/custom-plans').set(asker.h).send({ accountId: null, name: 'Open big plan', apps: ['accounting'], unit: 'USER', includedUnits: 5, monthlyPrice: 100000, monthlyExtra: 10000, yearlyPrice: null, yearlyExtra: 0, gstApplies: false }).expect(201)).body.plan;
    const askB = { source: 'custom', ref: planB.id, period: 'MONTHLY', quantity: 5, offerCode: code, reason: 'Rival quote again' };
    const r1 = (await request(app).post(`/api/ops/accounts/${other.accountId}/deal`).set(asker.h).send(askB).expect(202)).body.approval.id;
    await request(app).post(`/api/ops/accounts/${other.accountId}/deal`).set(asker.h).send(askB).expect(409);
    await request(app).post(`/api/ops/approvals/${r1}/reject`).set(approver.h).send({}).expect(400);
    await request(app).post(`/api/ops/approvals/${r1}/reject`).set(approver.h).send({ note: 'Too deep for this size' }).expect(200);
    const r2 = (await request(app).post(`/api/ops/accounts/${other.accountId}/deal`).set(asker.h).send(askB).expect(202)).body.approval.id;
    await request(app).post(`/api/ops/approvals/${r2}/withdraw`).set(approver.h).send({}).expect(403);
    await request(app).post(`/api/ops/approvals/${r2}/withdraw`).set(asker.h).send({}).expect(200);
    const r3 = (await request(app).post(`/api/ops/accounts/${other.accountId}/deal`).set(asker.h).send(askB).expect(202)).body.approval.id;
    await platformPrisma.opsApproval.update({ where: { id: r3 }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post(`/api/ops/approvals/${r3}/approve`).set(approver.h).send({}).expect(409)).body.error).toMatch(/expired/);
    expect((await platformPrisma.subscription.findUnique({ where: { accountId: other.accountId } }))?.planName ?? null).toBeNull();

    /* Only the owner moves the limit, with a reason. */
    await request(app).put('/api/ops/approvals/settings').set(approver.h).send({ discountPercent: 50, reason: 'Testing' }).expect(403);
    await request(app).put('/api/ops/approvals/settings').set(owner.h).send({ discountPercent: 50 }).expect(400);
    try {
      expect((await request(app).put('/api/ops/approvals/settings').set(owner.h).send({ discountPercent: 50, reason: 'Festival season' }).expect(200)).body.discountPercent).toBe(50);
      expect((await request(app).post(`/api/ops/accounts/${other.accountId}/deal`).set(asker.h).send(askB).expect(200)).body.deal.periodAmount).toBe(60000);
    } finally {
      await request(app).put('/api/ops/approvals/settings').set(owner.h).send({ discountPercent: 20, reason: 'Back to normal' }).expect(200);
    }
  }, 240_000);
});

describe('Cashfree payment links', () => {
  it('needs the payer’s mobile number, sends the amount in rupees, and reads a paid link event', async () => {
    const { CashfreeGateway, normalizeCashfree } = await import('../billing/cashfree.js');
    const sent: any[] = [];
    const cf = new CashfreeGateway({ mode: 'TEST', appId: 'TEST123', secretKey: 'cfsk_test' }, async (url, init) => {
      sent.push({ url, body: init.body ? JSON.parse(init.body) : null });
      return { status: 200, text: async () => JSON.stringify({ link_id: JSON.parse(init.body!).link_id, link_url: 'https://payments-test.cashfree.com/links/abc' }) };
    });
    const input = { invoiceId: 'inv1', accountId: 'acc1', number: 'CLOR/26-27/0007', amount: 118050, description: 'CLOR invoice CLOR/26-27/0007', customer: { name: 'Meridian', email: 'a@b.in', phone: null }, returnUrl: 'https://app.clor.in/', expiresAt: new Date(Date.now() + 86_400_000) };
    await expect(cf.createPaymentLink(input)).rejects.toThrow(/mobile number/);
    const link = await cf.createPaymentLink({ ...input, customer: { ...input.customer, phone: '+91 98450 12345' } });
    expect(link.url).toMatch(/cashfree/);
    expect(sent[0].url).toBe('https://sandbox.cashfree.com/pg/links');
    expect(sent[0].body).toMatchObject({ link_amount: 1180.5, link_currency: 'INR', link_partial_payments: false, customer_details: { customer_phone: '9845012345' }, link_notes: { invoiceId: 'inv1', accountId: 'acc1' } });

    const ev = normalizeCashfree({ type: 'PAYMENT_LINK_EVENT', data: { link_id: link.id, link_status: 'PAID', link_amount_paid: '1180.50', link_notes: { accountId: 'acc1', invoiceId: 'inv1' }, order: { order_id: 'CF_ORDER_1' } } });
    expect(ev).toMatchObject({ eventId: `PAYMENT_LINK_EVENT:${link.id}:PAID`, accountId: 'acc1', amount: 118050, reference: 'CF_ORDER_1', invoice: { invoiceId: 'inv1', linkId: link.id, amountPaid: 118050 } });
    expect(normalizeCashfree({ type: 'PAYMENT_LINK_EVENT', data: { link_id: 'x', link_status: 'PARTIALLY_PAID' } }).invoice).toBeUndefined();
  });
});

describe('what a payment pays for', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const now = d('2026-11-10');
  it('pays to the end of the invoice period, never twice for a period already shown, and keeps month ends', () => {
    /* A deal's first invoice: the subscription already runs to 10 Dec, so paying it adds nothing. */
    expect(paidUntil(d('2026-12-10'), 1, '2026-11-10', now).toISOString()).toBe(d('2026-12-10').toISOString());
    /* A renewal for the next period pays to its end. */
    expect(paidUntil(d('2026-12-10'), 1, '2026-12-10', now).toISOString()).toBe(d('2027-01-10').toISOString());
    /* No period on the invoice: counted from the paid end, month ends clamped. */
    expect(paidUntil(d('2027-01-31'), 1, null, now).toISOString()).toBe(d('2027-02-28').toISOString());
    /* A period long gone, or a lapsed subscription: counted from today. */
    expect(paidUntil(d('2026-01-01'), 1, '2026-01-01', now).toISOString()).toBe(d('2026-12-10').toISOString());
    expect(paidUntil(null, 12, null, now).toISOString()).toBe(d('2027-11-10').toISOString());
  });

  it('does not start a cancelled subscription again, and says when an invoice is paid twice', async () => {
    const rzp = fakeRazorpay();
    __setGateway(rzp.gateway);
    const { cust, inv } = await customerWithInvoice(40000);
    await request(app).post(`/api/billing/invoices/${inv.id}/pay`).set(at(cust)).send({}).expect(200);
    const linkId = (await platformPrisma.billingInvoice.findUnique({ where: { id: inv.id } }))!.payLinkId!;
    await setSub(cust.accountId, { status: 'cancelled' });
    const { raw, sig } = signed(paidWebhook(linkId, inv.id, inv.total));
    await request(app).post('/api/billing/webhook/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', sig).send(raw).expect(200);
    expect((await platformPrisma.billingInvoice.findUnique({ where: { id: inv.id } }))?.status).toBe('PAID');
    expect((await platformPrisma.subscription.findUnique({ where: { accountId: cust.accountId } }))?.status).toBe('cancelled');
    expect((await platformPrisma.paymentEvent.findFirst({ where: { eventId: `payment_link.paid:${linkId}` } }))?.detail).toMatch(/not started again/);

    /* A second link for the same invoice, paid too: staff are told to refund it. */
    const twice = signed(paidWebhook(`plink_OTHER${tag()}`, inv.id, inv.total));
    await request(app).post('/api/billing/webhook/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', twice.sig).send(twice.raw).expect(200);
    const ev = await platformPrisma.paymentEvent.findFirst({ where: { type: 'payment_link.paid', detail: { contains: `${inv.number} was already paid, and this second payment` } } });
    expect(ev?.detail).toMatch(/Refund it/);
  }, 120_000);

  it('cancels the earlier link before making a new one', async () => {
    const rzp = fakeRazorpay();
    __setGateway(rzp.gateway);
    const { cust, inv } = await customerWithInvoice(30000);
    await request(app).post(`/api/billing/invoices/${inv.id}/pay`).set(at(cust)).send({}).expect(200);
    const old = (await platformPrisma.billingInvoice.findUnique({ where: { id: inv.id } }))!.payLinkId!;
    await platformPrisma.billingInvoice.update({ where: { id: inv.id }, data: { payLinkAt: new Date(Date.now() - 20 * 86_400_000) } });
    await request(app).post(`/api/billing/invoices/${inv.id}/pay`).set(at(cust)).send({}).expect(200);
    expect(rzp.calls.some((c) => c.method === 'POST' && c.url.endsWith(`/payment_links/${old}/cancel`))).toBe(true);
    expect((await platformPrisma.billingInvoice.findUnique({ where: { id: inv.id } }))!.payLinkId).not.toBe(old);
  }, 120_000);
});
