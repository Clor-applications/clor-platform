import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * Apps a customer adds to their own plan (billing/selfServeApps.ts): priced
 * from the app's own price book plan at the list price; on at once with a
 * prorated invoice; paid, it stays and every renewal carries it on its own
 * line; unpaid by the days to pay, that app alone comes off; staff can take it
 * back or take a paid one off; a deal CLOR sets keeps it, or ends it when the
 * new plan includes the app; and the guards.
 */

/* A price book of our own: the shared test database's published one belongs to other tests. */
const BOOK = {
  version: 900,
  currency: 'INR',
  note: 'test',
  plans: [
    {
      code: 'people-growth-t', name: 'People Growth', description: 'HR', apps: ['people'], unit: 'EMPLOYEE', includedUnits: 10, trialDays: 0, periods: ['MONTHLY', 'YEARLY'], yearlyDiscountPct: null, displayOrder: 1, showOnWebsite: true, highlight: false, gstApplies: true,
      prices: [
        { period: 'MONTHLY', basePrice: 60000, extraUnitPrice: 6000 },
        { period: 'YEARLY', basePrice: 600000, extraUnitPrice: 60000 },
      ],
    },
    {
      code: 'payroll-starter-t', name: 'Payroll Starter', description: 'Pay', apps: ['payroll'], unit: 'EMPLOYEE', includedUnits: 10, trialDays: 0, periods: ['MONTHLY'], yearlyDiscountPct: null, displayOrder: 2, showOnWebsite: true, highlight: false, gstApplies: true,
      prices: [{ period: 'MONTHLY', basePrice: 50000, extraUnitPrice: 5000 }],
    },
    {
      code: 'bundle-t', name: 'Bundle', description: null, apps: ['people', 'payroll'], unit: 'EMPLOYEE', includedUnits: 10, trialDays: 0, periods: ['MONTHLY'], yearlyDiscountPct: null, displayOrder: 3, showOnWebsite: true, highlight: false, gstApplies: true,
      prices: [{ period: 'MONTHLY', basePrice: 90000, extraUnitPrice: 9000 }],
    },
  ],
};
vi.mock('../services/pricing/books.js', async (orig) => ({ ...(await orig<typeof import('../services/pricing/books.js')>()), publishedBook: async () => BOOK }));

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { setSubscription } = await import('../services/subscriptions.js');
const { boughtEmployees } = await import('../services/entitlements.js');
const { lapseDue, SELF_SERVE_KEY } = await import('../billing/selfServe.js');
const { runRenewals } = await import('../billing/renewals.js');
const { markInvoicePaid } = await import('../billing/invoices.js');
const { opsKit, at, lastAudit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
const { company, staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: self-serve apps', fn);
type Ctx = Awaited<ReturnType<typeof company>>;
let fin: Awaited<ReturnType<typeof staff>>;

const DAY = 86_400_000;
const istMidnight = (days: number) => new Date(`${new Date(Date.now() + 330 * 60_000 + days * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);
const RENEWALS_KEY = 'billing.invoicing';

beforeAll(async () => {
  fin = await staff('BILLING');
  await request(app).put('/api/ops/self-serve').set(fin.h).send({ on: true, maxPerChange: 20, payDays: 14 }).expect(200);
}, 120_000);
afterAll(async () => {
  await db(() => platformPrisma.platformSetting.deleteMany({ where: { key: SELF_SERVE_KEY } }));
  await new Promise((done) => app.close(done));
});

/** An active monthly Books plan by the user, 3 users, ₹2,000 a month, paid to `endsIn` days from today. */
async function onBooks(c: Ctx, over: { endsIn?: number; interval?: string } = {}) {
  const plan = await db(() =>
    platformPrisma.customPlan.create({ data: { name: `Books ${rnd()}`, apps: ['accounting'], unit: 'USER', includedUnits: 1, monthlyPrice: 100000, monthlyExtra: 50000, yearlyPrice: 1000000, yearlyExtra: 500000, gstApplies: true, accountId: c.accountId, createdByUserId: fin.userId } }),
  );
  await db(() => setSubscription(c.accountId, { apps: [{ appCode: 'accounting', seats: 3, priceModel: 'plan' }], status: 'active', billingInterval: over.interval ?? 'month', currentPeriodEnd: istMidnight(over.endsIn ?? 20) }));
  await db(() =>
    platformPrisma.subscription.update({
      where: { accountId: c.accountId },
      data: { planSource: 'custom', planRef: plan.id, planName: plan.name, planUnit: 'USER', quantity: 3, listAmount: 200000, periodAmount: 200000, cancelAtPeriodEnd: false },
    }),
  );
}
const items = async (c: Ctx) => (await db(() => platformPrisma.subscription.findUniqueOrThrow({ where: { accountId: c.accountId }, include: { items: true } }))).items;
const apps = (c: Ctx) => request(app).get('/api/billing/apps').set(at(c));
const quote = (c: Ctx, plan: string, n: number) => request(app).get(`/api/billing/apps/quote?plan=${plan}&quantity=${n}`).set(at(c));
const addApp = (c: Ctx, plan: string, quantity: number, total?: number) => request(app).post('/api/billing/apps').set(at(c)).send({ plan, quantity, ...(total !== undefined ? { total } : {}) });
const change = (id: string) => db(() => platformPrisma.subscriptionChange.findUniqueOrThrow({ where: { id } }));
const invoice = (id: string) => db(() => platformPrisma.billingInvoice.findUniqueOrThrow({ where: { id } }));
const switches = (c: Ctx, key: string) => db(() => platformPrisma.featureSetting.findMany({ where: { accountId: c.accountId, key } }));

describe('adding an app', () => {
  it('offers the apps the plan does not carry, each on its own plans, on the plan’s period', async () => {
    const c = await company('saopt');
    await onBooks(c);
    const r = (await apps(c).expect(200)).body;
    expect(r).toMatchObject({ open: true, eligible: true, period: 'month', payDays: 14, addOns: [] });
    const codes = r.options.map((o: { appCode: string }) => o.appCode).sort();
    expect(codes).toEqual(['payroll', 'people']);
    const people = r.options.find((o: { appCode: string }) => o.appCode === 'people');
    expect(people.plans).toEqual([expect.objectContaining({ code: 'people-growth-t', unit: 'EMPLOYEE', includedUnits: 10, startAt: 10, basePrice: 60000, extraUnitPrice: 6000 })]);
  });

  it('puts it on at once with a prorated invoice; paid, it stays and renewals carry it on its own line', async () => {
    const c = await company('saadd');
    await onBooks(c);
    const before = (await db(() => platformPrisma.subscription.findUniqueOrThrow({ where: { accountId: c.accountId } }))).currentPeriodEnd;
    const q = (await quote(c, 'people-growth-t', 25).expect(200)).body.quote;
    // ₹600 for ten, ₹60 for each of the fifteen more: ₹1,500 a month.
    expect(q).toMatchObject({ appCode: 'people', planName: 'People Growth', unit: 'EMPLOYEE', quantity: 25, perPeriod: 150000, period: 'month', payDays: 14 });
    expect(q.subtotal).toBeGreaterThan(0);
    expect(q.subtotal).toBeLessThanOrEqual(150000);
    expect(q.line).toBeUndefined();

    const r = (await addApp(c, 'people-growth-t', 25, q.total).expect(201)).body;
    expect(r.change).toMatchObject({ status: 'OPEN', appCode: 'people' });
    const codes = (await items(c)).map((i) => i.appCode).sort();
    expect(codes).toEqual(['accounting', 'attendance', 'people']);
    expect((await items(c)).find((i) => i.appCode === 'people')).toMatchObject({ priceModel: 'addon', seats: 25 });
    expect((await switches(c, 'people')).every((s) => s.enabled)).toBe(true);
    expect(await boughtEmployees(c.accountId)).toBe(25);

    const inv = await invoice(r.invoice.id);
    expect(inv).toMatchObject({ status: 'ISSUED', source: 'ADDON', subtotal: q.subtotal });
    expect(Math.round((inv.dueDate!.getTime() - Date.now()) / DAY)).toBe(14);
    expect((inv.lines as Array<{ description: string; appCode: string }>)[0]).toMatchObject({ appCode: 'people' });

    /* Nothing else can be added while it waits to be paid. */
    expect((await apps(c).expect(200)).body).toMatchObject({ eligible: false, code: 'OPEN' });

    await db(() => markInvoicePaid(inv.id, { reference: `UTR${rnd()}${rnd()}`.toUpperCase(), paidOn: new Date() }, fin.userId));
    expect((await change(r.change.id)).status).toBe('PAID');
    const after = await db(() => platformPrisma.subscription.findUniqueOrThrow({ where: { accountId: c.accountId } }));
    expect(after.currentPeriodEnd?.getTime()).toBe(before?.getTime());
    expect(after.periodAmount).toBe(200000);

    const listed = (await apps(c).expect(200)).body;
    expect(listed.addOns).toEqual([expect.objectContaining({ appCode: 'people', planName: 'People Growth', quantity: 25, listAmount: 150000 })]);
    expect(listed.options.map((o: { appCode: string }) => o.appCode)).toEqual(['payroll']);

    /* The renewal: the plan, and the app on its own line at the list price. */
    await db(() => platformPrisma.subscription.update({ where: { accountId: c.accountId }, data: { currentPeriodEnd: istMidnight(3) } }));
    const kept = await db(() => platformPrisma.platformSetting.findUnique({ where: { key: RENEWALS_KEY } }));
    await db(() => platformPrisma.platformSetting.upsert({ where: { key: RENEWALS_KEY }, create: { key: RENEWALS_KEY, value: { renewals: { on: true, daysBefore: 7 } } as any }, update: { value: { ...((kept?.value as object) || {}), renewals: { on: true, daysBefore: 7 } } as any } }));
    try {
      const run = await runRenewals(new Date(), [c.accountId]);
      expect(run.issued).toBe(1);
      const ren = await db(() => platformPrisma.billingInvoice.findFirstOrThrow({ where: { accountId: c.accountId, source: 'RENEWAL' } }));
      const lines = ren.lines as Array<{ description: string; amount: number; appCode: string | null }>;
      expect(lines.map((l) => l.amount)).toEqual([200000, 150000]);
      expect(lines[1]).toMatchObject({ appCode: 'people', description: expect.stringContaining('People Growth, 25 employees, monthly, added') });
    } finally {
      /* Put back the renewals switch alone: the invoice number counter has moved on since. */
      const now0 = await db(() => platformPrisma.platformSetting.findUniqueOrThrow({ where: { key: RENEWALS_KEY } }));
      const v = { ...((now0.value as Record<string, unknown>) || {}) };
      const was = (kept?.value as Record<string, unknown> | undefined)?.renewals;
      if (was === undefined) delete v.renewals;
      else v.renewals = was;
      await db(() => platformPrisma.platformSetting.update({ where: { key: RENEWALS_KEY }, data: { value: v as any } }));
    }
  });

  it('takes the app alone off when its invoice is not paid in time', async () => {
    const c = await company('salapse');
    await onBooks(c);
    const r = (await addApp(c, 'payroll-starter-t', 12).expect(201)).body;
    expect((await items(c)).map((i) => i.appCode).sort()).toEqual(['accounting', 'payroll']);
    await db(() => platformPrisma.subscriptionChange.update({ where: { id: r.change.id }, data: { dueAt: new Date(Date.now() - 1000) } }));
    await lapseDue();
    expect((await change(r.change.id)).status).toBe('LAPSED');
    expect((await invoice(r.invoice.id)).status).toBe('VOID');
    expect((await items(c)).map((i) => i.appCode)).toEqual(['accounting']);
    expect((await switches(c, 'payroll')).every((s) => !s.enabled)).toBe(true);
    const addOn = await db(() => platformPrisma.subscriptionAddOn.findFirstOrThrow({ where: { accountId: c.accountId } }));
    expect(addOn).toMatchObject({ status: 'ENDED', appCode: 'payroll' });
    /* It can be added again. */
    expect((await apps(c).expect(200)).body.options.map((o: { appCode: string }) => o.appCode).sort()).toEqual(['payroll', 'people']);
  });

  it('staff take an unpaid one back, and take a paid one off', async () => {
    const c = await company('sastaff');
    await onBooks(c);
    const r = (await addApp(c, 'payroll-starter-t', 10).expect(201)).body;
    const listed = (await request(app).get(`/api/ops/accounts/${c.accountId}/seat-changes`).set(fin.h).expect(200)).body;
    expect(listed.changes[0]).toMatchObject({ kind: 'APP', appCode: 'payroll', appName: 'Payroll', status: 'OPEN' });
    expect(listed.addOns).toEqual([expect.objectContaining({ appCode: 'payroll', quantity: 10 })]);
    /* Ending it while unpaid is refused: take it back instead. */
    await request(app).post(`/api/ops/add-ons/${listed.addOns[0].id}/end`).set(fin.h).send({ reason: 'asked' }).expect(409);
    await request(app).post(`/api/ops/seat-changes/${r.change.id}/cancel`).set(fin.h).send({ reason: 'customer asked' }).expect(200);
    expect((await change(r.change.id)).status).toBe('CANCELLED');
    expect((await items(c)).map((i) => i.appCode)).toEqual(['accounting']);
    expect((await lastAudit(fin.userId, 'APP_ADDON_TAKEN_BACK'))?.detail).toMatchObject({ app: 'payroll' });

    const again = (await addApp(c, 'payroll-starter-t', 10).expect(201)).body;
    await db(() => markInvoicePaid(again.invoice.id, { reference: `UTR${rnd()}${rnd()}`.toUpperCase(), paidOn: new Date() }, fin.userId));
    const addOn = await db(() => platformPrisma.subscriptionAddOn.findFirstOrThrow({ where: { accountId: c.accountId, status: 'ACTIVE' } }));
    await request(app).post(`/api/ops/add-ons/${addOn.id}/end`).set(fin.h).send({ reason: 'moved to a bundle' }).expect(200);
    expect((await items(c)).map((i) => i.appCode)).toEqual(['accounting']);
    await request(app).post(`/api/ops/add-ons/${addOn.id}/end`).set(fin.h).send({ reason: 'again' }).expect(409);
  });

  it('a plan CLOR sets keeps the app, or ends the add-on when the plan now includes it', async () => {
    const c = await company('sadeal');
    await onBooks(c);
    const r = (await addApp(c, 'payroll-starter-t', 10).expect(201)).body;
    await db(() => markInvoicePaid(r.invoice.id, { reference: `UTR${rnd()}${rnd()}`.toUpperCase(), paidOn: new Date() }, fin.userId));

    await db(() => setSubscription(c.accountId, { apps: [{ appCode: 'accounting', seats: 5, priceModel: 'plan' }], status: 'active' }));
    expect((await items(c)).map((i) => i.appCode).sort()).toEqual(['accounting', 'payroll']);
    expect((await switches(c, 'payroll')).every((s) => s.enabled)).toBe(true);

    await db(() => setSubscription(c.accountId, { apps: [{ appCode: 'accounting', seats: 5, priceModel: 'plan' }, { appCode: 'payroll', seats: 5, priceModel: 'plan' }], status: 'active' }));
    const payroll = (await items(c)).filter((i) => i.appCode === 'payroll');
    expect(payroll).toEqual([expect.objectContaining({ priceModel: 'plan' })]);
    const addOn = await db(() => platformPrisma.subscriptionAddOn.findFirstOrThrow({ where: { accountId: c.accountId } }));
    expect(addOn).toMatchObject({ status: 'ENDED', endedReason: expect.stringContaining('now includes') });
  });

  it('seats added to the plan leave the app’s own count alone', async () => {
    const c = await company('saseat');
    await onBooks(c);
    const r = (await addApp(c, 'payroll-starter-t', 12).expect(201)).body;
    await db(() => markInvoicePaid(r.invoice.id, { reference: `UTR${rnd()}${rnd()}`.toUpperCase(), paidOn: new Date() }, fin.userId));
    await request(app).post('/api/billing/seats').set(at(c)).send({ add: 2 }).expect(201);
    const it = await items(c);
    expect(it.find((i) => i.appCode === 'accounting')?.seats).toBe(5);
    expect(it.find((i) => i.appCode === 'payroll')?.seats).toBe(12);
  });

  it('refuses: an app already owned, a bundle, a period the plan is not sold on, a moved price, while off', async () => {
    const c = await company('saguard');
    await onBooks(c);
    expect((await quote(c, 'bundle-t', 10).expect(409)).body.error).toMatch(/not on the price list/);
    expect((await quote(c, 'people-growth-t', 0).expect(400)).body.error).toMatch(/whole number/);
    await addApp(c, 'people-growth-t', 10, 1).expect(409);
    expect((await items(c)).map((i) => i.appCode)).toEqual(['accounting']);

    const y = await company('sayear');
    await onBooks(y, { interval: 'year', endsIn: 200 });
    const yr = (await apps(y).expect(200)).body;
    expect(yr.period).toBe('year');
    expect(yr.options.map((o: { appCode: string }) => o.appCode)).toEqual(['people']);
    expect((await quote(y, 'payroll-starter-t', 10).expect(409)).body.error).toMatch(/not on the price list/);

    const owned = await company('saowned');
    await onBooks(owned);
    await db(() => setSubscription(owned.accountId, { apps: [{ appCode: 'accounting', seats: 3, priceModel: 'plan' }, { appCode: 'payroll', seats: 3, priceModel: 'plan' }], status: 'active' }));
    expect((await quote(owned, 'payroll-starter-t', 10).expect(409)).body.error).toMatch(/already on this account/);

    /* People replaces Attendance rather than sitting beside it: that move is a request to CLOR. */
    const att = await company('saatt');
    await onBooks(att);
    await db(() => setSubscription(att.accountId, { apps: [{ appCode: 'accounting', seats: 3, priceModel: 'plan' }, { appCode: 'attendance', seats: 3, priceModel: 'plan' }], status: 'active' }));
    expect((await apps(att).expect(200)).body.options.map((o: { appCode: string }) => o.appCode)).toEqual(['payroll']);
    expect((await quote(att, 'people-growth-t', 10).expect(409)).body.error).toMatch(/Move to People/);

    await request(app).put('/api/ops/self-serve').set(fin.h).send({ on: false }).expect(200);
    try {
      expect((await apps(c).expect(200)).body).toMatchObject({ open: false, eligible: false, code: 'OFF', options: [] });
      await addApp(c, 'people-growth-t', 10).expect(409);
    } finally {
      await request(app).put('/api/ops/self-serve').set(fin.h).send({ on: true }).expect(200);
    }
  });
});
