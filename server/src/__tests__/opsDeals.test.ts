import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Offers, custom plans and paid subscriptions on the operator console: Billing
 * makes them with a reason on the record; a deal sets the customer's apps,
 * units, period and price; an offer counts each customer once and stops at its
 * limit; the first invoice is drafted at the offer's price.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { suggestedLines } = await import('../billing/invoices.js');
const { opsKit, lastAudit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company, staff } = opsKit(app);
const tag = () => Math.random().toString(36).slice(2, 7).toUpperCase();

describe('offers, custom plans and subscription deals', () => {
  it('Billing makes a custom plan and an offer, sets the deal with a first invoice, and the offer stops at its limit', async () => {
    const fin = await staff('BILLING');
    const sup = await staff('SUPPORT');
    const a = await company('deal');
    const b = await company('deal');

    /* A plan for customer A: ₹1,000 a month for 5 users, ₹150 for each more. */
    const planBody = { accountId: a.accountId, name: 'Meridian special', apps: ['people'], unit: 'USER', includedUnits: 5, monthlyPrice: 100000, monthlyExtra: 15000, yearlyPrice: null, yearlyExtra: 0, gstApplies: false };
    expect((await request(app).post('/api/ops/custom-plans').set(sup.h).send(planBody).expect(403)).body.code).toBe('OPERATOR_ROLE');
    await request(app).post('/api/ops/custom-plans').set(fin.h).send({ ...planBody, monthlyPrice: null }).expect(400);
    const plan = (await request(app).post('/api/ops/custom-plans').set(fin.h).send(planBody).expect(201)).body.plan;
    expect(plan.accountName).toBeTruthy();

    const code = `FIRST${tag()}`;
    const offerBody = { code: code.toLowerCase(), name: 'First three months', kind: 'PERCENT', value: 20, durationPeriods: 3, maxRedemptions: 1 };
    await request(app).post('/api/ops/offers').set(fin.h).send({ ...offerBody, value: 120 }).expect(400);
    const offer = (await request(app).post('/api/ops/offers').set(fin.h).send(offerBody).expect(201)).body.offer;
    expect(offer).toMatchObject({ code, status: 'active', words: '20% off for 3 billing periods' });
    await request(app).post('/api/ops/offers').set(fin.h).send(offerBody).expect(409);
    expect((await lastAudit(fin.userId, 'OFFER_MADE'))?.detail).toMatchObject({ code });

    /* The price before setting it: 7 users = ₹1,000 + 2 × ₹150 = ₹1,300, less 20%. */
    const ask = { source: 'custom', ref: plan.id, period: 'MONTHLY', quantity: 7, offerCode: code };
    const q = (await request(app).post(`/api/ops/accounts/${a.accountId}/deal/quote`).set(sup.h).send(ask).expect(200)).body.deal;
    expect(q).toMatchObject({ listAmount: 130000, discount: 26000, periodAmount: 104000, total: 104000 });
    /* Made for A, so not for B. */
    expect((await request(app).post(`/api/ops/accounts/${b.accountId}/deal/quote`).set(fin.h).send(ask).expect(409)).body.error).toMatch(/another customer/);
    await request(app).post(`/api/ops/accounts/${a.accountId}/deal/quote`).set(fin.h).send({ ...ask, period: 'YEARLY' }).expect(400);

    await request(app).post(`/api/ops/accounts/${a.accountId}/deal`).set(sup.h).send({ ...ask, reason: 'Signed' }).expect(403);
    await request(app).post(`/api/ops/accounts/${a.accountId}/deal`).set(fin.h).send(ask).expect(400);
    const set = (await request(app).post(`/api/ops/accounts/${a.accountId}/deal`).set(fin.h).send({ ...ask, startsOn: '2026-11-15', draftInvoice: true, reason: 'Signed the order form' }).expect(200)).body;
    expect(set.subscription.items.map((i: any) => i.appCode).sort()).toEqual(['attendance', 'people']);
    const sub = await platformPrisma.subscription.findUnique({ where: { accountId: a.accountId } });
    expect(sub).toMatchObject({ status: 'active', billingInterval: 'month', planSource: 'custom', planName: 'Meridian special', quantity: 7, listAmount: 130000, periodAmount: 104000, offerCode: code });
    expect(sub?.currentPeriodStart?.toISOString().slice(0, 10)).toBe('2026-11-15');
    expect(sub?.currentPeriodEnd?.toISOString().slice(0, 10)).toBe('2026-12-15');
    expect(sub?.offerEndsAt?.toISOString().slice(0, 10)).toBe('2027-02-15');
    const inv = await platformPrisma.billingInvoice.findUnique({ where: { id: set.invoiceId } });
    expect(inv).toMatchObject({ status: 'DRAFT', total: 104000, periodStart: '2026-11-15', periodEnd: '2026-12-14' });
    expect((await suggestedLines(a.accountId))[0]).toMatchObject({ unitAmount: 104000, description: `CLOR Meridian special, 7 users, monthly (${code})` });
    expect((await lastAudit(fin.userId, 'SUBSCRIPTION_DEAL_SET'))?.detail).toMatchObject({ plan: 'Meridian special', units: 7, price: '₹1,040', reason: 'Signed the order form' });
    expect(await platformPrisma.authEvent.count({ where: { accountId: a.accountId, eventType: 'OPERATOR_SUBSCRIPTION_DEAL_SET' } })).toBe(1);

    /* Setting A's deal again does not count A twice; B finds the one place taken. */
    await request(app).post(`/api/ops/accounts/${a.accountId}/deal`).set(fin.h).send({ ...ask, quantity: 8, reason: 'One more user' }).expect(200);
    expect((await platformPrisma.offer.findUnique({ where: { code } }))?.redemptions).toBe(1);
    const planB = (await request(app).post('/api/ops/custom-plans').set(fin.h).send({ ...planBody, accountId: null, name: 'Open plan' }).expect(201)).body.plan;
    const usedUp = await request(app).post(`/api/ops/accounts/${b.accountId}/deal/quote`).set(fin.h).send({ ...ask, ref: planB.id }).expect(409);
    expect(usedUp.body.error).toMatch(/used by all 1/);

    /* Once taken, the price and rules stay; the name and limit may change. */
    expect((await request(app).patch(`/api/ops/offers/${offer.id}`).set(fin.h).send({ value: 50 }).expect(409)).body.error).toMatch(/has taken it/);
    await request(app).patch(`/api/ops/offers/${offer.id}`).set(fin.h).send({ maxRedemptions: 0 }).expect(400);
    expect((await request(app).patch(`/api/ops/offers/${offer.id}`).set(fin.h).send({ name: 'First three, renamed', maxRedemptions: 5 }).expect(200)).body.offer).toMatchObject({ name: 'First three, renamed', status: 'active' });
    await request(app).post(`/api/ops/offers/${offer.id}/pause`).set(fin.h).send({}).expect(200);
    expect((await request(app).post(`/api/ops/accounts/${b.accountId}/deal/quote`).set(fin.h).send({ ...ask, ref: planB.id }).expect(409)).body.error).toMatch(/paused/);

    /* Everyone on the console can read the list of subscriptions and what they bring in. */
    const reader = await staff('READ_ONLY');
    const list = (await request(app).get('/api/ops/subscriptions').set(reader.h).expect(200)).body;
    expect(list.subscriptions.find((s: any) => s.accountId === a.accountId)).toMatchObject({ planName: 'Meridian special', quantity: 8, amount: 116000, interval: 'month', offerCode: code });
    expect(list.monthly).toBeGreaterThanOrEqual(116000);
    const opts = (await request(app).get(`/api/ops/accounts/${a.accountId}/deal-options`).set(reader.h).expect(200)).body;
    expect(opts.plans.find((p: any) => p.ref === plan.id)).toMatchObject({ forThisCustomer: true });
    expect(opts.offers.find((o: any) => o.code === code)).toBeUndefined(); // paused
  }, 180_000);
});
