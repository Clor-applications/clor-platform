import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Emailing CLOR's own invoices to the customer (billing/invoiceEmail.ts):
 * issuing sends the first email once, unless told not to; a missing address
 * never fails the issue; the mail carries how to pay; Send again and Remind
 * are recorded; only an issued, unpaid invoice is ever emailed; and only
 * Finance, with a fresh code, may send. Mail is captured in the outbox: none
 * leaves the machine.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { __setGateway } = await import('../billing/gateway.js');
const { RazorpayGateway } = await import('../billing/razorpay.js');
const { clearProviderCache } = await import('../billing/providers.js');
const { sendInvoiceEmail, recipientFor } = await import('../billing/invoiceEmail.js');
const { runRenewals } = await import('../billing/renewals.js');
const { opsKit, lastAudit, bearer } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: invoice emails', fn);
type Staff = Awaited<ReturnType<typeof staff>>;
let fin: Staff;

beforeAll(async () => {
  await db(() => platformPrisma.paymentProvider.deleteMany({}));
  clearProviderCache();
  fin = await staff('BILLING');
  await request(app)
    .put('/api/ops/payments/providers/manual')
    .set(fin.h)
    .send({ enabled: true, manual: { upiId: 'clor@okaxis', payeeName: 'CLOR Applications', bank: { accountName: 'CLOR Applications Pvt Ltd', accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' } } })
    .expect(200);
}, 120_000);
afterAll(async () => {
  await db(() => platformPrisma.paymentProvider.deleteMany({}));
  clearProviderCache();
  await new Promise((done) => app.close(done));
});
afterEach(() => __setGateway(null));

const LINES = [{ description: 'CLOR People, 25 users', appCode: 'people', quantity: 25, unitAmount: 9900 }];
const draft = async (accountId: string, extra: Record<string, unknown> = {}) => (await request(app).post('/api/ops/invoices').set(fin.h).send({ accountId, lines: LINES, months: 1, ...extra }).expect(201)).body;
const issue = async (id: string, body: Record<string, unknown> = {}) => (await request(app).post(`/api/ops/invoices/${id}/issue`).set(fin.h).send(body).expect(200)).body;
const mails = (invoiceId: string) => db(() => platformPrisma.emailOutbox.findMany({ where: { relatedType: 'BillingInvoice', relatedId: invoiceId }, orderBy: { createdAt: 'asc' } }));
const sends = (invoiceId: string) => db(() => platformPrisma.billingInvoiceSend.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } }));
/** The one-minute guard against a double press, moved out of the way. */
const aMinuteLater = (invoiceId: string) => db(() => platformPrisma.billingInvoiceSend.updateMany({ where: { invoiceId }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } }));

/** Razorpay on recorded answers; `broken` makes every call fail. */
function fakeRazorpay(broken = false) {
  let n = 0;
  return new RazorpayGateway({ mode: 'TEST', keyId: 'rzp_test_AbCdEf123456', keySecret: 'secretSecret123', webhookSecret: 'whsec' }, async (url, init) => {
    if (broken) return { status: 500, text: async () => '{"error":{"description":"down"}}' };
    if (init.method === 'POST' && url.endsWith('/payment_links')) {
      const id = `plink_mail${++n}${Math.random().toString(36).slice(2, 7)}`;
      return { status: 200, text: async () => JSON.stringify({ id, short_url: `https://rzp.io/i/${id}`, status: 'created' }) };
    }
    return { status: 404, text: async () => '{}' };
  });
}

describe('emailing an invoice when it is issued', () => {
  it('sends nothing when told not to', async () => {
    const cust = await company('mailoff');
    const d = await draft(cust.accountId);
    const r = await issue(d.id, { email: false });
    expect(r).toMatchObject({ status: 'ISSUED', emailed: false, emailError: null, sentTo: null, lastSentAt: null, emailTo: cust.email });
    expect(await mails(d.id)).toHaveLength(0);
    expect(await sends(d.id)).toHaveLength(0);
    /* Not a yes or a no: nothing is issued and nothing sent. */
    const d2 = await draft(cust.accountId);
    await request(app).post(`/api/ops/invoices/${d2.id}/issue`).set(fin.h).send({ email: 'yes' }).expect(400);
    expect((await request(app).get(`/api/ops/invoices/${d2.id}`).set(fin.h).expect(200)).body.status).toBe('DRAFT');
  }, 120_000);

  /* A console that does not send the field (the one live before the drawer had its box) must not start mailing customers. */
  it('sends nothing when the console does not ask', async () => {
    const cust = await company('mailunasked');
    const d = await draft(cust.accountId);
    const r = await issue(d.id, {});
    expect(r).toMatchObject({ status: 'ISSUED', emailed: false, emailError: null });
    expect(await mails(d.id)).toHaveLength(0);
    expect(await sends(d.id)).toHaveLength(0);
  }, 120_000);

  it('sends exactly one when asked, with UPI and bank details when no gateway is on, and never the same one twice', async () => {
    const cust = await company('mailon');
    const d = await draft(cust.accountId);
    const r = await issue(d.id, { email: true });
    expect(r).toMatchObject({ status: 'ISSUED', emailed: true, emailedTo: cust.email, emailError: null, sentTo: cust.email, reminderCount: 0, remindersOff: false, lastRemindedAt: null });
    expect(r.lastSentAt).toBeTruthy();

    const out = await mails(d.id);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ templateKey: 'billing.invoice_issued', toEmail: cust.email, status: 'SENT', accountId: cust.accountId });
    expect(out[0].subject).toBe(`CLOR invoice ${r.number} for ₹2,475`);
    expect(out[0].bodyText).toContain('Pay by UPI to clor@okaxis (CLOR Applications).');
    expect(out[0].bodyText).toContain('bank transfer: CLOR Applications Pvt Ltd, account 50200012345678, IFSC HDFC0001234, HDFC Bank.');
    expect(out[0].bodyText).toContain(`Give ${r.number} as the reference`);
    expect(out[0].bodyText).toContain(`/?app=admin&open=invoices&invoice=${d.id}`);
    expect(out[0].bodyText).not.toContain('Pay online');
    expect(out[0].bodyText).not.toMatch(/\{\{|undefined|null/);

    const rows = await sends(d.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'ISSUED', step: 'manual', auto: false, toEmail: cust.email, dedupeKey: `${d.id}:issued`, outboxId: out[0].id, sentByUserId: fin.userId, accountId: cust.accountId });
    expect((await lastAudit(fin.userId, 'INVOICE_EMAILED'))?.detail).toMatchObject({ invoiceId: d.id, to: cust.email, kind: 'ISSUED', template: 'billing.invoice_issued' });

    /* The first email a second time, from anywhere: skipped. */
    expect(await sendInvoiceEmail(d.id, { kind: 'ISSUED', userId: fin.userId })).toEqual({ sent: false, skipped: 'ALREADY_SENT', to: cust.email });
    expect(await sendInvoiceEmail(d.id, { kind: 'ISSUED', auto: true })).toMatchObject({ sent: false, skipped: 'ALREADY_SENT' });
    expect(await mails(d.id)).toHaveLength(1);
    expect(await sends(d.id)).toHaveLength(1);

    /* The list and the history show it. */
    const row = (await request(app).get(`/api/ops/invoices?accountId=${cust.accountId}`).set(fin.h).expect(200)).body.invoices.find((i: any) => i.id === d.id);
    expect(row).toMatchObject({ sentTo: cust.email, reminderCount: 0, remindersOff: false, lastRemindedAt: null });
    const hist = (await request(app).get(`/api/ops/invoices/${d.id}/sends`).set(fin.h).expect(200)).body;
    expect(hist.sends).toEqual([expect.objectContaining({ kind: 'ISSUED', toEmail: cust.email, delivery: 'SENT', template: 'billing.invoice_issued', auto: false })]);
  }, 120_000);

  it('goes to the email on the invoice before the owner, and never to a person who was deactivated', async () => {
    const cust = await company('mailto');
    const d = await draft(cust.accountId, { buyer: { name: 'Kaveri Traders', state: 'Karnataka', email: 'accounts@kaveri.example.com' } });
    const r = await issue(d.id, { email: true });
    expect(r).toMatchObject({ emailed: true, emailedTo: 'accounts@kaveri.example.com' });
    const [m] = await mails(d.id);
    expect(m.toEmail).toBe('accounts@kaveri.example.com');
    expect(m.bodyText.startsWith('Hello Kaveri Traders,')).toBe(true);

    /* The owner's own address is on a second invoice; once they are deactivated nobody is left to tell. */
    const d2 = await draft(cust.accountId);
    expect((await recipientFor({ accountId: cust.accountId, buyer: d2.buyer }))?.email).toBe(cust.email);
    await db(() => platformPrisma.user.update({ where: { id: cust.userId }, data: { isActive: false } }));
    expect(await recipientFor({ accountId: cust.accountId, buyer: d2.buyer })).toBeNull();
  }, 120_000);

  it('issues all the same when there is no one to email, and says so', async () => {
    const cust = await company('mailnone');
    const d = await draft(cust.accountId, { buyer: { name: 'No Address Co', state: 'Karnataka', email: '' } });
    await db(() => platformPrisma.user.update({ where: { id: cust.userId }, data: { isActive: false } }));
    const r = await issue(d.id, { email: true });
    expect(r).toMatchObject({ status: 'ISSUED', emailed: false, emailError: 'Add the customer’s email to the invoice first.', emailTo: null, sentTo: null });
    expect(r.number).toBeTruthy();
    expect(await mails(d.id)).toHaveLength(0);
    expect(await sends(d.id)).toHaveLength(0);
    for (const path of ['send', 'remind']) {
      const no = await request(app).post(`/api/ops/invoices/${d.id}/${path}`).set(fin.h).send({}).expect(409);
      expect(no.body.error).toBe('Add the customer’s email to the invoice first.');
    }
    expect(await sends(d.id)).toHaveLength(0);
  }, 120_000);
});

describe('paying online from the email', () => {
  it('carries the gateway’s link when one is on, and falls back to bank details when the link cannot be made', async () => {
    const cust = await company('maillink');
    const d = await draft(cust.accountId);
    __setGateway(fakeRazorpay());
    const r = await issue(d.id, { email: true });
    expect(r.emailed).toBe(true);
    const [m] = await mails(d.id);
    const inv = await db(() => platformPrisma.billingInvoice.findUniqueOrThrow({ where: { id: d.id } }));
    expect(inv.payLinkUrl).toMatch(/^https:\/\/rzp\.io\/i\/plink_mail/);
    expect(m.bodyText).toContain(`Pay online by card, UPI or netbanking: ${inv.payLinkUrl}`);
    expect(m.bodyText).toContain('Or pay by UPI to clor@okaxis');

    const other = await company('maillink');
    const d2 = await draft(other.accountId);
    __setGateway(fakeRazorpay(true));
    const r2 = await issue(d2.id, { email: true });
    expect(r2).toMatchObject({ status: 'ISSUED', emailed: true, emailedTo: other.email });
    const [m2] = await mails(d2.id);
    expect(m2.bodyText).not.toContain('Pay online');
    expect(m2.bodyText).toContain('Pay by UPI to clor@okaxis (CLOR Applications).');
  }, 120_000);
});

describe('sending again and reminding', () => {
  it('records each one, uses the overdue wording past the due date, and moves the reminder count', async () => {
    const cust = await company('mailagain');
    const d = await draft(cust.accountId);
    await issue(d.id, { email: true });
    await aMinuteLater(d.id);

    const again = (await request(app).post(`/api/ops/invoices/${d.id}/send`).set(fin.h).send({}).expect(200)).body;
    expect(again).toMatchObject({ emailed: true, emailedTo: cust.email, reminderCount: 0, send: { kind: 'RESEND', template: 'billing.invoice_issued', delivery: 'SENT' } });
    /* A second press straight away is refused, and sends nothing. */
    expect((await request(app).post(`/api/ops/invoices/${d.id}/send`).set(fin.h).send({}).expect(409)).body.error).toMatch(/a moment ago/);
    expect(await mails(d.id)).toHaveLength(2);

    const before = (await request(app).post(`/api/ops/invoices/${d.id}/remind`).set(fin.h).send({}).expect(200)).body;
    expect(before).toMatchObject({ emailed: true, reminderCount: 1, send: { kind: 'REMINDER', template: 'billing.invoice_reminder' } });
    expect(before.lastRemindedAt).toBeTruthy();
    expect((await lastAudit(fin.userId, 'INVOICE_REMINDER_SENT'))?.detail).toMatchObject({ invoiceId: d.id, kind: 'REMINDER', template: 'billing.invoice_reminder' });

    /* Three days past the due date. */
    await aMinuteLater(d.id);
    await db(() => platformPrisma.billingInvoice.update({ where: { id: d.id }, data: { dueDate: new Date(Date.now() - 3 * 86_400_000) } }));
    const late = (await request(app).post(`/api/ops/invoices/${d.id}/remind`).set(fin.h).send({}).expect(200)).body;
    expect(late).toMatchObject({ overdue: true, reminderCount: 2, send: { kind: 'REMINDER', template: 'billing.invoice_overdue' } });

    const out = await mails(d.id);
    expect(out.map((m) => m.templateKey)).toEqual(['billing.invoice_issued', 'billing.invoice_issued', 'billing.invoice_reminder', 'billing.invoice_overdue']);
    expect(out[3].subject).toBe(`CLOR invoice ${late.number} is overdue`);
    expect(out[3].bodyText).toContain('is 3 days overdue');
    expect(out[3].bodyText).toContain('Pay by UPI to clor@okaxis');

    const rows = await sends(d.id);
    expect(rows.map((s) => s.kind).sort()).toEqual(['ISSUED', 'REMINDER', 'REMINDER', 'RESEND']);
    /* By hand, each has its own key: its own id. */
    for (const s of rows.filter((x) => x.kind !== 'ISSUED')) expect(s.dedupeKey).toBe(s.id);
    const hist = (await request(app).get(`/api/ops/invoices/${d.id}/sends`).set(fin.h).expect(200)).body;
    expect(hist).toMatchObject({ reminderCount: 2, remindersOff: false });
    expect(hist.sends).toHaveLength(4);
    expect(hist.sends[0]).toMatchObject({ kind: 'REMINDER', template: 'billing.invoice_overdue', sentByUserId: fin.userId });

    /* An automatic step goes once; with reminders off for the invoice it does not go at all. */
    expect(await sendInvoiceEmail(d.id, { kind: 'REMINDER', step: 'after:7', auto: true })).toMatchObject({ sent: true });
    expect(await sendInvoiceEmail(d.id, { kind: 'REMINDER', step: 'after:7', auto: true })).toMatchObject({ sent: false, skipped: 'ALREADY_SENT' });
    await db(() => platformPrisma.billingInvoice.update({ where: { id: d.id }, data: { remindersOff: true } }));
    expect(await sendInvoiceEmail(d.id, { kind: 'REMINDER', step: 'after:14', auto: true })).toMatchObject({ sent: false, skipped: 'REMINDERS_OFF' });
    expect(await mails(d.id)).toHaveLength(5);
    expect((await db(() => platformPrisma.billingInvoice.findUniqueOrThrow({ where: { id: d.id } }))).reminderCount).toBe(3);
  }, 120_000);

  it('is refused for a draft, a paid invoice and a cancelled one', async () => {
    const cust = await company('mailstate');
    const d = await draft(cust.accountId);
    for (const path of ['send', 'remind']) expect((await request(app).post(`/api/ops/invoices/${d.id}/${path}`).set(fin.h).send({}).expect(409)).body.error).toMatch(/Issue the invoice first/);

    await issue(d.id, { email: false });
    await request(app).post(`/api/ops/invoices/${d.id}/mark-paid`).set(fin.h).send({ reference: 'UTR123456789', paidOn: new Date().toISOString().slice(0, 10) }).expect(200);
    for (const path of ['send', 'remind']) expect((await request(app).post(`/api/ops/invoices/${d.id}/${path}`).set(fin.h).send({}).expect(409)).body.error).toMatch(/is paid/);

    const v = await draft(cust.accountId);
    await issue(v.id, { email: false });
    await request(app).post(`/api/ops/invoices/${v.id}/void`).set(fin.h).send({ reason: 'Raised by mistake' }).expect(200);
    for (const path of ['send', 'remind']) expect((await request(app).post(`/api/ops/invoices/${v.id}/${path}`).set(fin.h).send({}).expect(409)).body.error).toMatch(/cancelled/);
    await expect(sendInvoiceEmail(v.id, { kind: 'REMINDER', step: 'due', auto: true })).rejects.toMatchObject({ status: 409 });

    for (const id of [d.id, v.id]) {
      expect(await mails(id)).toHaveLength(0);
      expect(await sends(id)).toHaveLength(0);
    }
    await request(app).post('/api/ops/invoices/nope/remind').set(fin.h).send({}).expect(404);
  }, 120_000);

  it('is for Finance with a fresh code; anyone on staff may read the history', async () => {
    const cust = await company('mailrole');
    const d = await draft(cust.accountId);
    await issue(d.id, { email: false });
    const support = await staff('SUPPORT');
    const reader = await staff('READ_ONLY');
    for (const path of ['send', 'remind']) {
      expect((await request(app).post(`/api/ops/invoices/${d.id}/${path}`).set(support.h).send({}).expect(403)).body.code).toBe('OPERATOR_ROLE');
      expect((await request(app).post(`/api/ops/invoices/${d.id}/${path}`).set(reader.h).send({}).expect(403)).body.code).toBe('OPERATOR_ROLE');
      expect((await request(app).post(`/api/ops/invoices/${d.id}/${path}`).set(bearer(fin)).send({}).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
      expect((await request(app).post(`/api/ops/invoices/${d.id}/${path}`).set(bearer(cust)).send({}).expect(403)).body.code).toBe('OPERATOR_ONLY');
    }
    const d2 = await draft(cust.accountId);
    expect((await request(app).post(`/api/ops/invoices/${d2.id}/issue`).set(support.h).send({}).expect(403)).body.code).toBe('OPERATOR_ROLE');
    await request(app).get(`/api/ops/invoices/${d.id}/sends`).set(reader.h).expect(200);
    await request(app).get(`/api/ops/invoices/${d.id}/sends`).set(bearer(cust)).expect(403);
    expect(await mails(d.id)).toHaveLength(0);
  }, 120_000);
});

describe('renewal invoices', () => {
  it('are on the record as the first email, so a copy can be sent after', async () => {
    const cust = await company('mailrenew');
    await db(() => platformPrisma.subscription.update({ where: { accountId: cust.accountId }, data: { status: 'active', billingInterval: 'month', currentPeriodEnd: new Date(Date.now() + 3 * 86_400_000), planName: 'Growth', listAmount: 200000, periodAmount: 200000 } }));
    const run = await runRenewals(new Date(), [cust.accountId]);
    expect(run).toMatchObject({ issued: 1, failed: [] });
    const inv = await db(() => platformPrisma.billingInvoice.findFirstOrThrow({ where: { accountId: cust.accountId, source: 'RENEWAL' } }));
    const rows = await sends(inv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'ISSUED', step: 'renewal', auto: true, toEmail: cust.email, dedupeKey: `${inv.id}:issued`, sentByUserId: null });
    const out = await mails(inv.id);
    expect(out.map((m) => m.templateKey)).toEqual(['billing.renewal_invoice']);
    expect(rows[0].outboxId).toBe(out[0].id);
    /* The first email is not sent a second time; a copy by hand is. */
    expect(await sendInvoiceEmail(inv.id, { kind: 'ISSUED', userId: fin.userId })).toMatchObject({ sent: false, skipped: 'ALREADY_SENT' });
    await request(app).post(`/api/ops/invoices/${inv.id}/send`).set(fin.h).send({}).expect(200);
    expect((await mails(inv.id)).map((m) => m.templateKey)).toEqual(['billing.renewal_invoice', 'billing.invoice_issued']);
  }, 120_000);
});
