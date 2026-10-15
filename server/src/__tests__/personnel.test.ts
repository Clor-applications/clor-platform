import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * Personnel inside Attendance (ClorTime's Personnel module) on the shared
 * employee list: Attendance on its own, areas, contractors, reader fields
 * pushed to readers, resign and rehire, bulk transfer, door-only staff.
 */

const { buildApp } = await import('../app.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');

const app = buildApp().listen(0);
afterAll(async () => {
  await new Promise((done) => app.close(done));
  await peoplePrisma.$disconnect();
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
async function makeOwner(features: Record<string, boolean>): Promise<Ctx> {
  const email = `pers.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Pers owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Pers Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  const ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, email };
  await request(app).put(`/api/orgs/${ctx.orgId}/features`).set(at(ctx)).send({ features }).expect(200);
  return ctx;
}
const people = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/people${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
  put: (p: string, b: unknown) => request(app).put(`/api/orgs/${c.orgId}/people${p}`).set(at(c)).send(b as any),
});
const att = (c: Ctx) => ({
  get: (p: string) => request(app).get(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)),
  post: (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${c.orgId}/attendance${p}`).set(at(c)).send(b as any),
});
const serial = () => `PER${Date.now().toString(36).toUpperCase()}${rnd().toUpperCase()}`;
const commands = async (sn: string) => (await peoplePrisma.deviceCommand.findMany({ where: { serialNumber: sn }, orderBy: { id: 'asc' } })).map((c) => c.command);

let c: Ctx;
let sn: string;
beforeAll(async () => {
  /* Attendance only — no People app. */
  c = await makeOwner({ attendance: true });
  sn = serial();
  await att(c).post('/devices', { serialNumber: sn, name: 'Gate' }).expect(201);
}, 60_000);

describe('Attendance on its own', () => {
  it('keeps its own staff: employees, departments and areas work without the People app', async () => {
    const dept = (await people(c).post('/structure/departments', { name: 'Production' }).expect(201)).body.item;
    const area = (await people(c).post('/structure/areas', { name: 'Plant 1' }).expect(201)).body.item;
    const e = (await people(c).post('/employees', { name: 'Solo Worker', code: '1001', departmentId: dept.id, areaId: area.id }).expect(201)).body.employee;
    expect(e).toMatchObject({ department: 'Production', areaName: 'Plant 1' });
    const off = await makeOwner({});
    await people(off).get('/employees').expect(403);
  });
});

describe('reader fields', () => {
  it('pushes a new employee to every reader with card, PIN and privilege, and never returns the PIN', async () => {
    await peoplePrisma.deviceCommand.deleteMany({ where: { serialNumber: sn } });
    const e = (await people(c).post('/employees', { name: 'Card Holder', code: '1002', cardNumber: '0012345678', devicePassword: '4321', devicePrivilege: 14, guardianName: 'R. Holder' }).expect(201)).body.employee;
    expect(e.devicePassword).toBeUndefined();
    expect(e.hasDevicePassword).toBe(true);
    expect(await commands(sn)).toEqual(['DATA UPDATE USERINFO PIN=1002\tName=Card Holder\tPri=14\tPasswd=4321\tCard=0012345678\tGrp=1\tTZ=1\tVerify=0\tFace=1\tFPCount=1']);

    // A changed ID: the old one comes off the readers first.
    await peoplePrisma.deviceCommand.deleteMany({ where: { serialNumber: sn } });
    await people(c).put(`/employees/${e.id}`, { devicePin: '77' }).expect(200);
    expect((await commands(sn)).map((x) => x.split('\t')[0])).toEqual([
      'DATA DELETE FINGERTMP PIN=1002',
      'DATA DELETE FACE PIN=1002',
      'DATA DELETE USERINFO PIN=1002',
      'DATA UPDATE USERINFO PIN=77',
    ]);
    // Nothing a reader holds changed: nothing sent.
    await peoplePrisma.deviceCommand.deleteMany({ where: { serialNumber: sn } });
    await people(c).put(`/employees/${e.id}`, { workLocation: 'Bay 3' }).expect(200);
    expect(await commands(sn)).toEqual([]);
  });
});

describe('contractors', () => {
  it('lists contractors with their workforce and an expired licence', async () => {
    const k = (await people(c).post('/contractors', { name: 'Acme Labour', gstin: '29abcde1234f1z5', licenceNo: 'CLRA-1', licenceValidTo: '2026-01-31' }).expect(201)).body.contractor;
    expect(k.gstin).toBe('29ABCDE1234F1Z5');
    await people(c).post('/employees', { name: 'Contract Hand', code: '1003', contractorId: k.id }).expect(201);
    const row = (await people(c).get('/contractors').expect(200)).body.contractors.find((x: any) => x.id === k.id);
    expect(row).toMatchObject({ workers: 1, presentToday: 0, licenceExpired: true });
    await request(app).delete(`/api/orgs/${c.orgId}/people/contractors/${k.id}`).set(at(c)).expect(409);
  });
});

describe('resign, rehire, transfer', () => {
  it('a resignation ends door access; a rehire puts them back on the readers', async () => {
    const e = (await people(c).post('/employees', { name: 'Leaving Soon', code: '1004', dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    await peoplePrisma.deviceCommand.deleteMany({ where: { serialNumber: sn } });
    const r = (await people(c).post(`/employees/${e.id}/resign`, { lastDay: '2026-09-30', leavingType: 'RESIGNED', reason: 'Moving city' }).expect(200)).body;
    expect(r.employee).toMatchObject({ status: 'LEFT', dateOfLeaving: '2026-09-30', leavingType: 'RESIGNED' });
    expect(await commands(sn)).toEqual(['DATA DELETE FINGERTMP PIN=1004', 'DATA DELETE FACE PIN=1004', 'DATA DELETE USERINFO PIN=1004']);
    await people(c).post(`/employees/${e.id}/resign`, { lastDay: '2026-09-30', leavingType: 'RESIGNED' }).expect(409);

    await peoplePrisma.deviceCommand.deleteMany({ where: { serialNumber: sn } });
    const back = (await people(c).post(`/employees/${e.id}/rehire`, { rejoinDate: '2026-10-10' }).expect(200)).body.employee;
    expect(back).toMatchObject({ status: 'ACTIVE', dateOfLeaving: null, leavingType: null, dateOfJoining: '2026-10-10' });
    expect((await commands(sn))[0]).toMatch(/^DATA UPDATE USERINFO PIN=1004\tName=Leaving Soon/);
  });

  it('moves people to another department or area in one go', async () => {
    const d = (await people(c).post('/structure/departments', { name: `Stores ${rnd()}` }).expect(201)).body.item;
    const a = (await people(c).post('/employees', { name: 'Mover A', code: '1005' }).expect(201)).body.employee;
    const b = (await people(c).post('/employees', { name: 'Mover B', code: '1006' }).expect(201)).body.employee;
    expect((await people(c).post('/employees/transfer', { employeeIds: [a.id, b.id], field: 'departmentId', targetId: d.id }).expect(200)).body.moved).toBe(2);
    expect((await people(c).get(`/employees/${a.id}`).expect(200)).body.employee.department).toBe(d.name);
    await people(c).post('/employees/transfer', { employeeIds: [a.id], field: 'areaId', targetId: 'not-an-area' }).expect(400);
  });
});

describe('door-only staff', () => {
  it('are not counted in the month or the muster roll; the muster roll asks for missing guardian names', async () => {
    const guard = (await people(c).post('/employees', { name: 'Night Guard', code: '1007', attendanceRequired: false, dateOfJoining: '2026-01-01' }).expect(201)).body.employee;
    const rows = (await att(c).get('/summary?month=2026-09').expect(200)).body.rows;
    expect(rows.find((r: any) => r.employeeId === guard.id)).toBeUndefined();
    const muster = (await att(c).get('/reports/muster?month=2026-09').expect(200)).body;
    expect(muster.columns.map((x: any) => x.key)).toContain('guardian');
    expect(muster.notes.join(' ')).toMatch(/no father’s or husband’s name/);
  });
});
