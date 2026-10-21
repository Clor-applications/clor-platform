import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * The imports added for the production audit (AT-02): opening leave balances,
 * leave already taken, and contractors. Each checks every row first (dryRun)
 * and names the rows it refuses.
 */
const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(): Promise<Ctx> {
  const email = `imp.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Import Co ${rnd()}`, state: 'Karnataka' }).expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features: { people: true, attendance: true } }).expect(200);
  return ctx;
}
const att = (c: Ctx, p: string, b: unknown) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any);

let c: Ctx;
let asha: any;
let casualId = '';
beforeAll(async () => {
  c = await makeOwner();
  asha = (await request(app).post(`/api/orgs/${c.orgId}/people/employees`).set(at(c)).send({ name: 'Asha', code: 'E1', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
  casualId = (await att(c, '/leave/types', { name: 'Casual', annualDays: 12 }).expect(201)).body.type.id;
}, 60_000);

describe('opening leave balances', () => {
  it('checks first, then sets each person’s days for the year, naming bad rows', async () => {
    const rows = [
      { employeeCode: 'E1', leaveType: 'Casual', year: '2026', days: '7.5' },
      { employeeCode: 'NOPE', leaveType: 'Casual', year: '2026', days: '3' },
      { employeeCode: 'E1', leaveType: 'Sick', year: '2026', days: '3' },
    ];
    const check = (await att(c, '/leave/allocations/import', { rows, dryRun: true }).expect(200)).body;
    expect(check).toMatchObject({ dryRun: true, imported: 1, failed: 2 });
    expect(await peoplePrisma.leaveAllocation.count({ where: { orgId: c.orgId } })).toBe(0);

    const done = (await att(c, '/leave/allocations/import', { rows }).expect(200)).body;
    expect(done.imported).toBe(1);
    expect(done.results.map((r: any) => r.row)).toEqual([2, 3]);
    const a = await peoplePrisma.leaveAllocation.findFirstOrThrow({ where: { orgId: c.orgId, employeeId: asha.id, leaveTypeId: casualId, year: 2026 } });
    expect(a.days).toBe(7.5);
  });
});

describe('leave already taken', () => {
  it('records each row as approved leave and marks its days', async () => {
    /* 2026-09-15/16 are a Tuesday and Wednesday. */
    const rows = [{ employeeCode: 'E1', leaveType: 'Casual', from: '2026-09-15', to: '2026-09-16', reason: 'Family function' }];
    const done = (await att(c, '/leave/requests/import', { rows }).expect(200)).body;
    expect(done).toMatchObject({ imported: 1, failed: 0 });
    const req = await peoplePrisma.leaveRequest.findFirstOrThrow({ where: { orgId: c.orgId, employeeId: asha.id, fromDate: '2026-09-15' } });
    expect(req.status).toBe('APPROVED');
    expect(req.days).toBe(2);
    const marked = await peoplePrisma.attendanceRecord.count({ where: { orgId: c.orgId, employeeId: asha.id, date: { in: ['2026-09-15', '2026-09-16'] }, status: 'ON_LEAVE' } });
    expect(marked).toBe(2);

    /* The same days again overlap and are refused, with the row named. */
    const again = (await att(c, '/leave/requests/import', { rows }).expect(200)).body;
    expect(again).toMatchObject({ imported: 0, failed: 1 });
    expect(again.results[0].error).toMatch(/Overlaps/);
  });
});

describe('contractors', () => {
  it('adds new ones, updates a name already on the list, and refuses a bad date', async () => {
    const rows = [
      { name: 'Sri Ganesh Labour', code: 'C-01', licenceNo: 'CLRA/1', licenceValidTo: '2027-03-31' },
      { name: 'Bad Date Co', licenceValidTo: '31-03-2027' },
    ];
    const first = (await request(app).post(`/api/orgs/${c.orgId}/people/contractors/import`).set(at(c)).send({ rows }).expect(200)).body;
    expect(first).toMatchObject({ imported: 1, updated: 0, failed: 1 });
    const second = (await request(app).post(`/api/orgs/${c.orgId}/people/contractors/import`).set(at(c)).send({ rows: [{ name: 'sri ganesh labour', phone: '9800000000' }] }).expect(200)).body;
    expect(second).toMatchObject({ imported: 0, updated: 1 });
    const all = await peoplePrisma.contractor.findMany({ where: { orgId: c.orgId } });
    expect(all).toHaveLength(1);
    expect(all[0].phone).toBe('9800000000');
  });
});
