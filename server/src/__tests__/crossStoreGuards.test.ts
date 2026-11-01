import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * GAP-010 (Batch 11): records in one database name records in another by id,
 * with no foreign key to keep them honest. Where a delete or a reversal could
 * leave such a name pointing at nothing, or a write could put one there in
 * the first place, the write now refuses or tidies up after itself:
 * - a cost centre payroll uses is not deleted (switch it off instead);
 * - deleting a cost centre, customer or vendor takes away the per-person
 *   access that named it; deleting a warehouse, the warehouse access;
 * - deleting a reader revokes its push address at once, not at the next
 *   nightly sweep;
 * - a journal Payroll posted is not reversed from Accounting, where Payroll
 *   would go on showing it posted;
 * - per-person access can only name a customer, vendor or cost centre that
 *   exists in the company.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { prisma } = await import('../utils/prisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { issueCredential, verifyCredential, SYSTEM } = await import('../services/credentials.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `xs.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'XS owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `XS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
  return c;
}
const o = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}${p}`).set(at(c)).send(b as any),
  del: (p: string) => request(app).delete(`/api/orgs/${c.orgId}${p}`).set(at(c)),
});
const costCentre = async (c: Ctx) => (await o(c).post('/masters', { kind: 'COST_CENTER', name: `CC ${rnd()}` }).expect(201)).body.master.id as string;
const permissionsOf = (c: Ctx, entityId: string) =>
  outsideTenant('test: per-person access', () => platformPrisma.userPermission.count({ where: { orgId: c.orgId, entityId } }));

let c: Ctx;
let memberId: string;
beforeAll(async () => {
  c = await company();
  const u = await request(app).post('/api/users').set(at(c)).send({ email: `m.${rnd()}@example.com`, fullName: 'Member', password: 'Member!2026pass', orgIds: [c.orgId], branchIdsByOrg: { [c.orgId]: [c.branchId] } }).expect(201);
  memberId = u.body.user?.id || u.body.id;
}, 60_000);

describe('deleting what another database names', () => {
  it('a cost centre payroll uses stays; one nobody uses goes, with the access that named it', async () => {
    const used = await costCentre(c);
    const emp = (await o(c).post('/people/employees', { name: 'Asha Rao', code: `X${rnd()}`, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    await outsideTenant('test: a payroll profile on that cost centre', () =>
      payrollPrisma.employeePayrollProfile.create({ data: { accountId: c.accountId, orgId: c.orgId, employeeId: emp.id, costCenterId: used, createdByUserId: c.userId } })
    );
    const refused = await o(c).del(`/masters/${used}`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('USED_BY_PAYROLL');

    const free = await costCentre(c);
    await o(c).post(`/users/${memberId}/permissions`, { entityType: 'COST_CENTRE', entityId: free, label: 'Free' }).expect(201);
    expect(await permissionsOf(c, free)).toBe(1);
    await o(c).del(`/masters/${free}`).expect(200);
    expect(await permissionsOf(c, free)).toBe(0);
  });

  it('a customer, deleted, takes the access that named it', async () => {
    const cust = (await o(c).post('/customers', { name: `Acme ${rnd()}` }).expect(201)).body;
    const id = cust.customer?.id || cust.party?.id || cust.id;
    await o(c).post(`/users/${memberId}/permissions`, { entityType: 'CUSTOMER', entityId: id, label: 'Acme' }).expect(201);
    const r = await o(c).del(`/customers/${id}`).expect(200);
    expect(r.body.deactivated).toBe(false);
    expect(await permissionsOf(c, id)).toBe(0);
  });

  it('a warehouse, deleted, takes the warehouse access', async () => {
    const wh = (await o(c).post('/warehouses', { name: `WH ${rnd()}`, code: `W${rnd()}`, branchId: c.branchId }).expect(201)).body.warehouse.id;
    await o(c).post(`/users/${memberId}/warehouses`, { warehouseIds: [wh] }).expect(200);
    const count = () => outsideTenant('test: warehouse access', () => platformPrisma.userWarehouseAccess.count({ where: { orgId: c.orgId, warehouseId: wh } }));
    expect(await count()).toBe(1);
    await o(c).del(`/warehouses/${wh}`).expect(200);
    expect(await count()).toBe(0);
  });

  it('a reader, deleted, stops its push address at once', async () => {
    const token = `clorp_${rnd()}${rnd()}${rnd()}${rnd()}`;
    const device = await outsideTenant('test: a reader', () =>
      peoplePrisma.attendanceDevice.create({ data: { accountId: c.accountId, orgId: c.orgId, serialNumber: `SN${rnd()}${rnd()}`, name: 'Gate', vendor: 'HIKVISION', createdByUserId: c.userId } })
    );
    const issued = await issueCredential({ kind: 'DEVICE_PUSH', accountId: c.accountId, orgId: c.orgId, ownerId: device.id, token, tokenPrefix: token.slice(0, 12), label: 'Gate', createdByUserId: c.userId }, SYSTEM);
    await o(c).del(`/attendance/devices/${device.id}`).expect(200);
    const row = await outsideTenant('test: the credential', () => platformPrisma.credential.findUnique({ where: { id: issued.id } }));
    expect(row?.status).toBe('REVOKED');
    expect((await verifyCredential('DEVICE_PUSH', token).catch((e) => e))?.ok ?? false).toBe(false);
  });
});

describe('a journal Payroll posted is reversed in Payroll', () => {
  async function journal() {
    const accounts = (await o(c).get('/ledger/accounts').expect(200)).body.accounts;
    const ar = accounts.find((a: any) => a.controlKind === 'AR');
    const sales = accounts.find((a: any) => a.controlKind === 'SALES');
    return (
      await o(c).post('/ledger/entries', { date: '2026-08-16', journalCode: 'JV', narration: 'x', lines: [{ ledgerAccountId: ar.id, debit: 100 }, { ledgerAccountId: sales.id, credit: 100 }] }).expect(201)
    ).body.entry.id as string;
  }

  it('refused from Accounting, with the reason', async () => {
    const id = await journal();
    await outsideTenant('test: as Payroll posts it', () => prisma.journalEntry.update({ where: { id }, data: { sourceDocType: 'PAYROLL_RUN', sourceDocId: `run_${rnd()}` } }));
    const r = await o(c).post(`/ledger/entries/${id}/reverse`, {});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('POSTED_BY_PAYROLL');
  });

  it('a manual journal still reverses', async () => {
    const id = await journal();
    await o(c).post(`/ledger/entries/${id}/reverse`, {}).expect(201);
  });
});

describe('per-person access names something real', () => {
  it.each([['CUSTOMER'], ['VENDOR'], ['COST_CENTRE']])('%s that does not exist is refused', async (entityType) => {
    const r = await o(c).post(`/users/${memberId}/permissions`, { entityType, entityId: `missing_${rnd()}`, label: 'Ghost' });
    expect(r.status).toBe(400);
  });

  it('another company’s customer is refused', async () => {
    const d = await company();
    const cust = (await o(d).post('/customers', { name: `Theirs ${rnd()}` }).expect(201)).body;
    const id = cust.customer?.id || cust.party?.id || cust.id;
    expect((await o(c).post(`/users/${memberId}/permissions`, { entityType: 'CUSTOMER', entityId: id, label: 'Theirs' })).status).toBe(400);
  }, 60_000);
});

describe('Payroll names only Accounting records that exist', () => {
  const component = (code: string, extra: Record<string, unknown> = {}) =>
    o(c).post('/payroll/components', { name: code, code, type: 'EARNING', calculationMethod: 'PERCENTAGE', percentage: 100, calculationBase: 'MONTHLY_CTC', ...extra });

  it('a payroll employee on a cost centre that does not exist is refused; on a real one, kept', async () => {
    const bad = await o(c).post('/payroll/employees', { name: 'Ghost CC', code: `G${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', costCenterId: `missing_${rnd()}` } });
    expect(bad.status).toBe(400);
    const cc = await costCentre(c);
    await o(c).post('/payroll/employees', { name: 'Real CC', code: `R${rnd()}`, dateOfJoining: '2026-01-01', status: 'ACTIVE', payroll: { payrollStatus: 'IN_PAYROLL', taxRegime: 'NEW', costCenterId: cc } }).expect(201);
  });

  it('a salary component posting to a ledger that does not exist is refused', async () => {
    expect((await component(`X${rnd().toUpperCase()}`, { expenseLedgerId: `missing_${rnd()}` })).status).toBe(400);
    const ledgers = (await o(c).get('/ledger/accounts').expect(200)).body.accounts;
    const expense = ledgers.find((a: any) => a.accountType === 'EXPENSE' && a.isActive !== false);
    await component(`Y${rnd().toUpperCase()}`, { expenseLedgerId: expense.id }).expect(201);
  });
});
