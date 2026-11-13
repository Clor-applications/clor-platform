import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Grants go through the two-person rule, and deals apply all or nothing
 * (services/ops/grants.ts, routes/opsApprovals.ts, routes/opsDeals.ts):
 *  - apps given away by hand over the limit deals use wait in Approvals until
 *    someone other than the person who asked approves them; within the limit
 *    they are set at once, as before;
 *  - a deal or a grant approved after the customer's plan was changed
 *    directly is refused, and nothing is set;
 *  - a deal whose last write fails leaves the plan and the offer's count as
 *    they were.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { setSubscription } = await import('../services/subscriptions.js');
const { grantDiscount } = await import('../services/ops/grants.js');
const { opsKit, lastAudit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
const accounts: string[] = [];
afterAll(async () => {
  await platformPrisma.opsApproval.deleteMany({ where: { accountId: { in: accounts } } });
  await new Promise((done) => app.close(done));
});
const { company: makeCompany, staff } = opsKit(app);
const company = async (label: string) => {
  const c = await makeCompany(label);
  accounts.push(c.accountId);
  return c;
};
const tag = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const subOf = (accountId: string) => platformPrisma.subscription.findUnique({ where: { accountId }, include: { items: true } });
const appsOf = async (accountId: string) => ((await subOf(accountId))?.items || []).map((i) => i.appCode).sort();
const approvalOf = (id: string) => platformPrisma.opsApproval.findUniqueOrThrow({ where: { id } });

describe('what a grant takes off', () => {
  const now = new Date();
  const active = (items: any[]) => ({ status: 'active', trialEndsAt: null, items });
  it('counts an app given away for good in full, and nothing else', () => {
    /* A trial's free apps turned into a free active plan: in full. */
    expect(grantDiscount({ status: 'trialing', trialEndsAt: now, items: [{ appCode: 'accounting', priceModel: null }] }, { status: 'active', trialEndsAt: null, apps: [{ appCode: 'accounting', priceModel: 'free' }] }, now).percent).toBe(100);
    /* Already free on an active plan, kept free: nothing. */
    expect(grantDiscount(active([{ appCode: 'accounting', priceModel: 'free' }]), { status: 'active', trialEndsAt: null, apps: [{ appCode: 'accounting', priceModel: 'free' }] }, now).percent).toBe(0);
    /* A by-hand price lowered by a tenth: 10%. Raised: nothing. */
    expect(grantDiscount(active([{ appCode: 'payroll', priceModel: 'flat', unitAmount: 1000 }]), { status: 'active', trialEndsAt: null, apps: [{ appCode: 'payroll', priceModel: 'flat', unitAmount: 900 }] }, now).percent).toBe(10);
    expect(grantDiscount(active([{ appCode: 'payroll', priceModel: 'flat', unitAmount: 1000 }]), { status: 'active', trialEndsAt: null, apps: [{ appCode: 'payroll', priceModel: 'flat', unitAmount: 1200 }] }, now).percent).toBe(0);
    /* A deal-priced app re-priced by hand: in full. Attendance with People is included, not given. */
    expect(grantDiscount(active([{ appCode: 'people', priceModel: 'plan' }]), { status: 'active', trialEndsAt: null, apps: [{ appCode: 'people', priceModel: 'flat', unitAmount: 1 }] }, now).percent).toBe(100);
    expect(grantDiscount(active([{ appCode: 'people', priceModel: 'plan' }]), { status: 'active', trialEndsAt: null, apps: [{ appCode: 'people', priceModel: 'plan' }, { appCode: 'attendance', priceModel: 'free' }] }, now).percent).toBe(0);
    /* A trial of up to 90 days, or a status that opens nothing, gives nothing away; a longer trial does. */
    expect(grantDiscount(null, { status: 'trialing', trialEndsAt: new Date(now.getTime() + 30 * 86_400_000), apps: [{ appCode: 'people' }] }, now).percent).toBe(0);
    expect(grantDiscount(null, { status: 'trialing', trialEndsAt: new Date(now.getTime() + 200 * 86_400_000), apps: [{ appCode: 'people' }] }, now).percent).toBe(100);
    expect(grantDiscount(null, { status: 'cancelled', trialEndsAt: null, apps: [{ appCode: 'people' }] }, now).percent).toBe(0);
  });
});

describe('a grant over the limit', () => {
  it('opens a request, changes nothing, and is set only when someone else approves it', async () => {
    const asker = await staff('BILLING');
    const approver = await staff('BILLING');
    const c = await company('grant');
    const before = await appsOf(c.accountId);
    const free = { apps: [{ appCode: 'people', priceModel: 'free' }, { appCode: 'payroll', priceModel: 'free' }], status: 'active' };

    /* Without a reason it cannot be asked: the approver reads it. */
    expect((await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set(asker.h).send(free).expect(400)).body).toMatchObject({ needsApproval: true });
    const asked = await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set(asker.h).send({ ...free, reason: 'Pilot for a reference customer' }).expect(202);
    expect(asked.body).toMatchObject({ needsApproval: true, approval: { status: 'PENDING' }, limit: 20 });
    const id = asked.body.approval.id;
    expect(await appsOf(c.accountId)).toEqual(before);
    const row = await approvalOf(id);
    expect(row).toMatchObject({ kind: 'GRANT', discountPercent: 100, status: 'PENDING' });
    expect(row.summary).toMatch(/People, Payroll free/);
    expect((await lastAudit(asker.userId, 'APPROVAL_ASKED'))?.detail).toMatchObject({ approvalId: id, kind: 'Apps by hand', discount: '100%' });

    /* The list says what it is, in plain words. */
    const listed = (await request(app).get('/api/ops/approvals').set(approver.h).expect(200)).body.approvals.find((a: any) => a.id === id);
    expect(listed).toMatchObject({ kind: 'GRANT', kindWord: 'Apps by hand', canDecide: true });

    /* One change to the plan waiting at a time, whatever its kind. */
    expect((await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set(asker.h).send({ ...free, reason: 'Asked twice' }).expect(409)).body.error).toMatch(/already waiting/);

    /* The person who asked cannot approve it. */
    expect((await request(app).post(`/api/ops/approvals/${id}/approve`).set(asker.h).send({}).expect(403)).body.code).toBe('SAME_PERSON');
    expect(await appsOf(c.accountId)).toEqual(before);

    const ok = await request(app).post(`/api/ops/approvals/${id}/approve`).set(approver.h).send({ note: 'Fine for the pilot' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'APPROVED' });
    expect(await appsOf(c.accountId)).toEqual(['payroll', 'people']);
    expect((await subOf(c.accountId))?.status).toBe('active');
    expect((await approvalOf(id)).status).toBe('APPROVED');
    expect((await lastAudit(approver.userId, 'SUBSCRIPTION_SET'))?.detail).toMatchObject({ approvedAfterRequest: id, reason: 'Pilot for a reference customer' });
    expect((await lastAudit(approver.userId, 'APPROVAL_GRANTED'))?.detail).toMatchObject({ approvalId: id, note: 'Fine for the pilot' });
  }, 180_000);

  it('Change apps: adding an app free asks; taking one away is set at once', async () => {
    const asker = await staff('BILLING');
    const approver = await staff('BILLING');
    const c = await company('grantapps');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', tier: 'FULL', priceModel: 'flat', unitAmount: 50000 }, { appCode: 'payroll', priceModel: 'flat', unitAmount: 40000 }], status: 'active' });

    const removed = await request(app).post(`/api/ops/accounts/${c.accountId}/apps`).set(asker.h).send({ apps: ['accounting'], reason: 'Stopped payroll' }).expect(200);
    expect(removed.body.apps).toEqual(['accounting']);

    const asked = await request(app).post(`/api/ops/accounts/${c.accountId}/apps`).set(asker.h).send({ apps: ['accounting', 'people'], reason: 'Trying People' }).expect(202);
    expect(await appsOf(c.accountId)).toEqual(['accounting']);
    expect((await approvalOf(asked.body.approval.id)).summary).toMatch(/People free/);
    await request(app).post(`/api/ops/approvals/${asked.body.approval.id}/approve`).set(approver.h).send({}).expect(200);
    expect(await appsOf(c.accountId)).toEqual(['accounting', 'people']);
    /* The kept app keeps its price. */
    expect((await subOf(c.accountId))?.items.find((i) => i.appCode === 'accounting')).toMatchObject({ tier: 'FULL', priceModel: 'flat', unitAmount: 50000 });
    expect((await lastAudit(approver.userId, 'SUBSCRIPTION_APPS_CHANGED'))?.detail).toMatchObject({ approvedAfterRequest: asked.body.approval.id, to: ['accounting', 'people'] });
  }, 180_000);

  it('within the limit (a lower by-hand price under 20%) is set at once', async () => {
    const fin = await staff('BILLING');
    const c = await company('grantsmall');
    await setSubscription(c.accountId, { apps: [{ appCode: 'payroll', priceModel: 'flat', unitAmount: 100000 }], status: 'active' });
    await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set(fin.h).send({ apps: [{ appCode: 'payroll', priceModel: 'flat', unitAmount: 90000 }], status: 'active', reason: 'Loyalty' }).expect(200);
    expect((await subOf(c.accountId))?.items[0]).toMatchObject({ appCode: 'payroll', unitAmount: 90000 });
    expect(await platformPrisma.opsApproval.count({ where: { accountId: c.accountId } })).toBe(0);
  }, 120_000);
});

describe('approved after the plan was changed directly', () => {
  it('a grant is refused, plainly, and nothing is set', async () => {
    const asker = await staff('BILLING');
    const approver = await staff('BILLING');
    const c = await company('stalegrant');
    const before = await appsOf(c.accountId);
    const id = (await request(app).post(`/api/billing/accounts/${c.accountId}/subscription`).set(asker.h).send({ apps: [{ appCode: 'people', priceModel: 'free' }], status: 'active', reason: 'Pilot' }).expect(202)).body.approval.id;
    /* Meanwhile the plan is changed directly. */
    await request(app).post(`/api/ops/accounts/${c.accountId}/cancel`).set(asker.h).send({ reason: 'They asked to stop' }).expect(200);
    const res = await request(app).post(`/api/ops/approvals/${id}/approve`).set(approver.h).send({}).expect(409);
    expect(res.body.error).toMatch(/plan was changed after this was asked/);
    expect((await subOf(c.accountId))?.status).toBe('cancelled');
    expect(await appsOf(c.accountId)).toEqual(before);
    expect((await approvalOf(id)).status).toBe('FAILED');
  }, 180_000);

  it('a deal is refused, plainly, and nothing is set', async () => {
    const asker = await staff('BILLING');
    const approver = await staff('BILLING');
    const c = await company('staledeal');
    const plan = (await request(app).post('/api/ops/custom-plans').set(asker.h).send({ accountId: c.accountId, name: 'Stale deal plan', apps: ['payroll'], unit: 'EMPLOYEE', includedUnits: 5, monthlyPrice: 100000, monthlyExtra: 10000, yearlyPrice: null, yearlyExtra: 0, gstApplies: false }).expect(201)).body.plan;
    const code = `STALE${tag()}`;
    await request(app).post('/api/ops/offers').set(asker.h).send({ code, name: 'Half off', kind: 'PERCENT', value: 50 }).expect(201);
    const id = (await request(app).post(`/api/ops/accounts/${c.accountId}/deal`).set(asker.h).send({ source: 'custom', ref: plan.id, period: 'MONTHLY', quantity: 5, offerCode: code, reason: 'Rival quote' }).expect(202)).body.approval.id;
    /* Someone sets a smaller grant directly before it is approved. */
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', priceModel: 'flat', unitAmount: 1000 }], status: 'active' });
    const res = await request(app).post(`/api/ops/approvals/${id}/approve`).set(approver.h).send({}).expect(409);
    expect(res.body.error).toMatch(/plan was changed after this was asked/);
    const sub = await subOf(c.accountId);
    expect(sub?.planName ?? null).toBeNull();
    expect(sub?.items.map((i) => i.appCode)).toEqual(['accounting']);
    expect((await platformPrisma.offer.findUniqueOrThrow({ where: { code } })).redemptions).toBe(0);
    expect((await approvalOf(id)).status).toBe('FAILED');
    /* FAILED is final: approving again is refused. */
    await request(app).post(`/api/ops/approvals/${id}/approve`).set(approver.h).send({}).expect(409);
  }, 180_000);
});

describe('a deal applies all or nothing', () => {
  it('a later step that fails leaves the plan and the offer’s count as they were', async () => {
    const fin = await staff('BILLING');
    const c = await company('dealtx');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', tier: 'FULL' }], status: 'active' });
    const before = await subOf(c.accountId);
    /* A price too large for the plan's price column: the apps are written, then the price fails. */
    const plan = (await request(app).post('/api/ops/custom-plans').set(fin.h).send({ accountId: c.accountId, name: 'Too big plan', apps: ['payroll'], unit: 'EMPLOYEE', includedUnits: 1, monthlyPrice: 1_000_000_000, monthlyExtra: 1_000_000_000, yearlyPrice: null, yearlyExtra: 0, gstApplies: false }).expect(201)).body.plan;
    const code = `TX${tag()}`;
    await request(app).post('/api/ops/offers').set(fin.h).send({ code, name: 'One rupee off', kind: 'AMOUNT', value: 100 }).expect(201);
    const res = await request(app).post(`/api/ops/accounts/${c.accountId}/deal`).set(fin.h).send({ source: 'custom', ref: plan.id, period: 'MONTHLY', quantity: 3, offerCode: code, reason: 'Big one' });
    expect(res.status).toBeGreaterThanOrEqual(500);
    const after = await subOf(c.accountId);
    expect(after?.items.map((i) => i.appCode)).toEqual(['accounting']);
    expect(after?.planName ?? null).toBeNull();
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
    expect((await platformPrisma.offer.findUniqueOrThrow({ where: { code } })).redemptions).toBe(0);
  }, 120_000);
});
