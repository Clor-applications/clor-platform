import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * One listening server for the whole file, not one per request.
 *
 * supertest given an Express app binds a fresh ephemeral-port listener for
 * every single request; a run makes thousands of listen/close cycles, and
 * the suite's residual flake was a raw Node-level 400 "Bad Request" that
 * never reached Express (absent from both morgan and the anomaly log) —
 * socket churn, not application behaviour. Given an already-listening
 * server, supertest reuses it.
 */
const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `rbac.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'RBAC owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `RBAC Co ${Date.now()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

/** Creates a user with one role holding exactly the given permission keys. */
async function makeUserWithPermissions(keys: string[], roleName: string) {
  const role = await request(app)
    .post(`/api/orgs/${owner.orgId}/roles`)
    .set(auth(owner))
    .send({ name: `${roleName} ${Math.random().toString(36).slice(2, 6)}`, roleType: 'CUSTOM', permissions: [] })
    .expect(201);
  const roleId = role.body.role.id;

  await request(app)
    .put(`/api/orgs/${owner.orgId}/roles/${roleId}/permissions`)
    .set(auth(owner))
    .send({ permissions: keys })
    .expect(200);

  const email = `member.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const user = await request(app)
    .post('/api/users')
    .set(auth(owner))
    .send({
      email,
      fullName: 'Member',
      password: 'Passw0rd!23',
      orgIds: [owner.orgId],
      branchIdsByOrg: { [owner.orgId]: [owner.branchId] },
    })
    .expect(201);

  await request(app)
    .post(`/api/orgs/${owner.orgId}/users/${user.body.user.id}/roles`)
    .set(auth(owner))
    .send({ roleId, branchId: null })
    .expect(201);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ emailOrUsername: email, password: 'Passw0rd!23' })
    .expect(200);

  return { token: login.body.token as string, orgId: owner.orgId, branchId: owner.branchId, roleId };
}

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('permission catalog', () => {
  it('serves modules and resources for the matrix UI', async () => {
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/permissions/catalog`)
      .set(auth(owner))
      .expect(200);

    const keys = res.body.modules.map((m: any) => m.key);
    expect(keys).toContain('SALES');
    expect(keys).toContain('ACCOUNTING');
    expect(keys).toContain('SETTINGS');

    const sales = res.body.modules.find((m: any) => m.key === 'SALES');
    const invoices = sales.resources.find((r: any) => r.key === 'Invoices');
    expect(invoices.actions).toEqual(expect.arrayContaining(['VIEW', 'CREATE', 'EDIT', 'DELETE']));

    // Reports are read-only by construction: no CREATE anywhere in the module.
    const reports = res.body.modules.find((m: any) => m.key === 'REPORTS');
    for (const r of reports.resources) expect(r.actions).not.toContain('CREATE');

    expect(res.body.presets.map((p: any) => p.key)).toEqual(
      expect.arrayContaining(['ADMIN', 'ACCOUNTANT', 'SALES', 'STORE', 'VIEWER'])
    );
  });

  it('gives the org creator the full administrator set', async () => {
    const me = await request(app).get(`/api/orgs/${owner.orgId}/permissions/me`).set(auth(owner)).expect(200);
    expect(me.body.permissions).toContain('SALES::Invoices::CREATE');
    expect(me.body.permissions).toContain('SETTINGS::Roles::EDIT');
    expect(me.body.permissions).toContain('ACCOUNTING::Ledger::APPROVE');
    expect(me.body.permissions.length).toBeGreaterThan(50);
  });
});

describe('role permission matrix', () => {
  it('saves and reads back exactly what was ticked', async () => {
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Matrix ${Date.now()}`, roleType: 'CUSTOM', permissions: [] })
      .expect(201);

    const wanted = ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE', 'REPORTS::Trial Balance::VIEW'];
    await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}/permissions`)
      .set(auth(owner))
      .send({ permissions: wanted })
      .expect(200);

    const read = await request(app)
      .get(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}/permissions`)
      .set(auth(owner))
      .expect(200);

    expect(read.body.permissions.sort()).toEqual([...wanted].sort());
  });

  it('removes permissions that were unticked', async () => {
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Shrink ${Date.now()}`, roleType: 'CUSTOM', permissions: [] })
      .expect(201);
    const roleId = role.body.role.id;
    const url = `/api/orgs/${owner.orgId}/roles/${roleId}/permissions`;

    await request(app).put(url).set(auth(owner)).send({ permissions: ['SALES::Invoices::VIEW', 'SALES::Invoices::DELETE'] }).expect(200);
    await request(app).put(url).set(auth(owner)).send({ permissions: ['SALES::Invoices::VIEW'] }).expect(200);

    const read = await request(app).get(url).set(auth(owner)).expect(200);
    expect(read.body.permissions).toEqual(['SALES::Invoices::VIEW']);
  });

  it('rejects a permission that is not in the catalog', async () => {
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Bogus ${Date.now()}`, roleType: 'CUSTOM', permissions: [] })
      .expect(201);

    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}/permissions`)
      .set(auth(owner))
      .send({ permissions: ['SALES::Invoices::SUPERPOWER'] })
      .expect(400);

    expect(String(res.body.error)).toMatch(/unknown permission/i);
  });

  it('expands a preset into concrete permissions', async () => {
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Preset ${Date.now()}`, roleType: 'CUSTOM', permissions: [] })
      .expect(201);

    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}/permissions/preset`)
      .set(auth(owner))
      .send({ preset: 'SALES' })
      .expect(200);

    expect(res.body.permissions).toContain('SALES::Invoices::CREATE');
    expect(res.body.permissions).toContain('MASTERS::Customers::VIEW');
    // A sales user must not get ledger write access from a preset.
    expect(res.body.permissions).not.toContain('ACCOUNTING::Ledger::CREATE');
    expect(res.body.permissions).not.toContain('SETTINGS::Users::CREATE');
  });
});

describe('enforcement follows the matrix', () => {
  it('grants exactly the ticked actions and denies the rest', async () => {
    const clerk = await makeUserWithPermissions(
      ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'],
      'Clerk'
    );
    const h = auth(clerk);

    await request(app).get(`/api/orgs/${clerk.orgId}/invoices`).set(h).expect(200);

    const created = await request(app)
      .post(`/api/orgs/${clerk.orgId}/invoices`)
      .set(h)
      .send({ number: `RB-${Date.now()}`, date: '2026-08-17', customerName: 'X', subtotal: 100, total: 100, items: [] })
      .expect(201);

    await request(app)
      .delete(`/api/orgs/${clerk.orgId}/invoices/${created.body.invoice.id}`)
      .set(h)
      .expect(403);

    // No settings permission at all.
    await request(app).get(`/api/orgs/${clerk.orgId}/users`).set(h).expect(403);
  });

  it('reflects a permission change without the user re-logging in', async () => {
    const viewer = await makeUserWithPermissions(['SALES::Invoices::VIEW'], 'Viewer');
    const h = auth(viewer);

    await request(app)
      .post(`/api/orgs/${viewer.orgId}/invoices`)
      .set(h)
      .send({ number: `RB2-${Date.now()}`, date: '2026-08-17', customerName: 'X', subtotal: 50, total: 50, items: [] })
      .expect(403);

    await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${viewer.roleId}/permissions`)
      .set(auth(owner))
      .send({ permissions: ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'] })
      .expect(200);

    // Same token, no re-login: permissions are read per request, not baked into the JWT.
    await request(app)
      .post(`/api/orgs/${viewer.orgId}/invoices`)
      .set(h)
      .send({ number: `RB3-${Date.now()}`, date: '2026-08-17', customerName: 'X', subtotal: 50, total: 50, items: [] })
      .expect(201);
  });

  it('reports the effective set and document restrictions to the client', async () => {
    const store = await makeUserWithPermissions(['INVENTORY::Stock Transfer::VIEW'], 'Store');

    const me = await request(app)
      .get(`/api/orgs/${store.orgId}/permissions/me`)
      .set(auth(store))
      .expect(200);

    expect(me.body.permissions).toEqual(['INVENTORY::Stock Transfer::VIEW']);
    expect(me.body.restrictions.branchIds).toContain(owner.branchId);
    expect(me.body.roles[0].name).toMatch(/^Store/);
  });

  it('does not let a user edit roles without SETTINGS::Roles::EDIT', async () => {
    const clerk = await makeUserWithPermissions(['SALES::Invoices::VIEW'], 'NoAdmin');

    await request(app)
      .put(`/api/orgs/${clerk.orgId}/roles/${clerk.roleId}/permissions`)
      .set(auth(clerk))
      .send({ permissions: ['SETTINGS::Users::CREATE'] })
      .expect(403);
  });
});
