import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { ROLE_PRESETS, expandPreset, isKnownPermission, flattenCatalog } from '../constants/permissionCatalog.js';

/**
 * The stock roles, and the one restriction that is not a permission.
 *
 * The preset list follows the tiers Odoo, ERPNext, QuickBooks and Zoho use,
 * so a business arriving from them finds the roles it expects. Each is a set
 * of catalogue rows, and one of them — Sales Representative — is also limited
 * to the documents its holder raised, Odoo's "Own Documents Only".
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string; userId: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});
const uid = () => `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

async function makeOwner(): Promise<Ctx> {
  const email = `preset.${uid()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Preset owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Preset Co ${uid()}`, state: 'Karnataka' })
    .expect(200);
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${signup.body.token}`).expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: me.body.user.id };
}

async function seededRole(name: string) {
  const roles = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
  const role = roles.body.roles.find((r: any) => r.name === name);
  if (!role) throw new Error(`No seeded role named ${name}`);
  return role;
}

/** A member holding exactly one seeded role. */
async function memberWith(roleName: string): Promise<Ctx> {
  const role = await seededRole(roleName);
  const email = `member.${uid()}@example.com`;
  const user = await request(app)
    .post('/api/users')
    .set(auth(owner))
    .send({
      email,
      fullName: roleName,
      password: 'Passw0rd!23',
      orgIds: [owner.orgId],
      branchIdsByOrg: { [owner.orgId]: [owner.branchId] },
    })
    .expect(201);
  await request(app)
    .post(`/api/orgs/${owner.orgId}/users/${user.body.user.id}/roles`)
    .set(auth(owner))
    .send({ roleId: role.id, branchId: null })
    .expect(201);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ emailOrUsername: email, password: 'Passw0rd!23' })
    .expect(200);
  return { token: login.body.token, orgId: owner.orgId, branchId: owner.branchId, userId: user.body.user.id };
}

const invoice = (customerName: string) => ({
  date: '2026-09-29',
  customerName,
  subtotal: 100,
  gstTotal: 0,
  total: 100,
  items: [{ description: 'Test', quantity: 1, rate: 100, gstRate: 0 }],
});

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('the preset catalogue', () => {
  it('expands every preset into catalogued permissions only, and never into nothing', () => {
    for (const key of Object.keys(ROLE_PRESETS)) {
      const rows = expandPreset(key);
      expect(`${key}: ${rows.length}`).not.toBe(`${key}: 0`);
      for (const r of rows) expect(isKnownPermission(r.module, r.subModule, r.action)).toBe(true);
    }
  });

  it('gives the Administrator everything and Reports Only nothing but reports', () => {
    expect(expandPreset('ADMIN').length).toBe(flattenCatalog().length);
    expect(expandPreset('REPORTS_ONLY').every((r) => r.module === 'REPORTS')).toBe(true);
  });

  it('holds a User tier inside its Manager tier for every module that has both', () => {
    const pairs: Array<[string, string]> = [
      ['SALES', 'SALES_MANAGER'],
      ['PURCHASE', 'PURCHASE_MANAGER'],
      ['STORE', 'STORE_MANAGER'],
      ['PAYROLL_USER', 'PAYROLL_MANAGER'],
      ['ACCOUNTANT', 'ACCOUNTS_MANAGER'],
      ['BILLING', 'ACCOUNTANT'],
    ];
    const keyOf = (r: { module: string; subModule: string; action: string }) => `${r.module}::${r.subModule}::${r.action}`;
    for (const [user, manager] of pairs) {
      const held = new Set(expandPreset(manager).map(keyOf));
      const missing = expandPreset(user).map(keyOf).filter((k) => !held.has(k));
      expect(`${manager} lacks: ${missing.join(', ')}`).toBe(`${manager} lacks: `);
    }
  });

  it('serves the presets with their type and own-documents flag for the matrix UI', async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/permissions/catalog`).set(auth(owner)).expect(200);
    const rep = res.body.presets.find((p: any) => p.key === 'SALES_REP');
    expect(rep).toMatchObject({ label: 'Sales Representative', roleType: 'SALES', ownDocumentsOnly: true });
    expect(res.body.presets.find((p: any) => p.key === 'PURCHASE').ownDocumentsOnly).toBe(false);
  });
});

describe('seeding', () => {
  it('materialises one role per preset, typed and flagged as the preset says', async () => {
    const roles = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    const byName = new Map(roles.body.roles.map((r: any) => [r.name, r]));
    for (const p of Object.values(ROLE_PRESETS)) {
      const role: any = byName.get(p.label);
      expect(`${p.label}: ${role ? 'seeded' : 'missing'}`).toBe(`${p.label}: seeded`);
      expect(`${p.label}: ${role.roleType}`).toBe(`${p.label}: ${p.roleType}`);
      expect(`${p.label}: ${role.ownDocumentsOnly}`).toBe(`${p.label}: ${Boolean(p.ownDocumentsOnly)}`);
    }
  });
});

describe('what each tier can do', () => {
  it('Purchase User records bills and cannot see sales', async () => {
    const buyer = await memberWith('Purchase User');
    await request(app).get(`/api/orgs/${owner.orgId}/bills`).set(auth(buyer)).expect(200);
    await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(buyer)).expect(403);
    await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(buyer)).expect(403);
  });

  it('Auditor reads everything and changes nothing', async () => {
    const auditor = await memberWith('Auditor');
    await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(auditor)).expect(200);
    await request(app).get(`/api/orgs/${owner.orgId}/bills`).set(auth(auditor)).expect(200);
    await request(app).post(`/api/orgs/${owner.orgId}/invoices`).set(auth(auditor)).send(invoice('Audit')).expect(403);
  });

  it('Reports Only cannot open the documents behind the reports', async () => {
    const reader = await memberWith('Reports Only');
    await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(reader)).expect(403);
    const me = await request(app).get(`/api/orgs/${owner.orgId}/permissions/me`).set(auth(reader)).expect(200);
    expect(me.body.permissions.every((k: string) => k.startsWith('REPORTS::'))).toBe(true);
  });

  it('Payroll User prepares payroll but cannot approve a run', async () => {
    const clerk = await memberWith('Payroll User');
    const me = await request(app).get(`/api/orgs/${owner.orgId}/permissions/me`).set(auth(clerk)).expect(200);
    expect(me.body.permissions).toContain('PAYROLL::Payroll Runs::CREATE');
    expect(me.body.permissions).not.toContain('PAYROLL::Payroll Runs::APPROVE');
    expect(me.body.permissions.some((k: string) => k.startsWith('SALES::'))).toBe(false);
  });
});

describe('own documents only', () => {
  let rep: Ctx;
  let theirs: string;
  let notTheirs: string;

  beforeAll(async () => {
    rep = await memberWith('Sales Representative');
    const a = await request(app).post(`/api/orgs/${owner.orgId}/invoices`).set(auth(owner)).send(invoice('Owner customer')).expect(201);
    const b = await request(app).post(`/api/orgs/${owner.orgId}/invoices`).set(auth(rep)).send(invoice('Rep customer')).expect(201);
    notTheirs = a.body.invoice.id;
    theirs = b.body.invoice.id;
  });

  it('is reported to the client', async () => {
    const me = await request(app).get(`/api/orgs/${owner.orgId}/permissions/me`).set(auth(rep)).expect(200);
    expect(me.body.ownDocumentsOnly).toBe(true);
    const mine = await request(app).get(`/api/orgs/${owner.orgId}/permissions/me`).set(auth(owner)).expect(200);
    expect(mine.body.ownDocumentsOnly).toBe(false);
  });

  it('lists only the documents the holder raised, while the owner sees all', async () => {
    const theirList = await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(rep)).expect(200);
    const ids = theirList.body.invoices.map((i: any) => i.id);
    expect(ids).toContain(theirs);
    expect(ids).not.toContain(notTheirs);

    const all = await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(owner)).expect(200);
    const allIds = all.body.invoices.map((i: any) => i.id);
    expect(allIds).toContain(theirs);
    expect(allIds).toContain(notTheirs);
  });

  it("answers 404, not 403, for somebody else's document — it does not exist for them", async () => {
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${notTheirs}`)
      .set(auth(rep))
      .send({ customerName: 'Taken over' })
      .expect(404);
    // No DELETE in the preset at all, so that is refused before ownership is asked.
    await request(app).delete(`/api/orgs/${owner.orgId}/invoices/${notTheirs}`).set(auth(rep)).expect(403);
    // Their own is found (a posted invoice may still refuse the edit itself,
    // which is the document's rule, not the role's).
    const own = await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${theirs}`)
      .set(auth(rep))
      .send({ customerName: 'Rep customer renamed' });
    expect(own.status).not.toBe(404);
    expect(own.status).not.toBe(403);
  });

  it('is lifted by any unrestricted role, since roles are additive', async () => {
    const viewer = await seededRole('Viewer');
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${rep.userId}/roles`)
      .set(auth(owner))
      .send({ roleId: viewer.id, branchId: owner.branchId })
      .expect(201);
    const me = await request(app).get(`/api/orgs/${owner.orgId}/permissions/me`).set(auth(rep)).expect(200);
    expect(me.body.ownDocumentsOnly).toBe(false);
    const list = await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(rep)).expect(200);
    expect(list.body.invoices.map((i: any) => i.id)).toContain(notTheirs);
  });

  it('can be set on a custom role from the role form', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Own docs ${uid()}`, ownDocumentsOnly: true, permissions: ['SALES::Invoices::VIEW'] })
      .expect(201);
    expect(created.body.role.ownDocumentsOnly).toBe(true);
    const updated = await request(app)
      .patch(`/api/orgs/${owner.orgId}/roles/${created.body.role.id}`)
      .set(auth(owner))
      .send({ ownDocumentsOnly: false })
      .expect(200);
    expect(updated.body.role.ownDocumentsOnly).toBe(false);
  });
});

describe('the role picker and the access panel', () => {
  it('files every stock role under its team, and the Owner under Administration', async () => {
    const roles = (await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200)).body.roles;
    const group = (name: string) => roles.find((r: any) => r.name === name)?.group;
    expect(group('Owner')).toBe('Administration');
    expect(group('Sales Representative')).toBe('Sales');
    expect(group('Payroll Manager')).toBe('Payroll');
    expect(group('Auditor')).toBe('Read-only');
    const made = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `Made here ${uid()}`, permissions: [] })
      .expect(201);
    const again = (await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200)).body.roles;
    expect(again.find((r: any) => r.id === made.body.role.id).group).toBe('Custom');
  });

  it("answers what one person can do, including a role that applies to one branch only", async () => {
    const buyer = await memberWith('Purchase User');
    const viewer = await seededRole('Viewer');
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${buyer.userId}/roles`)
      .set(auth(owner))
      .send({ roleId: viewer.id, branchId: owner.branchId })
      .expect(201);

    const res = await request(app).get(`/api/orgs/${owner.orgId}/users/${buyer.userId}/access`).set(auth(owner)).expect(200);
    const names = res.body.roles.map((r: any) => `${r.name} | ${r.scope}`);
    expect(names).toContain('Purchase User | Whole company');
    expect(names.some((n: string) => n.startsWith('Viewer | Branch: '))).toBe(true);
    expect(res.body.permissions).toContain('PURCHASE::Bills::CREATE');
    expect(res.body.isAdmin).toBe(false);

    // Somebody who may not see users may not ask. (The buyer above now may:
    // Viewer includes seeing the user list.)
    const otherBuyer = await memberWith('Purchase User');
    await request(app).get(`/api/orgs/${owner.orgId}/users/${owner.userId}/access`).set(auth(otherBuyer)).expect(403);
  });
});
