import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Workspace Integrations (services/workspace/integrations.ts): what connects a
 * company to the outside, whether it works, and where it is managed. Only
 * lines for things that exist; health as the jobs already judge it.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { runInTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string; accountId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

async function makeOwner(): Promise<Ctx> {
  const email = `int.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Int Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const user = await platformPrisma.user.findFirstOrThrow({ where: { email }, select: { id: true, accountId: true } });
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: user.id, accountId: user.accountId };
}

const list = (c: Ctx) => request(app).get(`/api/orgs/${c.orgId}/workspace/integrations`).set(at(c));
const of = (body: { integrations: { key: string }[] }, key: string) => body.integrations.find((i) => i.key === key) as any;
const integ = (c: Ctx, path: string, body: object) => request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/${path}`).set(at(c)).send(body);

describe('Workspace integrations', () => {
  it('shows only what exists, says what needs a look first, and where each is managed', async () => {
    const c = await makeOwner();
    const none = (await list(c).expect(200)).body;
    expect(none.integrations.filter((i: { key: string }) => i.key !== 'email')).toEqual([]);

    await integ(c, 'agents', { name: 'Head office server' }).expect(201);
    await integ(c, 'webhooks', { name: 'Payroll partner', url: 'https://example.com/hooks/clor', events: ['punch'] }).expect(201);
    await integ(c, 'keys', { name: 'Canteen system', scopes: ['attendance:read'], allowedIps: '' }).expect(201);

    const body = (await list(c).expect(200)).body;
    /* A connector that has never called in needs a look, and comes first. */
    expect(body.integrations[0].key).toBe('connectors');
    expect(of(body, 'connectors')).toMatchObject({ status: 'attention', manage: { app: 'people', screen: 'integrations' }, parts: [{ name: 'Head office server', status: 'attention', note: 'Not connected yet' }] });
    expect(of(body, 'webhooks')).toMatchObject({ status: 'ok', parts: [{ name: 'Payroll partner', status: 'ok' }] });
    expect(of(body, 'apiKeys')).toMatchObject({ status: 'ok', manage: { app: 'admin', screen: 'credentials' }, parts: [{ name: 'Canteen system', status: 'ok' }] });

    /* Failed webhook deliveries this week turn the webhook to needs a look. */
    const hook = await peoplePrisma.webhook.findFirstOrThrow({ where: { orgId: c.orgId } });
    await runInTenant(c.orgId, () => peoplePrisma.webhookDelivery.create({ data: { accountId: c.accountId, orgId: c.orgId, webhookId: hook.id, event: 'punch', body: '{}', status: 'FAILED' } }));
    const after = (await list(c).expect(200)).body;
    expect(of(after, 'webhooks').status).toBe('attention');
    expect(of(after, 'webhooks').parts[0].note).toBe('1 delivery failed this week');
  });

  it('is for whoever may see the company profile, and never another company', async () => {
    const c = await makeOwner();
    await integ(c, 'agents', { name: 'Plant gate PC' }).expect(201);
    const other = await makeOwner();
    const theirs = (await list(other).expect(200)).body;
    expect(theirs.integrations.some((i: { key: string }) => i.key === 'connectors')).toBe(false);
    expect((await request(app).get(`/api/orgs/${c.orgId}/workspace/integrations`).set(at(other))).status).toBeGreaterThanOrEqual(400);
  });
});
