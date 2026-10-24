import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * A-31 (Batch 5, U3): SCIM tokens had no suspend, expiry or audit; revoking
 * one deleted it; and switching an on-site agent off left its directory-sync
 * token working.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { hashToken, suspendCredential, resumeCredential } = await import('../services/credentials.js');
const { rotateScimToken } = await import('../services/scimTokens.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `sl.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'SL owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `SL Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: (jwt.decode(signup.body.token) as any).userId };
}
const sec = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/security${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/security${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/security${p}`).set(at(c)),
});
const att = (c: Ctx) => ({
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
});
const users = (token: string) => request(app).get('/scim/v2/Users').set('Authorization', `Bearer ${token}`);
const agentConfig = (token: string) => request(app).get('/agent/v1/config').set('Authorization', `Bearer ${token}`);
const credentialOf = (token: string) => outsideTenant('test', () => platformPrisma.credential.findUnique({ where: { kind_tokenHash: { kind: 'SCIM', tokenHash: hashToken(token) } } }));
const user = (c: Ctx) => ({ type: 'USER' as const, id: c.userId });
const LDAP = { url: 'ldaps://dc1.corp.local', bindDn: 'CN=svc,DC=corp,DC=local', bindPassword: 'bindpw', baseDn: 'DC=corp,DC=local' };

/** An agent with directory sync, and the SCIM token it was handed. */
async function agentWithSync(c: Ctx) {
  const made = await att(c).post('/integrations/agents', { name: `DC ${rnd()}`, ldap: LDAP }).expect(201);
  const first = await agentConfig(made.body.token).expect(200);
  return { id: made.body.agent.id as string, name: made.body.agent.name as string, agentToken: made.body.token as string, scimToken: first.body.once.scimToken as string };
}

let c: Ctx;
beforeAll(async () => {
  c = await company();
}, 60_000);

describe('a stand-alone SCIM token', () => {
  it('can be paused and resumed', async () => {
    const made = await sec(c).post('/scim').expect(201);
    await users(made.body.token).expect(200);
    const cred = (await credentialOf(made.body.token))!;
    await suspendCredential(cred.id, c.orgId, user(c), 'investigating');
    expect((await users(made.body.token)).status).toBe(403);
    expect((await sec(c).get('/scim').expect(200)).body.tokens.find((t: any) => t.id === made.body.scim.id).status).toBe('SUSPENDED');
    await resumeCredential(cred.id, c.orgId, user(c));
    await users(made.body.token).expect(200);
  });

  it('is kept when revoked: refused, hash gone from its row, history recorded', async () => {
    const made = await sec(c).post('/scim').expect(201);
    await sec(c).del(`/scim/${made.body.scim.id}`).expect(200);
    expect((await users(made.body.token)).status).toBe(401);
    const row = await outsideTenant('test', () => platformPrisma.scimToken.findUnique({ where: { id: made.body.scim.id } }));
    expect(row?.revokedAt).toBeTruthy();
    expect(row?.tokenHash).not.toBe(hashToken(made.body.token));
    const cred = (await credentialOf(made.body.token))!;
    expect(cred.status).toBe('REVOKED');
    const ev = await outsideTenant('test', () => platformPrisma.credentialEvent.findMany({ where: { credentialId: cred.id }, orderBy: { createdAt: 'asc' } }));
    expect(ev.map((e) => e.eventType)).toEqual(['issued', 'revoked']);
    expect(ev[1]).toMatchObject({ actorType: 'USER', actorId: c.userId });
  });

  it('five revoked tokens do not stop a company making a new one', async () => {
    const d = await company();
    for (let i = 0; i < 5; i += 1) {
      const m = await sec(d).post('/scim').expect(201);
      await sec(d).del(`/scim/${m.body.scim.id}`).expect(200);
    }
    await sec(d).post('/scim').expect(201);
  }, 60_000);

  it('lasts a year by default, or as long as the admin says, or for ever', async () => {
    const year = await sec(c).post('/scim').expect(201);
    expect(new Date(year.body.scim.expiresAt).getTime()).toBeGreaterThan(Date.now() + 360 * 864e5);
    const never = await sec(c).post('/scim', { expiresAt: null }).expect(201);
    expect(never.body.scim.expiresAt).toBeNull();
    await sec(c).post('/scim', { expiresAt: new Date(Date.now() + 800 * 864e5).toISOString() }).expect(400);
    const r = await users(year.body.token).expect(200);
    expect(r.headers['x-clor-credential-expires']).toBeTruthy();
  });

  it('stops once expired', async () => {
    const made = await sec(c).post('/scim').expect(201);
    const cred = (await credentialOf(made.body.token))!;
    await outsideTenant('test', () => platformPrisma.credential.update({ where: { id: cred.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const r = await users(made.body.token);
    expect(r.status).toBe(401);
    expect(r.body.detail).toMatch(/expired/);
  });

  it('rotated: the new token works and the old one stops', async () => {
    const made = await sec(c).post('/scim').expect(201);
    const r = await rotateScimToken(c.orgId, made.body.scim.id, user(c));
    await users(r.token!).expect(200);
    expect((await users(made.body.token)).status).toBe(401);
  });
});

describe('an agent’s SCIM token follows its agent', () => {
  it('switched off: refused; switched back on: works', async () => {
    const a = await agentWithSync(c);
    await users(a.scimToken).expect(200);
    await att(c).put(`/integrations/agents/${a.id}`, { name: a.name, isActive: false }).expect(200);
    expect((await users(a.scimToken)).status).toBe(403);
    await att(c).put(`/integrations/agents/${a.id}`, { name: a.name, isActive: true }).expect(200);
    await users(a.scimToken).expect(200);
  });

  it('switching the agent back on does not undo a pause made on the token itself', async () => {
    const a = await agentWithSync(c);
    const cred = (await credentialOf(a.scimToken))!;
    expect(cred.parentOwnerId).toBe(a.id);
    await suspendCredential(cred.id, c.orgId, user(c));
    await att(c).put(`/integrations/agents/${a.id}`, { name: a.name, isActive: false }).expect(200);
    await att(c).put(`/integrations/agents/${a.id}`, { name: a.name, isActive: true }).expect(200);
    expect((await users(a.scimToken)).status).toBe(403);
  });

  it('agent deleted: the token is revoked and kept', async () => {
    const a = await agentWithSync(c);
    await att(c).del(`/integrations/agents/${a.id}`).expect(200);
    expect((await users(a.scimToken)).status).toBe(401);
    expect((await credentialOf(a.scimToken))?.status).toBe('REVOKED');
  });

  it('directory sync removed: the token stops; added again, a new one is handed over', async () => {
    const a = await agentWithSync(c);
    await att(c).put(`/integrations/agents/${a.id}`, { name: a.name, ldap: null }).expect(200);
    expect((await users(a.scimToken)).status).toBe(401);
    await att(c).put(`/integrations/agents/${a.id}`, { name: a.name, ldap: LDAP }).expect(200);
    const next = (await agentConfig(a.agentToken).expect(200)).body.once.scimToken;
    expect(next).toMatch(/^clors_/);
    expect(next).not.toBe(a.scimToken);
    await users(next).expect(200);
  });

  it('agent rotated: the new SCIM token reaches the agent once; both old tokens stop', async () => {
    const a = await agentWithSync(c);
    const r = await att(c).post(`/integrations/agents/${a.id}/rotate`).expect(200);
    expect((await agentConfig(a.agentToken)).status).toBe(401);
    const once = (await agentConfig(r.body.token).expect(200)).body.once.scimToken;
    expect(once).toMatch(/^clors_/);
    expect((await agentConfig(r.body.token).expect(200)).body.once).toEqual({});
    await users(once).expect(200);
    expect((await users(a.scimToken)).status).toBe(401);
  });

  it('lists with the reason it stopped', async () => {
    const a = await agentWithSync(c);
    await att(c).put(`/integrations/agents/${a.id}`, { name: a.name, isActive: false }).expect(200);
    const listed = (await sec(c).get('/scim').expect(200)).body.tokens.find((t: any) => t.agent?.id === a.id);
    expect(listed).toMatchObject({ status: 'PARENT_OFF', expiresAt: null });
  });
});

describe('a token from before the registry', () => {
  it('still works and is registered on first use, with its agent named', async () => {
    const a = await agentWithSync(c);
    await outsideTenant('test: forget it', () => platformPrisma.credential.deleteMany({ where: { kind: 'SCIM', tokenHash: hashToken(a.scimToken) } }));
    await users(a.scimToken).expect(200);
    expect((await credentialOf(a.scimToken))?.parentOwnerId).toBe(a.id);
  });
});
