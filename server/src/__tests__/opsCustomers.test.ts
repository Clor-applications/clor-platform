import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * One page per customer (operator console, roadmap item 13): who may do what
 * from it, that every change is on the record with its reason, and that a
 * suspended customer is shut out with a plain reason until resumed.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { setSubscription } = await import('../services/subscriptions.js');
const { at, opsKit, lastAudit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company, staff } = opsKit(app);

describe('a customer’s page in the operator console', () => {
  it('lists customers by status and finds them by owner email; shows companies with branches', async () => {
    const reader = await staff('READ_ONLY');
    const c = await company('cust');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting' }], status: 'trialing', trialDays: 14 });
    const list = (await request(app).get('/api/ops/accounts').query({ q: c.email, status: 'trialing' }).set(reader.h).expect(200)).body;
    expect(list.accounts).toHaveLength(1);
    expect(list.accounts[0]).toMatchObject({ id: c.accountId, plan: 'trialing', apps: ['accounting'], users: 1 });
    expect((await request(app).get('/api/ops/accounts').query({ q: c.email, status: 'cancelled' }).set(reader.h).expect(200)).body.accounts).toHaveLength(0);
    const one = (await request(app).get(`/api/ops/accounts/${c.accountId}`).set(reader.h).expect(200)).body;
    expect(one.companies[0].branches.length).toBeGreaterThan(0);
    expect(one.subscription).toMatchObject({ status: 'trialing', apps: ['accounting'] });
  }, 90_000);

  it('lets Finance change apps, cancel and reopen; not Support, Sales or Read-only; each with a reason on the record', async () => {
    const fin = await staff('BILLING');
    const sup = await staff('SUPPORT');
    const sales = await staff('SALES');
    const reader = await staff('READ_ONLY');
    const c = await company('cust');
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting', tier: 'FULL' }], status: 'active' });

    for (const who of [sup, sales]) {
      expect((await request(app).post(`/api/ops/accounts/${c.accountId}/apps`).set(who.h).send({ apps: ['accounting', 'people'], reason: 'Asked' }).expect(403)).body.code).toBe('OPERATOR_ROLE');
    }
    const ro = await request(app).post(`/api/ops/accounts/${c.accountId}/cancel`).set(reader.h).send({ reason: 'Nope' }).expect(403);
    expect(ro.body.error).toMatch(/read-only/);

    await request(app).post(`/api/ops/accounts/${c.accountId}/apps`).set(fin.h).send({ apps: ['accounting', 'people'] }).expect(400);
    const changed = (await request(app).post(`/api/ops/accounts/${c.accountId}/apps`).set(fin.h).send({ apps: ['accounting', 'people'], reason: 'Bought People on the phone' }).expect(200)).body;
    expect(changed.apps).toEqual(['accounting', 'people']);
    /* The kept app keeps its tier. */
    const items = await platformPrisma.subscriptionItem.findMany({ where: { subscription: { accountId: c.accountId } } });
    expect(items.find((i) => i.appCode === 'accounting')?.tier).toBe('FULL');
    expect((await lastAudit(fin.userId, 'SUBSCRIPTION_APPS_CHANGED'))?.detail).toMatchObject({ from: ['accounting'], to: ['accounting', 'people'], reason: 'Bought People on the phone' });

    await request(app).post(`/api/ops/accounts/${c.accountId}/cancel`).set(fin.h).send({ reason: 'Closing the business' }).expect(200);
    expect((await platformPrisma.subscription.findUnique({ where: { accountId: c.accountId } }))?.status).toBe('cancelled');
    await request(app).post(`/api/ops/accounts/${c.accountId}/cancel`).set(fin.h).send({ reason: 'Again' }).expect(409);
    expect((await request(app).post(`/api/ops/accounts/${c.accountId}/reopen`).set(fin.h).send({ reason: 'Changed their mind' }).expect(200)).body.status).toBe('trialing'); // back to where it was: /signup starts a trial

    /* Sales may extend a trial; Support may not. */
    await setSubscription(c.accountId, { apps: [{ appCode: 'accounting' }], status: 'trialing', trialDays: 3 });
    await request(app).post(`/api/ops/accounts/${c.accountId}/extend-trial`).set(sales.h).send({ days: 7, reason: 'Needs a week more' }).expect(200);
    await request(app).post(`/api/ops/accounts/${c.accountId}/extend-trial`).set(sup.h).send({ days: 7, reason: 'Needs a week more' }).expect(403);

    /* The customer sees, in their own security record, what CLOR did. */
    const seen = await platformPrisma.authEvent.findMany({ where: { accountId: c.accountId, eventType: { startsWith: 'OPERATOR_' } } });
    expect(seen.map((e) => e.eventType)).toEqual(expect.arrayContaining(['OPERATOR_SUBSCRIPTION_APPS_CHANGED', 'OPERATOR_SUBSCRIPTION_CANCELLED', 'OPERATOR_SUBSCRIPTION_REOPENED', 'OPERATOR_TRIAL_EXTENDED']));
    const activity = (await request(app).get(`/api/ops/accounts/${c.accountId}/activity`).set(reader.h).expect(200)).body.lines;
    expect(activity.filter((l: any) => l.kind === 'clor').map((l: any) => l.what)).toEqual(expect.arrayContaining(['Cancelled a subscription', 'Extended a trial']));
  }, 120_000);

  it('suspends a customer: their writes are refused with a plain reason, and resume lets them back', async () => {
    const fin = await staff('BILLING');
    const c = await company('cust');
    const write = () => request(app).post(`/api/orgs/${c.orgId}/branches`).set(at(c)).send({});
    expect((await write()).status).not.toBe(403);
    await request(app).post(`/api/ops/accounts/${c.accountId}/suspend`).set(fin.h).send({}).expect(400);
    await request(app).post(`/api/ops/accounts/${c.accountId}/suspend`).set(fin.h).send({ reason: 'Three months unpaid' }).expect(200);
    const shut = await write().expect(403);
    expect(shut.body.code).toBe('ACCOUNT_SUSPENDED');
    expect(shut.body.error).toMatch(/suspended by CLOR\. Contact support/);
    await request(app).post(`/api/ops/accounts/${c.accountId}/reinstate`).set(fin.h).send({ reason: 'Paid in full' }).expect(200);
    expect((await write()).status).not.toBe(403);
    expect((await lastAudit(fin.userId, 'ACCOUNT_SUSPENDED'))?.detail).toMatchObject({ reason: 'Three months unpaid' });
    expect((await lastAudit(fin.userId, 'ACCOUNT_REINSTATED'))?.detail).toMatchObject({ reason: 'Paid in full' });
  }, 90_000);

  it('lets Support send a reset link, sign a user out everywhere and resend an invitation; not Finance', async () => {
    const sup = await staff('SUPPORT');
    const fin = await staff('BILLING');
    const c = await company('cust');
    const users = (await request(app).get(`/api/ops/accounts/${c.accountId}/users`).set(sup.h).expect(200)).body;
    expect(users.users[0]).toMatchObject({ userId: c.userId, email: c.email, role: 'OWNER', status: 'active' });
    expect(users.users[0].signedInOn).toBeGreaterThan(0);

    await request(app).post(`/api/ops/accounts/${c.accountId}/users/${c.userId}/reset-link`).set(fin.h).send({ reason: 'Locked out' }).expect(403);
    const reset = (await request(app).post(`/api/ops/accounts/${c.accountId}/users/${c.userId}/reset-link`).set(sup.h).send({ reason: 'Locked out, asked on the phone' }).expect(200)).body;
    expect(reset.email).toBe(c.email);
    const mail = await platformPrisma.emailOutbox.findFirst({ where: { toEmail: c.email, templateKey: 'auth.password_reset' }, orderBy: { createdAt: 'desc' } });
    expect(mail).not.toBeNull();
    expect(await lastAudit(sup.userId, 'USER_RESET_LINK_SENT')).toMatchObject({ targetAccountId: c.accountId, targetUserId: c.userId });

    const out = (await request(app).post(`/api/ops/accounts/${c.accountId}/users/${c.userId}/sign-out`).set(sup.h).send({ reason: 'Lost phone' }).expect(200)).body;
    expect(out.sessionsEnded).toBeGreaterThan(0);
    expect(await platformPrisma.session.count({ where: { userId: c.userId, revokedAt: null } })).toBe(0);

    /* Not somebody from another account. */
    const other = await company('other');
    await request(app).post(`/api/ops/accounts/${c.accountId}/users/${other.userId}/sign-out`).set(sup.h).send({ reason: 'Wrong one' }).expect(404);

    const inv = await platformPrisma.accountInvitation.create({
      data: { accountId: c.accountId, email: `new.${Date.now()}@example.com`, grants: JSON.stringify([{ orgId: c.orgId, branchIds: [c.branchId], roleIds: [] }]), tokenHash: `h${Date.now()}${Math.random()}`, expiresAt: new Date(Date.now() - 1000), invitedByUserId: c.userId },
    });
    const again = (await request(app).post(`/api/ops/accounts/${c.accountId}/invitations/${inv.id}/resend`).set(sup.h).send({ reason: 'Never got it' }).expect(200)).body;
    expect(again.invitation.email).toBe(inv.email);
    expect((await platformPrisma.accountInvitation.findUnique({ where: { id: inv.id } }))?.sendCount).toBe(2);
    expect(await lastAudit(sup.userId, 'USER_INVITE_RESENT')).not.toBeNull();
  }, 90_000);

  it('shows the customer’s demo request on Requests and their payments, empty until there are some', async () => {
    const reader = await staff('READ_ONLY');
    const c = await company('cust');
    await platformPrisma.demoRequest.create({ data: { name: 'Asha', company: 'Rao Textiles', email: c.email.toLowerCase(), phone: '+919845012345', city: 'Mysuru', companySize: '1-10', users: 2, apps: ['people'] } });
    const r = (await request(app).get(`/api/ops/accounts/${c.accountId}/requests`).set(reader.h).expect(200)).body;
    expect(r.demoRequests).toHaveLength(1);
    expect(r.demoRequests[0]).toMatchObject({ company: 'Rao Textiles' });
    const p = (await request(app).get(`/api/ops/accounts/${c.accountId}/payments`).set(reader.h).expect(200)).body;
    expect(p).toEqual({ invoices: [], payments: [] });
  }, 90_000);
});

describe('what the console calls a customer', () => {
  it('uses the business: the account name, or the first company when the account carries only the owner’s name', async () => {
    const { customerTitle } = await import('../routes/ops.js');
    expect(customerTitle('Rao Textiles', 'Asha Rao', 'Rao Textiles Pvt Ltd')).toBe('Rao Textiles');
    expect(customerTitle('Asha Rao', 'Asha Rao', 'Rao Textiles')).toBe('Rao Textiles');
    expect(customerTitle('', 'Asha Rao', null)).toBe('Asha Rao');
    expect(customerTitle(null, null, null)).toBe('Unnamed customer');
  });
});
