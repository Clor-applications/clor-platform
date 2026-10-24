import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * GAP-010 (Batch 11): whatever gets past the write-time guards is found by
 * the cross-store check. Each kind of broken link is planted directly in the
 * database (as a crash between two writes, an old release, or a hand edit
 * would leave it) and must be found; the safe ones repaired, Payroll's
 * history only reported; another company's records never touched.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { issueCredential, SYSTEM } = await import('../services/credentials.js');
const { checkCompany } = await import('../services/integrity/checks.js');

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function company(): Promise<Ctx> {
  const email = `xc.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'XC owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `XC Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, accountId: claims.accountId, userId: claims.userId };
  await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { people: true, attendance: true, payroll: true } }).expect(200);
  return c;
}
const gone = () => `gone_${rnd()}${rnd()}`;

/** Plant one broken link of each kind in company c; returns the ids planted. */
async function plant(c: Ctx) {
  const emp = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Ravi Kumar', code: `C${rnd()}`, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  return outsideTenant('test: planting broken links', async () => {
    const base = { accountId: c.accountId, orgId: c.orgId };
    const access = await platformPrisma.userWarehouseAccess.create({ data: { ...base, branchId: c.branchId, warehouseId: gone(), userId: c.userId } });
    const perm = await platformPrisma.userPermission.create({ data: { ...base, userId: c.userId, entityType: 'CUSTOMER', entityId: gone(), createdByUserId: c.userId } });
    const cred = await issueCredential({ kind: 'DEVICE_PUSH', ...base, ownerId: gone(), token: `clorp_${rnd()}${rnd()}${rnd()}${rnd()}`, tokenPrefix: 'clorp_x', label: 'Lost reader', createdByUserId: c.userId }, SYSTEM);
    const profile = await payrollPrisma.employeePayrollProfile.create({ data: { ...base, employeeId: emp.id, costCenterId: gone(), createdByUserId: c.userId } });
    const orphanProfile = await payrollPrisma.employeePayrollProfile.create({ data: { ...base, employeeId: gone(), createdByUserId: c.userId } });
    const posting = await payrollPrisma.payrollPosting.create({ data: { ...base, branchId: c.branchId, runId: gone(), postingDate: '2026-09-30', status: 'POSTED', journalEntryId: gone(), createdByUserId: c.userId } });
    const leave = await peoplePrisma.leaveAdjustment.create({ data: { ...base, employeeId: emp.id, leaveTypeId: gone(), year: 2026, days: 2, reason: 'Encashed', paidInRunId: gone(), createdByUserId: c.userId } });
    return { access: access.id, perm: perm.id, cred: cred.id, profile: profile.id, orphanProfile: orphanProfile.id, posting: posting.id, leave: leave.id };
  });
}

let a: Ctx;
let b: Ctx;
let planted: Awaited<ReturnType<typeof plant>>;
let bPlanted: Awaited<ReturnType<typeof plant>>;
beforeAll(async () => {
  [a, b] = await Promise.all([company(), company()]);
  planted = await plant(a);
  bPlanted = await plant(b);
}, 120_000);

describe('the cross-store check', () => {
  it('finds every planted link, and touches nothing when only asked to look', async () => {
    const found = await checkCompany({ accountId: a.accountId, orgId: a.orgId });
    const bySource = new Map(found.map((f) => [f.sourceId, f]));
    for (const id of Object.values(planted)) expect(bySource.has(id), id).toBe(true);
    expect(found.every((f) => f.repair === 'REPORT')).toBe(true);
    expect(bySource.get(planted.profile)!.link).toMatch(/costCenterId/);
    expect(bySource.get(planted.orphanProfile)!.link).toMatch(/employeeId → people.Employee/);
    expect(bySource.get(planted.posting)!.link).toMatch(/journalEntryId/);
    expect(bySource.get(planted.leave)!.link).toMatch(/paidInRunId/);
    const stillThere = await outsideTenant('test', () => platformPrisma.userWarehouseAccess.count({ where: { id: planted.access } }));
    expect(stillThere).toBe(1);
  });

  it('repairs access and credentials, reports Payroll’s history, and leaves the other company alone', async () => {
    const found = await checkCompany({ accountId: a.accountId, orgId: a.orgId }, { repair: true });
    const status = Object.fromEntries(found.map((f) => [f.sourceId, f.repair]));
    expect(status).toMatchObject({ [planted.access]: 'REPAIRED', [planted.perm]: 'REPAIRED', [planted.cred]: 'REPAIRED', [planted.profile]: 'REPORT', [planted.orphanProfile]: 'REPORT', [planted.posting]: 'REPORT', [planted.leave]: 'REPORT' });

    const after = await outsideTenant('test', async () => ({
      access: await platformPrisma.userWarehouseAccess.count({ where: { id: planted.access } }),
      perm: await platformPrisma.userPermission.count({ where: { id: planted.perm } }),
      cred: (await platformPrisma.credential.findUnique({ where: { id: planted.cred } }))?.status,
      profile: await payrollPrisma.employeePayrollProfile.count({ where: { id: { in: [planted.profile, planted.orphanProfile] } } }),
      posting: (await payrollPrisma.payrollPosting.findUnique({ where: { id: planted.posting } }))?.status,
      bAccess: await platformPrisma.userWarehouseAccess.count({ where: { id: bPlanted.access } }),
      bCred: (await platformPrisma.credential.findUnique({ where: { id: bPlanted.cred } }))?.status,
    }));
    expect(after).toEqual({ access: 0, perm: 0, cred: 'REVOKED', profile: 2, posting: 'POSTED', bAccess: 1, bCred: 'ACTIVE' });

    const again = await checkCompany({ accountId: a.accountId, orgId: a.orgId }, { repair: true });
    expect(again.every((f) => f.repair === 'REPORT')).toBe(true);
    expect(again.map((f) => f.sourceId).sort()).toEqual([planted.profile, planted.orphanProfile, planted.posting, planted.leave].sort());
  });

  it('a company with nothing broken has nothing to report', async () => {
    const d = await company();
    expect(await checkCompany({ accountId: d.accountId, orgId: d.orgId })).toEqual([]);
  }, 60_000);
});
