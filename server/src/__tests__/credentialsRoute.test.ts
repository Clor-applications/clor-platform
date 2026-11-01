import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Batch 5, U7: Workspace → Credentials. One list of every key and token
 * other systems hold for the company; API keys made here; directory-sync
 * tokens only for someone who may manage users; customer links counted, never
 * listed; nobody who manages integration keys today loses that at deploy.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `cp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'CP owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `CP Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId };
}
async function member(c: Ctx, permissions: string[]) {
  const role = await request(app).post(`/api/orgs/${c.orgId}/roles`).set(at(c)).send({ name: `R ${rnd()}`, roleType: 'CUSTOM', permissions }).expect(201);
  const email = `m.${rnd()}@example.com`;
  const u = await request(app).post('/api/users').set(at(c)).send({ email, fullName: 'Member', password: 'Member!2026pass', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
  const id = u.body.user?.id || u.body.id;
  await request(app).post(`/api/orgs/${c.orgId}/users/${id}/roles`).set(at(c)).send({ roleId: role.body.role?.id || role.body.id }).expect(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'Member!2026pass' }).expect(200);
  return { ...c, token: login.body.token, userId: id as string, roleId: (role.body.role?.id || role.body.id) as string };
}
const api = (c: Ctx) => ({
  list: (q = '') => request(app).get(`/api/orgs/${c.orgId}/credentials${q}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/credentials${p}`).set(at(c)).send(b as any),
});

let c: Ctx;
beforeAll(async () => {
  c = await company();
}, 60_000);

describe('the list', () => {
  it('shows every machine credential with what it can do now, and never a token or hash', async () => {
    const made = await api(c).post('/api-keys', { name: 'Tally bridge', scopes: ['attendance:read'] }).expect(201);
    expect(made.body.token).toMatch(/^clor_/);
    await request(app).post(`/api/orgs/${c.orgId}/security/scim`).set(at(c)).expect(201);
    await request(app).post(`/api/orgs/${c.orgId}/attendance/integrations/agents`).set(at(c)).send({ name: 'Office server', tally: { host: '10.0.0.2', port: 9000, company: 'X' } }).expect(201);
    const r = await api(c).list().expect(200);
    expect(r.body.credentials.map((x: any) => x.kind).sort()).toEqual(['AGENT', 'API_KEY', 'SCIM']);
    const key = r.body.credentials.find((x: any) => x.kind === 'API_KEY');
    expect(key).toMatchObject({ label: 'Tally bridge', effective: 'ACTIVE', scopes: ['attendance:read'], createdBy: expect.any(String) });
    expect(new Date(key.expiresAt).getTime()).toBeGreaterThan(Date.now() + 360 * 864e5);
    const body = JSON.stringify(r.body);
    expect(body).not.toContain(made.body.token);
    expect(body).not.toContain('tokenHash');
  });

  it('says why a credential does not work although it is active on record', async () => {
    const d = await company();
    const a = await request(app).post(`/api/orgs/${d.orgId}/attendance/integrations/agents`).set(at(d)).send({ name: 'Gate PC', tally: { host: '10.0.0.2', port: 9000, company: 'X' } }).expect(201);
    await request(app).put(`/api/orgs/${d.orgId}/attendance/integrations/agents/${a.body.agent.id}`).set(at(d)).send({ name: 'Gate PC', isActive: false }).expect(200);
    const row = (await api(d).list().expect(200)).body.credentials.find((x: any) => x.kind === 'AGENT');
    expect(row).toMatchObject({ status: 'ACTIVE', effective: 'OWNER_OFF', owner: { name: 'Gate PC' } });
  });

  it('counts customer links rather than listing them, and only for someone with sales access', async () => {
    const r = await api(c).list().expect(200);
    expect(r.body.links).toEqual({ shareLinks: expect.any(Number), payLinks: expect.any(Number) });
    const viewer = await member(c, ['SETTINGS::Credentials::VIEW']);
    expect((await api(viewer).list().expect(200)).body.links).toBeNull();
  }, 60_000);
});

describe('who may do what', () => {
  it('view-only sees the list but cannot make a key', async () => {
    const v = await member(c, ['SETTINGS::Credentials::VIEW']);
    await api(v).list().expect(200);
    await api(v).post('/api-keys', { name: 'x', scopes: ['attendance:read'] }).expect(403);
  }, 60_000);

  it('directory-sync tokens are hidden from, and cannot be changed by, someone without Users', async () => {
    const m = await member(c, ['SETTINGS::Credentials::VIEW', 'SETTINGS::Credentials::CREATE', 'SETTINGS::Credentials::EDIT']);
    const list = (await api(m).list().expect(200)).body.credentials;
    expect(list.some((x: any) => x.kind === 'SCIM')).toBe(false);
    const scim = (await api(c).list().expect(200)).body.credentials.find((x: any) => x.kind === 'SCIM');
    expect((await api(m).post(`/${scim.id}/suspend`)).status).toBe(403);
    expect((await api(m).post(`/${scim.id}/rotate`)).status).toBe(403);
  }, 60_000);

  it('whoever manages integration keys today gets the new page at deploy, revoke included', async () => {
    const d = await company();
    const m = await member(d, ['ATTENDANCE::Attendance Integrations::VIEW', 'ATTENDANCE::Attendance Integrations::EDIT']);
    /*
     * As on a database whose catalogue has not got the new permission yet: the
     * migration makes it, then grants it. Done inside a transaction that is
     * rolled back, so other test files sharing the database never see the
     * permission missing.
     */
    const sql = fs.readFileSync(path.resolve('prisma/platform/migrations/20261024120600_credentials_permission_grant/migration.sql'), 'utf8');
    const statements = sql.split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
    const ROLLBACK = new Error('rollback');
    let actions: string[] = [];
    await outsideTenant('test: the grant migration on an unseeded catalogue', () =>
      platformPrisma
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`DELETE FROM "Permission" WHERE "module" = 'SETTINGS' AND "subModule" = 'Credentials'`);
          for (const st of statements) await tx.$executeRawUnsafe(st);
          /* The migration resets the bypass when it ends; the check reads across companies too. */
          await tx.$executeRawUnsafe(`SELECT set_config('clor.bypass', 'on', true)`);
          const rows = await tx.$queryRawUnsafe<Array<{ action: string }>>(
            `SELECT p."action" FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = $1 AND p."module" = 'SETTINGS' AND p."subModule" = 'Credentials'`,
            m.roleId
          );
          actions = rows.map((r) => r.action).sort();
          throw ROLLBACK;
        })
        .catch((e) => {
          if (e !== ROLLBACK) throw e;
        })
    );
    expect(actions).toEqual(['CREATE', 'EDIT', 'VIEW']);
    /* And for real, on this database, so the person can use the page. */
    await outsideTenant('test: the grant migration', async () => {
      for (const st of statements) await platformPrisma.$executeRawUnsafe(st);
    });
    const made = await api(m).post('/api-keys', { name: 'Payroll export', scopes: ['employees:read'] }).expect(201);
    await api(m).post(`/${made.body.credentialId}/revoke`, { reason: 'no longer used' }).expect(200);
  }, 90_000);
});

describe('changing one', () => {
  it('suspend, resume, extend, rotate, revoke — each in the company audit trail', async () => {
    const made = await api(c).post('/api-keys', { name: `K ${rnd()}`, scopes: ['attendance:read'] }).expect(201);
    const id = made.body.credentialId;
    await api(c).post(`/${id}/suspend`, { reason: 'checking' }).expect(200);
    expect((await request(app).get('/v1/ping').set('Authorization', `Bearer ${made.body.token}`)).status).toBe(403);
    await api(c).post(`/${id}/resume`).expect(200);
    await api(c).post(`/${id}/extend`, { expiresAt: new Date(Date.now() + 200 * 864e5).toISOString() }).expect(200);
    await api(c).post(`/${id}/extend`, { expiresAt: new Date(Date.now() + 800 * 864e5).toISOString() }).expect(400);
    const rotated = await api(c).post(`/${id}/rotate`).expect(200);
    await request(app).get('/v1/ping').set('Authorization', `Bearer ${rotated.body.token}`).expect(200);
    await api(c).post(`/${rotated.body.credentialId}/revoke`).expect(200);
    expect((await request(app).get('/v1/ping').set('Authorization', `Bearer ${rotated.body.token}`)).status).toBe(401);
    const trail = await request(app).get(`/api/orgs/${c.orgId}/audit?app=company`).set(at(c)).expect(200);
    const actions = JSON.stringify(trail.body);
    for (const a of ['CREATE', 'SUSPEND', 'RESUME', 'EXTEND', 'ROTATE', 'REVOKE']) expect(actions).toContain(a);
  });

  it('a connector’s token is rotated where it is installed, not here', async () => {
    const agent = (await api(c).list().expect(200)).body.credentials.find((x: any) => x.kind === 'AGENT');
    const r = await api(c).post(`/${agent.id}/rotate`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ROTATE_ELSEWHERE');
  });

  it('API keys cannot be made while Attendance is off', async () => {
    const d = await company();
    await request(app).put(`/api/orgs/${d.orgId}/features`).set(at(d)).send({ features: { attendance: false } }).expect(200);
    const r = await api(d).list().expect(200);
    expect(r.body.mayCreateApiKey).toBe(false);
    expect((await api(d).post('/api-keys', { name: 'x', scopes: ['attendance:read'] })).status).toBe(409);
  });
});
