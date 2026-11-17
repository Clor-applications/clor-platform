import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Automatic reminders to pay an invoice (billing/invoiceReminders.ts). They
 * write to customers, so what is proved here is mostly what is NOT sent: off
 * until switched on, nothing issued before the first switch-on, one mail per
 * step however many runs, nothing for an invoice that is not issued and
 * unpaid, nothing at night. Mail is captured in the outbox: none leaves the
 * machine.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { clearProviderCache } = await import('../billing/providers.js');
const { INVOICING_KEY, readInvoicing, readReminders } = await import('../billing/invoicing.js');
const { dueStep, inSendingHours, runInvoiceReminders, reminderForecast } = await import('../billing/invoiceReminders.js');
const { sendInvoiceEmail } = await import('../billing/invoiceEmail.js');
const { deliver } = await import('../services/mailer.js');
const { opsKit, lastAudit, bearer } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: invoice reminders', fn);
type Staff = Awaited<ReturnType<typeof staff>>;
let fin: Staff;

const DAY = 86_400_000;
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
/** Today in India at this time of day. */
const at = (hhmm: string) => new Date(`${istDay(new Date())}T${hhmm}:00+05:30`);
const NOON = at('12:00');

/** The reminders part of the setting, written straight to the row (null: as if never set). */
async function setReminders(reminders: Record<string, unknown> | null) {
  await db(async () => {
    const row = await platformPrisma.platformSetting.findUnique({ where: { key: INVOICING_KEY } });
    const value = { ...((row?.value as Record<string, unknown>) || {}) };
    if (reminders) value.reminders = reminders;
    else delete value.reminders;
    await platformPrisma.platformSetting.upsert({ where: { key: INVOICING_KEY }, create: { key: INVOICING_KEY, value: value as any }, update: { value: value as any } });
  });
}
const saved = async () => readInvoicing((await db(() => platformPrisma.platformSetting.findUnique({ where: { key: INVOICING_KEY } })))?.value).reminders;
/** On, first switched on long ago, with this schedule. */
const on = (over: Record<string, unknown> = {}) => setReminders({ on: true, daysBefore: [3], onDueDate: true, daysAfter: [7], cap: 3, since: new Date(NOON.getTime() - 90 * DAY).toISOString(), ...over });
const put = (body: Record<string, unknown>, who = fin) => request(app).put('/api/ops/invoicing').set(who.h).send(body);
const settings = async () => (await request(app).get('/api/ops/invoicing').set(fin.h).expect(200)).body;

beforeAll(async () => {
  await db(() => platformPrisma.paymentProvider.deleteMany({}));
  clearProviderCache();
  fin = await staff('BILLING');
  await request(app)
    .put('/api/ops/payments/providers/manual')
    .set(fin.h)
    .send({ enabled: true, manual: { upiId: 'clor@okaxis', payeeName: 'CLOR Applications' } })
    .expect(200);
  await setReminders(null);
}, 120_000);
afterAll(async () => {
  /* Left off, as it is for every other test file. */
  await setReminders(null);
  await db(() => platformPrisma.paymentProvider.deleteMany({}));
  clearProviderCache();
  await new Promise((done) => app.close(done));
});

const LINES = [{ description: 'CLOR People, 25 users', appCode: 'people', quantity: 25, unitAmount: 9900 }];
const draft = async (accountId: string) => (await request(app).post('/api/ops/invoices').set(fin.h).send({ accountId, lines: LINES, months: 1 }).expect(201)).body;
/** An issued invoice (not emailed), due `dueIn` days from today and issued `issuedAgo` days ago. */
async function issued(accountId: string, dueIn: number, issuedAgo = 30) {
  const d = await draft(accountId);
  await request(app).post(`/api/ops/invoices/${d.id}/issue`).set(fin.h).send({ email: false }).expect(200);
  await place(d.id, dueIn, issuedAgo);
  return d.id as string;
}
const place = (id: string, dueIn: number, issuedAgo = 30) =>
  db(() => platformPrisma.billingInvoice.update({ where: { id }, data: { dueDate: new Date(NOON.getTime() + dueIn * DAY), issueDate: new Date(NOON.getTime() - issuedAgo * DAY) } }));
const mails = (invoiceId: string) => db(() => platformPrisma.emailOutbox.findMany({ where: { relatedType: 'BillingInvoice', relatedId: invoiceId }, orderBy: { createdAt: 'asc' } }));
const sends = (invoiceId: string) => db(() => platformPrisma.billingInvoiceSend.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } }));
const invoice = (id: string) => db(() => platformPrisma.billingInvoice.findUniqueOrThrow({ where: { id } }));

describe('the step for today', () => {
  const S = { daysBefore: [3], onDueDate: true, daysAfter: [7] };
  const inv = (dueIn: number, issuedAgo = 30) => ({ dueDate: new Date(NOON.getTime() + dueIn * DAY), issueDate: new Date(NOON.getTime() - issuedAgo * DAY) });

  it('is the step whose India day it is, one day late at most, and nothing in between', () => {
    expect(dueStep(inv(4), S, NOON)).toBeNull();
    expect(dueStep(inv(3), S, NOON)).toBe('before:3');
    expect(dueStep(inv(2), S, NOON)).toBe('before:3'); // missed yesterday: still sent
    expect(dueStep(inv(1), S, NOON)).toBeNull();
    expect(dueStep(inv(0), S, NOON)).toBe('due');
    expect(dueStep(inv(-1), S, NOON)).toBe('due');
    expect(dueStep(inv(-2), S, NOON)).toBeNull();
    expect(dueStep(inv(-6), S, NOON)).toBeNull();
    expect(dueStep(inv(-7), S, NOON)).toBe('after:7');
    expect(dueStep(inv(-8), S, NOON)).toBe('after:7');
    expect(dueStep(inv(-9), S, NOON)).toBeNull();
    expect(dueStep(inv(-200), S, NOON)).toBeNull();
    expect(dueStep({ dueDate: null, issueDate: NOON }, S, NOON)).toBeNull();
    expect(dueStep({ dueDate: NOON, issueDate: null }, S, NOON)).toBeNull();
    expect(dueStep(inv(0), { ...S, onDueDate: false }, NOON)).toBeNull();
    expect(dueStep(inv(3), { ...S, daysBefore: [] }, NOON)).toBeNull();
  });

  it('counts days in India, not in UTC', () => {
    /* Due at 00:30 on the 10th in India is still the 9th in UTC. */
    const due = { dueDate: new Date('2026-12-09T19:00:00.000Z'), issueDate: new Date('2026-11-01T00:00:00.000Z') };
    expect(dueStep(due, S, new Date('2026-12-10T04:00:00.000Z'))).toBe('due'); // 09:30 on the 10th in India
    expect(dueStep(due, S, new Date('2026-12-09T05:00:00.000Z'))).toBeNull(); // the 9th in India: the day before
    expect(dueStep(due, S, new Date('2026-12-07T05:00:00.000Z'))).toBe('before:3');
  });

  it('is the later one when two apply', () => {
    expect(dueStep(inv(2), { ...S, daysBefore: [3, 2] }, NOON)).toBe('before:2');
    expect(dueStep(inv(-7), { ...S, daysAfter: [6, 7] }, NOON)).toBe('after:7');
    expect(dueStep(inv(0), { ...S, daysBefore: [1] }, NOON)).toBe('due');
  });

  it('is never a step dated the day the invoice was issued, or before it', () => {
    expect(dueStep(inv(0, 0), S, NOON)).toBeNull(); // issued today, due today
    expect(dueStep(inv(2, 0), S, NOON)).toBeNull(); // before:3 would have been yesterday, before it existed
    expect(dueStep(inv(3, 0), S, NOON)).toBeNull();
    expect(dueStep(inv(3, 1), S, NOON)).toBe('before:3');
  });

  it('sends only from 09:00 up to 19:00 in India', () => {
    expect(inSendingHours(at('08:59'))).toBe(false);
    expect(inSendingHours(at('09:00'))).toBe(true);
    expect(inSendingHours(at('18:59'))).toBe(true);
    expect(inSendingHours(at('19:00'))).toBe(false);
    expect(inSendingHours(at('02:00'))).toBe(false);
  });
});

describe('off until a person switches it on', () => {
  it('sends nothing by default, even with overdue invoices, and anything but exactly true is off', async () => {
    const cust = await company('remoff');
    const id = await issued(cust.accountId, -7);
    const s = await settings();
    expect(s.reminders).toEqual({ on: false, daysBefore: [3], onDueDate: true, daysAfter: [7], cap: 3, since: null });
    expect(s).toMatchObject({ wouldRemindToday: 0, wouldRemindIfOn: 0 });
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toEqual({ sent: 0, skipped: 0, failed: 0, why: 'OFF' });

    for (const bad of ['true', 1, 'yes', {}, null]) {
      await setReminders({ on: bad, since: new Date(NOON.getTime() - 90 * DAY).toISOString() });
      expect(readReminders({ on: bad }).on).toBe(false);
      expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 0, why: 'OFF' });
    }
    /* On, but with no record of when it was first switched on: nothing either. */
    await setReminders({ on: true });
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 0, why: 'OFF' });
    expect(await mails(id)).toHaveLength(0);
    expect(await sends(id)).toHaveLength(0);
    await setReminders(null);
  }, 120_000);

  it('stamps the first switch-on once, and never reminds an invoice issued before it', async () => {
    const cust = await company('remsince');
    const old = await issued(cust.accountId, -7, 20);
    await setReminders(null);

    /* Changing the schedule while off stamps nothing. */
    await put({ reminderDaysAfter: [7, 14] }).expect(200);
    expect(await saved()).toMatchObject({ on: false, daysAfter: [7, 14], since: null });

    const before = Date.now();
    await put({ remindersOn: true }).expect(200);
    const first = (await saved()).since!;
    expect(Date.parse(first)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(first)).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await lastAudit(fin.userId, 'INVOICE_SETTINGS_CHANGED'))?.detail).toMatchObject({ remindersOn: true, remindersSince: first });

    /* Off, on again, and other changes: the time does not move. */
    await put({ remindersOn: false }).expect(200);
    expect(await saved()).toMatchObject({ on: false, since: first });
    await put({ remindersOn: true, reminderCap: 4 }).expect(200);
    await put({ reminderDaysAfter: [7] }).expect(200);
    expect(await saved()).toEqual({ on: true, daysBefore: [3], onDueDate: true, daysAfter: [7], cap: 4, since: first });
    /* Saving something else leaves reminders as they are. */
    await put({ dueDays: 15 }).expect(200);
    expect(await saved()).toMatchObject({ on: true, since: first });

    /* Overdue by exactly the step, but issued before the switch: never. */
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(await mails(old)).toHaveLength(0);
    /* One issued after it is. */
    const fresh = await issued(cust.accountId, -7, 0);
    await db(() => platformPrisma.billingInvoice.update({ where: { id: fresh }, data: { issueDate: new Date(Date.parse(first) + 1000) } }));
    /* Its step is dated before its issue day, so move the due date: due today, issued a moment after the switch. */
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 0 });
    await setReminders({ ...(await saved()), since: new Date(NOON.getTime() - 10 * DAY).toISOString() });
    await place(fresh, -7, 9);
    await place(old, -7, 11);
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 1 });
    expect(await mails(fresh)).toHaveLength(1);
    expect(await mails(old)).toHaveLength(0);
  }, 120_000);
});

describe('a run', () => {
  it('sends each step on its day, once, with the overdue wording after the due date', async () => {
    await on({ cap: 6 });
    const cust = await company('remsteps');
    const id = await issued(cust.accountId, 5);
    const run = () => runInvoiceReminders(NOON, [cust.accountId]);
    expect(await run()).toEqual({ sent: 0, skipped: 0, failed: 0 });

    await place(id, 3);
    expect(await run()).toMatchObject({ sent: 1, failed: 0 });
    expect(await run()).toMatchObject({ sent: 0 });
    await place(id, 2); // the next day: the same step is not sent again
    expect(await run()).toMatchObject({ sent: 0 });
    await place(id, 1);
    expect(await run()).toMatchObject({ sent: 0 });

    await place(id, 0);
    expect(await run()).toMatchObject({ sent: 1 });
    expect(await run()).toMatchObject({ sent: 0 });
    await place(id, -3);
    expect(await run()).toMatchObject({ sent: 0 });

    await place(id, -7);
    expect(await run()).toMatchObject({ sent: 1 });
    expect(await run()).toMatchObject({ sent: 0 });
    await place(id, -8);
    expect(await run()).toMatchObject({ sent: 0 });
    await place(id, -30);
    expect(await run()).toMatchObject({ sent: 0 });

    const rows = await sends(id);
    expect(rows.map((r) => r.step)).toEqual(['before:3', 'due', 'after:7']);
    for (const r of rows) expect(r).toMatchObject({ kind: 'REMINDER', auto: true, sentByUserId: null, toEmail: cust.email, dedupeKey: `${id}:auto:${r.step}` });
    const out = await mails(id);
    expect(out.map((m) => m.templateKey)).toEqual(['billing.invoice_reminder', 'billing.invoice_reminder', 'billing.invoice_overdue']);
    expect(out.every((m) => m.status === 'SENT' && m.toEmail === cust.email)).toBe(true);
    expect(await invoice(id)).toMatchObject({ reminderCount: 3, status: 'ISSUED' });
    expect((await invoice(id)).lastRemindedAt).toBeTruthy();
  }, 120_000);

  it('sends one mail when two runs go at once', async () => {
    await on();
    const cust = await company('remrace');
    const id = await issued(cust.accountId, 0);
    const both = await Promise.all([runInvoiceReminders(NOON, [cust.accountId]), runInvoiceReminders(NOON, [cust.accountId])]);
    expect(both.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(both.reduce((n, r) => n + r.failed, 0)).toBe(0);
    expect(await mails(id)).toHaveLength(1);
    expect(await sends(id)).toHaveLength(1);
    expect((await invoice(id)).reminderCount).toBe(1);
    /* And the sender itself, asked twice at once for the same step. */
    const id2 = await issued(cust.accountId, 0);
    const twice = await Promise.all([1, 2, 3].map(() => sendInvoiceEmail(id2, { kind: 'REMINDER', step: 'due', auto: true, userId: null })));
    expect(twice.filter((r) => r.sent)).toHaveLength(1);
    expect(await mails(id2)).toHaveLength(1);
  }, 120_000);

  it('sends nothing for a draft, a paid or cancelled invoice, one with reminders off, a suspended account, one at the cap, or one with no due date', async () => {
    await on();
    const cust = await company('remnot');
    const today = { dueDate: NOON, issueDate: new Date(NOON.getTime() - 30 * DAY) };

    const d = (await draft(cust.accountId)).id;
    await db(() => platformPrisma.billingInvoice.update({ where: { id: d }, data: today }));
    const paid = await issued(cust.accountId, 0);
    await request(app).post(`/api/ops/invoices/${paid}/mark-paid`).set(fin.h).send({ reference: `UTR${Date.now()}`, paidOn: istDay(new Date()) }).expect(200);
    const gone = await issued(cust.accountId, 0);
    await request(app).post(`/api/ops/invoices/${gone}/void`).set(fin.h).send({ reason: 'Raised by mistake' }).expect(200);
    const off = await issued(cust.accountId, 0);
    await db(() => platformPrisma.billingInvoice.update({ where: { id: off }, data: { remindersOff: true } }));
    const capped = await issued(cust.accountId, 0);
    await db(() => platformPrisma.billingInvoice.update({ where: { id: capped }, data: { reminderCount: 3 } }));
    const undated = await issued(cust.accountId, 0);
    await db(() => platformPrisma.billingInvoice.update({ where: { id: undated }, data: { dueDate: null } }));

    expect(await runInvoiceReminders(NOON, [cust.accountId])).toEqual({ sent: 0, skipped: 0, failed: 0 });
    for (const id of [d, paid, gone, off, capped, undated]) {
      expect(await mails(id)).toHaveLength(0);
      expect(await sends(id)).toHaveLength(0);
    }

    /* A suspended account: nothing while it is suspended, and the reminder goes once it is not. */
    const held = await company('remheld');
    const h = await issued(held.accountId, 0);
    await db(() => platformPrisma.account.update({ where: { id: held.accountId }, data: { suspendedAt: new Date(), suspendedReason: 'test' } }));
    expect(await runInvoiceReminders(NOON, [held.accountId])).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(await mails(h)).toHaveLength(0);
    await db(() => platformPrisma.account.update({ where: { id: held.accountId }, data: { suspendedAt: null, suspendedReason: null } }));
    expect(await runInvoiceReminders(NOON, [held.accountId])).toMatchObject({ sent: 1 });

    /* One below the cap goes; that takes it to the cap, and nothing follows. */
    await db(() => platformPrisma.billingInvoice.update({ where: { id: capped }, data: { reminderCount: 2 } }));
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 1 });
    expect((await invoice(capped)).reminderCount).toBe(3);
    await place(capped, -7);
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 0 });
    expect(await mails(capped)).toHaveLength(1);
  }, 120_000);

  it('sends nothing outside 09:00 to 19:00 in India, and one failure does not stop the rest', async () => {
    await on();
    const cust = await company('remnight');
    const id = await issued(cust.accountId, 0);
    for (const t of ['08:59', '19:00', '23:30', '03:00']) expect(await runInvoiceReminders(at(t), [cust.accountId])).toEqual({ sent: 0, skipped: 0, failed: 0, why: 'OUTSIDE_HOURS' });
    expect(await mails(id)).toHaveLength(0);

    /* No one to write to on the first; the second still goes. */
    const mute = await company('remmute');
    const m = await issued(mute.accountId, 0);
    await db(() => platformPrisma.user.update({ where: { id: mute.userId }, data: { isActive: false } }));
    await db(() => platformPrisma.billingInvoice.update({ where: { id: m }, data: { dueDate: new Date(NOON.getTime() - 3600_000) } }));
    expect(await runInvoiceReminders(at('09:00'), [mute.accountId, cust.accountId])).toEqual({ sent: 1, skipped: 1, failed: 0 });
    expect(await mails(m)).toHaveLength(0);
    expect(await sends(m)).toHaveLength(0);
    expect(await mails(id)).toHaveLength(1);
  }, 120_000);

  it('sends the later step when two apply, and never an earlier one after a later', async () => {
    await on({ daysBefore: [3, 2], daysAfter: [7] });
    const cust = await company('remlater');
    const id = await issued(cust.accountId, 2);
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 1 });
    expect((await sends(id)).map((s) => s.step)).toEqual(['before:2']);
    /* The schedule changes so that an earlier step falls today: it is not sent after the later one. */
    await on({ daysBefore: [3, 2, 1], daysAfter: [7] });
    await place(id, 3);
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 0 });
    await place(id, -7);
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 1 });
    await on({ daysBefore: [], onDueDate: true, daysAfter: [3] });
    await place(id, -3);
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 0 });
    await place(id, 0);
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 0 });
    expect((await sends(id)).map((s) => s.step)).toEqual(['before:2', 'after:7']);
  }, 120_000);

  it('includes renewal invoices', async () => {
    await on();
    const cust = await company('remrenew');
    const id = await issued(cust.accountId, 0);
    await db(() => platformPrisma.billingInvoice.update({ where: { id }, data: { source: 'RENEWAL', renewalFor: '2026-12-01' } }));
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 1 });
  }, 120_000);
});

describe('invoice settings', () => {
  it('refuses values out of range with a sentence, and changes nothing', async () => {
    await setReminders(null);
    const was = await saved();
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ reminderDaysBefore: [0] }, /before the due date/],
      [{ reminderDaysBefore: [31] }, /before the due date/],
      [{ reminderDaysBefore: [1, 2, 3, 4] }, /before the due date: at most 3/],
      [{ reminderDaysBefore: [2, 2] }, /no day twice/],
      [{ reminderDaysBefore: [1.5] }, /whole number/],
      [{ reminderDaysAfter: [61] }, /after the due date/],
      [{ reminderDaysAfter: [1, 2, 3, 4, 5] }, /after the due date: at most 4/],
      [{ reminderDaysAfter: [-7] }, /after the due date/],
      [{ reminderCap: 0 }, /at most 1 to 6 reminders/],
      [{ reminderCap: 7 }, /at most 1 to 6 reminders/],
      [{ reminderCap: 2.5 }, /at most 1 to 6 reminders/],
    ];
    for (const [body, say] of cases) {
      const r = await put({ remindersOn: true, ...body }).expect(400);
      expect(r.body.error).toBe('Check the invoice settings.');
      expect(r.body.problems.join(' ')).toMatch(say);
    }
    /* The wrong kind of value altogether. */
    await put({ remindersOn: 'yes' }).expect(400);
    await put({ reminderDaysBefore: '3' }).expect(400);
    await put({ reminderOnDueDate: 1 }).expect(400);
    /* None of them switched it on. */
    expect(await saved()).toEqual(was);
    expect(was.on).toBe(false);

    await put({ reminderDaysBefore: [1, 7, 3], reminderOnDueDate: false, reminderDaysAfter: [30, 3, 14, 7], reminderCap: 6 }).expect(200);
    expect(await saved()).toEqual({ on: false, daysBefore: [7, 3, 1], onDueDate: false, daysAfter: [3, 7, 14, 30], cap: 6, since: null });
    await put({ reminderDaysBefore: [], reminderDaysAfter: [] }).expect(200);
    expect(await saved()).toMatchObject({ daysBefore: [], daysAfter: [] });
    /* What is stored wrongly reads as the default, never as more mail. */
    expect(readReminders({ on: true, daysBefore: [99], daysAfter: 'x', cap: 50, since: 'never' })).toEqual({ on: true, daysBefore: [3], onDueDate: true, daysAfter: [7], cap: 3, since: null });
    await setReminders(null);
  }, 120_000);

  it('is for Finance with a fresh code', async () => {
    const support = await staff('SUPPORT');
    expect((await put({ remindersOn: true }, support).expect(403)).body.code).toBe('OPERATOR_ROLE');
    expect((await request(app).put('/api/ops/invoicing').set(bearer(fin)).send({ remindersOn: true }).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    expect((await saved()).on).toBe(false);
  }, 120_000);

  it('says how many invoices would be reminded today, as saved and if it were on', async () => {
    const since = new Date(NOON.getTime() - 90 * DAY).toISOString();
    const off = { on: false, daysBefore: [3], onDueDate: true, daysAfter: [7], cap: 3, since };
    await setReminders(off);
    const base = (await reminderForecast(readReminders(off))).wouldRemindIfOn;
    const cust = await company('remcount');
    const a = await issued(cust.accountId, 0);
    await issued(cust.accountId, 3);
    await issued(cust.accountId, -7);
    await issued(cust.accountId, 5); // no step today
    const stopped = await issued(cust.accountId, 0);
    await db(() => platformPrisma.billingInvoice.update({ where: { id: stopped }, data: { remindersOff: true } }));

    expect(await settings()).toMatchObject({ reminders: off, wouldRemindToday: 0, wouldRemindIfOn: base + 3 });
    await setReminders({ ...off, on: true });
    expect(await settings()).toMatchObject({ wouldRemindToday: base + 3, wouldRemindIfOn: base + 3 });
    /* Once one has gone, it is no longer counted. */
    await sendInvoiceEmail(a, { kind: 'REMINDER', step: 'due', auto: true, userId: null });
    expect(await settings()).toMatchObject({ wouldRemindToday: base + 2, wouldRemindIfOn: base + 2 });
    /* Never switched on: nothing issued so far would be reminded, so the count is 0. */
    await setReminders({ ...off, since: null });
    expect(await settings()).toMatchObject({ wouldRemindToday: 0, wouldRemindIfOn: 0 });
  }, 120_000);
});

describe('reminders for one invoice', () => {
  it('are stopped and started again by Finance, on the log, and a reminder by hand still goes', async () => {
    await on();
    const cust = await company('remone');
    const id = await issued(cust.accountId, 0);
    const post = (who: { h: Record<string, string> }, body: unknown) => request(app).post(`/api/ops/invoices/${id}/reminders`).set(who.h).send(body as any);

    const r = (await post(fin, { off: true }).expect(200)).body;
    expect(r).toMatchObject({ id, status: 'ISSUED', remindersOff: true, reminderCount: 0, emailTo: cust.email, account: { id: cust.accountId } });
    expect((await lastAudit(fin.userId, 'INVOICE_REMINDERS_STOPPED'))?.detail).toMatchObject({ invoiceId: id, off: true });
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(await mails(id)).toHaveLength(0);
    /* By hand it still goes. */
    await request(app).post(`/api/ops/invoices/${id}/remind`).set(fin.h).send({}).expect(200);
    expect(await mails(id)).toHaveLength(1);

    expect((await post(fin, { off: false }).expect(200)).body).toMatchObject({ remindersOff: false, reminderCount: 1 });
    expect((await lastAudit(fin.userId, 'INVOICE_REMINDERS_RESUMED'))?.detail).toMatchObject({ invoiceId: id, off: false });
    expect(await runInvoiceReminders(NOON, [cust.accountId])).toMatchObject({ sent: 1 });
    expect(await mails(id)).toHaveLength(2);

    for (const bad of [{}, { off: 'yes' }, { off: 1 }, { off: true, also: 1 }]) await post(fin, bad).expect(400);
    await request(app).post('/api/ops/invoices/nope/reminders').set(fin.h).send({ off: true }).expect(404);

    const support = await staff('SUPPORT');
    const reader = await staff('READ_ONLY');
    expect((await post(support, { off: true }).expect(403)).body.code).toBe('OPERATOR_ROLE');
    expect((await post(reader, { off: true }).expect(403)).body.code).toBe('OPERATOR_ROLE');
    expect((await post({ h: bearer(fin) }, { off: true }).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    expect((await post({ h: bearer(cust) }, { off: true }).expect(403)).body.code).toBe('OPERATOR_ONLY');
    expect((await invoice(id)).remindersOff).toBe(false);
  }, 120_000);
});

describe('a reminder the mail server refused', () => {
  /** A reminder left as the outbox leaves one it will try again. */
  async function refusedReminder(accountId: string) {
    const id = await issued(accountId, -7);
    const r = await sendInvoiceEmail(id, { kind: 'REMINDER', step: 'after:7', auto: true, userId: null });
    if (!r.sent) throw new Error('not sent');
    await db(() => platformPrisma.emailOutbox.update({ where: { id: r.outboxId! }, data: { status: 'FAILED', sentAt: null, attempts: 1, lastError: 'connect ETIMEDOUT', nextAttemptAt: new Date(Date.now() - 1000) } }));
    return { id, outboxId: r.outboxId! };
  }
  const outbox = (id: string) => db(() => platformPrisma.emailOutbox.findUniqueOrThrow({ where: { id } }));

  it('is not tried again once the invoice is paid or cancelled; one already sent is left as it was', async () => {
    await on();
    const cust = await company('remcancel');
    const a = await refusedReminder(cust.accountId);
    const sentBefore = await issued(cust.accountId, -7);
    await sendInvoiceEmail(sentBefore, { kind: 'REMINDER', step: 'after:7', auto: true, userId: null });

    await request(app).post(`/api/ops/invoices/${a.id}/mark-paid`).set(fin.h).send({ reference: `UTR${Date.now()}A`, paidOn: istDay(new Date()) }).expect(200);
    expect(await outbox(a.outboxId)).toMatchObject({ status: 'SUPPRESSED', nextAttemptAt: null, lastError: 'Not sent: the invoice was paid before this email went.' });
    /* The retry job's own way of sending it finds nothing to send. */
    expect((await db(() => deliver(a.outboxId)))?.status).toBe('SUPPRESSED');
    expect((await outbox(a.outboxId)).sentAt).toBeNull();

    const b = await refusedReminder(cust.accountId);
    await request(app).post(`/api/ops/invoices/${b.id}/void`).set(fin.h).send({ reason: 'Raised by mistake' }).expect(200);
    expect(await outbox(b.outboxId)).toMatchObject({ status: 'SUPPRESSED', lastError: 'Not sent: the invoice was cancelled before this email went.' });
    expect((await db(() => deliver(b.outboxId)))?.status).toBe('SUPPRESSED');

    await request(app).post(`/api/ops/invoices/${sentBefore}/mark-paid`).set(fin.h).send({ reference: `UTR${Date.now()}B`, paidOn: istDay(new Date()) }).expect(200);
    expect((await mails(sentBefore)).map((m) => m.status)).toEqual(['SENT']);
  }, 120_000);
});
