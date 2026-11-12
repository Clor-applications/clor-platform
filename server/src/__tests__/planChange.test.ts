import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/*
 * Platform audit, 11 Nov 2026: a customer could not upgrade, add an app or
 * stop their plan. Workspace now asks for a change (a Plan-or-billing ticket
 * that sales prices) and lets the account owner stop renewal themselves.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { setSubscription } = await import('../services/subscriptions.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const sub = (accountId: string) => outsideTenant('test: read the plan', () => platformPrisma.subscription.findUniqueOrThrow({ where: { accountId } }));

let boss: Ctx;
let member: Ctx;
beforeAll(async () => {
  const email = `plan.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Plan owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Plan Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  boss = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: me.body.user.accountId ?? me.body.account?.id, userId: me.body.user.id };
  if (!boss.accountId) boss.accountId = (await outsideTenant('test: account', () => platformPrisma.accountMembership.findFirstOrThrow({ where: { userId: boss.userId } }))).accountId;
  /* An Attendance customer, paid by the month. */
  await outsideTenant('test: attendance plan', () => setSubscription(boss.accountId, { apps: [{ appCode: 'attendance' }], status: 'active' } as any));
  await outsideTenant('test: a paid period', () => platformPrisma.subscription.update({ where: { accountId: boss.accountId }, data: { billingInterval: 'month', currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) } }));
  /* A colleague with no settings rights. */
  const m = `member.${Date.now()}.${rnd()}@example.com`;
  const role = await request(app).post(`/api/orgs/${boss.orgId}/roles`).set(at(boss)).send({ name: `Role ${rnd()}`, roleType: 'CUSTOM', permissions: [] }).expect(201);
  const user = await request(app).post('/api/users').set(at(boss)).send({ email: m, fullName: 'Member', password: 'Passw0rd!23', orgIds: [boss.orgId], branchIdsByOrg: { [boss.orgId]: [boss.branchId] } }).expect(201);
  await request(app).post(`/api/orgs/${boss.orgId}/users/${user.body.user.id}/roles`).set(at(boss)).send({ roleId: role.body.role.id, branchId: null }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email: m, password: 'Passw0rd!23' }).expect(200);
  member = { token: login.body.token, orgId: boss.orgId, branchId: boss.branchId, accountId: boss.accountId, userId: user.body.user.id };
}, 120_000);

describe('changing the plan from Workspace', () => {
  it('the owner may ask for a change and may stop the plan; a member may do neither', async () => {
    const own = (await request(app).get('/api/billing/subscription').set(at(boss)).expect(200)).body;
    expect(own).toMatchObject({ mayChangePlan: true, mayStopPlan: true });
    const theirs = (await request(app).get('/api/billing/subscription').set(at(member)).expect(200)).body;
    expect(theirs).toMatchObject({ mayChangePlan: false, mayStopPlan: false });
    await request(app).post('/api/billing/plan-change').set(at(member)).send({ kind: 'UPGRADE_PEOPLE' }).expect(403);
    await request(app).post('/api/billing/cancel').set(at(member)).send({}).expect(403);
  });

  it('moving from Attendance to People opens a Plan-or-billing ticket for sales, and changes nothing yet', async () => {
    const r = await request(app).post('/api/billing/plan-change').set(at(boss)).send({ kind: 'UPGRADE_PEOPLE', note: 'We are 60 now' }).expect(201);
    expect(r.body.ticket.code).toMatch(/^T-\d+$/);
    const t = await outsideTenant('test: the ticket', () => platformPrisma.supportTicket.findUniqueOrThrow({ where: { id: r.body.ticket.id }, include: { messages: true } }));
    expect(t).toMatchObject({ accountId: boss.accountId, category: 'BILLING', app: 'people', subject: 'Plan change: Move from Attendance to People' });
    expect(t.messages[0].body).toContain('We are 60 now');
    const items = await outsideTenant('test: items', () => platformPrisma.subscriptionItem.findMany({ where: { subscription: { accountId: boss.accountId } }, select: { appCode: true } }));
    expect(items.map((i) => i.appCode)).toEqual(['attendance']);
  });

  it('asks only for what makes sense', async () => {
    await request(app).post('/api/billing/plan-change').set(at(boss)).send({ kind: 'ADD_APP', app: 'attendance' }).expect(409);
    await request(app).post('/api/billing/plan-change').set(at(boss)).send({ kind: 'REMOVE_APP', app: 'people' }).expect(409);
    await request(app).post('/api/billing/plan-change').set(at(boss)).send({ kind: 'ADD_APP', app: 'nonsense' }).expect(400);
    await request(app).post('/api/billing/plan-change').set(at(boss)).send({ kind: 'WHATEVER' }).expect(400);
  });

  it('the owner stops renewal; the plan runs to the end of the period; they can turn it back on', async () => {
    const r = await request(app).post('/api/billing/cancel').set(at(boss)).send({ reason: 'Moving to paper' }).expect(200);
    expect(r.body.cancelAtPeriodEnd).toBe(true);
    const after = await sub(boss.accountId);
    expect(after).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    await request(app).post('/api/billing/cancel').set(at(boss)).send({}).expect(409);
    const told = await outsideTenant('test: sales told', () => platformPrisma.supportTicket.findFirst({ where: { accountId: boss.accountId, subject: 'Plan stopped: will not renew' }, include: { messages: true } }));
    expect(told?.messages[0].body).toContain('Moving to paper');
    await request(app).post('/api/billing/resume').set(at(boss)).send({}).expect(200);
    expect((await sub(boss.accountId)).cancelAtPeriodEnd).toBe(false);
    await request(app).post('/api/billing/resume').set(at(boss)).send({}).expect(409);
  });
});
