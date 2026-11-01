import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * A permission added in a release reached no existing company's Owner: the
 * backfill ran only from deploy.sh (Cloud Run deploys never call it) and had
 * been asking the accounting database for companies and roles since those
 * moved to the platform database, so it stopped with "Cannot read properties
 * of undefined (reading 'findMany')". Found when the People build's new
 * Documents permission answered 403 to a company's own owner.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { syncOwnerPermissions } = await import('../services/ownerPermissions.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

let c: { token: string; orgId: string; branchId: string; accountId: string };
let ownerRoleId: string;
let docsPermId: string;
beforeAll(async () => {
  const email = `op.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'OP owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `OP Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: (jwt.decode(signup.body.token) as any).accountId };
  await outsideTenant('test: an Owner short of one permission, as after a release added it', async () => {
    ownerRoleId = (await platformPrisma.role.findFirstOrThrow({ where: { orgId: c.orgId, name: 'Owner' } })).id;
    const perm = await platformPrisma.permission.findFirstOrThrow({ where: { module: 'SETTINGS', subModule: 'Users', action: 'VIEW' } });
    docsPermId = perm.id;
    await platformPrisma.rolePermission.deleteMany({ where: { roleId: ownerRoleId, permissionId: perm.id } });
  });
}, 60_000);

const held = () => outsideTenant('test', () => platformPrisma.rolePermission.count({ where: { roleId: ownerRoleId, permissionId: docsPermId } }));

describe('Owner roles get the permissions a release adds', () => {
  it('the report finds the gap and writes nothing', async () => {
    const lines: string[] = [];
    const r = await outsideTenant('test: report', () => syncOwnerPermissions(platformPrisma, { log: (l) => lines.push(l) }));
    expect(r.missing).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes('missing from Owner'))).toBe(true);
    expect(await held()).toBe(0);
  });

  it('with fix, the Owner holds it again and the page opens', async () => {
    expect((await request(app).get(`/api/orgs/${c.orgId}/users`).set({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId })).status).toBe(403);
    await outsideTenant('test: fix', () => syncOwnerPermissions(platformPrisma, { fix: true, log: () => {} }));
    expect(await held()).toBe(1);
    await request(app).get(`/api/orgs/${c.orgId}/users`).set({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId }).expect(200);
  });

  it('the operator script runs (it stopped with an error before)', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backfillOwnerPermissions.ts'], { env: process.env, encoding: 'utf8', timeout: 120_000 });
    expect(r.stderr).not.toMatch(/Backfill failed/);
    expect(r.status).toBe(0);
  }, 150_000);
});
