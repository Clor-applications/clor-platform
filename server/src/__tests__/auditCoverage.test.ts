import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * A-50 / A-51 (Batch 8): who may do what — roles, role profiles, approval
 * rules, a person's roles, permissions, branches, warehouses and companies,
 * sign-in providers, directory-sync tokens — was changed with no record of
 * who changed it, and so was most of Accounting. Every such change now leaves
 * one audit row naming the person; changes to one's own login or inbox do
 * not; a route that writes its own row is not recorded twice; nothing secret
 * is written down.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `ac.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'AC owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `AC Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId };
}
const o = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown = {}) => request(app).put(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
  patch: (p: string, b: unknown = {}) => request(app).patch(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}${p}`).set(at(c)),
});

/** The audit rows written since `since`, newest last; the recorder writes after the response, so wait a moment. */
async function rowsSince(c: Ctx, since: Date) {
  await new Promise((r) => setTimeout(r, 150));
  return outsideTenant('test: the audit log', () =>
    platformPrisma.auditLog.findMany({ where: { orgId: c.orgId, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' } })
  );
}
/** Run a change; it must leave exactly one row, by this person. */
async function recorded(c: Ctx, change: () => Promise<{ status: number }>, expect_: { entity: string; message?: RegExp }) {
  const since = new Date();
  const r = await change();
  expect(r.status).toBeLessThan(300);
  const rows = await rowsSince(c, since);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ entity: expect_.entity, createdByUserId: c.userId });
  if (expect_.message) expect(rows[0].message).toMatch(expect_.message);
  return rows[0];
}

let c: Ctx;
let memberId: string;
let roleId: string;
beforeAll(async () => {
  c = await company();
  const u = await request(app).post('/api/users').set(at(c)).send({ email: `m.${rnd()}@example.com`, fullName: 'Member', password: 'Member!2026pass', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
  memberId = u.body.user?.id || u.body.id;
}, 60_000);

describe('who may do what (A-50)', () => {
  it('making and changing a role', async () => {
    const since = new Date();
    const r = await o(c).post('/roles', { name: `Clerk ${rnd()}`, roleType: 'CUSTOM', permissions: ['SALES::Invoices::VIEW'] });
    expect(r.status).toBe(201);
    roleId = r.body.role?.id || r.body.id;
    const rows = await rowsSince(c, since);
    expect(rows.filter((x) => x.entity === 'Role')).toHaveLength(1);
    expect(rows[0].message).toMatch(/Made a role/);
    await recorded(c, () => o(c).patch(`/roles/${roleId}`, { name: `Clerk ${rnd()}` }), { entity: 'Role', message: /Changed a role/ });
  });

  it('role profiles', async () => {
    const made = await recorded(c, () => o(c).post('/role-profiles', { name: `Desk ${rnd()}`, roleIds: [roleId] }), { entity: 'Role', message: /Made a role profile/ });
    const list = (await o(c).get('/role-profiles').expect(200)).body;
    const id = (list.profiles || list)[0].id;
    await recorded(c, () => o(c).put(`/role-profiles/${id}`, { name: `Desk ${rnd()}`, roleIds: [roleId] }), { entity: 'Role', message: /Changed a role profile/ });
    await recorded(c, () => o(c).post(`/users/${memberId}/role-profiles`, { profileIds: [id] }), { entity: 'User', message: /role profile/ });
    await recorded(c, () => o(c).del(`/role-profiles/${id}`), { entity: 'Role', message: /Removed a role profile/ });
    expect(made.metadata).not.toContain('Passw0rd');
  });

  it('approval rules', async () => {
    await recorded(c, () => o(c).post('/approval-rules', { docType: 'INVOICE', name: 'Big invoices', minAmount: 100000, approverRoleId: roleId }), { entity: 'ApprovalRule', message: /Added an approval rule/ });
    const rules = (await o(c).get('/approval-rules').expect(200)).body;
    const id = (rules.rules || rules)[0].id;
    await recorded(c, () => o(c).del(`/approval-rules/${id}`), { entity: 'ApprovalRule', message: /Removed an approval rule/ });
  });

  it('a person’s roles, permissions and branches', async () => {
    await recorded(c, () => o(c).post(`/users/${memberId}/roles`, { roleId }), { entity: 'User', message: /Gave a person a role/ });
    await recorded(c, () => o(c).put(`/users/${memberId}/role`, { roleId }), { entity: 'User', message: /Set a person’s role/ });
    await recorded(c, () => o(c).post(`/users/${memberId}/branches`, { branchIds: [c.branchId] }), { entity: 'User', message: /branches/ });
    const granted = await recorded(c, () => o(c).post(`/users/${memberId}/permissions`, { entityType: 'CUSTOMER', entityId: 'cust_1', label: 'Acme' }), { entity: 'User', message: /Gave a person a permission/ });
    const id = JSON.parse(String(granted.metadata || '{}'))?.ids?.[1];
    const perms = (await o(c).get(`/users/${memberId}/permissions`).expect(200)).body;
    const pid = id || (perms.permissions || perms)[0].id;
    await recorded(c, () => o(c).del(`/users/${memberId}/permissions/${pid}`), { entity: 'User', message: /Took a permission/ });
  });

  it('a person’s companies', async () => {
    await recorded(c, () => request(app).put(`/api/users/${memberId}/companies`).set(at(c)).send({ orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }), { entity: 'User', message: /companies/ });
  });

  it('directory-sync tokens, with the token itself never written down', async () => {
    const since = new Date();
    const made = await o(c).post('/security/scim').expect(201);
    const rows = await rowsSince(c, since);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: 'Credential', createdByUserId: c.userId });
    expect(JSON.stringify(rows)).not.toContain(made.body.token);
    await recorded(c, () => o(c).del(`/security/scim/${made.body.scim.id}`), { entity: 'Credential', message: /Revoked a directory-sync token/ });
  });

  it('the company trail lists them under Company', async () => {
    const r = await o(c).get('/audit?app=company&limit=200').expect(200);
    const entities = new Set((r.body.entries || r.body.logs || r.body.items || []).map((x: any) => x.entity));
    for (const e of ['Role', 'ApprovalRule', 'User', 'Credential']) expect(entities.has(e)).toBe(true);
  });
});

describe('Accounting and the rest (A-51)', () => {
  it('a ledger account is recorded in words; an invoice once', async () => {
    await recorded(c, () => o(c).post('/ledger/accounts', { name: `Bank ${rnd()}`, accountType: 'ASSET', controlKind: 'BANK' }), { entity: 'ACCOUNTING_LEDGER', message: /^Made a ledger account$/ });
    const since = new Date();
    const inv = await o(c).post('/invoices', { date: '2026-10-10', customerName: 'Asha Traders', subtotal: 100, gstTotal: 0, total: 100, items: [{ description: 'Service', quantity: 1, rate: 100, gstRate: 0 }] });
    expect(inv.status).toBe(201);
    const rows = await rowsSince(c, since);
    /* The invoice route writes its own entry; the recorder does not add a second. */
    expect(rows).toHaveLength(1);
    expect(rows[0].createdByUserId).toBe(c.userId);
  });
});

describe('what is not recorded, or not twice', () => {
  it('reading one’s own notifications is not a change anyone else sees', async () => {
    const since = new Date();
    await o(c).post('/notifications/inbox/read', { all: true });
    expect(await rowsSince(c, since)).toHaveLength(0);
  });

  it('a change that writes its own row is not recorded again', async () => {
    const since = new Date();
    await o(c).patch(`/users/${memberId}`, { fullName: 'Member Renamed' }).expect(200);
    expect(await rowsSince(c, since)).toHaveLength(1);
  });

  it('a refused change is not recorded', async () => {
    const since = new Date();
    const r = await o(c).post('/roles', {});
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await rowsSince(c, since)).toHaveLength(0);
  });
});
