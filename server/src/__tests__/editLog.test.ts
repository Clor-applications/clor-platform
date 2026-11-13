import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '../generated/platform/index.js';

/**
 * The edit log's before and after values (Rule 3(1); platform audit, 11 Nov 2026), and the changes that must
 * not be made without their audit entry (middleware/auditMutations.ts EDIT_LOG, "Written together").
 */
const { buildApp } = await import('../app.js');
const { diffSnapshots } = await import('../services/auditDiff.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
/* The database owner, to make the audit table refuse a row for a moment (the application role may not make triggers). */
const ownerUrl = () => {
  const url = new URL(String(process.env.PG_ADMIN_URL));
  url.pathname = new URL(String(process.env.PLATFORM_DATABASE_URL)).pathname;
  url.search = '?schema=platform';
  return url.toString();
};
const owner = new PrismaClient({ datasources: { db: { url: ownerUrl() } } });
const refuseAudit = async () => {
  await owner.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION platform.edit_log_test_refuse() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit store unavailable (test)'; END $$ LANGUAGE plpgsql`);
  await owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS edit_log_test_refuse ON platform."AuditLog"`);
  await owner.$executeRawUnsafe(`CREATE TRIGGER edit_log_test_refuse BEFORE INSERT ON platform."AuditLog" FOR EACH ROW EXECUTE FUNCTION platform.edit_log_test_refuse()`);
};
const allowAudit = () => owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS edit_log_test_refuse ON platform."AuditLog"`);
afterAll(async () => {
  await allowAudit().catch(() => null);
  await owner.$executeRawUnsafe(`DROP FUNCTION IF EXISTS platform.edit_log_test_refuse() CASCADE`).catch(() => null);
  await owner.$disconnect();
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
let c: Ctx;
beforeAll(async () => {
  const signup = await request(app).post('/api/auth/signup').send({ email: `elog.${Date.now()}.${rnd()}@example.com`, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Edit Log Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true } }).expect(200);
}, 90_000);

const api = (m: 'get' | 'post' | 'put' | 'patch' | 'delete', p: string, b?: unknown) => (request(app) as any)[m](`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any);
/* Entries written after the answer: give them a moment. */
const trail = async (q = '') => {
  await new Promise((r) => setTimeout(r, 250));
  return (await api('get', `/audit?limit=200${q}`).expect(200)).body.entries as any[];
};

describe('the diff itself', () => {
  it('lists what changed, by path, and masks what is never written', () => {
    const d = diffSnapshots(
      { name: 'Clerk', pan: 'ABCDE1234F', aadhaarNumber: '1234 5678 9012', bankAccountNumber: '001122', password: 'x', apiToken: 't1', marks: { on: false, grace: 10 }, updatedAt: new Date('2026-01-01'), same: 1 },
      { name: 'Senior clerk', pan: 'ZZZZZ9999Z', aadhaarNumber: '9999 8888 7777', bankAccountNumber: '334455', password: 'y', apiToken: 't2', marks: { on: true, grace: 10 }, updatedAt: new Date('2026-02-01'), same: 1 }
    )!;
    expect(d.name).toEqual({ from: 'Clerk', to: 'Senior clerk' });
    expect(d['marks.on']).toEqual({ from: false, to: true });
    for (const k of ['pan', 'aadhaarNumber', 'bankAccountNumber', 'password', 'apiToken']) expect(d[k]).toEqual({ from: '[hidden]', to: '[hidden]' });
    expect(d).not.toHaveProperty('same');
    expect(d).not.toHaveProperty('updatedAt');
    expect(d).not.toHaveProperty('marks.grace');
    expect(JSON.stringify(d)).not.toMatch(/ABCDE|ZZZZZ|1234 5678|001122|334455|t1|t2/);
    expect(diffSnapshots({ a: 1 }, { a: 1 })).toBeNull();
    expect(diffSnapshots(null, { a: 1 })).toEqual({ a: { from: null, to: 1 } });
  });
});

describe('before and after values in the audit trail', () => {
  let roleId = '';
  it('a role change carries its name and permissions, before and after, in one entry written with it', async () => {
    roleId = (await api('post', '/roles', { name: `Clerks ${rnd()}`, permissions: ['PEOPLE::Employees::VIEW'] }).expect(201)).body.role.id;
    const before = (await trail('&app=company')).filter((e) => e.entityId === roleId).length;
    await api('patch', `/roles/${roleId}`, { name: 'Senior clerks', permissions: ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::EDIT'] }).expect(200);
    const rows = (await trail('&app=company')).filter((e) => e.entityId === roleId);
    expect(rows.length).toBe(before + 1);
    const e = rows[0];
    expect(e.message).toBe('Changed a role');
    expect(e.changes.name.to).toBe('Senior clerks');
    expect(e.changes.name.from).toMatch(/^Clerks /);
    expect(e.changes.permissions.from).toEqual(['PEOPLE::Employees::VIEW']);
    expect(e.changes.permissions.to).toEqual(['PEOPLE::Employees::EDIT', 'PEOPLE::Employees::VIEW']);
  });

  it('a sign-in provider: the secret is masked, the rest shown', async () => {
    const domain = `elog-${rnd()}.example.com`;
    const p = (await api('post', '/security/providers', { kind: 'OIDC', name: 'Directory', discoveryUrl: 'https://login.example.com/.well-known/openid-configuration', clientId: 'abc-123', clientSecret: 'first-secret-value', emailDomains: domain }).expect(201)).body.provider;
    await api('patch', `/security/providers/${p.id}`, { kind: 'OIDC', name: 'Staff directory', discoveryUrl: 'https://login.example.com/.well-known/openid-configuration', clientId: 'abc-456', clientSecret: 'second-secret-value', emailDomains: domain }).expect(200);
    const e = (await trail('&app=company')).find((x) => x.entityId === p.id && x.action === 'UPDATE');
    expect(e.changes.name).toEqual({ from: 'Directory', to: 'Staff directory' });
    expect(e.changes.clientId).toEqual({ from: 'abc-123', to: 'abc-456' });
    expect(e.changes.clientSecretEnc).toEqual({ from: '[hidden]', to: '[hidden]' });
    expect(JSON.stringify(e)).not.toMatch(/first-secret|second-secret/);
  });

  it('an employee master change and a company setting carry their fields', async () => {
    const emp = (await api('post', '/people/employees', { name: 'Ravi Menon', code: `EL-${rnd()}`, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    await api('put', `/people/employees/${emp.id}`, { name: 'Ravi K Menon' }).expect(200);
    const e = (await trail('&app=attendance')).find((x) => x.entityId === emp.id && x.action === 'UPDATE');
    expect(e.changes.name).toEqual({ from: 'Ravi Menon', to: 'Ravi K Menon' });
    expect(e.changes).not.toHaveProperty('portalPasswordHash');

    const was = Boolean((await api('get', '/features').expect(200)).body.features?.payroll);
    await api('put', '/features', { features: { payroll: !was } }).expect(200);
    const f = (await trail('&app=company')).find((x) => x.entity === 'Features');
    expect(f.changes.payroll.to).toBe(!was);
  });

  it('a change that alters nothing carries no diff', async () => {
    const shown = (await api('get', `/roles`).expect(200)).body.roles.find((r: any) => r.id === roleId);
    await api('patch', `/roles/${roleId}`, { name: shown.name }).expect(200);
    const rows = (await trail('&app=company')).filter((e) => e.entityId === roleId);
    expect(rows[0].changes).toBeNull();
  });
});

describe('a change to who may do what is not made without its entry', () => {
  it('a forced audit failure refuses a role change with a 503 and leaves the role as it was', async () => {
    const role = (await api('post', '/roles', { name: `Auditors ${rnd()}`, permissions: ['PEOPLE::Employees::VIEW'] }).expect(201)).body.role;
    await refuseAudit();
    try {
      const r = await api('patch', `/roles/${role.id}`, { name: 'Renamed', permissions: ['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::DELETE'] });
      expect(r.status).toBe(503);
      expect(r.body.error).toMatch(/^Not changed: the audit log could not record this change/);
      expect(r.body.code).toBe('AUDIT_UNAVAILABLE');
      /* Deleting it: refused the same way, and it is still there. */
      expect((await api('delete', `/roles/${role.id}`)).status).toBe(503);
      /* Everything else keeps "never delays the request": an employee change goes through without its entry. */
      expect((await api('post', '/people/employees', { name: 'Leela Rao', code: `EL-${rnd()}`, dateOfJoining: '2026-01-01' })).status).toBe(201);
    } finally {
      await allowAudit();
    }
    const stored = await platformPrisma.role.findFirst({ where: { id: role.id }, include: { permissions: { include: { permission: true } } } });
    expect(stored?.name).toBe(role.name);
    expect(stored?.permissions.map((p) => p.permission.action).sort()).toEqual(['VIEW']);
    /* And with the log back, the same change is made and recorded. */
    await api('patch', `/roles/${role.id}`, { name: 'Renamed' }).expect(200);
    const e = (await trail('&app=company')).find((x) => x.entityId === role.id && x.action === 'UPDATE');
    expect(e.changes.name).toEqual({ from: role.name, to: 'Renamed' });
  });
});
