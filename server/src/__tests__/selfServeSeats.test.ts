import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Seats a customer adds to their own plan (billing/selfServe.ts): off until
 * staff switch it on; on at once with a prorated invoice due in 14 days; paid,
 * they stay and the paid period does not move; unpaid by then, that invoice is
 * cancelled and those seats alone come off; staff can take them back; and the
 * guards (trial, flat plan, overdue, one open addition, a cap, a moved price).
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { boughtSeats } = await import('../services/entitlements.js');
const { prorate, lapseDue, SELF_SERVE_KEY } = await import('../billing/selfServe.js');
const { markInvoicePaid } = await import('../billing/invoices.js');
const { applyGatewayEvent } = await import('../billing/events.js');
const { opsKit, at, lastAudit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: self-serve seats', fn);
type Ctx = Awaited<ReturnType<typeof company>>;
type Staff = Awaited<ReturnType<typeof staff>>;
let fin: Staff;

const DAY = 86_400_000;
/** Midnight UTC of the Indian date `days` from today, as currentPeriodEnd is kept. */
const istMidnight = (days: number) => new Date(`${new Date(Date.now() + 330 * 60_000 + days * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);

beforeAll(async () => {
  await db(() => platformPrisma.platformSetting.deleteMany({ where: { key: SELF_SERVE_KEY } }));
  fin = await staff('BILLING');
}, 120_000);
afterAll(async () => {
  await db(() => platformPrisma.platformSetting.deleteMany({ where: { key: SELF_SERVE_KEY } }));
  await new Promise((done) => app.close(done));
});

const switchOn = (body: Record<string, unknown> = { on: true }) => request(app).put('/api/ops/self-serve').set(fin.h).send(body);

/** An active monthly plan by the user: ₹1,000 for the first user, ₹500 each after; `users` bought. */
async function onPlan(c: Ctx, over: { unit?: string; users?: number; status?: string; endsIn?: number; interval?: string } = {}) {
  const unit = over.unit ?? 'USER';
  const plan = await db(() =>
    platformPrisma.customPlan.create({ data: { name: `Seats ${rnd()}`, apps: ['people'], unit, includedUnits: 1, monthlyPrice: 100000, monthlyExtra: 50000, yearlyPrice: 1000000, yearlyExtra: 500000, gstApplies: true, accountId: c.accountId, createdByUserId: fin.userId } }),
  );
  const users = over.users ?? 3;
  const per = (over.interval ?? 'month') === 'year' ? [1000000, 500000] : [100000, 50000];
  const amount = unit === 'COMPANY' ? per[0] : per[0] + per[1] * (users - 1);
  await db(() =>
    platformPrisma.subscription.update({
      where: { accountId: c.accountId },
      data: {
        status: over.status ?? 'active',
        billingInterval: over.interval ?? 'month',
        currentPeriodEnd: istMidnight(over.endsIn ?? 20),
        planSource: 'custom',
        planRef: plan.id,
        planName: plan.name,
        planUnit: unit,
        quantity: users,
        listAmount: amount,
        periodAmount: amount,
        cancelAtPeriodEnd: false,
      },
    }),
  );
  return plan;
}
const sub = (c: Ctx) => db(() => platformPrisma.subscription.findUniqueOrThrow({ where: { accountId: c.accountId } }));
const seats = (c: Ctx) => request(app).get('/api/billing/seats').set(at(c));
const quote = (c: Ctx, add: number) => request(app).get(`/api/billing/seats/quote?add=${add}`).set(at(c));
const add = (c: Ctx, n: number, total?: number) => request(app).post('/api/billing/seats').set(at(c)).send({ add: n, ...(total !== undefined ? { total } : {}) });
const change = (id: string) => db(() => platformPrisma.subscriptionChange.findUniqueOrThrow({ where: { id } }));
const invoice = (id: string) => db(() => platformPrisma.billingInvoice.findUniqueOrThrow({ where: { id } }));

describe('the share of a period that is left', () => {
  const at0 = new Date('2026-11-17T06:30:00.000Z'); // 17 Nov, noon in India
  it('charges the days left of this period, today included', () => {
    const p = prorate(30000, new Date('2026-12-02T00:00:00.000Z'), 'MONTHLY', at0);
    // Period 2 Nov to 1 Dec is 30 days; 17 Nov to 1 Dec is 15 of them.
    expect(p).toMatchObject({ amount: 15000, from: '2026-11-17', to: '2026-12-01', daysLeft: 15, periodDays: 30, wholePeriods: 0 });
  });
  it('charges a whole period on its first day, and one day on its last', () => {
    expect(prorate(31000, new Date('2026-12-17T00:00:00.000Z'), 'MONTHLY', at0)).toMatchObject({ amount: 31000, daysLeft: 30, periodDays: 30 });
    expect(prorate(31000, new Date('2026-11-18T00:00:00.000Z'), 'MONTHLY', at0)).toMatchObject({ amount: 1000, daysLeft: 1, periodDays: 31 });
  });
  it('counts a leap year, and whole periods already paid beyond this one', () => {
    const leap = prorate(366000, new Date('2028-03-01T00:00:00.000Z'), 'YEARLY', new Date('2027-09-01T06:30:00.000Z'));
    expect(leap).toMatchObject({ periodDays: 366, daysLeft: 182, amount: 182000, wholePeriods: 0 });
    const ahead = prorate(30000, new Date('2027-01-02T00:00:00.000Z'), 'MONTHLY', at0);
    expect(ahead.wholePeriods).toBe(1);
    expect(ahead.amount).toBe(15000 + 30000);
  });
  it('refuses a period that has ended', () => {
    expect(() => prorate(1000, new Date('2026-11-17T00:00:00.000Z'), 'MONTHLY', at0)).toThrow(/ended/);
  });
});

describe('off until CLOR switches it on', () => {
  it('says so, and adds nothing', async () => {
    const c = await company('ssoff');
    await onPlan(c);
    const r = (await seats(c).expect(200)).body;
    expect(r).toMatchObject({ open: false, eligible: false, code: 'OFF' });
    await add(c, 1).expect(409);
    expect((await sub(c)).quantity).toBe(3);
  });
  it('is switched by Finance with a fresh code, on the log', async () => {
    const sales = await staff('SALES');
    await request(app).put('/api/ops/self-serve').set(sales.h).send({ on: true }).expect(403);
    await switchOn({ payDays: 99 }).expect(400);
    const r = (await switchOn({ on: true, maxPerChange: 20, payDays: 14 }).expect(200)).body;
    expect(r.selfServe).toEqual({ on: true, maxPerChange: 20, payDays: 14 });
    expect((await lastAudit(fin.userId, 'SELF_SERVE_SEATS_CHANGED'))?.detail).toMatchObject({ on: true, switched: 'on' });
    const settings = (await request(app).get('/api/ops/invoicing').set(fin.h).expect(200)).body;
    expect(settings.selfServe.on).toBe(true);
  });
});

describe('adding seats', () => {
  beforeAll(async () => {
    await switchOn({ on: true, maxPerChange: 20, payDays: 14 }).expect(200);
  });

  it('puts them on at once, with a prorated invoice due in 14 days; paid, they stay and the period does not move', async () => {
    const c = await company('ssadd');
    await onPlan(c, { users: 3 });
    const before = await sub(c);
    expect((await seats(c).expect(200)).body).toMatchObject({ open: true, eligible: true, unit: 'USER', quantity: 3, maxPerChange: 20, payDays: 14 });

    const q = (await quote(c, 2).expect(200)).body.quote;
    expect(q).toMatchObject({ add: 2, unit: 'USER', quantityNow: 3, quantityAfter: 5, perPeriodMore: 100000, period: 'month', payDays: 14 });
    expect(q.subtotal).toBeGreaterThan(0);
    expect(q.subtotal).toBeLessThanOrEqual(100000);
    expect(q.line).toBeUndefined();

    const r = (await add(c, 2, q.total).expect(201)).body;
    expect(r.change).toMatchObject({ status: 'OPEN', added: 2, toQuantity: 5 });
    const s = await sub(c);
    expect(s).toMatchObject({ quantity: 5, periodAmount: 300000, listAmount: 300000 });
    expect(await boughtSeats(c.accountId)).toEqual({ unit: 'USER', quantity: 5 });

    const inv = await invoice(r.invoice.id);
    expect(inv).toMatchObject({ status: 'ISSUED', source: 'ADDON', subtotal: q.subtotal, total: q.total });
    expect(Math.round((inv.dueDate!.getTime() - inv.issueDate!.getTime()) / DAY)).toBe(14);
    expect((inv.lines as any[])[0].description).toMatch(/^2 users more on CLOR Seats/);

    /* One open addition at a time. */
    const again = await add(c, 1).expect(409);
    expect(again.body.error).toMatch(/waiting to be paid/);
    expect((await seats(c).expect(200)).body).toMatchObject({ eligible: false, code: 'OPEN', invoiceId: inv.id });

    await markInvoicePaid(inv.id, { reference: `UTR${rnd()}${rnd()}`.toUpperCase(), paidOn: new Date() }, fin.userId);
    expect((await change(r.change.id)).status).toBe('PAID');
    const after = await sub(c);
    expect(after.quantity).toBe(5);
    expect(after.currentPeriodEnd?.toISOString()).toBe(before.currentPeriodEnd?.toISOString());

    /* Paid, the next addition is open again. */
    expect((await seats(c).expect(200)).body.eligible).toBe(true);
  });

  it('paid online keeps them too, and does not move the period', async () => {
    const c = await company('ssonline');
    await onPlan(c);
    const before = await sub(c);
    const q = (await quote(c, 1).expect(200)).body.quote;
    const r = (await add(c, 1, q.total).expect(201)).body;
    const out = await applyGatewayEvent({ gateway: 'razorpay', eventId: `payment_link.paid:plink_${rnd()}`, type: 'payment_link.paid', accountId: c.accountId, invoice: { invoiceId: r.invoice.id, linkId: `plink_${rnd()}`, amountPaid: q.total }, raw: {} } as any);
    expect(out.status).toBe('APPLIED');
    expect((await change(r.change.id)).status).toBe('PAID');
    const after = await sub(c);
    expect(after.quantity).toBe(4);
    expect(after.currentPeriodEnd?.toISOString()).toBe(before.currentPeriodEnd?.toISOString());
  });

  it('unpaid after the days to pay: the invoice is cancelled and those seats alone come off', async () => {
    const c = await company('sslapse');
    await onPlan(c, { users: 4 });
    const r = (await add(c, 3).expect(201)).body;
    expect((await sub(c)).quantity).toBe(7);

    expect((await lapseDue(new Date(Date.now() + 13 * DAY))).lapsed).toBe(0);
    const run = await lapseDue(new Date(Date.now() + 15 * DAY));
    expect(run.lapsed).toBeGreaterThanOrEqual(1);
    expect((await change(r.change.id)).status).toBe('LAPSED');
    expect((await invoice(r.invoice.id)).status).toBe('VOID');
    expect(await sub(c)).toMatchObject({ quantity: 4, periodAmount: 250000, listAmount: 250000, status: 'active' });

    /* A payment for the cancelled invoice changes nothing. */
    await expect(markInvoicePaid(r.invoice.id, { reference: `UTR${rnd()}${rnd()}`.toUpperCase(), paidOn: new Date() }, fin.userId)).rejects.toThrow();
    expect((await sub(c)).quantity).toBe(4);
  });

  it('CLOR staff can take back seats waiting to be paid, with a reason', async () => {
    const c = await company('sscancel');
    await onPlan(c);
    const r = (await add(c, 2).expect(201)).body;
    await request(app).post(`/api/ops/seat-changes/${r.change.id}/cancel`).set(fin.h).send({}).expect(400);
    await request(app).post(`/api/ops/seat-changes/${r.change.id}/cancel`).set(fin.h).send({ reason: 'Added by mistake' }).expect(200);
    expect((await change(r.change.id)).status).toBe('CANCELLED');
    expect((await invoice(r.invoice.id)).status).toBe('VOID');
    expect((await sub(c)).quantity).toBe(3);
    await request(app).post(`/api/ops/seat-changes/${r.change.id}/cancel`).set(fin.h).send({ reason: 'again' }).expect(409);
    const list = (await request(app).get(`/api/ops/accounts/${c.accountId}/seat-changes`).set(fin.h).expect(200)).body.changes;
    expect(list[0]).toMatchObject({ status: 'CANCELLED', added: 2, invoice: { status: 'VOID' } });
  });

  it('a staff deal waits while seats are unpaid', async () => {
    const c = await company('ssdeal');
    const plan = await onPlan(c);
    await add(c, 1).expect(201);
    const r = await request(app).post(`/api/ops/accounts/${c.accountId}/deal`).set(fin.h).send({ source: 'custom', ref: plan.id, period: 'MONTHLY', quantity: 10, status: 'active', reason: 'Bigger deal' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/waiting to be paid/);
  });
});

describe('who may add, and when', () => {
  beforeAll(async () => {
    await switchOn({ on: true, maxPerChange: 5, payDays: 14 }).expect(200);
  });
  afterAll(async () => {
    await switchOn({ on: true, maxPerChange: 20, payDays: 14 }).expect(200);
  });

  it('a trial chooses a plan first; a plan not priced by the head has no seats', async () => {
    const t = await company('sstrial');
    await onPlan(t, { status: 'trialing' });
    expect((await seats(t).expect(200)).body).toMatchObject({ eligible: false, code: 'NO_PLAN' });
    expect((await seats(t)).body.reason).toMatch(/Choose a plan first/);
    const f = await company('ssflat');
    await onPlan(f, { unit: 'COMPANY', users: 1 });
    expect((await seats(f).expect(200)).body.code).toBe('NOT_BY_HEAD');
  });

  it('an overdue invoice is paid first; a plan set to stop is kept first', async () => {
    const c = await company('ssover');
    await onPlan(c);
    await db(() =>
      platformPrisma.billingInvoice.create({ data: { accountId: c.accountId, status: 'ISSUED', number: `TEST/${rnd()}`, issueDate: new Date(Date.now() - 30 * DAY), dueDate: new Date(Date.now() - DAY), total: 1000, subtotal: 1000 } }),
    );
    const r = (await seats(c).expect(200)).body;
    expect(r).toMatchObject({ eligible: false, code: 'OVERDUE' });
    expect(r.reason).toMatch(/overdue/);
    await add(c, 1).expect(409);

    const s = await company('ssstop');
    await onPlan(s);
    await db(() => platformPrisma.subscription.update({ where: { accountId: s.accountId }, data: { cancelAtPeriodEnd: true } }));
    expect((await seats(s).expect(200)).body.code).toBe('STOPPING');
  });

  it('at most the cap at a time, and a price that moved is said, not charged', async () => {
    const c = await company('sscap');
    await onPlan(c);
    const big = await add(c, 6).expect(400);
    expect(big.body.error).toMatch(/up to 5 at a time/);
    const moved = await add(c, 1, 1).expect(409);
    expect(moved.body.error).toMatch(/price changed/);
    expect((await sub(c)).quantity).toBe(3);
  });

});
